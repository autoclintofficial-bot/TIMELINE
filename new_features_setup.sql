-- ============================================
-- WorkTrack — NEW FEATURES SQL
-- Run this in Supabase SQL Editor
-- (Safe to run even if app already exists)
-- ============================================

-- 1. Add photo_url column to users (employee photo)
alter table users add column if not exists photo_url text default null;

-- 2. TASK ATTACHMENTS TABLE
create table if not exists task_attachments (
  id text primary key,
  task_id text not null references tasks(id) on delete cascade,
  user_id text not null references users(id),
  file_name text not null,
  file_url text not null,
  file_type text not null,
  file_size integer default 0,
  created_at timestamptz default now()
);

-- 3. LEAVES TABLE
create table if not exists leaves (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  leave_type text not null default 'full',
  dates text not null,
  reason text not null,
  status text not null default 'pending',
  admin_note text default '',
  applied_at timestamptz default now(),
  reviewed_at timestamptz default null,
  reviewed_by text default null
);

-- 4. BRANDING TABLE
create table if not exists branding (
  id integer primary key default 1,
  app_name text default 'WorkTrack',
  logo_url text default null,
  primary_color text default '#3b82f6',
  constraint single_row check (id = 1)
);

-- 5. Insert default branding row
insert into branding (id, app_name, logo_url, primary_color)
values (1, 'WorkTrack', null, '#3b82f6')
on conflict (id) do nothing;

-- 6. Disable RLS on new tables
alter table task_attachments disable row level security;
alter table leaves disable row level security;
alter table branding disable row level security;

-- 7. Create Supabase Storage buckets (run these too)
-- Go to Storage in Supabase dashboard and create two buckets:
--   bucket name: "avatars"   (public: true)
--   bucket name: "task-files" (public: true)
-- OR run via SQL:
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('task-files', 'task-files', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

-- 8. Storage policies (allow all for internal app)
create policy if not exists "Allow all avatars" on storage.objects
  for all using (bucket_id = 'avatars') with check (bucket_id = 'avatars');

create policy if not exists "Allow all task-files" on storage.objects
  for all using (bucket_id = 'task-files') with check (bucket_id = 'task-files');

create policy if not exists "Allow all branding" on storage.objects
  for all using (bucket_id = 'branding') with check (bucket_id = 'branding');
