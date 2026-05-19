// =====================================================================
// 팀 일정 (team-schedule)
// 정적 사이트. data/ 폴더의 JSON을 fetch해서 캘린더 렌더.
// 편집은 메모리 내에서만 → "변경사항 저장" 버튼으로 JSON 다운로드 → repo 커밋.
// =====================================================================

const DATA_FILES = {
  categories: 'data/categories.json',
  manualEvents: 'data/manual-events.json',
  memos: 'data/memos.json',
  notionEvents: 'data/notion-events.json',
};

const state = {
  current: new Date(),               // 표시 중인 월 (1일 기준)
  categories: [],                    // [{key, name, color}]
  manualEvents: [],                  // [{id, title, start, end, category, note}]
  notionEvents: [],                  // [{id, title, start, end, category, note, url}]
  memos: {},                         // {'YYYY-MM': string}
  syncMeta: null,                    // {syncedAt, count, ok}
  dirty: { manualEvents: false, memos: false, categories: false },
  baseline: {},                      // 변경 비교용 원본 스냅샷
};

const DEFAULT_CATEGORIES = [
  { key: 'planning',  name: '기획',     color: '#7E44FB' },
  { key: 'ops',       name: '운영',     color: '#F59E0B' },
  { key: 'release',   name: '배포',     color: '#059669' },
  { key: 'marketing', name: '마케팅',   color: '#EC4899' },
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
const newId = () => 'm_' + Math.random().toString(36).slice(2, 10);

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

function isDirty() {
  return state.dirty.manualEvents || state.dirty.memos || state.dirty.categories;
}

function markDirty(kind) {
  state.dirty[kind] = true;
}

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
  const [cats, manual, memos, notion] = await Promise.all([
    loadJSON(DATA_FILES.categories, { categories: DEFAULT_CATEGORIES }),
    loadJSON(DATA_FILES.manualEvents, { events: [] }),
    loadJSON(DATA_FILES.memos, { memos: {} }),
    loadJSON(DATA_FILES.notionEvents, { events: [], syncedAt: null, ok: false }),
  ]);

  state.categories = cats.categories || DEFAULT_CATEGORIES;
  state.manualEvents = manual.events || [];
  state.memos = memos.memos || {};
  state.notionEvents = (notion.events || []).map(e => ({ ...e, source: 'notion' }));
  state.syncMeta = { syncedAt: notion.syncedAt, ok: notion.ok !== false, error: notion.error };

  state.baseline = {
    categories: JSON.stringify(state.categories),
    manualEvents: JSON.stringify(state.manualEvents),
    memos: JSON.stringify(state.memos),
  };
  state.dirty = { manualEvents: false, memos: false, categories: false };
}

// ---------- All events for a given day ----------
function getAllEvents() {
  return [
    ...state.notionEvents.map(e => ({ ...e, source: 'notion', locked: true })),
    ...state.manualEvents.map(e => ({ ...e, source: 'manual', locked: false })),
  ];
}

function eventsOnDay(date) {
  const iso = fmtDate(date);
  return getAllEvents().filter(e => {
    const start = e.start;
    const end = e.end || e.start;
    return iso >= start && iso <= end;
  });
}

function eventsInMonth(year, month) {
  const first = fmtDate(new Date(year, month, 1));
  const last = fmtDate(new Date(year, month + 1, 0));
  return getAllEvents().filter(e => {
    const start = e.start;
    const end = e.end || e.start;
    return !(end < first || start > last);
  }).sort((a, b) => a.start.localeCompare(b.start));
}

// ---------- Calendar rendering ----------
function renderCalendar() {
  const grid = $('#calendar-grid');
  grid.innerHTML = '';

  const year = state.current.getFullYear();
  const month = state.current.getMonth();
  const first = new Date(year, month, 1);
  const firstDow = first.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();

  $('#month-label').textContent = `${year}년 ${month + 1}월`;

  const cells = [];
  for (let i = firstDow - 1; i >= 0; i--) {
    cells.push({ year, month: month - 1, day: daysInPrev - i, otherMonth: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ year, month, day: d, otherMonth: false });
  }
  const trailing = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= trailing; d++) {
    cells.push({ year, month: month + 1, day: d, otherMonth: true });
  }

  // Always 6 rows for consistent height
  while (cells.length < 42) {
    const last = cells[cells.length - 1];
    const nextDate = new Date(last.year, last.month, last.day + 1);
    cells.push({
      year: nextDate.getFullYear(),
      month: nextDate.getMonth(),
      day: nextDate.getDate(),
      otherMonth: true,
    });
  }

  const today = new Date();
  cells.forEach((c, idx) => {
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
      if (e.locked) chip.classList.add('locked');
      const cat = findCategory(e.category);
      chip.style.background = cat.color + '22';
      chip.style.borderLeftColor = cat.color;
      chip.textContent = e.title;
      chip.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openEventModal(e);
      });
      chips.appendChild(chip);
    });
    if (evts.length > maxShow) {
      const more = document.createElement('div');
      more.className = 'event-chip-more';
      more.textContent = `+ ${evts.length - maxShow}개 더`;
      chips.appendChild(more);
    }
    cell.appendChild(chips);

    cell.addEventListener('click', () => {
      openEventModal(null, fmtDate(date));
    });

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

    if (e.source === 'notion') {
      const lock = document.createElement('span');
      lock.className = 'event-list-locked';
      lock.textContent = '🔗';
      lock.title = '노션 동기화';
      item.appendChild(lock);
    }

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

function renderSyncStatus() {
  const el = $('#sync-status');
  const text = el.querySelector('.sync-text');
  el.classList.remove('ok', 'warn', 'err');
  const meta = state.syncMeta || {};
  if (!meta.syncedAt) {
    el.classList.add('warn');
    text.textContent = '노션 미동기화';
    el.title = '아직 노션 동기화가 한 번도 수행되지 않았습니다. README의 노션 세팅 가이드 참고.';
    return;
  }
  const at = new Date(meta.syncedAt);
  const ago = Math.round((Date.now() - at.getTime()) / 60000);
  let agoStr;
  if (ago < 1) agoStr = '방금 전';
  else if (ago < 60) agoStr = `${ago}분 전`;
  else if (ago < 60 * 24) agoStr = `${Math.round(ago / 60)}시간 전`;
  else agoStr = `${Math.round(ago / 60 / 24)}일 전`;

  if (meta.ok === false) {
    el.classList.add('err');
    text.textContent = `노션 동기화 실패 · ${agoStr}`;
    el.title = meta.error || '동기화 실패';
  } else {
    el.classList.add('ok');
    text.textContent = `노션 동기화 ${agoStr}`;
    el.title = `마지막 동기화: ${at.toLocaleString('ko-KR')}`;
  }
}

function renderAll() {
  renderCalendar();
  renderMemo();
  renderEventList();
  renderLegend();
  renderSyncStatus();
}

// ---------- Event modal ----------
let editingEventId = null;

function openEventModal(event, defaultDate) {
  editingEventId = event?.id || null;
  const isEdit = !!event;
  const isLocked = event?.source === 'notion';

  $('#event-modal-title').textContent = isEdit
    ? (isLocked ? '노션 일정 (읽기 전용)' : '일정 수정')
    : '일정 추가';

  $('#event-title').value = event?.title || '';
  $('#event-start').value = event?.start || defaultDate || todayISO();
  $('#event-end').value = event?.end || '';
  $('#event-note').value = event?.note || '';

  // category select
  const sel = $('#event-category');
  sel.innerHTML = '';
  state.categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.key;
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
  sel.value = event?.category || state.categories[0]?.key || '';

  // lock fields if notion-sourced
  ['#event-title', '#event-start', '#event-end', '#event-category', '#event-note'].forEach(s => {
    $(s).disabled = isLocked;
  });

  $('#event-delete').hidden = !isEdit || isLocked;
  $('#event-save').hidden = isLocked;
  $('#event-modal-meta').hidden = !isLocked;

  $('#event-modal').hidden = false;
  if (!isLocked) setTimeout(() => $('#event-title').focus(), 50);
}

function closeEventModal() {
  $('#event-modal').hidden = true;
  editingEventId = null;
}

function saveEvent() {
  const title = $('#event-title').value.trim();
  const start = $('#event-start').value;
  const end = $('#event-end').value || '';
  const category = $('#event-category').value;
  const note = $('#event-note').value.trim();

  if (!title) { showToast('제목을 입력하세요'); return; }
  if (!start) { showToast('시작일을 입력하세요'); return; }
  if (end && end < start) { showToast('종료일이 시작일보다 빠릅니다'); return; }

  if (editingEventId) {
    const idx = state.manualEvents.findIndex(e => e.id === editingEventId);
    if (idx >= 0) {
      state.manualEvents[idx] = { id: editingEventId, title, start, end, category, note };
    }
  } else {
    state.manualEvents.push({ id: newId(), title, start, end, category, note });
  }
  markDirty('manualEvents');
  closeEventModal();
  renderAll();
  showToast('저장됐어요. 변경사항 저장 잊지 마세요');
}

function deleteEvent() {
  if (!editingEventId) return;
  if (!confirm('이 일정을 삭제할까요?')) return;
  state.manualEvents = state.manualEvents.filter(e => e.id !== editingEventId);
  markDirty('manualEvents');
  closeEventModal();
  renderAll();
  showToast('삭제됐어요. 변경사항 저장 잊지 마세요');
}

// ---------- Category modal ----------
function openCategoryModal() {
  const editor = $('#category-editor');
  editor.innerHTML = '';
  state.categories.forEach((c, i) => editor.appendChild(buildCategoryRow(c, i)));
  $('#category-modal').hidden = false;
}

function buildCategoryRow(cat, idx) {
  const row = document.createElement('div');
  row.className = 'category-row';
  row.dataset.idx = idx;

  const color = document.createElement('input');
  color.type = 'color';
  color.value = cat.color;
  color.addEventListener('input', (e) => {
    row.querySelector('.hex').value = e.target.value.toUpperCase();
  });

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

function saveCategories() {
  const rows = $$('#category-editor .category-row');
  const next = [];
  for (const r of rows) {
    const name = r.querySelector('input[type="text"]:not(.hex)').value.trim();
    const color = r.querySelector('input[type="color"]').value;
    if (!name) continue;
    // key: 기존 key 유지 (이름 같으면) or 새로 부여
    const existing = state.categories.find(c => c.name === name);
    next.push({
      key: existing?.key || ('cat_' + name.replace(/\s+/g, '_').toLowerCase() + '_' + Math.random().toString(36).slice(2, 6)),
      name,
      color: color.toUpperCase(),
    });
  }
  if (next.length === 0) { showToast('최소 1개 이상 카테고리가 필요해요'); return; }
  state.categories = next;
  markDirty('categories');
  $('#category-modal').hidden = true;
  renderAll();
  showToast('카테고리 저장됨');
}

// ---------- Export ----------
function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}

function openExportModal() {
  if (!isDirty()) {
    showToast('변경된 내용이 없어요');
    return;
  }
  const list = $('#export-list');
  list.innerHTML = '';
  const changed = [];

  if (state.dirty.manualEvents) {
    changed.push({
      filename: 'manual-events.json',
      payload: { events: state.manualEvents },
      meta: `${state.manualEvents.length}개 일정`,
    });
  }
  if (state.dirty.memos) {
    const count = Object.values(state.memos).filter(v => v && v.trim()).length;
    changed.push({
      filename: 'memos.json',
      payload: { memos: state.memos },
      meta: `${count}개 월에 메모 작성됨`,
    });
  }
  if (state.dirty.categories) {
    changed.push({
      filename: 'categories.json',
      payload: { categories: state.categories },
      meta: `${state.categories.length}개 카테고리`,
    });
  }

  changed.forEach(c => {
    const item = document.createElement('div');
    item.className = 'export-item';
    const left = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'export-item-name';
    name.textContent = `data/${c.filename}`;
    const meta = document.createElement('div');
    meta.className = 'export-item-meta';
    meta.textContent = c.meta;
    left.appendChild(name);
    left.appendChild(meta);

    const btn = document.createElement('button');
    btn.className = 'outline-btn';
    btn.textContent = '다운로드';
    btn.addEventListener('click', () => downloadJSON(c.filename, c.payload));

    item.appendChild(left);
    item.appendChild(btn);
    list.appendChild(item);
  });

  const files = changed.map(c => `data/${c.filename}`).join(' ');
  $('#export-cmd-text').textContent =
    `git add ${files}\ngit commit -m "일정 갱신: ${new Date().toLocaleDateString('ko-KR')}"\ngit push`;

  $('#export-modal').hidden = false;
}

function copyExportCmd() {
  const txt = $('#export-cmd-text').textContent;
  navigator.clipboard.writeText(txt).then(() => showToast('복사됐어요'));
}

// ---------- Event wiring ----------
function bind() {
  $('#prev-month').addEventListener('click', () => {
    state.current = new Date(state.current.getFullYear(), state.current.getMonth() - 1, 1);
    renderAll();
  });
  $('#next-month').addEventListener('click', () => {
    state.current = new Date(state.current.getFullYear(), state.current.getMonth() + 1, 1);
    renderAll();
  });
  $('#today-btn').addEventListener('click', () => {
    state.current = new Date();
    renderAll();
  });
  $('#month-label').addEventListener('click', () => {
    state.current = new Date();
    renderAll();
  });

  $('#add-event-btn').addEventListener('click', () => openEventModal(null, todayISO()));

  // Event modal
  $('#event-modal-close').addEventListener('click', closeEventModal);
  $('#event-cancel').addEventListener('click', closeEventModal);
  $('#event-save').addEventListener('click', saveEvent);
  $('#event-delete').addEventListener('click', deleteEvent);
  $('#event-modal').addEventListener('click', (e) => {
    if (e.target.id === 'event-modal') closeEventModal();
  });

  // Memo
  $('#memo-textarea').addEventListener('input', (e) => {
    const key = fmtMonth(state.current);
    state.memos[key] = e.target.value;
    markDirty('memos');
  });

  // Categories
  $('#manage-categories-btn').addEventListener('click', openCategoryModal);
  $('#category-modal-close').addEventListener('click', () => { $('#category-modal').hidden = true; });
  $('#category-cancel').addEventListener('click', () => { $('#category-modal').hidden = true; });
  $('#category-save').addEventListener('click', saveCategories);
  $('#category-add').addEventListener('click', () => {
    const colors = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'];
    const c = { key: 'new_' + Math.random().toString(36).slice(2, 6), name: '', color: colors[Math.floor(Math.random() * colors.length)] };
    $('#category-editor').appendChild(buildCategoryRow(c, state.categories.length));
  });
  $('#category-modal').addEventListener('click', (e) => {
    if (e.target.id === 'category-modal') $('#category-modal').hidden = true;
  });

  // Export
  $('#export-btn').addEventListener('click', openExportModal);
  $('#export-modal-close').addEventListener('click', () => { $('#export-modal').hidden = true; });
  $('#export-modal-done').addEventListener('click', () => { $('#export-modal').hidden = true; });
  $('#export-copy-cmd').addEventListener('click', copyExportCmd);
  $('#export-modal').addEventListener('click', (e) => {
    if (e.target.id === 'export-modal') $('#export-modal').hidden = true;
  });

  // Esc closes any modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('.modal-backdrop').forEach(m => m.hidden = true);
    }
  });

  // Warn before unload if dirty
  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

// ---------- Boot ----------
async function init() {
  bind();
  await loadAll();
  renderAll();
}

init();
