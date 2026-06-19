/**
 * CFS-MVU · ST 原生扩展入口（v5.0-day7）
 *
 * 作用：把上游 MagVarUpdate（设计给酒馆助手脚本环境）的 webpack bundle，
 * 在 ST 原生扩展环境里也能跑。
 *
 * 实现策略：
 *   1. 顶部 import ST script.js export 的核心 API（saveChat / generateRaw / 等）
 *   2. polyfill 23 个酒馆助手特有 API（事件 / 按钮 / 变量 / 消息 / 世界书）
 *   3. dynamic import './artifact/bundle.js' — bundle 跑时所有全局都已 polyfilled
 *   4. bundle 内部 $(async () => {...}) jQuery ready 后 init，挂 window.Mvu
 *
 * 不依赖外部 CDN：jsdelivr 依赖（klona/pinia/compare-versions/fast-json-patch）
 * 由 webpack 内嵌到 bundle（spec Day 7-3）。
 */

import {
    eventSource,
    event_types,
    chat as stChat,
    chat_metadata as stChatMetadata,
    saveChat as stSaveChat,
    saveSettingsDebounced as stSaveSettingsDebounced,
    this_chid as stThisChid,
    substituteParams as stSubstituteParams,
    generateRaw as stGenerateRaw,
    sendStreamingRequest as stSendStreamingRequest,
    getRequestHeaders as stGetRequestHeaders,
    getCurrentChatId as stGetCurrentChatId,
} from '../../../../script.js';

const TAG = '[CFS-MVU/ext]';
const VERSION = '5.0.0-day7';
const SCRIPT_ID = 'cfs-mvu-native-v5';
const LS_VAR_PREFIX = 'cfs-mvu/scriptvars/';

console.log(`${TAG} v${VERSION} loading — polyfill 准备中...`);

// ===== 全局错误捕获 — bundle init 任何阶段抛错都能看到 =====
// jQuery ready handler 内 await 异常默认走 unhandledrejection，被吞掉看不到。
window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const stack = reason?.stack ?? '';
    if (stack.includes('main.ts') || stack.includes('mvu') || stack.includes('Mvu')) {
        console.error(`${TAG} [unhandledrejection 抓到 MVU init 异常]`, reason);
        if (typeof toastr !== 'undefined') {
            toastr.error(
                `MVU 初始化失败: ${reason?.message ?? reason}`,
                'CFS-MVU 套餐版',
                { timeOut: 15000 },
            );
        }
    }
});
window.addEventListener('error', (event) => {
    if (event.filename?.includes('bundle.js') || event.message?.toLowerCase().includes('mvu')) {
        console.error(`${TAG} [window.error 抓到 MVU 异常]`, event.message, event.error);
    }
});

// ========== ① 事件层 polyfill（已在 CFS-Suite 装时 polyfill 过，这里幂等）==========

function _poly(name, impl) {
    if (typeof window[name] === 'function') return;
    window[name] = impl;
}

_poly('eventOn', (e, h) => eventSource.on(e, h));
_poly('eventOnce', (e, h) => eventSource.once(e, h));
_poly('eventEmit', (e, ...args) => eventSource.emit(e, ...args));
_poly('eventOff', (e, h) => {
    if (typeof eventSource.off === 'function') return eventSource.off(e, h);
    if (typeof eventSource.removeListener === 'function') return eventSource.removeListener(e, h);
});

// tavern_events — 上游用作事件名常量
if (typeof window.tavern_events !== 'object' || window.tavern_events === null) {
    window.tavern_events = event_types || {};
}

// ========== ② 按钮注入层 polyfill（noop — ST 扩展不创建酒馆助手风格按钮）==========

_poly('getButtonEvent', (name) => `cfs-mvu-btn::${name || 'unnamed'}`);
_poly('eventOnButton', () => {});
_poly('appendInexistentScriptButtons', () => {});
_poly('getScriptName', () => 'cfs-mvu-native');
_poly('getScriptId', () => SCRIPT_ID);

// 上游 stack 显示这个 API 早期会被调
// bundle 内 checkMinimumVersion('3.4.17', ...) 用 compare-versions 校验 semver
// 必须返合法 semver；返大版本号让 minimum 检查直接通过
_poly('getTavernHelperVersion', () => '4.8.11');

// ========== ③ 变量层 polyfill（localStorage 兜底）==========

_poly('getVariables', (opts) => {
    try {
        if (!opts || opts.type === 'script') {
            const key = LS_VAR_PREFIX + (opts?.script_id ?? SCRIPT_ID);
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : {};
        }
        // chat / message / character / global — 从 chat_metadata 读
        if (opts.type === 'chat') return stChatMetadata?.variables ?? {};
        if (opts.type === 'message') {
            const mid = typeof opts.message_id === 'number' ? opts.message_id : (stChat.length - 1);
            return stChat[mid]?.variables?.[stChat[mid]?.swipe_id ?? 0] ?? {};
        }
        return {};
    } catch { return {}; }
});

_poly('updateVariablesWith', async (updater, opts) => {
    try {
        if (!opts || opts.type === 'script') {
            const key = LS_VAR_PREFIX + (opts?.script_id ?? SCRIPT_ID);
            const cur = JSON.parse(localStorage.getItem(key) || '{}');
            const next = (await updater(cur)) ?? cur;
            localStorage.setItem(key, JSON.stringify(next));
            return next;
        }
        if (opts.type === 'chat') {
            stChatMetadata.variables = stChatMetadata.variables ?? {};
            const next = (await updater(stChatMetadata.variables)) ?? stChatMetadata.variables;
            stChatMetadata.variables = next;
            return next;
        }
    } catch (e) {
        console.warn(`${TAG} updateVariablesWith failed`, e);
    }
});

_poly('insertOrAssignVariables', (vars, opts) => {
    try {
        const key = LS_VAR_PREFIX + (opts?.script_id ?? SCRIPT_ID);
        const cur = JSON.parse(localStorage.getItem(key) || '{}');
        Object.assign(cur, vars ?? {});
        localStorage.setItem(key, JSON.stringify(cur));
    } catch (e) { console.warn(`${TAG} insertOrAssignVariables failed`, e); }
});

_poly('replaceVariables', async (newVars, opts) => {
    try {
        if (!opts || opts.type === 'chat') {
            stChatMetadata.variables = newVars;
            return;
        }
        if (opts.type === 'message') {
            const mid = typeof opts.message_id === 'number' ? opts.message_id : (stChat.length - 1);
            if (stChat[mid]) {
                stChat[mid].variables = stChat[mid].variables ?? {};
                stChat[mid].variables[stChat[mid].swipe_id ?? 0] = newVars;
            }
        }
    } catch (e) { console.warn(`${TAG} replaceVariables failed`, e); }
});

_poly('deleteVariable', (name, opts) => {
    try {
        if (!opts || opts.type === 'script') {
            const key = LS_VAR_PREFIX + (opts?.script_id ?? SCRIPT_ID);
            const cur = JSON.parse(localStorage.getItem(key) || '{}');
            delete cur[name];
            localStorage.setItem(key, JSON.stringify(cur));
        } else if (opts.type === 'global') {
            // global 用 localStorage 兜底
            localStorage.removeItem(LS_VAR_PREFIX + 'global/' + name);
        }
    } catch {}
});

// ========== ④ 聊天消息层 polyfill ==========

_poly('getLastMessageId', () => stChat.length - 1);
_poly('getCurrentMessageId', () => stChat.length - 1);

_poly('getChatMessages', (range) => {
    // 上游用法：getChatMessages(message_id) 返单条 [{...}]；getChatMessages('1-5') 返多条
    if (typeof range === 'number') {
        return stChat[range] ? [{
            message_id: range,
            message: stChat[range].mes ?? '',
            role: stChat[range].is_user ? 'user' : (stChat[range].is_system ? 'system' : 'assistant'),
            name: stChat[range].name,
            swipe_id: stChat[range].swipe_id,
        }] : [];
    }
    return [];
});

_poly('setChatMessages', async (updates, opts) => {
    if (!Array.isArray(updates)) return;
    for (const u of updates) {
        const mid = u.message_id;
        if (stChat[mid] && u.message !== undefined) {
            stChat[mid].mes = u.message;
        }
    }
    if (opts?.refresh === 'affected') {
        try { await stSaveChat({ force: false }); } catch {}
    }
});

// ========== ⑤ generate / generateRaw（直接代理 ST 真 API）==========

_poly('generate', (opts) => {
    // 上游 generate({user_input, max_chat_history, should_stream, generation_id, custom_api, ordered_prompts, injects, ...})
    // ST generateRaw 接口不一样，这里做最简映射
    console.warn(`${TAG} generate() 调用 — 走 ST generateRaw 简化映射，可能不完整`);
    return stGenerateRaw({
        prompt: opts?.user_input ?? '',
        api: null,
        systemPrompt: '',
    });
});

_poly('generateRaw', (opts) => {
    return stGenerateRaw({
        prompt: opts?.prompt ?? opts?.user_input ?? '',
        api: opts?.api ?? null,
        systemPrompt: opts?.systemPrompt ?? '',
        prefill: opts?.prefill ?? '',
        jsonSchema: opts?.json_schema ?? opts?.jsonSchema ?? null,
    });
});

_poly('stopGenerationById', () => {
    // ST 用 AbortController 中止；这里 noop（CFS-MVU 调这个比较少）
    console.warn(`${TAG} stopGenerationById() noop`);
});

// ========== ⑥ 宏替换 ==========

_poly('substitudeMacros', (text) => {
    // 上游名字拼错（substitude vs substitute），代理到 ST 真函数
    return stSubstituteParams(text);
});

// ========== ⑦ TavernHelper.* 命名空间 ==========

if (typeof window.TavernHelper !== 'object' || window.TavernHelper === null) {
    window.TavernHelper = {};
}
const TH = window.TavernHelper;

if (typeof TH.substitudeMacros !== 'function') {
    TH.substitudeMacros = (text) => stSubstituteParams(text);
}
if (typeof TH.getCurrentMessageId !== 'function') {
    TH.getCurrentMessageId = () => stChat.length - 1;
}
if (typeof TH.getCharLorebooks !== 'function') {
    TH.getCharLorebooks = async () => {
        // 上游用法：返 {primary, additional[]} — 当前角色卡的世界书绑定
        console.warn(`${TAG} TavernHelper.getCharLorebooks polyfill: 返空 stub`);
        return { primary: null, additional: [] };
    };
}
if (typeof TH.getLorebookEntries !== 'function') {
    TH.getLorebookEntries = async () => [];
}
if (typeof TH.setLorebookEntries !== 'function') {
    TH.setLorebookEntries = async () => {};
}
if (typeof TH.createLorebookEntry !== 'function') {
    TH.createLorebookEntry = async () => null;
}
if (typeof TH.createLorebookEntries !== 'function') {
    TH.createLorebookEntries = async () => [];
}
if (typeof window.getCurrentCharPrimaryLorebook !== 'function') {
    window.getCurrentCharPrimaryLorebook = async () => null;
}
if (typeof window.getAvailableLorebooks !== 'function') {
    window.getAvailableLorebooks = async () => [];
}

// ========== ⑧ getRequestHeaders（ST 提供，但 CFS-MVU 期望全局函数） ==========

_poly('getRequestHeaders', () => stGetRequestHeaders({}));
_poly('getCurrentChid', () => {
    const id = stGetCurrentChatId();
    return id ?? stThisChid ?? null;
});

// ========== ⑨ SillyTavern 命名空间补全 ==========
// CFS-MVU 内部用 SillyTavern.saveChat / SillyTavern.callGenericPopup 等
if (typeof window.SillyTavern === 'object' && window.SillyTavern) {
    const ST = window.SillyTavern;
    if (typeof ST.saveChat !== 'function') ST.saveChat = stSaveChat;
    if (typeof ST.saveSettingsDebounced !== 'function') ST.saveSettingsDebounced = stSaveSettingsDebounced;
    if (typeof ST.chat === 'undefined') ST.chat = stChat;
}

// ===== ⓒ 注入假的酒馆助手脚本容器（让 registerAsUniqueScript 找到自己）=====
// store.ts L236 registerAsUniqueScript 调 $('#tavern_helper').find('div[data-script-id]')
// 期望酒馆助手的脚本管理 DOM 容器存在。ST 原生扩展环境没这个容器，
// → getPreferredScriptId() 永远返 undefined
// → should_enable 永远 false
// → createMvu watch 永远不调 _.set(window, 'Mvu', mvu)
// → Mvu 永远不挂 window！
// 注入假容器骗过 jQuery selector
try {
    if (!document.querySelector('#tavern_helper')) {
        const fakeContainer = document.createElement('div');
        fakeContainer.id = 'tavern_helper';
        fakeContainer.style.display = 'none';
        const fakeScript = document.createElement('div');
        fakeScript.setAttribute('data-script-id', SCRIPT_ID);
        fakeContainer.appendChild(fakeScript);
        (document.body || document.documentElement).appendChild(fakeContainer);
        console.log(`${TAG} 已注入假 #tavern_helper 容器（script_id=${SCRIPT_ID}）`);
    }
} catch (e) {
    console.warn(`${TAG} 注入假 #tavern_helper 失败`, e);
}

console.log(`${TAG} polyfill 完成，准备加载 bundle.js`);

// ========== ⑩ Dynamic import bundle.js + 异常处理 ==========

import('./artifact/bundle.js')
    .then(() => {
        console.log(`${TAG} ✅ bundle.js 加载成功`);
        if (typeof toastr !== 'undefined') {
            setTimeout(() => {
                if (window.Mvu?._cfsEdition) {
                    toastr.success(
                        `CFS-MVU v${VERSION} 加载成功 (${window.Mvu._cfsEdition.upstream})`,
                        'CFS-MVU 套餐版',
                        { timeOut: 4000 },
                    );
                } else {
                    toastr.info(
                        `CFS-MVU bundle 已加载，但 Mvu._cfsEdition 未就位 — 可能 init 还在进行`,
                        'CFS-MVU 套餐版',
                        { timeOut: 5000 },
                    );
                }
            }, 2000);
        }
    })
    .catch((e) => {
        console.error(`${TAG} ❌ bundle.js 加载失败`, e);
        if (typeof toastr !== 'undefined') {
            toastr.error(
                `CFS-MVU bundle.js 加载失败：${e?.message ?? e}`,
                'CFS-MVU 套餐版',
                { timeOut: 8000 },
            );
        }
    });
