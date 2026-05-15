const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const dbH = () => ({
  "Content-Type": "application/json",
  "apikey": SUPABASE_SERVICE_KEY,
  "Authorization": "Bearer " + SUPABASE_SERVICE_KEY,
});

async function dbGet(table: string, q = "") {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + table + "?" + q, { headers: dbH() });
  return r.ok ? r.json() : [];
}

async function dbPost(table: string, data: unknown) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + table, {
    method: "POST",
    headers: { ...dbH(), "Prefer": "return=minimal" },
    body: JSON.stringify(data),
  });
  return r.ok;
}

async function dbUpsert(table: string, data: unknown) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + table, {
    method: "POST",
    headers: { ...dbH(), "Prefer": "return=minimal,resolution=merge-duplicates" },
    body: JSON.stringify(data),
  });
  return r.ok;
}

// ─── 클라이언트와 동일한 RNG ───────────────────────────────────────────────
function makeRaceRNG(s: number) {
  let _s = Math.abs(Math.floor(s) % 233280) || 1234;
  return () => { _s = (_s * 9301 + 49297) % 233280; return _s / 233280; };
}

// ─── 클라이언트 buildRaceState + 모든 이벤트를 서버에서 완전 재현 ──────────
function simulateRaceWinners(names: string[], seed: number): string[] {
  const sr = makeRaceRNG(seed);
  const n = names.length;

  const raceW = 360, raceH = 360;
  const raceCX = 180, raceCY = 180;
  const EARTH_R = 42;
  const minR = EARTH_R + 22;
  const maxR = Math.min(raceW, raceH) * 0.40;
  const refR = (minR + maxR) / 2;

  interface Sat {
    name: string;
    orbitR: number;
    speed: number;
    angle: number;
    departDelay: number;
    alive: boolean;
    x: number;
    y: number;
  }

  const sats: Sat[] = names.map((name, i) => {
    const orbitFrac = (i / (n - 1 || 1)) * (0.6 + sr() * 0.4);
    const spd = (0.024 + sr() * 0.005) * (sr() > 0.22 ? 1 : -1);
    const angle = (Math.PI * 2 / n) * i + sr() * 0.5;
    const departDelay = 38 + i * 3 + sr() * 20;
    const orbitR = minR + (maxR - minR) * orbitFrac;
    const dir = spd >= 0 ? 1 : -1;
    const speed = dir * Math.abs(spd) * Math.sqrt(refR / orbitR);
    return { name, orbitR, speed, angle, departDelay, alive: true, x: 0, y: 0 };
  });

  const meteorAngle  = sr() * Math.PI * 2;
  const collide1     = sr();
  const collide2     = sr();
  const swCnt        = sr();
  const bhOffX       = (sr() - 0.5) * 0.7;
  const bhOffY       = (sr() - 0.5) * 0.7;
  const debris1Frac   = sr();
  const meteor2Angle  = sr() * Math.PI * 2;
  const debris2Frac   = sr();
  const coll2Frac1    = sr();
  const coll2Frac2    = sr();
  const debris3Frac   = sr();
  const sw2Cnt        = sr();
  const debris4Frac   = sr();
  const meteor3Angle  = sr() * Math.PI * 2;
  const coll3Frac1    = sr();
  const coll3Frac2    = sr();
  const debris5Frac   = sr();

  const updatePos = (sat: Sat, frame: number) => {
    const a = sat.angle + sat.speed * frame;
    sat.x = raceCX + Math.cos(a) * sat.orbitR;
    sat.y = raceCY + Math.sin(a) * sat.orbitR;
  };

  const alive    = () => sats.filter(s => s.alive);
  const aliveAt  = (frame: number) =>
    sats.filter(s => s.alive && Math.ceil(s.departDelay * 60) > frame);

  // ── 1차 운석 (t=8, frame=480) ─────────────────────────────────────────
  {
    const mSX = raceCX + Math.cos(meteorAngle) * raceW * 0.8;
    const mSY = raceCY + Math.sin(meteorAngle) * raceH * 0.8;
    const mvx = -Math.cos(meteorAngle) * 12;
    const mvy = -Math.sin(meteorAngle) * 12;
    const mR  = 16;
    let hit = false;
    for (let d = 0; d < 60 && !hit; d++) {
      const mx = mSX + mvx * d, my = mSY + mvy * d;
      if (mx < -100 || mx > raceW + 100 || my < -100 || my > raceH + 100) break;
      if (Math.sqrt((mx - raceCX) ** 2 + (my - raceCY) ** 2) < EARTH_R + mR) break;
      for (const sat of alive()) {
        updatePos(sat, 480 + d);
        const dx = sat.x - mx, dy = sat.y - my;
        if (Math.sqrt(dx * dx + dy * dy) < mR + 8) { sat.alive = false; hit = true; break; }
      }
    }
  }

  // ── 우주쓰레기 1 (t=14, n≥8) ──────────────────────────────────────────
  if (n >= 8) {
    const cur = alive();
    if (cur.length > 0) {
      cur[Math.floor(debris1Frac * cur.length) % cur.length].alive = false;
    }
  }

  // ── 충돌 이벤트 1 (t=22) ──────────────────────────────────────────────
  {
    const cur = alive();
    if (cur.length >= 2) {
      const aIdx = Math.floor(collide1 * cur.length);
      const a    = cur[aIdx];
      const rest = cur.filter(s => s !== a);
      const bIdx = Math.floor(collide2 * rest.length);
      const b    = rest[bIdx];
      if (a) a.alive = false;
      if (b) b.alive = false;
    }
  }

  // ── 2차 운석 (t=31, n≥12, frame=1860) ─────────────────────────────────
  if (n >= 12) {
    const mSX = raceCX + Math.cos(meteor2Angle) * raceW * 0.85;
    const mSY = raceCY + Math.sin(meteor2Angle) * raceH * 0.85;
    const mvx = -Math.cos(meteor2Angle) * 19;
    const mvy = -Math.sin(meteor2Angle) * 19;
    const mR  = 24;
    let hit = false;
    for (let d = 0; d < 60 && !hit; d++) {
      const mx = mSX + mvx * d, my = mSY + mvy * d;
      if (mx < -100 || mx > raceW + 100 || my < -100 || my > raceH + 100) break;
      if (Math.sqrt((mx - raceCX) ** 2 + (my - raceCY) ** 2) < EARTH_R + mR) break;
      for (const sat of alive()) {
        updatePos(sat, 1860 + d);
        const dx = sat.x - mx, dy = sat.y - my;
        if (Math.sqrt(dx * dx + dy * dy) < mR + 8) { sat.alive = false; hit = true; break; }
      }
    }
  }

  // ── 태양풍 1 (t=34) ───────────────────────────────────────────────────
  {
    const cur  = alive();
    const cnt  = Math.min(cur.length - 1, 2 + Math.floor(swCnt * 2));
    const pool = [...cur];
    for (let i = 0; i < cnt; i++) {
      if (pool.length === 0) break;
      const idx = Math.floor((i === 0 ? swCnt : 1 - swCnt) * pool.length) % pool.length;
      if (pool[idx]) { pool[idx].alive = false; pool.splice(idx, 1); }
    }
  }

  // ── 우주쓰레기 2 (t=40, n≥15, frame=2400) ─────────────────────────────
  if (n >= 15) {
    const cur = aliveAt(2400);
    if (cur.length > 0) {
      cur[Math.floor(debris2Frac * cur.length) % cur.length].alive = false;
    }
  }

  // ── 충돌 이벤트 2 (t=44, n≥18, frame=2640) ───────────────────────────
  if (n >= 18) {
    const cur = aliveAt(2640);
    if (cur.length >= 2) {
      const aIdx = Math.floor(coll2Frac1 * cur.length);
      const a    = cur[aIdx];
      const rest = cur.filter(s => s !== a);
      const bIdx = Math.floor(coll2Frac2 * rest.length);
      const b    = rest[bIdx];
      if (a) a.alive = false;
      if (b) b.alive = false;
    }
  }

  // ── 블랙홀 (t=50, suck frame 3027–3207) ───────────────────────────────
  {
    const bhX    = raceCX + bhOffX * raceW * 0.5;
    const bhY    = raceCY + bhOffY * raceH * 0.5;
    const bhR    = 32 + 10;
    const suckStart = 3027, suckEnd = 3207;
    for (let d = suckStart; d < suckEnd; d += 10) {
      for (const sat of aliveAt(d)) {
        updatePos(sat, d);
        const dx = bhX - sat.x, dy = bhY - sat.y;
        if (Math.sqrt(dx * dx + dy * dy) < bhR) sat.alive = false;
      }
    }
  }

  // ── 우주쓰레기 3 (t=56, n≥22, frame=3360) ─────────────────────────────
  if (n >= 22) {
    const cur = aliveAt(3360);
    if (cur.length > 0) {
      cur[Math.floor(debris3Frac * cur.length) % cur.length].alive = false;
    }
  }

  // ── 태양풍 2 (t=62, n≥28, frame=3720) ────────────────────────────────
  if (n >= 28) {
    const cur  = aliveAt(3720);
    const cnt  = Math.min(cur.length - 1, 2 + Math.floor(sw2Cnt * 2));
    const pool = [...cur];
    for (let i = 0; i < cnt; i++) {
      if (pool.length === 0) break;
      const idx = Math.floor((i === 0 ? sw2Cnt : 1 - sw2Cnt) * pool.length) % pool.length;
      if (pool[idx]) { pool[idx].alive = false; pool.splice(idx, 1); }
    }
  }

  // ── 우주쓰레기 4 (t=68, n≥35, frame=4080) ─────────────────────────────
  if (n >= 35) {
    const cur = aliveAt(4080);
    if (cur.length > 0) {
      cur[Math.floor(debris4Frac * cur.length) % cur.length].alive = false;
    }
  }

  // ── 3차 운석 (t=74, n≥35, frame=4440) ────────────────────────────────
  if (n >= 35) {
    const mSX = raceCX + Math.cos(meteor3Angle) * raceW * 0.85;
    const mSY = raceCY + Math.sin(meteor3Angle) * raceH * 0.85;
    const mvx = -Math.cos(meteor3Angle) * 19;
    const mvy = -Math.sin(meteor3Angle) * 19;
    const mR  = 24;
    let hit = false;
    for (let d = 0; d < 60 && !hit; d++) {
      const mx = mSX + mvx * d, my = mSY + mvy * d;
      if (mx < -100 || mx > raceW + 100 || my < -100 || my > raceH + 100) break;
      if (Math.sqrt((mx - raceCX) ** 2 + (my - raceCY) ** 2) < EARTH_R + mR) break;
      for (const sat of aliveAt(4440 + d)) {
        updatePos(sat, 4440 + d);
        const dx = sat.x - mx, dy = sat.y - my;
        if (Math.sqrt(dx * dx + dy * dy) < mR + 8) { sat.alive = false; hit = true; break; }
      }
    }
  }

  // ── 충돌 이벤트 3 (t=78, n≥45, frame=4680) ───────────────────────────
  if (n >= 45) {
    const cur = aliveAt(4680);
    if (cur.length >= 2) {
      const aIdx = Math.floor(coll3Frac1 * cur.length);
      const a    = cur[aIdx];
      const rest = cur.filter(s => s !== a);
      const bIdx = Math.floor(coll3Frac2 * rest.length);
      const b    = rest[bIdx];
      if (a) a.alive = false;
      if (b) b.alive = false;
    }
  }

  // ── 우주쓰레기 5 (t=84, n≥45, frame=5040) ─────────────────────────────
  if (n >= 45) {
    const cur = aliveAt(5040);
    if (cur.length > 0) {
      cur[Math.floor(debris5Frac * cur.length) % cur.length].alive = false;
    }
  }

  // ── 자연 퇴장 순서로 최종 생존자 정렬 ────────────────────────────────
  const survivors = sats
    .filter(s => s.alive)
    .sort((a, b) => b.departDelay - a.departDelay);
  const winnerCount = Math.min(3, n);
  return survivors.slice(0, winnerCount).map(s => s.name);
}

// ─── 메인 핸들러 ──────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const respond = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", ...CORS },
    });

  // 레이스 설정 읽기
  const settings: { key: string; value: string }[] = await dbGet(
    "app_settings",
    "key=in.(race_auto_day,race_auto_hour,race_auto_minute,last_auto_run_date)"
  );
  const get = (key: string, def: string) =>
    settings.find((r) => r.key === key)?.value ?? def;

  const autoDay    = parseInt(get("race_auto_day", "25"));
  const autoHour   = parseInt(get("race_auto_hour", "10"));
  const autoMinute = parseInt(get("race_auto_minute", "0"));
  const lastAutoRunDate = get("last_auto_run_date", "");

  // 현재 KST 시간
  const nowKST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const year  = nowKST.getFullYear();
  const month = nowKST.getMonth();

  // 실제 레이스 날짜 계산 (주말이면 이전 금요일)
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const effectiveDate = new Date(year, month, Math.min(autoDay, daysInMonth));
  const dow = effectiveDate.getDay();
  if (dow === 6) effectiveDate.setDate(effectiveDate.getDate() - 1);
  else if (dow === 0) effectiveDate.setDate(effectiveDate.getDate() - 2);

  const isToday =
    nowKST.getDate()     === effectiveDate.getDate() &&
    nowKST.getMonth()    === effectiveDate.getMonth() &&
    nowKST.getFullYear() === effectiveDate.getFullYear();

  const currentMins = nowKST.getHours() * 60 + nowKST.getMinutes();
  const autoMins    = autoHour * 60 + autoMinute;

  if (!isToday || currentMins < autoMins) {
    return respond({ skipped: "not time yet", isToday, currentMins, autoMins });
  }

  const ym = `${year}-${String(month + 1).padStart(2, "0")}`;
  const todayKey = `${ym}-${String(nowKST.getDate()).padStart(2, "0")}`;

  if (lastAutoRunDate === todayKey) {
    return respond({ skipped: "auto already ran today", lastAutoRunDate, todayKey });
  }

  const entries: { name: string }[] = await dbGet(
    "race_entries",
    `year_month=eq.${ym}&select=name&order=created_at.asc`
  );
  if (entries.length === 0) {
    return respond({ skipped: "no entries" });
  }

  const names = entries.map((e) => e.name);
  const seed  = Date.now();

  // 서버 시뮬레이션으로 당첨자 결정 → DB 저장
  const winners = simulateRaceWinners(names, seed);

  const rows = winners.map((name, i) => ({
    year_month:   ym,
    winner_name:  name,
    rank:         i + 1,
    race_seed:    seed,
    race_names:   JSON.stringify(names),
    is_auto:      true,
  }));

  const ok = await dbPost("race_results", rows);
  if (!ok) {
    return respond({ error: "DB 저장 실패" }, 500);
  }

  // 자동실행 날짜 기록
  await dbUpsert("app_settings", { key: "last_auto_run_date", value: todayKey });

  // 푸시 알림: 결과 발표
  try {
    await fetch(SUPABASE_URL + "/functions/v1/send-race-push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + SUPABASE_SERVICE_KEY,
      },
      body: JSON.stringify({ body: "🏆 이달의 궤도 레이스 결과가 발표됐습니다!" }),
    });
  } catch (_) { /* ignore */ }

  return respond({ ok: true, ym, winners, seed });
});
