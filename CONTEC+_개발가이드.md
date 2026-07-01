# CONTEC+ 개발 가이드
> 작성일: 2026-07-01

---

## 1. 프로젝트 개요
CONTEC+ 는 CONTEC 임직원 참여형 복지 프로그램으로, **앱스토어 배포 없이 웹 링크만으로 스마트폰에 "앱처럼" 설치해 쓸 수 있는 PWA(Progressive Web App)** 로 개발되었습니다.

- 별도 서버 구축 없이 **정적 호스팅(GitHub Pages) + Supabase(BaaS)** 조합으로 운영
- 빌드 도구(React/Vue 등) 없이 **순수 HTML/CSS/JS 단일 파일**로 구현 → 배포가 파일 하나를 올리는 것으로 끝나고, 별도 컴파일 과정이 없어 수정·배포 속도가 빠름

---

## 2. 왜 "앱"이 아니라 "PWA"로 만들었나
네이티브 앱(iOS/Android)으로 만들면 스토어 심사, 앱 업데이트 배포 지연, 개발 플랫폼 이원화(iOS+Android 각각 개발) 같은 비용이 발생합니다. 사내 복지 프로그램처럼 **빠르게 만들고 수시로 기능을 추가/수정해야 하는 서비스**에는 부담이 큽니다.

PWA로 만들면:
- 링크 하나로 배포 → 사용자는 "홈 화면에 추가"만 하면 아이콘이 생기고 앱처럼 실행됨 (`manifest.json`의 `display: standalone`)
- 스토어 심사 없이 즉시 업데이트 반영 가능
- 푸시 알림, 오프라인 캐싱 등 네이티브 앱에 준하는 기능 사용 가능

### 실제 구현 요소
| 요소 | 파일 | 역할 |
|---|---|---|
| 앱 메타데이터 | `manifest.json` | 앱 이름, 아이콘, 시작 URL, standalone 모드, 테마 색상 정의 → "홈 화면에 추가" 시 네이티브 앱처럼 보이게 함 |
| 서비스 워커 | `sw.js` | 정적 자산(이미지/아이콘) 캐싱, 오프라인 대응. `index.html`은 항상 네트워크에서 최신본을 받아오도록 캐시 제외 처리 (배포 직후 사용자가 구버전을 보는 문제 방지) |
| 푸시 알림 | `sw.js`의 `push`/`notificationclick` 이벤트 + Supabase Edge Function(`send-race-push`) | VAPID 키 기반 웹 푸시로 레이스 시작 등 이벤트 알림 |
| iOS 대응 | `index.html` 상단 `apple-mobile-web-app-*` 메타 태그 | iOS Safari에서도 standalone 앱처럼 동작하도록 처리 |

---

## 3. 기술 스택
- **프론트엔드**: Vanilla JS + CSS (프레임워크 없음), 전체가 `index.html` 한 파일 안에 `<style>`/`<script>`로 작성됨
- **백엔드/DB**: [Supabase](https://supabase.com) — Postgres DB를 REST API(`/rest/v1/...`)로 직접 호출
- **서버리스 함수**: Supabase Edge Functions (Deno 런타임) — `supabase/functions/` 하위에 6개 존재
  - `auto-run-race`, `generate-quiz`, `process-scheduled-emails`, `send-employee-notify`, `send-qa-email`, `send-race-push`
- **호스팅**: GitHub Pages 정적 배포 + 커스텀 도메인(`contec-plus.contec.dev`). 구 도메인(`conteccharm-oss.github.io`) 접속 시 자동 리다이렉트 처리됨

---

## 4. 데이터 계층 구조 (`SB` 객체)
`index.html` 내부에 Supabase REST API를 감싸는 얇은 헬퍼 객체 `SB`가 정의되어 있음 (약 2096번째 줄):

```js
const SB = {
  get, post, patch, del, delWhere,   // 기본 CRUD
  upload, listStorage, deleteStorageFiles,  // Storage(이미지 업로드)
  upsert, insertIgnore               // 충돌 처리(on-conflict / ignore-duplicates)
};
```

- `CONFIG.supabaseUrl` / `supabaseKey`(anon key)를 하드코딩해 클라이언트에서 직접 REST 호출
- RLS(Row Level Security)는 모든 테이블에 `anon_all` 정책(전체 허용)으로 열려 있음 — 별도 서버 인증 계층 없이 anon key로 운영되는 구조이므로, 민감 데이터를 다루는 테이블을 추가할 경우 정책 강화 필요

**중요한 개발 원칙**: 기기 간 데이터 동기화가 필요한 설정값은 `localStorage`가 아니라 `app_settings` 테이블(`SB.upsert`)에 저장할 것. `localStorage`는 기기별 독립 저장소라 폰/PC 간 설정이 어긋나는 문제가 과거에 있었음 (유지보수 히스토리 참고).

---

## 5. 화면 구조 (SPA 방식)
빌드 도구 없이 CSS `display` 토글로 화면을 전환하는 단일 페이지 앱(SPA) 구조:

- `#screen-login` — 로그인 화면
- `#screen-main` — 로그인 후 메인 셸, 내부에 다음 `page-*` 들이 존재
  - `page-home` (홈), `page-quiz` (우주 릴레이 퀴즈), `page-race` (궤도 레이스), `page-funny` (웃수저 챌린지), `page-idea` (아이디어 제안), `page-typing` (타자연습), `page-mypage` (마이페이지), `page-faq` (FAQ), `page-admin` (관리자)

각 페이지의 로직은 전역 `<script>` 안에 함수 단위로 정의되어 있고, 화면 전환은 `.screen`/`.page` 클래스에 `active`를 붙였다 떼는 방식으로 처리합니다.

---

## 6. 향후 개발 시 참고사항
1. **동기화가 필요한 설정은 반드시 `app_settings` DB 테이블 경유** (`SB.upsert`) — localStorage 단독 저장 금지
2. **동시 접속 경쟁 조건**이 있는 기능(퀴즈 배정 등)은 `SB.insertIgnore` + PK 제약으로 처리한 기존 패턴을 따를 것
3. `sw.js`의 `CACHE` 버전 문자열(`contec-challenge-v56`)은 정적 자산을 변경할 때마다 올려서 클라이언트 캐시를 갱신시킬 것
4. 새 Supabase 테이블 추가 시 RLS 활성화 + `anon_all` 정책 생성을 잊지 말 것 (과거 이 누락으로 인해 등록 기능이 막힌 이력 있음)
5. 구체적인 버그 수정/기능 추가 이력은 별도 유지보수 히스토리 문서 참고

---

## 참고: 왜 이 구조를 택했는가 (요약)
| 선택 | 이유 |
|---|---|
| 빌드 도구 없는 단일 HTML 파일 | 사내 소규모 복지 앱 — 배포 파이프라인/빌드 인프라 구축 비용보다 즉시 수정·배포 속도가 더 중요 |
| PWA | 앱스토어 심사 없이 빠른 배포, 설치형 앱 경험, 푸시 알림까지 지원 가능 |
| Supabase | 자체 서버 없이 DB/인증/스토리지/서버리스 함수를 한 번에 해결, 무료 플랜으로 소규모 트래픽 충분히 커버 |
| GitHub Pages | 정적 파일이라 무료 호스팅 가능, 커스텀 도메인 연결도 간단 |
