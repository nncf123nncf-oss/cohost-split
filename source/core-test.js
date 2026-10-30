// 純ロジックの検算。実行: node source/core-test.js
// index.html の <script id="core"> を取り出して読み込み、精算の計算・端数・赤字・乱数での差額の合計・往復・壊れたリンク・止める文字・明細の文を確かめる
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = /<script id="core">([\s\S]*?)<\/script>/.exec(html)[1];
const ctx = { module: { exports: {} }, TextEncoder, TextDecoder, btoa, atob, console };
vm.createContext(ctx); vm.runInContext(src, ctx);
const CS = ctx.module.exports;
let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.log('NG', name, '\n  got ', g, '\n  want', w); }
}
const J = x => JSON.parse(JSON.stringify(x)); // vm の中の配列を外の配列にそろえる
const b64 = s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hashOf = a => '#v1=' + b64(JSON.stringify(a));
const draft = (members, mode, sales, exp, extra) => Object.assign({ event: '', date: '', mode, members: members.map(m => typeof m === 'string' ? { name: m, pct: '' } : { name: m[0], pct: String(m[1]) }),
  sales: sales.map(r => ({ who: r[0], item: r[1] || '', amt: String(r[2]) })), exp: exp.map(r => ({ who: r[0], item: r[1] || '', amt: String(r[2]) })) }, extra || {});
const cfgOf = d => { const r = CS.toConfig(d); if (!r.cfg) throw new Error(JSON.stringify(r.errors)); return r.cfg; };
const pick = r => J({ S: r.S, E: r.E, P: r.P, share: r.share, hand: r.hand, diff: r.diff, transfers: r.transfers });

// S1 Card1
const c1 = cfgOf(CS.sampleDraft());
const r1 = CS.compute(c1);
eq('S1', pick(r1), { S: 80000, E: 27000, P: 53000, share: [31800, 21200], hand: [28200, 24800], diff: [3600, -3600], transfers: [[1, 0, 3600]] });
eq('S1 text', CS.transferText(c1, r1.transfers[0]), 'みどり → さくら 3,600円');
eq('S1 recv/paid', J([r1.recv, r1.paid]), [[38000, 42000], [9800, 17200]]);

// S2 Card2（3人・均等・端数1円は1人目）
const c2 = cfgOf(draft(['あおい', 'ひなた', 'れん'], 0, [[0, '当日の現金', 45000]], [[1, '会場代', 12000], [2, '材料費', 2000]]));
const r2 = CS.compute(c2);
eq('S2', pick(r2), { S: 45000, E: 14000, P: 31000, share: [10334, 10333, 10333], hand: [45000, -12000, -2000], diff: [-34666, 22333, 12333], transfers: [[0, 1, 22333], [0, 2, 12333]] });
eq('S2 rest', r2.rest, 1);

// S3 精算なし
const r3 = CS.compute(cfgOf(draft(['A', 'B'], 0, [[0, '', 5000], [1, '', 5000]], [])));
eq('S3', J(r3.transfers), []); eq('S3 diff', J(r3.diff), [0, 0]);
eq('S3 msg', CS.message(cfgOf(draft(['A', 'B'], 0, [[0, '', 5000], [1, '', 5000]], [])), '').split('\n').slice(-1)[0], '精算はありません');

// S4 赤字
const c4 = cfgOf(draft(['A', 'B'], 0, [[0, '', 10000]], [[1, '', 25000]]));
const r4 = CS.compute(c4);
eq('S4', pick(r4), { S: 10000, E: 25000, P: -15000, share: [-7500, -7500], hand: [10000, -25000], diff: [-17500, 17500], transfers: [[0, 1, 17500]] });
eq('S4 basis', CS.basisText(c4, r4), '赤字 15,000円を 2人で均等に負担すると');
// 赤字で端数: -10,001 を 3人 → 3,333×3＝9,999、端数2円は1人目 → 負担 3,335・3,333・3,333
const r4b = CS.compute(cfgOf(draft(['A', 'B', 'C'], 0, [[0, '', 1]], [[1, '', 10002]])));
eq('S4 deficit rest', J(r4b.share), [-3335, -3333, -3333]);
eq('S4 deficit sum0', r4b.diff.reduce((a, b) => a + b, 0), 0);

// S5 経費0件・売上1人だけ・4人の割合・割合の合計
const c5 = cfgOf(draft([['A', 40], ['B', 30], ['C', 20], ['D', 10]], 1, [[2, '', 100003]], []));
const r5 = CS.compute(c5);
eq('S5 4pct share', J(r5.share), [40003, 30000, 20000, 10000]); // 40001.2→40001・30000.9→30000・20000.6→20000・10000.3→10000、合計100001で端数2円は1人目
eq('S5 4pct transfers', J(r5.transfers), [[2, 0, 40003], [2, 1, 30000], [2, 3, 10000]]);
eq('S5 pct99', CS.toConfig(draft([['A', 50], ['B', 49]], 1, [[0, '', 1000]], [])).errors, ['割合の合計が99%です。合計が100%になるようにしてください']);
eq('S5 pct101', CS.toConfig(draft([['A', 51], ['B', 50]], 1, [[0, '', 1000]], [])).errors, ['割合の合計が101%です。合計が100%になるようにしてください']);
eq('S5 pct blank', CS.toConfig(draft([['A', ''], ['B', 100]], 1, [[0, '', 1000]], [])).errors, ['Aの割合を0〜100の整数で入れてください']);
eq('S5 pct 0 ok', CS.compute(cfgOf(draft([['A', 0], ['B', 100]], 1, [[0, '', 1000]], []))).transfers.length, 1);
eq('S5 no sales', CS.toConfig(draft(['A', 'B'], 0, [], [])).errors, ['売上を1件以上入れてください']);
eq('S5 blank row ignored', CS.toConfig(draft(['A', 'B'], 0, [[0, '', 1000], [1, '', '']], [[0, '', '']])).cfg.sales.length, 1);

// S6 乱数: 差額の合計0・精算の行の数は n−1 以下・精算を当てると全員の差額が0
let seed = 12345; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
let s6ok = 0, s6ng = 0;
for (let n = 2; n <= 4; n++) for (let t = 0; t < 1000; t++) {
  const mode = rnd(2);
  let pcts = [], left = 100;
  for (let i = 0; i < n - 1; i++) { const v = rnd(left + 1); pcts.push(v); left -= v; } pcts.push(left);
  const members = Array.from({ length: n }, (_, i) => mode ? ['m' + i, pcts[i]] : 'm' + i);
  const sales = Array.from({ length: 1 + rnd(8) }, () => [rnd(n), '', rnd(3) ? rnd(200000) : rnd(10)]);
  const exp = Array.from({ length: rnd(11) }, () => [rnd(n), '', rnd(300000)]);
  const c = cfgOf(draft(members, mode, sales, exp)), r = CS.compute(c);
  const bal = r.diff.slice();
  r.transfers.forEach(([g, k, a]) => { bal[g] += a; bal[k] -= a; });
  const shareSum = r.share.reduce((a, b) => a + b, 0);
  const good = r.diff.reduce((a, b) => a + b, 0) === 0 && r.transfers.length <= n - 1 && bal.every(v => v === 0) && shareSum === r.P && r.transfers.every(x => x[2] > 0) && r.rest >= 0 && r.rest < n;
  if (good) s6ok++; else { s6ng++; if (s6ng < 3) console.log('S6 NG', JSON.stringify(c), JSON.stringify(pick(r))); }
}
eq('S6 random 3000', [s6ok, s6ng], [3000, 0]);

// S7 往復
eq('S7 card1', J(CS.decodeHash('#' + CS.encode(c1))), J(c1));
eq('S7 card2', J(CS.decodeHash('#' + CS.encode(c2))), J(c2));
const c7 = cfgOf(draft(['🍰さくら', '𠮷田', 'Ａ＆Ｂ'], 0, [[0, '絵文字🎉と全角！', 1]], [], { event: '「秋」の会🍁', date: '' }));
eq('S7 emoji', J(CS.decodeHash('#' + CS.encode(c7))), J(c7));
eq('S7 url', CS.makeUrl('https://x.test/cohost-split/', c1).indexOf('https://x.test/cohost-split/#v1='), 0);
eq('S14 draftFrom roundtrip', J(cfgOf(CS.draftFrom(c1))), J(c1));
eq('S14 draftFrom card2', J(cfgOf(CS.draftFrom(c2))), J(c2));

// S8 壊れたリンク
const good = [1, '', '', 0, [['A', 0], ['B', 0]], [[0, '', 100]], []];
const broken = {
  empty: '', hashOnly: '#', noV: '#x=abc', v2: '#v2=' + b64(JSON.stringify(good)), cut: ('#' + CS.encode(c1)).slice(0, 40), badB64: '#v1=@@@',
  notArray: hashOf({ a: 1 }), short: hashOf(good.slice(0, 6)), ver2: hashOf([2].concat(good.slice(1))),
  oneMember: hashOf([1, '', '', 0, [['A', 0]], [[0, '', 100]], []]), fiveMembers: hashOf([1, '', '', 0, [['A', 0], ['B', 0], ['C', 0], ['D', 0], ['E', 0]], [[0, '', 100]], []]),
  whoOut: hashOf([1, '', '', 0, [['A', 0], ['B', 0]], [[2, '', 100]], []]), whoNeg: hashOf([1, '', '', 0, [['A', 0], ['B', 0]], [[-1, '', 100]], []]),
  amtStr: hashOf([1, '', '', 0, [['A', 0], ['B', 0]], [[0, '', '100']], []]), amtNeg: hashOf([1, '', '', 0, [['A', 0], ['B', 0]], [[0, '', -1]], []]),
  amtFrac: hashOf([1, '', '', 0, [['A', 0], ['B', 0]], [[0, '', 1.5]], []]), amtBig: hashOf([1, '', '', 0, [['A', 0], ['B', 0]], [[0, '', 10000000]], []]),
  amtNull: hashOf([1, '', '', 0, [['A', 0], ['B', 0]], [[0, '', null]], []]),
  noSales: hashOf([1, '', '', 0, [['A', 0], ['B', 0]], [], []]), manySales: hashOf([1, '', '', 0, [['A', 0], ['B', 0]], Array(9).fill([0, '', 1]), []]),
  manyExp: hashOf([1, '', '', 0, [['A', 0], ['B', 0]], [[0, '', 1]], Array(11).fill([0, '', 1])]),
  pct99: hashOf([1, '', '', 1, [['A', 50], ['B', 49]], [[0, '', 1]], []]), pctInEqual: hashOf([1, '', '', 0, [['A', 50], ['B', 50]], [[0, '', 1]], []]),
  mode2: hashOf([1, '', '', 2, [['A', 0], ['B', 0]], [[0, '', 1]], []]), dupName: hashOf([1, '', '', 0, [['A', 0], ['A', 0]], [[0, '', 1]], []]),
  emptyName: hashOf([1, '', '', 0, [['', 0], ['B', 0]], [[0, '', 1]], []]), longName: hashOf([1, '', '', 0, [['あいうえおかきくけこさ', 0], ['B', 0]], [[0, '', 1]], []]),
  badDate: hashOf([1, '', '2026-02-30', 0, [['A', 0], ['B', 0]], [[0, '', 1]], []]), dateNum: hashOf([1, '', 20261025, 0, [['A', 0], ['B', 0]], [[0, '', 1]], []]),
  link: hashOf([1, 'https://evil.example', '', 0, [['A', 0], ['B', 0]], [[0, '', 1]], []]), bankInItem: hashOf([1, '', '', 0, [['A', 0], ['B', 0]], [[0, '振込先 みずほ銀行', 1]], []]),
  digits: hashOf([1, '', '', 0, [['A', 0], ['B', 0]], [[0, '1234567', 1]], []]), ctrl: hashOf([1, 'a\nb', '', 0, [['A', 0], ['B', 0]], [[0, '', 1]], []]),
  rowLen: hashOf([1, '', '', 0, [['A', 0], ['B', 0]], [[0, '', 1, 9]], []]), tooLong: '#v1=' + 'A'.repeat(4001), query: '#' + CS.encode(c1) + '&x=1'
};
Object.keys(broken).forEach(k => eq('S8 ' + k, CS.decodeHash(broken[k]), null));

// S9 入力の境界と止める文字
const E = (d) => CS.toConfig(d).errors;
const base = (over) => Object.assign(draft(['A', 'B'], 0, [[0, '', 100]], []), over);
eq('S9 event 30', E(base({ event: 'あ'.repeat(30) })), []);
eq('S9 event 31', E(base({ event: 'あ'.repeat(31) })), ['イベント名は30字までです']);
eq('S9 name 10', E(draft(['あ'.repeat(10), 'B'], 0, [[0, '', 1]], [])), []);
eq('S9 name 11', E(draft(['あ'.repeat(11), 'B'], 0, [[0, '', 1]], [])), ['1人目の呼び名は10字までです']);
eq('S9 item 20', E(draft(['A', 'B'], 0, [[0, 'あ'.repeat(20), 1]], [])), []);
eq('S9 item 21', E(draft(['A', 'B'], 0, [[0, 'あ'.repeat(21), 1]], [])), ['売上1の内容は20字までです']);
eq('S9 amt 0', E(draft(['A', 'B'], 0, [[0, '', '0']], [])), []);
eq('S9 amt max', E(draft(['A', 'B'], 0, [[0, '', '9,999,999']], [])), []);
eq('S9 amt over', E(draft(['A', 'B'], 0, [[0, '', '10000000']], [])), ['売上1の金額は0〜9,999,999の整数で入れてください']);
eq('S9 amt full-width', CS.toConfig(draft(['A', 'B'], 0, [[0, '', '１２，３４５円']], [])).cfg.sales[0][2], 12345);
eq('S9 amt neg', E(draft(['A', 'B'], 0, [[0, '', '-5']], [])), ['売上1の金額は0〜9,999,999の整数で入れてください']);
eq('S9 amt frac', E(draft(['A', 'B'], 0, [[0, '', '1.5']], [])), ['売上1の金額は0〜9,999,999の整数で入れてください']);
eq('S9 amt blank with item', E(draft(['A', 'B'], 0, [[0, '現金', '']], [])), ['売上1の金額を入れてください']);
eq('S9 who unset', E(draft(['A', 'B'], 0, [[-1, '', 1]], [])), ['売上1の受け取った人を選んでください']);
eq('S9 exp who unset', E(draft(['A', 'B'], 0, [[0, '', 1]], [[-1, '', 1]])), ['経費1の立て替えた人を選んでください']);
eq('S9 dup name', E(draft(['A', 'A'], 0, [[0, '', 1]], [])), ['呼び名「A」が重なっています。呼び分けてください']);
eq('S9 empty name', E(draft(['A', ''], 0, [[0, '', 1]], [])), ['2人目の呼び名を入れてください']);
eq('S9 bad date', E(base({ date: '2026-02-30' })), ['開催日の形が正しくありません']);
eq('S9 sales 9', E(draft(['A', 'B'], 0, Array(9).fill([0, '', 1]), [])), ['売上は8件までです']);
eq('S9 exp 11', E(draft(['A', 'B'], 0, [[0, '', 1]], Array(11).fill([0, '', 1]))), ['経費は10件までです']);
const stop = ['https://a.jp', 'www.example', 'example.com', 'ネイル.com', 'bit.ly/abc', 'a@b', '090-1234-5678', '０９０１２３４５６７８', '〇九〇一二三四五六七八', '+81 90 1234',
  '振込先', 'お振り込み', 'ふりこみ', '口座', '普通 1234567', 'みずほ銀行', '信用金庫', 'ゆうちょ', '通帳', '暗証', '支店', '名義', 'LINE ID', '1234567', '12-345-67'];
stop.forEach(s => eq('S9 stop ' + s, CS.blockedReason(s) !== '', true));
const pass9 = ['材料費', '会場代 2時間', 'チラシ500枚', '当日の現金', '事前の決済', 'PayPayの売上', '2026-10-25の会場代', '10/25 マルシェ', 'カード決済', '手数料 3.6%', '交通費（往復）', '123456'];
pass9.forEach(s => eq('S9 pass ' + s, CS.blockedReason(s), ''));
eq('S9 msg money', E(draft(['A', 'B'], 0, [[0, '振込', 1]], [])), ['売上1の内容：振込先や口座に関わる言葉は入れられません（このページはお金の振込を扱いません）']);
eq('S9 msg number', E(draft(['A', 'B'], 0, [[0, '1234567', 1]], [])), ['売上1の内容に7桁以上の数字（電話番号・口座番号など）らしい文字は入れられません']);

// S10 XSS の文字は止まるか、文字のまま設定に入る（表示は textContent。画面での確認は check.js）
const x1 = CS.toConfig(draft(['<b>', 'B'], 0, [[0, '<i onmouseover=a()>', 1]], [], { event: '"><script>' }));
eq('S10 xss kept as text', x1.cfg ? [x1.cfg.event, x1.cfg.members[0][0], x1.cfg.sales[0][1]] : x1.errors, ['"><script>', '<b>', '<i onmouseover=a()>']);

// S11 明細の文（Card1）
eq('S11 card1 message', CS.message(c1, 'https://x.test/#v1=abc'), [
  '【秋の手づくりワークショップ 売上の分け方】',
  '開催日 2026年10月25日（日）',
  '売上 80,000円（さくら 38,000円／みどり 42,000円 を受け取り）',
  '経費 27,000円（さくら 9,800円／みどり 17,200円 を立て替え）',
  '残り 53,000円を さくら 60%・みどり 40% で分けると',
  'さくら 31,800円／みどり 21,200円',
  '精算',
  'みどり → さくら 3,600円',
  '明細のリンク',
  'https://x.test/#v1=abc'].join('\n'));
eq('S11 card2 message', CS.message(c2, '').split('\n'), [
  '【売上の分け方】', '売上 45,000円（あおい 45,000円 を受け取り）', '経費 14,000円（ひなた 12,000円／れん 2,000円 を立て替え）',
  '残り 31,000円を 3人で均等に分けると', 'あおい 10,334円／ひなた 10,333円／れん 10,333円', '精算', 'あおい → ひなた 22,333円', 'あおい → れん 12,333円']);
eq('S11 deficit message line', CS.message(c4, '').split('\n')[4], 'A 7,500円／B 7,500円 の負担');

// 下書きの読み込み（壊れた保存内容でも落ちない）
eq('draft null', J(CS.sanitizeDraft(null)), J(CS.emptyDraft()));
eq('draft junk', J(CS.sanitizeDraft({ members: [{ name: 1 }], sales: 'x', mode: 'a' })), J(CS.emptyDraft()));
const sd = CS.sanitizeDraft({ members: [{ name: 'A' }, { name: 'B' }], sales: [{ who: 5, item: 'x', amt: 3 }], exp: [{ who: 1, item: 'y', amt: '2' }], mode: 1 });
eq('draft who clamp', J([sd.sales[0].who, sd.sales[0].amt, sd.exp[0].who, sd.mode]), [0, '3', 1, 1]);

// 最大入力のURLの長さ（参考値）
const maxD = draft(['あ'.repeat(10), 'い'.repeat(10), 'う'.repeat(10), 'え'.repeat(10)].map((n, i) => [n, 25]), 1,
  Array(8).fill(0).map((_, i) => [i % 4, 'か'.repeat(20), 9999999]), Array(10).fill(0).map((_, i) => [i % 4, 'き'.repeat(20), 9999999]), { event: 'さ'.repeat(30), date: '2026-10-25' });
const maxUrl = CS.makeUrl('https://nncf123nncf-oss.github.io/cohost-split/', cfgOf(maxD));
console.log('max url length', maxUrl.length, '/ sample url length', CS.makeUrl('https://nncf123nncf-oss.github.io/cohost-split/', c1).length);

console.log('pass', pass, 'fail', fail);
process.exit(fail ? 1 : 0);
