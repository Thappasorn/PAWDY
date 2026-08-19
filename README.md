# Pawdy Workspace — ไฟล์ทั้งหมด

รวมทุกอย่างของเว็บ Pawdy Workspace · อัปเดต 11 ส.ค. 2026

**เว็บจริง:** https://pawdycontent.vercel.app
**ฐานข้อมูล:** Supabase project `zkdhwgulkwzxajinqsis`
**สำรองนอกบ้าน:** GitHub private repo `Thappasorn/pawdy-backup`

---

## 📁 โครงไฟล์

```
web/                    ← ตัวเว็บ อัปทั้งโฟลเดอร์ขึ้น Vercel
├── index.html            แอปทั้งตัวอยู่ในไฟล์เดียว
├── sw.js                 Service Worker (ทำให้ติดตั้งเป็นแอปได้ + ใช้ได้ตอนเน็ตหลุด)
├── manifest.webmanifest  ข้อมูลแอปสำหรับ PWA
└── icons/                ไอคอนแอป 4 ขนาด

tools/                  ← เครื่องมือ เปิดใช้เฉพาะตอนต้องการ ไม่ต้องอัปขึ้นเว็บ
├── pawdy-restore.html    กู้ข้อมูลจากไฟล์สำรองกลับขึ้น Supabase
├── pawdy-leveldb-rescue.py  ขุดข้อมูลเก่าจากไฟล์เบราว์เซอร์ (ใช้ตอนฉุกเฉิน)
└── leveldb_deep.py          ตัวอ่าน LevelDB แบบดิบ (ตัวช่วยของอันบน)

backup/                 ← ระบบสำรองข้อมูล (SQL + สคริปต์)
sheet-sync/             ← เชื่อมเว็บกับ Google Sheet
recovered-data/         ← ข้อมูลที่กู้กลับมาได้เมื่อ 11 ส.ค.
supabase/               ← Edge Function ส่งอีเมลแจ้งเตือน
```

---

## 🌐 อัปเว็บขึ้น Vercel

ลากทั้งโฟลเดอร์ `web/` ขึ้น vercel.com/new หรือ push เข้า repo ที่ต่อไว้ — เป็น static ล้วน ไม่ต้องตั้ง build command

หลังอัปแล้วให้กด `Cmd+Shift+R` รีเฟรชแรงหนึ่งครั้ง เพื่อให้ Service Worker โหลดตัวใหม่

---

## 🛡 ระบบสำรองข้อมูล (ติดตั้งครบแล้ว)

| ชั้น | ทำงานยังไง | เสียงานอย่างมาก | ไฟล์ |
|---|---|---|---|
| **0** | Trigger จดทุกครั้งที่มีคนแก้/ลบงาน | **0 วินาที** | `backup/6-history-trigger.sql` |
| **1** | Snapshot ทั้ง workspace ลง Supabase | 15 นาที | `backup/1-supabase-pg_cron.sql` |
| **2b** | สำเนาขึ้น GitHub private repo | 30 นาที | `backup/3-github-*` |
| **3** | เก็บในเบราว์เซอร์ของแต่ละคน | 7 วัน | อยู่ใน `index.html` แล้ว |

รายละเอียดการติดตั้งอยู่ใน `backup/README.md`

### คำสั่งกู้ข้อมูลที่ใช้บ่อย (รันใน Supabase → SQL Editor)

```sql
-- มีงานอะไรถูกลบไปบ้างใน 30 วัน
select * from public.deleted_tasks(30);

-- กู้งานที่ถูกลบทีละชิ้น
select public.undelete_task('T12345');

-- กู้ทุกงานที่ถูกลบใน 7 วันรวดเดียว
select public.undelete_all(7);

-- ดูประวัติของงานชิ้นเดียว ใครแก้อะไรเมื่อไหร่
select * from public.task_versions('T12345');

-- ย้อนงานกลับไปเวอร์ชันใดก็ได้ (เอา history_id จากคำสั่งบน)
select public.restore_task_version(456);

-- เกิดอะไรขึ้นในชั่วโมงที่ผ่านมา (ไว้สืบตอนข้อมูลผิดปกติ)
select at, op, task_id, doc->>'name' as name, changed_by
  from public.tasks_history
 where at > now() - interval '1 hour' order by at desc;

-- กู้ทั้ง workspace จาก snapshot
select id, at, note, n_tasks from public.backups order by at desc;
select public.restore_backup(123);

-- ถ่ายสำเนาเดี๋ยวนี้ (ทำก่อนจะแก้อะไรเสี่ยงๆ)
select public.make_backup('ก่อนแก้ระบบ');
```

---

## 📊 เชื่อมกับ Google Sheet

โฟลเดอร์ `sheet-sync/` — ทุกครั้งที่มีคนเพิ่ม/แก้/ลบงานในเว็บ ข้อมูลจะขึ้นแท็บ **Sync**
ใน Google Sheet ภายใน 2-5 วินาที พร้อม dropdown ที่ดึงตัวเลือกมาจากหน้าเว็บโดยตรง

ทำ `8-sheet-webapp.gs.txt` ก่อน แล้วค่อย `7-sheet-push.sql` (ขั้นตอนอยู่หัวไฟล์)

**ยังไม่ได้ติดตั้ง** — เป็นงานที่เตรียมไว้รอทำ

---

## 💾 ข้อมูลที่กู้กลับมา (11 ส.ค. 2026)

`recovered-data/pawdy-RESCUED-final.json` — 48 งาน · Links 11 · คอมเมนต์ 28
กู้มาจากไฟล์ LevelDB ของ Chrome + Opera หลังข้อมูลถูกลบจากบั๊กในระบบ routing

`recovered-data/pawdy-rebuild-v2.json` — ชุดสำรองที่สร้างจากประวัติแจ้งเตือน (ด้อยกว่า เก็บไว้เผื่อ)

เอาไฟล์พวกนี้เข้า `tools/pawdy-restore.html` เพื่อกู้กลับขึ้นเซิร์ฟเวอร์

---

## ⚙️ ค่าที่ต้องใช้บ่อย

| อะไร | ค่า |
|---|---|
| Supabase URL | `https://zkdhwgulkwzxajinqsis.supabase.co` |
| anon key | อยู่ใน `web/index.html` บรรทัดบนๆ ก้อน `PAWDY_CONFIG` |
| SQL Editor | supabase.com/dashboard/project/zkdhwgulkwzxajinqsis/sql |
| GitHub backup | github.com/Thappasorn/pawdy-backup |

---

## 📝 สิ่งที่ทำไปเมื่อ 10-11 ส.ค. 2026

- ยกเครื่องหน้ารายละเอียด task เป็นแบบ Trello (cover, 2 คอลัมน์, checklist มี progress, เมนู ⋯)
- ใส่ URL ให้ทุกการกด — list / view / task / subtask copy ลิงก์ไปแชร์ได้
- เปลี่ยนโลโก้เว็บ + ไอคอนแอปเป็นโลโก้ Pawdy
- Calendar: คลิกพื้นที่ว่างในช่องวัน = ได้งานใหม่ + เปิดการ์ดทันที
- Table: เพิ่มปุ่มเรียง 4 แบบ + ปุ่มลาก ⠿ ย้ายลำดับ task และ subtask
- **แก้บั๊กที่ทำข้อมูลหาย** — โค้ด routing เผลอบันทึกทับก่อนโหลดข้อมูลเสร็จ
  ตอนนี้ระบบซิงก์ห้ามเขียนขึ้นเซิร์ฟเวอร์ก่อนอ่านของจริงมาครบ
- กู้ข้อมูลที่หายกลับมาครบ
- วางระบบสำรองข้อมูล 4 ชั้น
