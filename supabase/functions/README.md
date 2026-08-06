# ⚠️ 이 폴더의 코드는 배포되지 않습니다

**라이브 서비스는 이 폴더의 Edge Function을 실행하지 않습니다.**
여기 있는 파일들은 참고용 원본이며, 실제로 돌아가는 로직은 **회사 자체 API 서버에 별도로 구현**되어 있습니다.

## 실제 아키텍처 (2026-08 확인)

```
contec-plus.contec.dev   ← Cloudflare 프록시 (정적 index.html, sw.js)
   ├─ /rest/v1/*    → PostgREST (자체 호스팅 Postgres)
   ├─ /storage/v1/* → Express 기반 스토리지 서버
   └─ /api/*        → 자체 API 서버  ★ 푸시 발송 등 서버 로직은 전부 여기
```

**셀프호스팅 Supabase 스택이 아닙니다.** PostgREST + 자체 API 서버 조합이라
Edge Function 런타임 자체가 존재하지 않습니다.

- `supabase functions deploy ...` → **실행되지 않습니다.** 배포 대상이 없습니다.
- repo의 `index.html`에 박힌 anon key의 프로젝트 ref(`ifytanvhskqmbvmjoohi`)는
  supabase.com의 **낡은 복사본**입니다. 데이터가 2026-07에 멈춰 있고 라이브와 무관합니다.
  거기서 SQL을 돌려도 라이브에 아무 영향이 없습니다.

## 그래서 서버 로직을 고칠 때

이 폴더의 `.ts` 파일만 수정하면 **아무 일도 일어나지 않습니다.**
반드시 서버 담당자에게 변경 내용을 전달해 자체 API 서버 코드에 반영해야 합니다.

| 폴더 | 자체 API 서버에 대응 구현 있음 |
|---|---|
| `send-race-push/` | ✅ (2026-08 dedupe 로직 서버에 직접 반영됨) |
| `send-employee-notify/` | 확인 필요 |
| `auto-run-race/` | 확인 필요 |
| `generate-quiz/` | 확인 필요 |
| `process-scheduled-emails/` | 확인 필요 |
| `send-qa-email/` | 확인 필요 |

**두 벌이 따로 논다**는 점에 주의하세요. 이 폴더의 코드가 서버의 현재 구현과
일치한다는 보장이 없습니다.

## DB 스키마 변경(DDL)도 마찬가지

`supabase/typing_anticheat.sql` 같은 DDL은 supabase.com 대시보드가 아니라
**프록시 뒤 자체 Postgres에 직접** 실행해야 합니다. (셀프호스팅 Studio SQL Editor 또는 psql)

데이터 조회/확인은 프록시 REST로 가능합니다:

```bash
curl "https://contec-plus.contec.dev/rest/v1/<table>?select=*&limit=5" -H "apikey: <anon key>"
```

## 배포 파이프라인 주의

GitHub push → 배포 과정에서 **경로가 rewrite됩니다.**

| | repo | 라이브 |
|---|---|---|
| `index.html` `CONFIG.supabaseUrl` | `''` (반드시 유지) | `''` |
| `sw.js` 아이콘·이동 경로 | `/CONTEC-Plus/...` | `/...` |

이 rewrite 스크립트는 git repo 안에 없습니다. **repo 내용만 보고 라이브 동작을
단정하지 마세요.** 확인은 위 curl이나 `curl https://contec-plus.contec.dev/sw.js` 로 직접 하세요.
