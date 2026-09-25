# Skill Graph 的 GitHub 调研

调研日期：2026-09-25。

本次检索了 Mermaid 可视化编辑、图驱动代码修改、可视化批注反馈和图生成 Skill。以下结论来自仓库 README、许可文件及选定源码的只读检查。没有安装、构建或运行候选项目；源码存在相应机制不代表已验证它的运行可靠性。维护时间只表示观察到的仓库活动，不作为成熟度保证。

## 结论

最值得借鉴的组合是：Atlas 的语义差异与提示词构造、Plannotator 的图元素批注定位、Agentation 的结构化反馈表达。画布继续采用 React Flow；Mermaid 用于文档导出。

在本轮检查的项目中，尚未发现能直接覆盖“理解单个 Skill 的规则 → 映射源文件 → 编辑与备注 → 生成优化提示词 → 验证后更新图”的完整现成技能。现有项目已经实现了其中不少环节，我们需要集中补齐 Skill 语义与源文件映射。

## 1. Project Atlas：最接近图修改到执行请求

仓库：[afetiu/project-atlas](https://github.com/afetiu/project-atlas)。许可：[MIT](https://github.com/afetiu/project-atlas/blob/4d4eec6bf3e9320b56a6c839b04e28594c787885/LICENSE)。检查版本：`4d4eec6`，默认分支最新提交为 2026-08-08。

源码确认：

- `diffModels()` 比较节点和连线的语义属性，排除位置；布局可另存。适合把“整理图”与“修改流程”分开。[diff.ts](https://github.com/afetiu/project-atlas/blob/4d4eec6bf3e9320b56a6c839b04e28594c787885/src/shared/model/diff.ts#L52)、[yaml.ts](https://github.com/afetiu/project-atlas/blob/4d4eec6bf3e9320b56a6c839b04e28594c787885/src/shared/serialization/yaml.ts#L101)
- `buildCodegenPrompt()` 将模型变化、附加说明和组件代码路径组合成提示词。[prompts.ts](https://github.com/afetiu/project-atlas/blob/4d4eec6bf3e9320b56a6c839b04e28594c787885/src/extension/ai/prompts.ts#L72)
- 计划保存 `baseline` 和 `target`，评估变化及受影响组件。[plan.ts](https://github.com/afetiu/project-atlas/blob/4d4eec6bf3e9320b56a6c839b04e28594c787885/src/shared/plans/plan.ts#L21)

采用：现状与草稿分离、忽略布局的净差异、带源码映射的提示词生成。

需要补齐：现有映射主要是路径、语言和框架，不能精确定位 Skill 章节；更新摘要不总携带字段的完整前后值。我们的修改请求必须包括章节/符号、内容指纹、前后行为和验收条件。[映射类型](https://github.com/afetiu/project-atlas/blob/4d4eec6bf3e9320b56a6c839b04e28594c787885/src/shared/model/types.ts#L24)、[摘要实现](https://github.com/afetiu/project-atlas/blob/4d4eec6bf3e9320b56a6c839b04e28594c787885/src/shared/model/diff.ts#L131)

首版不引入其整个 VS Code 扩展或 AI 执行系统。

## 2. Plannotator：图上批注与反馈导出

仓库：[backnotprop/plannotator](https://github.com/backnotprop/plannotator)。根项目标注 [MIT OR Apache-2.0](https://github.com/backnotprop/plannotator/blob/25971baaaafcd58f723c15e913a24ff9f249b968/package.json)。检查版本：`25971ba`；GitHub 元数据的最近推送为 2026-09-24。

源码确认：

- 图批注记录图类型、目标种类、节点 ID 或连线端点、标签以及图源文档行号；不把屏幕坐标当身份。[diagram-anchor.ts](https://github.com/backnotprop/plannotator/blob/25971baaaafcd58f723c15e913a24ff9f249b968/packages/core/diagram-anchor.ts)
- 图重绘后重新定位批注；无法定位的批注被报告为未关联，而非直接丢弃。支持一个批注关联多个目标。[useDiagramComments.ts](https://github.com/backnotprop/plannotator/blob/25971baaaafcd58f723c15e913a24ff9f249b968/packages/ui/components/diagram/useDiagramComments.ts)
- 批注可导出为含图元素定位及用户意见的文本，再套入不同用途的反馈模板。[parser.ts](https://github.com/backnotprop/plannotator/blob/25971baaaafcd58f723c15e913a24ff9f249b968/packages/ui/utils/parser.ts#L1414)、[feedback-templates.ts](https://github.com/backnotprop/plannotator/blob/25971baaaafcd58f723c15e913a24ff9f249b968/packages/core/feedback-templates.ts)
- 图源代码编辑区区分草稿与基线，保存结果可返回过期状态，并保留尚未提交的内容。[useDiagramSourceDraft.ts](https://github.com/backnotprop/plannotator/blob/25971baaaafcd58f723c15e913a24ff9f249b968/packages/ui/components/diagram/useDiagramSourceDraft.ts)

采用：批注身份独立于布局；失联批注保留；模板化生成反馈；草稿不会冒充现有文件。

需要补齐：这里的图行号定位到 Mermaid/Graphviz 文档，我们还需建立“图节点 → 原始 Skill 章节/脚本”的第二层联系。它提供完整审阅系统，直接集成整个 UI 会带入较多依赖；先复用机制更合适。

## 3. Agentation：点击对象后输出有上下文的反馈

仓库：[benjitaylor/agentation](https://github.com/benjitaylor/agentation)。检查版本：`0e3236e`；GitHub 元数据最近推送为 2026-09-22。

源码确认：

- 批注同时保存用户评论、选中文本、对象定位、可选源码路径和意图/状态。[types.ts](https://github.com/benjitaylor/agentation/blob/0e3236eb1a0f5577852ab7bb5121f5dd46d42f1d/package/src/types.ts)
- 导出由确定性函数拼接定位、源码信息、选中内容与反馈，支持不同详细程度。[generate-output.ts](https://github.com/benjitaylor/agentation/blob/0e3236eb1a0f5577852ab7bb5121f5dd46d42f1d/package/src/utils/generate-output.ts)

采用：用户只负责点选与表达意见，工具自动附上已经取得的定位上下文；问题、修改和建议分别表达。

限制：它定位网页元素，无法直接理解 Skill 流程。当前 [LICENSE](https://github.com/benjitaylor/agentation/blob/0e3236eb1a0f5577852ab7bb5121f5dd46d42f1d/LICENSE) 标注 PolyForm Shield 1.0.0，并含竞争用途限制；本项目参考交互思路，暂不复制其实现。

## 4. ArchiCode：适合未来项目级扩展

仓库：[roymasad/ArchiCode](https://github.com/roymasad/ArchiCode)。许可：[AGPL-3.0-only](https://github.com/roymasad/ArchiCode/blob/15d2e8895e3a4f75236f50557914c2fadd68bc9a/LICENSE)。检查版本：`15d2e88`，默认分支最新提交为 2026-08-23。

源码确认：

- 图关系可携带文件、行号、符号、依据、置信度与 current/stale/unknown 状态。[来源证据模型](https://github.com/roymasad/ArchiCode/blob/15d2e8895e3a4f75236f50557914c2fadd68bc9a/src/shared/schema.ts#L650)
- 备注绑定流程和节点；执行时按选中节点范围收集备注。[备注模型](https://github.com/roymasad/ArchiCode/blob/15d2e8895e3a4f75236f50557914c2fadd68bc9a/src/shared/schema.ts#L1264)、[contextBuilder.ts](https://github.com/roymasad/ArchiCode/blob/15d2e8895e3a4f75236f50557914c2fadd68bc9a/src/main/storage/contextBuilder.ts#L684)
- 节点可以携带验收条件。[验收模型](https://github.com/roymasad/ArchiCode/blob/15d2e8895e3a4f75236f50557914c2fadd68bc9a/src/shared/schema.ts#L393)

采用：来源状态明确、按范围收集上下文、验收条件与修改目标关联。

限制：它是完整 Electron 编程代理平台，包含大量超出首版的能力。本项目先参考数据设计，不复制或整体引入；实际 Skill 文件仍作为事实依据。

## 5. Diagrammer：Skill 与本地画布的交接形式

仓库：[IdraDev/Diagrammer](https://github.com/IdraDev/Diagrammer)。许可：[MIT](https://github.com/IdraDev/Diagrammer/blob/main/LICENSE)。检查其 main 分支。

已核实它自带[图生成 Skill](https://github.com/IdraDev/Diagrammer/blob/main/skills/diagrammer/SKILL.md) 和 React Flow 编辑器；[studio.tsx](https://github.com/IdraDev/Diagrammer/blob/main/web/src/components/studio.tsx) 处理节点移动、连线、重连、浏览器保存及 JSON 导出。这种“AI 按协议生成图数据 → 浏览器编辑 → 导出文件交回 AI”的使用方式适合我们的首版。

限制：[schema.ts](https://github.com/IdraDev/Diagrammer/blob/main/web/src/lib/schema.ts) 尚未定义 Skill 源码定位、文件指纹、基线和修改请求，而且校验时会重建节点对象。直接追加自定义字段可能在读写过程中丢失，因此不能未经扩展就作为承载来源证据的底座。

采用交互与文件交接思路；是否复用具体画布代码，须在扩展协议后另行构建验证。

## 6. Mermify：真正的图到 Mermaid 局部回写

仓库：[tra-sco/mermify](https://github.com/tra-sco/mermify)。许可：[MIT](https://github.com/tra-sco/mermify/blob/main/LICENSE)。检查 main；最新观察到的提交为 2026-09-24。

[App.tsx](https://github.com/tra-sco/mermify/blob/main/src/App.tsx) 确实将画布操作接到节点修改、连线与删除函数，回写 Mermaid 文本；[mermaidParser.ts](https://github.com/tra-sco/mermify/blob/main/src/utils/mermaidParser.ts) 负责相关局部替换。这是实际的双向编辑，不只是导入后画图。

但它基于 Mermaid SVG 交互覆盖层：[Preview.tsx](https://github.com/tra-sco/mermify/blob/main/src/components/Preview.tsx#L552) 会重新渲染 Mermaid，[拖拽 hook](https://github.com/tra-sco/mermify/blob/main/src/hooks/useDragConnection.ts) 主要负责连线或生成节点，[状态 hook](https://github.com/tra-sco/mermify/blob/main/src/hooks/useDiagramState.ts) 保存文本历史，未提供自由节点布局的持久化。解析依赖正则和 SVG 结构约定，边定位也不足以支撑任意多重边的稳定身份。

采用按稳定 ID 定位和离散操作撤销的思路；不将其理解为完整 Mermaid 语法的无损自由画布。

## 7. Canvasdown：借鉴修改操作协议

仓库：[ssota-labs/canvasdown](https://github.com/ssota-labs/canvasdown)。许可：[MIT](https://github.com/ssota-labs/canvasdown/blob/main/LICENSE)。仓库显示 2026-07-23 归档，最后观察到的提交为 2026-01-29。

其 [core.ts](https://github.com/ssota-labs/canvasdown/blob/main/packages/core/src/core.ts) 提供框架无关的解析与 patch 验证；[patch-applier.ts](https://github.com/ssota-labs/canvasdown/blob/main/packages/adapter/react-flow/src/patch/patch-applier.ts) 将 update/add/delete/connect/disconnect 与 move/resize 分成不同操作；[useCanvasdownPatch.ts](https://github.com/ssota-labs/canvasdown/blob/main/packages/adapter/react-flow/src/hooks/useCanvasdownPatch.ts) 返回修改操作和新图状态。

值得借鉴 `目标 ID + 操作类型 + 变更属性`，但它使用自有 Mermaid-like DSL，未核实到完整图到 DSL 的序列化实现。执行器有浅拷贝后修改节点对象的行为，不适合直接当作我们需要的可靠撤销层。参考协议思路，不引入该归档项目作为核心依赖。

## 8. FlowMem：图生成 Skill 的产物组织

仓库：[ThienHuynhNgoc/FlowMem](https://github.com/ThienHuynhNgoc/FlowMem)。许可：[Apache-2.0](https://github.com/ThienHuynhNgoc/FlowMem/blob/main/LICENSE)。检查 main。

[SKILL.md](https://github.com/ThienHuynhNgoc/FlowMem/blob/main/SKILL.md) 将图、索引和查看页组织为可导航的产物，并记录生成日期及更新入口。可参考它的生成/刷新入口组织。

需要区分宣称和实际：[refresh_all.sh](https://github.com/ThienHuynhNgoc/FlowMem/blob/main/scripts/bash/refresh_all.sh) 刷新的是提取缓存，随后提示重新调用 Skill 生成图；这不是自动完成图同步。自带查看页也不等同于可编辑画布，整图的生成信息不等同于逐节点源码映射。

## 9. mermaid-reactflow-editor：不作为双向同步底座

仓库：[albingcj/mermaid-reactflow-editor](https://github.com/albingcj/mermaid-reactflow-editor)。许可：[MIT](https://github.com/albingcj/mermaid-reactflow-editor/blob/master/LICENSE)。检查 master，最新观察到的提交为 2026-07-26。

[AppUI.tsx](https://github.com/albingcj/mermaid-reactflow-editor/blob/master/src/components/AppUI.tsx#L84) 的图编辑回调只更新画布数据，未写回 Mermaid 原文；[useDiagram.ts](https://github.com/albingcj/mermaid-reactflow-editor/blob/master/src/hooks/useDiagram.ts) 再转换时会替换图。当前[持久化模块](https://github.com/albingcj/mermaid-reactflow-editor/blob/master/src/features/storage/diagramStorage.ts) 是空桩。

可以参考 flowchart/subgraph 的转换和分组布局，但不能依据 README 的“可编辑”推断它已实现保存、双向同步或反向优化闭环。

## 对本项目设计的落实

1. 画布内容分为现状、修改草稿、布局；导出基于最终语义差异。
2. 批注绑定稳定 ID、基线及来源摘录；不能可靠恢复的批注保留并标记。
3. 提示词由统一的修改请求生成；同时支持 JSON 保存与 Markdown 复制。
4. 导出同时包含用户原话、修改前后行为、Skill 源码定位和验收条件。
5. 文件保存、导入和校验必须保留来源映射、批注和版本字段；不能只保存画布的节点外观。
6. 新增底层依赖前另做实际构建与交互验证；本轮调研不将未经运行的候选直接认定为可用底座。

对应的[设计文档](skill-graph-design.md)已更新。这些是对原设计的具体化，首版范围仍是单个 Skill，不增加账号、云端协作或独立 AI 执行平台。
