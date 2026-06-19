/**
 * CFS-MVU 改动 #5 · Exclusive mode（silent 接管 window.Mvu）
 *
 * 套餐版的霸王规则：CFS-MVU 一旦挂上 window.Mvu，不允许其他来源（卡级脚本里的
 * MVU Zod、社区 fork、ST 全局 MVU 扩展）再改/覆盖该全局。
 *
 * Day 4b-2 范围（务实版，避免 break 其他扩展）：
 *   - scanExistingMvu()  — 启动时扫描全局，记录"被替换"快照（仅 console log，不动文件）
 *   - lockWindowMvu()    — 用 Object.defineProperty 锁定 CFS-MVU 自己的 Mvu，writable:false
 *   - getExclusiveReport()— F12 一键查看接管历史
 *
 * 不做的事（留 Day 5 / Day 6 接 CFS-Suite 真正用到时再做）：
 *   - fetch intercept（拦截上游 MagVarUpdate/artifact/bundle.js 加载）
 *   - 卡级 quick reply 脚本 patch
 *   - 调 ST disableExtension() 禁用其他 MVU 扩展
 *
 * 用户原话："接管对其他 MVU 来源只改运行时状态，不删文件" — Day 4b-2 不动磁盘文件。
 */

interface ExclusiveReport {
    /** lockWindowMvu 是否已成功调用 */
    locked: boolean;
    /** lockWindowMvu 时已存在的 Mvu 实例信息（被 CFS 取代的） */
    replacedSnapshot: {
        hadWindowMvu: boolean;
        hadWindowParentMvu: boolean;
        hadGlobalThisMvu: boolean;
        /** 替换前的 Mvu._cfsEdition 字段（如有 — 防止重复装 CFS-MVU） */
        existingCfsEdition?: { version?: string; upstream?: string };
    };
    /** lockWindowMvu 调用时间戳（ms since epoch） */
    lockedAt?: number;
}

const _report: ExclusiveReport = {
    locked: false,
    replacedSnapshot: {
        hadWindowMvu: false,
        hadWindowParentMvu: false,
        hadGlobalThisMvu: false,
    },
};

/**
 * 扫描全局 Mvu 实例，把"被替换"快照记录下来。
 * 在 lockWindowMvu 之前调用。
 */
export function scanExistingMvu(): void {
    try {
        const w: any = window;
        const wp: any = (typeof window !== 'undefined' && window.parent) || null;
        const gt: any = (typeof globalThis !== 'undefined' && globalThis) || null;

        _report.replacedSnapshot.hadWindowMvu = !!(w && w.Mvu);
        _report.replacedSnapshot.hadWindowParentMvu = !!(wp && wp !== w && wp.Mvu);
        _report.replacedSnapshot.hadGlobalThisMvu = !!(gt && gt !== w && gt.Mvu);

        // 检查已存在的 Mvu 是不是另一份 CFS-MVU（避免重复装）
        const existing =
            (w && w.Mvu) ||
            (wp && wp.Mvu) ||
            (gt && gt.Mvu) ||
            null;
        if (existing && existing._cfsEdition) {
            _report.replacedSnapshot.existingCfsEdition = {
                version: existing._cfsEdition.version,
                upstream: existing._cfsEdition.upstream,
            };
            console.warn(
                '[CFS-MVU/exclusive_mode] 检测到已存在另一份 CFS-MVU：',
                existing._cfsEdition,
                '— 本次启动将覆盖（霸王规则：后到者赢）',
            );
        } else if (
            _report.replacedSnapshot.hadWindowMvu ||
            _report.replacedSnapshot.hadWindowParentMvu ||
            _report.replacedSnapshot.hadGlobalThisMvu
        ) {
            console.warn(
                '[CFS-MVU/exclusive_mode] 检测到非 CFS-MVU 的 Mvu 实例：',
                _report.replacedSnapshot,
                '— 本次启动将覆盖（silent，无 popup）',
            );
        }
    } catch (e) {
        console.warn('[CFS-MVU/exclusive_mode] scanExistingMvu 失败：', e);
    }
}

/**
 * 锁定 window.Mvu 不可被覆盖。CFS-MVU 自己挂上 Mvu 之后调用。
 *
 * 用 Object.defineProperty configurable=false, writable=false。一旦锁住，
 * 任何外部 `window.Mvu = otherMvu` 在 strict mode 下抛 TypeError，非 strict 下静默失败。
 */
export function lockWindowMvu(): boolean {
    try {
        const target: any = window;
        if (!target.Mvu) {
            console.warn('[CFS-MVU/exclusive_mode] lockWindowMvu 中止：window.Mvu 不存在（CFS-MVU 还没挂？）');
            return false;
        }
        if (_report.locked) {
            console.log('[CFS-MVU/exclusive_mode] window.Mvu 已 lock，skip');
            return true;
        }

        Object.defineProperty(target, 'Mvu', {
            value: target.Mvu,
            configurable: false,
            writable: false,
            enumerable: true,
        });

        // window.parent 是 ST 主 frame（CFS-MVU 跑在 iframe 时）；
        // CFS-Suite 原生扩展环境 window.parent === window，重复 defineProperty 会 throw
        // （configurable=false 不能再 redefine），catch 即可
        if (window.parent && window.parent !== window) {
            try {
                Object.defineProperty(window.parent, 'Mvu', {
                    value: target.Mvu,
                    configurable: false,
                    writable: false,
                    enumerable: true,
                });
            } catch (e) {
                console.warn('[CFS-MVU/exclusive_mode] window.parent.Mvu lock 失败（可能已是同一对象）：', e);
            }
        }

        _report.locked = true;
        _report.lockedAt = Date.now();
        console.log(
            '[CFS-MVU/exclusive_mode] window.Mvu 已锁定（configurable=false, writable=false）',
        );
        return true;
    } catch (e) {
        console.error('[CFS-MVU/exclusive_mode] lockWindowMvu 失败：', e);
        return false;
    }
}

/** F12 一键查看接管历史 */
export function getExclusiveReport(): ExclusiveReport {
    return { ..._report, replacedSnapshot: { ..._report.replacedSnapshot } };
}
