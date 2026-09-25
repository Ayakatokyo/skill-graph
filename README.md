# Skill Graph

把单个 Skill 的真实流程变成可编辑画布，再把节点、连线和批注转为带来源的优化请求。

## 使用

运行包位于 `skill-graph/`，只需要 Node.js 20 或更新版本。静态画布随包提供，使用时无需 npm 安装或额外模型 API。语义分析由 Codex 根据技能说明完成，CLI 不会把目录扫描结果伪装成流程理解。

文件盘点会自动排除 Python 虚拟环境（包括名称不固定、目录内有 `pyvenv.cfg` 文件的环境）、常见依赖及缓存目录，避免将环境中的库误纳入 Skill 分析。

在 Codex 中指定本目录的 `skill-graph/SKILL.md`，并提出：

> 按这个 Skill 分析 /绝对路径/目标技能，生成带源码定位的交互流程图并打开。我会在画布上添加优化要求。

克隆后可以直接体验随仓库提供的合成示例，无需安装前端依赖：

```bash
git clone https://github.com/Ayakatokyo/skill-graph.git
cd skill-graph
node scripts/demo.mjs --serve
```

打开命令返回的本地地址。示例会根据当前克隆位置生成 `artifacts/demo/session.json`，展示主流程、子流程、条件分支与源码定位。它是专门编写的演示 Skill，不包含真实业务数据。只生成会话时运行 `node scripts/demo.mjs`。

将 `skill-graph/` 整个目录放入你的技能目录即可使用其中的 `SKILL.md`、CLI 和内置画布；也可以直接在 Codex 对话中引用仓库内的 `skill-graph/SKILL.md`。具体分析命令见该文件。

## 操作与回读

1. 分层流程默认显示“主流程总览”。选择分组后点击“查看子流程”逐层展开，点击目录中的子步骤会切换到它所在的层级；选择“全部流程”可查看所有节点。再选择节点或连线，检查职责、分支和源码片段。
2. 拖动节点整理布局。要表达功能调整，修改职责、输入输出或连线条件，或添加明确的修改批注。
3. 打开“生成优化提示词”查看净差异；问题和建议单独保留。
4. 导出完整会话和修改包，或复制提示词交给 Codex。内置浏览器未保存下载时，可复制对应 JSON 或文本。浏览器草稿不会自动写回目标 Skill。
5. Codex 核对源文件后按已有授权修改、验证，再重新分析实际文件并刷新会话。原草稿不会自动变成“已实现”。

画布使用 React Flow；Mermaid 是可移植的展示导出格式。JSON 会话保存来源、布局、批注和基线。首版不支持任意 Mermaid 文件反向导入，也不分析整个项目。

切换总览或子流程只改变显示范围，不修改图数据，也不会缩减导出内容或产生流程变更要求。

## 开发与验证

修改前端时使用 Node.js 20.19+ 或 22.12+（建议当前 LTS），以满足 Vite 构建要求；直接使用已打包 CLI 和画布只需 Node.js 20+。

```bash
npm ci
npm test
npm run build
node scripts/notices.mjs
python3 scripts/package_skill.py
```

打包脚本需要 Python 3；生成 `artifacts/skill-graph-v0.1.0.zip`。打包目录不含 node_modules 和本机示例来源。开发服务器 `npm run dev` 的 API 代理需要 CLI 在 4317 端口运行：

```bash
node scripts/demo.mjs
node skill-graph/scripts/skill-graph.mjs serve artifacts/demo/session.json --port 4317
# 另一个终端中运行 npm run dev
```

`web/` 保存画布源码，`skill-graph/assets/viewer/` 保存可直接运行的构建资源。修改画布后重新构建，一并提交更新后的资源。

实际 Skill 的分析产物可能包含源文件摘录与本机路径，应保存在被 Git 忽略的 `artifacts/` 中。仓库只包含程序、测试、文档、依赖锁文件及合成演示，不包含开发时的真实分析会话。

设计、调研和验收记录见 `docs/`。运行时第三方依赖许可随包保留在 `skill-graph/THIRD_PARTY_NOTICES.md`。
