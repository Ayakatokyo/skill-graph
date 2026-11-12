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

也可以将会话打成单个 HTML 文件，直接用浏览器打开：

```bash
node skill-graph/scripts/skill-graph.mjs html artifacts/demo/session.json --out artifacts/demo/flow.html
```

HTML 内嵌画布的 JavaScript、CSS 和完整会话，打开后不依赖本地服务或网络。离线页面展示分析时的源码快照；核对当前文件需运行 `verify`。使用 `serve` 时，可在“全图备注 → 来源与分析范围”中按需核对当前源文件。

将 `skill-graph/` 整个目录放入你的技能目录即可使用其中的 `SKILL.md`、CLI 和内置画布；也可以直接在 Codex 对话中引用仓库内的 `skill-graph/SKILL.md`。具体分析命令见该文件。

## 操作与回读

1. 页面默认以流程图为主，需要时打开“目录”。分层流程默认显示“主流程总览”；选择分组后点“查看子流程”展开，选择“全部流程”查看完整图。
2. 点击节点或连线打开详情，直接添加修改要求、问题或建议；源码、输入输出按需展开。拖动节点只整理布局，要修改职责、输入输出或连线，先开启“编辑流程”。
3. 点击“生成优化提示词”，查看并复制包含最终差异、批注和来源的请求，交给 Codex。
4. 在“文件”菜单保存网页副本或完整会话 JSON；“更多导出格式”提供修改包、Mermaid 和 Markdown。浏览器未保存下载时，可复制内容，剪贴板不可用时使用文本预览手动复制。
5. Codex 核对源文件后按已有授权修改、验证，再重新分析实际文件并刷新会话。原草稿不会自动变成“已实现”。

浏览器会尝试保存本机草稿，但存储可能被浏览器策略禁用或清除。长期保存应下载网页副本或会话 JSON，并确认文件已保存；原 HTML、CLI 输入会话和目标 Skill 都不会自动收到页面修改。

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
