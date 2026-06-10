// =====================================================================
// 팀 일정 (team-schedule)
// 저장·로딩 모두 GitHub Contents API. (public repo, 브라우저 CORS 허용)
//   - 읽기: API raw로 항상 최신 (인증 없이도 됨, public repo)
//   - 쓰기: PAT 1회 입력 → localStorage. 누구든 PAT 있으면 편집
// 노션 연동 없음. 모든 일정은 수동 등록.
// =====================================================================

const DATA_FILES = {
  categories:   'data/categories.json',
  manualEvents: 'data/manual-events.json',
  memos:        'data/memos.json',
};
const MEMO_DEBOUNCE_MS = 1500;

// GitHub
const GH_OWNER = 'obkim-lgtm';
const GH_REPO = 'team-schedule';
const GH_BRANCH = 'main';
const GH_API = 'https://api.github.com';
const PAT_KEY = 'team_schedule_github_pat';

// GitHub API는 어디서든(브라우저) 호출 가능 → 항상 편집 가능. 첫 저장 시 PAT 1회 입력.
const EDITABLE = true;

const state = {
  current: new Date(),
  categories: [],
  events: [],
  memos: {},
  fileSha: {},   // path → 마지막으로 본 GitHub blob sha (충돌 방지용)
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

// 배경색 밝기(YIQ)로 글자색 자동 결정 — 밝으면 검정, 어두우면 흰색
function textColorOn(hex) {
  const c = (hex || '').replace('#', '');
  if (c.length < 6) return '#1A1D23';
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? '#1A1D23' : '#FFFFFF';
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

// ---------- Save (GitHub Contents API) ----------
let saveTimers = {};
let saveQueue = Promise.resolve();

function utf8ToBase64(str) { return btoa(unescape(encodeURIComponent(str))); }

async function ghGetSha(path, token) {
  const headers = { 'Accept': 'application/vnd.github+json' };
  if (token) headers['Authorization'] = 'token ' + token;
  const res = await fetch(`${GH_API}/repos/${GH_OWNER}/${GH_REPO}/contents/${path}?ref=${GH_BRANCH}&t=${Date.now()}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('sha 조회 실패 HTTP ' + res.status);
  const d = await res.json();
  return d.sha;
}

async function ghPutFile(path, contentStr, message, token) {
  let sha = state.fileSha[path];
  if (sha === undefined) sha = await ghGetSha(path, token);

  const body = { message, content: utf8ToBase64(contentStr), branch: GH_BRANCH };
  if (sha) body.sha = sha;

  const res = await fetch(`${GH_API}/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      'Authorization': 'token ' + token,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem(PAT_KEY);
    throw new Error('AUTH_FAIL');
  }
  if (res.status === 409 || res.status === 422) {
    // 다른 사람이 먼저 저장 → sha 갱신 후 1회 재시도
    const fresh = await ghGetSha(path, token);
    if (fresh !== sha) { state.fileSha[path] = fresh; return ghPutFile(path, contentStr, message, token); }
    throw new Error('충돌(다시 시도): ' + res.status);
  }
  if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + await res.text().catch(() => ''));

  const result = await res.json();
  state.fileSha[path] = result.content?.sha;
}

async function postSave(filename, payload) {
  const path = 'data/' + filename;
  const contentStr = JSON.stringify(payload, null, 2) + '\n';
  // 직렬화 (PAT 모달 동시 호출 방지 + sha 충돌 방지)
  saveQueue = saveQueue.then(async () => {
    setSaveStatus('saving', '저장 중…');
    try {
      const token = await ensurePAT();
      if (!token) throw new Error('NO_PAT');
      await ghPutFile(path, contentStr, `갱신: ${filename}`, token);
      setSaveStatus('saved', '저장됨');
      clearTimeout(saveTimers._reset);
      saveTimers._reset = setTimeout(() => {
        if ($('#save-status').classList.contains('saved')) setSaveStatus('idle', '대기');
      }, 2500);
    } catch (e) {
      console.error('[save fail]', e);
      if (e.message === 'NO_PAT') { setSaveStatus('error', 'PAT 필요'); showToast('PAT를 입력해야 저장돼요'); }
      else if (e.message === 'AUTH_FAIL') { setSaveStatus('error', 'PAT 오류'); showToast('토큰이 유효하지 않아요. 다시 입력해주세요'); }
      else { setSaveStatus('error', '저장 실패'); showToast(`저장 실패: ${e.message}`); }
    }
  });
  return saveQueue;
}

function saveEventsFile()     { return postSave('manual-events.json', { events: state.events }); }
function saveCategoriesFile() { return postSave('categories.json',    { categories: state.categories }); }
function saveMemosFile()      { return postSave('memos.json',         { memos: state.memos }); }

// ---------- Data loading (GitHub API, 항상 최신) ----------
// API contents로 읽으면 커밋 직후에도 최신. sha도 함께 캐시해 저장 충돌 방지.
// API 실패(rate limit 등) 시 Pages 정적 파일로 폴백.
async function loadOne(path, fallback) {
  const token = getPAT();
  try {
    const headers = { 'Accept': 'application/vnd.github+json' };
    if (token) headers['Authorization'] = 'token ' + token;
    const res = await fetch(`${GH_API}/repos/${GH_OWNER}/${GH_REPO}/contents/${path}?ref=${GH_BRANCH}&t=${Date.now()}`, { headers });
    if (res.status === 404) return fallback;
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    state.fileSha[path] = d.sha;
    const json = decodeURIComponent(escape(atob(d.content)));
    return JSON.parse(json);
  } catch (e) {
    console.warn('[API load fail, fallback to static]', path, e);
    try {
      const res2 = await fetch(path + '?t=' + Date.now());
      if (res2.ok) return await res2.json();
    } catch (_) {}
    return fallback;
  }
}

async function loadAll() {
  const [cats, manual, memos] = await Promise.all([
    loadOne(DATA_FILES.categories,   { categories: DEFAULT_CATEGORIES }),
    loadOne(DATA_FILES.manualEvents, { events: [] }),
    loadOne(DATA_FILES.memos,        { memos: {} }),
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

// ---------- Calendar (주 단위 + 멀티데이 spanning 막대) ----------
const MS_DAY = 86400000;
const CAL_MAX_LANES = 3;   // 한 주에서 보여줄 막대 줄 수
const CAL_LANE_H = 21;     // 막대 한 줄 높이(px)
let draggingId = null;     // 드래그 중인 일정 id

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
    const nd = new Date(last.year, last.month, last.day + 1);
    cells.push({ year: nd.getFullYear(), month: nd.getMonth(), day: nd.getDate(), otherMonth: true });
  }

  const today = new Date();

  for (let w = 0; w < 6; w++) {
    const weekCellMeta = cells.slice(w * 7, w * 7 + 7);
    const weekDates = weekCellMeta.map(c => new Date(c.year, c.month, c.day));
    const weekStart = weekDates[0];
    const weekEnd = weekDates[6];
    const weekStartISO = fmtDate(weekStart);
    const weekEndISO = fmtDate(weekEnd);

    const weekEl = document.createElement('div');
    weekEl.className = 'cal-week';

    // (1) 날짜 셀 레이어
    const cellsLayer = document.createElement('div');
    cellsLayer.className = 'cal-week-cells';
    weekCellMeta.forEach((c) => {
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

      const hint = document.createElement('span');
      hint.className = 'day-add-hint';
      hint.textContent = '+';
      hint.setAttribute('aria-hidden', 'true');
      cell.appendChild(hint);

      cell.addEventListener('click', () => openEventModal(null, fmtDate(date)));

      // 드롭 타겟 (일정 날짜 이동)
      cell.addEventListener('dragover', (ev) => {
        if (!draggingId) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'move';
        cell.classList.add('drag-over');
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', (ev) => {
        ev.preventDefault();
        cell.classList.remove('drag-over');
        const id = draggingId;
        draggingId = null;
        document.body.classList.remove('dragging');
        if (!id) return;
        const evt = state.events.find(x => x.id === id);
        if (!evt) return;
        const dropISO = cell.dataset.date;
        if (dropISO === evt.start) return;
        const offset = Math.round((parseDate(dropISO) - parseDate(evt.start)) / MS_DAY);
        evt.start = dropISO;
        if (evt.end) evt.end = fmtDate(new Date(parseDate(evt.end).getTime() + offset * MS_DAY));
        renderCalendar();
        renderEventList();
        saveEventsFile();
        showToast('날짜 이동됨');
      });

      cellsLayer.appendChild(cell);
    });
    weekEl.appendChild(cellsLayer);

    // (2) 이벤트 막대 레이어
    const barsLayer = document.createElement('div');
    barsLayer.className = 'cal-week-bars';

    const weekEvents = state.events
      .filter(e => { const en = e.end || e.start; return !(en < weekStartISO || e.start > weekEndISO); })
      .sort((a, b) => {
        if (a.start !== b.start) return a.start.localeCompare(b.start);
        const ad = a.end || a.start, bd = b.end || b.start;
        return bd.localeCompare(ad); // 같은 시작일이면 긴 일정 먼저
      });

    const lanes = [];                 // lanes[i] = [{startCol,endCol}]
    const hidden = new Array(7).fill(0);

    weekEvents.forEach(e => {
      const enISO = e.end || e.start;
      const segStartDate = e.start < weekStartISO ? weekStart : parseDate(e.start);
      const segEndDate = enISO > weekEndISO ? weekEnd : parseDate(enISO);
      const startCol = Math.round((segStartDate - weekStart) / MS_DAY);
      const endCol = Math.round((segEndDate - weekStart) / MS_DAY);

      let lane = -1;
      for (let li = 0; li < lanes.length; li++) {
        if (!lanes[li].some(s => !(endCol < s.startCol || startCol > s.endCol))) { lane = li; break; }
      }
      if (lane === -1) { lanes.push([]); lane = lanes.length - 1; }
      lanes[lane].push({ startCol, endCol });

      if (lane >= CAL_MAX_LANES) {
        for (let col = startCol; col <= endCol; col++) hidden[col]++;
        return;
      }

      const cat = findCategory(e.category);
      const bar = document.createElement('div');
      bar.className = 'cal-bar';
      if (e.start < weekStartISO) bar.classList.add('cut-left');
      if (enISO > weekEndISO) bar.classList.add('cut-right');
      bar.style.background = cat.color;
      bar.style.color = textColorOn(cat.color);
      bar.style.left = `calc(${startCol} / 7 * 100% + 3px)`;
      bar.style.width = `calc(${endCol - startCol + 1} / 7 * 100% - 6px)`;
      bar.style.top = (lane * CAL_LANE_H) + 'px';
      bar.textContent = (e.start < weekStartISO ? '◂ ' : '') + e.title;
      bar.title = e.title + ' (드래그해서 날짜 이동)';
      bar.addEventListener('click', (ev) => { ev.stopPropagation(); openEventModal(e); });

      // 드래그로 날짜 이동
      bar.draggable = true;
      bar.addEventListener('dragstart', (ev) => {
        draggingId = e.id;
        ev.dataTransfer.effectAllowed = 'move';
        try { ev.dataTransfer.setData('text/plain', e.id); } catch (_) {}
        // dragstart 중 동기 DOM/스타일 변경은 Chrome이 드래그를 취소시킴 → 한 프레임 뒤로
        setTimeout(() => { if (draggingId) document.body.classList.add('dragging'); }, 0);
      });
      bar.addEventListener('dragend', () => {
        draggingId = null;
        document.body.classList.remove('dragging');
        $$('.day-cell.drag-over').forEach(c => c.classList.remove('drag-over'));
      });
      barsLayer.appendChild(bar);
    });

    // (3) 넘친 일정 "+N"
    hidden.forEach((n, col) => {
      if (n <= 0) return;
      const more = document.createElement('div');
      more.className = 'cal-bar-more';
      more.style.left = `calc(${col} / 7 * 100% + 3px)`;
      more.style.width = `calc(1 / 7 * 100% - 6px)`;
      more.style.top = (CAL_MAX_LANES * CAL_LANE_H) + 'px';
      more.textContent = `+${n}`;
      const date = weekDates[col];
      more.addEventListener('click', (ev) => { ev.stopPropagation(); openDayEventsModal(date); });
      barsLayer.appendChild(more);
    });

    weekEl.appendChild(barsLayer);
    grid.appendChild(weekEl);
  }
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
  if (!EDITABLE) {
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
  if (!EDITABLE && !isEdit) return;

  $('#event-modal-title').textContent = !EDITABLE ? '일정 보기' : (isEdit ? '일정 수정' : '일정 추가');
  $('#event-title').value = event?.title || '';
  $('#event-start').value = event?.start || defaultDate || todayISO();
  $('#event-start').dataset.prev = $('#event-start').value;
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
    $(s).disabled = !EDITABLE;
  });
  renderLinksEditor(event?.links || []);
  $('#event-link-add').hidden = !EDITABLE;
  $('#event-delete').hidden = !isEdit || !EDITABLE;
  $('#event-save').hidden = !EDITABLE;

  $('#event-modal').hidden = false;
  if (EDITABLE) setTimeout(() => $('#event-title').focus(), 50);
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
  addBtn.hidden = !EDITABLE;
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

  // 시작일 바꾸면 종료일도 기간 유지하며 자동 이동
  $('#event-start').addEventListener('change', (e) => {
    const endEl = $('#event-end');
    const prev = $('#event-start').dataset.prev;
    const next = e.target.value;
    if (endEl.value && prev && next && prev !== next) {
      const offset = Math.round((parseDate(next) - parseDate(prev)) / MS_DAY);
      if (offset !== 0) endEl.value = fmtDate(new Date(parseDate(endEl.value).getTime() + offset * MS_DAY));
    }
    $('#event-start').dataset.prev = next;
  });
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
  if (!EDITABLE) { applyReadOnlyMode(); return; }

  setSaveStatus('idle', getPAT() ? '대기' : 'PAT 미설정');

  // 상태 칩 클릭 → PAT 재입력 (오류났거나 미설정일 때)
  $('#save-status').addEventListener('click', async () => {
    if ($('#save-status').classList.contains('error') || !getPAT()) {
      await promptForPAT();
      setSaveStatus('idle', getPAT() ? '대기' : 'PAT 미설정');
    }
  });
}

init();
