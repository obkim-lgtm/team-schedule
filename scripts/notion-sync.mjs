// =====================================================================
// scripts/notion-sync.mjs
// 노션 데이터베이스를 조회해서 src/data/notion-events.json 으로 저장.
// Gitea Actions에서 cron으로 실행 (.gitea/workflows/notion-sync.yml).
//
// 필요한 env:
//   NOTION_TOKEN        — Internal Integration Secret (secret_...)
//   NOTION_DATABASE_ID  — 캘린더 DB ID (32자리 hex, 하이픈 있어도 무방)
//
// 선택 env:
//   NOTION_DATE_PROP    — 날짜 속성 이름 (기본: "날짜")
//   NOTION_TITLE_PROP   — 제목 속성 이름 (기본: 자동탐지 — type === 'title')
//   NOTION_CATEGORY_PROP — 카테고리 속성 이름 (기본: "카테고리")
// =====================================================================

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '..', 'data', 'notion-events.json');

const TOKEN = process.env.NOTION_TOKEN;
const DB_ID = (process.env.NOTION_DATABASE_ID || '').replace(/-/g, '');
const DATE_PROP = process.env.NOTION_DATE_PROP || '배포일';
const TITLE_PROP = process.env.NOTION_TITLE_PROP || null; // null이면 자동탐지
const CATEGORY_PROP = process.env.NOTION_CATEGORY_PROP || '프로젝트';
const DATE_FROM = process.env.NOTION_DATE_FROM || '2026-05-01';
const NOTION_VERSION = '2022-06-28';

async function writeResult(payload) {
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`[notion-sync] wrote ${OUT_PATH}`);
}

async function fail(reason, err) {
  console.error(`[notion-sync] FAIL: ${reason}`, err || '');
  await writeResult({
    syncedAt: new Date().toISOString(),
    ok: false,
    error: reason + (err ? ` (${err.message || err})` : ''),
    events: [],
  });
  process.exit(1);
}

async function notionFetch(path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

function extractTitle(props, titlePropName) {
  if (titlePropName) {
    const p = props[titlePropName];
    if (p && p.type === 'title') {
      return p.title.map(t => t.plain_text).join('').trim();
    }
  }
  // 자동탐지
  for (const [, p] of Object.entries(props)) {
    if (p.type === 'title') {
      return p.title.map(t => t.plain_text).join('').trim();
    }
  }
  return '(제목 없음)';
}

function extractCategory(props, propName) {
  const p = props[propName];
  if (!p) return '';
  if (p.type === 'select') return p.select?.name || '';
  if (p.type === 'multi_select') return p.multi_select?.[0]?.name || '';
  if (p.type === 'status') return p.status?.name || '';
  return '';
}

function extractDate(props, propName) {
  const p = props[propName];
  if (!p || p.type !== 'date' || !p.date) return null;
  return { start: p.date.start, end: p.date.end };
}

function dateOnly(s) {
  if (!s) return null;
  // '2026-05-19T10:00:00+09:00' or '2026-05-19'
  return s.slice(0, 10);
}

async function main() {
  if (!TOKEN) await fail('NOTION_TOKEN 환경변수가 없습니다.');
  if (!DB_ID) await fail('NOTION_DATABASE_ID 환경변수가 없습니다.');

  const events = [];
  let cursor = undefined;
  let pageCount = 0;

  try {
    do {
      const body = {
        page_size: 100,
        filter: {
          property: DATE_PROP,
          date: { on_or_after: DATE_FROM },
        },
        sorts: [{ property: DATE_PROP, direction: 'ascending' }],
      };
      if (cursor) body.start_cursor = cursor;
      const data = await notionFetch(`/databases/${DB_ID}/query`, body);

      for (const page of data.results) {
        const props = page.properties || {};
        const dateObj = extractDate(props, DATE_PROP);
        if (!dateObj) continue; // 날짜 없는 항목 skip

        events.push({
          id: 'notion_' + page.id.replace(/-/g, ''),
          title: extractTitle(props, TITLE_PROP),
          start: dateOnly(dateObj.start),
          end: dateOnly(dateObj.end) || '',
          category: extractCategory(props, CATEGORY_PROP),
          url: page.url || '',
        });
      }

      cursor = data.has_more ? data.next_cursor : null;
      pageCount++;
      if (pageCount > 50) {
        console.warn('[notion-sync] aborting pagination after 50 pages (5000+ rows)');
        break;
      }
    } while (cursor);
  } catch (err) {
    await fail('노션 API 호출 실패', err);
  }

  events.sort((a, b) => a.start.localeCompare(b.start));

  await writeResult({
    syncedAt: new Date().toISOString(),
    ok: true,
    count: events.length,
    events,
  });
  console.log(`[notion-sync] ok — ${events.length} events`);
}

main();
