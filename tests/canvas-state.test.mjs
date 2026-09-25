import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, commitHistory, undoHistory, redoHistory, removeNode, draftStorageKey, restoreDraft, filterGraphLevel } from '../web/canvas-state.mjs';

const session = () => ({ id: 'session-one', baseline: { id: 'baseline-one', graph: { nodes: [], edges: [] } }, draft: { nodes: [{ id: 'parent' }, { id: 'child', parentId: 'parent' }, { id: 'other' }], edges: [{ id: 'edge', source: 'parent', target: 'other' }] }, annotations: [{ id: 'note', targetType: 'node', targetId: 'parent', text: '请保留失败处理' }], layout: { parent: { x: 20, y: 30 } } });

test('history restores semantic changes and retained annotations after removal', () => {
  const initial = session();
  const history = commitHistory(createHistory(initial), removeNode(initial, 'parent'));
  assert.equal(history.present.draft.nodes.length, 2);
  assert.equal(history.present.draft.nodes[0].parentId, undefined);
  assert.equal(history.present.draft.edges.length, 0);
  assert.deepEqual(history.present.annotations, initial.annotations);
  const undone = undoHistory(history);
  assert.deepEqual(undone.present, initial);
  assert.deepEqual(redoHistory(undone).present, history.present);
  assert.equal(initial.draft.nodes.length, 3, 'must not mutate original session');
});

test('a new edit after undo discards redo while no-op keeps history', () => {
  const initial = session();
  const history = commitHistory(createHistory(initial), removeNode(initial, 'parent'));
  const branch = commitHistory(undoHistory(history), { ...initial, title: '新标题' });
  assert.equal(branch.future.length, 0);
  assert.equal(commitHistory(branch, structuredClone(branch.present)), branch);
});

test('saved sessions are isolated by session and baseline and reject mismatched data', () => {
  const initial = session();
  const edited = removeNode(initial, 'parent');
  assert.notEqual(draftStorageKey(initial), draftStorageKey({ ...initial, baseline: { id: 'different' } }));
  assert.notEqual(draftStorageKey(initial), draftStorageKey({ ...initial, id: 'different' }));
  assert.deepEqual(restoreDraft(initial, JSON.stringify(edited), value => value), edited);
  assert.equal(restoreDraft(initial, '{broken', value => value), null);
  assert.equal(restoreDraft(initial, JSON.stringify({ ...edited, id: 'foreign' }), value => value), null);
  assert.equal(restoreDraft(initial, JSON.stringify(edited), () => { throw Error('invalid'); }), null);
});

test('draft recovery refuses the same IDs with different source evidence or target root', () => {
  const initial = { ...session(), target: { name: 'sample', root: '/skills/sample' } };
  assert.equal(restoreDraft(initial, JSON.stringify({ ...initial, target: { ...initial.target, root: '/other/sample' } }), value => value), null);
  assert.equal(restoreDraft(initial, JSON.stringify({ ...initial, baseline: { ...initial.baseline, files: [{ path: 'SKILL.md', sha256: 'new-fingerprint' }] } }), value => value), null);
});

test('hierarchical browsing shows direct children and same-level edges without changing the graph', () => {
  const graph = {
    nodes: [{ id: 'overview', kind: 'group' }, { id: 'end' }, { id: 'first', parentId: 'overview' }, { id: 'nested', kind: 'group', parentId: 'overview' }, { id: 'deep', parentId: 'nested' }, { id: 'deep-end', parentId: 'nested' }],
    edges: [{ id: 'top', source: 'overview', target: 'end' }, { id: 'child', source: 'first', target: 'nested' }, { id: 'deep-edge', source: 'deep', target: 'deep-end' }, { id: 'cross-level', source: 'first', target: 'deep' }],
  };
  const original = structuredClone(graph);
  const overview = filterGraphLevel(graph, { overview: true });
  assert.deepEqual(overview.nodes.map(node => node.id), ['overview', 'end']);
  assert.deepEqual(overview.edges.map(edge => edge.id), ['top']);
  const children = filterGraphLevel(graph, { overview: false, scope: 'overview' });
  assert.deepEqual(children.nodes.map(node => node.id), ['first', 'nested'], 'real group ID overview must not act as a display sentinel');
  assert.deepEqual(children.edges.map(edge => edge.id), ['child']);
  const nested = filterGraphLevel(graph, { scope: 'nested' });
  assert.deepEqual(nested.nodes.map(node => node.id), ['deep', 'deep-end']);
  assert.deepEqual(nested.edges.map(edge => edge.id), ['deep-edge']);
  assert.equal(filterGraphLevel(graph, { overview: false, scope: '' }), graph);
  assert.deepEqual(graph, original, 'display filtering must preserve the full graph for diff and export');
});
