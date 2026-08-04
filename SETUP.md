# Pawdy Workspace — ติดตั้งให้ทีมใช้จริง (5 คน)

ใช้เวลาประมาณ 20 นาที ทำครั้งเดียวจบ

---

## ขั้น 1 — สร้างฐานข้อมูล (5 นาที)

1. เข้า [supabase.com](https://supabase.com) → **New project** (Region เลือก **Southeast Asia (Singapore)** จะเร็วที่สุดจากไทย)
2. เปิด **SQL Editor → New query**
3. เปิดไฟล์ `schema.sql` → ก่อน copy ให้แก้บล็อกท้ายไฟล์ตรง `insert into public.members` เป็นอีเมลกับชื่อจริงของทีม 5 คน
4. วางทั้งไฟล์ → **Run**

ถ้าบรรทัด `alter publication supabase_realtime ...` ขึ้น error ว่า table มีอยู่แล้ว ข้ามได้เลย ไม่กระทบอะไร

---

## ขั้น 2 — สร้างบัญชีให้ทีม (5 นาที)

ระบบใช้ **อีเมล + รหัสผ่าน** ไม่มี magic link เพราะอีเมลในตัวของ Supabase จำกัดแค่ไม่กี่ฉบับต่อชั่วโมง

1. **Authentication → Users → Add user** → ใส่อีเมล + รหัสผ่าน → ติ๊ก **Auto Confirm User**
2. ทำซ้ำจนครบ 5 คน (อีเมลต้องตรงกับที่ใส่ใน `members` เป๊ะๆ ตัวพิมพ์เล็กทั้งหมด)
3. **Authentication → Sign In / Providers → Email** → ปิด **Allow new users to sign up**

ข้อ 3 สำคัญ ถ้าไม่ปิด คนนอกสมัครบัญชีเองได้ (ถึงจะยังเข้าข้อมูลไม่ได้เพราะไม่มีชื่อใน `members` ก็ตาม)

---

## ขั้น 3 — ใส่ค่าเชื่อมต่อในไฟล์ (2 นาที)

Supabase → **Project Settings → API** → copy 2 ค่า แล้วเปิด `index.html` ด้วย text editor แก้บรรทัดบนสุด:

```js
window.PAWDY_CONFIG = {
  url:     'https://xxxxxxxx.supabase.co',   // Project URL
  anonKey: 'eyJhbGci...'                     // anon public key
};
```

anon key ใส่ในไฟล์ได้ปลอดภัย ทุกตารางเปิด Row Level Security ไว้ ใครไม่มีชื่อใน `members` อ่านหรือเขียนอะไรไม่ได้เลยแม้จะมี key

---

## ขั้น 4 — เอาขึ้นออนไลน์ (3 นาที)

| วิธี | ขั้นตอน |
|---|---|
| **Netlify Drop** | app.netlify.com/drop → ลาก `index.html` ลงไป → ได้ URL ทันที |
| Cloudflare Pages | Create project → Upload assets |
| Vercel | `vercel` ในโฟลเดอร์ที่มีไฟล์ |

แนะนำตั้ง custom domain เช่น `work.pawdy.co.th` แล้วส่งลิงก์เดียวให้ทีม เวลาแก้ไฟล์ทีหลังก็ลากทับใหม่ URL เดิม

---

## ใช้งานยังไง

- เปิดลิงก์ → หน้า sign in → ใส่อีเมล + รหัสผ่าน (จำ session ไว้ ไม่ต้องล็อกอินทุกครั้ง)
- แก้อะไรก็ตาม — สถานะ, ผู้รับผิดชอบ, วันครบกำหนด, คอมเมนต์ — คนอื่นที่เปิดค้างไว้จะเห็นภายใน 1 วินาที
- เปลี่ยน assignee / status / due date / priority → คนที่รับผิดชอบงานนั้นได้แจ้งเตือนในกระดิ่ง ✉ ของตัวเอง
- มุมซ้ายล่างมีปุ่ม Sign out
- View (Table / Board / Calendar / Timeline / Dashboard) และ list ที่เลือกค้างไว้ เป็นค่าส่วนตัวของแต่ละคน ไม่กวนกัน

---

## ข้อจำกัดที่ควรรู้ก่อนใช้จริง

**แจ้งเตือนไม่ได้ส่งเข้าอีเมลจริง** — เป็นกล่องข้อความในแอป ถ้าอยากให้เข้าอีเมล/LINE จริง ต้องเพิ่ม Supabase Edge Function + Resend (หรือ LINE Messaging API) บอกได้ถ้าจะทำเพิ่ม

**แนบไฟล์ยังเป็นแค่ชื่อไฟล์** — ยังอัปโหลดจริงไม่ได้ ถ้าต้องใช้ ต้องต่อ Supabase Storage เพิ่ม

**แก้ช่องเดียวกันพร้อมกัน** — คนแก้ทีหลังชนะ ระบบกัน 4 วินาทีแรกหลังคุณพิมพ์ไม่ให้ข้อมูลจากคนอื่นมาทับ แต่ถ้าสองคนแก้ task เดียวกันจริงๆ จะเหลือค่าล่าสุดค่าเดียว สำหรับทีม 5 คนแทบไม่เจอ

**ปุ่ม + Add member by email ในแอป** เพิ่มได้แค่ "ชื่อผู้รับผิดชอบ" เท่านั้น คนนั้นยังล็อกอินไม่ได้จนกว่าจะสร้างบัญชีใน Authentication → Users ให้ด้วย

**สำรองข้อมูล** — Supabase free tier มี backup 7 วัน ถ้าข้อมูลเริ่มสำคัญ แนะนำอัปเป็น Pro หรือ export ตาราง `tasks` เป็น CSV เดือนละครั้ง

**Free tier จะ pause ถ้าไม่มีใครใช้ 7 วัน** — กดปลุกใน dashboard ได้ ข้อมูลไม่หาย แต่ถ้าใช้เป็นเครื่องมือหลักของทีม ค่า Pro $25/เดือนคุ้มกว่าต้องมานั่งปลุก

---

## แก้ทีหลัง

- **เพิ่ม/ลบคน** — Authentication → Users (บัญชี) + ตาราง `members` (ชื่อที่โชว์)
- **รีเซ็ตรหัสผ่านให้ทีม** — Authentication → Users → คลิกคน → Reset password
- **ล้างข้อมูลเริ่มใหม่** — SQL Editor: `delete from public.tasks;`
- **ดูข้อมูลดิบ** — Table Editor → `tasks` (แต่ละแถวคือ 1 task, เนื้อหาอยู่ในคอลัมน์ `doc`)
