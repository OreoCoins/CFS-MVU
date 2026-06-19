/**
 * CFS-MVU 改动 #4 · CFS 集成 hook 命名空间
 *
 * 暴露 `Mvu._cfsHooks` 命名空间给 CFS-Suite 主脚本调用：
 *   - onBeforeWrite(rec, next)     — 写入前钩，CFS 可拦截（修改 rec 或 throw 取消）
 *   - onAfterWrite(rec)            — 写入后钩，CFS 同步 PathRegistry
 *   - onParseFailed(text, err)     — 解析失败钩，CFS 可记录或 retry
 *   - readDelegate(opts)           — 让 CFS 接管 read（读取入口劫持）
 *
 * 设计原则：
 *   - hook 未注册时 MVU 自己照常跑（默认 noop 实现）
 *   - hook 注册后 MVU 主路径调 trigger* helper，hook 抛错时 catch + 上报但不中断 MVU
 *   - CFS-Suite 用 `Mvu._cfsHooks.register({...})` 一次性注册全套
 *
 * Day 4b-1：仅提供 register API 框架 + 默认 noop。Hook 触发点的插桩
 * （updateVariables / invoke_extra_model 的 try/catch）留 Day 5 接 CFS-Suite 真正用到时再加。
 */

import type { MvuData } from '@/variable_def';

export interface CfsWriteRecord {
    /** 写入路径（lodash dot notation 或 JSON Pointer） */
    path: string;
    /** 旧值 */
    oldValue: unknown;
    /** 新值 */
    newValue: unknown;
    /** 写入原因（command.reason / parse 上下文 / etc.） */
    reason?: string;
    /** 当前 MvuData 快照（写前） */
    mvuData?: MvuData;
}

export interface CfsReadDelegateOpts {
    type?: 'message' | 'chat' | 'character' | 'global' | 'script';
    message_id?: number | 'latest';
    script_id?: string;
}

export interface CfsHookHandlers {
    /** 写入前钩，可修改 rec 或 throw 取消（默认 noop） */
    onBeforeWrite?: (rec: CfsWriteRecord, next: () => Promise<void>) => Promise<void> | void;
    /** 写入后钩（默认 noop） */
    onAfterWrite?: (rec: CfsWriteRecord) => Promise<void> | void;
    /** 解析失败钩（默认 noop） */
    onParseFailed?: (text: string, err: unknown) => Promise<void> | void;
    /** read 接管 — 返回非 undefined → 用此值替代 MVU 自己的 getVariables；返回 undefined → MVU 走默认路径 */
    readDelegate?: (opts: CfsReadDelegateOpts) => MvuData | undefined;
}

interface CfsHooksRegistry {
    /** 当前注册的 handlers（最多 1 套，多次 register 覆盖前一套） */
    _handlers: CfsHookHandlers;
    /** 注册 CFS hook，返回 unregister 函数 */
    register: (handlers: CfsHookHandlers) => () => void;
    /** 取消所有 hook */
    clear: () => void;
    /** 元信息：MVU 主路径触发 hook 的版本约定 */
    readonly _version: string;
}

const DEFAULT_HANDLERS: CfsHookHandlers = {};

export function createCfsHooks(): CfsHooksRegistry {
    const registry: CfsHooksRegistry = {
        _handlers: DEFAULT_HANDLERS,
        _version: '5.0.0-day4b',
        register(handlers) {
            registry._handlers = { ...DEFAULT_HANDLERS, ...handlers };
            console.log(
                '[CFS-MVU/cfs_hooks] CFS-Suite 注册 hook：',
                Object.keys(handlers).filter(k => typeof (handlers as any)[k] === 'function'),
            );
            return () => {
                registry._handlers = DEFAULT_HANDLERS;
                console.log('[CFS-MVU/cfs_hooks] CFS hook unregistered');
            };
        },
        clear() {
            registry._handlers = DEFAULT_HANDLERS;
        },
    };
    return registry;
}

/**
 * 触发 helper — 给 MVU 主路径（updateVariables / invoke_extra_model）用。
 * 当前 Day 4b-1 仅提供函数，触发点在 Day 5 接 CFS-Suite 用到时插桩。
 *
 * 设计：hook 抛错时 catch + console.warn，不中断 MVU 主流程。
 */

export async function triggerBeforeWrite(
    registry: CfsHooksRegistry,
    rec: CfsWriteRecord,
    next: () => Promise<void>,
): Promise<void> {
    const handler = registry._handlers.onBeforeWrite;
    if (!handler) {
        return next();
    }
    try {
        await handler(rec, next);
    } catch (e) {
        console.warn('[CFS-MVU/cfs_hooks] onBeforeWrite 抛错（已 catch）：', e);
        // 抛错时仍尝试默认路径（next），保 MVU 不被 hook 拖死
        await next();
    }
}

export async function triggerAfterWrite(
    registry: CfsHooksRegistry,
    rec: CfsWriteRecord,
): Promise<void> {
    const handler = registry._handlers.onAfterWrite;
    if (!handler) return;
    try {
        await handler(rec);
    } catch (e) {
        console.warn('[CFS-MVU/cfs_hooks] onAfterWrite 抛错（已 catch）：', e);
    }
}

export async function triggerParseFailed(
    registry: CfsHooksRegistry,
    text: string,
    err: unknown,
): Promise<void> {
    const handler = registry._handlers.onParseFailed;
    if (!handler) return;
    try {
        await handler(text, err);
    } catch (e) {
        console.warn('[CFS-MVU/cfs_hooks] onParseFailed 抛错（已 catch）：', e);
    }
}

export function tryReadDelegate(
    registry: CfsHooksRegistry,
    opts: CfsReadDelegateOpts,
): MvuData | undefined {
    const handler = registry._handlers.readDelegate;
    if (!handler) return undefined;
    try {
        return handler(opts);
    } catch (e) {
        console.warn('[CFS-MVU/cfs_hooks] readDelegate 抛错（已 catch）：', e);
        return undefined;
    }
}
