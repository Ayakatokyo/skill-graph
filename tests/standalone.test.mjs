import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSession } from '../skill-graph/scripts/lib/files.mjs';
import { buildChangeSet, generatePrompt } from '../skill-graph/scripts/lib/graph.mjs';
import { renderStandalone } from '../skill-graph/scripts/lib/standalone.mjs';
import { standalonePage } from '../skill-graph/scripts/skill-graph.mjs';

const exec = promisify(execFile);
async function demoSession() {
  const analysis = JSON.parse(await readFile(new URL('../examples/demo.analysis.json', import.meta.url)));
  return createSession(fileURLToPath(new URL('../examples/demo-skill', import.meta.url)), analysis);
}
function embedded(html, tag, id) {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  assert.ok(match, `missing ${id}`);
  return match[1];
}
const snapshotId = html => html.match(/\bdata-snapshot-id="([^"]+)"/)[1];

test('standalone page embeds a lossless session and all runtime assets without external URLs', async () => {
  const analysis=JSON.parse(await readFile(new URL('../examples/demo.analysis.json',import.meta.url)));
  const session=await createSession(fileURLToPath(new URL('../examples/demo-skill',import.meta.url)),analysis);
  session.annotations.push({id:'html-note',targetType:'node',targetId:'input',targetLabel:'输入',intent:'change',text:'</script><img src=x onerror=alert(1)> & 中文 \u2028',createdAt:new Date().toISOString(),sourceRefs:[]});
  session.title='</title><script>alert(1)</script>';
  const before=JSON.stringify(session);
  const html=renderStandalone(session,{script:'const text="</script>";',style:'body {color:black}'});
  const data=embedded(html,'script','skill-graph-session');
  assert.equal(JSON.stringify(JSON.parse(data)),before);
  assert.equal(JSON.stringify(session),before);
  assert.equal((html.match(/<script\b/g)||[]).length,2);
  assert.ok(!/<(?:script|link)[^>]+(?:src|href)=/.test(html));
  assert.ok(html.includes("connect-src 'none'"));
  assert.ok(html.includes('id="skill-graph-app"'));
  assert.ok(html.includes('id="skill-graph-css"'));
  assert.throws(()=>renderStandalone(session,{script:'',style:'x'}),/资源/);
});

test('standalone export rejects absent runtime assets and invalid sessions',()=>{
  assert.throws(()=>renderStandalone({}, {script:'x',style:'x'}));
});

test('saving an edited HTML copy preserves immutable evidence, every note intent and unresolved bindings', async () => {
  const session = await demoSession();
  const originalBaseline = structuredClone(session.baseline);
  session.draft.nodes.find(node => node.id === 'read').purpose = '读取失败时说明原因并等待用户补充';
  session.layout.read = { x: -120, y: 830 };
  const text = '</sCrIpT><script>alert(1)</script><!--<script> & 中文 \u2028\u2029';
  const sourceRefs = structuredClone(session.baseline.graph.nodes.find(node => node.id === 'read').sourceRefs);
  const note = (id, intent, extra = {}) => ({ id, intent, targetType: 'node', targetId: 'read', targetLabel: '读取输入', text, createdAt: session.createdAt, sourceRefs, ...extra });
  session.annotations = [note('change', 'change'), note('question', 'question'), note('suggestion', 'suggestion'), note('orphan', 'change', { targetId: 'removed' }), note('stale', 'change', { baseRevision: 'old-baseline' })];
  session.extension = { userMetadata: ['保留扩展字段', text] };
  const before = structuredClone(session);
  const assets = { script: 'globalThis.fixture = "</script><img src=x>";', style: 'body::after {content:"</style><img src=x>"}' };
  const first = renderStandalone(session, assets);
  const restored = JSON.parse(embedded(first, 'script', 'skill-graph-session'));
  // The viewer saves another copy from its DOM textContent, not from the original asset files.
  const second = renderStandalone(restored, { script: embedded(first, 'script', 'skill-graph-app'), style: embedded(first, 'style', 'skill-graph-css') });
  const reloaded = JSON.parse(embedded(second, 'script', 'skill-graph-session'));
  assert.deepEqual(reloaded, before);
  assert.deepEqual(reloaded.baseline, originalBaseline);
  assert.deepEqual(buildChangeSet(reloaded), buildChangeSet(before));
  assert.equal(generatePrompt(reloaded), generatePrompt(before));
  assert.equal(embedded(second, 'script', 'skill-graph-app'), embedded(first, 'script', 'skill-graph-app'));
  assert.equal(embedded(second, 'style', 'skill-graph-css'), embedded(first, 'style', 'skill-graph-css'));
  assert.equal((second.match(/<script\b/gi) || []).length, 2);
  assert.doesNotMatch(embedded(second, 'script', 'skill-graph-session'), /</);
  assert.deepEqual(session, before);
  assert.notEqual(snapshotId(first), snapshotId(second), 'a newly exported page must not recover another copy\'s stale local draft');
  assert.match(snapshotId(first), /^[a-z0-9-]+$/i);
});

test('the actual built viewer embeds all entry assets and parses without external module dependencies', async t => {
  const session = await demoSession();
  const viewer = new URL('../skill-graph/assets/viewer/', import.meta.url);
  const index = await readFile(new URL('index.html', viewer), 'utf8');
  const scripts = [...index.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map(match => match[1]);
  const styles = [...index.matchAll(/<link\b[^>]*\bhref="([^"]+\.css)"/gi)].map(match => match[1]);
  assert.equal(scripts.length, 1, 'offline packaging currently requires one self-contained module');
  assert.ok(styles.length > 0);
  const html = await standalonePage(session);
  const script = embedded(html, 'script', 'skill-graph-app');
  const style = embedded(html, 'style', 'skill-graph-css');
  assert.equal(script, await readFile(new URL(scripts[0], viewer), 'utf8'));
  assert.equal(style, (await Promise.all(styles.map(file => readFile(new URL(file, viewer), 'utf8')))).join('\n'));
  assert.doesNotMatch(html, /<(?:script|link)\b[^>]*\b(?:src|href)=/i);
  assert.doesNotMatch(style, /@import\b|url\(\s*['"]?(?!data:)[^\s)'"]/i, 'CSS must not need omitted files');
  assert.doesNotMatch(script, /\bimport\s*\(/, 'dynamic chunks are not embedded by the offline packager');
  const temp = await mkdtemp(path.join(os.tmpdir(), 'skillgraph-module-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const filename = path.join(temp, 'app.mjs');
  await writeFile(filename, script);
  // Compile only: do not evaluate the viewer or execute any analyzed Skill.
  const check = 'import {SourceTextModule} from "node:vm"; import {readFileSync} from "node:fs"; const module=new SourceTextModule(readFileSync(process.argv[1],"utf8")); process.stdout.write(JSON.stringify(module.dependencySpecifiers));';
  const { stdout } = await exec(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', check, filename]);
  assert.deepEqual(JSON.parse(stdout), []);
  assert.deepEqual(JSON.parse(embedded(html, 'script', 'skill-graph-session')), session);
});
