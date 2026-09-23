'use strict';

const BACKEND_CALLBACK = 'https://pawdy-social-listening-production.up.railway.app/api/tiktok/business/callback';
const DASHBOARD = 'https://pawdy-social-listening-production.up.railway.app/';

function cleanValue(value, maxLength) {
  if (typeof value !== 'string') return '';
  const v = value.trim();
  if (!v || v.length > maxLength || /[\x00-\x1f\x7f]/.test(v)) return '';
  return v;
}

function relayTarget(params) {
  const state = cleanValue(params.get('state'), 256);
  const authCode = cleanValue(params.get('auth_code'), 4096);
  const code = cleanValue(params.get('code'), 4096);
  const error = cleanValue(params.get('error'), 256);
  const errorDescription = cleanValue(params.get('error_description'), 1000);

  if (!state || !/^[A-Za-z0-9_-]{20,256}$/.test(state)) {
    throw new Error('ไม่พบ state ที่ถูกต้อง กรุณากลับไปกด Connect TikTok Business จาก Dashboard ใหม่');
  }
  if (!authCode && !code && !error) {
    throw new Error('ไม่พบ authorization code จาก TikTok กรุณาเริ่มเชื่อมต่อใหม่จาก Dashboard');
  }

  const target = new URL(BACKEND_CALLBACK);
  if (authCode) target.searchParams.set('auth_code', authCode);
  else if (code) target.searchParams.set('code', code);
  if (error) target.searchParams.set('error', error);
  if (errorDescription) target.searchParams.set('error_description', errorDescription);
  target.searchParams.set('state', state);
  return target.href;
}

if (typeof module !== 'undefined') module.exports = { relayTarget, BACKEND_CALLBACK, DASHBOARD };

if (typeof document !== 'undefined') {
  const status = document.getElementById('status');
  const params = new URLSearchParams(location.search);

  // Remove the authorization code from browser history immediately.
  history.replaceState(null, '', location.pathname);

  if (!params.size) {
    status.innerHTML = 'หน้านี้เป็น Callback ของ TikTok กรุณาเริ่มจาก <a href="' + DASHBOARD + '">Pawdy Dashboard</a> แล้วกด <b>Connect TikTok Business</b>';
  } else {
    try {
      const target = relayTarget(params);
      status.textContent = 'ตรวจสอบแล้ว กำลังส่งต่อไป Pawdy Social Intelligence…';
      location.replace(target);
    } catch (error) {
      status.textContent = error && error.message ? error.message : 'เชื่อมต่อ TikTok ไม่สำเร็จ กรุณาเริ่มใหม่จาก Dashboard';
    }
  }
}