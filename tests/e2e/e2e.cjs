// Browser-level test. Usage: node e2e.cjs <server-url> <fixtures-dir> <out-dir>
// The server must be running in demo mode (VERSIGHT_MOCK=1). Fixtures are real .docx files.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const [BASE, FIX, OUT] = process.argv.slice(2);
if (!BASE || !FIX || !OUT) { console.error('usage: node e2e.cjs <url> <fixtures> <out>'); process.exit(2); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + (extra === undefined ? '' : extra)));
  if (!cond) failures++;
};

/* Load the page for real (HTML, CSS, vendor script and app.js all come from the server). */
async function load(hook) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + ((e.detail && e.detail.stack) || e.message)));
  vc.on('error', e => errors.push('console.error: ' + e));
  const dom = await JSDOM.fromURL(BASE + '/', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.__downloads = []; w.__calls = [];
      w.matchMedia = () => ({ matches: false });
      w.Element.prototype.scrollIntoView = function () {};
      w.URL.createObjectURL = blob => { w.__downloads.push({ blob }); return 'blob:test'; };
      w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = function () {
        const last = w.__downloads[w.__downloads.length - 1];
        if (last) last.name = this.download;
      };
      w.fetch = (u, o) => {
        const url = new URL(u, w.location.href).href;
        o = o ? { ...o } : {};
        if (o.signal) { const c = new AbortController(); o.signal.addEventListener('abort', () => c.abort()); o.signal = c.signal; }
        w.__calls.push({ url, body: o.body ? safeParse(o.body) : null });
        return hook ? hook(url, o, fetch) : fetch(url, o);
      };
    },
  });
  const w = dom.window;
  if (w.document.readyState !== 'complete') await new Promise(r => w.addEventListener('load', r));
  await sleep(250);
  return { w, d: w.document, errors };
}
const safeParse = s => { try { return JSON.parse(s); } catch (e) { return null; } };
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

async function bytesOf(w, blob) {
  if (blob.arrayBuffer) return Buffer.from(await blob.arrayBuffer());
  return new Promise(res => { const fr = new w.FileReader(); fr.onload = () => res(Buffer.from(fr.result)); fr.readAsArrayBuffer(blob); });
}
function fileFrom(w, name, buf) {
  const ab = new w.Uint8Array(buf).buffer; // buffer created inside the page's realm, as a real File would give
  return { name, size: buf.length, arrayBuffer: async () => ab, text: async () => buf.toString('utf8') };
}

(async () => {
  /* ---------- 1. normal load, demo-mode server ---------- */
  let { w, d, errors } = await load();
  const $ = s => d.querySelector(s), $$ = s => Array.from(d.querySelectorAll(s));
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const ed = $('#editor');
  const liCount = () => Array.from(ed.children).filter(e => !e.classList.contains('sg-ghost')).reduce((n, e) => n + e.querySelectorAll('li').length, 0);
  const blockById = id => Array.from(ed.children).find(e => e.getAttribute('data-b') === id);

  check('page, css and scripts loaded from the server', !!window_has(w, 'mammoth') && getComputedStyle0(w, $('#editor')) !== null);
  check('sample document loaded with block ids', ed.children.length === 12 && ed.children[0].getAttribute('data-b') === 'b1');
  check('demo-mode notice shown, not an error', !$('#aiNote').hidden && $('#aiNote').classList.contains('info') && /Demo mode/.test($('#aiNote').textContent), $('#aiNote').textContent);
  check('status bar names the AI', $('#stAI').textContent === 'Demo mode', $('#stAI').textContent);
  check('Open button exists', !!$('#btnOpen'));

  /* ---------- 2. real server round trip (demo-mode answers) ---------- */
  $('#ask').value = 'Fix the procedure steps';
  click($('#btnSend')); await sleep(500);
  const call = w.__calls.find(c => c.url.endsWith('/api/assist'));
  check('request carries blocks, rules, template, no prompt text', call && call.body.blocks.length === 12 && call.body.rules.length === 5 && call.body.template.length === 7 && !('prompt' in call.body));
  check('request blocks carry ids and clean html', call.body.blocks[9].id === 'b10' && call.body.blocks[9].html.startsWith('<ol>') && !/data-b|sg-/.test(JSON.stringify(call.body.blocks)));
  let cards = $$('#sugList .sug');
  check('server answer became one suggestion for the steps', cards.length === 1 && /3\.0 mm/.test(cards[0].textContent), cards.length + ' ' + (cards[0] && cards[0].textContent));
  check('ghost shown in document, old block marked', $$('.sg-ghost', ed).length === 1 && blockById('b10').classList.contains('sg-del'));
  check('chat reply shows demo label', /Demo mode/.test($('#chat').textContent));
  check('suggestion names its rule', /s1/.test(cards[0].textContent));

  click($$('.sg-ghost', ed)[0].querySelector('[data-act="accept"]')); await sleep(50);
  check('accept applied the edit (first step now starts with a verb, unit spaced)', /<li>Place the cell/.test(blockById('b10') ? blockById('b10').innerHTML : ed.innerHTML) && /3\.0 mm/.test(ed.textContent));
  check('toast offers undo', $('#toast button') && $('#toast button').textContent === 'Undo');
  click($('#toast button')); await sleep(50);
  check('undo restored the original step text', /The operator should place/.test(ed.textContent) && /3\.0mm/.test(ed.textContent));

  // user edits the block while a suggestion is pending -> stale, cannot be applied
  const b10 = blockById('b10');
  check('suggestion survived undo', $$('.sg-ghost', ed).length === 1);
  b10.querySelector('li').textContent = 'Operator edits this by hand.';
  ed.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(550);
  check('hand edit marks the suggestion stale', $$('.sg-ghost.stale', ed).length === 1 && $$('#sugList .tag.stale').length === 1);
  click($('#rejAll')); await sleep(30);
  check('reject all clears suggestions', $$('#sugList .sug').length === 0 && $('#sugBadge').hidden);

  // delete flow through the real server: add an empty paragraph, ask to clean up
  ed.insertAdjacentHTML('beforeend', '<p><br></p>');
  ed.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(50);
  $('#ask').value = 'Remove empty paragraphs'; click($('#btnSend')); await sleep(500);
  const del = $$('#sugList .sug').find(c => /Delete/.test(c.textContent));
  check('server proposed deleting the empty paragraph', !!del);
  const realBlocks = () => Array.from(ed.children).filter(e => !e.classList.contains('sg-ghost')).length;
  const blocksBefore = realBlocks();
  click($('#accAll')); await sleep(50);
  check('accept all removed exactly the empty paragraph', realBlocks() === blocksBefore - 1 && $$('.sg-ghost', ed).length === 0, blocksBefore + ' -> ' + realBlocks());

  // ---------- canned answers to cover insert, delete, bad ids, hostile html (via fetch hook in a second page) ----------
  {
    const canned = { reply: 'Done.', edits: [
      { op: 'replace', id: 'b10', html: '<ol><li>Place the cell on the fixture.</li><li>Check the seal.</li></ol>', why: 'Imperative', rule: 's1' },
      { op: 'insert_after', id: 'b6', html: '<h2>Responsibilities</h2><p>Operators inspect.</p>', why: 'Template section missing' },
      { op: 'delete', id: 'b11', why: 'Heading re-added later' },
      { op: 'replace', id: 'b999', html: '<p>x</p>', why: 'unknown block' },
      { op: 'replace', id: 'b4', html: '<p><img src=x onerror=alert(1)>This work instruction describes inspection.<script>alert(1)</script></p>', why: 'sanitiser' },
    ], dropped: 2 };
    const p = await load((url, o, real) => url.endsWith('/api/assist') ? Promise.resolve(json(200, canned)) : real(url, o));
    const $2 = s => p.d.querySelector(s), $$2 = s => Array.from(p.d.querySelectorAll(s));
    const ed2 = $2('#editor');
    $2('#ask').value = 'anything'; $2('#btnSend').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true })); await sleep(400);
    check('canned: 4 usable suggestions, unknown id skipped', $$2('#sugList .sug').length === 4, $$2('#sugList .sug').length);
    check('canned: hostile html stripped', !ed2.innerHTML.includes('onerror') && !ed2.innerHTML.includes('<script') && !ed2.innerHTML.includes('<img'));
    check('canned: server-dropped edits are reported to the user', /2 proposed edits were ignored/.test($2('#chat').textContent), $2('#chat').textContent);
    $2('#accAll').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true })); await sleep(60);
    const h2s = Array.from(ed2.querySelectorAll('h2')).map(h => h.textContent);
    check('canned: insert landed after Scope body, delete removed Revision History heading', h2s.includes('Responsibilities') && !h2s.includes('Revision History') && h2s.indexOf('Responsibilities') === h2s.indexOf('Scope') + 1, h2s.join('|'));
    check('canned: template check finds Responsibilities', !/–\s*Responsibilities/.test($2('#tpl').textContent) && !Array.from(p.d.querySelectorAll('#tpl div')).some(r => r.textContent.includes('Responsibilities') && r.querySelector('.no')));
    check('canned: no page errors', p.errors.length === 0, p.errors.join('\n'));
    p.w.close();
  }

  /* ---------- 3. error paths ---------- */
  {
    const modes = {
      key: () => Promise.resolve(json(503, { error: { code: 'no_api_key', message: 'The server has no Anthropic API key. Set ANTHROPIC_API_KEY and restart.' } })),
      net: () => Promise.reject(new TypeError('fetch failed')),
      slow: (url, o) => new Promise((res, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    };
    for (const [mode, handler] of Object.entries(modes)) {
      const p = await load((url, o, real) => url.endsWith('/api/assist') ? handler(url, o) : real(url, o));
      const $2 = s => p.d.querySelector(s);
      $2('#ask').value = 'do it'; $2('#btnSend').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true })); await sleep(250);
      if (mode === 'slow') {
        check('slow: Send turned into Stop while working', $2('#btnSend').textContent === 'Stop');
        $2('#btnSend').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true })); await sleep(150);
        check('slow: stopping works', /Stopped/.test($2('#chat').textContent) && $2('#btnSend').textContent === 'Send', $2('#chat').textContent);
      } else if (mode === 'key') {
        check('server message is shown for a missing key', /ANTHROPIC_API_KEY/.test($2('#chat').textContent) && $2('#chat .msg.err'), $2('#chat').textContent);
      } else {
        check('network failure explains the server is unreachable', /Could not reach the Versight server/.test($2('#chat').textContent), $2('#chat').textContent);
      }
      p.w.close();
    }
    const nokey = await load((url, o, real) => url.endsWith('/api/health') ? Promise.resolve(json(200, { ok: true, ai: false, mock: false, model: 'claude-sonnet-5-5' })) : real(url, o));
    check('no key: notice says what to set', /ANTHROPIC_API_KEY/.test(nokey.d.querySelector('#aiNote').textContent) && !nokey.d.querySelector('#aiNote').hidden);
    check('no key: editing still works', nokey.d.querySelector('#editor').getAttribute('contenteditable') === 'true');
    nokey.w.close();
    const down = await load((url, o, real) => url.endsWith('/api/health') ? Promise.reject(new TypeError('down')) : real(url, o));
    check('server down: notice says so', /Cannot reach the Versight server/.test(down.d.querySelector('#aiNote').textContent));
    down.w.close();
    const live = await load((url, o, real) => url.endsWith('/api/health') ? Promise.resolve(json(200, { ok: true, ai: true, mock: false, model: 'claude-sonnet-5-5' })) : real(url, o));
    check('real-model mode: no notice, model shown', live.d.querySelector('#aiNote').hidden && live.d.querySelector('#stAI').textContent === 'Model: claude-sonnet-5-5');
    live.w.close();
  }

  /* ---------- 4. teach it: real .docx files through mammoth, then the real learn endpoint ---------- */
  const docxFiles = fs.readdirSync(FIX).filter(f => f.endsWith('.docx')).sort();
  check('fixtures present', docxFiles.length >= 3, docxFiles.join());
  const fi = $('#fileIn');
  Object.defineProperty(fi, 'files', { value: docxFiles.map(f => fileFrom(w, f, fs.readFileSync(path.join(FIX, f)))), configurable: true });
  fi.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(900);
  check('docx files were read by mammoth', $$('#files .file').length === docxFiles.length && /\d+ words/.test($('#files').textContent), $('#upNote').textContent + ' | ' + $('#files').textContent);
  check('shared headings found in real docx', $('#heads').textContent.includes('Purpose') && $('#heads').textContent.includes('Procedure'), $('#heads').textContent);
  check('learn button enabled', $('#btnLearn').disabled === false);
  click($('#btnLearn')); await sleep(700);
  const lc = w.__calls.find(c => c.url.endsWith('/api/learn'));
  check('learn request carries digests (numbers, headings, steps), not documents', lc && lc.body.docs.length === docxFiles.length && lc.body.docs[0].heads.length > 0 && lc.body.docs[0].ol >= 2 && lc.body.docs[0].steps.length > 0 && JSON.stringify(lc.body).length < 20000, lc && JSON.stringify(lc.body).slice(0, 300));
  const rules = $$('#rules .rule');
  check('learned rules replaced the starter rules', rules.length >= 3 && /^Learned/.test($('#rulesNote').textContent) && !rules.some(r => r.getAttribute('data-rid').startsWith('s')), rules.length + ' ' + $('#rulesNote').textContent);
  check('rules everyone follows are HARD', rules.every(r => r.querySelector('.str').textContent === 'HARD'));
  check('template learned from headings', /Purpose/.test($('#tpl').textContent) && /Procedure/.test($('#tpl').textContent) && !/Title/.test($('#tpl').textContent), $('#tpl').textContent);
  check('voice shown', !$('#secVoice').hidden);
  $('#newRule').value = 'Use WI in titles'; click($('#btnAddRule')); click($('#btnLearn')); await sleep(600);
  check('custom rule survives re-learning', $('#rules').textContent.includes('Use WI in titles'));

  /* ---------- 5. Open a .docx into the editor ---------- */
  const oi = $('#openIn');
  Object.defineProperty(oi, 'files', { value: [fileFrom(w, docxFiles[0], fs.readFileSync(path.join(FIX, docxFiles[0])))], configurable: true });
  oi.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(800);
  check('Open replaced the document with the docx content', /WI-001/.test(ed.textContent) && !/WI-DEMO-014/.test(ed.textContent) && !!ed.querySelector('ol li') && !!ed.querySelector('table') && ed.querySelectorAll('h2').length >= 4, ed.textContent.slice(0, 120));
  check('title taken from file name', $('#docTitle').value === docxFiles[0].replace(/\.docx$/, ''), $('#docTitle').value);
  check('blocks have ids again', Array.from(ed.children).every(e => /^b\d+$/.test(e.getAttribute('data-b') || '')));
  click($('#toast button')); await sleep(50);
  check('undo brings the previous document and title back', /WI-DEMO-014/.test(ed.textContent) && !/WI-001/.test(ed.textContent) && !/wi-1/.test($('#docTitle').value), $('#docTitle').value);

  /* ---------- 6. exports ---------- */
  click($('#expHtml')); await sleep(80);
  const htmlDl = w.__downloads.find(x => x.name && x.name.endsWith('.html'));
  const htmlText = htmlDl ? (await bytesOf(w, htmlDl.blob)).toString('utf8') : '';
  check('html export downloads a clean file', htmlDl && !/data-b|sg-ghost/.test(htmlText) && /<table border="1"/.test(htmlText));
  click($('#expDocx')); await sleep(900);
  const docxDl = w.__downloads.find(x => x.name && x.name.endsWith('.docx'));
  const docxBytes = docxDl ? await bytesOf(w, docxDl.blob) : Buffer.alloc(0);
  check('docx export downloads a real zip from the server', docxBytes.length > 2000 && docxBytes.slice(0, 2).toString() === 'PK', docxBytes.length);
  const ec = w.__calls.find(c => c.url.endsWith('/api/export/docx'));
  check('export sends html without internal markers', ec && !/data-b|sg-ghost|sg-del/.test(ec.body.html) && ec.body.title.length > 0);
  if (docxBytes.length) fs.writeFileSync(path.join(OUT, 'exported.docx'), docxBytes);

  /* ---------- 7. persistence + scope ---------- */
  await sleep(700);
  const saved = JSON.parse(w.localStorage.getItem('vs.doc'));
  check('draft saved in browser without internal ids', saved && saved.html.length > 100 && !/data-b|sg-ghost/.test(saved.html));
  const g = JSON.parse(w.localStorage.getItem('vs.guide'));
  check('style guide saved', g && g.rules.length >= 4 && g.docs.length === docxFiles.length);
  const bb = ed.children[1];
  const range = d.createRange(); range.selectNodeContents(bb);
  const sel = w.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  d.dispatchEvent(new w.Event('selectionchange')); await sleep(30);
  check('selection becomes the scope', $('#scopeLbl').textContent.startsWith('selection'), $('#scopeLbl').textContent);
  w.__calls.length = 0; $('#ask').value = 'Tighten this'; click($('#btnSend')); await sleep(400);
  const sc = w.__calls.find(c => c.url.endsWith('/api/assist'));
  check('scoped request sends only the selected block id as scope', sc && sc.body.scope_ids.length === 1 && sc.body.scope_ids[0] === bb.getAttribute('data-b'), sc && JSON.stringify(sc.body.scope_ids));
  check('learned rules (not starter) are what the request carries', sc && sc.body.rules.length >= 4 && sc.body.rules.every(r => r.id.startsWith('r') || r.id.startsWith('c')) && sc.body.voice.length > 0);

  check('no page errors in the main session', errors.length === 0, errors.join('\n'));
  w.close();
  console.log(failures ? `\n${failures} FAILED` : '\nall browser checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(2); });

function window_has(w, name) { return typeof w[name] !== 'undefined'; }
function getComputedStyle0(w, el) { try { return w.getComputedStyle(el); } catch (e) { return null; } }
