// 実画面の確認（Chrome headless / CDP）。実行: node source/check.js <出力フォルダ>
// 作る→結果→リンク→開く、375px/880px/1000pxの矩形、ライト/ダーク、割合の切り替え、メンバーを消したときの行、明細の文、直して作り直す、共有ボタンの出し分け、XSS、壊れたリンク、最長の値、計測ビーコン
const fs = require('fs'), path = require('path'), http = require('http');
const { launch } = require('./cdp');
const OUT = path.resolve(process.argv[2] || 'check-out');
fs.mkdirSync(OUT, { recursive: true });
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
const PORT = 8785, ORIGIN = 'http://127.0.0.1:' + PORT + '/';
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML); }).listen(PORT);
let ng = 0;
const ok = (name, cond, info) => { if (!cond) ng++; console.log((cond ? 'OK ' : 'NG ') + name + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
const measure = `(()=>{const out={sw:document.documentElement.scrollWidth,iw:innerWidth,over:[],small:[]};
  document.querySelectorAll('main *').forEach(e=>{const r=e.getBoundingClientRect();if(r.width&&r.right>innerWidth+0.5)out.over.push(e.tagName+'.'+e.className)});
  document.querySelectorAll('main button:not([hidden]), main input[type=text], main input[type=date], main select, main .seg label').forEach(e=>{const r=e.getBoundingClientRect();if(r.width&&(r.height<43.5||r.width<43.5))out.small.push((e.textContent||e.type||e.tagName).slice(0,14)+':'+Math.round(r.width)+'x'+Math.round(r.height))});
  out.over=[...new Set(out.over)].slice(0,8);out.small=out.small.slice(0,8);return out})()`;
const click = t => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent===${JSON.stringify(t)});if(!b)throw new Error('no button '+${JSON.stringify(t)});b.click();return true})()`;
const settle = `[...document.querySelectorAll('.settle .tr, .settle .none')].map(e=>e.textContent)`;
const setDraft = d => `localStorage.setItem('cohost-split-v1', ${JSON.stringify(JSON.stringify(d))})`;
const b64 = s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

(async () => {
  const b = await launch(9437);
  const reqs = [];
  b.on(m => { if (m.method === 'Network.requestWillBeSent') reqs.push(m.params.request.url); });
  await b.send('Network.enable');
  // 本番の計測に検算の閲覧を混ぜないため、計測ビーコンを止める
  await b.send('Network.setBlockedURLs', { urls: ['*cloudflareinsights.com*'] });
  const errs = [];
  b.on(m => { if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text + ' ' + JSON.stringify(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description)); });

  // 1) 作る画面 375px・空
  await b.open(ORIGIN, 375, 900, 2, true, 'light');
  await b.ev(`localStorage.clear()`); await b.open(ORIGIN, 375, 900, 2, true, 'light');
  let m = await b.ev(measure); ok('make-empty 375 no overflow', m.sw <= 375 && !m.over.length, m);
  ok('make-empty 375 targets>=44', !m.small.length, m.small);
  ok('empty result hint', /入力が整うと/.test(await b.ev(`document.querySelector('.sticky').innerText`)));
  await b.ev(click('明細のリンクを作る')); await b.sleep(200);
  ok('empty errors', /1人目の呼び名を入れてください/.test(await b.ev(`document.querySelector('.errors[role=alert]').innerText`)));
  // 2) サンプル（Card1）→ 結果・明細の文
  await b.ev(`window.confirm=()=>true;` + click('サンプルを入れる')); await b.sleep(300);
  m = await b.ev(measure); ok('make-sample 375 no overflow', m.sw <= 375 && !m.over.length, m); ok('make-sample 375 targets', !m.small.length, m.small);
  ok('card1 settle', JSON.stringify(await b.ev(settle)) === JSON.stringify(['みどり → さくら 3,600円']), await b.ev(settle));
  const pc = await b.ev(`[...document.querySelectorAll('.person')].map(p=>p.innerText.replace(/\\n/g,' '))`);
  ok('card1 people', /さくら 3,600円 受け取る 取り分 31,800円 受け取った売上 38,000円 立て替えた経費 9,800円/.test(pc[0]) && /みどり 3,600円 渡す 取り分 21,200円 受け取った売上 42,000円 立て替えた経費 17,200円/.test(pc[1]), pc);
  ok('pct sum', /合計 100%（OK）/.test(await b.ev(`document.querySelector('.sum').textContent`)));
  await b.ev(click('明細のリンクを作る')); await b.sleep(300);
  const gen = await b.ev(`({len:document.querySelector('.len').textContent,url:document.querySelector('textarea.urlbox').value,msg:document.querySelector('.msgbox').value})`);
  ok('url generated', /#v1=/.test(gen.url) && gen.msg.endsWith('明細のリンク\n' + gen.url), gen.len);
  ok('url length shown = actual', gen.len.indexOf(Array.from(gen.url).length.toLocaleString('ja-JP') + ' / 2,000') >= 0, [gen.len, Array.from(gen.url).length]);
  fs.writeFileSync(path.join(OUT, 'sample-url.txt'), gen.url);
  // 3) 入力を変えるとリンクの欄が隠れ、結果が更新される（割合を 50/50 → 精算 みどり→さくら 9,000）
  await b.ev(`(()=>{const p=[...document.querySelectorAll('.mem .pct input')];p[0].value='50';p[0].dispatchEvent(new Event('input'));p[1].value='50';p[1].dispatchEvent(new Event('input'))})()`); await b.sleep(300);
  ok('pct change updates', JSON.stringify(await b.ev(settle)) === JSON.stringify(['さくら → みどり 1,700円']) && await b.ev(`document.querySelector('.urlbox').closest('.panel').hidden`), await b.ev(settle));
  // 4) 合計が100でないと結果を出さない
  await b.ev(`(()=>{const p=document.querySelectorAll('.mem .pct input')[1];p.value='49';p.dispatchEvent(new Event('input'))})()`); await b.sleep(300);
  ok('pct 99 no result', /割合の合計が99%/.test(await b.ev(`document.querySelector('.sticky').innerText`)) && /100%にしてください/.test(await b.ev(`document.querySelector('.sum').textContent`)));
  // 5) 均等に切り替え → メンバーを足す → 3人目を消す（3人目の行は「選んでください」に戻る）
  await b.ev(`document.querySelector('.seg input[value="0"]').click()`); await b.sleep(250);
  ok('equal settle', JSON.stringify(await b.ev(settle)) === JSON.stringify(['さくら → みどり 1,700円']), await b.ev(settle));
  await b.ev(click('＋ メンバーを足す')); await b.sleep(150);
  await b.ev(`(()=>{const i=document.querySelectorAll('.mem input[type=text]')[2];i.value='れん';i.dispatchEvent(new Event('input'));const s=document.querySelectorAll('.row select')[4];s.value='2';s.dispatchEvent(new Event('change'))})()`); await b.sleep(300);
  const three = await b.ev(settle);
  ok('three members', three.length >= 1 && /れん/.test(await b.ev(`document.querySelector('.people').innerText`)), three);
  await b.ev(`window.confirm=()=>true;document.querySelectorAll('.mem button')[2].click()`); await b.sleep(300);
  const after = await b.ev(`({sel:[...document.querySelectorAll('.row select')].map(s=>s.value),err:document.querySelector('.sticky').innerText})`);
  ok('remove member resets rows', after.sel[4] === '-1' && /経費3の立て替えた人を選んでください/.test(after.err), after.sel);
  // 6) 下書きがリロード後に戻る
  await b.open(ORIGIN, 375, 900, 2, true, 'light');
  ok('draft restored', await b.ev(`document.querySelectorAll('.mem').length`) === 2 && await b.ev(`document.querySelectorAll('.row select')[4].value`) === '-1');
  // 7) 止める言葉
  const moneyErr = await b.ev(`(()=>{const i=document.querySelectorAll('.row input[type=text]')[0];i.value='振込先 みずほ銀行';i.dispatchEvent(new Event('input'));${click('明細のリンクを作る')};return document.querySelector('.errors[role=alert]').innerText})()`);
  ok('money word blocked', /振込先や口座に関わる言葉は入れられません/.test(moneyErr), moneyErr.replace(/\n/g, ' / '));

  // 8) デスクトップ1000px 作る画面（Card2: 3人・均等・端数）
  const card2 = { event: '', date: '', mode: 0, members: [{ name: 'あおい', pct: '' }, { name: 'ひなた', pct: '' }, { name: 'れん', pct: '' }],
    sales: [{ who: 0, item: '当日の現金', amt: '45000' }], exp: [{ who: 1, item: '会場代', amt: '12000' }, { who: 2, item: '材料費', amt: '2000' }] };
  await b.open(ORIGIN, 1000, 900, 2, false, 'light'); await b.ev(setDraft(card2)); await b.open(ORIGIN, 1000, 900, 2, false, 'light');
  ok('card2 settle', JSON.stringify(await b.ev(settle)) === JSON.stringify(['あおい → ひなた 22,333円', 'あおい → れん 12,333円']), await b.ev(settle));
  ok('card2 rest note', /余った端数は一覧の1人目に寄せます。この明細では1円をあおいに寄せています/.test(await b.ev(`document.querySelector('.sticky').innerText`)));
  await b.ev(click('明細のリンクを作る')); await b.sleep(300);
  m = await b.ev(measure); ok('make 1000 no overflow', m.sw <= 1000 && !m.over.length, m);
  ok('two columns', await b.ev(`getComputedStyle(document.querySelector('.layout')).gridTemplateColumns.split(' ').length===2`));
  await b.shot(path.join(OUT, 'make-1000.png'), { x: 0, y: 0, width: 1000, height: await b.ev('document.documentElement.scrollHeight') });

  // 9) 見る画面 375px ライト（Card1）
  const url = gen.url.replace(/^[^#]*/, ORIGIN);
  await b.open(url, 375, 812, 2, true, 'light');
  const v = await b.ev(`({h1:document.querySelector('h1').textContent,date:document.querySelector('.v-date').textContent,notice:!!document.querySelector('.notice'),tax:/税理士や税務署/.test(document.querySelector('.tax').textContent),lists:document.querySelectorAll('.list li').length,inputs:document.querySelectorAll('main input').length})`);
  ok('view content', v.h1 === '秋の手づくりワークショップ 売上の分け方' && v.date === '開催日 2026年10月25日（日）' && v.notice && v.tax && v.lists === 5 && v.inputs === 0, v);
  ok('view settle', JSON.stringify(await b.ev(settle)) === JSON.stringify(['みどり → さくら 3,600円']));
  const firstScreen = await b.ev(`document.querySelector('.settle').getBoundingClientRect().bottom`);
  ok('settle visible in first screen', firstScreen < 812, firstScreen);
  m = await b.ev(measure); ok('view 375 no overflow', m.sw <= 375 && !m.over.length, m); ok('view 375 targets', !m.small.length, m.small);
  ok('view message has url', (await b.ev(`document.querySelector('.msgbox').value`)).endsWith(url));
  await b.shot(path.join(OUT, 'view-375-light.png'), { x: 0, y: 0, width: 375, height: await b.ev('document.documentElement.scrollHeight') });
  // 9b) クエリ付きで開かれても、明細の文のリンクに # 以降が残る
  await b.open(ORIGIN + '?fbclid=x' + url.replace(/^[^#]*/, ''), 375, 812, 2, true, 'light');
  ok('query url keeps hash', (await b.ev(`document.querySelector('.msgbox').value`)).endsWith(ORIGIN + url.replace(/^[^#]*/, '')));
  await b.open(url, 375, 812, 2, true, 'light');
  // 10) コピー（headlessでは clipboard が拒否されることがある。どちらの経路でも利用者に結果が出ること）
  await b.ev(click('明細の文をコピー')); await b.sleep(400);
  const cpm = await b.ev(`document.querySelector('.panel .okmsg').textContent`);
  ok('copy feedback', /コピーしました|長押しして/.test(cpm), cpm);
  // 11) 直してリンクを作り直す（変更しなければ同じURL）
  await b.ev(`window.confirm=()=>true;` + click('この内容を直してリンクを作り直す')); await b.sleep(400);
  ok('edit loads make', await b.ev(`location.hash===''&&document.querySelectorAll('.mem').length===2&&document.querySelectorAll('.mem input[type=text]')[0].value==='さくら'`));
  await b.ev(click('明細のリンクを作る')); await b.sleep(300);
  ok('edit roundtrip same url', (await b.ev(`document.querySelector('textarea.urlbox').value`)).replace(/^[^#]*/, '') === url.replace(/^[^#]*/, ''));
  // 11b) 「自分で売上分けの明細を作る」は下書きを消さない
  await b.ev(`localStorage.setItem('cohost-split-v1', JSON.stringify({event:'自分の下書き',date:'',mode:0,members:[{name:'X',pct:''},{name:'Y',pct:''}],sales:[{who:0,item:'',amt:'1'}],exp:[]}))`);
  await b.open(url, 375, 812, 2, true, 'light');
  await b.ev(click('自分で売上分けの明細を作る')); await b.sleep(300);
  ok('own make keeps draft', await b.ev(`document.querySelector('input[type=text]').value`) === '自分の下書き');
  // 12) ダーク
  await b.open(url, 375, 812, 2, true, 'dark');
  const dk = await b.ev(`({bg:getComputedStyle(document.body).backgroundColor,settle:getComputedStyle(document.querySelector('.settle')).borderColor,ink:getComputedStyle(document.querySelector('.settle .tr')).color})`);
  ok('dark colors', dk.bg === 'rgb(15, 21, 13)' && dk.settle === 'rgb(143, 209, 158)', dk);
  await b.shot(path.join(OUT, 'view-375-dark.png'), { x: 0, y: 0, width: 375, height: await b.ev('document.documentElement.scrollHeight') });
  // 13) 880px（見る画面は1カラム・最大560px）
  await b.open(url, 880, 900, 1, false, 'light');
  m = await b.ev(measure); ok('view 880', m.sw <= 880 && !m.over.length && await b.ev(`document.querySelector('.viewpage').getBoundingClientRect().width<=560`), m);
  // 14) 最長の値（呼び名10字×4人・金額9桁・内容20字）
  const longCfg = [1, 'あ'.repeat(30), '2026-12-31', 0, ['あいうえおかきくけこ', 'さしすせそたちつてと', 'なにぬねのはひふへほ', 'まみむめもやゆよらり'].map(n => [n, 0]),
    [[0, 'か'.repeat(20), 9999999], [1, 'き'.repeat(20), 9999999]], [[2, 'く'.repeat(20), 9999999], [3, 'け'.repeat(20), 9999999], [3, 'こ'.repeat(20), 9999999]]];
  await b.open(ORIGIN + '#v1=' + b64(JSON.stringify(longCfg)), 375, 812, 2, true, 'light');
  m = await b.ev(measure); ok('longest view 375', m.sw <= 375 && !m.over.length, m);
  const longest = await b.ev(settle); ok('longest settle', longest.length >= 1, longest);
  await b.shot(path.join(OUT, 'view-375-longest.png'), { x: 0, y: 0, width: 375, height: await b.ev('document.documentElement.scrollHeight') });
  await b.open(ORIGIN, 375, 900, 2, true, 'light');
  await b.ev(setDraft({ event: 'あ'.repeat(30), date: '2026-12-31', mode: 1, members: ['あいうえおかきくけこ', 'さしすせそたちつてと', 'なにぬねのはひふへほ', 'まみむめもやゆよらり'].map(n => ({ name: n, pct: '25' })),
    sales: [{ who: 0, item: 'か'.repeat(20), amt: '9,999,999' }], exp: [{ who: 3, item: 'け'.repeat(20), amt: '9999999' }] }));
  await b.open(ORIGIN, 375, 900, 2, true, 'light');
  m = await b.ev(measure); ok('longest make 375', m.sw <= 375 && !m.over.length && !m.small.length, m);
  // 15) 長すぎるリンクはコピーできない
  const maxD = { event: 'さ'.repeat(30), date: '2026-10-25', mode: 1, members: ['あ', 'い', 'う', 'え'].map(c => ({ name: c.repeat(10), pct: '25' })),
    sales: Array(8).fill(0).map((_, i) => ({ who: i % 4, item: 'か'.repeat(20), amt: '9999999' })), exp: Array(10).fill(0).map((_, i) => ({ who: i % 4, item: 'き'.repeat(20), amt: '9999999' })) };
  await b.ev(setDraft(maxD)); await b.open(ORIGIN, 375, 900, 2, true, 'light');
  await b.ev(click('明細のリンクを作る')); await b.sleep(300);
  const over = await b.ev(`({len:document.querySelector('.len').textContent,url:document.querySelector('textarea.urlbox').value,dis:[...document.querySelectorAll('button')].find(x=>x.textContent==='URLをコピー').disabled})`);
  ok('too long url disabled', /長すぎます/.test(over.len) && over.url === '' && over.dis, over.len);
  // 16) 共有ボタンの出し分け（navigator.share の有無だけで決める。UAでは分けない）
  await b.ev(setDraft(card2)); await b.open(ORIGIN, 375, 900, 2, true, 'light');
  await b.ev(click('明細のリンクを作る')); await b.sleep(300);
  const noShare = await b.ev(`({api:typeof navigator.share,hidden:[...document.querySelectorAll('button')].find(x=>x.textContent==='共有').hidden})`);
  ok('share hidden without navigator.share', noShare.api !== 'function' ? noShare.hidden : true, noShare);
  const shareId = (await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `navigator.share=function(){return Promise.reject(Object.assign(new Error('x'),{name:'AbortError'}))}` })).result.identifier;
  await b.send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' });
  await b.open(ORIGIN, 375, 900, 2, true, 'light');
  await b.ev(click('明細のリンクを作る')); await b.sleep(300);
  const sh = await b.ev(`(async()=>{const s=[...document.querySelectorAll('button')].find(x=>x.textContent==='共有');const vis=!s.hidden;s.click();await new Promise(r=>setTimeout(r,200));return {vis,msg:document.querySelector('.urlbox').closest('.panel').querySelector('.okmsg').textContent}})()`);
  ok('share shown with navigator.share / abort is not error', sh.vis && sh.msg === '', sh);
  await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: shareId });
  await b.send('Network.setUserAgentOverride', { userAgent: '' });

  // 17) XSS（中身を直接組んだリンク）
  const xcfg = [1, '<img src=x onerror=window.__x=1>'.slice(0, 30), '', 0, [['<b>x</b>', 0], ['"><svg>', 0]], [[0, '</ul><script>__x=2</script>'.slice(0, 20), 1]], [[1, '<i onclick=__x=3>', 1]]];
  await b.open(ORIGIN + '#v1=' + b64(JSON.stringify(xcfg)), 375, 812, 2, true, 'light');
  const xr = await b.ev(`({x:window.__x||0,imgs:document.querySelectorAll('main img').length,scripts:document.querySelectorAll('main script').length,svgs:document.querySelectorAll('main svg').length,bs:document.querySelectorAll('main b').length,h1:document.querySelector('h1').textContent})`);
  ok('xss inert', xr.x === 0 && xr.imgs === 0 && xr.scripts === 0 && xr.svgs === 0 && xr.bs === 0 && xr.h1.indexOf('<img') === 0, xr);
  // 18) 壊れたリンク（`#` 以降が途中で切れた場合も含む）
  for (const h of ['#v1=abc', '#v2=xx', '#v1=' + 'A'.repeat(4001), url.replace(/^[^#]*/, '').slice(0, 30)]) {
    await b.open(ORIGIN + h, 375, 812, 2, true, 'light');
    ok('broken ' + h.slice(0, 12), /明細が読み取れませんでした/.test(await b.ev(`document.querySelector('h1').textContent`)));
  }
  await b.ev(click('売上分けの明細を作る画面へ')); await b.sleep(300);
  ok('broken -> make', await b.ev(`location.hash===''&&!!document.querySelector('.layout')`));
  // 19) 外部への通信（ビーコン以外にない）・リンク
  const ext = [...new Set(reqs.filter(u => !u.startsWith(ORIGIN) && !u.startsWith('data:')))];
  ok('no external requests except beacon', ext.every(u => /cloudflareinsights\.com/.test(u)), ext);
  const hrefs = await b.ev(`[...document.querySelectorAll('a')].map(a=>a.getAttribute('href'))`);
  ok('links only footer', hrefs.every(h => h === 'https://michi-portfolio.vercel.app/' || h === 'mailto:nncf123nncf@gmail.com') && !hrefs.includes('#'), hrefs);
  ok('no page errors', !errs.length, errs);
  b.close(); srv.close();
  console.log(ng ? 'check: ' + ng + ' NG' : 'check: all OK');
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
