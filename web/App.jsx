import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, MarkerType, applyNodeChanges } from '@xyflow/react';
import { Workflow, Plus, Search, Undo2, Redo2, Upload, Download, Copy, X, ChevronRight, FileText, MessageSquare, Check, ArrowRight, CircleDot, GitBranch, LogIn, LogOut, Layers, Trash2, ShieldCheck, AlertCircle, PanelLeft, PanelRight } from 'lucide-react';
import { validateSession, buildChangeSet, generatePrompt, toMermaid } from '../skill-graph/scripts/lib/graph.mjs';
import { createHistory, commitHistory, undoHistory, redoHistory, removeNode, draftStorageKey, restoreDraft, initialPositions, filterGraphLevel } from './canvas-state.mjs';

const kinds = { input: ['输入', LogIn], step: ['步骤', CircleDot], decision: ['判断', GitBranch], output: ['输出', LogOut], group: ['子流程', Layers] };
const evidenceNames = { verified: '来源已定位', inferred: '推断', proposed: '拟新增' };
const intentNames = { change: '修改要求', question: '问题', suggestion: '建议' };
const changeNames = { 'node-added': '新增步骤', 'node-removed': '移除步骤', 'node-updated': '修改步骤', 'edge-added': '新增连线', 'edge-removed': '移除连线', 'edge-updated': '修改连线' };
const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
const lines = value => value.split('\n').map(item => item.trim()).filter(Boolean);

function Button({ icon: Icon, children, className = '', ...props }) {
  return <button className={`button ${className}`} {...props}>{Icon && <Icon size={16} aria-hidden="true" />}{children}</button>;
}

function SkillNode({ data, selected }) {
  const [name, Icon] = kinds[data.kind] || kinds.step;
  return <div className={`skill-node node-${data.kind} ${selected ? 'is-selected' : ''} ${data.changed ? 'is-changed' : ''}`}>
    <Handle type="target" position={Position.Top} aria-label="输入连线" />
    <div className="node-meta"><span><Icon size={14} />{name}</span>{data.changed && <span className="change-dot" title="有流程改动" />}</div>
    <strong>{data.title}</strong>
    <p>{data.purpose || '补充这个步骤的职责'}</p>
    <div className="node-footer"><span className={data.evidence === 'inferred' ? 'warning-text' : ''}>{evidenceNames[data.evidence] || '待核对'}</span>{data.notes > 0 && <span><MessageSquare size={12} />{data.notes}</span>}</div>
    <Handle type="source" position={Position.Bottom} aria-label="输出连线" />
  </div>;
}
const nodeTypes = { skill: SkillNode };

function Field({ label, value, onCommit, multiline = false, disabled = false, hint, rows = 3, ...props }) {
  const [local, setLocal] = useState(value || '');
  useEffect(() => setLocal(value || ''), [value]);
  const Input = multiline ? 'textarea' : 'input';
  return <label className="field"><span>{label}</span><Input {...props} value={local} onChange={event => setLocal(event.target.value)} onBlur={() => { if (local !== (value || '')) onCommit(local); }} disabled={disabled} {...(multiline ? { rows } : {})} />{hint && <small>{hint}</small>}</label>;
}

function SourceList({ refs = [] }) {
  if (!refs.length) return <p className="muted small">此对象没有已定位的来源。新增步骤会在执行时确定实现位置。</p>;
  return <div className="sources">{refs.map((source, index) => <details key={`${source.path}-${index}`} className="source" open={index === 0}>
    <summary><FileText size={14} /><span>{source.path}</span><span className="source-lines">{source.startLine ? `L${source.startLine}${source.endLine !== source.startLine ? `–${source.endLine}` : ''}` : ''}</span></summary>
    {source.anchor && <p>{source.anchor}</p>}{source.excerpt && <pre>{source.excerpt}</pre>}
  </details>)}</div>;
}

function AnnotationComposer({ target, onAdd }) {
  const [text, setText] = useState('');
  const [intent, setIntent] = useState('change');
  useEffect(() => setText(''), [target.type, target.id]);
  return <form className="annotation-composer" onSubmit={event => { event.preventDefault(); if (text.trim()) { onAdd(text, intent); setText(''); } }}>
    <label className="field"><span>批注意图</span><select value={intent} onChange={event => setIntent(event.target.value)}>{Object.entries(intentNames).map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
    <label className="field"><span>你的备注</span><textarea aria-label="你的备注" rows="4" placeholder="例如：输入文件不存在时，先请我重新选择…" value={text} onChange={event => setText(event.target.value)} /></label>
    <div className="composer-bottom"><small>保留原话，附带对象及来源。</small><Button className="primary" type="submit" icon={Plus} disabled={!text.trim()}>添加批注</Button></div>
  </form>;
}

function AnnotationList({ notes, onUpdate, onDelete, showTargets = false }) {
  return <div className="annotations">{notes.map(note => <article className={`annotation ${note.orphaned ? 'orphaned' : ''}`} key={note.id}>
    <div className="annotation-top"><span className={`intent intent-${note.intent}`}>{intentNames[note.intent]}</span>{note.orphaned && <span className="warning-text">对象已移除</span>}{note.stale && <span className="warning-text">旧版本备注 · 需核对</span>}<button className="icon-button" title="删除批注" aria-label="删除批注" onClick={() => onDelete(note.id)}><X size={14} /></button></div>
    {showTargets && <p className="annotation-target">{note.targetLabel || '全图'}</p>}
    <Field label="批注内容" value={note.text} onCommit={text => onUpdate(note.id, text)} multiline rows={3} />
  </article>)}</div>;
}

function GraphCanvas({ graph, session, selected, onSelect, onLayout, onConnect, readonly, changedIds, scope, overview }) {
  const instance = useRef(null);
  const fallbackPositions = useMemo(() => initialPositions(session.baseline.graph.nodes.length ? session.baseline.graph : graph), [session.baseline]);
  const visibleGraph = useMemo(() => filterGraphLevel(graph, { overview, scope }), [graph, scope, overview]);
  const formatted = useMemo(() => visibleGraph.nodes.map((node, index) => ({
    id: node.id,
    type: 'skill',
    position: session.layout[node.id] || fallbackPositions[node.id] || { x: 80 + (index % 3) * 310, y: 50 + Math.floor(index / 3) * 185 },
    selected: selected.type === 'node' && selected.id === node.id,
    data: { ...node, changed: changedIds.has(node.id), notes: session.annotations.filter(note => note.targetType === 'node' && note.targetId === node.id).length },
  })), [visibleGraph.nodes, session.layout, session.annotations, fallbackPositions, selected, changedIds]);
  const [nodes, setNodes] = useState(formatted);
  useEffect(() => setNodes(formatted), [formatted]);
  useEffect(() => { if (selected.type === 'node' && instance.current) instance.current.fitView({ nodes: [{ id: selected.id }], maxZoom: 1, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180, padding: 0.8 }); }, [selected.id, selected.type]);
  useEffect(() => { const timer = setTimeout(() => instance.current?.fitView({ padding: 0.25, maxZoom: 1 }), 40); return () => clearTimeout(timer); }, [scope, overview]);
  const edges = useMemo(() => visibleGraph.edges.map(edge => ({
    ...edge,
    type: 'smoothstep',
    selected: selected.type === 'edge' && selected.id === edge.id,
    markerEnd: { type: MarkerType.ArrowClosed, width: 17, height: 17 },
    style: { strokeWidth: selected.id === edge.id ? 2.5 : 1.5, ...(edge.evidence === 'inferred' ? { strokeDasharray: '5 5' } : {}) },
    labelStyle: { fontSize: 12 }, labelBgPadding: [7, 4], labelBgBorderRadius: 4,
  })), [visibleGraph.edges, selected]);
  return <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onInit={flow => { instance.current = flow; }} onNodesChange={changes => setNodes(current => applyNodeChanges(changes.filter(change => change.type !== 'remove'), current))} onNodeDragStop={(_, node) => onLayout(node.id, node.position)} onNodeClick={(_, node) => onSelect({ type: 'node', id: node.id })} onEdgeClick={(_, edge) => onSelect({ type: 'edge', id: edge.id })} onPaneClick={() => onSelect({ type: 'graph', id: session.id })} onConnect={onConnect} nodesConnectable={!readonly} edgesReconnectable={false} deleteKeyCode={null} multiSelectionKeyCode={null} selectionKeyCode={null} fitView fitViewOptions={{ padding: 0.25, maxZoom: 1 }} minZoom={0.15} maxZoom={1.6} proOptions={{ hideAttribution: true }} ariaLabelConfig={{ 'controls.zoomIn.ariaLabel': '放大流程图', 'controls.zoomOut.ariaLabel': '缩小流程图', 'controls.fitView.ariaLabel': '适应画布', 'minimap.ariaLabel': '流程缩略图' }}>
    <Background gap={22} size={1} /><Controls showInteractive={false} /><MiniMap nodeStrokeWidth={2} pannable zoomable />
  </ReactFlow>;
}

export default function App() {
  const [history, setHistory] = useState(null);
  const session = history?.present;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [mode, setMode] = useState('draft');
  const [selected, setSelected] = useState({ type: 'graph', id: '' });
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('');
  const [overview, setOverview] = useState(false);
  const [reviewTab, setReviewTab] = useState(null);
  const [exportPreview, setExportPreview] = useState(null);
  const [mobilePanel, setMobilePanel] = useState('canvas');
  const [verification, setVerification] = useState({ status: 'unverified' });
  const [saveState, setSaveState] = useState('已载入');
  const inputRef = useRef(null);
  const exportPreviewRef = useRef(null);
  const notify = useCallback((text, error = false) => setMessage({ text, error }), []);

  const loadSession = useCallback((value, recover = false) => {
    let valid = validateSession(value);
    let restored = false;
    if (recover) {
      try { const saved = restoreDraft(valid, localStorage.getItem(draftStorageKey(valid)), validateSession); if (saved) { valid = saved; restored = true; } } catch { /* file import/export remains available */ }
    }
    setHistory(createHistory(valid)); setSelected({ type: 'graph', id: valid.id }); setScope(''); setOverview(valid.draft.nodes.some(node => node.parentId)); setQuery(''); setMode('draft'); setReviewTab(null); setExportPreview(null); setVerification({ status: 'unverified' });
    setSaveState(restored ? '已恢复本机草稿' : '已载入');
    if (restored) notify('已恢复此流程和基线对应的本机草稿。');
  }, [notify]);

  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/session', { signal: abort.signal }).then(response => { if (!response.ok) throw Error('unavailable'); return response.json(); }).then(value => loadSession(value, true)).catch(error => { if (error.name !== 'AbortError') setHistory(null); }).finally(() => setLoading(false));
    return () => abort.abort();
  }, [loadSession]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(null), 5200); return () => clearTimeout(timer); }, [message]);
  useEffect(() => { if (exportPreview && reviewTab === 'export') { exportPreviewRef.current?.focus(); exportPreviewRef.current?.select(); } }, [exportPreview, reviewTab]);

  useEffect(() => {
    if (!session) return;
    setSaveState('正在保存…');
    const timer = setTimeout(() => {
      try { localStorage.setItem(draftStorageKey(session), JSON.stringify(session)); setSaveState('已保存本机'); }
      catch { setSaveState('未保存，请导出会话'); }
    }, 350);
    return () => clearTimeout(timer);
  }, [session]);

  const commit = useCallback(updater => setHistory(current => {
    if (!current) return current;
    const next = typeof updater === 'function' ? updater(current.present) : updater;
    return commitHistory(current, next);
  }), []);
  const undo = useCallback(() => setHistory(current => current ? undoHistory(current) : current), []);
  const redo = useCallback(() => setHistory(current => current ? redoHistory(current) : current), []);
  useEffect(() => {
    const listener = event => {
      if (event.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, [undo, redo]);

  const changeSet = useMemo(() => session ? buildChangeSet(session) : null, [session]);
  const prompt = useMemo(() => session ? generatePrompt(session) : '', [session]);
  const graph = session ? (mode === 'baseline' ? session.baseline.graph : session.draft) : null;
  const visibleGraph = useMemo(() => graph ? filterGraphLevel(graph, { overview, scope }) : null, [graph, overview, scope]);
  useEffect(() => {
    if (scope && graph && !graph.nodes.some(node => node.id === scope)) { setScope(''); setOverview(graph.nodes.some(node => node.parentId)); }
  }, [graph, scope]);
  const entity = graph ? (selected.type === 'node' ? graph.nodes.find(node => node.id === selected.id) : selected.type === 'edge' ? graph.edges.find(edge => edge.id === selected.id) : null) : null;
  const changedIds = useMemo(() => new Set(mode === 'draft' ? (changeSet?.changes || []).map(change => change.targetId) : []), [changeSet, mode]);
  const selectedTarget = entity ? selected : { type: 'graph', id: session?.id || '' };
  const allNotes = changeSet?.annotations || [];
  const selectedNotes = allNotes.filter(note => note.targetType === selectedTarget.type && note.targetId === selectedTarget.id);

  const updateNode = (id, fields) => commit(current => ({ ...current, draft: { ...current.draft, nodes: current.draft.nodes.map(node => node.id === id ? { ...node, ...fields } : node) } }));
  const updateEdge = (id, fields) => commit(current => ({ ...current, draft: { ...current.draft, edges: current.draft.edges.map(edge => edge.id === id ? { ...edge, ...fields } : edge) } }));
  const updateAnnotation = (id, text) => { if (!text.trim()) return notify('批注不能为空；不需要的批注可直接删除。', true); commit(current => ({ ...current, annotations: current.annotations.map(note => note.id === id ? { ...note, text } : note) })); };
  const deleteAnnotation = id => commit(current => ({ ...current, annotations: current.annotations.filter(note => note.id !== id) }));
  const addAnnotation = (text, intent) => {
    const targetLabel = selectedTarget.type === 'node' ? entity.title : selectedTarget.type === 'edge' ? `${graph.nodes.find(node => node.id === entity.source)?.title || entity.source} → ${graph.nodes.find(node => node.id === entity.target)?.title || entity.target}` : session.title;
    commit(current => ({ ...current, annotations: [...current.annotations, { id: uid('note'), targetType: selectedTarget.type, targetId: selectedTarget.id, targetLabel, text, intent, createdAt: new Date().toISOString(), baseRevision: current.baseline.id, sourceRefs: entity?.sourceRefs || [] }] }));
    notify('已添加批注。');
  };
  const addNode = () => {
    const id = uid('step');
    const newNode = { id, title: '新增步骤', purpose: '', kind: 'step', inputs: [], outputs: [], sourceRefs: [], evidence: 'proposed', ...(!overview && scope && session.draft.nodes.some(node => node.id === scope) ? { parentId: scope } : {}) };
    commit(current => ({ ...current, draft: { ...current.draft, nodes: [...current.draft.nodes, newNode] }, layout: { ...current.layout, [id]: { x: 100 + (current.draft.nodes.length % 3) * 310, y: Math.max(0, ...Object.values(current.layout).map(position => position.y)) + 190 } } }));
    setSelected({ type: 'node', id }); setMobilePanel('details');
  };
  const onConnect = useCallback(connection => {
    if (!connection.source || !connection.target || mode !== 'draft') return;
    const id = uid('edge');
    commit(current => ({ ...current, draft: { ...current.draft, edges: [...current.draft.edges, { id, source: connection.source, target: connection.target, label: '', evidence: 'proposed', sourceRefs: [] }] } }));
    setSelected({ type: 'edge', id });
  }, [commit, mode]);
  const onLayout = useCallback((id, position) => commit(current => ({ ...current, layout: { ...current.layout, [id]: position } })), [commit]);

  async function verifySources() {
    const baselineId = session.baseline.id;
    const sessionId = session.id;
    const root = session.target.root;
    const identity = { baselineId, sessionId, root };
    const stillCurrent = () => sessionRef.current?.baseline.id === baselineId && sessionRef.current?.id === sessionId && sessionRef.current?.target.root === root;
    setVerification({ status: 'checking', ...identity });
    try {
      const params = new URLSearchParams({ baseline: baselineId, session: sessionId, root });
      const response = await fetch(`/api/verify?${params}`);
      if (!response.ok) throw Error('暂不能核对');
      const result = await response.json();
      if (result.baselineId !== baselineId || result.sessionId !== sessionId || result.root !== root || !Array.isArray(result.files)) throw Error('服务返回的会话或基线不匹配');
      if (!stillCurrent()) return;
      setVerification({ ...result, status: result.ok && result.files.every(file => file.status === 'current') ? 'current' : 'changed' });
    } catch {
      if (!stillCurrent()) return;
      setVerification({ status: 'unverified', ...identity });
      notify('当前页面无法核对源文件，请用 CLI 的 verify 命令校验。', true);
    }
  }
  function download(content, suffix, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mime }); const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${session?.target.name || 'skill-graph'}${suffix}`; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('已发起下载；若浏览器未保存，可复制对应内容。');
  }
  async function copyContent(label, content) {
    try { await navigator.clipboard.writeText(content); notify(`已复制${label}。`); }
    catch {
      setExportPreview({ label, content });
      setReviewTab('export');
      notify('剪贴板不可用，已选中下方导出内容。请按 ⌘C / Ctrl+C 复制。', true);
    }
  }
  const copyPrompt = () => copyContent('优化提示词', prompt);
  async function importFile(event) {
    const file = event.target.files?.[0]; if (!file) return;
    try { loadSession(JSON.parse(await file.text())); notify('会话已导入。'); } catch (error) { notify(`导入失败：${error.message}`, true); }
    event.target.value = '';
  }
  function saveDraft() {
    try { localStorage.setItem(draftStorageKey(session), JSON.stringify(session)); setSaveState('已保存本机'); notify('草稿已保存到此浏览器。跨设备使用请导出会话。'); }
    catch { notify('浏览器无法保存，请导出会话 JSON。', true); }
  }

  const validVerification = session && verification.baselineId === session.baseline.id && verification.sessionId === session.id && verification.root === session.target.root ? verification : { status: 'unverified' };
  const title = selectedTarget.type === 'node' ? entity?.title : selectedTarget.type === 'edge' ? '连线与条件' : '全图备注';
  const nodeName = id => graph?.nodes.find(node => node.id === id)?.title || id;
  const depth = node => { let count = 0, cursor = node, seen = new Set(); while (cursor?.parentId && !seen.has(cursor.id) && count < 5) { seen.add(cursor.id); cursor = graph.nodes.find(item => item.id === cursor.parentId); count++; } return count; };
  const selectTreeNode = node => { setScope(node.parentId || ''); setOverview(!node.parentId && graph.nodes.some(item => item.parentId)); setSelected({ type: 'node', id: node.id }); };
  const enterSubflow = id => { setScope(id); setOverview(false); setSelected({ type: 'graph', id: session.id }); };

  return <div className="app-shell">
    <input type="file" accept="application/json,.json" hidden ref={inputRef} onChange={importFile} />
    <header className="app-header">
      <a className="brand" href="#" onClick={event => event.preventDefault()} aria-label="Skill Graph"><span className="brand-symbol"><Workflow size={23} /></span><span>Skill Graph<small>流程审视与优化</small></span></a>
      {session && <><div className="header-divider" /><div className="document-title"><strong title={session.title}>{session.target.name}</strong><span><span className="status-dot" />{saveState}</span></div><div className="mode-switch" aria-label="流程版本"><button className={mode === 'baseline' ? 'active' : ''} onClick={() => setMode('baseline')}>分析现状</button><button className={mode === 'draft' ? 'active' : ''} onClick={() => setMode('draft')}>修改草稿{changeSet.changes.length > 0 && <span>{changeSet.changes.length}</span>}</button></div></>}
      <div className="header-actions"><Button icon={Upload} onClick={() => inputRef.current.click()}>导入会话</Button>{session && <><Button icon={Download} onClick={() => setReviewTab(reviewTab === 'export' ? null : 'export')}>导出</Button><Button onClick={saveDraft}>保存草稿</Button><Button className="primary" icon={MessageSquare} onClick={() => setReviewTab(reviewTab === 'prompt' ? null : 'prompt')}>生成优化提示词</Button></>}</div>
    </header>
    {!session ? <main className="empty-workspace">{loading ? <div className="loading-state" aria-label="正在载入流程"><div /><div /><div /></div> : <div className="empty-content"><Workflow size={42} strokeWidth={1.3} /><h1>从一个 Skill，看清整个流程。</h1><p>导入分析后的会话，查看每个步骤的来源；在图上修改和批注，再把优化要求交给 Codex。</p><Button icon={Upload} className="primary" onClick={() => inputRef.current.click()}>导入会话 JSON</Button><p className="empty-help">在 Codex 中使用 Skill Graph 分析技能，或运行本地服务打开已生成的会话。</p><code>node skill-graph.mjs serve session.json</code></div>}</main> : <>
      <nav className="mobile-tabs"><Button icon={PanelLeft} className={mobilePanel === 'tree' ? 'active' : ''} onClick={() => setMobilePanel(mobilePanel === 'tree' ? 'canvas' : 'tree')}>流程目录</Button><Button icon={Workflow} className={mobilePanel === 'canvas' ? 'active' : ''} onClick={() => setMobilePanel('canvas')}>画布</Button><Button icon={PanelRight} className={mobilePanel === 'details' ? 'active' : ''} onClick={() => setMobilePanel(mobilePanel === 'details' ? 'canvas' : 'details')}>详情与批注</Button></nav>
      <main className={`workspace mobile-${mobilePanel}`}>
        <aside className="tree-panel" aria-label="流程目录">
          <div className="panel-heading"><h2>流程目录</h2><span>{graph.nodes.length}</span></div>
          <label className="search-box"><Search size={15} /><input placeholder="搜索步骤" aria-label="搜索步骤" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-button" onClick={() => setQuery('')} aria-label="清空搜索"><X size={13} /></button>}</label>
          <button className={`tree-all ${overview ? 'active' : ''}`} onClick={() => { setSelected({ type: 'graph', id: session.id }); setScope(''); setOverview(true); }}><Layers size={16} /><span>主流程总览</span><span>{graph.nodes.filter(node => !node.parentId).length} 个步骤</span></button>
          <button className={`tree-all ${!overview && !scope ? 'active' : ''}`} onClick={() => { setSelected({ type: 'graph', id: session.id }); setScope(''); setOverview(false); }}><Workflow size={16} /><span>全部流程</span><span>{graph.nodes.length} 个步骤</span></button>
          <div className="tree-list">{graph.nodes.filter(node => `${node.title} ${node.purpose}`.toLowerCase().includes(query.toLowerCase())).map(node => { const Icon = (kinds[node.kind] || kinds.step)[1]; return <button key={node.id} className={`tree-item ${selected.type === 'node' && selected.id === node.id ? 'active' : ''}`} style={{ paddingInlineStart: 12 + depth(node) * 14 }} onClick={() => selectTreeNode(node)}><Icon size={15} /><span>{node.title}</span>{changedIds.has(node.id) && <i className="change-dot" />}</button>; })}{query && !graph.nodes.some(node => `${node.title} ${node.purpose}`.toLowerCase().includes(query.toLowerCase())) && <p className="muted small no-results">没有匹配的步骤，试试其他关键词。</p>}</div>
          <div className="tree-bottom"><label className="field"><span>显示范围</span><select aria-label="显示范围" value={JSON.stringify({ overview, scope })} onChange={event => { const view = JSON.parse(event.target.value); setOverview(view.overview); setScope(view.scope); setSelected({ type: 'graph', id: session.id }); }}><option value={JSON.stringify({ overview: true, scope: '' })}>主流程总览</option><option value={JSON.stringify({ overview: false, scope: '' })}>全部流程</option>{graph.nodes.filter(node => node.kind === 'group' || graph.nodes.some(child => child.parentId === node.id)).map(node => <option key={node.id} value={JSON.stringify({ overview: false, scope: node.id })}>{node.title} · 子流程</option>)}</select></label><Button icon={Plus} disabled={mode !== 'draft'} onClick={addNode}>新增步骤</Button></div>
          <div className="coverage-note"><span><FileText size={14} />分析覆盖</span><strong>{session.coverage.reviewedFiles.length} 个文件</strong>{session.coverage.excluded.length > 0 && <small>{session.coverage.excluded.length} 项未覆盖，详见全图信息</small>}</div>
        </aside>
        <section className="canvas-panel" aria-label="流程画布">
          <div className="canvas-toolbar"><div className="breadcrumb"><span>{session.target.name}</span><ChevronRight size={13} /><strong>{overview ? '主流程总览' : scope ? `${nodeName(scope)} · 子流程` : '全部流程'}</strong></div><div className="history-controls"><button className="icon-button" title="撤销 ⌘Z" aria-label="撤销" disabled={!history.past.length} onClick={undo}><Undo2 size={17} /></button><button className="icon-button" title="重做 ⇧⌘Z" aria-label="重做" disabled={!history.future.length} onClick={redo}><Redo2 size={17} /></button></div></div>
          <div className="canvas"><GraphCanvas graph={graph} session={session} selected={selectedTarget} onSelect={setSelected} onLayout={onLayout} onConnect={onConnect} readonly={mode !== 'draft'} changedIds={changedIds} scope={scope} overview={overview} />{visibleGraph.nodes.length === 0 && <div className="canvas-empty"><p>{scope ? '此子流程还没有步骤' : '当前范围还没有步骤'}</p><Button icon={Plus} onClick={addNode} disabled={mode !== 'draft'}>新增第一个步骤</Button></div>}</div>
          <div className="canvas-status"><span><span className="legend-dot" />{mode === 'baseline' ? '分析时的流程' : '当前修改草稿'}</span><span>拖动整理布局 · 从节点圆点拖出连线</span><button onClick={() => setReviewTab(reviewTab === 'changes' ? null : 'changes')}>{changeSet.changes.length} 项流程改动 · {session.annotations.length} 条批注 <ChevronRight size={13} /></button></div>
        </section>
        <aside className="detail-panel" aria-label="详情与批注">
          <div className="detail-title"><div><span className="muted small">{selectedTarget.type === 'node' ? '步骤详情' : selectedTarget.type === 'edge' ? '连接详情' : '流程概览'}</span><h2>{title}</h2></div>{selectedTarget.type !== 'graph' && <button className="icon-button" aria-label="关闭对象详情" title="关闭对象详情" onClick={() => setSelected({ type: 'graph', id: session.id })}><X size={17} /></button>}</div>
          <div className="detail-scroll">
            {mode === 'baseline' && <p className="read-only-note">现状来自分析基线。切换到修改草稿后可编辑步骤和连线。</p>}
            {selectedTarget.type === 'node' && <><div className="evidence-line"><span className={`evidence evidence-${entity.evidence}`}>{evidenceNames[entity.evidence]}</span><code title={entity.id}>{entity.id}</code></div>{(entity.kind === 'group' || graph.nodes.some(node => node.parentId === entity.id)) && <Button className="subflow-button" icon={Layers} onClick={() => enterSubflow(entity.id)}>查看子流程 · {graph.nodes.filter(node => node.parentId === entity.id).length} 个步骤<ChevronRight size={14} /></Button>}<Field label="显示名称" value={entity.title} disabled={mode !== 'draft'} hint="仅修改名称不会生成流程变更要求。" onCommit={title => title.trim() ? updateNode(entity.id, { title }) : notify('步骤名称不能为空。', true)} /><label className="field"><span>步骤类型</span><select aria-label="步骤类型" value={entity.kind} disabled={mode !== 'draft'} onChange={event => updateNode(entity.id, { kind: event.target.value })}>{Object.entries(kinds).map(([id, [name]]) => <option key={id} value={id}>{name}</option>)}</select></label><Field label="职责与行为" value={entity.purpose} disabled={mode !== 'draft'} onCommit={purpose => updateNode(entity.id, { purpose })} multiline rows={4} /><div className="io-fields"><Field label="输入（每行一项）" value={entity.inputs.join('\n')} disabled={mode !== 'draft'} onCommit={value => updateNode(entity.id, { inputs: lines(value) })} multiline rows={2} /><Field label="输出（每行一项）" value={entity.outputs.join('\n')} disabled={mode !== 'draft'} onCommit={value => updateNode(entity.id, { outputs: lines(value) })} multiline rows={2} /></div><section className="detail-section"><h3><FileText size={15} />来源定位</h3><SourceList refs={entity.sourceRefs} /></section><section className="detail-section"><h3>上下游</h3><div className="related-nodes">{graph.edges.filter(edge => edge.source === entity.id || edge.target === entity.id).map(edge => <button key={edge.id} onClick={() => setSelected({ type: 'edge', id: edge.id })}><span>{nodeName(edge.source)}</span><ArrowRight size={13} /><span>{nodeName(edge.target)}</span>{edge.label && <small>{edge.label}</small>}</button>)}{!graph.edges.some(edge => edge.source === entity.id || edge.target === entity.id) && <p className="muted small">暂无连线。从节点下方圆点拖向另一步骤可建立连接。</p>}</div></section><Button className="danger subtle" icon={Trash2} disabled={mode !== 'draft'} onClick={() => { commit(current => removeNode(current, entity.id)); setSelected({ type: 'graph', id: session.id }); notify('已从草稿移除步骤及其连线，批注已保留，可撤销。'); }}>从草稿移除步骤</Button></>}
            {selectedTarget.type === 'edge' && <><div className="edge-route"><strong>{nodeName(entity.source)}</strong><ArrowRight size={17} /><strong>{nodeName(entity.target)}</strong></div><Field label="分支条件 / 连线说明" value={entity.label} disabled={mode !== 'draft'} onCommit={label => updateEdge(entity.id, { label })} multiline rows={3} /><label className="field"><span>起点</span><select aria-label="连线起点" value={entity.source} disabled={mode !== 'draft'} onChange={event => updateEdge(entity.id, { source: event.target.value })}>{graph.nodes.map(node => <option value={node.id} key={node.id}>{node.title}</option>)}</select></label><label className="field"><span>终点</span><select aria-label="连线终点" value={entity.target} disabled={mode !== 'draft'} onChange={event => updateEdge(entity.id, { target: event.target.value })}>{graph.nodes.map(node => <option value={node.id} key={node.id}>{node.title}</option>)}</select></label><section className="detail-section"><h3>来源定位</h3><SourceList refs={entity.sourceRefs} /></section><Button className="danger subtle" icon={Trash2} disabled={mode !== 'draft'} onClick={() => { commit(current => ({ ...current, draft: { ...current.draft, edges: current.draft.edges.filter(edge => edge.id !== entity.id) } })); setSelected({ type: 'graph', id: session.id }); notify('已移除连线，相关批注仍保留。'); }}>移除连线</Button></>}
            {selectedTarget.type === 'graph' && <><p className="overview-description">{session.title}</p><div className="baseline-info"><span>分析基线</span><code>{session.baseline.id}</code><small>{new Date(session.baseline.capturedAt).toLocaleString('zh-CN')}</small></div><div className={`verification verification-${validVerification.status}`}><div><ShieldCheck size={16} /><strong>{validVerification.status === 'current' ? '源文件已核对' : validVerification.status === 'changed' ? '源文件有变化' : validVerification.status === 'checking' ? '正在核对源文件…' : '源文件尚未核对'}</strong></div><p>{validVerification.status === 'current' ? '本次核对与当前分析基线一致。执行修改前仍需重新校验。' : validVerification.status === 'changed' ? '请重新分析变化的文件，再确认批注归属。' : '导出的请求包含基线信息，执行前需要核对实际文件。'}</p><Button icon={ShieldCheck} onClick={verifySources} disabled={validVerification.status === 'checking'}>核对源文件</Button>{validVerification.files?.filter(file => file.status !== 'current').map(file => <p key={file.path} className="small">{file.path} · {({ changed: '已变化', missing: '不存在', unreadable: '无法读取' })[file.status]}</p>)}</div><details className="coverage-details"><summary>分析范围与来源 <span>{session.coverage.reviewedFiles.length} 个文件</span></summary>{session.coverage.reviewedFiles.map((file, index) => <p key={index}><FileText size={12} />{typeof file === 'string' ? file : file.path}</p>)}{session.coverage.excluded.map((file, index) => <p key={`excluded-${index}`} className="warning-text">{file.path}：{file.reason}</p>)}</details></>}
            <section className="detail-section annotation-section"><h3><MessageSquare size={16} />{selectedTarget.type === 'graph' ? '全图批注' : '对象批注'}<span>{selectedNotes.length}</span></h3><AnnotationList notes={selectedNotes} onUpdate={updateAnnotation} onDelete={deleteAnnotation} /><AnnotationComposer target={selectedTarget} onAdd={addAnnotation} /></section>
            {selectedTarget.type === 'graph' && <><section className="detail-section"><h3>优化约束</h3><Field label="必须保留的行为（每行一项）" value={session.constraints.join('\n')} onCommit={value => commit(current => ({ ...current, constraints: lines(value) }))} multiline rows={3} placeholder="例如：保持现有报告格式" /><Field label="验收条件（每行一项）" value={session.acceptanceCriteria.join('\n')} onCommit={value => commit(current => ({ ...current, acceptanceCriteria: lines(value) }))} multiline rows={3} placeholder="例如：无效输入不会生成空报告" /></section>{allNotes.some(note => note.orphaned) && <section className="detail-section"><h3><AlertCircle size={15} />已移除对象的批注</h3><p className="muted small">原始对象和来源仍保留在修改包中，执行前需确认归属。</p><AnnotationList notes={allNotes.filter(note => note.orphaned)} onUpdate={updateAnnotation} onDelete={deleteAnnotation} showTargets /></section>}</>}
          </div>
        </aside>
      </main>
      {reviewTab && <section className="review-panel" aria-label="改动与导出"><div className="review-heading"><div className="review-tabs"><button className={reviewTab === 'changes' ? 'active' : ''} onClick={() => setReviewTab('changes')}>改动清单 <span>{changeSet.changes.length}</span></button><button className={reviewTab === 'prompt' ? 'active' : ''} onClick={() => setReviewTab('prompt')}>优化提示词</button><button className={reviewTab === 'export' ? 'active' : ''} onClick={() => setReviewTab('export')}>导出文件</button></div><button className="icon-button" aria-label="关闭改动与导出" onClick={() => setReviewTab(null)}><X size={18} /></button></div>
        {reviewTab === 'prompt' && <div className="prompt-review"><div className="review-actions"><p>包含来源、净差异和批注原话。问题与建议分别保留。</p><div><Button icon={Download} onClick={() => download(prompt, '-优化提示词.md', 'text/markdown;charset=utf-8')}>下载 Markdown</Button><Button icon={Copy} className="primary" onClick={copyPrompt}>复制提示词</Button></div></div><pre tabIndex="0" aria-label="优化提示词预览">{prompt}</pre></div>}
        {reviewTab === 'changes' && <div className="changes-review"><div className="change-list">{changeSet.changes.length === 0 ? <div className="empty-changes"><Check size={21} /><strong>没有流程结构变化</strong><p>节点移动与显示名称调整只影响图的展示。批注仍会完整导出。</p></div> : changeSet.changes.map((change, index) => <article className="change-row" key={`${change.targetId}-${index}`}><span className={`change-type ${change.type.endsWith('removed') ? 'removed' : ''}`}>{changeNames[change.type] || change.type}</span><div><strong>{change.after?.title || change.before?.title || change.targetId}</strong><details><summary>查看修改前后</summary><div className="before-after"><div><span>修改前</span><pre>{JSON.stringify(change.before || null, null, 2)}</pre></div><div><span>修改后</span><pre>{JSON.stringify(change.after || null, null, 2)}</pre></div></div></details></div></article>)}</div><div className="review-notes"><h3>全部批注 <span>{allNotes.length}</span></h3><AnnotationList notes={allNotes} onUpdate={updateAnnotation} onDelete={deleteAnnotation} showTargets />{!allNotes.length && <p className="muted">选择步骤或连线，在右侧添加你的修改要求。</p>}</div></div>}
        {reviewTab === 'export' && <div className="export-list">
          {exportPreview && <section className="export-preview"><div><h3>{exportPreview.label} · 手动复制</h3><Button onClick={() => { exportPreviewRef.current?.focus(); exportPreviewRef.current?.select(); }}>全选内容</Button><button className="icon-button" aria-label="关闭导出内容预览" onClick={() => setExportPreview(null)}><X size={16} /></button></div><p>内容已选中。按 ⌘C / Ctrl+C 复制，然后粘贴并保存为对应文件。</p><textarea ref={exportPreviewRef} aria-label="导出内容预览" readOnly rows={8} value={exportPreview.content} onFocus={event => event.currentTarget.select()} /></section>}
          <div><FileText size={22} /><section><h3>完整会话</h3><p>保存流程、来源、布局及批注，可再次导入继续编辑。</p></section><div className="export-buttons"><Button icon={Copy} onClick={() => copyContent('会话 JSON', JSON.stringify(session, null, 2))}>复制会话 JSON</Button><Button icon={Download} onClick={() => download(JSON.stringify(session, null, 2), '-session.json', 'application/json')}>下载会话 JSON</Button></div></div>
          <div><MessageSquare size={22} /><section><h3>优化修改包</h3><p>供 Codex 读取的结构化修改要求、基线和来源。</p></section><div className="export-buttons"><Button icon={Copy} onClick={() => copyContent('修改包 JSON', JSON.stringify(changeSet, null, 2))}>复制修改包 JSON</Button><Button icon={Download} onClick={() => download(JSON.stringify(changeSet, null, 2), '-changes.json', 'application/json')}>下载修改包 JSON</Button></div></div>
          <div><Workflow size={22} /><section><h3>Mermaid 流程图</h3><p>导出{mode === 'draft' ? '修改草稿' : '分析现状'}用于文档展示。备注与布局保存在完整会话中。</p></section><div className="export-buttons"><Button icon={Copy} onClick={() => copyContent('Mermaid', toMermaid(graph))}>复制 Mermaid</Button><Button icon={Download} onClick={() => download(toMermaid(graph), `-${mode}.mmd`)}>下载 Mermaid</Button></div></div>
          <div><Copy size={22} /><section><h3>优化提示词</h3><p>可读的 Markdown，交给 Codex 修改和验证目标 Skill。</p></section><div className="export-buttons"><Button icon={Copy} onClick={copyPrompt}>复制提示词</Button><Button icon={Download} onClick={() => download(prompt, '-优化提示词.md', 'text/markdown;charset=utf-8')}>下载 Markdown</Button></div></div>
        </div>}
      </section>}
    </>}
    {message && <div className={`toast ${message.error ? 'toast-error' : ''}`} role={message.error ? 'alert' : 'status'}>{message.error ? <AlertCircle size={17} /> : <Check size={17} />}<span>{message.text}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setMessage(null)}><X size={15} /></button></div>}
  </div>;
}
