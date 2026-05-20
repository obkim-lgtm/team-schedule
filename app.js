// =====================================================================
// 팀 일정 (team-schedule)
// 저장 경로 두 가지:
//   1) localhost(server.js): PUT /api/save/<file> → 즉시 git push
//   2) 그 외(배포 사이트): Gitea workflow_dispatch → 약 20~40초 후 반영
// 노션 연동 없음. 모든 일정은 수동 등록.
// =====================================================================

const DATA_FILES = {
  categories:   'data/categories.json',
  manualEvents: 'data/manual-events.json',
  memos:        'data/memos.json',
};
const MEMO_DEBOUNCE_MS = 1500;

// 편집 가능 호스트: localhost + LAN 사설망(RFC1918).
// server.js가 0.0.0.0에 바인딩되므로 같은 LAN의 어떤 PC에서든 IP로 접속하면 편집 가능.
const IS_LOCAL = (
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1' ||
  /^192\.168\.\d+\.\d+$/.test(location.hostname) ||
  /^10\.\d+\.\d+\.\d+$/.test(location.hostname) ||
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(location.hostname)
);

const GITEA_BASE = 'https://gitea.ddapp.io';
const GITEA_REPO = 'Internal-Tool/team-schedule';
const GITEA_WORKFLOW = 'save-data.yml';
const GITEA_REF = 'pages';
const PAT_KEY = 'team_schedule_gitea_pat';

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

function autoResizeTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  const max = Math.floor(window.innerHeight * 0.6);
  el.style.height = Math.min(el.scrollHeight + 2, max) + 'px';
}

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

// ---------- Link helpers ----------
function detectLinkInfo(url) {
  if (!url) return { type: 'other', label: '링크', color: '#6B7280' };
  let host;
  try { host = new URL(url).hostname.toLowerCase(); }
  catch { return { type: 'other', label: '링크', color: '#9CA3AF' }; }

  if (host.endsWith('notion.so') || host.endsWith('notion.site'))   return { type: 'notion', label: 'Notion',     color: '#111111' };
  if (host.endsWith('figma.com'))                                    return { type: 'figma',  label: 'Figma',      color: '#F24E1E' };
  if (host.endsWith('github.com') || host.endsWith('gitea.ddapp.io'))return { type: 'git',    label: 'Git',        color: '#181717' };
  if (host.endsWith('slack.com'))                                    return { type: 'slack',  label: 'Slack',      color: '#611F69' };
  if (host.includes('docs.google.com'))                              return { type: 'gdocs',  label: 'Google Docs',color: '#4285F4' };
  if (host.includes('drive.google.com'))                             return { type: 'gdrive', label: 'Drive',      color: '#1FA463' };
  return { type: 'other', label: host.replace(/^www\./, ''), color: '#4B5563' };
}

function defaultLinkTitle(link) {
  if (link.label) return link.label;
  if (!link.url) return '(URL 없음)';
  try {
    const u = new URL(link.url);
    const tail = u.pathname.split('/').filter(Boolean).pop() || '';
    return tail
      ? u.hostname.replace(/^www\./, '') + ' / ' + decodeURIComponent(tail).replace(/-[0-9a-f]{20,}$/i, '')
      : u.hostname.replace(/^www\./, '');
  } catch { return link.url; }
}

function styleBadge(badge, info) {
  badge.textContent = info.label;
  badge.style.background = info.color + '1A';
  badge.style.color = info.color;
  badge.style.borderColor = info.color + '33';
}

// ---------- Save status ----------
function setSaveStatus(kind, text) {
  const el = $('#save-status');
  el.className = 'save-status ' + kind;
  el.querySelector('.save-text').textContent = text;
}

// ---------- PAT (for deployed environment) ----------
function getPAT() { return localStorage.getItem(PAT_KEY); }

function promptForPAT() {
  return new Promise((resolve) => {
    closeAllModals();
    $('#pat-input').value = '';
    $('#pat-modal').hidden = false;
    setTimeout(() => $('#pat-input').focus(), 50);

    const cleanup = () => {
      $('#pat-save').onclick = null;
      $('#pat-cancel').onclick = null;
      $('#pat-modal-close').onclick = null;
      $('#pat-input').onkeydown = null;
    };
    const onSave = () => {
      const val = $('#pat-input').value.trim();
      if (!val) { showToast('토큰을 입력해주세요'); return; }
      localStorage.setItem(PAT_KEY, val);
      $('#pat-modal').hidden = true;
      cleanup();
      resolve(val);
    };
    const onCancel = () => {
      $('#pat-modal').hidden = true;
      cleanup();
      resolve(null);
    };
    $('#pat-save').onclick = onSave;
    $('#pat-cancel').onclick = onCancel;
    $('#pat-modal-close').onclick = onCancel;
    $('#pat-input').onkeydown = (e) => {
      if (e.key === 'Enter') onSave();
      if (e.key === 'Escape') onCancel();
    };
  });
}

async function ensurePAT() {
  let token = getPAT();
  if (!token) token = await promptForPAT();
  return token;
}

// ---------- Save (env-aware) ----------
let saveTimers = {};
let dispatchQueue = Promise.resolve();

async function saveViaLocalhost(filename, payload) {
  const res = await fetch('/api/save/' + filename, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + await res.text());
}

function utf8ToBase64(str) { return btoa(unescape(encodeURIComponent(str))); }

async function saveViaDispatch(filename, payload) {
  const token = await ensurePAT();
  if (!token) throw new Error('PAT 없음');
  const body = {
    ref: GITEA_REF,
    inputs: {
      filename: filename,
      content_b64: utf8ToBase64(JSON.stringify(payload, null, 2)),
    },
  };
  const res = await fetch(
    `${GITEA_BASE}/api/v1/repos/${GITEA_REPO}/actions/workflows/${GITEA_WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'token ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem(PAT_KEY);
    throw new Error('PAT 인증 실패 — 다시 입력해주세요');
  }
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
}

async function postSave(filename, payload) {
  // dispatch는 직렬화 (PAT 모달 동시 호출 방지)
  dispatchQueue = dispatchQueue.then(async () => {
    setSaveStatus('saving', '저장 중…');
    try {
      if (IS_LOCAL) {
        await saveViaLocalhost(filename, payload);
        setSaveStatus('saved', '저장됨');
      } else {
        await saveViaDispatch(filename, payload);
        setSaveStatus('saved', '저장됨 · 약 30초 후 반영');
      }
      clearTimeout(saveTimers._reset);
      saveTimers._reset = setTimeout(() => {
        if ($('#save-status').classList.contains('saved')) {
          setSaveStatus('idle', '대기');
        }
      }, IS_LOCAL ? 2500 : 6000);
    } catch (e) {
      console.error('[save fail]', e);
      setSaveStatus('error', '저장 실패');
      showToast(`저장 실패: ${e.message}`);
    }
  });
  return dispatchQueue;
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
      more.style.cursor = 'pointer';
      more.addEventListener('click', (ev) => { ev.stopPropagation(); openDayEventsModal(date); });
      chips.appendChild(more);
    }
    cell.appendChild(chips);

    const hint = document.createElement('span');
    hint.className = 'day-add-hint';
    hint.textContent = '+';
    hint.setAttribute('aria-hidden', 'true');
    cell.appendChild(hint);

    cell.addEventListener('click', () => openEventModal(null, fmtDate(date)));
    grid.appendChild(cell);
  });
}

// ---------- Side pane ----------
function renderMemo() {
  const key = fmtMonth(state.current);
  $('#memo-title').textContent = `${state.current.getFullYear()}년 ${state.current.getMonth() + 1}월 메모`;
  const el = $('#memo-textarea');
  el.value = state.memos[key] || '';
  autoResizeTextarea(el);
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

// ---------- Event links editor ----------
function buildLinkRow(link) {
  const row = document.createElement('div');
  row.className = 'link-row';

  const top = document.createElement('div');
  top.className = 'link-row-top';

  const badge = document.createElement('span');
  badge.className = 'link-type-badge';

  const urlInput = document.createElement('input');
  urlInput.type = 'url';
  urlInput.className = 'link-url';
  urlInput.placeholder = 'https://...';
  urlInput.value = link.url || '';

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'icon-btn';
  openBtn.title = '새 탭에서 열기';
  openBtn.textContent = '↗';
  openBtn.addEventListener('click', () => {
    const u = urlInput.value.trim();
    if (u) window.open(u, '_blank', 'noopener,noreferrer');
  });

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'icon-btn link-del';
  delBtn.title = '삭제';
  delBtn.textContent = '×';
  delBtn.addEventListener('click', () => { row.remove(); });

  top.appendChild(badge);
  top.appendChild(urlInput);
  top.appendChild(openBtn);
  top.appendChild(delBtn);

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'link-label-input';
  labelInput.placeholder = '제목 (선택 · 예: 릴리즈 노트)';
  labelInput.value = link.label || '';

  row.appendChild(top);
  row.appendChild(labelInput);

  const refresh = () => styleBadge(badge, detectLinkInfo(urlInput.value.trim()));
  urlInput.addEventListener('input', refresh);
  refresh();

  return row;
}

function buildLinkCardReadonly(link) {
  const a = document.createElement('a');
  a.className = 'link-card';
  a.href = link.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';

  const badge = document.createElement('span');
  badge.className = 'link-type-badge';
  styleBadge(badge, detectLinkInfo(link.url));

  const title = document.createElement('span');
  title.className = 'link-card-title';
  title.textContent = defaultLinkTitle(link);

  const arrow = document.createElement('span');
  arrow.className = 'link-card-arrow';
  arrow.textContent = '↗';

  a.appendChild(badge);
  a.appendChild(title);
  a.appendChild(arrow);
  return a;
}

function renderLinksEditor(links) {
  const container = $('#event-links-editor');
  container.innerHTML = '';
  const items = links || [];
  if (!IS_LOCAL) {
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'links-empty';
      empty.textContent = '참고 링크 없음';
      container.appendChild(empty);
    } else {
      items.forEach(l => container.appendChild(buildLinkCardReadonly(l)));
    }
  } else {
    items.forEach(l => container.appendChild(buildLinkRow(l)));
  }
}

function collectLinks() {
  const rows = $$('#event-links-editor .link-row');
  const out = [];
  rows.forEach(r => {
    const url = r.querySelector('.link-url').value.trim();
    if (!url) return;
    const label = r.querySelector('.link-label-input').value.trim();
    out.push(label ? { url, label } : { url });
  });
  return out;
}

function openEventModal(event, defaultDate) {
  closeAllModals();
  editingEventId = event?.id || null;
  const isEdit = !!event;

  // 배포(보기 전용): 빈 날짜 클릭은 무시. 칩 클릭만 모달 표시
  if (!IS_LOCAL && !isEdit) return;

  $('#event-modal-title').textContent = !IS_LOCAL ? '일정 보기' : (isEdit ? '일정 수정' : '일정 추가');
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

  ['#event-title', '#event-start', '#event-end', '#event-category', '#event-note'].forEach(s => {
    $(s).disabled = !IS_LOCAL;
  });
  renderLinksEditor(event?.links || []);
  $('#event-link-add').hidden = !IS_LOCAL;
  $('#event-delete').hidden = !isEdit || !IS_LOCAL;
  $('#event-save').hidden = !IS_LOCAL;

  $('#event-modal').hidden = false;
  if (IS_LOCAL) setTimeout(() => $('#event-title').focus(), 50);
}

function closeEventModal() {
  $('#event-modal').hidden = true;
  editingEventId = null;
}

// ---------- Day events modal (+ N개 더 클릭 시) ----------
function openDayEventsModal(date) {
  closeAllModals();
  const evts = eventsOnDay(date);
  const m = date.getMonth() + 1;
  const d = date.getDate();
  $('#day-events-title').textContent = `${m}월 ${d}일 · 일정 ${evts.length}건`;

  const list = $('#day-events-list');
  list.innerHTML = '';
  if (evts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'event-list-empty';
    empty.textContent = '이날 일정이 없습니다.';
    list.appendChild(empty);
  } else {
    evts.forEach(e => {
      const row = document.createElement('div');
      row.className = 'day-event-row';

      const dot = document.createElement('div');
      dot.className = 'day-event-row-dot';
      dot.style.background = findCategory(e.category).color;

      const title = document.createElement('div');
      title.className = 'day-event-row-title';
      title.textContent = e.title;

      row.appendChild(dot);
      row.appendChild(title);

      const linkCount = (e.links || []).length;
      if (linkCount) {
        const meta = document.createElement('div');
        meta.className = 'day-event-row-meta';
        meta.textContent = `🔗 ${linkCount}`;
        row.appendChild(meta);
      }

      row.addEventListener('click', () => {
        $('#day-events-modal').hidden = true;
        openEventModal(e);
      });
      list.appendChild(row);
    });
  }

  const addBtn = $('#day-events-add');
  addBtn.hidden = !IS_LOCAL;
  addBtn.onclick = () => {
    $('#day-events-modal').hidden = true;
    openEventModal(null, fmtDate(date));
  };

  $('#day-events-modal').hidden = false;
}

async function handleSaveEvent() {
  const title = $('#event-title').value.trim();
  const start = $('#event-start').value;
  const end = $('#event-end').value || '';
  const category = $('#event-category').value;
  const note = $('#event-note').value.trim();
  const links = collectLinks();

  if (!title) { showToast('제목을 입력하세요'); return; }
  if (!start) { showToast('시작일을 입력하세요'); return; }
  if (end && end < start) { showToast('종료일이 시작일보다 빠릅니다'); return; }

  if (editingEventId) {
    const idx = state.events.findIndex(e => e.id === editingEventId);
    if (idx >= 0) state.events[idx] = { id: editingEventId, title, start, end, category, note, links };
  } else {
    state.events.push({ id: newId(), title, start, end, category, note, links });
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
  autoResizeTextarea(e.target);
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
  $('#event-link-add').addEventListener('click', () => {
    $('#event-links-editor').appendChild(buildLinkRow({}));
    const rows = $$('#event-links-editor .link-row');
    rows[rows.length - 1]?.querySelector('.link-url')?.focus();
  });
  $('#event-modal').addEventListener('click', (e) => { if (e.target.id === 'event-modal') closeEventModal(); });

  $('#day-events-close').addEventListener('click', () => { $('#day-events-modal').hidden = true; });
  $('#day-events-modal').addEventListener('click', (e) => { if (e.target.id === 'day-events-modal') $('#day-events-modal').hidden = true; });

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
  $('#add-event-btn').hidden = true;
  $('#manage-categories-btn').hidden = true;
  $('#save-status').hidden = true;
  const memo = $('#memo-textarea');
  memo.readOnly = true;
  memo.placeholder = '편집은 사무실 내부망(LAN URL)으로 접속해야 가능합니다.';
  document.body.classList.add('readonly');
}

async function init() {
  bind();
  await loadAll();
  renderAll();
  if (!IS_LOCAL) applyReadOnlyMode();
  else setSaveStatus('idle', '대기');
}

init();
