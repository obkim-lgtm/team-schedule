// =====================================================================
// 팀 일정 (team-schedule)
// 편집 → server.js의 PUT /api/save/<file> → 파일 저장 + 자동 git push
// 노션 연동 없음. 모든 일정은 수동 등록.
// =====================================================================

const DATA_FILES = {
  categories:   'data/categories.json',
  manualEvents: 'data/manual-events.json',
  memos:        'data/memos.json',
};
const SAVE_ENDPOINT = '/api/save/';
const MEMO_DEBOUNCE_MS = 1500;
// 편집 가능 여부: server.js가 떠있는 localhost에서만 true. 배포 사이트는 보기 전용.
const IS_EDITABLE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

const state = {
  current: new Date(),
  categories: [],
  events: [],
  memos: {},
};

const DEFAULT_CATEGORIES = [
  { key: 'hiai',      name: 'HIAI',     color: '#7E44FB' },
  { key: 'clipo',     name: 'CLIPO',    color: '#416BFF' },
  { key: 'ops',       name: '운영',     color: '#F59E0B' },
  { key: 'marketing', name: '마케팅',   color: '#EC4899' },
  { key: 'planning',  name: '기획',     color: '#059669' },
];

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtMonth = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const parseDate = (s) => {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const sameDay = (a, b) => a && b && fmtDate(a) === fmtDate(b);
const todayISO = () => fmtDate(new Date());
const newId = () => 'e_' + Math.random().toString(36).slice(2, 10);

function showToast(msg, ms = 1800) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, ms);
}

function findCategory(key) {
  return state.categories.find(c => c.key === key)
      || state.categories.find(c => c.name === key)
      || { key: 'default', name: '기타', color: '#9CA3AF' };
}

// ---------- Save status ----------
function setSaveStatus(kind, text) {
  const el = $('#save-status');
  el.className = 'save-status ' + kind;
  el.querySelector('.save-text').textContent = text;
}

let saveTimers = {};
async function postSave(filename, payload) {
  setSaveStatus('saving', '저장 중…');
  try {
    const res = await fetch(SAVE_ENDPOINT + filename, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    setSaveStatus('saved', '저장됨');
    clearTimeout(saveTimers._reset);
    saveTimers._reset = setTimeout(() => {
      if ($('#save-status').classList.contains('saved')) {
        setSaveStatus('idle', '대기');
      }
    }, 2500);
  } catch (e) {
    console.error('[save fail]', e);
    setSaveStatus('error', '저장 실패');
    showToast(`저장 실패: ${e.message}`);
  }
}

function saveEventsFile()     { return postSave('manual-events.json', { events: state.events }); }
function saveCategoriesFile() { return postSave('categories.json',    { categories: state.categories }); }
function saveMemosFile()      { return postSave('memos.json',         { memos: state.memos }); }

// ---------- Data loading ----------
async function loadJSON(path, fallback) {
  try {
    const res = await fetch(path + '?t=' + Date.now());
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (e) {
    console.warn('[load fail]', path, e);
    return fallback;
  }
}

async function loadAll() {
  const [cats, manual, memos] = await Promise.all([
    loadJSON(DATA_FILES.categories,   { categories: DEFAULT_CATEGORIES }),
    loadJSON(DATA_FILES.manualEvents, { events: [] }),
    loadJSON(DATA_FILES.memos,        { memos: {} }),
  ]);
  state.categories = cats.categories || DEFAULT_CATEGORIES;
  state.events = manual.events || [];
  state.memos = memos.memos || {};
}

// ---------- Events ----------
function eventsOnDay(date) {
  const iso = fmtDate(date);
  return state.events.filter(e => {
    const end = e.end || e.start;
    return iso >= e.start && iso <= end;
  });
}

function eventsInMonth(year, month) {
  const first = fmtDate(new Date(year, month, 1));
  const last = fmtDate(new Date(year, month + 1, 0));
  return state.events.filter(e => {
    const end = e.end || e.start;
    return !(end < first || e.start > last);
  }).sort((a, b) => a.start.localeCompare(b.start));
}

// ---------- Calendar ----------
function renderCalendar() {
  const grid = $('#calendar-grid');
  grid.innerHTML = '';

  const year = state.current.getFullYear();
  const month = state.current.getMonth();
  const first = new Date(year, month, 1);
  const firstDow = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();

  $('#month-label').textContent = `${year}년 ${month + 1}월`;

  const cells = [];
  for (let i = firstDow - 1; i >= 0; i--) cells.push({ year, month: month - 1, day: daysInPrev - i, otherMonth: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ year, month, day: d, otherMonth: false });
  const trailing = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= trailing; d++) cells.push({ year, month: month + 1, day: d, otherMonth: true });
  while (cells.length < 42) {
    const last = cells[cells.length - 1];
    const nextDate = new Date(last.year, last.month, last.day + 1);
    cells.push({ year: nextDate.getFullYear(), month: nextDate.getMonth(), day: nextDate.getDate(), otherMonth: true });
  }

  const today = new Date();
  cells.forEach((c) => {
    const date = new Date(c.year, c.month, c.day);
    const dow = date.getDay();
    const cell = document.createElement('div');
    cell.className = 'day-cell';
    if (c.otherMonth) cell.classList.add('other-month');
    if (dow === 0) cell.classList.add('sun');
    if (dow === 6) cell.classList.add('sat');
    if (sameDay(date, today)) cell.classList.add('today');
    cell.dataset.date = fmtDate(date);

    const num = document.createElement('span');
    num.className = 'day-num';
    num.textContent = c.day;
    cell.appendChild(num);

    const evts = eventsOnDay(date);
    const chips = document.createElement('div');
    chips.className = 'event-chips';
    const maxShow = 3;
    evts.slice(0, maxShow).forEach(e => {
      const chip = document.createElement('div');
      chip.className = 'event-chip';
      const cat = findCategory(e.category);
      chip.style.background = cat.color + '22';
      chip.style.borderLeftColor = cat.color;
      chip.textContent = e.title;
      chip.addEventListener('click', (ev) => { ev.stopPropagation(); openEventModal(e); });
      chips.appendChild(chip);
    });
    if (evts.length > maxShow) {
      const more = document.createElement('div');
      more.className = 'event-chip-more';
      more.textContent = `+ ${evts.length - maxShow}개 더`;
      chips.appendChild(more);
    }
    cell.appendChild(chips);
    cell.addEventListener('click', () => openEventModal(null, fmtDate(date)));
    grid.appendChild(cell);
  });
}

// ---------- Side pane ----------
function renderMemo() {
  const key = fmtMonth(state.current);
  $('#memo-title').textContent = `${state.current.getFullYear()}년 ${state.current.getMonth() + 1}월 메모`;
  $('#memo-textarea').value = state.memos[key] || '';
}

function renderEventList() {
  const list = $('#event-list');
  list.innerHTML = '';
  const evts = eventsInMonth(state.current.getFullYear(), state.current.getMonth());
  $('#month-event-count').textContent = `${evts.length}건`;

  if (evts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'event-list-empty';
    empty.textContent = '이달엔 일정이 없습니다. 날짜를 클릭하거나 [+ 일정 추가]로 시작하세요.';
    list.appendChild(empty);
    return;
  }

  evts.forEach(e => {
    const item = document.createElement('div');
    item.className = 'event-list-item';

    const date = document.createElement('div');
    date.className = 'event-list-date';
    const d = parseDate(e.start);
    date.textContent = `${d.getMonth() + 1}/${d.getDate()}`;

    const dot = document.createElement('div');
    dot.className = 'event-list-dot';
    dot.style.background = findCategory(e.category).color;

    const title = document.createElement('div');
    title.className = 'event-list-title';
    title.textContent = e.title;

    item.appendChild(date);
    item.appendChild(dot);
    item.appendChild(title);
    item.addEventListener('click', () => openEventModal(e));
    list.appendChild(item);
  });
}

function renderLegend() {
  const legend = $('#category-legend');
  legend.innerHTML = '';
  state.categories.forEach(cat => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    const sw = document.createElement('div');
    sw.className = 'legend-swatch';
    sw.style.background = cat.color;
    const name = document.createElement('span');
    name.textContent = cat.name;
    item.appendChild(sw);
    item.appendChild(name);
    legend.appendChild(item);
  });
}

function renderAll() {
  renderCalendar();
  renderMemo();
  renderEventList();
  renderLegend();
}

// ---------- Modals ----------
function closeAllModals() {
  $$('.modal-backdrop').forEach(m => { m.hidden = true; });
}

let editingEventId = null;

function openEventModal(event, defaultDate) {
  closeAllModals();
  editingEventId = event?.id || null;
  const isEdit = !!event;

  // 보기 전용 모드에서 빈 날짜 클릭은 무시 (이벤트 클릭만 모달 표시)
  if (!IS_EDITABLE && !isEdit) return;

  $('#event-modal-title').textContent = !IS_EDITABLE
    ? '일정 보기'
    : (isEdit ? '일정 수정' : '일정 추가');
  $('#event-title').value = event?.title || '';
  $('#event-start').value = event?.start || defaultDate || todayISO();
  $('#event-end').value = event?.end || '';
  $('#event-note').value = event?.note || '';

  const sel = $('#event-category');
  sel.innerHTML = '';
  state.categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.key;
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
  sel.value = event?.category || state.categories[0]?.key || '';

  // 보기 전용: 필드 비활성화, 저장·삭제 버튼 숨김
  ['#event-title', '#event-start', '#event-end', '#event-category', '#event-note'].forEach(s => {
    $(s).disabled = !IS_EDITABLE;
  });
  $('#event-delete').hidden = !isEdit || !IS_EDITABLE;
  $('#event-save').hidden = !IS_EDITABLE;

  $('#event-modal').hidden = false;
  if (IS_EDITABLE) setTimeout(() => $('#event-title').focus(), 50);
}

function closeEventModal() {
  $('#event-modal').hidden = true;
  editingEventId = null;
}

async function handleSaveEvent() {
  const title = $('#event-title').value.trim();
  const start = $('#event-start').value;
  const end = $('#event-end').value || '';
  const category = $('#event-category').value;
  const note = $('#event-note').value.trim();

  if (!title) { showToast('제목을 입력하세요'); return; }
  if (!start) { showToast('시작일을 입력하세요'); return; }
  if (end && end < start) { showToast('종료일이 시작일보다 빠릅니다'); return; }

  if (editingEventId) {
    const idx = state.events.findIndex(e => e.id === editingEventId);
    if (idx >= 0) state.events[idx] = { id: editingEventId, title, start, end, category, note };
  } else {
    state.events.push({ id: newId(), title, start, end, category, note });
  }
  closeEventModal();
  renderAll();
  saveEventsFile();
}

async function handleDeleteEvent() {
  if (!editingEventId) return;
  if (!confirm('이 일정을 삭제할까요?')) return;
  state.events = state.events.filter(e => e.id !== editingEventId);
  closeEventModal();
  renderAll();
  saveEventsFile();
}

// ---------- Category modal ----------
function openCategoryModal() {
  closeAllModals();
  const editor = $('#category-editor');
  editor.innerHTML = '';
  state.categories.forEach((c, i) => editor.appendChild(buildCategoryRow(c, i)));
  $('#category-modal').hidden = false;
}

function buildCategoryRow(cat) {
  const row = document.createElement('div');
  row.className = 'category-row';

  const color = document.createElement('input');
  color.type = 'color';
  color.value = cat.color;
  color.addEventListener('input', (e) => { row.querySelector('.hex').value = e.target.value.toUpperCase(); });

  const name = document.createElement('input');
  name.type = 'text';
  name.placeholder = '카테고리 이름';
  name.value = cat.name;

  const hex = document.createElement('input');
  hex.type = 'text';
  hex.className = 'hex';
  hex.value = cat.color.toUpperCase();
  hex.addEventListener('change', (e) => {
    const v = e.target.value.trim();
    if (/^#?[0-9A-Fa-f]{6}$/.test(v)) {
      const norm = v.startsWith('#') ? v : '#' + v;
      color.value = norm.toLowerCase();
      hex.value = norm.toUpperCase();
    }
  });

  const del = document.createElement('button');
  del.className = 'icon-btn';
  del.innerHTML = '×';
  del.title = '삭제';
  del.addEventListener('click', () => row.remove());

  row.appendChild(color);
  row.appendChild(name);
  row.appendChild(hex);
  row.appendChild(del);
  return row;
}

async function handleSaveCategories() {
  const rows = $$('#category-editor .category-row');
  const next = [];
  for (const r of rows) {
    const name = r.querySelector('input[type="text"]:not(.hex)').value.trim();
    const color = r.querySelector('input[type="color"]').value;
    if (!name) continue;
    const existing = state.categories.find(c => c.name === name);
    next.push({
      key: existing?.key || ('cat_' + name.replace(/\s+/g, '_').toLowerCase() + '_' + Math.random().toString(36).slice(2, 6)),
      name,
      color: color.toUpperCase(),
    });
  }
  if (next.length === 0) { showToast('최소 1개 이상 카테고리가 필요해요'); return; }
  state.categories = next;
  $('#category-modal').hidden = true;
  renderAll();
  saveCategoriesFile();
}

// ---------- Memo (debounced) ----------
let memoTimer = null;
function onMemoInput(e) {
  const key = fmtMonth(state.current);
  state.memos[key] = e.target.value;
  setSaveStatus('saving', '입력 중…');
  clearTimeout(memoTimer);
  memoTimer = setTimeout(() => { saveMemosFile(); }, MEMO_DEBOUNCE_MS);
}

// ---------- Wiring ----------
function bind() {
  $('#prev-month').addEventListener('click', () => {
    state.current = new Date(state.current.getFullYear(), state.current.getMonth() - 1, 1);
    renderAll();
  });
  $('#next-month').addEventListener('click', () => {
    state.current = new Date(state.current.getFullYear(), state.current.getMonth() + 1, 1);
    renderAll();
  });
  $('#today-btn').addEventListener('click', () => { state.current = new Date(); renderAll(); });
  $('#month-label').addEventListener('click', () => { state.current = new Date(); renderAll(); });

  $('#add-event-btn').addEventListener('click', () => openEventModal(null, todayISO()));

  $('#event-modal-close').addEventListener('click', closeEventModal);
  $('#event-cancel').addEventListener('click', closeEventModal);
  $('#event-save').addEventListener('click', handleSaveEvent);
  $('#event-delete').addEventListener('click', handleDeleteEvent);
  $('#event-modal').addEventListener('click', (e) => { if (e.target.id === 'event-modal') closeEventModal(); });

  $('#memo-textarea').addEventListener('input', onMemoInput);
  $('#memo-textarea').addEventListener('blur', () => {
    if (memoTimer) { clearTimeout(memoTimer); memoTimer = null; saveMemosFile(); }
  });

  $('#manage-categories-btn').addEventListener('click', openCategoryModal);
  $('#category-modal-close').addEventListener('click', () => { $('#category-modal').hidden = true; });
  $('#category-cancel').addEventListener('click', () => { $('#category-modal').hidden = true; });
  $('#category-save').addEventListener('click', handleSaveCategories);
  $('#category-add').addEventListener('click', () => {
    const colors = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'];
    const c = { key: 'new_' + Math.random().toString(36).slice(2, 6), name: '', color: colors[Math.floor(Math.random() * colors.length)] };
    $('#category-editor').appendChild(buildCategoryRow(c));
  });
  $('#category-modal').addEventListener('click', (e) => { if (e.target.id === 'category-modal') $('#category-modal').hidden = true; });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllModals(); });
}

// ---------- Boot ----------
function applyReadOnlyMode() {
  // 배포 사이트(또는 server.js 없는 환경)에서는 편집 UI 숨김 — 보기 전용
  $('#add-event-btn').hidden = true;
  $('#manage-categories-btn').hidden = true;
  $('#save-status').hidden = true;
  const memo = $('#memo-textarea');
  memo.readOnly = true;
  memo.placeholder = '메모는 편집 환경에서만 작성됩니다.';
  document.body.classList.add('readonly');
}

async function init() {
  bind();
  await loadAll();
  renderAll();
  if (!IS_EDITABLE) applyReadOnlyMode();
  else setSaveStatus('idle', '대기');
}

init();
