#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createSession, verifySession } from '../skill-graph/scripts/lib/files.mjs';
import { startServer } from '../skill-graph/scripts/skill-graph.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--serve') || args.length > 1) {
    throw new Error('用法：node scripts/demo.mjs [--serve]');
  }
  const analysis = JSON.parse(await readFile(new URL('../examples/demo.analysis.json', import.meta.url), 'utf8'));
  const session = await createSession(path.join(repositoryRoot, 'examples', 'demo-skill'), analysis);
  const verification = await verifySession(session);
  if (!verification.ok) throw new Error('演示来源校验失败，请检查 examples/demo-skill/SKILL.md 是否变化。');

  const outputPath = path.join(repositoryRoot, 'artifacts', 'demo', 'session.json');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({
    session: outputPath,
    nodes: session.draft.nodes.length,
    edges: session.draft.edges.length,
    sourceVerification: 'current',
  }, null, 2));

  if (!args.includes('--serve')) return;
  const server = await startServer(session, { port: 0 });
  console.log(`演示画布：http://127.0.0.1:${server.address().port}`);
  console.log('按 Ctrl+C 停止。画布修改不会写回合成 Skill；可导出会话保存。');
  let stopping = false;
  function shutdown() {
    if (stopping) return;
    stopping = true;
    server.close(error => {
      if (error) {
        console.error(`关闭演示服务失败：${error.message}`);
        process.exitCode = 1;
      }
    });
    server.closeIdleConnections();
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.on('error', error => {
    console.error(`演示服务失败：${error.message}`);
    process.exitCode = 1;
    shutdown();
  });
}

main().catch(error => {
  console.error(`Skill Graph 演示：${error.message}`);
  process.exitCode = 1;
});
