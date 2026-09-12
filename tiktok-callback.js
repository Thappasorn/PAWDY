'use strict';

// One-time administrator setup only. Scheduled reports run in private Apps Script.
const CALLBACK = 'https://pawdycontent.vercel.app/tiktok-callback.html';
const PENDING_KEY = 'pawdy.tiktok.pending';
const MAX_AGE = 60 * 60 * 1000;

function authorizationLink(raw, state) {
  const url = new URL(raw);
  const approvedRoutes = [
    'https://business-api.tiktok.com/portal/auth',
    'https://ads.tiktok.com/marketing_api/auth',
    'https://www.tiktok.com/v2/auth/authorize'
  ];
  if (url.username || url.password || url.hash || !approvedRoutes.includes(url.origin + url.pathname.replace(/\/$/, ''))) {
    throw new Error('กรุณาใช้ลิงก์อนุญาตจากหน้าแอป TikTok โดยตรง');
  }
  const redirects = ['redirect_uri', 'redirect_url'].filter(key => url.searchParams.has(key));
  if (redirects.length !== 1 || url.searchParams.getAll(redirects[0]).length !== 1 || url.searchParams.get(redirects[0]) !== CALLBACK) {
    throw new Error('ลิงก์นี้ใช้หน้ารับผลไม่ตรงกับ Pawdy กรุณาตั้ง Redirect URL ให้ตรงก่อน');
  }
  for (const key of ['access_token', 'refresh_token', 'client_secret', 'secret', 'auth_code', 'code']) {
    if (url.searchParams.has(key)) throw new Error('ช่องนี้รับเฉพาะลิงก์อนุญาต ไม่รับรหัสลับหรือโทเคน');
  }
  url.searchParams.set('state', state);
  return url.href;
}

function acceptCallback(params, pending, now) {
  if (!pending || typeof pending.state !== 'string' || !/^[a-f0-9]{64}$/.test(pending.state) ||
      !Number.isFinite(pending.at) || now < pending.at || now - pending.at > MAX_AGE ||
      params.getAll('state').length !== 1 || params.get('state') !== pending.state) {
    throw new Error('ยืนยันที่มาของการเชื่อมต่อไม่ได้ หรือหมดเวลาแล้ว กรุณาเริ่มใหม่จากหน้านี้ในแท็บเดิม');
  }
  if (params.has('error')) throw new Error('TikTok ไม่ได้อนุญาตการเชื่อมต่อ กรุณาเริ่มใหม่เมื่อต้องการเชื่อมต่อ');
  const keys = ['auth_code', 'code'].filter(key => params.has(key));
  if (keys.length !== 1 || params.getAll(keys[0]).length !== 1) {
    throw new Error('ไม่ได้รับรหัสอนุญาตที่ถูกต้องจาก TikTok (พารามิเตอร์ที่ได้รับ: ' + receivedParameterNames_(params) + ')');
  }
  const code = params.get(keys[0]);
  if (!code || code.length > 4096 || /[\s\x00-\x1f\x7f]/.test(code)) throw new Error('รูปแบบรหัสอนุญาตไม่ถูกต้อง กรุณาเริ่มใหม่');
  return code;
}

function receivedParameterNames_(params) {
  const names = [...new Set(Array.from(params.keys()).map(key => String(key)
    .replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64)).filter(Boolean))];
  return names.length ? names.slice(0, 20).join(', ') : 'ไม่มี';
}

if (typeof module !== 'undefined') module.exports = { authorizationLink, acceptCallback, CALLBACK, MAX_AGE, receivedParameterNames_ };

if (typeof document !== 'undefined') {
  const returned = new URLSearchParams(location.search);
  // Remove authorization data before displaying anything or navigating elsewhere.
  history.replaceState(null, '', location.pathname);
  // Upgrade an existing Workspace worker so older versions cannot cache this page as '/'.
  if (navigator.serviceWorker) navigator.serviceWorker.getRegistration().then(reg => reg && reg.update()).catch(() => {});
  const status = document.getElementById('status');
  const form = document.getElementById('connect');
  const codeBox = document.getElementById('authorization-code');
  if (returned.size) {
    try {
      const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
      sessionStorage.removeItem(PENDING_KEY);
      codeBox.value = acceptCallback(returned, pending, Date.now());
      document.getElementById('received').hidden = false;
      form.hidden = true;
      status.textContent = 'รับรหัสอนุญาตแล้ว — ยังต้องยืนยันใน Apps Script ก่อนเริ่มดึงข้อมูล';
    } catch (error) {
      status.textContent = error instanceof SyntaxError ? 'ข้อมูลการเชื่อมต่อไม่ถูกต้อง กรุณาเริ่มใหม่' : error.message;
    }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    try {
      if (location.origin + location.pathname !== CALLBACK) throw new Error('กรุณาเปิดหน้านี้ผ่านเว็บไซต์ pawdycontent.vercel.app');
      const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
      const url = authorizationLink(document.getElementById('authorization-url').value.trim(), state);
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ state, at: Date.now() }));
      location.assign(url);
    } catch (error) { status.textContent = error.message; }
  });
  document.getElementById('copy-code').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(codeBox.value);
      status.textContent = 'คัดลอกแล้ว กรุณาวางใน Apps Script ส่วนตัวเพื่อดำเนินการต่อ';
    } catch (_) {
      codeBox.focus(); codeBox.select();
      status.textContent = 'กรุณาคัดลอกรหัสจากช่องที่เลือกไว้';
    }
  });
  addEventListener('pagehide', () => { codeBox.value = ''; });
}
