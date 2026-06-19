# CFS-MVU Changelog

仅记录 CFS-MVU 相对上游 MagVarUpdate 的变更。
上游自带的 [`CHANGELOG.md`](./CHANGELOG.md) 保留原样不动。

格式：日期 / 类型（`fork` / `cherry-pick` / `feat` / `fix` / `chore`）/ 说明

---

## v5.0.0-day2 — 2026-06-19

- **feat (#1 DS4)** — 新增 `src/function/detect_provider.ts`（DS / OpenAI / Anthropic / Google / unknown 5 类 provider 探测，返回 `is_ds4_style` / `supports_strict_json_schema` / `supports_required_tool_choice` 三向开关）
- **feat (#1 DS4)** — `src/function/update/invoke_extra_model.ts` 工具调用 + 格式化输出两分支按 profile 分流：
  - DS4 工具调用 → `tool_choice: 'auto'`（DS4 文档推荐，避 'required' 偶发拒绝）
  - DS4 格式化输出 → `response_format: { type: 'json_object' }` + schema 描述塞 task 末尾（避 DS 拒绝 strict `json_schema`）
  - OpenAI / Google / unknown → 保持上游 strict `json_schema` + `'required'`
- **feat (#2 schema)** — `src/function/function_call.ts` 新增 `degradeJsonSchemaForDS` / `degradeMvuToolDefinitionForDS`，DS4 工具调用路径用降级 schema（去 `additionalProperties: false` / `$schema`），其他保持上游 frozen schema
- **feat (#3 parser)** — `src/function/update_variables.ts` 新增 `_cfsPreNormalizeFreeFormCommands` 救命模式：上游 `extractCommands` 完全空手时尝试识别 3 类自由格式（`<update>...</update>` / `op: replace, path: ...` / `add /path = value`）并翻译成 `_.set()` 候选再吃一次；`outError` 加 `[CFS-MVU/soft-skip]` 前缀方便 F12 grep（partial commit 上游已有，本笔不动）
- **chore** — bundle 体积 137143 → 140999（+3.8 KiB），webpack build 1.3s 通过，未跑 jest（上游 baseline 即跪，与本笔改动无关，详见 Day 2 施工日志）

## v5.0.0-day1 — 2026-06-19

- **fork** — initial fork from MagicalAstrogy/MagVarUpdate@c1ae3a9（2026-04-25 [bot] Bundle）
- **chore** — LICENSE 顶部追加 CFS-MVU 衍生作品声明（原 MIT 文本不动）
- **chore** — 新增 [`NOTICE.md`](./NOTICE.md)（改动清单）+ 本文件
- **chore** — README 顶部追加 fork 来源说明 + 链回上游
