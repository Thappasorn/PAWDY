-- ============================================================
-- Pawdy Workspace — PUBLIC / NO-LOGIN MODE
-- Run once in Supabase → SQL Editor → New query → Run
--
-- WARNING: Anyone who has the website URL can read, add, edit,
-- and delete workspace data. This intentionally removes login-based
-- protection. Keep the URL private if you still want practical privacy.
-- ============================================================

alter table public.members enable row level security;
alter table public.tasks   enable row level security;
alter table public.meta    enable row level security;
alter table public.notifs  enable row level security;

-- Remove the old login/member-only policies.
drop policy if exists members_read   on public.members;
drop policy if exists members_write  on public.members;
drop policy if exists members_update on public.members;
drop policy if exists members_public_all on public.members;

drop policy if exists tasks_all on public.tasks;
drop policy if exists tasks_public_all on public.tasks;

drop policy if exists meta_all on public.meta;
drop policy if exists meta_public_all on public.meta;

drop policy if exists notifs_read   on public.notifs;
drop policy if exists notifs_insert on public.notifs;
drop policy if exists notifs_update on public.notifs;
drop policy if exists notifs_delete on public.notifs;
drop policy if exists notifs_public_all on public.notifs;

-- Allow both visitors (anon) and any existing signed-in sessions.
create policy members_public_all
on public.members for all
to anon, authenticated
using (true)
with check (true);

create policy tasks_public_all
on public.tasks for all
to anon, authenticated
using (true)
with check (true);

create policy meta_public_all
on public.meta for all
to anon, authenticated
using (true)
with check (true);

create policy notifs_public_all
on public.notifs for all
to anon, authenticated
using (true)
with check (true);

-- Ensure the API roles have table privileges as well as RLS permission.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.members to anon, authenticated;
grant select, insert, update, delete on public.tasks   to anon, authenticated;
grant select, insert, update, delete on public.meta    to anon, authenticated;
grant select, insert, update, delete on public.notifs  to anon, authenticated;
