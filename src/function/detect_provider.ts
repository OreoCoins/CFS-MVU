/**
 * CFS-MVU 改动 #1 · LLM provider detection helper
 *
 * 上游 invoke_extra_model.ts 的 `工具调用` / `格式化输出` 两条路径写死了 OpenAI 兼容
 * 协议（`tool_choice: 'required'` + `json_schema` strict），导致 DeepSeek V4 官方 API
 * 直接 400（DS 不支持 strict `json_schema`，工具调用也不接受 `'required'`）。
 *
 * 本文件提供轻量 provider 探测，invoke_extra_model.ts 据此分流：
 *   - DS4-style → `json_object` + `tool_choice: 'auto'`
 *   - 其他      → 走上游原路径（不退化）
 *
 * 与上游 API surface 解耦：不动 invoke 主路径，只在 task 拼装阶段加分支。
 */

export type LlmProvider =
    | 'deepseek-official' // api.deepseek.com
    | 'deepseek-relay' // 反代 DS（按 DS 协议处理）
    | 'openai' // api.openai.com（支持严格 json_schema）
    | 'anthropic' // api.anthropic.com（自有 schema 协议）
    | 'google' // gemini
    | 'unknown';

export interface ProviderProfile {
    provider: LlmProvider;
    /** DS4 协议路径开关：true → 用 json_object + tool_choice='auto' */
    is_ds4_style: boolean;
    /** 是否支持 OpenAI strict `response_format: { type: 'json_schema', json_schema: {...} }` */
    supports_strict_json_schema: boolean;
    /** 是否支持 `tool_choice: 'required'`（DS4 文档推荐 'auto'，强制 required 会偶发拒绝）*/
    supports_required_tool_choice: boolean;
    /** detection 证据，便于 F12 调试 */
    evidence: { model_name?: string; api_url?: string };
}

/**
 * 根据 model_name + api_url 判断 provider。
 *
 * 检测顺序：URL 强信号 → model 名字关键词 → fallback。
 * URL 比 model 名字更可靠（反代经常把 model 改名）。
 */
export function detectProvider(opts: {
    model_name?: string;
    api_url?: string;
}): ProviderProfile {
    const model = (opts.model_name ?? '').toLowerCase();
    const url = (opts.api_url ?? '').toLowerCase();
    const evidence = { model_name: opts.model_name, api_url: opts.api_url };

    const isDeepseekUrl =
        url.includes('deepseek.com') || url.includes('//api.deepseek');
    const isOpenAIUrl = url.includes('api.openai.com');
    const isAnthropicUrl = url.includes('api.anthropic.com');
    const isGoogleUrl =
        url.includes('googleapis.com') ||
        url.includes('aistudio.google.com') ||
        url.includes('generativelanguage.googleapis');

    const isDSv4Model =
        model.includes('deepseek-v4') || model.includes('deepseek-chat-v4');
    const isDeepseekModel = model.includes('deepseek');

    // DS：URL 命中 / model 明确 V4 / model 含 deepseek 但 URL 不属于其他大厂
    if (
        isDeepseekUrl ||
        isDSv4Model ||
        (isDeepseekModel && !isOpenAIUrl && !isAnthropicUrl && !isGoogleUrl)
    ) {
        return {
            provider: isDeepseekUrl ? 'deepseek-official' : 'deepseek-relay',
            is_ds4_style: true,
            supports_strict_json_schema: false,
            supports_required_tool_choice: false,
            evidence,
        };
    }

    if (
        isOpenAIUrl ||
        model.includes('gpt-') ||
        model.startsWith('o1') ||
        model.startsWith('o3') ||
        model.startsWith('o4')
    ) {
        return {
            provider: 'openai',
            is_ds4_style: false,
            supports_strict_json_schema: true,
            supports_required_tool_choice: true,
            evidence,
        };
    }

    if (isAnthropicUrl || model.includes('claude')) {
        return {
            provider: 'anthropic',
            is_ds4_style: false,
            // Anthropic 不支持 OpenAI 风格 json_schema；CFS-MVU 当前不动 Anthropic 路径
            supports_strict_json_schema: false,
            supports_required_tool_choice: true,
            evidence,
        };
    }

    if (isGoogleUrl || model.includes('gemini')) {
        return {
            provider: 'google',
            is_ds4_style: false,
            supports_strict_json_schema: true,
            supports_required_tool_choice: true,
            evidence,
        };
    }

    // 默认：不退化，走上游原路径
    return {
        provider: 'unknown',
        is_ds4_style: false,
        supports_strict_json_schema: true,
        supports_required_tool_choice: true,
        evidence,
    };
}

export function describeProfile(p: ProviderProfile): string {
    return `[CFS-MVU/detect_provider] ${p.provider} (ds4_style=${p.is_ds4_style}, strict_json_schema=${p.supports_strict_json_schema}, required_tool=${p.supports_required_tool_choice}) ${JSON.stringify(p.evidence)}`;
}
