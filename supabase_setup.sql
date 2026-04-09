-- ============================================
-- WorkTrack — Supabase Database Setup
-- Run this ENTIRE file in Supabase SQL Editor
-- ============================================

-- 1. USERS TABLE
create table if not exists users (
  id text primary key,
  name text not null,
  password text not null,
  role text not null default 'employee',
  status text not null default 'active',
  created_at timestamptz default now()
);

-- 2. ATTENDANCE TABLE
create table if not exists attendance (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  date_key text not null,
  login_time timestamptz,
  online_time timestamptz,
  offline_time timestamptz,
  total_break_sec integer default 0,
  working_sec integer default 0,
  score integer,
  status text default 'offline',
  unique(user_id, date_key)
);

-- 3. BREAKS TABLE
create table if not exists breaks (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  date_key text not null,
  type text not null,
  start_time timestamptz not null,
  end_time timestamptz,
  duration_sec integer default 0
);

-- 4. SETTINGS TABLE
create table if not exists settings (
  id integer primary key default 1,
  daily_score integer default 10,
  max_break_minutes integer default 60,
  penalty_interval_minutes integer default 10,
  penalty_points integer default 1,
  duty_hours numeric default 9,
  constraint single_row check (id = 1)
);

-- 5. TASKS TABLE
create table if not exists tasks (
  id text primary key,
  title text not null,
  description text default '',
  assigned_to text not null references users(id) on delete cascade,
  assigned_by text not null references users(id),
  priority text not null default 'medium',
  stage text not null default 'todo',
  deadline timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 6. TASK COMMENTS TABLE
create table if not exists task_comments (
  id text primary key,
  task_id text not null references tasks(id) on delete cascade,
  user_id text not null references users(id),
  comment text not null,
  created_at timestamptz default now()
);

-- 7. INSERT DEFAULT ADMIN + SETTINGS
insert into users (id, name, password, role, status)
values ('admin', 'Administrator', 'admin123', 'admin', 'active')
on conflict (id) do nothing;

insert into settings (id, daily_score, max_break_minutes, penalty_interval_minutes, penalty_points, duty_hours)
values (1, 10, 60, 10, 1, 9)
on conflict (id) do nothing;

-- 8. DISABLE Row Level Security (simplest for internal tools)
alter table users disable row level security;
alter table attendance disable row level security;
alter table breaks disable row level security;
alter table settings disable row level security;
alter table tasks disable row level security;
alter table task_comments disable row level security;
