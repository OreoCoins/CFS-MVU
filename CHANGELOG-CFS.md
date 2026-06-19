# CFS-MVU Changelog

仅记录 CFS-MVU 相对上游 MagVarUpdate 的变更。
上游自带的 [`CHANGELOG.md`](./CHANGELOG.md) 保留原样不动。

格式：日期 / 类型（`fork` / `cherry-pick` / `feat` / `fix` / `chore`）/ 说明

---

## v5.0.0-day4b — 2026-06-19

- **feat (#4 cfs_hooks)** — 新增 `src/function/cfs_hooks.ts`：
  - `createCfsHooks()` 创建 registry，提供 register/clear API
  - 4 个 hook：onBeforeWrite / onAfterWrite / onParseFailed / readDelegate
  - 触发 helper：triggerBeforeWrite / triggerAfterWrite / triggerParseFailed / tryReadDelegate
  - 默认 noop；hook 抛错 catch + console.warn 不中断 MVU 主路径
  - **触发点插桩留 Day 5**（updateVariables / invoke_extra_model 插桩）
- **feat (#5 exclusive_mode)** — 新增 `src/function/exclusive_mode.ts`：
  - `scanExistingMvu()` 启动时扫 window.Mvu / window.parent.Mvu / globalThis.Mvu
  - 检测 existing._cfsEdition 区分"重复装 CFS-MVU" vs "其他 MVU 实例"
  - `lockWindowMvu()` 用 Object.defineProperty configurable:false, writable:false 锁定
  - **fetch intercept / 卡级脚本 patch 留 Day 5**
- **feat (#6 _cfsEdition)** — `createMvu()` 暴露 `Mvu._cfsEdition`：
  - version: '5.0.0-day4b'
  - upstream: 'MagicalAstrogy/MagVarUpdate@c1ae3a9'
  - features: ['ds4_adapt', 'schema_degradation', 'parser_fallback', 'cfs_hooks', 'exclusive_mode', 'cfs_edition_marker']
- **接入 createMvu** — `_cfsHooks: createCfsHooks()` + `_cfsEdition: {...}` 直接挂到 mvu 返回对象
- **接入 initGlobals watch handler** — Mvu 挂上后立即 `lockWindowMvu()`，挂前 `scanExistingMvu()`
- **chore** — bundle 体积 140999 → 143466（+2.4 KiB），webpack build 1.4s 通过

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
