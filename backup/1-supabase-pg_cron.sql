-- ============================================================================
--  Pawdy Workspace — ชั้นที่ 1: สำรองข้อมูลอัตโนมัติในตัว Supabase เอง
--
--  ทำอะไร: ทุกคืนตี 0 (เวลาไทย) ถ่ายสำเนางานทั้งหมด + meta เก็บลงตาราง backups
--          เก็บย้อนหลัง 90 วัน กู้คืนได้ด้วย SQL บรรทัดเดียว
--
--  ฟรี 100% ใช้ได้บนแผน Free · ไม่ต้องมีเซิร์ฟเวอร์ · ทำงานแม้ไม่มีใครเปิดเว็บ
--
--  วิธีติดตั้ง:
--    1. เข้า Supabase Dashboard → SQL Editor → New query
--    2. วางไฟล์นี้ทั้งไฟล์ → กด Run
--    3. เสร็จ (ถ้าติด error เรื่อง pg_cron ให้ไปเปิดที่ Database → Extensions
--       ค้นคำว่า pg_cron แล้วกด Enable ก่อน แล้วค่อยรันใหม่)
-- ============================================================================


-- ---------- 1. ตารางเก็บสำเนา ----------
create table if not exists public.backups (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  note     text,
  n_tasks  int  not null,
  tasks    jsonb not null,
  meta     jsonb not null
);

create index if not exists backups_at_idx on public.backups (at desc);

-- อ่านได้เฉพาะคนที่ล็อกอิน · เขียนได้เฉพาะฟังก์ชันข้างล่าง (แอปแตะไม่ได้เลย)
alter table public.backups enable row level security;

drop policy if exists backups_read on public.backups;
create policy backups_read on public.backups
  for select to authenticated using (true);


-- ---------- 2. ฟังก์ชันถ่ายสำเนา ----------
create or replace function public.make_backup(p_note text default 'auto')
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tasks jsonb;
  v_meta  jsonb;
  v_last  jsonb;
  v_id    bigint;
begin
  select coalesce(jsonb_agg(doc order by created_at desc), '[]'::jsonb)
    into v_tasks from public.tasks;

  select coalesce(jsonb_object_agg(key, doc), '{}'::jsonb)
    into v_meta from public.meta;

  -- กันเก็บสำเนาตอนข้อมูลว่าง (ถ้าแอปมีบั๊กจนงานหาย จะได้ไม่ทับสำเนาดีๆ ด้วยของว่าง)
  if jsonb_array_length(v_tasks) = 0 then
    raise notice 'ข้ามการสำรอง: ไม่มีงานเลย';
    return null;
  end if;

  -- ถ้าเหมือนสำเนาล่าสุดเป๊ะ ไม่ต้องเก็บซ้ำให้เปลืองที่
  select tasks into v_last from public.backups order by at desc limit 1;
  if v_last is not null and v_last = v_tasks then
    return null;
  end if;

  insert into public.backups (note, n_tasks, tasks, meta)
  values (p_note, jsonb_array_length(v_tasks), v_tasks, v_meta)
  returning id into v_id;

  -- เก็บย้อนหลัง 90 วัน แต่ยังไงก็เก็บ 30 ชุดล่าสุดไว้เสมอ
  delete from public.backups
   where at < now() - interval '90 days'
     and id not in (select id from public.backups order by at desc limit 30);

  return v_id;
end $$;


-- ---------- 3. ฟังก์ชันกู้คืน ----------
--   p_only_missing = true  → เติมเฉพาะงานที่หายไป ไม่แตะของที่ยังอยู่ (ปลอดภัยสุด)
--   p_only_missing = false → เขียนทับด้วยของในสำเนาทั้งหมด
--   หมายเหตุ: ไม่ลบงานทิ้งไม่ว่ากรณีใด
create or replace function public.restore_backup(p_id bigint, p_only_missing boolean default true)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tasks jsonb;
  v_meta  jsonb;
  r       jsonb;
  k       text;
  n_new   int := 0;
  n_upd   int := 0;
  n_meta  int := 0;
begin
  select tasks, meta into v_tasks, v_meta from public.backups where id = p_id;
  if v_tasks is null then return 'ไม่พบสำเนา id = ' || p_id; end if;

  for r in select * from jsonb_array_elements(v_tasks) loop
    if exists (select 1 from public.tasks t where t.id = r->>'id') then
      if not p_only_missing then
        update public.tasks set doc = r where id = r->>'id';
        n_upd := n_upd + 1;
      end if;
    else
      insert into public.tasks (id, doc) values (r->>'id', r);
      n_new := n_new + 1;
    end if;
  end loop;

  -- meta: เติมเฉพาะ key ที่หายไปหรือกลายเป็นอาเรย์ว่าง
  for k in select jsonb_object_keys(v_meta) loop
    if not exists (
      select 1 from public.meta m
       where m.key = k
         and not (jsonb_typeof(m.doc) = 'array' and jsonb_array_length(m.doc) = 0)
    ) then
      insert into public.meta (key, doc) values (k, v_meta->k)
      on conflict (key) do update set doc = excluded.doc;
      n_meta := n_meta + 1;
    end if;
  end loop;

  return format('กู้คืนแล้ว — งานใหม่ %s · เขียนทับ %s · meta %s', n_new, n_upd, n_meta);
end $$;


-- ---------- 4. ตั้งเวลาอัตโนมัติ ----------
create extension if not exists pg_cron with schema extensions;

select cron.unschedule('pawdy-daily-backup')
 where exists (select 1 from cron.job where jobname = 'pawdy-daily-backup');

-- 17:00 UTC = เที่ยงคืนเวลาไทย
select cron.schedule('pawdy-daily-backup', '0 17 * * *', $$select public.make_backup('cron')$$);


-- ---------- 5. ถ่ายสำเนาชุดแรกเลยตอนนี้ ----------
select public.make_backup('ติดตั้งครั้งแรก') as backup_id;


-- ============================================================================
--  คำสั่งที่ใช้บ่อย — เก็บไว้ใช้ตอนต้องกู้
-- ============================================================================
--
--  ดูรายการสำเนาทั้งหมด:
--      select id, at, note, n_tasks from public.backups order by at desc;
--
--  ถ่ายสำเนาเดี๋ยวนี้ (เช่น ก่อนจะทดลองอะไรเสี่ยงๆ):
--      select public.make_backup('ก่อนแก้ระบบ');
--
--  กู้คืนแบบปลอดภัย — เติมเฉพาะงานที่หาย:
--      select public.restore_backup(123);
--
--  กู้คืนแบบทับทั้งหมดด้วยของในสำเนา:
--      select public.restore_backup(123, false);
--
--  ดาวน์โหลดสำเนาออกมาเป็นไฟล์ (กด Download CSV ที่ผลลัพธ์):
--      select tasks from public.backups where id = 123;
--
--  เช็คว่า cron ทำงานไหม:
--      select * from cron.job;
--      select * from cron.job_run_details order by start_time desc limit 10;
-- ============================================================================
