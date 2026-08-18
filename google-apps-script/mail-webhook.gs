/**
 * CONTEC+ 이메일 발송 중계 (Apps Script Web App)
 *
 * ── 왜 GmailApp 이 아니라 MailApp 인가 (이 파일의 존재 이유) ────────────────
 *   이전 버전은 GmailApp.sendEmail() 을 썼다. GmailApp 은 **Gmail 사서함이 있는
 *   계정**에서만 동작한다. 발신 계정을 charm@contec.kr 로 바꾸면서 문제가 됐다 —
 *   회사 주소로 만든 Google 계정은 Gmail 사서함이 없기 때문이다.
 *
 *   MailApp 은 SMTP 도 Gmail 서비스도 경유하지 않고 Google 내부 메일 서비스를
 *   직접 호출한다. 사서함이 없는 계정에서도 나가고, 독립된 일일 쿼터를 가진다.
 *   ⚠️ GmailApp 으로 되돌리지 말 것. 사서함 없는 계정에서 조용히 실패한다.
 *
 * ── 발신자는 이 스크립트를 소유한 Google 계정이 된다 ──────────────────────
 *   charm@contec.kr 로 보내려면 그 주소로 Google 계정이 가입돼 있고,
 *   그 계정으로 이 스크립트를 만들어 배포해야 한다.
 *   fromName 으로 표시 이름만 바꿀 수 있고, 발신 주소 자체는 바꿀 수 없다.
 *
 * ── ⚠️ 자기 주소로 보낸 메일은 도착하지 않는다 ────────────────────────────
 *   contec.kr 게이트웨이는 외부 메일서버(Google)를 경유해 들어온 자기 도메인
 *   발신 메일을 차단한다.
 *     charm@contec.kr → charm@contec.kr    ❌ 차단 (발송은 성공, 수신 안 됨)
 *     charm@contec.kr → 직원@contec.kr     ✅ 정상
 *     charm@contec.kr → someone@gmail.com  ✅ 정상
 *   그래서 수신자에 발신 주소가 섞여 있으면 조용히 사라진다. 아래 코드는 이걸
 *   blocked_self 로 따로 보고한다 — "보냈는데 왜 안 와?" 를 없애기 위함이다.
 *   테스트 수신자는 반드시 발신 계정과 다른 주소로 잡을 것.
 *
 * ── 배포 절차 ────────────────────────────────────────────────────────────
 * 1) charm@contec.kr 로 로그인한 상태에서 script.google.com → 새 프로젝트
 * 2) 이 파일 내용을 전부 붙여넣기
 * 3) (권장) 좌측 ⚙ 프로젝트 설정 → 스크립트 속성에 SHARED_TOKEN 추가
 * 4) 배포 → 새 배포 → 유형 "웹 앱"
 *      - 실행 계정   : 나              ← 이 계정이 발신자가 된다
 *      - 액세스 권한 : 모든 사용자      ← 브라우저가 인증 없이 POST 하므로 필수
 * 5) 권한 승인 팝업에서 메일 발송 허용
 * 6) 발급된 /exec URL 을 index.html 의 MAIL_RELAY_URL 에 넣는다
 * 7) 확인: 브라우저로 그 URL 을 열어 {"ok":true,...} 가 보이면 정상.
 *          로그인 화면이 뜨면 액세스 권한이 "모든 사용자"가 아니다.
 *
 * ⚠️ 코드를 고치면 반드시 "새 배포"(또는 기존 배포의 버전 갱신)를 해야 반영된다.
 *    저장만 하면 /exec 는 예전 버전을 계속 서비스한다.
 *
 * ── 보안 모델 (솔직한 한계) ───────────────────────────────────────────────
 *   호출자가 공개 정적 페이지(index.html)이므로 **토큰은 비밀이 될 수 없다.**
 *   브라우저 소스만 보면 누구나 읽는다. 따라서 실질 방어선은 토큰이 아니라
 *   ALLOWED_DOMAINS(수신 도메인 제한) 와 MAX_RECIPIENTS(1회 상한) 다.
 *   토큰은 URL 만 아는 봇의 무작위 호출을 걸러내는 정도로만 취급할 것.
 *
 * ── 요청 형식 (두 가지 모두 받는다) ───────────────────────────────────────
 *   CONTEC+ 프론트:  {custom_subject, custom_html, custom_recipients:[...], type}
 *   일반:            {to, subject, text, html, cc, bcc, fromName, replyTo}
 *   공통 선택:       {token}
 *
 *   응답: {"ok":true,"sent":3,"blocked_self":["charm@contec.kr"],"failed":[],
 *          "remaining_quota":1497}
 *         {"ok":false,"error":"사람이 읽을 수 있는 사유"}
 *   ⚠️ 실패도 HTTP 200 + ok:false 로 온다 (Apps Script 가 상태코드를 못 정한다).
 *      호출자는 상태코드가 아니라 ok 필드를 봐야 한다.
 */

/** 스크립트 속성 SHARED_TOKEN 이 없을 때 쓰는 값. 비워두면 토큰 검사를 하지 않는다. */
var FALLBACK_TOKEN = '';

/** 수신 허용 도메인. 빈 배열이면 제한 없음. 직원 메일이 전부 contec.kr 이면 ['contec.kr'] 로 좁힐 것. */
var ALLOWED_DOMAINS = [];

/** 1회 요청당 최대 수신자 수 — URL 이 노출돼도 대량 발송 피해를 제한한다. */
var MAX_RECIPIENTS = 200;

/** 메일에 표시될 발신자 이름 (주소는 스크립트 소유 계정으로 고정) */
var DEFAULT_FROM_NAME = 'CONTEC+';


function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ ok: false, error: '요청 본문이 없습니다' });
    }

    var req;
    try {
      req = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return json_({ ok: false, error: '요청 본문이 JSON 이 아닙니다' });
    }
    // 'null' / '[1,2]' 같은 유효 JSON 도 객체가 아니면 아래 속성 접근에서
    // 엔진 내부 메시지가 그대로 새어나간다.
    if (!req || typeof req !== 'object' || req instanceof Array) {
      return json_({ ok: false, error: '요청 본문이 JSON 객체가 아닙니다' });
    }

    // 토큰은 설정돼 있을 때만 검사한다 (미설정 시 무토큰 호출 허용 — 위 보안 모델 참고)
    var expected = resolveToken_();
    if (expected) {
      if (!safeEquals_(String(req.token == null ? '' : req.token), expected)) {
        return json_({ ok: false, error: '공유 토큰이 일치하지 않습니다' });
      }
    }

    // CONTEC+ 프론트 형식과 일반 형식을 모두 받는다.
    var subject = String(req.custom_subject || req.subject || '').trim();
    var html    = String(req.custom_html || req.html || '');
    var rawTo   = (req.custom_recipients != null) ? req.custom_recipients : req.to;

    if (!subject) return json_({ ok: false, error: '제목이 비어있습니다' });

    // 배열(custom_recipients)과 콤마 문자열(to)을 같은 경로로 정규화한다.
    // ⚠️ 검사한 값과 MailApp 에 넘기는 값이 달라지면 검사가 무의미해지므로
    //    정규화 결과만 사용하고, 주소로 볼 수 없는 항목은 거부한다.
    var norm = normalizeList_(rawTo);
    if (norm.error) return json_({ ok: false, error: norm.error });
    if (!norm.list.length) return json_({ ok: false, error: '수신 주소가 비어있습니다' });
    if (norm.list.length > MAX_RECIPIENTS) {
      return json_({
        ok: false,
        error: '수신자가 너무 많습니다 (' + norm.list.length + ' > 최대 ' + MAX_RECIPIENTS + ')',
      });
    }

    var ccNorm = normalizeList_(req.cc);
    if (ccNorm.error) return json_({ ok: false, error: 'cc: ' + ccNorm.error });
    var bccNorm = normalizeList_(req.bcc);
    if (bccNorm.error) return json_({ ok: false, error: 'bcc: ' + bccNorm.error });

    // 발신 주소와 같은 수신자는 수신측에서 차단되므로 미리 걸러 따로 보고한다.
    var sender = senderAddress_();
    var targets = [], blockedSelf = [];
    for (var i = 0; i < norm.list.length; i++) {
      if (sender && norm.list[i].toLowerCase() === sender.toLowerCase()) blockedSelf.push(norm.list[i]);
      else targets.push(norm.list[i]);
    }
    var ccList = [];
    for (var c = 0; c < ccNorm.list.length; c++) {
      if (sender && ccNorm.list[c].toLowerCase() === sender.toLowerCase()) blockedSelf.push(ccNorm.list[c]);
      else ccList.push(ccNorm.list[c]);
    }

    if (!targets.length) {
      return json_({
        ok: false,
        error: '보낼 수 있는 수신자가 없습니다. 발신 주소(' + sender + ')로는 자기 자신에게 보낼 수 없습니다 — 다른 주소를 지정하세요',
        blocked_self: blockedSelf,
      });
    }

    // 쿼터를 초과하면 MailApp 이 예외를 던지므로 미리 확인해 사유를 명확히 한다.
    var remaining = MailApp.getRemainingDailyQuota();
    if (remaining < targets.length) {
      return json_({
        ok: false,
        error: 'Apps Script 일일 메일 쿼터 부족 (남은 ' + remaining + ' < 필요 ' + targets.length +
               '). 자정(태평양 시간) 이후 초기화됩니다.',
      });
    }

    // html 만 있고 평문이 없으면 fallback 을 채워준다 (평문 클라이언트 대비).
    var text = req.text == null ? '' : String(req.text);
    if (!text) text = html ? 'HTML 형식 메일입니다. HTML 을 지원하는 메일 앱에서 확인해주세요.' : '';

    var baseOpts = {};
    if (html) baseOpts.htmlBody = html;
    baseOpts.name = String(req.fromName || DEFAULT_FROM_NAME).trim();
    if (String(req.replyTo || '').trim()) baseOpts.replyTo = String(req.replyTo).trim();
    if (ccList.length) baseOpts.cc = ccList.join(',');
    if (bccNorm.list.length) baseOpts.bcc = bccNorm.list.join(',');

    // 직원별 개별 발송 — 한 통에 묶으면 수신자들이 서로의 주소를 보게 된다.
    // 한 명이 실패해도 나머지는 계속 보내고, 실패자만 모아서 보고한다.
    var sent = 0, failed = [];
    for (var t = 0; t < targets.length; t++) {
      var opts = {};
      for (var k in baseOpts) opts[k] = baseOpts[k];
      // cc/bcc 는 첫 통에만 붙인다 — 수신자 수만큼 사본이 가는 것을 막는다.
      if (t > 0) { delete opts.cc; delete opts.bcc; }
      try {
        MailApp.sendEmail(targets[t], subject, text, opts);
        sent++;
      } catch (sendErr) {
        failed.push({ to: targets[t], error: String((sendErr && sendErr.message) ? sendErr.message : sendErr) });
      }
    }

    return json_({
      ok: failed.length === 0,
      sent: sent,
      requested: norm.list.length,
      blocked_self: blockedSelf,
      failed: failed,
      remaining_quota: MailApp.getRemainingDailyQuota(),
      error: failed.length ? (failed.length + '명 발송 실패') : undefined,
    });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) ? err.message : err) });
  }
}


/**
 * GET 은 배포 확인용 — 발송하지 않는다.
 * 브라우저로 /exec 를 열었을 때 {"ok":true,...} 가 보이면 배포가 정상이다.
 */
function doGet(e) {
  // try/catch 가 없으면 Apps Script 가 JSON 대신 HTML 오류 페이지를 반환하고,
  // 호출자는 그걸 "로그인/권한 페이지"로 오진한다.
  try {
    var token = resolveToken_();
    var out = {
      ok: true,
      service: 'contec-plus-mail-relay',
      sender: senderAddress_(),
      token_configured: !!token,
      allowed_domains: ALLOWED_DOMAINS,
      hint: 'POST JSON {custom_subject,custom_html,custom_recipients[]} 으로 발송하세요',
    };
    var given = (e && e.parameter && e.parameter.token) ? String(e.parameter.token) : '';
    if (!token || (given && safeEquals_(given, token))) {
      try {
        out.remaining_quota = MailApp.getRemainingDailyQuota();
      } catch (quotaErr) {
        // 쿼터 조회만 실패해도 나머지 진단 정보는 돌려준다.
        out.quota_error = String((quotaErr && quotaErr.message) ? quotaErr.message : quotaErr);
      }
    }
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) ? err.message : err) });
  }
}


/**
 * 공유 토큰을 스크립트 속성에 저장한다 (권장 방식 — 코드에 시크릿이 남지 않는다).
 * 아래 value 에 토큰을 넣고 편집기에서 한 번 실행한 뒤, 다시 비우고 저장한다.
 */
function setToken() {
  var value = '';   // ← 여기에 토큰을 넣고 실행, 실행 후 다시 비운다
  if (!value) {
    throw new Error('setToken(): value 가 비어있습니다 — 토큰 문자열을 넣고 실행하세요');
  }
  PropertiesService.getScriptProperties().setProperty('SHARED_TOKEN', value);
  Logger.log('SHARED_TOKEN 저장 완료 (길이 %s). 이제 value 를 다시 비우고 저장하세요.', value.length);
}


/** 발신 주소 = 이 스크립트를 소유/실행하는 계정. 조회 실패해도 발송은 막지 않는다. */
function senderAddress_() {
  try {
    return Session.getEffectiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}


/** 스크립트 속성 우선, 없으면 코드 상수. 둘 다 비면 '' (토큰 검사 안 함). */
function resolveToken_() {
  var fromProps = null;
  try {
    fromProps = PropertiesService.getScriptProperties().getProperty('SHARED_TOKEN');
  } catch (e) {
    fromProps = null;   // 속성 접근 권한이 없어도 상수로 동작하게 한다
  }
  return String((fromProps && String(fromProps).trim()) || FALLBACK_TOKEN || '').trim();
}


function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/** 길이 외의 내용 비교를 상수 시간으로 수행 (타이밍 공격 방어). */
function safeEquals_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}


/**
 * 배열 또는 콤마 문자열을 순수 주소 배열로 정규화한다.
 * 표시이름에 콤마가 든 RFC 형식('"Kim, HR" <a@contec.kr>')도 견딘다 —
 * 인용부호 안의 콤마는 구분자로 보지 않는다.
 */
function normalizeList_(raw) {
  var st = { list: [], error: null };
  if (raw == null || raw === '') return st;

  var entries = [];
  if (raw instanceof Array) {
    for (var a = 0; a < raw.length; a++) {
      var v = String(raw[a] == null ? '' : raw[a]).trim();
      if (v) entries.push(v);
    }
  } else {
    entries = splitAddrs_(raw);
  }

  var seen = {};
  for (var i = 0; i < entries.length; i++) {
    var addr = bareAddr_(entries[i]);
    if (!addr) {
      st.error = '주소 형식이 올바르지 않습니다: ' + entries[i];
      return st;
    }
    if (!isDomainAllowed_(addr)) {
      st.error = '허용되지 않은 수신 도메인입니다: ' + addr;
      return st;
    }
    var key = addr.toLowerCase();
    if (seen[key]) continue;   // 중복 수신자에게 두 번 보내지 않는다
    seen[key] = true;
    st.list.push(addr);
  }
  return st;
}


function splitAddrs_(v) {
  if (!v) return [];
  var s = String(v), out = [], buf = '', inQuote = false;
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (ch === '"') { inQuote = !inQuote; buf += ch; continue; }
    if (ch === ',' && !inQuote) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}


/**
 * '표시이름 <a@contec.kr>' 에서 순수 주소만 뽑는다. 꺾쇠가 없으면 원본을 쓴다.
 * 꺾쇠가 2개 이상이거나 결과가 주소 형태가 아니면 null (거부).
 */
function bareAddr_(entry) {
  var s = String(entry).trim();
  var all = s.match(/<[^<>]*>/g);
  if (all && all.length > 1) return null;        // 주소가 2개 숨어 있는 항목 → 거부
  var addr = all ? all[0].slice(1, -1).trim() : s;
  // 화이트리스트로 판정한다. 블랙리스트로는 'a@evil.com@contec.kr' 같은 항목이
  // 단일 주소로 통과해 lastIndexOf('@') 기반 도메인 검사를 우회한다.
  if (!/^[^\s@;,:<>|\\"()\[\]]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(addr)) {
    return null;
  }
  return addr;
}


/** 이미 정규화된 순수 주소를 받는다. */
function isDomainAllowed_(email) {
  if (!ALLOWED_DOMAINS || ALLOWED_DOMAINS.length === 0) return true;
  if (!email) return false;
  var at = email.lastIndexOf('@');
  if (at < 0) return false;
  var domain = email.slice(at + 1).toLowerCase();
  for (var i = 0; i < ALLOWED_DOMAINS.length; i++) {
    if (String(ALLOWED_DOMAINS[i]).toLowerCase() === domain) return true;
  }
  return false;
}
