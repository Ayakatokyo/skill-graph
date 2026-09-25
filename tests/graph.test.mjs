import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSession, diffGraphs, buildChangeSet, generatePrompt, toMermaid } from '../skill-graph/scripts/lib/graph.mjs';

const ref = () => ({ path: 'SKILL.md', anchor: '读取输入', startLine: 7, endLine: 9, excerpt: '读取用户指定的文件。', sha256: 'a'.repeat(64), note: '保留来源扩展字段' });
const node = (id, title = id) => ({ id, title, purpose: '读取文件', kind: 'step', inputs: ['文件路径'], outputs: ['文件内容'], sourceRefs: [ref()], evidence: 'verified' });
const edge = (id, source, target, label = '') => ({ id, source, target, label, evidence: 'verified', sourceRefs: [ref()] });
const annotation = (id, intent = 'change', targetId = 'read') => ({ id, targetType: 'node', targetId, targetLabel: '读取输入', text: '文件不存在时先让我重新选择，不要生成空报告。', intent, createdAt: '2026-09-25T01:00:00Z', sourceRefs: [ref()], author: '本地用户' });
function session() {
  const graph = { nodes: [node('read', '读取输入'), node('report', '生成报告')], edges: [edge('ok', 'read', 'report', '读取成功')] };
  return { schemaVersion: 1, id: 'session-1', title: '文件报告 Skill', createdAt: '2026-09-25T01:00:00Z', target: { name: 'file-report', root: '/tmp/file-report' }, baseline: { id: 'baseline-1', capturedAt: '2026-09-25T01:00:00Z', files: [{ path: 'SKILL.md', sha256: 'a'.repeat(64) }], graph }, draft: structuredClone(graph), annotations: [], constraints: ['保留有效文件的输出格式'], acceptanceCriteria: ['文件不存在时不生成空报告'], layout: { read: { x: 10, y: 20 } }, coverage: { reviewedFiles: ['SKILL.md'], excluded: [{ path: 'assets/logo.png', reason: '静态图标' }] } };
}

test('validating an export/import round trip retains all source and annotation metadata', () => {
  const s = session(); s.annotations = [annotation('a1')]; s.extension = { custom: true };
  const result = validateSession(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(result, s);
  assert.equal(result.annotations[0].author, '本地用户');
  assert.equal(result.baseline.graph.nodes[0].sourceRefs[0].note, '保留来源扩展字段');
});

test('layout, title, evidence and source refreshes do not request source code edits', () => {
  const s = session(); s.layout.read = { x: 600, y: -30 };
  Object.assign(s.draft.nodes[0], { title: '重新命名', position: { x: 800, y: 2 }, evidence: 'inferred', sourceRefs: [{ ...ref(), startLine: 8, endLine: 10 }] });
  assert.deepEqual(diffGraphs(s.baseline.graph, s.draft), []);
  assert.deepEqual(buildChangeSet(s).changes, []);
});

test('net semantic changes retain before/after evidence and distinguish parallel edge IDs', () => {
  const s = session(); s.baseline.graph.edges.push(edge('missing', 'read', 'report', '文件缺失'));
  s.draft = structuredClone(s.baseline.graph);
  s.draft.nodes[0].purpose = '读取文件；缺失时等待用户重新选择';
  s.draft.edges.find(e => e.id === 'missing').label = '用户补齐文件后';
  const changes = diffGraphs(s.baseline.graph, s.draft);
  assert.deepEqual(changes.map(c => [c.type, c.targetId]), [['node-updated', 'read'], ['edge-updated', 'missing']]);
  assert.equal(changes[0].before.purpose, '读取文件');
  assert.equal(changes[0].after.purpose, '读取文件；缺失时等待用户重新选择');
  assert.deepEqual(changes[1].before.sourceRefs, [ref()]);
  s.draft = structuredClone(s.baseline.graph);
  assert.deepEqual(diffGraphs(s.baseline.graph, s.draft), []);
});

test('addition and removal are based on IDs, not labels, and input is never mutated', () => {
  const s = session(); const original = JSON.stringify(s);
  s.draft.nodes[0] = { ...node('retry', '读取输入'), sourceRefs: [], evidence: 'proposed' };
  s.draft.edges[0] = edge('retry-ok', 'retry', 'report', '补齐后');
  const before = JSON.stringify(s);
  const changes = diffGraphs(s.baseline.graph, s.draft);
  assert.deepEqual(changes.map(c => [c.type, c.targetId]), [['node-removed', 'read'], ['node-added', 'retry'], ['edge-removed', 'ok'], ['edge-added', 'retry-ok']]);
  changes[0].before.title = '修改导出对象';
  assert.equal(JSON.stringify(s), before);
  assert.notEqual(before, original);
});

test('invalid identifiers, parent loops, broken edges and bad references fail with readable errors', () => {
  const cases = [
    ['重复', s => s.draft.nodes.push(node('read'))],
    ['重复', s => s.draft.edges.push(edge('ok', 'read', 'report'))],
    ['不存在', s => s.draft.edges[0].target = 'unknown'],
    ['循环', s => { s.draft.nodes[0].kind = 'group'; s.draft.nodes[1].kind = 'group'; s.draft.nodes[0].parentId = 'report'; s.draft.nodes[1].parentId = 'read'; }],
    ['不存在', s => s.draft.nodes[0].parentId = 'absent'],
    ['路径', s => s.draft.nodes[0].sourceRefs[0].path = '../secrets'],
    ['行号', s => s.draft.nodes[0].sourceRefs[0].endLine = 2],
    ['版本', s => s.schemaVersion = 999],
    ['proposed', s => s.draft.nodes.push({ ...node('new'), sourceRefs: [] })],
    ['坐标', s => s.layout.read.x = Infinity],
  ];
  for (const [message, mutate] of cases) { const s = session(); mutate(s); assert.throws(() => validateSession(s), new RegExp(message)); }
});

test('an imported baseline cannot bypass verification with missing or contradictory manifest evidence', () => {
  const cases = [
    ['SKILL.md', s => s.baseline.files = []],
    ['清单', s => s.coverage.reviewedFiles.push('scripts/missing.mjs')],
    ['清单', s => s.baseline.graph.nodes[0].sourceRefs[0].path = 'references/absent.md'],
    ['摘要', s => s.baseline.graph.edges[0].sourceRefs[0].sha256 = 'b'.repeat(64)],
    ['来源', s => s.baseline.graph.nodes[0].sourceRefs = []],
    ['来源', s => s.baseline.graph.edges[0].sourceRefs = []],
  ];
  for (const [message, mutate] of cases) { const s = session(); mutate(s); assert.throws(() => validateSession(s), new RegExp(message)); }
  const s = session(); s.annotations = [{ ...annotation('old'), baseRevision: 'old', sourceRefs: [{ ...ref(), path: 'retired.md', sha256: 'c'.repeat(64) }] }];
  assert.equal(validateSession(s).annotations[0].sourceRefs[0].path, 'retired.md');
});

test('a deleted annotation target stays in exports as orphaned with its original source snapshot', () => {
  const s = session(); s.annotations = [annotation('a1')];
  s.draft.nodes = s.draft.nodes.filter(n => n.id !== 'read'); s.draft.edges = [];
  const changes = buildChangeSet(s);
  assert.equal(changes.annotations.length, 1);
  assert.equal(changes.annotations[0].orphaned, true);
  assert.equal(changes.annotations[0].targetLabel, '读取输入');
  assert.equal(changes.annotations[0].author, '本地用户');
  assert.deepEqual(changes.annotations[0].sourceRefs, [ref()]);
  assert.deepEqual(changes.annotations[0].binding, { sessionId: 'session-1', baselineId: 'baseline-1', targetType: 'node', targetId: 'read' });
  assert.deepEqual(changes.baseline, { id: 'baseline-1', capturedAt: '2026-09-25T01:00:00Z', files: [{ path: 'SKILL.md', sha256: 'a'.repeat(64) }] });
  s.draft = structuredClone(s.baseline.graph);
  assert.equal(buildChangeSet(s).annotations[0].orphaned, false);
});

test('annotation identity never silently rebinds to same-title nodes or another graph', () => {
  const s = session(); s.annotations = [annotation('a1', 'change', 'gone'), { ...annotation('a2'), targetType: 'graph', targetId: 'another-session' }, { ...annotation('a3'), sessionId: 'another-session' }];
  const changes = buildChangeSet(s);
  assert.deepEqual(changes.annotations.map(a => a.orphaned), [true, true, true]);
  assert.equal(changes.annotations[0].targetId, 'gone');
});

test('prompt separates questions and suggestions from executable requests and includes source evidence', () => {
  const s = session(); s.draft.nodes[0].purpose = '缺失文件时请求重新选择';
  s.annotations = [annotation('a-change'), { ...annotation('a-question', 'question'), text: '这里是否可以并行？' }, { ...annotation('a-suggest', 'suggestion'), text: '建议引入缓存' }];
  const p = generatePrompt(s);
  assert.match(p, /当前行为[\s\S]*读取文件/); assert.match(p, /期望行为[\s\S]*缺失文件时请求重新选择/);
  assert.match(p, /文件不存在时先让我重新选择，不要生成空报告。/);
  assert.match(p, /SKILL\.md[\s\S]*读取输入[\s\S]*7[-–]9/);
  assert.match(p, /读取用户指定的文件。/); assert.match(p, new RegExp('a'.repeat(64)));
  assert.match(p, /保留有效文件的输出格式/); assert.match(p, /文件不存在时不生成空报告/);
  const executable = p.split('## 待回答的问题')[0];
  assert.doesNotMatch(executable, /这里是否可以并行|建议引入缓存/);
  assert.match(p, /待评估建议（未授权执行）[\s\S]*建议引入缓存/);
  assert.match(p, /基线[\s\S]*过期/);
  assert.match(p, /assets\/logo\.png[\s\S]*静态图标/);
  const desired = p.slice(p.indexOf('期望行为：'), p.indexOf('影响范围：'));
  assert.match(desired, /拟修改，尚未实现/);
  assert.doesNotMatch(desired, /read`，已核实/);
  assert.match(desired, /来源证据状态/);
});

test('orphaned change notes are pending association, not executable requests', () => {
  const s = session(); s.annotations = [annotation('a-orphan', 'change', 'gone')];
  const p = generatePrompt(s);
  assert.doesNotMatch(p.split('## 待回答的问题')[0], /文件不存在时先让我重新选择/);
  assert.match(p, /待重新关联[\s\S]*文件不存在时先让我重新选择/);
});

test('notes from an older baseline keep their evidence but cannot become executable changes', () => {
  const s = session(); s.annotations = [{ ...annotation('old-note'), baseRevision: 'older-baseline' }];
  const changes = buildChangeSet(s);
  assert.equal(changes.annotations[0].stale, true);
  assert.equal(changes.annotations[0].binding.baselineId, 'older-baseline');
  assert.equal(changes.annotations[0].sourceRefs[0].sha256, 'a'.repeat(64));
  const p = generatePrompt(s);
  assert.doesNotMatch(p.split('## 待回答的问题')[0], /文件不存在时先让我重新选择/);
  assert.match(p, /旧版本|旧基线/);
});

test('missing snapshots on stale or foreign annotations never borrow source evidence by matching ID', () => {
  for (const metadata of [{ baseRevision: 'older-baseline' }, { sessionId: 'another-session' }]) {
    const s = session(); s.baseline.graph.nodes[0].sourceRefs[0].excerpt = '不得借用的当前版本摘录';
    s.annotations = [{ ...annotation('old-note'), ...metadata, sourceRefs: [] }];
    assert.doesNotMatch(generatePrompt(s), /不得借用的当前版本摘录/);
  }
});

test('Mermaid escapes malicious IDs and labels while preserving Chinese text and parallel edges', () => {
  const a = node('x\"]\nclick x \"javascript:alert(1)\"', '读取 "文件"\n<script>& | [a]'); a.kind = 'decision';
  const b = node('end', '完成');
  const graph = { nodes: [a, b], edges: [edge('e1', a.id, b.id, '成功 | "是"'), edge('e2', a.id, b.id, '失败\n再试')] };
  const output = toMermaid(graph);
  assert.match(output, /^flowchart TD/); assert.match(output, /读取/); assert.match(output, /完成/);
  assert.doesNotMatch(output, /click x|javascript:|<script>/);
  assert.match(output, /#quot;/); assert.match(output, /#60;script#62;/);
  assert.equal(output.split('\n').filter(line => line.includes('-->')).length, 2);
  assert.match(output, /n_[a-f0-9_]+ -->/);
  assert.equal(toMermaid({ ...graph, nodes: [b, a] }).split('\n').filter(line => line.includes('-->')).join('\n'), output.split('\n').filter(line => line.includes('-->')).join('\n'));
});
