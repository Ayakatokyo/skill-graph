# Skill Graph

- 目标与使用入口见 [README.md](README.md)：分析单个 Skill 的真实流程，提供可编辑画布与带来源的优化请求。
- `web/` 为画布源码，`skill-graph/` 为运行包；前端变更后同步构建资源，保持 CLI 与独立 HTML 导出一致。
- 验证沿用 `npm test`；前端修改另运行 `npm run build`。实际分析会话和源码摘录留在被忽略的 `artifacts/`，仓库示例使用合成数据。
- 设计和验收记录复用 `docs/`。Git 提交与推送按用户授权，代码检查与实际页面验收分别报告。
