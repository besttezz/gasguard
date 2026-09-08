import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('../docs/ui-review/capture-manifest.json', import.meta.url), 'utf8'));
const output = new URL('../docs/ui-review/screenshots/', import.meta.url);
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = join(tmpdir(), `gasguard-ui-capture-${Date.now()}`);
const sourceMap = { S01:'normal', S02:'rise', S03:'critical', S04:'unknown', S05:'network', S06:'valveFailure', S07:'drift', S08:'normal', S09:'normal', S10:'normal' };
const pageMap = { U1:'overview', U4:'events', U5:'assistant', T1:'overview', T2:'setup', T3:'live', T4:'replay', T7:'reports', D1:'developer', D2:'explorer', D3:'intelligence', D6:'developer', D8:'demo' };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitPort = child => new Promise((resolve, reject) => {
  let text = ''; const on = chunk => { text += String(chunk); const match = text.match(/127\.0\.0\.1:(\d+)/); if (match) resolve(Number(match[1])); };
  child.stderr.on('data', on); child.stdout.on('data', on); child.once('error', reject); setTimeout(() => reject(new Error('Chrome remote debugging port was not announced')), 10000);
});
function channel(url) {
  const ws = new WebSocket(url); let id = 0; const waiting = new Map();
  ws.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.id && waiting.has(data.id)) { const entry = waiting.get(data.id); waiting.delete(data.id); data.error ? entry.reject(new Error(data.error.message)) : entry.resolve(data.result); } });
  return new Promise((resolve, reject) => { ws.addEventListener('open', () => resolve({ call(method, params = {}) { const messageId = ++id; ws.send(JSON.stringify({ id:messageId, method, params })); return new Promise((res, rej) => waiting.set(messageId, { resolve:res, reject:rej })); }, close() { ws.close(); } })); ws.addEventListener('error', reject, { once:true }); });
}
async function runExpression(cdp, expression) { return cdp.call('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true }); }
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { stdio:['ignore', 'pipe', 'pipe'] });
try {
  const port = await waitPort(child); const browser = await channel((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
  const target = await browser.call('Target.createTarget', { url:'about:blank' }); const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const tab = tabs.find(item => item.id === target.targetId); const cdp = await channel(tab.webSocketDebuggerUrl);
  await cdp.call('Page.enable'); await cdp.call('Runtime.enable'); await mkdir(output, { recursive:true });
  for (const item of manifest) {
    const [width, height] = item.viewport.split('×').map(Number); await cdp.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile:false, screenWidth:width, screenHeight:height });
    await cdp.call('Page.navigate', { url:'http://localhost:5567/?review=1&capture=1' }); await pause(900);
    const role = item.role; const scenario = sourceMap[item.scenario] || 'normal'; const page = pageMap[item.pageId] || 'overview';
    await runExpression(cdp, `(()=>{const change=(el,value)=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}))};change(document.querySelector('#view-mode'),'developer');const demo=document.querySelector('[data-role-page="demo"]');demo&&demo.click()})()`); await pause(250);
    await runExpression(cdp, `(()=>{const change=(el,value)=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}))};const select=document.querySelector('#demo-scenario-select');change(select,'${item.scenario}');for(let i=0;i<${item.scenario==='S03'?7:item.scenario==='S04'?1:0};i++)document.querySelector('#demo-step').click()})()`); await pause(350);
    if (item.scenario === 'S09') await runExpression(cdp, `(()=>{const service=window.GasGuardService,created=service.create({requestType:'inspection',title:'ขอให้ช่างตรวจสอบระบบ',description:'Mock workflow created for visual review',contactPreference:'Demo contact'});if(!created.ok)return;const id=created.request.requestId;service.transition(id,'acknowledged','technician');service.transition(id,'in_progress','technician');service.task(id,{description:'ตรวจอุปกรณ์และ telemetry ในโหมดจำลอง'});service.transition(id,'awaiting_verification','technician');service.verify(id,{result:'passed',observedResult:'Mock verification passed'});service.transition(id,'completed','technician');service.report(id)})()`);
    await runExpression(cdp, `(()=>{const change=(el,value)=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}))};change(document.querySelector('#view-mode'),'${role}');const page=document.querySelector('[data-role-page="${page}"]');if(page)page.click();else if('${page}'==='setup')document.querySelector('[data-role-action="setup"]')?.click();const focus='${item.pageId}'==='D8'?document.querySelector('#guided-demo'):'${item.pageId}'==='D6'?document.querySelector('#relation-explorer-select'):null;if(focus)focus.scrollIntoView({block:'start'});else window.scrollTo(0,0)})()`); await pause(400);
    const image = await cdp.call('Page.captureScreenshot', { format:'png', captureBeyondViewport:false, fromSurface:true }); await writeFile(new URL(item.file, output), Buffer.from(image.data, 'base64'));
  }
  cdp.close(); browser.close(); console.log(`Captured ${manifest.length} screenshots to ${output.pathname}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  child.kill();
  await pause(600);
  try { await rm(profile, { recursive:true, force:true, maxRetries:4, retryDelay:250 }); }
  catch (cleanupError) { console.warn(`Capture profile retained for cleanup: ${cleanupError.message}`); }
}
