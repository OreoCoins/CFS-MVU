# NOTICE — CFS-MVU vs. upstream MagVarUpdate

CFS-MVU 是 [MagicalAstrogy/MagVarUpdate](https://github.com/MagicalAstrogy/MagVarUpdate) 的 fork。

- **基线 upstream SHA**：`c1ae3a921bdab2e33b1afc745e5474b9b07fc070`
- **基线 upstream 时间**：2026-04-25（[bot] Bundle）
- **基线分支**：`beta`（上游默认分支）

本文件按 MIT License 要求记录衍生作品对上游的修改。每一项功能改动必须追加一行。

---

## 改动清单

| 日期 | 类型 | 文件 / 范围 | 说明 |
|---|---|---|---|
| 2026-06-19 | fork | — | 自 MagicalAstrogy/MagVarUpdate@c1ae3a9 fork 到 OreoCoins/CFS-MVU |
| 2026-06-19 | chore | LICENSE | 顶部追加 CFS-MVU 衍生作品声明，原 MIT 文本不动 |
| 2026-06-19 | chore | NOTICE.md / CHANGELOG-CFS.md | 新增（本文件 + CFS-MVU 自有 changelog） |
| 2026-06-19 | chore | README.md | 顶部追加 fork 来源声明 + 链回上游 |
| 2026-06-19 | feat (#1) | `src/function/detect_provider.ts`（新）+ `src/function/update/invoke_extra_model.ts` | DS4 适配：provider 探测 + 格式化输出/工具调用分支按 profile 分流（DS4 用 json_object + tool_choice='auto'，其他保持上游 strict json_schema + 'required'） |
| 2026-06-19 | feat (#2) | `src/function/function_call.ts` | schema-degradation helper：`degradeJsonSchemaForDS` 去 `additionalProperties:false` / `$schema`；`degradeMvuToolDefinitionForDS` 给 DS4 工具调用路径生成兼容版 tool spec |
| 2026-06-19 | feat (#3) | `src/function/update_variables.ts` | parser 容错：`_cfsPreNormalizeFreeFormCommands` 在 extractCommands 空手时把 XML-like / op-line / add-line 自由格式翻译成 `_.set('path', value);` 再吃一次；`outError` 加 `[CFS-MVU/soft-skip]` 前缀（partial commit 上游已有，无需新增） |

---

## 待施工改动（占位，对应 spec §4）

> 以下条目在 Day 4 落地时把"待"改成具体日期，并填上 commit SHA。

- [ ] **改动 #4 — CFS 集成 hook**：新文件 `src/function/cfs_hooks.ts`（暴露 `Mvu._cfsHooks` 命名空间）
- [ ] **改动 #5 — exclusive mode**：新文件 `src/function/exclusive_mode.ts`（silent 接管 `window.Mvu`）
- [ ] **改动 #6 — 版本号互信**：暴露 `Mvu._cfsEdition`
