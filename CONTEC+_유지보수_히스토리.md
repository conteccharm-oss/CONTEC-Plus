# CONTEC+ 유지보수 히스토리
> 최종 업데이트: 2026-05-18

---

## 1. 궤도 레이스 — 시뮬레이션 결과 불일치
**문의:** "결과만보기"와 "확인하기"의 시뮬레이션 결과가 다르다  
**결과:** 점검 결과 동일한 로직 사용 중 → 수정 불필요, 정상 확인

---

## 2. 우주 릴레이 퀴즈 — 주당 문제 수 설정 기능 추가
**문의:** 퀴즈를 1주에 1문제가 아니라 여러 개 출제하고 싶다  
**수정 내용:**
- 관리자 페이지에 "주당 문제 수 설정" 카드 추가
- 슬롯 기반 다중 문제 배정 시스템 구현
- 문제 시작 전 인트로 팝업 추가 ("연속 N문제 정답을 맞춰야 생존!")
- 3-2-1 카운트다운 애니메이션 추가

---

## 3. 퀴즈 설정값 기기 간 미동기화
**문의:** 폰에서 설정한 퀴즈 시간/문제 수가 PC에서 반영이 안 된다  
**원인:** localStorage는 기기별 독립 저장소라 동기화 안 됨  
**수정 내용:**
- `app_settings` DB 테이블에 `quiz_time`, `quiz_week_count` 저장
- 퀴즈 페이지 로드 시 DB에서 설정값 읽어 오도록 변경
- `SB.upsert()` 메서드에 `on-conflict` 파라미터 추가 (key 기준 중복 방지)

---

## 4. 퀴즈 — 기기 간 동등한 기회 보장
**문의:** 한 계정이 어떤 기기를 쓰든 기회가 동등해야 한다. 다른 기기에서 퀴즈를 또 풀 수 있다  
**원인:** 퀴즈 배정·응답 이력이 localStorage에만 저장되어 기기 간 공유 안 됨  
**수정 내용:**
- `quiz_assignments` 테이블 신규 생성 (name + year_month + week_key + slot = PK)
- 문제 배정 3단계 로직: localStorage 캐시 → DB 기존 배정 확인 → 신규 배정
- `SB.insertIgnore()` 메서드 추가 (동시 접속 경쟁 조건 방지)
- 배정 후 DB 재확인으로 레이스 컨디션 처리

**필요했던 Supabase SQL:**
```sql
CREATE TABLE IF NOT EXISTS quiz_assignments (
  name text NOT NULL,
  year_month text NOT NULL,
  week_key text NOT NULL,
  slot int NOT NULL DEFAULT 0,
  quiz_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (name, year_month, week_key, slot)
);
ALTER TABLE quiz_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON quiz_assignments USING (true) WITH CHECK (true);
```

---

## 5. 직원 등록 안 됨 + 전체 테이블 RLS 미설정
**문의:** 직원관리에서 데이터 추가가 안 된다  
**원인:** Supabase RLS(Row Level Security) 활성화 후 anon 정책 미설정으로 INSERT 차단  
**수정 내용 (Supabase SQL 실행):**
```sql
DO $$
DECLARE
  tbl text;
  tbls text[] := ARRAY[
    'employees','quiz_relay','quiz_attempts','quiz_assignments',
    'race_entries','race_results','funny_submissions','funny_votes',
    'idea_submissions','idea_votes','rewards','reward_votes','qa_items','app_settings'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "anon_all" ON %I', tbl);
    EXECUTE format('CREATE POLICY "anon_all" ON %I USING (true) WITH CHECK (true)', tbl);
  END LOOP;
END $$;
```

---

## 6. app_settings upsert 오작동
**원인:** `app_settings` 테이블에 UNIQUE 제약이 없어 upsert가 UPDATE 대신 INSERT를 계속 쌓음  
**수정 내용:**
```sql
ALTER TABLE app_settings ADD CONSTRAINT app_settings_key_unique UNIQUE (key);
```
- `SB.upsert()` 호출 시 `on-conflict=key` 명시하도록 코드 수정

---

## 7. 경품설정·레이스모드 기기 간 미동기화
**문의:** 기기마다 설정 데이터가 달라야 하지 않고 모두 같아야 한다  
**원인:** `contec_prize_tiers`, `contec_race_mode_월` 이 localStorage에만 저장됨  
**수정 내용:**
- `savePrizeTiers()` → `app_settings` DB에도 저장
- `setMonthRaceMode()` → `app_settings` DB에도 저장
- `loadRaceConfig()` → prize_tiers, race_mode 포함해 DB에서 로드

---

## 8. 전사 배포 전 안정성 강화
**문의:** 전직원 동시 접속해도 문제없는지 점검해달라  
**수정 내용:**

### 코드 수정
| 항목 | 수정 내용 |
|---|---|
| 투표 (웃수저/아이디어/경품) | `post()` → `insertIgnore()` 로 중복 방지 |
| 레이스 참여 | `post()` → `insertIgnore()` 로 중복 참가 방지 |
| 파일 업로드 (웃수저·아이디어) | 50MB 제한 추가 |

### Supabase SQL (DB 레벨 UNIQUE 제약)
```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_funny_vote') THEN
    ALTER TABLE funny_votes ADD CONSTRAINT uq_funny_vote UNIQUE (year_month, submission_id, voter_name);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_idea_vote') THEN
    ALTER TABLE idea_votes ADD CONSTRAINT uq_idea_vote UNIQUE (year_month, submission_id, voter_name);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_reward_vote') THEN
    ALTER TABLE reward_votes ADD CONSTRAINT uq_reward_vote UNIQUE (year_month, name);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_race_entry') THEN
    ALTER TABLE race_entries ADD CONSTRAINT uq_race_entry UNIQUE (year_month, name);
  END IF;
END $$;
```

---

## 9. 레이스 참여 전 경품 투표 필수화
**문의:** 직원들이 투표만 하고 참여하기를 안 누른다  
**수정 내용:**
- "참여하기" 클릭 시 경품 투표 여부 먼저 확인
- 투표 안 한 경우 → 토스트 + 경품 섹션 하이라이트
- 투표 완료 후 → 레이스 미참여 시 팝업 자동 표시 ("레이스 참여하기" 버튼 포함)

---

## 10. 기타 UI 개선
| 항목 | 내용 |
|---|---|
| 하단 크레딧 문구 | `CONTEC+ ⓒ 2026 · AI-Assisted by Claude · Crafted by charm` 고정 표시 |

---

## 유지보수 시 참고사항

### 매월 해야 할 것
- 퀴즈 문제 등록 (관리자 → 퀴즈 관리)
- 경품 항목 등록 (관리자 → 레이스 관리)
- 레이스 자동 실행 날짜/시간 확인

### 문제 발생 시 체크리스트
1. Supabase 대시보드에서 테이블 데이터 직접 확인
2. 브라우저 F12 → Console 탭에서 오류 메시지 확인
3. `app_settings` 테이블에 설정값이 정상적으로 저장되어 있는지 확인
4. RLS 정책이 모든 테이블에 적용되어 있는지 확인

### GitHub 저장소
`https://github.com/conteccharm-oss/CONTEC-Plus` (main 브랜치 = 배포 버전)
