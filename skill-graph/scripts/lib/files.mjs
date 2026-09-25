import {readFile, readdir, realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

const TEXT_EXT = new Set(['.md','.txt','.py','.js','.mjs','.cjs','.ts','.tsx','.jsx','.json','.yaml','.yml','.toml','.sh','.css','.html','.xml','.ini','.cfg','.csv']);
const SKIP_DIRS = new Set(['.git','node_modules','__pycache__','.venv','venv','dist','build','.cache','.pytest_cache','.mypy_cache','.ruff_cache']);
const MAX_BYTES = 2 * 1024 * 1024;
export const hash = value => createHash('sha256').update(value).digest('hex');
const inside = (root, file) => file === root || file.startsWith(root + path.sep);

export function relativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || path.isAbsolute(value) || /^[a-z]:/i.test(value) || value.split('/').some(p=>p==='..'||p==='.'||!p)) {
    throw new Error(`来源路径必须位于 Skill 目录内：${String(value)}`);
  }
  return value;
}

export async function skillRoot(root) {
  const resolved = await realpath(path.resolve(root));
  const entry = await realpath(path.join(resolved,'SKILL.md'));
  if (!inside(resolved,entry) || !(await stat(entry)).isFile()) throw new Error('目标目录缺少有效的 SKILL.md');
  return resolved;
}

async function readText(root, file) {
  relativePath(file);
  const resolved = await realpath(path.join(root,file));
  if (!inside(root,resolved)) throw new Error(`符号链接指向 Skill 目录外：${file}`);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error(`来源不是文件：${file}`);
  if (info.size > MAX_BYTES) throw new Error(`文本文件超过 2 MiB，请缩小分析范围：${file}`);
  const bytes = await readFile(resolved);
  let content;
  try { content = new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
  catch { throw new Error(`来源不是有效 UTF-8 文本：${file}`); }
  if (content.includes('\0')) throw new Error(`来源包含二进制内容：${file}`);
  return {content,sha256:hash(bytes),bytes:bytes.length};
}

export async function inventory(root) {
  root = await skillRoot(root);
  const files=[], excluded=[];
  let count=0;
  async function walk(prefix) {
    const entries = await readdir(path.join(root,prefix),{withFileTypes:true});
    entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
    for (const entry of entries) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (++count>10000) throw new Error('目录条目超过 10000，请指定更小的单 Skill 目录');
      if (entry.isSymbolicLink()) {excluded.push({path:name,reason:'符号链接未跟随'});continue;}
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) excluded.push({path:name,reason:'依赖、缓存或构建目录'});
        else {
          const marker=await stat(path.join(root,name,'pyvenv.cfg')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
          if(marker?.isFile()) excluded.push({path:name,reason:'Python虚拟环境'});
          else await walk(name);
        }
      } else if (entry.isFile()) {
        if (!TEXT_EXT.has(path.extname(entry.name).toLowerCase()) && !['LICENSE','Dockerfile','Makefile'].includes(entry.name)) {excluded.push({path:name,reason:'非支持的文本类型'});continue;}
        try {const data=await readText(root,name);files.push({path:name,bytes:data.bytes,sha256:data.sha256});}
        catch(error){excluded.push({path:name,reason:error.message});}
      }
    }
  }
  await walk('');
  files.sort((a,b)=>a.path<b.path?-1:1);
  return {root,files,excluded};
}

export async function readSource(root, ref) {
  if (!ref || !Number.isInteger(ref.startLine) || !Number.isInteger(ref.endLine) || ref.startLine<1 || ref.endLine<ref.startLine) throw new Error('来源行号必须是有效的起止正整数');
  root=await realpath(path.resolve(root));
  const data=await readText(root,ref.path);
  const lines=data.content.split(/\r?\n/);if(lines.at(-1)==='')lines.pop();
  if(ref.endLine>lines.length)throw new Error(`来源行号超出文件范围：${ref.path} (${lines.length} 行)`);
  const excerpt=lines.slice(ref.startLine-1,ref.endLine).join('\n');
  if(ref.excerpt!==undefined && ref.excerpt!==excerpt)throw new Error(`来源摘录与实际文件不一致：${ref.path}:${ref.startLine}`);
  if(ref.sha256!==undefined && ref.sha256!==data.sha256)throw new Error(`来源指纹已过期：${ref.path}`);
  return {...ref,anchor:ref.anchor??'',excerpt,sha256:data.sha256};
}

export async function createSession(root, analysis) {
  root=await skillRoot(root);
  if(!analysis || !analysis.graph || !Array.isArray(analysis.graph.nodes) || !Array.isArray(analysis.graph.edges))throw new Error('分析文件需要 graph.nodes 和 graph.edges');
  if(!analysis.coverage || !Array.isArray(analysis.coverage.reviewedFiles) || !analysis.coverage.reviewedFiles.includes('SKILL.md'))throw new Error('coverage.reviewedFiles 必须包含已阅读的 SKILL.md');
  const graph=structuredClone(analysis.graph);
  const reviewed=new Set(analysis.coverage.reviewedFiles);
  for(const item of [...graph.nodes,...graph.edges]) {
    if(!Array.isArray(item.sourceRefs))throw new Error(`节点或连线 ${item.id} 缺少 sourceRefs 数组`);
    item.sourceRefs=await Promise.all(item.sourceRefs.map(ref=>readSource(root,ref)));
    for(const ref of item.sourceRefs)reviewed.add(ref.path);
    if(item.evidence==='verified' && !item.sourceRefs.length)throw new Error(`已核实的步骤或连线必须有来源：${item.id}`);
  }
  const files=[];
  for(const p of [...reviewed].sort()){const data=await readText(root,p);files.push({path:p,sha256:data.sha256});}
  const now=new Date().toISOString();
  const session={schemaVersion:1,id:randomUUID(),title:analysis.title||path.basename(root),createdAt:now,target:{name:path.basename(root),root},baseline:{id:hash(JSON.stringify({files,graph})),capturedAt:now,files,graph},draft:structuredClone(graph),annotations:[],constraints:analysis.constraints??[],acceptanceCriteria:analysis.acceptanceCriteria??[],layout:analysis.layout??initialLayout(graph),coverage:{...analysis.coverage,reviewedFiles:[...reviewed].sort(),excluded:analysis.coverage.excluded??[]}};
  const {validateSession}=await import('./graph.mjs');
  return validateSession(session);
}

function initialLayout(graph) {
  const remaining=new Set(graph.nodes.map(n=>n.id)),depth=new Map();
  const incoming=new Map(graph.nodes.map(n=>[n.id,graph.edges.filter(e=>e.target===n.id).map(e=>e.source)]));
  for(let pass=0;pass<=graph.nodes.length && remaining.size;pass++) {
    let changed=false;
    for(const id of remaining) {
      const parents=incoming.get(id);
      if(parents.every(p=>depth.has(p))) {depth.set(id,parents.length?Math.max(...parents.map(p=>depth.get(p)))+1:0);remaining.delete(id);changed=true;}
    }
    if(!changed){const id=remaining.values().next().value;depth.set(id,depth.size?Math.max(...depth.values())+1:0);remaining.delete(id);}
  }
  const rows=new Map();const layout=Object.create(null);
  for(const node of graph.nodes){const d=depth.get(node.id)||0,index=rows.get(d)||0;layout[node.id]={x:80+index*330,y:70+d*175};rows.set(d,index+1);}
  return layout;
}

export async function verifySession(session, overrideRoot) {
  const {validateSession}=await import('./graph.mjs');validateSession(session);
  let root=path.resolve(overrideRoot||session.target.root);
  try {root=await realpath(root);} catch(error) {if(error.code!=='ENOENT')throw error;}
  const files=[];
  for(const file of session.baseline.files) {
    try {const actual=await readText(root,file.path);files.push({path:file.path,status:actual.sha256===file.sha256?'current':'changed',expectedSha256:file.sha256,actualSha256:actual.sha256});}
    catch(error){files.push({path:file.path,status:error.code==='ENOENT'?'missing':'unreadable',message:error.message});}
  }
  const byPath=new Map(files.map(file=>[file.path,file]));
  for(const item of [...session.baseline.graph.nodes,...session.baseline.graph.edges]) {
    for(const ref of item.sourceRefs) {
      const result=byPath.get(ref.path);
      if(result?.status!=='current')continue;
      try {await readSource(root,ref);}
      catch(error){result.status='changed';result.reason='source-evidence-mismatch';result.message=error.message;}
    }
  }
  return {ok:files.every(f=>f.status==='current'),sessionId:session.id,baselineId:session.baseline.id,root,checkedAt:new Date().toISOString(),files};
}

export async function refreshSession(previous, analysis, overrideRoot) {
  const {validateSession}=await import('./graph.mjs');validateSession(previous);
  const next=await createSession(overrideRoot||previous.target.root,analysis);
  next.id=previous.id;
  next.createdAt=previous.createdAt;
  const oldIds=new Set(previous.baseline.graph.nodes.map(n=>n.id));
  for(const node of next.draft.nodes)if(oldIds.has(node.id)&&previous.layout[node.id])next.layout[node.id]=structuredClone(previous.layout[node.id]);
  next.annotations=previous.annotations.map(a=>({...structuredClone(a),baseRevision:a.baseRevision??a.baselineId??a.binding?.baselineId??previous.baseline.id}));
  next.previousBaselineId=previous.baseline.id;
  return validateSession(next);
}
