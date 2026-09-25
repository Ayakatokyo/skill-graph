export function createHistory(session) {
  return { past: [], present: session, future: [] };
}

export function commitHistory(history, next) {
  if (JSON.stringify(next) === JSON.stringify(history.present)) return history;
  return { past: [...history.past, history.present].slice(-80), present: next, future: [] };
}

export function undoHistory(history) {
  if (!history.past.length) return history;
  return { past: history.past.slice(0, -1), present: history.past.at(-1), future: [history.present, ...history.future] };
}

export function redoHistory(history) {
  if (!history.future.length) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
}

export function removeNode(session, nodeId) {
  return {
    ...session,
    draft: {
      ...session.draft,
      nodes: session.draft.nodes.filter(node => node.id !== nodeId).map(node => {
        if (node.parentId !== nodeId) return node;
        const { parentId, ...rest } = node;
        return rest;
      }),
      edges: session.draft.edges.filter(edge => edge.source !== nodeId && edge.target !== nodeId),
    },
  };
}

export function draftStorageKey(session) {
  return `skill-graph:draft:${encodeURIComponent(session.id)}:${encodeURIComponent(session.baseline.id)}`;
}

export function restoreDraft(session, raw, validate) {
  if (!raw) return null;
  try {
    const parsed = validate(JSON.parse(raw));
    if (parsed.id !== session.id || parsed.baseline.id !== session.baseline.id) return null;
    if (JSON.stringify(parsed.target) !== JSON.stringify(session.target)) return null;
    // A baseline identifies immutable source evidence, not just a convenient key.
    if (JSON.stringify(parsed.baseline) !== JSON.stringify(session.baseline)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function filterGraphLevel(graph, { overview = false, scope = '' } = {}) {
  if (!overview && !scope) return graph;
  const nodes = graph.nodes.filter(node => overview ? !node.parentId : node.parentId === scope);
  const ids = new Set(nodes.map(node => node.id));
  return { ...graph, nodes, edges: graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)) };
}

export function initialPositions(graph) {
  const indegree = new Map(graph.nodes.map(node => [node.id, 0]));
  for (const edge of graph.edges) indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
  const queue = graph.nodes.filter(node => indegree.get(node.id) === 0).map(node => node.id);
  const levels = new Map(queue.map(id => [id, 0]));
  const visited = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    for (const edge of graph.edges.filter(item => item.source === id)) {
      levels.set(edge.target, Math.max(levels.get(edge.target) || 0, (levels.get(id) || 0) + 1));
      indegree.set(edge.target, indegree.get(edge.target) - 1);
      if (indegree.get(edge.target) === 0) queue.push(edge.target);
    }
  }
  const rows = new Map();
  return Object.fromEntries(graph.nodes.map((node, index) => {
    const level = levels.get(node.id) ?? index;
    const row = rows.get(level) || 0;
    rows.set(level, row + 1);
    return [node.id, { x: row * 310 + 80, y: level * 185 + 50 }];
  }));
}
