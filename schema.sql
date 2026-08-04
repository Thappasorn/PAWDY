-- ============================================================
--  Pawdy Workspace — Supabase schema
--  Run this once in: Supabase → SQL Editor → New query → Run
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- tables ----------

-- The team. A person can only touch the workspace if their email is here
-- AND they have a Supabase auth account with the same email.
create table if not exists public.members (
  email      text primary key,
  name       text not null,
  color      text not null default '#4f46e5',
  created_at timestamptz not null default now()
);

-- One row per task; the whole task object lives in `doc`.
create table if not exists public.tasks (
  id         text primary key,
  doc        jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Shared settings — currently just the spaces/lists tree (key = 'spaces').
create table if not exists public.meta (
  key        text primary key,
  doc        jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- In-app notifications. Each row is one person's inbox item.
create table if not exists public.notifs (
  id         uuid primary key default gen_random_uuid(),
  to_email   text not null,
  to_name    text,
  from_email text,
  subject    text,
  line       text,
  detail     text,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifs_inbox_idx on public.notifs (to_email, created_at desc);

-- ---------- access control ----------

-- security definer so the members policy can query members without recursing
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

alter table public.members enable row level security;
alter table public.tasks   enable row level security;
alter table public.meta    enable row level security;
alter table public.notifs  enable row level security;

drop policy if exists members_read   on public.members;
drop policy if exists members_write  on public.members;
drop policy if exists members_update on public.members;
create policy members_read   on public.members for select to authenticated using (public.is_member());
create policy members_write  on public.members for insert to authenticated with check (public.is_member());
create policy members_update on public.members for update to authenticated using (public.is_member()) with check (public.is_member());

drop policy if exists tasks_all on public.tasks;
create policy tasks_all on public.tasks for all to authenticated
  using (public.is_member()) with check (public.is_member());

drop policy if exists meta_all on public.meta;
create policy meta_all on public.meta for all to authenticated
  using (public.is_member()) with check (public.is_member());

-- an inbox is private: you read and clear only your own
drop policy if exists notifs_read   on public.notifs;
drop policy if exists notifs_insert on public.notifs;
drop policy if exists notifs_update on public.notifs;
drop policy if exists notifs_delete on public.notifs;
create policy notifs_read   on public.notifs for select to authenticated
  using (lower(to_email) = lower(auth.jwt() ->> 'email'));
create policy notifs_insert on public.notifs for insert to authenticated
  with check (public.is_member());
create policy notifs_update on public.notifs for update to authenticated
  using (lower(to_email) = lower(auth.jwt() ->> 'email'));
create policy notifs_delete on public.notifs for delete to authenticated
  using (lower(to_email) = lower(auth.jwt() ->> 'email'));

-- ---------- live updates ----------
-- (safe to re-run: errors here just mean the table is already published)
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.meta;
alter publication supabase_realtime add table public.members;
alter publication supabase_realtime add table public.notifs;

-- ---------- your team ----------
-- Edit these 5 rows, then run them. Emails must be lowercase and must match
-- the accounts you create in Authentication → Users.

insert into public.members (email, name, color) values
  ('thappasorn@pawdy.co.th', 'Thappasorn', '#4f46e5'),
  ('member2@pawdy.co.th',    'Member 2',   '#0891b2'),
  ('member3@pawdy.co.th',    'Member 3',   '#db2777'),
  ('member4@pawdy.co.th',    'Member 4',   '#059669'),
  ('member5@pawdy.co.th',    'Member 5',   '#d97706')
on conflict (email) do nothing;

-- ---------- starting spaces (optional) ----------
insert into public.meta (key, doc) values (
  'spaces',
  '[{"name":"Marketing","color":"#4f46e5","lists":["Q3 Campaigns","Content Calendar"]},
    {"name":"Product","color":"#0891b2","lists":["Launch","Packaging"]},
    {"name":"Operations","color":"#d97706","lists":["Inventory","Suppliers"]}]'::jsonb
) on conflict (key) do nothing;
