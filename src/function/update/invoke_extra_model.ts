import {
    degradeMvuToolDefinitionForDS,
    extractFromFormattedOutput,
    extractFromGenerateToolCallResult,
    MVU_JSON_PATCH_RESPONSE_SCHEMA,
    MVU_TOOL_DEFINITION,
} from '@/function/function_call';
import claude_head from '@/prompts/claude_head.txt?raw';
import claude_tail from '@/prompts/claude_tail.txt?raw';
import extra_model_task from '@/prompts/extra_model_task.txt?raw';
import gemini_head from '@/prompts/gemini_head.txt?raw';
import gemini_tail from '@/prompts/gemini_tail.txt?raw';
// CFS-MVU fix(day8-prompt): DS V4 专用 head/tail，去 ATRI/测试协议，避 DS4 安全策略
import deepseek_head from '@/prompts/deepseek_head.txt?raw';
import deepseek_tail from '@/prompts/deepseek_tail.txt?raw';
import {
    buildOtherPresetGenerateConfig,
    getExtraModelPreset,
} from '@/function/update/extra_model_preset';
// CFS-MVU fix(链路): 副请求拿当前 stat_data 全文塞 task，绕过被 CFS-Suite 改的 worldbook
import { getLastValidVariable } from '@/util';
import {
    clearExtraModelRequestOverrides,
    setExtraModelRequestOverrides,
} from '@/function/request/extra_model_request_override';
import { useDataStore } from '@/store';
import { normalizeBaseURL } from '@/util';
import { literalYamlify, uuidv4 } from '@util/common';
import { compare } from 'compare-versions';
// CFS-MVU 改动 #1：provider 探测（DS4 / OpenAI / Anthropic / Google / unknown）
import { detectProvider, describeProfile } from '@/function/detect_provider';

//测试用，为了使首次请求必失败
let debug_extra_request_counter = 0;

function generateRandomHeader(): string {
    return _.times(4, () => uuidv4().slice(0, 8)).join('\n');
}

function setExtraAnalysisStates() {
    const store = useDataStore();

    if (store.runtimes.is_during_extra_analysis === true) {
        //这个函数不应当被嵌套调用，因此直接报错
        throw new Error('setExtraAnalysisStates() should not be called recursively.');
    }

    //这里本来也应当初始化macro的，但是因为不知道具体内容，所以延迟到 RequestReply
    //因为这个操作是幂等的，所以无所谓。

    store.runtimes.is_during_extra_analysis = true;
}

function unsetExtraAnalysisStates() {
    const store = useDataStore();

    SillyTavern.unregisterMacro('lastUserMessage');
    clearExtraModelRequestOverrides();
    store.runtimes.is_during_extra_analysis = false;
    store.runtimes.is_function_call_enabled = false;
}

let is_analysis_in_progress = false;

export async function invokeExtraModelWithStrategy(): Promise<string | null> {
    const batch_id = generateRandomHeader();
    if (is_analysis_in_progress) {
        return null;
    }
    try {
        is_analysis_in_progress = true;
        const store = useDataStore();

        debug_extra_request_counter = 0;

        const recordedInvoke = async (generation_id?: string) => {
            try {
                return await invokeExtraModel(generation_id, batch_id);
            } catch (e) {
                console.error(e);
                throw e;
            }
        };
        const safeInvoke = async (): Promise<{
            result: string | null;
            is_manual_canceled: boolean;
        }> => {
            let is_manual_canceled = false;
            try {
                setExtraAnalysisStates();
                return { result: await recordedInvoke(), is_manual_canceled: false };
            } catch (e) {
                /** 已经记录, 忽略 */
                if (e === 'Clicked stop button') is_manual_canceled = true;
            } finally {
                unsetExtraAnalysisStates();
            }
            return { result: null, is_manual_canceled: is_manual_canceled };
        };
        const concurrentInvoke = async (times: number) => {
            const uuids = _.times(times, uuidv4);
            try {
                setExtraAnalysisStates();
                //在函数调用的模式下，允许接受 **任意** 有效的函数结果，因此被允许被覆盖。
                return await Promise.any(uuids.map(recordedInvoke));
            } catch (e) {
                /** 已经记录, 忽略 */
            } finally {
                uuids.forEach(stopGenerationById);
                unsetExtraAnalysisStates();
            }
            return null;
        };

        switch (store.settings.额外模型解析配置.请求方式) {
            case '依次请求，失败后重试':
                for (let i = 0; i < store.settings.额外模型解析配置.请求次数; i++) {
                    if (store.settings.通知.额外模型解析中) {
                        toastr.info(
                            `${i === 0 ? '' : ` 重试 ${i}/3`}`,
                            '[MVU额外模型解析]变量更新中'
                        );
                    }
                    const { result, is_manual_canceled } = await safeInvoke();
                    if (result !== null) {
                        return result;
                    }
                    if (is_manual_canceled) {
                        //因为手动取消了，不再进行重试。
                        return null;
                    }
                }
                return null;
            case '同时请求多次':
                if (store.settings.通知.额外模型解析中) {
                    toastr.info(
                        `将同时请求 ${store.settings.额外模型解析配置.请求次数} 次AI回复以提高成功率...`,
                        '[MVU额外模型解析]变量更新中'
                    );
                }
                return concurrentInvoke(store.settings.额外模型解析配置.请求次数);
            case '先请求一次, 失败后再同时请求多次':
                if (store.settings.通知.额外模型解析中) {
                    toastr.info(`将先请求一次尝试是否能成功...`, '[MVU额外模型解析]变量更新中');
                }
                {
                    const { result, is_manual_canceled } = await safeInvoke();
                    if (result !== null) {
                        return result;
                    }
                    if (is_manual_canceled) {
                        //因为手动取消了，不再进行重试。
                        return null;
                    }
                }
                if (store.settings.通知.额外模型解析中) {
                    toastr.info(
                        `首次请求失败, 将同时请求 ${store.settings.额外模型解析配置.请求次数 - 1} 次AI回复以提高成功率...`,
                        '[MVU额外模型解析]变量更新中'
                    );
                }
                return concurrentInvoke(store.settings.额外模型解析配置.请求次数 - 1);
        }
    } finally {
        is_analysis_in_progress = false;
    }
}

/**
 * @brief 调用额外模型解析，可能会抛出异常。
 */
export async function generateExtraModel(): Promise<string | null> {
    try {
        setExtraAnalysisStates();
        return await invokeExtraModel();
    } finally {
        unsetExtraAnalysisStates();
    }
}

// 在点击停止按钮时，会触发异常 `Clicked stop button`: string ,需要专门处理。
//仅内部使用，因为一部分状态的初始化是在外面执行的。
async function invokeExtraModel(generation_id?: string, batch_id?: string): Promise<string> {
    try {
        const result = await requestReply(generation_id, batch_id);

        const tag = _([...result.matchAll(/<(update(?:variable)?|variableupdate)>/gi)]).last()?.[1];
        if (!tag) {
            throw new Error(
                literalYamlify({
                    ['[MVU额外模型解析]没有能从回复中找到<UpdateVariable>标签']: result,
                })
            );
        }

        const start_index = result.lastIndexOf(`<${tag}>`);
        const end_index = result.indexOf(`</${tag}>`, start_index);
        const update_block = result.slice(
            start_index + 2 + tag.length,
            end_index === -1 ? undefined : end_index
        );

        const fn_call_match =
            /_\.(?:set|insert|assign|remove|unset|delete|add)\s*\([\s\S]*?\)\s*;/.test(
                update_block
            );
        const json_patch_match = /json_?patch/i.test(update_block);
        if (fn_call_match || json_patch_match) {
            return `<UpdateVariable>${update_block}</UpdateVariable>`;
        }

        throw new Error(
            literalYamlify({
                ['[MVU额外模型解析]从回复找到了<UpdateVariable>标签，但其内的更新命令无效']: result,
            })
        );
    } finally {
        /* empty */
    }
}

function decode(string: string) {
    const binary = atob(string);
    const percent = binary
        .split('')
        .map(c => {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join('');
    return decodeURIComponent(percent);
}

const decoded_claude_head = decode(claude_head);
const decoded_gemini_head = decode(gemini_head);
const decoded_claude_tail = decode(claude_tail);
const decoded_gemini_tail = decode(gemini_tail);
const decoded_extra_model_task = decode(extra_model_task);
// CFS-MVU fix(day8-prompt): DS V4 专用 prompt
const decoded_deepseek_head = decode(deepseek_head);
const decoded_deepseek_tail = decode(deepseek_tail);

function isGenerateToolCallResult(
    result: string | GenerateToolCallResult
): result is GenerateToolCallResult {
    return typeof result === 'object' && result !== null && Array.isArray(result.tool_calls);
}

function normalizeGenerateResult(result: string | GenerateToolCallResult): string {
    if (!isGenerateToolCallResult(result)) {
        return result;
    }
    return extractFromGenerateToolCallResult(result) ?? result.content;
}

function normalizeGenerateResultByResponseFormat(
    result: string | GenerateToolCallResult,
    response_format: string
): string {
    if (response_format === '格式化输出') {
        const formatted = extractFromFormattedOutput(result);
        if (formatted) {
            return formatted;
        }
    }
    return normalizeGenerateResult(result);
}

async function requestReply(generation_id?: string, batch_id?: string): Promise<string> {
    const store = useDataStore();
    const response_format = store.settings.额外模型解析配置.应答格式;

    const config: GenerateRawConfig = {
        user_input: '遵循<must>指令',
        max_chat_history: 2,
        should_stream: store.settings.额外模型解析配置.兼容假流式,
        generation_id,
    };
    if (store.settings.额外模型解析配置.模型来源 === '自定义') {
        const unset_if_equal = (value: number, expected: number) =>
            compare(store.versions.tavernhelper, '4.3.9', '>=') && value === expected
                ? 'unset'
                : value;
        config.custom_api = {
            apiurl: normalizeBaseURL(store.settings.额外模型解析配置.api地址),
            key: store.settings.额外模型解析配置.密钥,
            model: store.settings.额外模型解析配置.模型名称,
            max_tokens: store.settings.额外模型解析配置.最大回复token数,
            temperature: unset_if_equal(store.settings.额外模型解析配置.温度, 1),
            frequency_penalty: unset_if_equal(store.settings.额外模型解析配置.频率惩罚, 0),
            presence_penalty: unset_if_equal(store.settings.额外模型解析配置.存在惩罚, 0),
            top_p: unset_if_equal(store.settings.额外模型解析配置.top_p, 1),
            top_k: unset_if_equal(store.settings.额外模型解析配置.top_k, 0),
        };
    }

    let task = decoded_extra_model_task;

    // === CFS-MVU 改动 #1（DS4 适配）开始 ===
    // 上游写死 OpenAI 兼容协议（tool_choice='required' + json_schema strict），DS4 直接 400。
    // 这里提前探测 provider，下方两条 response_format 分支按 profile 分流。
    // L361 主路径处的 model_name 计算保持原样，避免破坏上游行为。
    const probe_model_name =
        store.settings.额外模型解析配置.模型来源 === '与插头相同'
            ? SillyTavern.getChatCompletionModel()
            : store.settings.额外模型解析配置.模型名称;
    const probe_api_url =
        store.settings.额外模型解析配置.模型来源 === '自定义'
            ? store.settings.额外模型解析配置.api地址
            : '';
    const provider_profile = detectProvider({
        model_name: probe_model_name,
        api_url: probe_api_url,
    });
    console.log(describeProfile(provider_profile));
    // === CFS-MVU 改动 #1 END ===

    if (response_format === '工具调用') {
        task += `\n use \`${MVU_TOOL_DEFINITION.function.name}\` tool to update variables.`;
        store.runtimes.is_function_call_enabled = true;
        // CFS-MVU #2: DS4 用降级 schema（去 additionalProperties:false / $schema）
        config.tools = [
            provider_profile.is_ds4_style
                ? degradeMvuToolDefinitionForDS()
                : MVU_TOOL_DEFINITION,
        ];
        // CFS-MVU #1.C: DS4 用 'auto'，其他保持上游 'required'
        config.tool_choice = provider_profile.supports_required_tool_choice
            ? 'required'
            : 'auto';
    }

    // CFS-MVU fix(链路): 副请求 task 末尾注入当前 stat_data 全文（YAML）
    // 背景：CFS-Suite v4_full 接管模式把 worldbook 内的 stat_data macro 替换成
    // STABLE_BATCH 占位符 → 副请求 LLM 看不到真实 stat_data 全文 → 推断 path 全是猜的。
    // 通杀方案：CFS-MVU 自己塞 stat_data，绕过 worldbook，跨卡通用。
    try {
        const lastMid =
            typeof getLastMessageId === 'function' ? getLastMessageId() : -1;
        const currentVars = getLastValidVariable(lastMid);
        const statData = currentVars?.stat_data;
        if (statData && Object.keys(statData).length > 0) {
            const cleaned = _.omit(statData, ['$internal', '$delta']);
            const statSnapshot =
                typeof YAML !== 'undefined' && YAML?.stringify
                    ? YAML.stringify(cleaned)
                    : JSON.stringify(cleaned, null, 2);
            task +=
                '\n\n## 当前 stat_data 完整结构（请严格基于此层级推断 path，禁止编造不存在的路径或键名）：\n```yaml\n' +
                statSnapshot +
                '\n```';
        }
    } catch (e) {
        console.warn('[CFS-MVU/inject-stat] 注入 stat_data 失败', e);
    }

    if (response_format === '格式化输出') {
        if (provider_profile.supports_strict_json_schema) {
            // 上游原路径：strict json_schema（OpenAI / Google / unknown 走这里）
            task +=
                '\n You are in formatted-output mode. Do not output <UpdateVariable> tags, markdown, or prose. Return only a JSON object matching the provided json_schema: {"analysis":"...","json_patch":[...]}. Put MVU JsonPatch dialect operations in `json_patch`.';
            config.json_schema = MVU_JSON_PATCH_RESPONSE_SCHEMA;
        } else if (provider_profile.is_ds4_style) {
            // CFS-MVU fix(day8-prompt): DS V4 退化路径
            // 不塞 JSON Schema 对象（DS4 会判定为 meta 指令劫持），只用极简自然语言 hint。
            // 完整 schema 在 deepseek_tail 里以自然语言描述（path/value/op 各自一句）。
            task +=
                '\n Output a JSON object with two keys: "analysis" (short English string) and "json_patch" (array of RFC6902 operations). No markdown, no comments, no prose.';
            (config as { response_format?: { type: string } }).response_format = {
                type: 'json_object',
            };
        } else {
            // Anthropic 退化（没有 OpenAI 兼容 json_schema 接口）— 仍塞完整 schema 描述
            const schema_hint = JSON.stringify(MVU_JSON_PATCH_RESPONSE_SCHEMA);
            task +=
                '\n You are in formatted-output mode. Do not output <UpdateVariable> tags, markdown, or prose. Return only a JSON object matching this exact shape: {"analysis":"...","json_patch":[...]}. Put MVU JsonPatch dialect operations in `json_patch`. JSON Schema for shape reference (do not echo): ' +
                schema_hint;
            (config as { response_format?: { type: string } }).response_format = {
                type: 'json_object',
            };
        }
    }

    //因为部分预设会用到 {{lastUserMessage}}，因此进行修正。
    //在重复注册的场合, ST 的行为会是覆盖老的，因此无所谓
    SillyTavern.registerMacro('lastUserMessage', () => {
        return task;
    });
    if (store.runtimes.debug.首次额外请求必失败 && debug_extra_request_counter === 0) {
        debug_extra_request_counter++;
        throw 'simulated exception';
    }

    if (store.settings.额外模型解析配置.破限方案 === '使用当前预设') {
        clearExtraModelRequestOverrides();
        const result = await generate({
            ...config,
            injects: [
                {
                    position: 'in_chat',
                    depth: 0,
                    should_scan: false,
                    role: 'system',
                    content: task,
                },
                {
                    position: 'in_chat',
                    depth: 2,
                    should_scan: false,
                    role: 'system',
                    content: '<past_observe>',
                },
                {
                    position: 'in_chat',
                    depth: 1,
                    should_scan: false,
                    role: 'system',
                    content: '</past_observe>',
                },
            ],
        });
        return normalizeGenerateResultByResponseFormat(result, response_format);
    }

    if (store.settings.额外模型解析配置.破限方案 === '使用其他预设') {
        const preset = getExtraModelPreset(store.settings.额外模型解析配置.其他预设名称);
        const { ordered_prompts, injects, request_overrides } = buildOtherPresetGenerateConfig(
            preset,
            task
        );

        if (store.settings.额外模型解析配置.模型来源 === '与插头相同') {
            setExtraModelRequestOverrides(request_overrides);
        } else {
            clearExtraModelRequestOverrides();
        }

        return normalizeGenerateResultByResponseFormat(
            await generateRaw({
                ...config,
                injects,
                ordered_prompts,
            }),
            response_format
        );
    }

    clearExtraModelRequestOverrides();
    const model_name =
        store.settings.额外模型解析配置.模型来源 === '与插头相同'
            ? SillyTavern.getChatCompletionModel()
            : store.settings.额外模型解析配置.模型名称;
    const is_gemini = model_name.toLowerCase().includes('gemini');
    // CFS-MVU fix(day8-prompt): DS V4 用专用 head/tail（短/无 ATRI/无测试协议）
    const is_ds4 = provider_profile.is_ds4_style;

    const result = await generateRaw({
        ...config,
        ordered_prompts: [
            // CFS-MVU prefix-cache-unblock (2026-06-24):
            // 上游把 batch_id 放在 ordered_prompts 第 1 位作为 ATRI 时代的 anti-fingerprint
            // 随机段，但这会让 DS V4 自动 prefix cache 在 token 0 处就不匹配，整段稳定
            // prefix（head + additional_info + persona + char + worldinfo + past_observe
            // 标签 ≈ 5000~9000 token）全击穿，prompt_cache_hit_tokens 恒为 0。
            //
            // 现把 batch_id 挪到 tail 之前（user_input 之后）：
            //   - 不再污染 prefix → DS 自动 prefix cache 可命中稳定段
            //   - 仍保留在请求里 → 上游 anti-fingerprint 意图无损
            //   - tail 仍占据最后位置 → 最终格式约束 (Output ONLY JSON / yaml)
            //     不被随机字符串"翻盖"，避免模型偶发把 batch_id 当输出内容回显。
            //   - 上游 cherry-pick 时按 prefix-cache-unblock 标记保留即可。
            {
                role: 'system',
                content: is_ds4
                    ? decoded_deepseek_head
                    : is_gemini
                      ? decoded_gemini_head
                      : decoded_claude_head,
            },
            { role: 'system', content: '<additional_information>' },
            'persona_description',
            'char_description',
            'world_info_before',
            'world_info_after',
            { role: 'system', content: '</additional_information>' },
            { role: 'system', content: '<past_observe>' },
            'chat_history',
            { role: 'system', content: '</past_observe>' },
            { role: 'system', content: task },
            'user_input',
            // anti-fingerprint 段落保留，位置压在 tail 之前
            { role: 'system', content: batch_id ?? generateRandomHeader() },
            {
                role: 'system',
                content: is_ds4
                    ? decoded_deepseek_tail
                    : is_gemini
                      ? decoded_gemini_tail
                      : decoded_claude_tail,
            },
        ],
    });
    return normalizeGenerateResultByResponseFormat(result, response_format);
}
