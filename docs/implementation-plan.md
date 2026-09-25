# Skill Graph Implementation Plan

**Goal:** 交付可安装的单 Skill 流程梳理、交互编辑及优化提示词生成技能，并验证真实文件到图到修改包的闭环。

**Architecture:** Codex 负责语义分析，Node CLI 负责文件盘点、来源核对、会话创建、校验与本地展示。React Flow 画布读取版本化 JSON，保存布局、修改草稿和批注，用同一份核心逻辑导出变更 JSON、Markdown 提示词和 Mermaid。构建后的静态画布随技能打包，使用时无需安装 npm 依赖或额外模型 API。

**Tech Stack:** Node 20+ 标准库、React、React Flow、Vite；Node 原生测试；真实浏览器验收。

**Spec:** [skill-graph-design.md](skill-graph-design.md)

## 执行约定

本文件记录初始实施计划：直接执行、验证和打包，独立模块并行实现，主代理负责整合与交付。初始开发未建立 Git 仓库；后续按用户要求整理为公开仓库。本项目不自动修改已有全局技能。

## 文件职责

- `skill-graph/SKILL.md` 与 `references/graph-format.md`：分析和回读工作流、协议与示例。
- `skill-graph/scripts/lib/graph.mjs`：会话校验、净差异、提示词、Mermaid。
- `skill-graph/scripts/skill-graph.mjs` 与 `scripts/lib/files.mjs`：CLI、来源指纹、创建会话、过期核对、本地只读展示。
- `web/`：三栏画布、节点/连线详情、批注、历史与导出。
- `skill-graph/assets/viewer/`：构建好的本地页面，随分发包交付。
- `tests/`：图协议/差异/导出/路径与版本/HTTP 行为测试。
- `examples/`：可公开的合成 Skill 与分析定义；根据本机路径生成的会话保存在被 Git 忽略的 `artifacts/` 中。

## 共享协议与接口

```js
// 所有路径相对 target.root；sourceRefs 的 excerpt/sha256 由 CLI 从文件补齐。
SourceRef = { path, anchor, startLine, endLine, excerpt, sha256 }
Node = { id, title, purpose, kind, inputs: [], outputs: [], sourceRefs: [], evidence, parentId? }
// kind: input | step | decision | output | group
// evidence: verified | inferred | proposed
Edge = { id, source, target, label, evidence, sourceRefs: [] }
Graph = { nodes: [], edges: [] }
Annotation = { id, targetType, targetId, targetLabel, text, intent, createdAt, sourceRefs: [] }
// targetType: node | edge | graph; intent: change | question | suggestion
Session = {
  schemaVersion: 1, id, title, createdAt, target: { name, root },
  baseline: { id, capturedAt, files: [{ path, sha256 }], graph: Graph },
  draft: Graph, annotations: [], constraints: [], acceptanceCriteria: [],
  layout: { [nodeId]: { x, y } },
  coverage: { reviewedFiles: [], excluded: [{ path, reason }] }
}
// graph.mjs, browser-safe，所有导出均使用 UTF-8。
validateSession(value) // -> Session，失败 throw Error(中文可读说明)，不删元数据
diffGraphs(before, after) // -> [{type,targetId,before?,after?}]，忽略 title/布局/sourceRefs
buildChangeSet(session) // -> {schemaVersion,sessionId,baselineId,target,changes,annotations,constraints,acceptanceCriteria,coverage}
generatePrompt(session) // -> string，保留原话与证据；问题不作为执行要求
toMermaid(graph) // -> string，处理标签中的引号/换行和稳定ID
```

## 实现任务

- [x] 核心图数据与导出：先写并运行失败用例，覆盖只移动布局无变化、净差异、问题批注、失联批注、元数据往返、非法边/重复ID、中文标签与特殊字符，再实现接口；运行 `node --test tests/graph.test.mjs`。
- [x] CLI：先测试真实临时目录的路径限制、片段核对与文件变更；实现 `inventory ROOT --out FILE`、`create ROOT --analysis FILE --out FILE`、`verify SESSION`、`export SESSION --out DIR`、`serve SESSION --port PORT`；运行 `node --test tests/files.test.mjs tests/cli.test.mjs`。
- [x] 画布：接入核心接口；支持导入、来源查看、节点编辑/新增/移除、连线/条件编辑、节点/边/全图备注、搜索、子流程显示、撤销重做、草稿恢复、三种导出和提示词预览。用真实浏览器逐项验收，来源不因保存而丢失。
- [x] 技能工作流：写清分析边界、来源证据、如何运行 CLI、如何读取图修改包、执行后如何重新分析并保留可映射批注；运行技能校验。
- [x] 真实材料前向测试：使用已安装的多步骤 Skill 建立来源可核对的会话；在画布中产生修改要求，交由独立评审者只读回读定位，不执行被分析 Skill 的外部动作。
- [x] 全量测试、生产构建、独立代码审查和必要修复。构建包可离线显示，不携带 node_modules；生成 ZIP 和可打开的演示地址。

## 重点失败场景

1. 节点拖拽只改位置，不应产生修改源码的要求，由核心测试和浏览器验收覆盖。
2. 源文件移动或变更导致证据过期，verify 必须识别，由临时文件测试覆盖。
3. 删除带批注节点后，批注保留并标失联，且撤销恢复，由核心和画布覆盖。
4. 非法 JSON、重复 ID、断边、父级循环不得被静默导入，由协议测试覆盖。
5. 路径逃逸、符号链接及 HTML 特殊字符不得读出目标目录外内容或执行脚本，由 CLI 路径测试与安全文本渲染覆盖。

## 验证记录

已完成实现、27 项自动化检查、生产构建、技能格式验证、真实浏览器交互与无损会话往返、Mermaid 实际解析、独立回读及 ZIP 解压验收。详见 [validation-report.md](validation-report.md) 和 [forward-test-result.md](forward-test-result.md)。内置浏览器下载限制已提供复制后备方式；普通浏览器原生下载尚未实测。
