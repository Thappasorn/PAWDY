-- ============================================================
-- Pawdy — ที่เก็บรูปที่ paste ลงคอมเมนต์
-- รันใน Supabase → SQL Editor → New query → Run (ครั้งเดียว)
-- ไฟล์นี้ไม่แตะ snippet เดิมที่เซฟไว้ สร้างใหม่แยกให้รันเอง
-- ============================================================

-- 1) bucket — public read เพื่อให้รูปโชว์ได้ทั้งในเว็บ ในอีเมลแจ้งเตือน และในชีต
--    path ของไฟล์สุ่ม เดาไม่ได้ แต่ถ้าใครได้ลิงก์ไปก็เปิดได้ (แลกกับความง่าย)
--    ถ้าอยากปิดสนิทต้องใช้ signed URL ซึ่งจะหมดอายุและรูปในอีเมลจะพัง
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-images',
  'task-images',
  true,
  8388608,                                     -- 8 MB ต่อรูป
  array['image/png','image/jpeg','image/gif','image/webp','image/avif']
)
on conflict (id) do update set
  public             = true,
  file_size_limit    = 8388608,
  allowed_mime_types = array['image/png','image/jpeg','image/gif','image/webp','image/avif'];

-- 2) ใครดูได้ / ใครอัปได้
drop policy if exists "task-images อ่านได้ทุกคน"   on storage.objects;
drop policy if exists "task-images อัปได้ถ้าล็อกอิน" on storage.objects;
drop policy if exists "task-images ลบได้ถ้าล็อกอิน"  on storage.objects;

create policy "task-images อ่านได้ทุกคน"
  on storage.objects for select
  to public
  using (bucket_id = 'task-images');

create policy "task-images อัปได้ถ้าล็อกอิน"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'task-images');

create policy "task-images ลบได้ถ้าล็อกอิน"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'task-images');

-- 3) เช็คว่าขึ้นจริง
select id, public, file_size_limit from storage.buckets where id = 'task-images';
