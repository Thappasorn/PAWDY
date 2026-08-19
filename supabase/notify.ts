// ============================================================
//  Pawdy Workspace — Edge Function 'notify'
//  ส่งอีเมลแจ้งเตือนจริงเมื่อมีการแก้ไข task
//
//  Deploy:  Supabase Dashboard → Edge Functions → Deploy a new function
//           ตั้งชื่อ  notify   แล้ววางไฟล์นี้ทั้งไฟล์
//
//  ── ทางที่ 1 (แนะนำ ไม่ต้องมี domain): ส่งผ่าน Gmail ──
//  Secrets ที่ต้องตั้ง (Edge Functions → Secrets):
//    GMAIL_USER         = yourname@gmail.com
//    GMAIL_APP_PASSWORD = xxxxxxxxxxxxxxxx      (App Password 16 ตัว ไม่ใช่รหัสเข้า Gmail)
//    APP_URL            = https://xxxx.vercel.app        (ไม่ใส่ก็ได้)
//    MAIL_FROM_NAME     = Pawdy Workspace                (ไม่ใส่ก็ได้)
//
//  ── ทางที่ 2: ส่งผ่าน Resend (ต้อง verify domain ก่อนถึงส่งหาคนอื่นได้) ──
//    RESEND_API_KEY = re_xxxxxxxx
//    MAIL_FROM      = Pawdy Workspace <workspace@pawdy.co.th>
//
//  ถ้าตั้ง GMAIL_USER ไว้ จะใช้ Gmail ก่อนเสมอ
// ============================================================

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function esc(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const GMAIL_USER = Deno.env.get("GMAIL_USER")?.trim();
  // App Password ที่ Google โชว์มีเว้นวรรค ต้องตัดออกก่อนใช้
  const GMAIL_PASS = Deno.env.get("GMAIL_APP_PASSWORD")?.replace(/\s+/g, "");
  const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
  const FROM_NAME = Deno.env.get("MAIL_FROM_NAME") ?? "Pawdy Workspace";
  const RESEND_FROM = Deno.env.get("MAIL_FROM") ?? "Pawdy Workspace <onboarding@resend.dev>";
  const APP_URL = Deno.env.get("APP_URL") ?? "";
  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

  const useGmail = !!(GMAIL_USER && GMAIL_PASS);
  if (!useGmail && !RESEND_KEY) {
    return json({ error: "ยังไม่ได้ตั้ง secret — ต้องมี GMAIL_USER + GMAIL_APP_PASSWORD หรือ RESEND_API_KEY" }, 500);
  }

  // ---- ผู้เรียกต้องเป็นสมาชิกที่ล็อกอินอยู่จริง ----
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "ไม่ได้ล็อกอิน" }, 401);

  const userRes = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: SB_ANON },
  });
  if (!userRes.ok) return json({ error: "token ใช้ไม่ได้" }, 401);
  const user = await userRes.json();
  const callerEmail = String(user?.email ?? "").toLowerCase();
  if (!callerEmail) return json({ error: "ไม่พบอีเมลผู้เรียก" }, 401);

  let payload: Record<string, string> = {};
  try {
    payload = await req.json();
  } catch {
    return json({ error: "body ไม่ใช่ JSON" }, 400);
  }

  // ลดสัญญาณรบกวน: อีเมลอัตโนมัติอนุญาตเฉพาะมอบหมาย, @mention และเปลี่ยน Status
  // `test` สงวนไว้สำหรับปุ่มทดสอบอีเมลของ admin เท่านั้น
  const kind = String(payload.kind ?? "").toLowerCase().trim();
  if (!["assign", "mention", "status", "test"].includes(kind)) {
    return json({ skipped: "เหตุการณ์นี้ไม่อยู่ในกฎอีเมลแจ้งเตือน" });
  }

  const to = String(payload.to ?? "").toLowerCase().trim();
  if (!to || !to.includes("@")) return json({ error: "ไม่มีอีเมลผู้รับ" }, 400);
  if (to === callerEmail) return json({ skipped: "ไม่ส่งอีเมลหาตัวเอง" });

  // ---- ผู้รับต้องอยู่ในตาราง members (กันเอาไปยิงอีเมลคนนอก) ----
  const memRes = await fetch(
    `${SB_URL}/rest/v1/members?email=eq.${encodeURIComponent(to)}&select=email,name`,
    { headers: { Authorization: auth, apikey: SB_ANON } },
  );
  const members = memRes.ok ? await memRes.json() : [];
  if (!Array.isArray(members) || members.length === 0) {
    return json({ skipped: "ผู้รับไม่ได้อยู่ในทีม" });
  }

  // ---- ประกอบอีเมล ----
  const toName = payload.toName || members[0]?.name || to;
  const fromName = payload.fromName || "someone";
  const subject = payload.subject || "Pawdy Workspace";
  const line = payload.line || "";
  const detail = payload.detail || "";

  const button = APP_URL
    ? `<a href="${esc(APP_URL)}" style="display:inline-block;background:#4f46e5;color:#ffffff;` +
      `text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px">` +
      `เปิด Workspace</a>`
    : "";

  const html = `<!doctype html>
<html lang="th"><body style="margin:0;padding:24px;background:#f7f8fa;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Sarabun',Tahoma,sans-serif;color:#1f2430">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
    <div style="padding:16px 20px;border-bottom:1px solid #f3f4f6">
      <span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;
        border-radius:7px;background:#4f46e5;color:#ffffff;font-weight:700;font-size:12px">PW</span>
      <span style="font-size:13px;font-weight:600;margin-left:8px;vertical-align:middle">Pawdy Workspace</span>
    </div>
    <div style="padding:20px">
      <p style="margin:0 0 6px;font-size:12px;color:#6b7280">สวัสดี ${esc(toName)}</p>
      <p style="margin:0 0 14px;font-size:15px;font-weight:600;line-height:1.45">${esc(subject)}</p>
      <p style="margin:0 0 4px;font-size:14px;color:#4f46e5;font-weight:600">${esc(line)}</p>
      <p style="margin:0 0 18px;font-size:12.5px;color:#6b7280;line-height:1.6">${esc(detail)}</p>
      ${button}
      <p style="margin:18px 0 0;font-size:11px;color:#9ca3af">
        อัปเดตโดย ${esc(fromName)} · อีเมลนี้ส่งอัตโนมัติจาก Pawdy Workspace
      </p>
    </div>
  </div>
</body></html>`;

  const text = [
    `สวัสดี ${toName}`,
    "",
    subject,
    line,
    detail,
    "",
    APP_URL ? `เปิด Workspace: ${APP_URL}` : "",
    `อัปเดตโดย ${fromName}`,
  ].filter(Boolean).join("\n");

  const fullSubject = `[Pawdy] ${subject}`;

  // ---- ทางที่ 1: Gmail SMTP ----
  if (useGmail) {
    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: { username: GMAIL_USER!, password: GMAIL_PASS! },
      },
    });
    try {
      await client.send({
        from: `${FROM_NAME} <${GMAIL_USER}>`,
        to,
        replyTo: callerEmail,
        subject: fullSubject,
        content: text,
        html,
      });
      return json({ sent: true, via: "gmail", to });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 535 = user/app password ผิด, 534 = ต้องใช้ App Password ไม่ใช่รหัสปกติ
      return json({ error: "Gmail ส่งไม่สำเร็จ", detail: msg }, 502);
    } finally {
      try { await client.close(); } catch { /* ปิดไม่ได้ก็ไม่เป็นไร */ }
    }
  }

  // ---- ทางที่ 2: Resend ----
  const send = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      subject: fullSubject,
      html,
      text,
      reply_to: callerEmail,
    }),
  });
  const result = await send.text();
  if (!send.ok) return json({ error: "Resend ปฏิเสธ", status: send.status, result }, 502);
  return json({ sent: true, via: "resend", to, result: JSON.parse(result || "{}") });
});
