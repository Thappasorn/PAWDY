-- ============================================================================
--  Pawdy Workspace → Google Sheet  (ส่งทันทีที่มีการเปลี่ยนแปลง)
--
--  ทำอะไร: ทุกครั้งที่มีคนเพิ่ม/แก้/ลบงานในเว็บ ฐานข้อมูลจะยิงข้อมูลไปที่
--          Apps Script Web App ทันที แล้ว Apps Script เขียนลงแท็บ Sync ใน Sheet
--
--  ข้อดี: ไม่ต้องเก็บรหัสผ่านหรือ anon key ไว้ที่ Apps Script เลยสักตัว
--         (ข้อมูลไหลออกทางเดียว ฝั่ง Sheet ไม่มีสิทธิ์อ่านฐานข้อมูล)
--
--  ⚠ ต้องติดตั้งไฟล์ 8-sheet-webapp.gs.txt ใน Apps Script ให้เสร็จก่อน
--    แล้วเอา URL ที่ได้ (.../exec) กับรหัสลับมากรอกในขั้นที่ 3 ข้างล่าง
--
--  วิธีใช้: Supabase → SQL Editor → New query → วางทั้งไฟล์ → แก้ขั้นที่ 3 → Run
-- ============================================================================


-- ---------- 1. เปิดส่วนขยายที่ใช้ยิง HTTP ----------
create extension if not exists pg_net with schema extensions;


-- ---------- 2. ตารางเก็บค่าตั้งค่า (จะได้เปลี่ยน URL ทีหลังโดยไม่ต้องแก้โค้ด) ----------
create table if not exists public.app_settings (
  key   text primary key,
  value text
);

alter table public.app_settings enable row level security;
-- ไม่เปิด policy ใดๆ = แอปฝั่งผู้ใช้อ่านไม่ได้เลย เห็นได้เฉพาะใน SQL Editor


-- ---------- 3. ★ กรอก 2 ค่านี้ ★ ----------
insert into public.app_settings (key, value) values
  ('sheet_webapp_url', 'https://script.google.com/macros/s/ใส่ค่าที่ได้จาก_Apps_Script/exec'),
  ('sheet_secret',     'ใส่รหัสลับที่ตั้งไว้ใน Apps Script')
on conflict (key) do update set value = excluded.value;


-- ---------- 4. ฟังก์ชันประกอบข้อมูลแล้วยิงออกไป ----------
create or replace function public.push_task_to_sheet()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url    text;
  v_secret text;
  v_doc    jsonb;
  v_op     text;
  v_cfg    jsonb;
begin
  select value into v_url    from public.app_settings where key = 'sheet_webapp_url';
  select value into v_secret from public.app_settings where key = 'sheet_secret';

  -- ยังไม่ได้ตั้งค่า = ไม่ทำอะไร (ปลอดภัย ไม่พังการใช้งานปกติ)
  if v_url is null or v_url = '' or v_url like '%ใส่ค่า%' then
    return coalesce(NEW, OLD);
  end if;

  if TG_OP = 'DELETE' then
    v_op := 'DELETE';  v_doc := OLD.doc;
  else
    -- ไม่ต้องยิงถ้าเนื้อหาไม่ได้เปลี่ยนจริง
    if TG_OP = 'UPDATE' and OLD.doc is not distinct from NEW.doc then
      return NEW;
    end if;
    v_op := TG_OP;     v_doc := NEW.doc;
  end if;

  -- ส่งรายการตัวเลือกไปด้วย เพื่อให้ Sheet ทำ dropdown ให้เหมือนหน้าเว็บ
  select jsonb_build_object(
           'config',  (select doc from public.meta where key = 'config'),
           'fields',  (select doc from public.meta where key = 'fields'),
           'spaces',  (select doc from public.meta where key = 'spaces'),
           'members', (select coalesce(jsonb_agg(m.name order by m.name), '[]'::jsonb) from public.members m)
         ) into v_cfg;

  perform net.http_post(
    url     := v_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object(
                 'secret',  v_secret,
                 'op',      v_op,
                 'task_id', coalesce(NEW.id, OLD.id),
                 'task',    v_doc,
                 'meta',    v_cfg,
                 'at',      now()
               ),
    timeout_milliseconds := 8000
  );

  return coalesce(NEW, OLD);
exception when others then
  -- ห้ามให้ปัญหาฝั่ง Sheet ไปทำให้คนใช้เว็บบันทึกงานไม่ได้เด็ดขาด
  return coalesce(NEW, OLD);
end $$;

drop trigger if exists push_task_to_sheet_trg on public.tasks;
create trigger push_task_to_sheet_trg
  after insert or update or delete on public.tasks
  for each row execute function public.push_task_to_sheet();


-- ---------- 5. ส่งงานทั้งหมดขึ้น Sheet รอบแรก (ใช้ตอนติดตั้งเสร็จ) ----------
create or replace function public.push_all_to_sheet()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text; v_secret text; v_cfg jsonb; r record; n int := 0;
begin
  select value into v_url    from public.app_settings where key = 'sheet_webapp_url';
  select value into v_secret from public.app_settings where key = 'sheet_secret';
  if v_url is null or v_url like '%ใส่ค่า%' then
    return 'ยังไม่ได้ตั้งค่า sheet_webapp_url';
  end if;

  select jsonb_build_object(
           'config',  (select doc from public.meta where key = 'config'),
           'fields',  (select doc from public.meta where key = 'fields'),
           'spaces',  (select doc from public.meta where key = 'spaces'),
           'members', (select coalesce(jsonb_agg(m.name order by m.name), '[]'::jsonb) from public.members m)
         ) into v_cfg;

  for r in select id, doc from public.tasks loop
    perform net.http_post(
      url     := v_url,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := jsonb_build_object('secret', v_secret, 'op', 'INSERT',
                                    'task_id', r.id, 'task', r.doc,
                                    'meta', v_cfg, 'at', now()),
      timeout_milliseconds := 8000
    );
    n := n + 1;
  end loop;

  return format('ส่งไปแล้ว %s งาน — รอสักครู่แล้วดูในแท็บ Sync', n);
end $$;


-- ---------- 6. เช็คผล ----------
select key, case when key = 'sheet_secret' then '••••••' else value end as value
  from public.app_settings;

select tgname as "ชื่อ trigger",
       case tgenabled when 'O' then 'เปิดใช้งาน ✓' else 'ปิดอยู่ ✗' end as "สถานะ"
  from pg_trigger where tgname = 'push_task_to_sheet_trg';


-- ============================================================================
--  คำสั่งที่ใช้บ่อย
-- ============================================================================
--  ▸ ส่งงานทั้งหมดขึ้น Sheet รอบแรก (หรือตอนอยากซิงก์ใหม่ทั้งหมด):
--      select public.push_all_to_sheet();
--
--  ▸ เปลี่ยน URL ของ Apps Script (ตอน deploy เวอร์ชันใหม่):
--      update public.app_settings set value = 'URL ใหม่' where key = 'sheet_webapp_url';
--
--  ▸ ดูว่ายิงออกไปสำเร็จไหม (200 = ผ่าน · 302 = ผ่านเหมือนกัน Apps Script ตอบแบบนี้):
--      select id, status_code, created
--        from net._http_response order by created desc limit 10;
--
--  ▸ ปิดการส่งชั่วคราว:
--      alter table public.tasks disable trigger push_task_to_sheet_trg;
--  ▸ เปิดกลับ:
--      alter table public.tasks enable trigger push_task_to_sheet_trg;
-- ============================================================================
