import { useDataStore } from '@/store';
import { isMvuData, MvuData } from '@/variable_def';
import * as jsonpatch from 'fast-json-patch';
import { klona } from 'klona';

// CFS-MVU 补丁：原 _.debounce(SillyTavern.saveChat, 1000) 在模块顶层执行；
// 当 SillyTavern.saveChat 在加载时未就绪（undefined），lodash debounce 抛 TypeError，
// 整个 bundle ESM 加载失败 → CFS-Suite import 链炸。
// 改 lazy 化：首次调用时才解析真正的 saveChat，没有时 noop（不阻塞主路径）。
let _saveChatDebouncedInner: ((...args: unknown[]) => unknown) | null = null;
export const saveChatDebounced: (...args: unknown[]) => unknown = (...args: unknown[]) => {
    if (!_saveChatDebouncedInner) {
        const real = (SillyTavern as { saveChat?: (...a: unknown[]) => unknown })?.saveChat;
        if (typeof real === 'function') {
            _saveChatDebouncedInner = _.debounce(real, 1000) as (...args: unknown[]) => unknown;
        } else {
            console.warn('[CFS-MVU/util] SillyTavern.saveChat 不可用，saveChatDebounced 走 noop');
            _saveChatDebouncedInner = () => undefined;
        }
    }
    return _saveChatDebouncedInner(...args);
};

/**
 * 寻找包含变量信息的最后一个楼层
 * @param end_message_id 从哪一条消息开始倒序搜索(不含那一条)
 */
export function getLastValidMessageId(end_message_id: number): number {
    return _(SillyTavern.chat)
        .slice(0, end_message_id)
        .findLastIndex(chat_message => {
            return isMvuData(_.get(chat_message, ['variables', chat_message.swipe_id ?? 0], {}));
        });
}

export function getLastValidVariable(end_message_id: number): MvuData | undefined {
    const message_id = getLastValidMessageId(end_message_id);
    if (message_id === -1) {
        return undefined;
    }
    return klona(
        _.get(
            SillyTavern.chat[message_id],
            ['variables', SillyTavern.chat[message_id].swipe_id ?? 0],
            {}
        ) as MvuData
    );
}

export function controlledStoppableEventOn<T extends EventType>(
    event_type: T,
    listener: ListenerType[T]
) {
    const store = useDataStore();
    const wrapper = (...args: any[]) => {
        if (store.should_enable) {
            return listener(...args);
        }
    };
    eventOn(event_type, wrapper);
    return () => eventRemoveListener(event_type, wrapper);
}

export function isJsonPatch(patch: any): patch is jsonpatch.Operation[] {
    if (!Array.isArray(patch)) {
        return false;
    }
    // An empty array is a valid patch.
    if (patch.length === 0) {
        return true;
    }
    return patch.every(
        op =>
            _.isPlainObject(op) &&
            typeof op.op === 'string' &&
            (typeof op.path === 'string' || (op.op === 'move' && typeof op.to === 'string'))
    );
}

export function showHelpPopup(content: string) {
    SillyTavern.callGenericPopup(content, SillyTavern.POPUP_TYPE.TEXT, '', {
        allowVerticalScrolling: true,
        leftAlign: true,
        wide: true,
    });
}

export function normalizeBaseURL(api_url: string): string {
    api_url = api_url.trim().replace(/\/+$/, '');
    if (!api_url) {
        return '';
    }
    if (api_url.endsWith('/v1')) {
        return api_url;
    }
    if (api_url.endsWith('/models')) {
        return api_url.replace(/\/models$/, '');
    }
    if (api_url.endsWith('/chat/completions')) {
        return api_url.replace(/\/chat\/completions$/, '');
    }
    return `${api_url}/v1`;
}
