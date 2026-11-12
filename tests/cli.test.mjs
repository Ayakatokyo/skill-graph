import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir,realpath,symlink} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer,standalonePage} from '../skill-graph/scripts/skill-graph.mjs';
const exec=promisify(execFile),cli=path.resolve('skill-graph/scripts/skill-graph.mjs');
async function setup(t){const temp=await mkdtemp(path.join(os.tmpdir(),'skillgraph-cli-'));t.after(()=>rm(temp,{recursive:true,force:true}));const root=path.join(temp,'target');await mkdir(root);await writeFile(path.join(root,'SKILL.md'),'# Entry\nRead the file.\n');const analysis={title:'真实输入',graph:{nodes:[{id:'read',title:'读取文件',purpose:'读取有效文件',kind:'step',inputs:[],outputs:[],sourceRefs:[{path:'SKILL.md',anchor:'Entry',startLine:1,endLine:2}],evidence:'verified'}],edges:[]},coverage:{reviewedFiles:['SKILL.md'],excluded:[]},constraints:[],acceptanceCriteria:[]};const input=path.join(temp,'analysis.json');await writeFile(input,JSON.stringify(analysis));return {temp,root,input,session:path.join(temp,'session.json')};}
test('CLI creates validated session, exports matching artifacts and returns exit 2 on changed baseline',async t=>{const f=await setup(t);await exec(process.execPath,[cli,'create',f.root,'--analysis',f.input,'--out',f.session]);const s=JSON.parse(await readFile(f.session,'utf8'));assert.equal(s.target.root,await realpath(f.root));s.annotations.push({id:'note',targetType:'node',targetId:'read',targetLabel:'读取文件',text:'增加缺失文件提示',intent:'change',createdAt:new Date().toISOString(),sourceRefs:s.draft.nodes[0].sourceRefs});await writeFile(f.session,JSON.stringify(s));const out=path.join(f.temp,'exports');await exec(process.execPath,[cli,'export',f.session,'--out',out]);const prompt=await readFile(path.join(out,'prompt.md'),'utf8');assert.ok(prompt.includes('增加缺失文件提示'));const changes=JSON.parse(await readFile(path.join(out,'changes.json'),'utf8'));assert.equal(changes.baselineId,s.baseline.id);assert.ok((await readFile(path.join(out,'flow.mmd'),'utf8')).startsWith('flowchart'));await writeFile(path.join(f.root,'SKILL.md'),'changed\n');await assert.rejects(exec(process.execPath,[cli,'verify',f.session]),e=>e.code===2&&e.stdout.includes('changed'));});
test('server serves scoped session, rejects foreign host/method and marks stale source',async t=>{const f=await setup(t);await exec(process.execPath,[cli,'create',f.root,'--analysis',f.input,'--out',f.session]);const s=JSON.parse(await readFile(f.session,'utf8'));const viewer=path.join(f.temp,'viewer');await mkdir(viewer);await writeFile(path.join(viewer,'index.html'),'<!doctype html><title>Skill Graph</title>');const server=await startServer(s,{port:0,viewerDir:viewer});t.after(()=>new Promise(r=>server.close(r)));const url=`http://127.0.0.1:${server.address().port}`;assert.equal((await fetch(url+'/api/session')).status,200);assert.equal((await fetch(url+'/api/session',{method:'POST'})).status,405);assert.equal(await new Promise((resolve,reject)=>{http.get(url+'/api/session',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);}),403);assert.equal((await fetch(url+'/api/session',{headers:{Origin:'https://evil.example'}})).status,403);assert.equal((await fetch(url+'/api/verify?baseline=wrong')).status,409);assert.equal((await fetch(url+'/api/verify?session=other')).status,409);assert.equal((await fetch(url+'/api/verify?root='+encodeURIComponent(f.root+'-other'))).status,409);assert.equal((await (await fetch(url+'/api/verify')).json()).ok,true);await writeFile(path.join(f.root,'SKILL.md'),'changed\n');assert.equal((await (await fetch(url+'/api/verify')).json()).ok,false);assert.equal((await fetch(url+'/')).status,200);assert.equal((await fetch(url+'/%2e%2e%2fSKILL.md')).status,404);});

test('CLI html retains an edited snapshot without claiming to verify or needing the target directory', async t => {
  const f = await setup(t);
  await exec(process.execPath, [cli, 'create', f.root, '--analysis', f.input, '--out', f.session]);
  const session = JSON.parse(await readFile(f.session, 'utf8'));
  session.draft.nodes[0].purpose = '文件缺失时等待用户补充';
  session.annotations.push({ id: 'offline-note', targetType: 'node', targetId: 'read', targetLabel: '读取文件', text: '这里需要自动重试吗？ </SCRIPT><img src=x onerror=alert(1)>', intent: 'question', createdAt: session.createdAt, sourceRefs: session.draft.nodes[0].sourceRefs });
  await writeFile(f.session, JSON.stringify(session));
  const original = await readFile(f.session, 'utf8');
  await rm(f.root, { recursive: true });
  const output = path.join(f.temp, 'nested', 'review.html');
  const { stdout } = await exec(process.execPath, [cli, 'html', f.session, '--out', output]);
  const result = JSON.parse(stdout);
  assert.match(result.sourceVerification, /不能读取源文件.*verify/);
  const html = await readFile(output, 'utf8');
  const data = html.match(/<script\b[^>]*id="skill-graph-session"[^>]*>([\s\S]*?)<\/script>/)[1];
  assert.deepEqual(JSON.parse(data), session);
  assert.equal(await readFile(f.session, 'utf8'), original);
  assert.doesNotMatch(html, /<(?:script|link)\b[^>]*\b(?:src|href)=/i);
});

test('offline resource packaging refuses traversal, absolute paths and symlink escapes for both asset types', async t => {
  const f = await setup(t);
  await exec(process.execPath, [cli, 'create', f.root, '--analysis', f.input, '--out', f.session]);
  const session = JSON.parse(await readFile(f.session, 'utf8'));
  const viewer = path.join(f.temp, 'viewer');
  const sibling = path.join(f.temp, 'viewer-outside');
  await mkdir(viewer);
  await mkdir(sibling);
  await writeFile(path.join(viewer, 'app.js'), 'globalThis.fixture = true;');
  await writeFile(path.join(viewer, 'app.css'), 'body { color: black; }');
  await writeFile(path.join(sibling, 'secret.js'), 'PRIVATE_SENTINEL');
  await writeFile(path.join(sibling, 'secret.css'), 'PRIVATE_SENTINEL');
  await symlink(path.join(sibling, 'secret.js'), path.join(viewer, 'escape.js'));
  await symlink(path.join(sibling, 'secret.css'), path.join(viewer, 'escape.css'));
  const index = (script, css) => `<script type="module" src="${script}"></script><link rel="stylesheet" href="${css}">`;
  for (const suffix of ['js', 'css']) {
    for (const bad of [`../viewer-outside/secret.${suffix}`, path.join(sibling, `secret.${suffix}`), `C:\\private\\secret.${suffix}`, `escape.${suffix}`]) {
      await writeFile(path.join(viewer, 'index.html'), suffix === 'js' ? index(bad, 'app.css') : index('app.js', bad));
      await assert.rejects(standalonePage(session, viewer), error => /路径|构建目录/.test(error.message), bad);
    }
  }
  await symlink(path.join(viewer, 'app.js'), path.join(viewer, 'inside.js'));
  await writeFile(path.join(viewer, 'index.html'), index('inside.js', 'app.css'));
  assert.match(await standalonePage(session, viewer), /globalThis.fixture = true/);
});

test('CLI html rejects unsafe imported source paths before replacing an existing output', async t => {
  const f = await setup(t);
  await exec(process.execPath, [cli, 'create', f.root, '--analysis', f.input, '--out', f.session]);
  const session = JSON.parse(await readFile(f.session, 'utf8'));
  const output = path.join(f.temp, 'existing.html');
  await writeFile(output, 'EXISTING_OUTPUT');
  for (const bad of ['../private.md', '/private.md', 'C:\\private.md', 'refs/../../private.md']) {
    const invalid = structuredClone(session);
    invalid.draft.nodes[0].sourceRefs[0].path = bad;
    await writeFile(f.session, JSON.stringify(invalid));
    await assert.rejects(exec(process.execPath, [cli, 'html', f.session, '--out', output]), error => error.code === 1 && /路径/.test(error.stderr));
    assert.equal(await readFile(output, 'utf8'), 'EXISTING_OUTPUT');
  }
});
