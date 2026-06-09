const APPS_SCRIPT_URL = Deno.env.get("APPS_SCRIPT_URL") ?? "";
const APPS_SCRIPT_SECRET = Deno.env.get("APPS_SCRIPT_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CC = "charm@contec.kr";

const dbH = () => ({
  "Content-Type": "application/json",
  "apikey": SUPABASE_SERVICE_KEY,
  "Authorization": "Bearer " + SUPABASE_SERVICE_KEY,
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  const now = new Date().toISOString();

  // 발송 대기 중인 예약 메일 조회
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/scheduled_emails?status=eq.pending&scheduled_at=lte.${encodeURIComponent(now)}&order=scheduled_at.asc&limit=20`,
    { headers: dbH() }
  );
  const pending: {
    id: string;
    subject: string;
    html: string;
    recipients: string[];
  }[] = res.ok ? await res.json() : [];

  if (!pending.length) {
    return new Response(JSON.stringify({ ok: true, processed: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  let processed = 0;

  for (const email of pending) {
    const recipients: string[] = Array.isArray(email.recipients) ? email.recipients : [];
    if (!recipients.length) {
      await updateStatus(email.id, "sent", 0);
      continue;
    }

    try {
      const gasRes = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: APPS_SCRIPT_SECRET,
          recipients,
          subject: email.subject,
          html: email.html,
          cc: CC,
        }),
      });

      const status = gasRes.ok ? "sent" : "failed";
      await updateStatus(email.id, status, gasRes.ok ? recipients.length : 0);
      if (gasRes.ok) processed++;
    } catch (_) {
      await updateStatus(email.id, "failed", 0);
    }
  }

  return new Response(JSON.stringify({ ok: true, processed }), {
    headers: { "Content-Type": "application/json" },
  });
});

async function updateStatus(id: string, status: string, sentCount: number) {
  await fetch(`${SUPABASE_URL}/rest/v1/scheduled_emails?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...dbH(), "Prefer": "return=minimal" },
    body: JSON.stringify({ status, sent_count: sentCount }),
  });
}
