import { validateSession } from './graph.mjs';

const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Browser-safe: the CLI and viewer share the exact same offline file format.
export function renderStandalone(session,{script,style}={}) {
  validateSession(session);
  if(typeof script!=='string'||!script.trim()||typeof style!=='string'||!style.trim())throw new Error('缺少画布资源，请先构建页面。');
  const snapshotId=globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const data=JSON.stringify(session).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const safeScript=script.replace(/<\/script/gi,'<\\/script');
  const safeStyle=style.replace(/<\/style/gi,'<\\/style');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'">
<title>${escapeHtml(session.title)} · Skill Graph</title>
<style id="skill-graph-css">${safeStyle}</style></head><body><div id="root"></div>
<script id="skill-graph-session" type="application/json" data-snapshot-id="${snapshotId}">${data}</script>
<script id="skill-graph-app" type="module">${safeScript}</script></body></html>\n`;
}
