// =====================================================================
// team-schedule server
// - 정적 파일 서빙 (index.html, app.js, styles.css, data/*.json)
// - PUT /api/save/<file> → data/<file>에 쓰기 + 자동 git commit·push (background)
// - PUT body는 JSON. 응답은 파일 저장 직후 즉시 (push는 background)
// =====================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = parseInt(process.env.PORT || '5184', 10);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const ALLOWED_FILES = ['categories.json', 'manual-events.json', 'memos.json'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

// ---------- Git auto-push (debounced & coalesced) ----------
let pushTimer = null;
const pushQueue = new Set();          // 변경된 파일 경로 모음
let pushing = false;
let pushPending = false;              // pushing 중 또 들어왔는지

function runGit(args, cb) {
  exec(`git ${args}`, { cwd: ROOT }, (err, stdout, stderr) => {
    cb(err, stdout, stderr);
  });
}

function schedulePush(relpath) {
  pushQueue.add(relpath);
  clearTimeout(pushTimer);
  pushTimer = setTimeout(flushPush, 1500);  // 1.5초 idle 후 묶어서 push
}

function flushPush() {
  if (pushing) { pushPending = true; return; }
  if (pushQueue.size === 0) return;

  pushing = true;
  const files = [...pushQueue];
  pushQueue.clear();

  const addArgs = files.map(f => `"${f}"`).join(' ');
  runGit(`add ${addArgs}`, (e1) => {
    if (e1) { console.error('[git add]', e1.message); pushing = false; return; }
    runGit(`diff --staged --quiet`, (e2) => {
      if (!e2) {
        // 변경 없음 (e2가 null이면 staged 변경 없음 = exit 0)
        console.log('[push] no staged changes');
        pushing = false;
        if (pushPending) { pushPending = false; flushPush(); }
        return;
      }
      const msg = `갱신: ${files.map(f => f.replace(/^data\//, '')).join(', ')}`;
      runGit(`commit -m "${msg}"`, (e3) => {
        if (e3) { console.error('[git commit]', e3.message); pushing = false; return; }
        runGit('push', (e4, _o, stderr4) => {
          if (e4) console.error('[git push]', stderr4 || e4.message);
          else console.log('[push] ok —', msg);
          pushing = false;
          if (pushPending) { pushPending = false; flushPush(); }
        });
      });
    });
  });
}

// ---------- HTTP handlers ----------
function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function handleSave(req, res, filename) {
  if (!ALLOWED_FILES.includes(filename)) {
    return sendJSON(res, 400, { error: 'not allowed', filename });
  }
  let body = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) req.destroy(); });
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body); }
    catch (e) { return sendJSON(res, 400, { error: 'invalid JSON', detail: e.message }); }

    const filepath = path.join(DATA_DIR, filename);
    try {
      fs.writeFileSync(filepath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    } catch (e) {
      return sendJSON(res, 500, { error: 'write failed', detail: e.message });
    }

    schedulePush(`data/${filename}`);
    sendJSON(res, 200, { ok: true });
  });
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filepath = path.join(ROOT, urlPath);

  // Prevent directory traversal
  if (!filepath.startsWith(ROOT + path.sep) && filepath !== ROOT) {
    res.writeHead(403); return res.end();
  }

  fs.stat(filepath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found: ' + urlPath);
    }
    const ext = path.extname(filepath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    fs.createReadStream(filepath).pipe(res);
  });
}

http.createServer((req, res) => {
  if (req.method === 'PUT' && req.url.startsWith('/api/save/')) {
    const file = req.url.slice('/api/save/'.length).split('?')[0];
    return handleSave(req, res, file);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); return res.end('Method Not Allowed');
  }
  serveStatic(req, res);
}).listen(PORT, () => {
  console.log(`[team-schedule] http://localhost:${PORT}`);
});

// graceful shutdown — pending push가 있으면 마무리 시도
process.on('SIGINT', () => {
  console.log('\n[shutdown] flushing pending push…');
  flushPush();
  setTimeout(() => process.exit(0), 5000);
});
