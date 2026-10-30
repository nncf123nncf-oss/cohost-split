// Chrome headless を CDP で動かす最小のヘルパー（check.js から使う）
const fs = require('fs'), path = require('path'), cp = require('child_process'), http = require('http'), os = require('os');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
async function launch(port) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-cdp-'));
  const chrome = cp.spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + path.join(tmp, 'prof'), '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  let t; for (let i = 0; i < 50; i++) { try { t = await getJson('http://127.0.0.1:' + port + '/json'); if (t.length) break; } catch (e) { } await sleep(200); }
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = {}; const handlers = [];
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } else if (m.method) handlers.forEach(f => f(m)); });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async x => { const r = (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result; if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
  async function open(url, w, h, dpr, mobile, scheme) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: !!mobile });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme || 'light' }] });
    await send('Page.navigate', { url }); for (let i = 0; i < 80; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(100); } await sleep(400);
  }
  async function shot(file, clip) {
    const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: Object.assign({ scale: 1 }, clip) });
    fs.writeFileSync(file, Buffer.from(s.result.data, 'base64'));
  }
  async function pick(sel, file) { const doc = (await send('DOM.getDocument', { depth: 0 })).result.root.nodeId; const q = (await send('DOM.querySelector', { nodeId: doc, selector: sel })).result.nodeId; await send('DOM.setFileInputFiles', { nodeId: q, files: [file] }); await sleep(800); }
  function close() { ws.close(); chrome.kill(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { } }
  return { send, ev, open, shot, pick, close, sleep, on: f => handlers.push(f) };
}
module.exports = { launch, sleep };
