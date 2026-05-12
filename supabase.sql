-- ============================================================
-- shares 테이블 (신규 설치)
-- ============================================================
create table if not exists shares (
  id          uuid        primary key default gen_random_uuid(),
  type        text        not null check (type in ('file', 'text')),
  title       text,
  content     text,
  file_path   text,
  file_url    text,
  file_size   bigint,
  mime_type   text,
  owner_token text,                                                   -- 소유권 토큰 (기기별 삭제/수정 권한)
  expires_at  timestamptz,                                            -- 만료 시각
  created_at  timestamptz default now()
);

-- ============================================================
-- 기존 테이블 마이그레이션 (이미 테이블이 있는 경우 아래 실행)
-- ============================================================
alter table shares add column if not exists owner_token text;
alter table shares add column if not exists owner_email text;
alter table shares add column if not exists expires_at  timestamptz;

-- type CHECK 제약 추가 (중복 오류 무시)
do $$ begin
  alter table shares
    add constraint shares_type_check check (type in ('file', 'text'));
exception when duplicate_object then null;
end $$;

-- ============================================================
-- 인덱스 (D1)
-- ============================================================
create index if not exists shares_created_at_idx
  on shares (created_at desc);

create index if not exists shares_expires_at_idx
  on shares (expires_at)
  where expires_at is not null;

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================
alter table shares enable row level security;

-- 기존 정책이 있으면 재생성 방지
do $$ begin
  create policy "public read shares"
    on shares for select to anon using (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "public insert shares"
    on shares for insert to anon with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "public delete shares"
    on shares for delete to anon using (true);
exception when duplicate_object then null;
end $$;

-- ============================================================
-- visits 테이블 (접속 로그)
-- ============================================================
create table if not exists visits (
  id          uuid        primary key default gen_random_uuid(),
  owner_email text,
  visited_at  timestamptz default now(),
  user_agent  text
);

create index if not exists visits_visited_at_idx on visits (visited_at desc);

alter table visits enable row level security;

do $$ begin
  create policy "public insert visits"
    on visits for insert to anon with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "public read visits"
    on visits for select to anon using (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "public delete visits"
    on visits for delete to anon using (true);
exception when duplicate_object then null;
end $$;

-- ============================================================
-- 만료 항목 자동 삭제 (D3)
-- Supabase 대시보드 > Database > Extensions 에서 pg_cron 활성화 후 실행
-- ============================================================
-- select cron.schedule(
--   'cleanup-expired-shares',
--   '0 * * * *',  -- 매 정시
--   $$ delete from shares where expires_at is not null and expires_at < now(); $$
-- );
