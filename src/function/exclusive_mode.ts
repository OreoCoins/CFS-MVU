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

/**
 * 卡自带 MVU 框架脚本的识别特征（按 tavern_helper script.content 匹配）。
 *
 * 改动 #7 范围修正（2026-06-21）：只禁框架本体，**保留 Zod schema 脚本**。
 *
 * 历史：#2 初版把 'registerMvuSchema' / 'mvu_zod' 也列入禁用范围，结果禁掉了卡
 * 通过 mvu_zod.js 注册的 'mag_command_parsed_for_zod' 监听器 —— 该监听器才是
 * 处理 z.record / z.looseObject 字段（如《虞淑婉》登场角色）扩展性的真正接管点。
 * 禁了它 → CFS-MVU 的 generateSchema 默认 non-extensible → AI insert 新角色
 * (op:insert path:/登场角色/樊雪芍) 抛 SCHEMA VIOLATION → 重Roll。
 *
 * 修正后：
 *   - 'MagVarUpdate' : 卡 import .../MagicalAstrogy/MagVarUpdate@.../bundle.js（框架本体）→ **禁**
 *     禁掉它 = 消除 registerAsUniqueScript('MVU变量框架') 抢注册名 + settings 覆盖 + 双 processing
 *   - Zod schema 脚本（含 'registerMvuSchema' / 'mvu_zod' 但不含 'MagVarUpdate' import）→ **保留**
 *     它注册的 _for_zod 事件监听器是扩展性接管点，CFS-MVU update_variables.ts:809
 *     已 emit 'mag_command_parsed_for_zod'，监听器自然能接管 z.record 字段的 insert。
 */
const CARD_MVU_FRAMEWORK_MARKERS = ['MagVarUpdate'] as const;
const CARD_MVU_SCHEMA_MARKERS = ['registerMvuSchema', 'mvu_zod'] as const;

export interface DisabledCardScript {
    name: string;
    id: string;
    matched: string;
}

/**
 * CFS-MVU 改动 #7 · 霸王禁用角色卡自带 MVU 框架脚本。
 *
 * 背景：若角色卡自带 MVU 框架（tavern_helper 脚本里 import MagVarUpdate@beta +
 * registerMvuSchema），会和全局 CFS-MVU 并存 → 双 MVU 抢同一套 <UpdateVariable>
 * → 「需要重Roll」+ stat_data 初始化错乱 + PathRegistry 建不起来 + 额外模型解析哑火。
 *
 * 霸王规则（发布页：下载 CFS = 同意，MVU 源唯一 = CFS-MVU）：扫当前角色卡脚本，
 * 把命中 MVU 框架特征的脚本置 enabled=false。stat_data 结构改由 CFS-MVU 的
 * loadInitVarData() 读世界书 [initvar] entry 重建，故禁用卡脚本不丢数据。
 *
 * 幂等：已 disabled 的脚本跳过；非 MVU 脚本不动。返回本次新禁用的脚本列表。
 * 时序：JS-Slash-Runner enabled_scripts 是响应式 computed，置 false 会 teardown 该
 * 脚本 iframe（连带反注册其事件监听）；极端竞态下可能首次仍需 F5 一次。
 */
export function disableCardMvuScripts(): DisabledCardScript[] {
    const disabled: DisabledCardScript[] = [];
    try {
        if (typeof getScriptTrees !== 'function' || typeof updateScriptTreesWith !== 'function') {
            return disabled;
        }
        // 命中 framework marker → 禁；
        // 仅命中 schema marker 但不含 framework marker → 保留（扩展性接管点）。
        const matchContent = (content: string): string | null => {
            if (typeof content !== 'string') {
                return null;
            }
            for (const marker of CARD_MVU_FRAMEWORK_MARKERS) {
                if (content.includes(marker)) {
                    return marker;
                }
            }
            return null;
        };
        const isPureSchemaScript = (content: string): boolean => {
            if (typeof content !== 'string') {
                return false;
            }
            const hasSchema = CARD_MVU_SCHEMA_MARKERS.some(m => content.includes(m));
            const hasFramework = CARD_MVU_FRAMEWORK_MARKERS.some(m => content.includes(m));
            return hasSchema && !hasFramework;
        };
        const preservedSchemaScripts: string[] = [];

        updateScriptTreesWith(trees => {
            for (const tree of trees) {
                const scripts: CfsScript[] = tree.type === 'folder' ? tree.scripts : [tree];
                for (const script of scripts) {
                    if (!script.enabled) {
                        continue;
                    }
                    // 防误杀：跳过 CFS-MVU 自身（character scope 本不含全局 CFS-MVU，双保险）
                    if (typeof script.content === 'string' && script.content.includes('_cfsEdition')) {
                        continue;
                    }
                    const matched = matchContent(script.content);
                    if (matched) {
                        script.enabled = false;
                        disabled.push({ name: script.name, id: script.id, matched });
                    } else if (isPureSchemaScript(script.content)) {
                        // 显式保留：纯 schema 脚本是 CFS-MVU 扩展性接管的合作伙伴
                        preservedSchemaScripts.push(script.name);
                    }
                }
            }
            return trees;
        }, { type: 'character' });

        if (disabled.length > 0) {
            const preservedNote = preservedSchemaScripts.length > 0
                ? `；保留 ${preservedSchemaScripts.length} 个 schema 脚本作扩展性接管点：${preservedSchemaScripts.join(', ')}`
                : '';
            console.warn(
                '[CFS-MVU/exclusive_mode] 禁用角色卡自带 MVU 框架脚本 ' +
                    disabled.length +
                    ' 个：' +
                    disabled.map(d => `${d.name}(${d.matched})`).join(', ') +
                    preservedNote,
            );

            // 改动 #9（2026-06-21）：首次接管该角色卡时,前端渲染可能因 mvu_zod
            // 监听器异步绑定来不及补 prefault 默认字段而显示空白。F5 后所有监听器
            // 就位即恢复正常。用 LS 标记 + 卡 name 哈希记忆,仅在该卡首次接管时弹
            // 这条提示。LS key 持久存,卸装重装也不会再扰。
            const FIRST_TAKEOVER_LS_PREFIX = 'cfs_mvu/first_takeover_seen/';
            const cardSig: string = (() => {
                try {
                    const ctx: any = (window as any).SillyTavern?.getContext?.();
                    return String(ctx?.characterId ?? ctx?.name2 ?? 'unknown');
                } catch (_e) { return 'unknown'; }
            })();
            const lsKey = FIRST_TAKEOVER_LS_PREFIX + cardSig;
            const isFirstTime = (() => {
                try { return localStorage.getItem(lsKey) == null; }
                catch (_e) { return false; }
            })();
            if (isFirstTime) {
                try { localStorage.setItem(lsKey, String(Date.now())); } catch (_e) {}
                try {
                    toastr.warning(
                        `首次进入新角色卡会话<br><strong>请 F5 刷新一次酒馆</strong>，<br>否则前端渲染可能取不到默认字段。`,
                        '[CFS-MVU] 首次接管提示',
                        { escapeHtml: false, timeOut: 12000 },
                    );
                } catch (_e) { /* toastr 不可用时静默 */ }
            }

            try {
                toastr.info(
                    `CFS已接管-DS4适配MVU，原角色卡MVU已禁用`,
                    '[CFS-MVU]',
                    { escapeHtml: false, timeOut: 6000 },
                );
            } catch (_e) {
                /* toastr 不可用时静默 */
            }
        }
    } catch (e) {
        console.warn('[CFS-MVU/exclusive_mode] disableCardMvuScripts 失败：', e);
    }
    return disabled;
}
