// -----------------------------------------------
// CONTEC+ 이메일 알림 웹훅
// script.google.com 에서 이 코드를 붙여넣고
// "웹 앱으로 배포" 후 URL을 Supabase 환경변수에 등록
// -----------------------------------------------

// 아래 SECRET 값을 임의의 문자열로 설정하고
// Supabase 환경변수 APPS_SCRIPT_SECRET 에도 동일하게 입력
var SECRET = "contec@amdin";

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // 비밀키 검증
    if (data.secret !== SECRET) {
      return json({ error: "unauthorized" }, 401);
    }

    var recipients = data.recipients || [];
    var subject    = data.subject    || "(제목 없음)";
    var html       = data.html       || "";
    var cc         = data.cc         || "";

    if (!recipients.length) {
      return json({ ok: true, sent: 0, reason: "no recipients" });
    }

    // 각 직원에게 개별 발송 (참조: charm@contec.kr)
    var opts = { htmlBody: html };
    if (cc) opts.cc = cc;
    recipients.forEach(function(email) {
      GmailApp.sendEmail(email, subject, "", opts);
    });

    return json({ ok: true, sent: recipients.length });

  } catch (err) {
    return json({ error: err.toString() }, 500);
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
