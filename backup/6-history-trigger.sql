-- ============================================================================
--  Pawdy Workspace — ชั้นที่ 0: บันทึกทุกการเปลี่ยนแปลง (ศูนย์นาที)
--
--  ต่างจากการสำรองเป็นช่วงๆ ยังไง:
--    สำรองทุก 1 นาที = ถ่ายรูปทั้งห้องทุกนาที ถ้าของหายตอน 10:00:30
--                      ก็ย้อนได้แค่ 10:00:00 (เสีย 30 วินาที)
--    trigger นี้      = ทุกครั้งที่มีคนแตะงานชิ้นไหน ฐานข้อมูลจดค่าเดิมไว้ทันที
--                      ไม่เสียแม้แต่วินาทีเดียว และกู้ทีละชิ้นได้
--
--  แถมยังทำงาน "น้อยกว่า" ด้วย เพราะไม่ต้องวิ่งเช็คทุกนาที
--  มันขยับเฉพาะตอนมีคนแก้จริงๆ เท่านั้น
--
--  ต้องรัน 1-supabase-pg_cron.sql ไปก่อนแล้ว
--  วิธีใช้: Supabase → SQL Editor → New query → วางทั้งไฟล์ → Run
-- ============================================================================


-- ---------- 1. ตารางเก็บประวัติ ----------
create table if not exists public.tasks_history (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  op         text        not null,     -- UPDATE = แก้ไข · DELETE = ลบออกจากฐานข้อมูล
  task_id    text        not null,
  doc        jsonb       not null,     -- ค่า "ก่อนเปลี่ยน" เสมอ
  changed_by text
);

create index if not exists tasks_history_task_idx on public.tasks_history (task_id, at desc);
create index if not exists tasks_history_at_idx   on public.tasks_history (at desc);
create index if not exists tasks_history_op_idx   on public.tasks_history (op, at desc);

alter table public.tasks_history enable row level security;

drop policy if exists tasks_history_read on public.tasks_history;
create policy tasks_history_read on public.tasks_history
  for select to authenticated using (true);


-- ---------- 2. ตัว trigger ----------
create or replace function public.tasks_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE' then
    -- แอปบางทีเขียนทับด้วยค่าเดิม — ไม่ต้องจดถ้าเนื้อหาไม่ได้เปลี่ยนจริง
    if OLD.doc is not distinct from NEW.doc then
      return NEW;
    end if;
    insert into public.tasks_history (op, task_id, doc, changed_by)
    values ('UPDATE', OLD.id, OLD.doc, OLD.updated_by);
    return NEW;

  elsif TG_OP = 'DELETE' then
    insert into public.tasks_history (op, task_id, doc, changed_by)
    values ('DELETE', OLD.id, OLD.doc, OLD.updated_by);
    return OLD;
  end if;
  return NEW;
end $$;

drop trigger if exists tasks_audit_trg on public.tasks;
create trigger tasks_audit_trg
  after update or delete on public.tasks
  for each row execute function public.tasks_audit();


-- ---------- 3. ดูว่ามีงานอะไรถูกลบไปบ้าง ----------
create or replace function public.deleted_tasks(p_days int default 30)
returns table (task_id text, name text, list text, deleted_at timestamptz, changed_by text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (h.task_id)
         h.task_id,
         h.doc->>'name',
         h.doc->>'list',
         h.at,
         h.changed_by
    from public.tasks_history h
   where h.op = 'DELETE'
     and h.at > now() - (p_days || ' days')::interval
     and not exists (select 1 from public.tasks t where t.id = h.task_id)
   order by h.task_id, h.at desc
$$;


-- ---------- 4. กู้งานที่ถูกลบกลับมาทีละชิ้น ----------
create or replace function public.undelete_task(p_task_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_doc jsonb;
begin
  if exists (select 1 from public.tasks where id = p_task_id) then
    return 'งาน ' || p_task_id || ' ยังอยู่บนเซิร์ฟเวอร์ ไม่ต้องกู้';
  end if;

  select doc into v_doc
    from public.tasks_history
   where task_id = p_task_id
   order by at desc limit 1;

  if v_doc is null then
    return 'ไม่พบประวัติของ ' || p_task_id;
  end if;

  insert into public.tasks (id, doc) values (p_task_id, v_doc);
  return 'กู้คืนแล้ว: ' || coalesce(v_doc->>'name', p_task_id);
end $$;


-- ---------- 5. กู้ทุกงานที่ถูกลบใน N วันล่าสุดรวดเดียว ----------
create or replace function public.undelete_all(p_days int default 7)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare r record; n int := 0;
begin
  for r in select * from public.deleted_tasks(p_days) loop
    insert into public.tasks (id, doc)
    select h.task_id, h.doc from public.tasks_history h
     where h.task_id = r.task_id order by h.at desc limit 1
    on conflict (id) do nothing;
    n := n + 1;
  end loop;
  return format('กู้คืน %s งานที่ถูกลบใน %s วันล่าสุด', n, p_days);
end $$;


-- ---------- 6. ดูประวัติของงานชิ้นเดียว / ย้อนกลับไปเวอร์ชันใดก็ได้ ----------
create or replace function public.task_versions(p_task_id text)
returns table (history_id bigint, at timestamptz, op text, name text, status text, due text, changed_by text)
language sql
stable
security definer
set search_path = public
as $$
  select h.id, h.at, h.op, h.doc->>'name', h.doc->>'status', h.doc->>'due', h.changed_by
    from public.tasks_history h
   where h.task_id = p_task_id
   order by h.at desc
$$;

create or replace function public.restore_task_version(p_history_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_doc jsonb; v_id text;
begin
  select doc, task_id into v_doc, v_id from public.tasks_history where id = p_history_id;
  if v_doc is null then return 'ไม่พบประวัติ id = ' || p_history_id; end if;

  insert into public.tasks (id, doc) values (v_id, v_doc)
  on conflict (id) do update set doc = excluded.doc;

  return 'ย้อนงาน ' || v_id || ' กลับไปเวอร์ชันนั้นแล้ว: ' || coalesce(v_doc->>'name', '');
end $$;


-- ---------- 7. ล้างประวัติเก่า (รันวันละครั้ง) ----------
--   < 7 วัน   : เก็บทุกเวอร์ชัน
--   7-90 วัน  : เก็บวันละเวอร์ชันต่อ 1 งาน
--   > 90 วัน  : ลบทิ้ง — ยกเว้นรายการที่ถูก "ลบ" เก็บไว้ 1 ปี (ของมีค่าที่สุด)
create or replace function public.prune_history()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare n1 int; n2 int;
begin
  with keep as (
    select id from public.tasks_history
     where op <> 'UPDATE' or at > now() - interval '7 days'
    union
    select id from (
      select distinct on (task_id, date_trunc('day', at)) id
        from public.tasks_history
       where op = 'UPDATE' and at <= now() - interval '7 days'
       order by task_id, date_trunc('day', at), at desc
    ) d
  )
  delete from public.tasks_history where id not in (select id from keep);
  get diagnostics n1 = row_count;

  delete from public.tasks_history
   where (op = 'UPDATE' and at < now() - interval '90 days')
      or (op = 'DELETE' and at < now() - interval '365 days');
  get diagnostics n2 = row_count;

  return format('ย่อประวัติ %s แถว · ลบของเก่า %s แถว', n1, n2);
end $$;

select cron.unschedule('pawdy-prune-history')
 where exists (select 1 from cron.job where jobname = 'pawdy-prune-history');

select cron.schedule('pawdy-prune-history', '20 18 * * *', $$select public.prune_history()$$);


-- ---------- 8. เช็คผล ----------
select tgname as "ชื่อ trigger", tgenabled as "เปิดอยู่"
  from pg_trigger where tgname = 'tasks_audit_trg';

select jobname as "งานตามเวลา", schedule as "ตาราง", active as "เปิดอยู่"
  from cron.job where jobname like 'pawdy%';


-- ============================================================================
--  คำสั่งที่ใช้บ่อย — เก็บไว้ใช้ตอนต้องกู้
-- ============================================================================
--
--  ▸ มีงานอะไรถูกลบไปบ้างใน 30 วัน:
--      select * from public.deleted_tasks(30);
--
--  ▸ กู้งานชิ้นเดียว:
--      select public.undelete_task('T12345');
--
--  ▸ กู้ทุกงานที่ถูกลบใน 7 วันล่าสุดรวดเดียว:
--      select public.undelete_all(7);
--
--  ▸ ดูประวัติของงานชิ้นหนึ่ง (ใครแก้อะไรเมื่อไหร่):
--      select * from public.task_versions('T12345');
--
--  ▸ ย้อนงานกลับไปเวอร์ชันใดเวอร์ชันหนึ่ง (เอา history_id จากคำสั่งด้านบน):
--      select public.restore_task_version(456);
--
--  ▸ เกิดอะไรขึ้นในชั่วโมงที่ผ่านมา (ไว้สืบตอนข้อมูลผิดปกติ):
--      select at, op, task_id, doc->>'name' as name, changed_by
--        from public.tasks_history
--       where at > now() - interval '1 hour'
--       order by at desc;
--
--  ▸ เช็คว่าประวัติกินพื้นที่เท่าไหร่ (ฟรีมี 500 MB):
--      select count(*) as แถว,
--             pg_size_pretty(pg_total_relation_size('public.tasks_history')) as พื้นที่
--        from public.tasks_history;
-- ============================================================================
