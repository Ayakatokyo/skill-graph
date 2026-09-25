import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,symlink,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inventory, readSource, createSession, verifySession, refreshSession} from '../skill-graph/scripts/lib/files.mjs';
async function fixture(t){const dir=await mkdtemp(path.join(os.tmpdir(),'skill-graph-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(path.join(dir,'SKILL.md'),'# Sample\nRead input.\nIf missing, ask again.\nWrite report.\n');await mkdir(path.join(dir,'scripts'));await writeFile(path.join(dir,'scripts/run.py'),'print("ok")\n');return dir;}
function analysis(){return {title:'样例技能',graph:{nodes:[{id:'read',title:'读取',purpose:'读取输入，失败时重新询问',kind:'input',inputs:['文件'],outputs:['内容'],evidence:'verified',sourceRefs:[{path:'SKILL.md',anchor:'Sample',startLine:2,endLine:3}]}],edges:[]},constraints:[],acceptanceCriteria:[],coverage:{reviewedFiles:['SKILL.md','scripts/run.py'],excluded:[]}};}
test('inventory hashes text files while excluding dependency and symlink content',async t=>{const root=await fixture(t);await mkdir(path.join(root,'node_modules'));await writeFile(path.join(root,'node_modules','private.txt'),'hidden');await symlink('/etc',path.join(root,'escape'));const result=await inventory(root);assert.deepEqual(result.files.map(f=>f.path),['SKILL.md','scripts/run.py']);assert.match(result.files[0].sha256,/^[a-f0-9]{64}$/);assert.ok(result.excluded.some(f=>f.path==='escape'));});
test('inventory excludes custom and nested Python environments by file marker without excluding normal scripts',async t=>{
  const root=await fixture(t);
  for(const environment of ['.venv313','tools/custom-python']) {
    await mkdir(path.join(root,environment,'lib'),{recursive:true});
    await writeFile(path.join(root,environment,'pyvenv.cfg'),'home = /usr/bin\n');
    await writeFile(path.join(root,environment,'lib','dependency.py'),'print("dependency")\n');
  }
  await mkdir(path.join(root,'scripts','pyvenv.cfg'));
  await writeFile(path.join(root,'scripts','pyvenv.cfg','README.md'),'A normal directory, not an environment marker.\n');
  await mkdir(path.join(root,'tools','normal-scripts'));
  await writeFile(path.join(root,'tools','normal-scripts','helper.py'),'print("helper")\n');
  const result=await inventory(root);
  assert.deepEqual(result.files.map(file=>file.path),['SKILL.md','scripts/pyvenv.cfg/README.md','scripts/run.py','tools/normal-scripts/helper.py']);
  for(const environment of ['.venv313','tools/custom-python']) assert.ok(result.excluded.some(file=>file.path===environment&&file.reason==='Python虚拟环境'));
});
test('inventory excludes Python tool caches at any depth',async t=>{
  const root=await fixture(t);
  for(const cache of ['.pytest_cache','scripts/.mypy_cache','scripts/.ruff_cache']) {
    await mkdir(path.join(root,cache),{recursive:true});
    await writeFile(path.join(root,cache,'data.json'),'{}');
  }
  const result=await inventory(root);
  assert.deepEqual(result.files.map(file=>file.path),['SKILL.md','scripts/run.py']);
  for(const cache of ['.pytest_cache','scripts/.mypy_cache','scripts/.ruff_cache']) assert.ok(result.excluded.some(file=>file.path===cache));
});
test('source references read exact lines and reject traversal, binary data and symlinks outside root',async t=>{const root=await fixture(t);const ref=await readSource(root,{path:'SKILL.md',anchor:'Sample',startLine:2,endLine:3});assert.equal(ref.excerpt,'Read input.\nIf missing, ask again.');await assert.rejects(readSource(root,{path:'../secret',startLine:1,endLine:1}),/目录|路径/);await symlink('/etc/passwd',path.join(root,'bad.txt'));await assert.rejects(readSource(root,{path:'bad.txt',startLine:1,endLine:1}),/目录|链接/);await writeFile(path.join(root,'binary.txt'),Buffer.from([0xff,0x00]));await assert.rejects(readSource(root,{path:'binary.txt',startLine:1,endLine:1}),/文本|编码/);await assert.rejects(readSource(root,{path:'SKILL.md',startLine:1,endLine:99}),/行/);});
test('create fingerprints all reviewed files; verify detects a changed script even when graph only cites SKILL',async t=>{const root=await fixture(t);const session=await createSession(root,analysis());assert.equal(session.baseline.files.length,2);assert.equal(session.baseline.graph.nodes[0].sourceRefs[0].excerpt,'Read input.\nIf missing, ask again.');assert.equal((await verifySession(session)).ok,true);await writeFile(path.join(root,'scripts/run.py'),'print("changed")\n');let result=await verifySession(session);assert.equal(result.ok,false);assert.equal(result.files.find(f=>f.path==='scripts/run.py').status,'changed');assert.equal(session.draft.nodes[0].purpose,analysis().graph.nodes[0].purpose);});
test('create refuses unsupported line evidence and records missing source file',async t=>{const root=await fixture(t);const a=analysis();a.graph.nodes[0].sourceRefs[0].path='missing.md';await assert.rejects(createSession(root,a),/missing|不存在|ENOENT/);});
test('refresh produces actual new baseline, preserves matched layout and keeps unmatched annotations',async t=>{const root=await fixture(t);const s=await createSession(root,analysis());s.layout.read={x:35,y:48};s.annotations=[{id:'a1',targetType:'node',targetId:'read',targetLabel:'读取',text:'保留失败处理',intent:'change',createdAt:new Date().toISOString(),sourceRefs:s.draft.nodes[0].sourceRefs}];const next=analysis();next.graph.nodes[0].id='new_read';const refreshed=await refreshSession(s,next);assert.notEqual(refreshed.baseline.id,s.baseline.id);assert.equal(refreshed.annotations[0].targetId,'read');assert.equal(refreshed.draft.nodes[0].id,'new_read');assert.equal(refreshed.id,s.id);});

test('verify reports missing entry and deleted root as stale files instead of command failure',async t=>{const root=await fixture(t);const session=await createSession(root,analysis());await rm(path.join(root,'SKILL.md'));let result=await verifySession(session);assert.equal(result.ok,false);assert.equal(result.files.find(f=>f.path==='SKILL.md').status,'missing');assert.equal(result.sessionId,session.id);await rm(root,{recursive:true});result=await verifySession(session);assert.equal(result.ok,false);assert.ok(result.files.every(f=>f.status==='missing'));});
test('verify rejects a source excerpt that disagrees with the unchanged file',async t=>{const root=await fixture(t);const session=await createSession(root,analysis());session.baseline.graph.nodes[0].sourceRefs[0].excerpt='This line was never in the source.';const result=await verifySession(session);assert.equal(result.ok,false);assert.equal(result.files.find(file=>file.path==='SKILL.md').status,'changed');assert.match(result.files[0].message,/摘录/);});
test('refresh preserves an older annotation baseline instead of reactivating it',async t=>{const root=await fixture(t);const session=await createSession(root,analysis());session.annotations=[{id:'old',targetType:'node',targetId:'read',targetLabel:'读取',text:'先检查旧版本要求',intent:'change',createdAt:new Date().toISOString(),sourceRefs:[],baselineId:'older-version'}];const refreshed=await refreshSession(session,analysis());assert.equal(refreshed.annotations[0].baseRevision,'older-version');});
