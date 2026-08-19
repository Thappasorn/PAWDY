-- ============================================================================
--  Pawdy Workspace — ชั้นที่ 1 สำรองทุก 1 นาที (ละเอียดสุดที่ pg_cron ทำได้)
--
--  ต้องรัน 1-supabase-pg_cron.sql ไปก่อนแล้ว · ไฟล์นี้รันทับได้เลย
--  (ถ้าเคยรัน 4-backup-every-5-min.sql ไปแล้วก็รันทับได้เหมือนกัน)
--
--  ปรับ 2 อย่างเพื่อรองรับความถี่ระดับนาที:
--
--  1) เทียบด้วยลายนิ้วมือ (md5) แทนการดึงข้อมูลก้อนใหญ่มาเทียบทุกนาที
--     เดิม: ดึง jsonb 58 KB ออกมาเทียบทุกนาที = 83 MB/วัน
--     ใหม่: เทียบสตริง 32 ตัวอักษร = แทบไม่กินอะไรเลย
--
--  2) ล้างของเก่าแบบขั้นบันไดที่ถี่ขึ้น
--       2 ชั่วโมงล่าสุด : เก็บทุกชุด          ← ย้อนได้ละเอียดระดับนาที
--       24 ชั่วโมงล่าสุด: ชุดสุดท้ายของทุก 10 นาที
--       7 วันล่าสุด     : ชุดสุดท้ายของแต่ละชั่วโมง
--       90 วันล่าสุด    : ชุดสุดท้ายของแต่ละวัน
--       และเก็บ 30 ชุดล่าสุดไว้เสมอไม่ว่ากรณีใด
--
--  วิธีใช้: Supabase → SQL Editor → New query → วางทั้งไฟล์ → Run
-- ============================================================================


-- ---------- 1. เพิ่มคอลัมน์ลายนิ้วมือ ----------
alter table public.backups add column if not exists tasks_md5 text;

update public.backups
   set tasks_md5 = md5(tasks::text)
 where tasks_md5 is null;

create index if not exists backups_md5_idx on public.backups (at desc, tasks_md5);


-- ---------- 2. ฟังก์ชันถ่ายสำเนาเวอร์ชันประหยัด ----------
create or replace function public.make_backup(p_note text default 'auto')
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tasks jsonb;
  v_meta  jsonb;
  v_md5   text;
  v_last  text;
  v_id    bigint;
begin
  select coalesce(jsonb_agg(doc order by created_at desc), '[]'::jsonb)
    into v_tasks from public.tasks;

  -- กันเก็บสำเนาตอนข้อมูลว่าง (บั๊กหรืออุบัติเหตุ)
  if jsonb_array_length(v_tasks) = 0 then
    return null;
  end if;

  -- เทียบลายนิ้วมือก่อน — ถ้าไม่เปลี่ยนก็จบตรงนี้ ไม่ต้องอ่าน meta ด้วยซ้ำ
  v_md5 := md5(v_tasks::text);
  select tasks_md5 into v_last from public.backups order by at desc limit 1;
  if v_last is not null and v_last = v_md5 then
    return null;
  end if;

  select coalesce(jsonb_object_agg(key, doc), '{}'::jsonb)
    into v_meta from public.meta;

  insert into public.backups (note, n_tasks, tasks, meta, tasks_md5)
  values (p_note, jsonb_array_length(v_tasks), v_tasks, v_meta, v_md5)
  returning id into v_id;

  -- ---------- ล้างของเก่าแบบขั้นบันได ----------
  with keep as (
    -- 2 ชั่วโมงล่าสุด: เก็บทุกชุด
    select id from public.backups where at > now() - interval '2 hours'
    union
    -- 24 ชั่วโมงล่าสุด: ชุดสุดท้ายของทุก 10 นาที
    select id from (
      select distinct on (to_timestamp(floor(extract(epoch from at) / 600) * 600)) id
        from public.backups
       where at > now() - interval '24 hours'
       order by to_timestamp(floor(extract(epoch from at) / 600) * 600), at desc
    ) t10
    union
    -- 7 วันล่าสุด: ชุดสุดท้ายของแต่ละชั่วโมง
    select id from (
      select distinct on (date_trunc('hour', at)) id
        from public.backups
       where at > now() - interval '7 days'
       order by date_trunc('hour', at), at desc
    ) h
    union
    -- 90 วันล่าสุด: ชุดสุดท้ายของแต่ละวัน
    select id from (
      select distinct on (date_trunc('day', at)) id
        from public.backups
       where at > now() - interval '90 days'
       order by date_trunc('day', at), at desc
    ) d
    union
    -- กันเหนียว
    select id from (select id from public.backups order by at desc limit 30) r
  )
  delete from public.backups where id not in (select id from keep);

  return v_id;
end $$;


-- ---------- 3. ตั้งเวลาเป็นทุก 1 นาที ----------
select cron.unschedule(jobname)
  from cron.job
 where jobname in ('pawdy-daily-backup', 'pawdy-backup-5min', 'pawdy-backup-1min');

select cron.schedule('pawdy-backup-1min', '* * * * *', $$select public.make_backup('auto')$$);


-- ---------- 4. เช็คผล ----------
select jobname, schedule, active from cron.job where jobname like 'pawdy%';

select count(*)                                                   as "จำนวนสำเนา",
       pg_size_pretty(pg_total_relation_size('public.backups'))   as "พื้นที่ที่ใช้",
       min(at)                                                    as "เก่าสุด",
       max(at)                                                    as "ใหม่สุด"
  from public.backups;


-- ============================================================================
--  คำสั่งที่ใช้บ่อย
-- ============================================================================
--  ดูสำเนาล่าสุด 20 ชุด:
--      select id, at, note, n_tasks from public.backups order by at desc limit 20;
--
--  เช็คพื้นที่ (ฟรีมี 500 MB):
--      select pg_size_pretty(pg_total_relation_size('public.backups'));
--
--  เช็คว่า cron รันจริงไหม (ดู 10 ครั้งล่าสุด):
--      select status, start_time, return_message
--        from cron.job_run_details order by start_time desc limit 10;
--
--  กู้คืนแบบปลอดภัย เติมเฉพาะงานที่หาย:
--      select public.restore_backup(123);
--
--  ถ้าอยากลดความถี่กลับเป็น 5 นาที:
--      select cron.unschedule('pawdy-backup-1min');
--      select cron.schedule('pawdy-backup-5min', '*/5 * * * *', $$select public.make_backup('auto')$$);
-- ============================================================================
