const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RECIPIENT_EMAIL = Deno.env.get("QA_RECIPIENT_EMAIL") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (!RESEND_API_KEY || !RECIPIENT_EMAIL) {
    return new Response(JSON.stringify({ error: "이메일 설정이 없습니다" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  const { question, category, submitter } = await req.json();

  const categoryIcon: Record<string, string> = { 시스템: "💻", 복지: "🎁", 기타: "📋" };
  const icon = categoryIcon[category] ?? "❓";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "CONTEC+ <onboarding@resend.dev>",
      to: [RECIPIENT_EMAIL],
      subject: `[CONTEC+ Q&A] ${icon} ${category} 카테고리 새 질문`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
          <h2 style="color:#0D1B3E;">📩 새 Q&A 질문이 등록됐습니다</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px;font-weight:bold;color:#555;width:80px;">카테고리</td>
                <td style="padding:8px;">${icon} ${category}</td></tr>
            <tr style="background:#f5f5f5;"><td style="padding:8px;font-weight:bold;color:#555;">질문자</td>
                <td style="padding:8px;">${submitter}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;color:#555;vertical-align:top;">질문 내용</td>
                <td style="padding:8px;line-height:1.6;">${question.replace(/\n/g, "<br>")}</td></tr>
          </table>
          <p style="color:#888;font-size:12px;margin-top:24px;">CONTEC+ 관리자 페이지에서 답변을 등록해주세요.</p>
        </div>`,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    return new Response(JSON.stringify({ error: err }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
});
