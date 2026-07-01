const APPS_SCRIPT_URL = Deno.env.get("APPS_SCRIPT_URL") ?? "";
const APPS_SCRIPT_SECRET = Deno.env.get("APPS_SCRIPT_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const APP_URL = "https://contec-plus.contec.dev/";
const CC = "charm@contec.kr";
const TEST_MODE = true; // 테스트 완료 후 false 로 변경

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

function getYM() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function getEmailsByNames(names: string[]): Promise<string[]> {
  if (!names.length) return [];
  const nameFilter = names.map(n => encodeURIComponent(n)).join(",");
  const emps: { name: string; email: string }[] = await dbGet(
    "employees",
    `is_active=eq.true&email=not.is.null&name=in.(${nameFilter})&select=name,email`
  );
  return emps.map(e => e.email).filter(e => e && e.includes("@"));
}

async function getQuizSurvivorEmails(ym: string): Promise<string[]> {
  const attempts: { name: string; is_correct: boolean }[] = await dbGet(
    "quiz_attempts",
    `year_month=eq.${ym}&select=name,is_correct`
  );
  const eliminated = new Set(attempts.filter(a => !a.is_correct).map(a => a.name));
  const seen = new Set<string>();
  const survivors: string[] = [];
  for (const a of attempts) {
    if (a.is_correct && !eliminated.has(a.name) && !seen.has(a.name)) {
      seen.add(a.name);
      survivors.push(a.name);
    }
  }
  return getEmailsByNames(survivors);
}

async function getRaceParticipantEmails(ym: string): Promise<string[]> {
  const entries: { name: string }[] = await dbGet(
    "race_entries",
    `year_month=eq.${ym}&select=name`
  );
  return getEmailsByNames(entries.map(e => e.name));
}

async function getRaceWinnerEmails(ym: string): Promise<string[]> {
  const results: { winner_name: string }[] = await dbGet(
    "race_results",
    `year_month=eq.${ym}&select=winner_name&order=rank.asc`
  );
  return getEmailsByNames(results.map(r => r.winner_name));
}

const linkBtn = (label: string) =>
  `<div style="margin-top:20px;text-align:center;">
    <a href="${APP_URL}" target="_blank"
       style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#0D1B3E,#1a3a6e);color:#7eb8ff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:0.3px;">
      ${label}
    </a>
  </div>`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const respond = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", ...CORS },
    });

  if (!APPS_SCRIPT_URL) return respond({ error: "APPS_SCRIPT_URL 없음" }, 500);

  const body = await req.json().catch(() => ({}));
  const { type } = body;
  const ym: string = body.ym ?? getYM();

  let subject = "";
  let html = "";
  const isPreview: boolean = body.preview === true;
  const testTo: string = body.test_to ?? "";
  // 프론트엔드에서 직접 수신자 지정 시 사용
  const customRecipients: string[] | null = Array.isArray(body.custom_recipients) ? body.custom_recipients : null;
  let recipients: string[] = (TEST_MODE || testTo) ? [CC] : (customRecipients ?? []);

  if (type === "quiz") {
    const { question } = body;
    if (!TEST_MODE && !testTo && !customRecipients) recipients = await getQuizSurvivorEmails(ym);
    subject = "[CONTEC+] 이번 주 퀴즈가 출제됐습니다!";
    html = `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#f8f9fa;padding:24px;border-radius:12px;">
        <div style="background:linear-gradient(135deg,#0D1B3E,#1a3060);border-radius:10px;padding:20px 24px;margin-bottom:20px;">
          <h2 style="color:#fff;margin:0;font-size:18px;">&#128225; 이번 주 우주 퀴즈 출제!</h2>
          <p style="color:rgba(255,255,255,0.6);margin:6px 0 0;font-size:13px;">생존자만을 위한 CONTEC+ 퀴즈 릴레이</p>
        </div>
        <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;margin-bottom:16px;">
          <tr>
            <td style="padding:14px 16px;font-weight:bold;color:#555;width:80px;background:#f5f5f5;vertical-align:top;">문제</td>
            <td style="padding:14px 16px;line-height:1.8;font-size:15px;color:#222;">${(question || "새 문제가 등록됐습니다").replace(/\n/g, "<br>")}</td>
          </tr>
        </table>
        ${linkBtn("&#128640; CONTEC+ 앱 바로가기")}
        <p style="color:#aaa;font-size:11px;margin-top:16px;text-align:center;">이 메일은 퀴즈 생존자에게만 발송됩니다.</p>
      </div>`;

  } else if (type === "race") {
    if (!TEST_MODE && !testTo && !customRecipients) recipients = await getRaceParticipantEmails(ym);
    subject = "[CONTEC+] 이달의 궤도 레이스 결과가 발표됐습니다!";
    html = `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#f8f9fa;padding:24px;border-radius:12px;">
        <div style="background:linear-gradient(135deg,#000c20,#001a40);border-radius:10px;padding:20px 24px;margin-bottom:20px;">
          <h2 style="color:#fff;margin:0;font-size:18px;">&#127942; 이달의 궤도 레이스</h2>
          <p style="color:rgba(100,200,255,0.7);margin:6px 0 0;font-size:13px;">${ym} 레이스</p>
        </div>
        <div style="background:#fff;border-radius:10px;padding:20px 16px;margin-bottom:4px;text-align:center;">
          <p style="font-size:16px;font-weight:700;color:#0D1B3E;margin:0 0 8px;">자동으로 진행되어 결과가 발표되었습니다!</p>
          <p style="font-size:14px;color:#555;margin:0;line-height:1.7;">이번 달 궤도 레이스의 최종 순위를<br>CONTEC+ 앱에서 직접 확인해보세요.</p>
        </div>
        ${linkBtn("&#128760; CONTEC+ 앱에서 결과 확인하기")}
        <p style="color:#aaa;font-size:11px;margin-top:16px;text-align:center;">이 메일은 레이스 참여자에게만 발송됩니다.</p>
      </div>`;

  } else if (type === "race_winners") {
    if (!TEST_MODE && !testTo && !customRecipients) recipients = await getRaceWinnerEmails(ym);
    subject = "[CONTEC+] 축하합니다! 궤도 레이스 당첨 안내";
    html = `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#f8f9fa;padding:24px;border-radius:12px;">
        <div style="background:linear-gradient(135deg,#7c3aed,#1a3060);border-radius:10px;padding:20px 24px;margin-bottom:20px;">
          <h2 style="color:#fff;margin:0;font-size:18px;">&#127881; 궤도 레이스 당첨을 축하드립니다!</h2>
          <p style="color:rgba(255,255,255,0.6);margin:6px 0 0;font-size:13px;">${ym} 레이스 수상자</p>
        </div>
        <div style="background:#fff;border-radius:10px;padding:16px;margin-bottom:4px;text-align:center;">
          <p style="font-size:15px;color:#222;line-height:1.8;margin:0;">이번 달 궤도 레이스에서 수상하셨습니다!<br>경품 수령 관련 안내는 별도로 전달될 예정입니다.</p>
        </div>
        ${linkBtn("&#128640; CONTEC+ 앱에서 결과 확인하기")}
        <p style="color:#aaa;font-size:11px;margin-top:16px;text-align:center;">이 메일은 레이스 당첨자에게만 발송됩니다.</p>
      </div>`;

  } else {
    return respond({ error: "알 수 없는 type (quiz / race / race_winners)" }, 400);
  }

  // 프론트엔드에서 제목/내용 직접 지정 시 오버라이드
  if (body.custom_subject) subject = body.custom_subject;
  if (body.custom_html) html = body.custom_html;

  // preview=true 면 HTML만 반환 (발송 안 함)
  if (isPreview) {
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", ...CORS },
    });
  }

  if (!recipients.length) {
    return respond({ ok: true, sent: 0, reason: "no recipients" });
  }

  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: APPS_SCRIPT_SECRET, recipients, subject, html, cc: CC }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    return respond({ error: err }, 500);
  }

  return respond({ ok: true, sent: recipients.length });
});
