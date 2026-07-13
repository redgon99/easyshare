-- ============================================================
-- easyshare 데이터베이스 스키마 (현재 운영 상태와 동일)
-- 신규 설치 시 이 파일 전체를 SQL Editor에서 실행
-- ============================================================

-- ── shares 테이블 ────────────────────────────────────────────
-- 통합 게시물 모델: 제목 + 본문(content, 선택) + 첨부(files jsonb, 0~N개)
-- type은 파생값: 첨부가 있으면 'files', 없으면 'text' ('file'은 레거시)
create table if not exists shares (
  id          uuid        primary key default gen_random_uuid(),
  type        text        not null check (type in ('file', 'files', 'text')),
  title       text,
  content     text,                     -- 본문 텍스트 (마크다운, 선택)
  files       jsonb,                    -- 첨부 [{path,url,name,size,mime}, ...]
  file_path   text,                     -- (호환) 첫 파일 path
  file_url    text,                     -- (호환) 첫 파일 url
  file_name   text,                     -- (호환) 첫 파일 원본명
  file_size   bigint,                   -- (호환) 첨부 총 크기
  mime_type   text,                     -- (호환) 첫 파일 MIME
  owner_token text,                     -- (레거시) 기기별 소유권 토큰
  owner_email text,                     -- 소유자 이메일 (표시·레거시 연결용)
  user_id     uuid references auth.users(id) on delete set null,  -- Auth 계정
  expires_at  timestamptz,
  created_at  timestamptz default now()
);

-- 기존 테이블 마이그레이션용
alter table shares add column if not exists owner_token text;
alter table shares add column if not exists owner_email text;
alter table shares add column if not exists expires_at  timestamptz;
alter table shares add column if not exists file_name   text;
alter table shares add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table shares add column if not exists files jsonb;

-- 레거시 데이터 → 통합 모델 변환
-- 1) 단일 파일(type='file') → files 배열
update shares set
  files = jsonb_build_array(jsonb_build_object(
    'path', file_path, 'url', file_url,
    'name', coalesce(file_name, title, 'file'),
    'size', coalesce(file_size, 0),
    'mime', coalesce(mime_type, 'application/octet-stream')
  )),
  type = 'files'
where type = 'file' and file_path is not null and files is null;

-- 2) 묶음(content에 {"files":[...]} JSON) → files 컬럼으로 이동
update shares set
  files = (content::jsonb -> 'files'),
  content = null
where type = 'files' and files is null and content is not null
  and content ~ '^\s*\{' and (content::jsonb ? 'files');

alter table shares drop constraint if exists shares_type_check;
alter table shares add constraint shares_type_check check (type in ('file', 'files', 'text'));

create index if not exists shares_created_at_idx on shares (created_at desc);
create index if not exists shares_expires_at_idx on shares (expires_at) where expires_at is not null;
create index if not exists shares_user_id_idx    on shares (user_id);

-- ── 계정 도입 전 자료(owner_email 일치)를 로그인 계정에 연결 ──
create or replace function public.claim_my_shares() returns integer
language plpgsql security definer set search_path = public
as $$
declare n integer;
begin
  if auth.uid() is null then return 0; end if;
  update shares set user_id = auth.uid()
  where user_id is null
    and owner_email is not null
    and lower(owner_email) = lower(coalesce(auth.email(), ''));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.claim_my_shares() from anon;
grant execute on function public.claim_my_shares() to authenticated;

-- ── shares RLS (Supabase Auth 기반) ──────────────────────────
-- 읽기: 공개 (목록·공유 링크 조회)
-- 쓰기: 로그인 사용자 본인(auth.uid() = user_id)만.
--       완전 무소유 레거시 행(user_id/owner_token/owner_email 모두 null)은 예외 허용.
alter table shares enable row level security;

drop policy if exists "public read shares"  on shares;
drop policy if exists "anon insert shares"  on shares;
drop policy if exists "owner update shares" on shares;
drop policy if exists "owner delete shares" on shares;

create policy "public read shares" on shares
  for select to anon, authenticated using (true);

create policy "auth insert shares" on shares
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "owner update shares" on shares
  for update to authenticated
  using (
    user_id = auth.uid()
    or (user_id is null and owner_token is null and owner_email is null)
  );

create policy "owner delete shares" on shares
  for delete to authenticated
  using (
    user_id = auth.uid()
    or (user_id is null and owner_token is null and owner_email is null)
  );

-- ── visits 테이블 (접속 로그) ─────────────────────────────────
-- 로그인 사용자만 기록(insert). 조회·삭제는 admin-api Edge Function(서비스 롤) 전용.
create table if not exists visits (
  id          uuid        primary key default gen_random_uuid(),
  owner_email text,
  visited_at  timestamptz default now(),
  user_agent  text
);

create index if not exists visits_visited_at_idx on visits (visited_at desc);

alter table visits enable row level security;

drop policy if exists "public insert visits" on visits;
do $$ begin
  create policy "auth insert visits"
    on visits for insert to authenticated with check (true);
exception when duplicate_object then null;
end $$;

drop policy if exists "public read visits" on visits;
drop policy if exists "public delete visits" on visits;

-- ── 스토리지 (shared-files 버킷) ──────────────────────────────
-- 읽기는 공개, 업로드·삭제는 로그인 사용자만
drop policy if exists "anon upload shared-files" on storage.objects;
drop policy if exists "anon delete shared-files" on storage.objects;
drop policy if exists "anon select shared-files" on storage.objects;

do $$ begin
  create policy "shared-files select" on storage.objects
    for select to anon, authenticated using (bucket_id = 'shared-files');
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "shared-files insert" on storage.objects
    for insert to authenticated with check (bucket_id = 'shared-files');
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "shared-files delete" on storage.objects
    for delete to authenticated using (bucket_id = 'shared-files');
exception when duplicate_object then null;
end $$;

-- ── app_config 테이블 (관리자 키 해시 등, 서비스 롤 전용) ─────
create table if not exists app_config (
  key   text primary key,
  value text not null
);
alter table app_config enable row level security;  -- anon 정책 없음 = 접근 불가

-- 관리자 키 설정/변경: 원하는 키의 SHA-256(hex, 소문자)을 넣는다.
-- insert into app_config (key, value) values ('admin_key_sha256', '<sha256-hex>')
--   on conflict (key) do update set value = excluded.value;

-- ── 만료 항목 자동 정리 스케줄 ────────────────────────────────
-- cleanup-expired Edge Function을 매시 정각 호출 (스토리지 파일까지 삭제)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- select cron.schedule(
--   'easyshare-cleanup',
--   '0 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://<project-ref>.supabase.co/functions/v1/cleanup-expired',
--     headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <anon-key>'),
--     body := '{}'::jsonb
--   );
--   $$
-- );
