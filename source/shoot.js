// 投稿カード用の素材を撮る（Chrome headless / CDP・DPR2）。実行: node source/shoot.js <出力フォルダ> [--probe]
// 01-x-primary: 見る画面（相手に送ったリンクを開いたところ）。Card1の値（さくら60%・みどり40%）で、精算の枠〜1人ずつのカードまで（説明バナー・タイトル・開催日は画面の上にあり、範囲に入れていない）
// 02-make-1000: 作る画面 1000px・2列。Card2の値（3人・均等・端数1円）で、左にメンバーと売上・経費、右に精算の2行と1人ずつのカード
//   （リンクは作らない。共有用URLの欄に撮影用サーバーのアドレスが出るため、写さない）
// 03-message-600: 見る画面の下部（受け取った売上・立て替えた経費の一覧と明細の文）（予備）
// 見本はすべて架空。値は画面の「サンプルを入れる」と仕様カード第6節のCard2のとおり
const fs = require('fs'), path = require('path'), http = require('http');
const { launch } = require('./cdp');
const OUT = path.resolve(process.argv[2] || 'shots');
const PROBE = process.argv.includes('--probe');
fs.mkdirSync(OUT, { recursive: true });
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
const PORT = 8795, ORIGIN = 'http://127.0.0.1:' + PORT + '/';
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML); }).listen(PORT);
const rectEv = js => `(()=>{const e=${js};const r=e.getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,w:r.width,h:r.height}})()`;
const union = (a, b) => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };
const pad = (a, p) => ({ x: Math.max(0, a.x - p), y: Math.max(0, a.y - p), width: a.w + p * 2, height: a.h + p * 2 });
const click = t => `[...document.querySelectorAll('button')].find(x=>x.textContent===${JSON.stringify(t)}).click()`;
const report = (name, c) => console.log(name, JSON.stringify({ w: Math.round(c.width), h: Math.round(c.height), ratio: +(c.width / c.height).toFixed(3) }));
const setDraft = d => `localStorage.setItem('cohost-split-v1', ${JSON.stringify(JSON.stringify(d))})`;
const CARD2 = { event: '', date: '', mode: 0, members: [{ name: 'あおい', pct: '' }, { name: 'ひなた', pct: '' }, { name: 'れん', pct: '' }],
  sales: [{ who: 0, item: '当日の現金', amt: '45000' }], exp: [{ who: 1, item: '会場代', amt: '12000' }, { who: 2, item: '材料費', amt: '2000' }] };

(async () => {
  const b = await launch(9476);
  await b.send('Network.enable');
  await b.send('Network.setBlockedURLs', { urls: ['*cloudflareinsights.com*'] });

  // 01: 見る画面。幅600px（本文は最大560px）。375px・480pxだと縦に長くなり、1:1のカードでスクショの占有率が60%に届かないため
  await b.open(ORIGIN, 600, 1600, 2, true, 'light');
  const url = await b.ev(`CS.makeUrl(${JSON.stringify(ORIGIN)}, CS.toConfig(CS.sampleDraft()).cfg)`);
  await b.open(url, 600, 1600, 2, true, 'light');
  const top = await b.ev(rectEv(`document.querySelector('.settle')`));
  const people = await b.ev(rectEv(`document.querySelector('.people')`));
  const c1 = pad(union(top, people), 12);
  report('01-x-primary', c1);
  if (!PROBE) await b.shot(path.join(OUT, '01-x-primary.png'), c1);

  // 03: 見る画面の下部（一覧〜明細の文）
  const lists = await b.ev(rectEv(`document.querySelectorAll('h3')[document.querySelectorAll('h3').length-3]`));
  const msg = await b.ev(rectEv(`document.querySelector('.msgbox').closest('.panel')`));
  const c3 = pad(union(lists, msg), 12);
  report('03-message-600', c3);
  if (!PROBE) await b.shot(path.join(OUT, '03-message-600.png'), c3);

  // 02: 作る画面 1000px（右の列が途中で切れないよう、高さを大きくする）
  await b.open(ORIGIN, 1000, 2400, 2, false, 'light');
  await b.ev(`localStorage.clear();` + setDraft(CARD2)); await b.open(ORIGIN, 1000, 2400, 2, false, 'light');
  const l = await b.ev(rectEv(`document.querySelector('.sec-h')`));
  const lb = await b.ev(rectEv(`document.querySelectorAll('.btns')[document.querySelectorAll('.btns').length-1]`));
  const r = await b.ev(rectEv(`document.querySelector('.sticky')`));
  const pp = await b.ev(rectEv(`document.querySelector('.sticky .people')`));
  const left = { x: 0, y: l.y, w: 1000, h: lb.y + lb.h - l.y };
  const c2 = pad(union(left, { x: r.x, y: r.y, w: r.w, h: pp.y + pp.h - r.y }), 8);
  c2.x = 0; c2.width = 1000;
  report('02-make-1000', c2);
  if (!PROBE) await b.shot(path.join(OUT, '02-make-1000.png'), c2);

  b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
