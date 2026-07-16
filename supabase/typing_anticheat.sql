-- ============================================================
--  CONTEC+ 타자왕 점수 조작 방지 — 서버(DB) 측 강제 규칙
-- ============================================================
--  실행 대상: contec-plus.contec.dev 뒤의 "셀프호스팅 Postgres" (회사 서버)
--            ※ supabase.com 클라우드 아님. 실제 typing_scores 테이블이 있는 그 DB.
--  실행 방법: 서버 관리자가 아래 중 하나로 실행
--            - self-hosted Supabase Studio 의 SQL Editor 에 붙여넣고 Run
--            - 또는 psql 로:  psql "<연결문자열>" -f typing_anticheat.sql
--  안전성  : 기존 데이터(행)를 삭제/변경하지 않음. 여러 번 실행해도 안전(idempotent).
--            아래 규칙은 "앞으로 들어오는 INSERT"(=REST/API 직접 호출 포함)에만 적용됨.
-- ============================================================

-- 1) 점수 상한 / 정합성 CHECK 제약
--    게임 점수 공식상 절대 나올 수 없는 값(예: score=999999)을 DB가 거부한다.
--    규칙: score <= words_typed * (37 + 3*max_combo)  (정상 플레이는 항상 이 안에 들어옴)
--    NOT VALID: 기존 행은 검사하지 않고, 신규 INSERT 부터만 적용(기존 데이터 때문에 실패하지 않음).
alter table public.typing_scores
  drop constraint if exists typing_scores_bounds;
alter table public.typing_scores
  add constraint typing_scores_bounds check (
        score       >= 0 and score       <= 500000
    and words_typed >= 0 and words_typed <= 1000
    and max_combo   >= 0 and max_combo   <= words_typed
    and score <= words_typed * (37 + 3 * max_combo)
  ) not valid;

-- 2) 하루 1인 1회 (KST 기준) — 서버에서 강제
--    같은 사번(emp_no)이 오늘(Asia/Seoul) 이미 기록이 있으면 INSERT 를 거부한다.
--    → 콘솔/REST API 로 직접 쏴도 "하루 한 번, 위 상한 안에서만" 가능해진다.
create or replace function public.typing_scores_daily_guard()
returns trigger
language plpgsql
as $$
declare
  cnt int;
begin
  select count(*) into cnt
  from public.typing_scores
  where emp_no = new.emp_no
    and (created_at at time zone 'Asia/Seoul')::date
        = (coalesce(new.created_at, now()) at time zone 'Asia/Seoul')::date;
  if cnt > 0 then
    raise exception '타자왕은 하루 1회만 도전할 수 있습니다 (already played today)';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_typing_daily_guard on public.typing_scores;
create trigger trg_typing_daily_guard
  before insert on public.typing_scores
  for each row
  execute function public.typing_scores_daily_guard();

-- 3) (확인용) 잘 걸렸는지 조회 — 실행 후 결과에 위 제약/트리거가 보이면 성공
select conname as "적용된_제약"
  from pg_constraint where conrelid = 'public.typing_scores'::regclass and conname = 'typing_scores_bounds';
select tgname as "적용된_트리거"
  from pg_trigger where tgrelid = 'public.typing_scores'::regclass and tgname = 'trg_typing_daily_guard';

-- ============================================================
-- (선택) 이미 들어와 있는 조작 의심 기록을 지우려면:
--   * 관리자 화면의 "순위 관리(참여자 제외)"로 숨기거나(권장, 되돌리기 쉬움),
--   * 아래처럼 특정 사번의 이번 달 기록을 직접 삭제할 수 있음. (삭제는 되돌릴 수 없음!)
-- delete from public.typing_scores where emp_no = '사번' and year_month = '2026-07';
--
--   조작 의심 기록(예: 1점 차로 1위 유지) 확인용 조회:
-- select emp_no, employee_name, score, words_typed, max_combo, created_at
--   from public.typing_scores where year_month='2026-07' order by score desc limit 10;
-- ============================================================
