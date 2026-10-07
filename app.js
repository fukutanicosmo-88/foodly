'use strict';
/* foodly — 家にある食材と買うリストを管理する自分用Webアプリ
 * データはこの端末の localStorage にだけ保存する。 */

const STORE_KEY = 'foodly-v1';
const WARN_DAYS = 3;
const DEFAULT_FREEZER_DAYS = 30;
const STORAGE_LABEL = { fridge: '冷蔵', freezer: '冷凍', pantry: '常温' };
const STORAGE_ORDER = ['fridge', 'freezer', 'pantry'];
const ST_CODE = { r: 'fridge', f: 'freezer', p: 'pantry' };
const SCANNER_SRC = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';

/* ───────── 食材マスタ ───────── */
function norm(s) {
  return (s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
const MASTER = FOODS.map(([name, yomi, st, days, freezerDays, aliases]) => ({
  id: name, name, yomi, storage: ST_CODE[st], days, freezerDays,
  keys: [name, yomi, ...(aliases || [])].map(norm),
}));
const MASTER_BY_ID = new Map(MASTER.map((m) => [m.id, m]));

function findMasterExact(name) {
  const n = norm(name);
  if (!n) return null;
  return MASTER.find((m) => norm(m.name) === n) || MASTER.find((m) => m.keys.includes(n)) || null;
}
function searchMaster(q) {
  const n = norm(q);
  if (!n) return [];
  const starts = [], contains = [];
  for (const m of MASTER) {
    if (m.keys.some((k) => k.startsWith(n))) starts.push(m);
    else if (m.keys.some((k) => k.includes(n))) contains.push(m);
  }
  return starts.concat(contains).slice(0, 8);
}

/* ───────── 日付 ───────── */
function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayStr() { return fmt(new Date()); }
function parse(str) { const [y, m, d] = str.split('-').map(Number); return { y, m, d }; }
function addDays(str, n) { const { y, m, d } = parse(str); return fmt(new Date(y, m - 1, d + n)); }
function daysLeft(str) {
  const a = parse(str), b = parse(todayStr());
  return Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 864e5);
}
function jpDate(str) { const { m, d } = parse(str); return `${m}月${d}日`; }
function statusOf(item) {
  if (!item.expiry) return { kind: 'unset', text: '期限未設定' };
  const n = daysLeft(item.expiry);
  if (n < 0) return { kind: 'over', text: `${-n}日超過`, n };
  if (n === 0) return { kind: 'today', text: '今日まで', n };
  if (n <= WARN_DAYS) return { kind: 'warn', text: `あと${n}日`, n };
  return { kind: 'ok', text: `${jpDate(item.expiry)}まで`, n };
}
function isAlert(item) { const s = statusOf(item); return s.kind === 'warn' || s.kind === 'today' || s.kind === 'over'; }

/* ───────── 保存 ───────── */
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.items)) return d;
    }
  } catch (e) { /* 読めない場合は空で始める */ }
  return { version: 1, items: [] };
}
let state = load();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('保存できませんでした。空き容量を確認してください。'); }
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function snapshot() { return JSON.stringify(state.items); }
function restore(snap) { state.items = JSON.parse(snap); save(); render(); }
const byId = (id) => state.items.find((i) => i.id === id);
const homeItems = () => state.items.filter((i) => i.list === 'home');
const buyItems = () => state.items.filter((i) => i.list === 'buy');

/* ───────── 操作 ───────── */
// 家にある食材に入ったときの期限計算
function arriveHome(item) {
  const m = item.masterId ? MASTER_BY_ID.get(item.masterId) : null;
  const t = todayStr();
  item.list = 'home';
  item.movedAt = t;
  item.prev = null;
  if (m) {
    item.storage = m.storage;
    item.expiry = addDays(t, m.days);
  } else {
    item.storage = item.storage || 'fridge';
    item.expiry = null;
  }
  item.frozen = item.storage === 'freezer';
}

function addItem(list, name, { masterId = null, manualExpiry = false } = {}) {
  const m = manualExpiry ? null : (masterId ? MASTER_BY_ID.get(masterId) : findMasterExact(name));
  const item = {
    id: uid(), name, list, staple: false,
    masterId: m ? m.id : null,
    storage: m ? m.storage : 'fridge',
    expiry: null, frozen: false, prev: null,
    createdAt: todayStr(), movedAt: todayStr(),
  };
  if (list === 'home') arriveHome(item);
  state.items.push(item);
  save();
  render();
  announce(`「${name}」を${list === 'buy' ? '買うリスト' : '家にある食材'}に追加しました`);
  if (list === 'home' && !item.expiry) openEdit(item.id, '消費期限を入力してください');
}

function purchase(id) {
  const item = byId(id);
  if (!item) return;
  const snap = snapshot();
  arriveHome(item);
  save();
  render();
  toast(`「${item.name}」を家にある食材に移しました`, () => restore(snap));
}

function addToBuyFrom(item) {
  const exists = buyItems().some((b) => norm(b.name) === norm(item.name));
  if (exists) return false;
  const m = item.masterId ? MASTER_BY_ID.get(item.masterId) : null;
  state.items.push({
    id: uid(), name: item.name, list: 'buy', staple: item.staple, masterId: item.masterId,
    storage: m ? m.storage : (item.prev ? item.prev.storage : (item.storage === 'freezer' ? 'fridge' : item.storage)),
    expiry: null, frozen: false, prev: null, createdAt: todayStr(), movedAt: todayStr(),
  });
  return true;
}

async function useUp(id) {
  const item = byId(id);
  if (!item) return;
  const snap = snapshot();
  const others = homeItems().filter((i) => i.id !== id && norm(i.name) === norm(item.name));
  state.items = state.items.filter((i) => i.id !== id);

  if (others.length) {
    save(); render();
    toast(`「${item.name}」を1つ使い切りました(残り${others.length})`, () => restore(snap));
    return;
  }
  if (item.staple) {
    addToBuyFrom(item);
    save(); render();
    toast(`「${item.name}」を買うリストに戻しました`, () => restore(snap));
    return;
  }
  save(); render();
  const ok = await askConfirm({
    title: '使い切りました',
    message: `「${item.name}」を買うリストに入れますか?`,
    ok: '入れる', cancel: '入れない',
  });
  if (ok) {
    addToBuyFrom(item);
    save(); render();
    toast(`「${item.name}」を買うリストに入れました`, () => restore(snap));
  } else {
    toast(`「${item.name}」を使い切りました`, () => restore(snap));
  }
}

function removeItem(id) {
  const item = byId(id);
  if (!item) return;
  const snap = snapshot();
  state.items = state.items.filter((i) => i.id !== id);
  save(); render();
  toast(`「${item.name}」を削除しました`, () => restore(snap));
}

function toggleStaple(id) {
  const item = byId(id);
  if (!item) return;
  item.staple = !item.staple;
  save(); render();
  announce(item.staple ? `「${item.name}」を定番にしました` : `「${item.name}」の定番を外しました`);
  focusAction(id, 'staple');
}

function setFrozen(id, on) {
  const item = byId(id);
  if (!item) return;
  if (on) {
    const m = item.masterId ? MASTER_BY_ID.get(item.masterId) : null;
    item.prev = { storage: item.storage, expiry: item.expiry };
    item.storage = 'freezer';
    item.frozen = true;
    item.expiry = addDays(todayStr(), (m && m.freezerDays) || DEFAULT_FREEZER_DAYS);
    announce(`「${item.name}」を冷凍しました。期限は${jpDate(item.expiry)}です`);
  } else {
    if (item.prev) { item.storage = item.prev.storage; item.expiry = item.prev.expiry; }
    else item.storage = 'fridge';
    item.frozen = false;
    item.prev = null;
    announce(`「${item.name}」の冷凍を解除しました`);
  }
  save(); render();
  focusAction(id, 'freeze');
}

/* ───────── 描画 ───────── */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = {
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1L3.2 9.6l6.1-.8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  scan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M7.5 8v8M10.5 8v8M13 8v8M16.5 8v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

let currentView = 'buy';
let recipeMode = false;
const recipeSel = new Set();

function renderBuy() {
  const items = buyItems();
  const ul = document.getElementById('buy-list');
  ul.innerHTML = items.map((i) => `
    <li class="row">
      <label class="check"><input type="checkbox" data-action="purchase" data-id="${i.id}" aria-label="「${esc(i.name)}」を買った"></label>
      <button type="button" class="name-btn" data-action="edit" data-id="${i.id}" aria-label="${esc(i.name)}を編集">${esc(i.name)}</button>
      <button type="button" class="icon-btn staple-btn" data-action="staple" data-id="${i.id}" aria-pressed="${i.staple}" aria-label="「${esc(i.name)}」を定番にする">${ICON.star}</button>
      <button type="button" class="icon-btn" data-action="delete" data-id="${i.id}" aria-label="「${esc(i.name)}」を削除">${ICON.trash}</button>
    </li>`).join('');
  document.getElementById('buy-empty').hidden = items.length > 0;
}

function sortByExpiry(a, b) {
  if (!a.expiry && !b.expiry) return a.name.localeCompare(b.name, 'ja');
  if (!a.expiry) return 1;
  if (!b.expiry) return -1;
  return a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : a.name.localeCompare(b.name, 'ja');
}

function renderHomeItem(i) {
  const s = statusOf(i);
  const m = i.masterId ? MASTER_BY_ID.get(i.masterId) : null;
  const nativeFrozen = i.frozen && !i.prev && m && m.storage === 'freezer';
  const statusHtml = s.kind === 'unset'
    ? `<button type="button" class="status status-unset" data-action="edit" data-id="${i.id}">期限未設定</button>`
    : `<span class="status status-${s.kind}">${esc(s.text)}</span>`;
  const select = recipeMode
    ? `<label class="item-select"><input type="checkbox" data-action="select" data-id="${i.id}" ${recipeSel.has(i.id) ? 'checked' : ''} aria-label="「${esc(i.name)}」をレシピに使う"></label>`
    : '';
  return `
    <li class="item is-${s.kind}">
      <div class="item-top">
        ${select}
        <button type="button" class="name-btn" data-action="edit" data-id="${i.id}" aria-label="${esc(i.name)}、${esc(s.text)}。編集する">${esc(i.name)}</button>
        ${statusHtml}
      </div>
      <div class="item-actions">
        <button type="button" class="used-btn" data-action="useup" data-id="${i.id}" aria-label="「${esc(i.name)}」を使い切った">使い切り</button>
        <label class="toggle"><input type="checkbox" data-action="freeze" data-id="${i.id}" ${i.frozen ? 'checked' : ''} ${nativeFrozen ? 'disabled' : ''} aria-label="「${esc(i.name)}」を冷凍した"><span aria-hidden="true">冷凍</span></label>
        <button type="button" class="toggle toggle-btn" data-action="staple" data-id="${i.id}" aria-pressed="${i.staple}" aria-label="「${esc(i.name)}」を定番にする">${ICON.star}<span aria-hidden="true">定番</span></button>
        <span class="spacer"></span>
        <button type="button" class="icon-btn" data-action="delete" data-id="${i.id}" aria-label="「${esc(i.name)}」を削除">${ICON.trash}</button>
      </div>
    </li>`;
}

function renderHome() {
  const items = homeItems();
  const wrap = document.getElementById('home-groups');
  wrap.innerHTML = STORAGE_ORDER.map((st) => {
    const g = items.filter((i) => i.storage === st).sort(sortByExpiry);
    if (!g.length) return '';
    return `
      <section class="group group-${st}" aria-labelledby="g-${st}">
        <h3 class="group-title" id="g-${st}"><span class="group-icon" aria-hidden="true"></span>${STORAGE_LABEL[st]}<span class="count">${g.length}件</span></h3>
        <ul class="list">${g.map(renderHomeItem).join('')}</ul>
      </section>`;
  }).join('');
  document.getElementById('home-empty').hidden = items.length > 0;

  // レシピ選択
  for (const id of [...recipeSel]) if (!byId(id) || byId(id).list !== 'home') recipeSel.delete(id);
  const make = document.getElementById('recipe-make');
  make.disabled = recipeSel.size === 0;
  make.textContent = recipeSel.size ? `選んだ${recipeSel.size}品でプロンプトを作る` : '食材を選んでください';
}

function renderCounts() {
  const alerts = homeItems().filter(isAlert).length;
  const buyN = buyItems().length;
  const h = document.getElementById('tab-count-home');
  h.hidden = alerts === 0;
  h.textContent = alerts;
  h.setAttribute('aria-label', `期限が近い食材${alerts}件`);
  const b = document.getElementById('tab-count-buy');
  b.hidden = buyN === 0;
  b.textContent = buyN;
  b.setAttribute('aria-label', `${buyN}件`);
  updateAppBadge(alerts);
}

function render() {
  renderBuy();
  renderHome();
  renderCounts();
}

function focusAction(id, action) {
  const el = document.querySelector(`[data-action="${action}"][data-id="${id}"]`);
  if (el) el.focus();
}

/* ───────── 画面切り替え ───────── */
function showView(name, { focus = false } = {}) {
  currentView = name;
  for (const v of ['buy', 'home', 'settings']) document.getElementById(`view-${v}`).hidden = v !== name;
  document.querySelectorAll('.tab').forEach((t) => {
    if (t.dataset.view === name) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  if (name !== 'home' && recipeMode) setRecipeMode(false);
  window.scrollTo(0, 0);
  if (focus) document.getElementById(`h-${name}`).setAttribute('tabindex', '-1'), document.getElementById(`h-${name}`).focus();
}

/* ───────── 追加フォーム(候補表示つき) ───────── */
function buildAddForm(slot) {
  const list = slot.dataset.list;
  const uidp = `add-${list}`;
  slot.innerHTML = `
    <form class="add-form" autocomplete="off">
      <div class="add-input-wrap">
        <label class="visually-hidden" for="${uidp}-input">${list === 'buy' ? '買うリストに追加する食材' : '家にある食材に追加する食材'}</label>
        <input type="text" id="${uidp}-input" placeholder="食材を追加" enterkeyhint="done"
          role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${uidp}-list">
        <ul class="suggest" id="${uidp}-list" role="listbox" aria-label="候補" hidden></ul>
      </div>
      <button type="button" class="icon-btn" data-scan aria-label="バーコードで追加">${ICON.scan}</button>
      <button type="submit" class="btn btn-primary">追加</button>
    </form>`;
  const form = slot.querySelector('form');
  const input = form.querySelector('input');
  const lb = form.querySelector('.suggest');
  let options = [];
  let active = -1;
  let picked = null;      // 候補から選んだマスタ
  let fromBarcode = false;

  function close() { lb.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
  function open() {
    options = searchMaster(input.value);
    if (!options.length) return close();
    lb.innerHTML = options.map((m, idx) => `
      <li role="option" id="${uidp}-opt-${idx}" data-idx="${idx}" aria-selected="false">
        <span>${esc(m.name)}</span><span class="meta">${STORAGE_LABEL[m.storage]}・${m.days}日</span>
      </li>`).join('');
    lb.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = -1;
  }
  function setActive(idx) {
    active = idx;
    lb.querySelectorAll('[role="option"]').forEach((li, i) => li.setAttribute('aria-selected', String(i === idx)));
    if (idx >= 0) input.setAttribute('aria-activedescendant', `${uidp}-opt-${idx}`);
    else input.removeAttribute('aria-activedescendant');
  }
  function choose(idx) {
    const m = options[idx];
    if (!m) return;
    picked = m;
    input.value = m.name;
    close();
    submit();
  }
  function submit() {
    const name = input.value.trim();
    if (!name) return;
    const masterId = picked && picked.name === name ? picked.id : null;
    addItem(list, name, { masterId, manualExpiry: fromBarcode });
    input.value = '';
    picked = null;
    fromBarcode = false;
    close();
    if (!document.querySelector('dialog[open]')) input.focus();
  }

  input.addEventListener('input', () => { picked = null; fromBarcode = false; open(); });
  input.addEventListener('keydown', (e) => {
    if (lb.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(active + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(active - 1, -1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { close(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  lb.addEventListener('mousedown', (e) => e.preventDefault());
  lb.addEventListener('click', (e) => {
    const li = e.target.closest('[role="option"]');
    if (li) choose(Number(li.dataset.idx));
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  form.querySelector('[data-scan]').addEventListener('click', () => {
    openScanner((name) => {
      input.value = name;
      picked = null;
      fromBarcode = true;
      input.focus();
    });
  });
}

/* ───────── 編集ダイアログ ───────── */
const dlgEdit = document.getElementById('dlg-edit');
let editingId = null;
function openEdit(id, note) {
  const item = byId(id);
  if (!item) return;
  editingId = id;
  const isHome = item.list === 'home';
  document.getElementById('dlg-edit-title').textContent = isHome ? '食材を編集' : '買うものを編集';
  const noteEl = document.getElementById('edit-note');
  noteEl.hidden = !note;
  noteEl.textContent = note || '';
  document.getElementById('edit-name').value = item.name;
  document.getElementById('edit-storage-wrap').hidden = !isHome;
  document.getElementById('edit-expiry-wrap').hidden = !isHome;
  dlgEdit.querySelectorAll('input[name="edit-storage"]').forEach((r) => { r.checked = r.value === item.storage; });
  document.getElementById('edit-expiry').value = item.expiry || '';
  document.getElementById('edit-staple').checked = !!item.staple;
  dlgEdit.showModal();
  if (note) document.getElementById('edit-expiry').focus();
}
dlgEdit.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
  document.getElementById('edit-expiry').value = addDays(todayStr(), Number(c.dataset.days));
}));
document.getElementById('edit-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const item = byId(editingId);
  if (!item) return dlgEdit.close();
  const name = document.getElementById('edit-name').value.trim();
  if (!name) return;
  if (name !== item.name) {
    item.name = name;
    const m = findMasterExact(name);
    item.masterId = m ? m.id : null;
  }
  item.staple = document.getElementById('edit-staple').checked;
  if (item.list === 'home') {
    const st = (dlgEdit.querySelector('input[name="edit-storage"]:checked') || {}).value || item.storage;
    if (st !== item.storage) {
      item.storage = st;
      item.frozen = st === 'freezer';
      item.prev = null;
    }
    item.expiry = document.getElementById('edit-expiry').value || null;
  }
  save(); render();
  dlgEdit.close();
  announce(`「${item.name}」を保存しました`);
});

/* ───────── 確認ダイアログ ───────── */
function askConfirm({ title, message, ok, cancel }) {
  const dlg = document.getElementById('dlg-confirm');
  document.getElementById('dlg-confirm-title').textContent = title;
  document.getElementById('dlg-confirm-msg').textContent = message;
  const okBtn = document.getElementById('dlg-confirm-ok');
  const cancelBtn = document.getElementById('dlg-confirm-cancel');
  okBtn.textContent = ok;
  cancelBtn.textContent = cancel;
  return new Promise((resolve) => {
    let result = false;
    const done = (v) => { result = v; dlg.close(); };
    okBtn.onclick = () => done(true);
    cancelBtn.onclick = () => done(false);
    dlg.addEventListener('close', () => resolve(result), { once: true });
    dlg.showModal();
    okBtn.focus();
  });
}

// data-close ボタン共通
document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

/* ───────── バーコード ───────── */
const dlgScan = document.getElementById('dlg-scan');
let scanner = null;
let scanCallback = null;
let scanBusy = false;
const scriptCache = {};
function loadScript(src) {
  if (!scriptCache[src]) {
    scriptCache[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => { delete scriptCache[src]; rej(new Error('load')); };
      document.head.appendChild(s);
    });
  }
  return scriptCache[src];
}
function scanStatus(msg) { document.getElementById('scan-status').textContent = msg; }

async function openScanner(cb) {
  scanCallback = cb;
  scanBusy = false;
  document.getElementById('scan-code').value = '';
  scanStatus('カメラを準備しています…');
  dlgScan.showModal();
  try {
    await loadScript(SCANNER_SRC);
    const F = window.Html5QrcodeSupportedFormats;
    scanner = new window.Html5Qrcode('reader', {
      formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E],
      verbose: false,
    });
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: (w, h) => ({ width: Math.min(w * 0.85, 300), height: Math.min(h * 0.5, 150) }) },
      (code) => lookup(code),
      () => {},
    );
    scanStatus('バーコードを枠の中に写してください。');
  } catch (e) {
    scanStatus('カメラを使えませんでした。カメラの許可を確認するか、下に番号を入力してください。');
  }
}
async function stopScanner() {
  if (scanner) {
    try { if (scanner.isScanning) await scanner.stop(); scanner.clear(); } catch (e) { /* noop */ }
    scanner = null;
  }
}
dlgScan.addEventListener('close', stopScanner);

async function lookup(code) {
  if (scanBusy) return;
  scanBusy = true;
  scanStatus(`${code} を探しています…`);
  if (scanner && scanner.isScanning) { try { scanner.pause(true); } catch (e) { /* noop */ } }
  let name = null;
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_ja,product_name_en,brands`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.status === 1 && data.product) {
        const p = data.product;
        name = (p.product_name_ja || p.product_name || p.product_name_en || '').trim() || null;
      }
    }
  } catch (e) { /* 通信エラー */ }
  const cb = scanCallback;
  dlgScan.close();
  if (name) {
    cb && cb(name);
    toast(`「${name}」が見つかりました。必要なら名前を直して「追加」を押してください。`);
  } else {
    cb && cb('');
    toast('商品が見つかりませんでした。名前を入力してください。');
  }
}
document.getElementById('scan-manual').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = document.getElementById('scan-code').value.replace(/\D/g, '');
  if (code.length >= 8) lookup(code);
  else scanStatus('8桁以上の番号を入力してください。');
});

/* ───────── レシピ ───────── */
function setRecipeMode(on) {
  recipeMode = on;
  if (!on) recipeSel.clear();
  const btn = document.getElementById('recipe-toggle');
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = on ? '選ぶのをやめる' : 'レシピを考える';
  document.getElementById('recipe-hint').hidden = !on;
  document.getElementById('recipe-bar').hidden = !on;
  document.body.classList.toggle('recipe-mode', on);
  renderHome();
}
function buildPrompt(items) {
  const lines = items.sort(sortByExpiry).map((i) => {
    const s = statusOf(i);
    const tag = s.kind === 'ok' || s.kind === 'unset' ? '' : `(${s.text})`;
    return `- ${i.name}${tag}`;
  });
  return [
    '次の食材を使って作れる家庭料理のレシピを3つ提案してください。',
    '',
    '使いたい食材:',
    ...lines,
    '',
    '条件:',
    '- 期限が近い食材(カッコ内に残り日数があるもの)をできるだけ優先して使う',
    '- 塩、こしょう、しょうゆ、砂糖、みりん、酒、油などの基本的な調味料は家にあるものとする',
    '- 上の食材以外に必要な材料があれば、わかるように書く',
    '- 各レシピに、材料と分量(2人分)、手順、調理時間を書く',
  ].join('\n');
}
document.getElementById('recipe-toggle').addEventListener('click', () => setRecipeMode(!recipeMode));
document.getElementById('recipe-make').addEventListener('click', () => {
  const items = [...recipeSel].map(byId).filter(Boolean);
  if (!items.length) return;
  document.getElementById('prompt-text').value = buildPrompt(items);
  document.getElementById('dlg-prompt').showModal();
});
document.getElementById('prompt-copy').addEventListener('click', async () => {
  const ta = document.getElementById('prompt-text');
  try {
    await navigator.clipboard.writeText(ta.value);
  } catch (e) {
    ta.select();
    document.execCommand('copy');
  }
  toast('コピーしました');
});

/* ───────── バッジ ───────── */
function updateAppBadge(n) {
  try {
    if (!('setAppBadge' in navigator)) return;
    (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  } catch (e) { /* noop */ }
}
function renderBadgeSettings() {
  const status = document.getElementById('badge-status');
  const btn = document.getElementById('badge-enable');
  const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (!standalone) {
    status.textContent = 'Safariの共有ボタンから「ホーム画面に追加」し、ホーム画面のアイコンから開くと使えます。';
    btn.hidden = true;
  } else if (!('setAppBadge' in navigator) || !('Notification' in window)) {
    status.textContent = 'この端末ではバッジを使えません。';
    btn.hidden = true;
  } else if (Notification.permission === 'granted') {
    status.textContent = 'バッジは有効です。';
    btn.hidden = true;
  } else if (Notification.permission === 'denied') {
    status.textContent = '許可されていません。iPhoneの「設定」→「通知」→「foodly」から許可できます。';
    btn.hidden = true;
  } else {
    status.textContent = 'バッジを表示するには、通知の許可が必要です(通知は送りません)。';
    btn.hidden = false;
  }
}
document.getElementById('badge-enable').addEventListener('click', async () => {
  try { await Notification.requestPermission(); } catch (e) { /* noop */ }
  renderBadgeSettings();
  renderCounts();
});

/* ───────── バックアップ ───────── */
document.getElementById('backup-export').addEventListener('click', async () => {
  const json = JSON.stringify({ app: 'foodly', version: 1, exportedAt: new Date().toISOString(), items: state.items }, null, 2);
  const filename = `foodly-backup-${todayStr()}.json`;
  const file = new File([json], filename, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'foodly バックアップ' });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});
document.getElementById('backup-import').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data || data.app !== 'foodly' || !Array.isArray(data.items)) throw new Error('format');
    const ok = await askConfirm({
      title: 'バックアップを読み込む',
      message: `今のデータを、バックアップの${data.items.length}件で置き換えます。よろしいですか?`,
      ok: '置き換える', cancel: 'やめる',
    });
    if (!ok) return;
    state.items = data.items;
    save(); render();
    toast('バックアップを読み込みました');
  } catch (err) {
    toast('読み込めませんでした。foodlyのバックアップファイルか確認してください。');
  }
});

/* ───────── マスタ一覧 ───────── */
function renderMasterTable() {
  document.getElementById('master-count').textContent = MASTER.length;
  document.getElementById('master-body').innerHTML = MASTER.map((m) =>
    `<tr><td>${esc(m.name)}</td><td>${STORAGE_LABEL[m.storage]}</td><td>${m.days}日</td><td>${m.storage === 'freezer' ? '—' : (m.freezerDays ? m.freezerDays + '日' : '—')}</td></tr>`).join('');
}

/* ───────── トースト・読み上げ ───────── */
let toastTimer = null;
function toast(msg, undo) {
  const region = document.getElementById('toast-region');
  clearTimeout(toastTimer);
  region.innerHTML = `<div class="toast"><span class="toast-msg">${esc(msg)}</span>${undo ? '<button type="button" class="toast-btn">元に戻す</button>' : ''}</div>`;
  if (undo) {
    region.querySelector('.toast-btn').addEventListener('click', () => {
      region.innerHTML = '';
      undo();
      announce('元に戻しました');
    });
  }
  toastTimer = setTimeout(() => { region.innerHTML = ''; }, undo ? 7000 : 4000);
}
function announce(msg) {
  // 視覚的なトーストを出さずに読み上げだけしたいとき
  let live = document.getElementById('sr-live');
  if (!live) {
    live = document.createElement('div');
    live.id = 'sr-live';
    live.className = 'visually-hidden';
    live.setAttribute('aria-live', 'polite');
    document.body.appendChild(live);
  }
  live.textContent = '';
  setTimeout(() => { live.textContent = msg; }, 50);
}

/* ───────── イベント(リスト内の操作) ───────── */
document.getElementById('main').addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const id = el.dataset.id;
  switch (el.dataset.action) {
    case 'edit': openEdit(id); break;
    case 'staple': toggleStaple(id); break;
    case 'delete': removeItem(id); break;
    case 'useup': useUp(id); break;
  }
});
document.getElementById('main').addEventListener('change', (e) => {
  const el = e.target.closest('input[data-action]');
  if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.action) {
    case 'purchase': if (el.checked) purchase(id); break;
    case 'freeze': setFrozen(id, el.checked); break;
    case 'select':
      if (el.checked) recipeSel.add(id); else recipeSel.delete(id);
      renderHome();
      focusAction(id, 'select');
      break;
  }
});
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));

// 日付が変わっても表示が古くならないように
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); renderBadgeSettings(); } });

/* ───────── 起動 ───────── */
document.querySelectorAll('.add-slot').forEach(buildAddForm);
renderMasterTable();
renderBadgeSettings();
render();
if (homeItems().some(isAlert)) showView('home');

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
