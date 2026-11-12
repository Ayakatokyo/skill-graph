#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readFile, writeFile, mkdir, rename, realpath, stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {inventory, createSession, verifySession, refreshSession, relativePath} from './lib/files.mjs';
import {validateSession, buildChangeSet, generatePrompt, toMermaid} from './lib/graph.mjs';
import {renderStandalone} from './lib/standalone.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const json=value=>JSON.stringify(value,null,2)+'\n';
async function loadJSON(file){const info=await stat(file);if(info.size>20*1024*1024)throw new Error('JSON 文件超过 20 MiB');try{return JSON.parse(await readFile(file,'utf8'));}catch(e){throw new Error(`无法读取 JSON ${file}：${e.message}`);}}
async function save(file,content){const target=path.resolve(file);await mkdir(path.dirname(target),{recursive:true});const temp=target+'.'+randomUUID()+'.tmp';await writeFile(temp,content,{mode:0o600});await rename(temp,target);}
function parseArgs(args){const positional=[],options={};for(let i=0;i<args.length;i++){const arg=args[i];if(arg.startsWith('--')){if(!['--out','--analysis','--port','--root'].includes(arg))throw new Error(`未知选项：${arg}`);if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`${arg} 缺少值`);if(options[arg.slice(2)]!==undefined)throw new Error(`重复选项：${arg}`);options[arg.slice(2)]=args[++i];}else positional.push(arg);}return {positional,options};}
function requireOption(options,key){if(!options[key])throw new Error(`需要 --${key}`);return options[key];}

export async function standalonePage(session,viewerDir=path.join(HERE,'../assets/viewer')) {
  const root=await realpath(viewerDir);
  const html=await readFile(path.join(root,'index.html'),'utf8');
  const scriptFile=html.match(/<script\b[^>]*\bsrc="([^"]+)"/i)?.[1];
  const styleFiles=[...html.matchAll(/<link\b[^>]*\bhref="([^"]+\.css)"/gi)].map(match=>match[1]);
  if(!scriptFile||!styleFiles.length)throw new Error('未找到已构建画布资源，请运行 npm run build');
  const asset=async name=>{
    const relative=name.replace(/^\.\//,'');relativePath(relative);
    const file=await realpath(path.join(root,relative));
    if(!file.startsWith(root+path.sep))throw new Error('画布资源必须在构建目录内');
    return readFile(file,'utf8');
  };
  const script=await asset(scriptFile);
  const style=(await Promise.all(styleFiles.map(asset))).join('\n');
  return renderStandalone(session,{script,style});
}

const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json; charset=utf-8'};
export async function startServer(session,{port=0,viewerDir=path.join(HERE,'../assets/viewer')}={}) {
  validateSession(session);
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error('port 必须为 0–65535 的整数');
  const root=await realpath(viewerDir);
  await stat(path.join(root,'index.html'));
  const server=http.createServer(async(req,res)=>{
    const expected=`127.0.0.1:${server.address().port}`;
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(json(value));};
    if(req.headers.host!==expected || (req.headers.origin&&req.headers.origin!==`http://${expected}`)||req.headers['sec-fetch-site']==='cross-site'){reply(403,{error:'只允许本地同源访问'});return;}
    if(req.method!=='GET'&&req.method!=='HEAD'){reply(405,{error:'此服务只读，请在画布导出文件保存修改'});return;}
    try{
      const url=new URL(req.url,`http://${expected}`);
      if(url.pathname==='/api/session'){reply(200,session);return;}
      if(url.pathname==='/api/verify'){
        const identity={baseline:session.baseline.id,session:session.id,root:session.target.root};
        if(Object.entries(identity).some(([key,value])=>url.searchParams.has(key)&&url.searchParams.get(key)!==value)){reply(409,{error:'导入会话与服务目标或基线不同，请使用 CLI 校验'});return;}
        reply(200,await verifySession(session));return;
      }
      let file=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';
      try{relativePath(file);}catch{reply(404,{error:'文件不存在'});return;}
      const resolved=await realpath(path.join(root,file));
      if(!resolved.startsWith(root+path.sep)){reply(404,{error:'文件不存在'});return;}
      const bytes=await readFile(resolved);res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:bytes);
    }catch(error){reply(error.code==='ENOENT'?404:500,{error:error.message});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return server;
}

const HELP=`Skill Graph · 单个 Skill 的流程梳理与修改请求\n\n用法（Node 20+）：\n  inventory ROOT --out inventory.json\n  create ROOT --analysis analysis.json --out session.json\n  verify session.json [--root NEW_ROOT]\n  export session.json --out DIRECTORY\n  html session.json --out flow.html\n  refresh session.json --analysis analysis.json --out NEW_SESSION [--root NEW_ROOT]\n  serve session.json [--port 0]\n\n分析由 Codex 阅读源文件后生成；inventory 仅盘点文件。\nhtml 输出包含画布与会话的独立网页，无需启动服务。\nserve 仅在进程运行期间可用；草稿保存在浏览器，下载网页副本或 JSON 可长期保存。\nverify 全部匹配时退出 0，文件变化/缺失退出 2，命令或数据错误退出 1。\n`;
export async function main(args=process.argv.slice(2)) {
  const command=args.shift();
  if(!command||command==='help'||command==='--help'){console.log(HELP);return;}
  const {positional,options}=parseArgs(args);
  if(positional.length!==1)throw new Error('请提供且仅提供一个目标目录或会话文件；运行 --help 查看用法');
  const input=positional[0];
  if(command==='inventory'){const data=await inventory(input);await save(requireOption(options,'out'),json(data));console.log(json({files:data.files.length,excluded:data.excluded.length,out:path.resolve(options.out)}));return;}
  if(command==='create'){const analysis=await loadJSON(requireOption(options,'analysis'));const data=await createSession(input,analysis);await save(requireOption(options,'out'),json(data));console.log(json({sessionId:data.id,nodes:data.draft.nodes.length,edges:data.draft.edges.length,out:path.resolve(options.out)}));return;}
  if(!['verify','export','refresh','serve','html'].includes(command))throw new Error(`未知命令：${command}`);
  const session=validateSession(await loadJSON(input));
  if(command==='html'){await save(requireOption(options,'out'),await standalonePage(session));console.log(json({out:path.resolve(options.out),mode:'离线 HTML，可直接打开；不依赖本地服务',sourceVerification:'离线页面不能读取源文件；执行修改前运行 verify'}));return;}
  if(command==='verify'){const result=await verifySession(session,options.root);console.log(json(result));if(!result.ok)process.exitCode=2;return;}
  if(command==='refresh'){const result=await refreshSession(session,await loadJSON(requireOption(options,'analysis')),options.root);await save(requireOption(options,'out'),json(result));console.log(json({baselineId:result.baseline.id,annotations:result.annotations.length,out:path.resolve(options.out)}));return;}
  if(command==='export'){
    const out=path.resolve(requireOption(options,'out'));
    const outputs={'session.json':json(session),'changes.json':json(buildChangeSet(session)),'prompt.md':generatePrompt(session),'flow.mmd':toMermaid(session.draft)};
    for(const [name,content]of Object.entries(outputs))await save(path.join(out,name),content);
    console.log(json({out,files:Object.keys(outputs),sourceVerification:'未自动核对；执行前运行 verify'}));return;
  }
  if(command==='serve'){
    const server=await startServer(session,{port:options.port===undefined?0:Number(options.port)});
    console.log(json({url:`http://127.0.0.1:${server.address().port}`,session:path.resolve(input),mode:'只读来源；修改请在画布导出'}));
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){main().catch(error=>{console.error(`Skill Graph：${error.message}`);process.exitCode=1;});}
