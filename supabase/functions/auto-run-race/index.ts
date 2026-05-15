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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const respond = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", ...CORS },
    });

  // 레이스 설정 읽기 (last_auto_run_date 포함)
  const settings: { key: string; value: string }[] = await dbGet(
    "app_settings",
    "key=in.(race_auto_day,race_auto_hour,race_auto_minute,last_auto_run_date)"
  );
  const get = (key: string, def: string) =>
    settings.find((r) => r.key === key)?.value ?? def;

  const autoDay = parseInt(get("race_auto_day", "25"));
  const autoHour = parseInt(get("race_auto_hour", "10"));
  const autoMinute = parseInt(get("race_auto_minute", "0"));
  const lastAutoRunDate = get("last_auto_run_date", "");

  // 현재 KST 시간
  const nowKST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const year = nowKST.getFullYear();
  const month = nowKST.getMonth(); // 0-based

  // 실제 레이스 날짜 계산 (주말이면 이전 금요일)
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const effectiveDate = new Date(year, month, Math.min(autoDay, daysInMonth));
  const dow = effectiveDate.getDay();
  if (dow === 6) effectiveDate.setDate(effectiveDate.getDate() - 1);
  else if (dow === 0) effectiveDate.setDate(effectiveDate.getDate() - 2);

  const isToday =
    nowKST.getDate() === effectiveDate.getDate() &&
    nowKST.getMonth() === effectiveDate.getMonth() &&
    nowKST.getFullYear() === effectiveDate.getFullYear();

  const currentMins = nowKST.getHours() * 60 + nowKST.getMinutes();
  const autoMins = autoHour * 60 + autoMinute;

  if (!isToday || currentMins < autoMins) {
    return respond({ skipped: "not time yet", isToday, currentMins, autoMins });
  }

  const ym = `${year}-${String(month + 1).padStart(2, "0")}`;

  // 자동실행 날짜 키 (예: "2026-05-15")
  const todayKey = `${ym}-${String(nowKST.getDate()).padStart(2, "0")}`;

  // 오늘 자동실행 이미 했으면 스킵 (수동 레이스와 무관하게 별도 기록으로 판단)
  if (lastAutoRunDate === todayKey) {
    return respond({ skipped: "auto already ran today" });
  }

  // 참여자 목록
  const entries: { name: string }[] = await dbGet(
    "race_entries",
    `year_month=eq.${ym}&select=name`
  );
  if (entries.length === 0) {
    return respond({ skipped: "no entries" });
  }

  // 셔플 후 당첨자 선정 (최대 3명)
  const names = entries.map((e) => e.name);
  const shuffled = [...names].sort(() => Math.random() - 0.5);
  const seed = Date.now();
  const winnerCount = Math.min(3, shuffled.length);

  const rows = Array.from({ length: winnerCount }, (_, i) => ({
    year_month: ym,
    winner_name: shuffled[i],
    rank: i + 1,
    race_seed: seed,
    race_names: JSON.stringify(names),
  }));

  const ok = await dbPost("race_results", rows);
  if (!ok) {
    return respond({ error: "DB 저장 실패" }, 500);
  }

  // 자동실행 날짜 기록 (다음 크론에서 중복 방지)
  await dbUpsert("app_settings", { key: "last_auto_run_date", value: todayKey });

  // 푸시 알림 발송 (실패해도 무시)
  try {
    await fetch(SUPABASE_URL + "/functions/v1/send-race-push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + SUPABASE_SERVICE_KEY,
      },
      body: "{}",
    });
  } catch (_) { /* ignore */ }

  return respond({ ok: true, ym, winners: shuffled.slice(0, winnerCount), seed });
});
