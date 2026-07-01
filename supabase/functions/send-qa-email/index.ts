const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RECIPIENT_EMAIL = Deno.env.get("QA_RECIPIENT_EMAIL") ?? "";

const wrapHtml = (content: string) =>
  `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f0f2f5;">
${content}
</body>
</html>`;

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

  const body = await req.json();
  const { type, submitter } = body;

  let subject = "";
  let html = "";

  if (type === "qa") {
    const { question, category } = body;
    const categoryIcon: Record<string, string> = { 시스템: "💻", 복지: "🎁", 기타: "📋" };
    const icon = categoryIcon[category] ?? "❓";
    subject = `[CONTEC+ Q&A] ${icon} ${category} 카테고리 새 질문`;
    html = `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#f8f9fa;padding:24px;border-radius:12px;">
        <div style="background:#0D1B3E;border-radius:10px;padding:20px 24px;margin-bottom:20px;">
          <h2 style="color:#fff;margin:0;font-size:18px;">📩 새 Q&A 질문이 등록됐습니다</h2>
        </div>
        <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;">
          <tr><td style="padding:12px 16px;font-weight:bold;color:#555;width:90px;background:#f5f5f5;">카테고리</td>
              <td style="padding:12px 16px;">${icon} ${category}</td></tr>
          <tr><td style="padding:12px 16px;font-weight:bold;color:#555;background:#f5f5f5;">질문자</td>
              <td style="padding:12px 16px;">${submitter}</td></tr>
          <tr><td style="padding:12px 16px;font-weight:bold;color:#555;vertical-align:top;background:#f5f5f5;">질문 내용</td>
              <td style="padding:12px 16px;line-height:1.7;">${question.replace(/\n/g, "<br>")}</td></tr>
        </table>
        <p style="color:#888;font-size:12px;margin-top:16px;text-align:center;">CONTEC+ 관리자 페이지에서 답변을 등록해주세요.</p>
      </div>`;
  } else if (type === "funny") {
    const { title } = body;
    subject = `[CONTEC+ 웃수저] 😂 새 제출물 승인 요청`;
    html = `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#f8f9fa;padding:24px;border-radius:12px;">
        <div style="background:#c0392b;border-radius:10px;padding:20px 24px;margin-bottom:20px;">
          <h2 style="color:#fff;margin:0;font-size:18px;">😂 웃수저 제출물 승인 요청</h2>
        </div>
        <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;">
          <tr><td style="padding:12px 16px;font-weight:bold;color:#555;width:90px;background:#f5f5f5;">제출자</td>
              <td style="padding:12px 16px;">${submitter}</td></tr>
          <tr><td style="padding:12px 16px;font-weight:bold;color:#555;background:#f5f5f5;">제목</td>
              <td style="padding:12px 16px;">${title}</td></tr>
        </table>
        <p style="color:#888;font-size:12px;margin-top:16px;text-align:center;">CONTEC+ 관리자 페이지에서 승인/거절 처리해주세요.</p>
      </div>`;
  } else if (type === "idea") {
    const { title, content } = body;
    subject = `[CONTEC+ 아이디어] 💡 새 아이디어 제출`;
    html = `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#f8f9fa;padding:24px;border-radius:12px;">
        <div style="background:#27ae60;border-radius:10px;padding:20px 24px;margin-bottom:20px;">
          <h2 style="color:#fff;margin:0;font-size:18px;">💡 새 아이디어가 제출됐습니다</h2>
        </div>
        <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;">
          <tr><td style="padding:12px 16px;font-weight:bold;color:#555;width:90px;background:#f5f5f5;">제출자</td>
              <td style="padding:12px 16px;">${submitter}</td></tr>
          <tr><td style="padding:12px 16px;font-weight:bold;color:#555;background:#f5f5f5;">제목</td>
              <td style="padding:12px 16px;">${title}</td></tr>
          <tr><td style="padding:12px 16px;font-weight:bold;color:#555;vertical-align:top;background:#f5f5f5;">내용</td>
              <td style="padding:12px 16px;line-height:1.7;">${(content||'').replace(/\n/g, "<br>")}</td></tr>
        </table>
        <p style="color:#888;font-size:12px;margin-top:16px;text-align:center;">CONTEC+ 관리자 페이지에서 투표 공개 처리해주세요.</p>
      </div>`;
  } else {
    return new Response(JSON.stringify({ error: "알 수 없는 type" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  html = wrapHtml(html);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "CONTEC+ <onboarding@resend.dev>",
      to: [RECIPIENT_EMAIL],
      subject,
      html,
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
