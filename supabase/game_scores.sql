-- ============================================================
--  CONTEC+ 미니게임 공통 점수 테이블 (game_scores)
-- ============================================================
--  실행 대상: contec-plus.contec.dev 뒤의 "셀프호스팅 Postgres" (회사 서버)
--            ※ supabase.com 클라우드 아님.
--  실행 방법: - self-hosted Supabase Studio 의 SQL Editor 에 붙여넣고 Run
--            - 또는 psql 로:  psql "<연결문자열>" -f game_scores.sql
--  안전성  : 기존 테이블(typing_scores 등)을 건드리지 않음. 여러 번 실행해도 안전(idempotent).
--
--  왜 게임마다 테이블을 안 만들고 이걸 쓰나:
--    game_key 컬럼으로 게임을 구분하므로, 앞으로 새 게임을 추가할 때
--    이 SQL을 다시 실행할 필요가 없다(코드만 추가하면 됨).
--    게임별 세부 기록은 detail(jsonb)에 자유 형식으로 넣는다.
--
--  ※ 이 SQL을 실행하기 전까지는 관리자 화면에서 새 게임을 "비공개"로 두세요.
--    (기본값이 비공개라 직원에게는 보이지 않습니다.)
-- ============================================================

-- 1) 테이블
create table if not exists public.game_scores (
  id            bigserial primary key,
  game_key      text        not null,              -- 'match' = 우주 용어 매치
  emp_no        text        not null,
  employee_name text,
  score         int         not null default 0,
  detail        jsonb       not null default '{}'::jsonb,  -- 게임별 세부기록
  year_month    text        not null,              -- 'YYYY-MM'
  created_at    timestamptz not null default now()
);

-- 2) 랭킹 조회용 인덱스 (game_key + 월 + 점수순)
create index if not exists game_scores_rank_idx
  on public.game_scores (game_key, year_month, score desc);
create index if not exists game_scores_emp_idx
  on public.game_scores (game_key, emp_no, created_at desc);

-- 3) RLS + anon_all 정책
--    (개발가이드 원칙: 새 테이블 추가 시 RLS 활성화 + anon_all 정책 생성)
alter table public.game_scores enable row level security;

drop policy if exists anon_all on public.game_scores;
create policy anon_all on public.game_scores
  for all
  using (true)
  with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert on public.game_scores to anon, authenticated;
grant usage, select on sequence public.game_scores_id_seq to anon, authenticated;

-- 4) 점수 조작 방지 — 게임별 상한 CHECK
--    콘솔/REST API 로 직접 쏴도 공식상 불가능한 값은 DB가 거부한다.
--    'match'(우주 용어 매치) 이론상 최대점 = 3,450점 → 4,000 상한.
--    새 게임을 추가할 때 이 제약에 game_key 분기를 한 줄 추가하면 된다.
alter table public.game_scores
  drop constraint if exists game_scores_bounds;
alter table public.game_scores
  add constraint game_scores_bounds check (
        score >= 0
    and score <= 100000
    and (game_key <> 'match' or score <= 4000)
  ) not valid;

-- 5) 하루 1인 1회 (KST 기준) — 게임별로 각각 적용
create or replace function public.game_scores_daily_guard()
returns trigger
language plpgsql
as $$
declare
  cnt int;
begin
  select count(*) into cnt
  from public.game_scores
  where game_key = new.game_key
    and emp_no   = new.emp_no
    and (created_at at time zone 'Asia/Seoul')::date
        = (coalesce(new.created_at, now()) at time zone 'Asia/Seoul')::date;
  if cnt > 0 then
    raise exception '이 게임은 하루 1회만 도전할 수 있습니다 (already played today)';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_game_scores_daily_guard on public.game_scores;
create trigger trg_game_scores_daily_guard
  before insert on public.game_scores
  for each row
  execute function public.game_scores_daily_guard();

-- 6) (확인용) 아래 3개가 모두 결과에 나오면 성공
select to_regclass('public.game_scores') as "생성된_테이블";
select conname as "적용된_제약"
  from pg_constraint where conrelid = 'public.game_scores'::regclass and conname = 'game_scores_bounds';
select tgname as "적용된_트리거"
  from pg_trigger where tgrelid = 'public.game_scores'::regclass and tgname = 'trg_game_scores_daily_guard';

-- ============================================================
-- 운영 참고
--   * 특정 사번 기록 숨기기 → 관리자 화면 "순위 관리(참여자 제외)" 사용 (되돌리기 쉬움)
--   * 이번 달 상위 기록 확인:
--     select employee_name, score, detail, created_at
--       from public.game_scores
--      where game_key='match' and year_month='2026-08'
--      order by score desc limit 10;
-- ============================================================
