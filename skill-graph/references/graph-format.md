# 图数据协议与分析 JSON

本文件用于编写 `create` / `refresh` 的分析输入，或理解导出的会话。协议版本为 `1`。分析输入是 Codex 阅读文件后的解释，不是运行轨迹。

## 分析输入

```text
Analysis = {
  title: string,
  graph: { nodes: Node[], edges: Edge[] },
  constraints: string[],
  acceptanceCriteria: string[],
  coverage: {
    reviewedFiles: string[],
    excluded: { path: string, reason: string }[]
  }
}
Node = {
  id, title, purpose,
  kind: "input" | "step" | "decision" | "output" | "group",
  inputs: string[], outputs: string[], sourceRefs: SourceRef[],
  evidence: "verified" | "inferred" | "proposed",
  parentId?: string
}
Edge = {
  id, source, target, label,
  evidence: "verified" | "inferred" | "proposed",
  sourceRefs: SourceRef[]
}
SourceRef = { path, anchor, startLine, endLine, excerpt?, sha256? }
```

- `path` 相对于目标 Skill 根目录，不能使用绝对路径或 `..` 逃逸路径。只能引用真实文件；不要把 Mermaid 行号填进源文件定位。
- `startLine`、`endLine` 是从 1 开始的闭区间。`anchor` 写章节标题、函数名或其他可辨识语义锚点，便于行号移动后重新定位。
- 编写分析输入时只需填写路径、锚点、行号。CLI 从实际文件补齐 `excerpt` 和 `sha256`（整份来源文件的字节摘要）；摘录统一用换行符连接指定行。不要手写假的摘录或 hash。
- `id` 是稳定身份。修改标题不改变 ID，重新分析时沿用能确认是同一职责的旧 ID；职责拆分或合并需明确新旧对应，不能只凭同名关联。
- `verified`：来源直接支持；`inferred`：依据真实内容作出的解释或编排，尚非原文明确约束；`proposed`：用户期望新增的步骤或关系，尚未在当前文件中实现。
- 连线只表示先后或条件分支。不要用同一种边混画文件引用、数据依赖和执行顺序。分支条件写进 `label`，不能让读者从空间位置猜测条件或并发。
- `parentId` 表示层级归属，必须指向存在的节点，不能自指或成环。执行流程本身可以有真实的重试循环。
- `constraints` 写已知需保留的要求；`acceptanceCriteria` 写实际适用的验收条件，不能凭空添加业务指标。
- `coverage.reviewedFiles` 仅列已读文件。`excluded` 解释未读、不可读、无关或目录外资源；排除不代表已验证无影响。

## 完整小例子

假设待分析 Skill 的 `SKILL.md` 内容如下，代码块第一行就是文件第 1 行。例子只演示协议，不代表任何已安装 Skill。

```markdown
---
name: tiny-check
description: 检查用户指定的本地文件是否可读。
---
# Tiny Check
读取用户提供的文件路径。
检查文件是否存在且可读。
如果不可读，说明原因并请求重新提供路径。
如果可读，返回文件名和文件字节数。
不要修改输入文件。
```

以下 JSON 可直接保存为 `analysis.json`，对具有上述内容的目录运行 `create`：

```json
{
  "title": "Tiny Check · 文件检查流程",
  "graph": {
    "nodes": [
      {
        "id": "receive-path",
        "title": "接收路径",
        "purpose": "读取用户指定的本地文件路径。",
        "kind": "input",
        "inputs": ["用户提供的路径"],
        "outputs": ["待检查路径"],
        "sourceRefs": [{"path": "SKILL.md", "anchor": "Tiny Check", "startLine": 6, "endLine": 6}],
        "evidence": "verified"
      },
      {
        "id": "check-readable",
        "title": "文件是否可读？",
        "purpose": "检查目标文件存在且可读。",
        "kind": "decision",
        "inputs": ["待检查路径"],
        "outputs": ["可读或不可读"],
        "sourceRefs": [{"path": "SKILL.md", "anchor": "Tiny Check", "startLine": 7, "endLine": 7}],
        "evidence": "verified"
      },
      {
        "id": "request-path",
        "title": "说明问题",
        "purpose": "说明不可读原因并请求重新提供路径。",
        "kind": "output",
        "inputs": ["不可读原因"],
        "outputs": ["重选路径请求"],
        "sourceRefs": [{"path": "SKILL.md", "anchor": "Tiny Check", "startLine": 8, "endLine": 8}],
        "evidence": "verified"
      },
      {
        "id": "return-result",
        "title": "返回结果",
        "purpose": "返回文件名和字节数。",
        "kind": "output",
        "inputs": ["可读文件"],
        "outputs": ["文件名", "字节数"],
        "sourceRefs": [{"path": "SKILL.md", "anchor": "Tiny Check", "startLine": 9, "endLine": 9}],
        "evidence": "verified"
      }
    ],
    "edges": [
      {
        "id": "receive-to-check",
        "source": "receive-path",
        "target": "check-readable",
        "label": "取得路径后",
        "evidence": "verified",
        "sourceRefs": [{"path": "SKILL.md", "anchor": "Tiny Check", "startLine": 6, "endLine": 7}]
      },
      {
        "id": "check-to-request",
        "source": "check-readable",
        "target": "request-path",
        "label": "不可读",
        "evidence": "verified",
        "sourceRefs": [{"path": "SKILL.md", "anchor": "Tiny Check", "startLine": 7, "endLine": 8}]
      },
      {
        "id": "check-to-result",
        "source": "check-readable",
        "target": "return-result",
        "label": "可读",
        "evidence": "verified",
        "sourceRefs": [{"path": "SKILL.md", "anchor": "Tiny Check", "startLine": 7, "endLine": 9}]
      }
    ]
  },
  "constraints": ["不修改输入文件。"],
  "acceptanceCriteria": ["不可读文件返回原因和重选请求。", "可读文件返回文件名与字节数。"],
  "coverage": {"reviewedFiles": ["SKILL.md"], "excluded": []}
}
```

这里没有绘制“用户重新提供路径后自动重试”的回边，因为原文没有规定恢复机制。如果为了讨论补画，必须标为 `inferred`，并说明其依据和待确认处。

## 会话与修改包

CLI 在分析结果之外添加目标位置、来源摘要和初始基线，生成完整会话：

```text
Session = {
  schemaVersion: 1, id, title, createdAt,
  target: { name, root },
  baseline: { id, capturedAt, files: [{path, sha256}], graph: Graph },
  draft: Graph,
  annotations: Annotation[],
  constraints: string[], acceptanceCriteria: string[],
  layout: { [nodeId]: { x, y } },
  coverage: { reviewedFiles: string[], excluded: [{path, reason}] }
}
Annotation = {
  id, targetType: "node" | "edge" | "graph",
  targetId, targetLabel, text,
  intent: "change" | "question" | "suggestion",
  createdAt, sourceRefs: SourceRef[]
}
```

`baseline.graph` 是分析时的现状，`draft` 是用户当前期望。布局不进入语义差异。批注保留创建时的标签和来源；目标被移除或刷新时无法匹配，批注仍保留并标为失联。恢复或合并数据时保留未知元数据，不能仅重建节点标题与连线。

`export` 输出四个 UTF-8 文件：

| 文件 | 用途 |
| --- | --- |
| `session.json` | 完整保存、导入、来源核对和继续编辑 |
| `changes.json` | 机器可读修改请求，含目标、基线、净差异、批注、约束及验收条件 |
| `prompt.md` | 提供给 Codex 的可读请求，区分执行要求、问题和建议 |
| `flow.mmd` | 当前草稿的 Mermaid 文本展示，不能替代完整会话 |

`html SESSION --out flow.html` 另行生成单文件网页，内嵌完整会话及已构建的 JavaScript/CSS，不依赖本地服务或网络。网页的“保存网页副本”会嵌入当前草稿和批注，“保存会话 JSON”用于独立导入与 CLI 回读。浏览器草稿存储可能不可用，不能替代下载保存。离线网页中的源码摘录是基线快照，生成或打开 HTML 不会重新核对源文件。

净差异种类为 `node-added`、`node-removed`、`node-updated`、`edge-added`、`edge-removed`、`edge-updated`；每项包含 `targetId` 及适用的 `before` / `after`。节点显示标题、坐标和来源元数据变化不作为实现变更；职责、类型、输入输出、层级和关系条件变化按核心差异规则处理。

## CLI 契约

所有命令用 `node <本技能目录>/scripts/skill-graph.mjs` 调用，避免依赖可执行权限。路径用引号包裹。

| 命令 | 作用 |
| --- | --- |
| `inventory ROOT --out FILE` | 盘点可读取文件和摘要，不做语义分析 |
| `create ROOT --analysis FILE --out SESSION` | 核对来源并建立独立会话 |
| `verify SESSION` | 核对当前文件与来源基线；不一致时退出码为 2 |
| `verify SESSION --root ROOT` | 使用明确的新根目录核对，不凭文件同名猜测目标 |
| `export SESSION --out DIR` | 从指定会话导出四个文件；无额外模型调用 |
| `html SESSION --out FILE` | 将已构建画布与完整会话嵌入单个离线 HTML |
| `serve SESSION [--port PORT]` | 只读提供本地页面、会话及按需源码核对，绑定 127.0.0.1 |
| `refresh SESSION --analysis FILE --out NEW_SESSION [--root ROOT]` | 重新建基线，保留可匹配 ID 的布局和批注；默认使用原根目录 |

命令校验失败时先读错误并修正数据或来源；不得为了通过校验删除来源字段。`verify` 成功不等于业务验收通过。跨机器后如果根目录改变，先用用户明确指定的 `--root` 核对文件并重新分析，再用 `refresh --root` 建立新基线。该选项只替换定位根目录，不证明两个同名 Skill 是同一对象。
