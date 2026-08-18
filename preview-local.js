/**
 * CONTEC+ 로컬 미리보기 서버
 * ---------------------------------------------------------------
 *  실제 index.html 을 그대로 띄워서 게임을 직접 해볼 수 있게 해준다.
 *  DB(/rest/v1)는 이 파일 안의 "가짜 메모리 DB"로 응답하므로
 *  ★ 라이브 데이터에는 아무 영향이 없다 (읽지도, 쓰지도 않음).
 *
 *  실행:  node preview-local.js
 *  접속:  http://localhost:8787
 *
 *  로그인 (아무거나 선택)
 *    · 관리자: 사번 9999 / 암호 contec@admin   → 기능 공개 설정·미리보기·용어 관리까지 확인
 *    · 직원  : 사번 1001 / 암호 1001          → 직원이 보는 화면 그대로
 *
 *  서버를 껐다 켜면 저장된 점수·설정은 초기화된다.
 *  ※ 이 파일은 개발용이며 배포(GitHub Pages)에는 아무 영향이 없다.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 8787;
const ROOT = __dirname;

// ── 가짜 DB (메모리) ───────────────────────────────────────────
const db = {
  employees: [
    { id: 1, emp_no: '9999', name: '관리자', is_active: true, password: null },
    { id: 2, emp_no: '1001', name: '김우주', is_active: true, password: null },
    { id: 3, emp_no: '1002', name: '이지구', is_active: true, password: null },
  ],
  // 미리보기 편의를 위해 새 게임을 처음부터 공개로 켜둔다 (라이브 기본값은 비공개)
  app_settings: [
    { key: 'feature_visibility', value: JSON.stringify({ typing: true, match: true }) },
    // 미리보기에서는 공지 팝업이 홈을 가리지 않도록 꺼둔다
    { key: 'announcement_popup', value: JSON.stringify({ enabled: false }) },
  ],
  game_scores: seedScores(),
  typing_scores: [],
  quiz_attempts: [], quiz_assignments: [], race_entries: [], race_results: [],
  attendance_checks: [], funny_submissions: [], idea_submissions: [], comments: [],
  faq_items: [], qa_questions: [], push_subscriptions: [], scheduled_emails: [],
};
let nextId = 1000;

function ym() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); }

// 랭킹 화면이 비어 보이지 않도록 남이 세운 기록 1건을 깔아둔다 (이틀 전 기록이라 하루 1회 제한과 무관)
function seedScores() {
  return [{ id: 1, game_key: 'match', emp_no: '1002', employee_name: '이지구', score: 2480,
    detail: { pairs: 21, attempts: 27, stages: 2, acc: 78 }, year_month: ym(), created_at: daysAgo(2) }];
}

// ── PostgREST 흉내: 필터 / 정렬 / limit 만 최소 지원 ────────────
function applyQuery(rows, query) {
  let out = [...rows];
  const params = new URLSearchParams(query || '');
  for (const [key, raw] of params.entries()) {
    if (['order', 'limit', 'offset', 'select'].includes(key)) continue;
    const [op, ...rest] = raw.split('.');
    const val = rest.join('.');
    out = out.filter(r => {
      const v = r[key];
      switch (op) {
        case 'eq':  return String(v) === val || (val === 'true' && v === true) || (val === 'false' && v === false);
        case 'neq': return String(v) !== val;
        case 'gte': return v >= val;
        case 'lte': return v <= val;
        case 'gt':  return v > val;
        case 'lt':  return v < val;
        case 'in':  return val.replace(/[()]/g, '').split(',').includes(String(v));
        case 'is':  return val === 'null' ? (v === null || v === undefined) : String(v) === val;
        default:    return true;
      }
    });
  }
  const order = params.get('order');
  if (order) {
    const [col, dir] = order.split('.');
    out.sort((a, b) => {
      const x = a[col], y = b[col];
      if (x === y) return 0;
      return ((x > y) ? 1 : -1) * (dir === 'desc' ? -1 : 1);
    });
  }
  const limit = params.get('limit');
  if (limit) out = out.slice(0, Number(limit));
  return out;
}

// 하루 1회 제한 — 라이브 트리거와 같은 규칙을 로컬에서도 재현
function violatesDailyGuard(table, row) {
  if (table !== 'game_scores' && table !== 'typing_scores') return false;
  const today = new Date().toISOString().slice(0, 10);
  return db[table].some(r =>
    r.emp_no === row.emp_no &&
    (table === 'typing_scores' || r.game_key === row.game_key) &&
    String(r.created_at).slice(0, 10) === today
  );
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.css': 'text/css; charset=utf-8' };

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  const pathname = decodeURIComponent(parsed.pathname);

  // ── 기록 초기화 (미리보기 편의: 하루 1회 제한을 풀고 다시 플레이) ──
  if (pathname === '/reset') {
    db.game_scores = seedScores();
    db.typing_scores = [];
    console.log('  ★ 게임 기록 초기화 — 다시 도전 가능');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<meta charset="utf-8"><body style="background:#000820;color:#00ff88;font-family:sans-serif;padding:40px;text-align:center;">
      <h2>🔄 게임 기록을 초기화했습니다</h2><p style="color:#8ab;">이제 다시 도전할 수 있습니다.</p>
      <p><a href="/" style="color:#00eeff;">← 앱으로 돌아가기</a></p></body>`);
  }

  // ── REST API 흉내 ──
  if (pathname.startsWith('/rest/v1/')) {
    const table = pathname.slice('/rest/v1/'.length).split('/')[0];
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (!db[table]) db[table] = [];

    if (req.method === 'GET') {
      const rows = applyQuery(db[table], parsed.query);
      console.log(`  GET  ${table} (${parsed.query || '-'}) → ${rows.length}건`);
      return send(200, rows);
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        let data;
        try { data = JSON.parse(body || '{}'); } catch (e) { return send(400, { message: 'bad json' }); }
        const items = Array.isArray(data) ? data : [data];
        const prefer = req.headers['prefer'] || '';
        const isUpsert = prefer.includes('merge-duplicates');
        for (const item of items) {
          if (!isUpsert && violatesDailyGuard(table, item)) {
            console.log(`  POST ${table} → 거부 (하루 1회 제한)`);
            return send(400, { message: '이 게임은 하루 1회만 도전할 수 있습니다 (already played today)' });
          }
          if (isUpsert && item.key !== undefined) {
            const found = db[table].find(r => r.key === item.key);
            if (found) { Object.assign(found, item); continue; }
          }
          db[table].push({ id: ++nextId, created_at: new Date().toISOString(), ...item });
        }
        console.log(`  POST ${table} → ${items.length}건 저장${isUpsert ? ' (upsert)' : ''}`);
        return send(201, []);
      });
      return;
    }
    if (req.method === 'PATCH' || req.method === 'DELETE') { return send(200, []); }
    return send(200, []);
  }

  // ── 정적 파일 ──
  let file = pathname === '/' ? '/index.html' : pathname;
  if (file === '/favicon.ico') file = '/icon-192.png'; // 브라우저 기본 요청 404 방지
  const full = path.join(ROOT, file);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(full).pipe(res);
});

server.listen(PORT, () => {
  console.log(`
  ┌──────────────────────────────────────────────────────────┐
   CONTEC+ 로컬 미리보기 (가짜 DB — 라이브 데이터 영향 없음)

   주소   http://localhost:${PORT}

   관리자  사번 9999 / 암호 contec@admin
   직원    사번 1001 / 암호 1001

   · 🛰️ 우주 용어 매치는 처음부터 공개 상태로 켜져 있습니다
   · 폰 화면으로 보려면 F12 → 기기 툴바(Ctrl+Shift+M) → iPhone 선택
   · 하루 1회 제한을 풀고 다시 하려면 → http://localhost:${PORT}/reset
   · 종료: Ctrl+C  (서버 끄면 기록 초기화)
  └──────────────────────────────────────────────────────────┘
`);
});
