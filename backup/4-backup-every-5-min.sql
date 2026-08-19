-- ============================================================================
--  Pawdy Workspace — อัปเกรดชั้นที่ 1 ให้สำรองทุก 5 นาที
--
--  ต้องรัน 1-supabase-pg_cron.sql ไปแล้วก่อน แล้วค่อยรันไฟล์นี้ทับ
--
--  ทำอะไร:
--    · เปลี่ยน cron จากวันละครั้ง → ทุก 5 นาที
--    · เปลี่ยนวิธีล้างของเก่าเป็นแบบขั้นบันได จะได้ไม่กินพื้นที่จนเต็ม
--        - 24 ชม.ล่าสุด : เก็บทุกชุด (ย้อนได้ละเอียดระดับ 5 นาที)
--        - 7 วันล่าสุด  : เก็บชุดสุดท้ายของแต่ละชั่วโมง
--        - 90 วันล่าสุด : เก็บชุดสุดท้ายของแต่ละวัน
--        - และเก็บ 30 ชุดล่าสุดไว้เสมอไม่ว่ากรณีใด
--
--  หมายเหตุ: ฟังก์ชันข้ามการเก็บถ้าข้อมูลไม่เปลี่ยนจากชุดก่อนหน้า
--            ตอนไม่มีใครแก้งาน 5 นาทีผ่านไปก็ไม่เกิดแถวใหม่ ไม่เปลืองที่
--
--  วิธีใช้: Supabase → SQL Editor → New query → วางทั้งไฟล์ → Run
-- ============================================================================


-- ---------- 1. เปลี่ยนวิธีล้างของเก่าเป็นแบบขั้นบันได ----------
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

  -- กันเก็บสำเนาตอนข้อมูลว่าง
  if jsonb_array_length(v_tasks) = 0 then
    return null;
  end if;

  -- ข้อมูลไม่เปลี่ยนจากชุดก่อนหน้า = ไม่ต้องเก็บซ้ำ
  select tasks into v_last from public.backups order by at desc limit 1;
  if v_last is not null and v_last = v_tasks then
    return null;
  end if;

  insert into public.backups (note, n_tasks, tasks, meta)
  values (p_note, jsonb_array_length(v_tasks), v_tasks, v_meta)
  returning id into v_id;

  -- ---------- ล้างของเก่าแบบขั้นบันได ----------
  with keep as (
    select id from public.backups where at > now() - interval '24 hours'
    union
    select id from (
      select distinct on (date_trunc('hour', at)) id
        from public.backups
       where at > now() - interval '7 days'
       order by date_trunc('hour', at), at desc
    ) h
    union
    select id from (
      select distinct on (date_trunc('day', at)) id
        from public.backups
       where at > now() - interval '90 days'
       order by date_trunc('day', at), at desc
    ) d
    union
    select id from (select id from public.backups order by at desc limit 30) r
  )
  delete from public.backups where id not in (select id from keep);

  return v_id;
end $$;


-- ---------- 2. เปลี่ยนตารางเวลาเป็นทุก 5 นาที ----------
select cron.unschedule('pawdy-daily-backup')
 where exists (select 1 from cron.job where jobname = 'pawdy-daily-backup');

select cron.unschedule('pawdy-backup-5min')
 where exists (select 1 from cron.job where jobname = 'pawdy-backup-5min');

select cron.schedule('pawdy-backup-5min', '*/5 * * * *', $$select public.make_backup('auto')$$);


-- ---------- 3. เช็คผล ----------
select jobname, schedule, active from cron.job where jobname like 'pawdy%';

select count(*) as จำนวนสำเนา,
       pg_size_pretty(sum(pg_column_size(tasks) + pg_column_size(meta))::bigint) as พื้นที่ที่ใช้,
       min(at) as เก่าสุด,
       max(at) as ใหม่สุด
  from public.backups;


-- ============================================================================
--  คำสั่งที่ใช้บ่อย
-- ============================================================================
--  ดูสำเนาล่าสุด 20 ชุด:
--      select id, at, note, n_tasks from public.backups order by at desc limit 20;
--
--  ดูว่ากินพื้นที่เท่าไหร่แล้ว (ฟรีมี 500 MB):
--      select pg_size_pretty(pg_total_relation_size('public.backups'));
--
--  กู้คืนแบบปลอดภัย เติมเฉพาะงานที่หาย:
--      select public.restore_backup(123);
--
--  ถ้าอยากกลับไปเป็นวันละครั้ง:
--      select cron.unschedule('pawdy-backup-5min');
--      select cron.schedule('pawdy-daily-backup', '0 17 * * *', $$select public.make_backup('cron')$$);
-- ============================================================================
