#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pawdy Workspace — ชั้นที่ 2b: สำรองข้อมูลขึ้น GitHub (private repo)

ดึงงานทั้งหมด + meta จาก Supabase มาเขียนเป็นไฟล์ในโฟลเดอร์ backups/
แล้วให้ GitHub Actions commit ให้อัตโนมัติ — ได้ประวัติย้อนหลังทุกเวอร์ชัน

ตัวแปรที่ต้องตั้งเป็น Repository secrets:
  SUPABASE_URL · SUPABASE_ANON_KEY · PAWDY_EMAIL · PAWDY_PASSWORD
"""
import json, os, sys, urllib.request, urllib.error, datetime

URL   = os.environ['SUPABASE_URL'].rstrip('/')
KEY   = os.environ['SUPABASE_ANON_KEY']
EMAIL = os.environ['PAWDY_EMAIL']
PASS  = os.environ['PAWDY_PASSWORD']


def req(path, method='GET', body=None, token=None):
    headers = {'apikey': KEY, 'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(URL + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return json.loads(resp.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        raise SystemExit('เรียก %s ไม่สำเร็จ (%s): %s' % (path, e.code, e.read().decode()[:400]))


def sign_in():
    j = req('/auth/v1/token?grant_type=password', 'POST', {'email': EMAIL, 'password': PASS})
    if not j or not j.get('access_token'):
        raise SystemExit('เข้าสู่ระบบไม่สำเร็จ — เช็ค PAWDY_EMAIL / PAWDY_PASSWORD')
    return j['access_token']


def fetch_all(token, table, select):
    out, size = [], 1000
    off = 0
    while True:
        rows = req('/rest/v1/%s?select=%s&limit=%d&offset=%d' % (table, select, size, off), token=token)
        out += rows or []
        if not rows or len(rows) < size:
            return out
        off += size


def main():
    token = sign_in()
    tasks = [r['doc'] for r in fetch_all(token, 'tasks', 'id,doc,created_at') if r.get('doc')]
    meta = {m['key']: m['doc'] for m in fetch_all(token, 'meta', 'key,doc')}

    # กันเก็บสำเนาว่าง — ถ้าไม่มีงานเลยแปลว่าผิดปกติ ให้ job แดงไว้จะได้รู้ตัว
    if not tasks:
        raise SystemExit('ยกเลิก: ดึงข้อมูลมาแล้วไม่มีงานเลย — ควรเข้าไปตรวจสอบด่วน')

    payload = {
        'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source': 'github-actions',
        'tasks': tasks,
        'links': meta.get('links') or [],
        'spaces': meta.get('spaces'),
        'fields': meta.get('fields'),
        'config': meta.get('config'),
        'docs': meta.get('docs'),
        'planner': meta.get('planner'),
    }

    os.makedirs('backups', exist_ok=True)
    day = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')
    text = json.dumps(payload, ensure_ascii=False, indent=1)

    # latest.json = ตัวล่าสุดเสมอ (git จะเก็บประวัติทุกเวอร์ชันให้เอง)
    for path in ('backups/latest.json', 'backups/pawdy-%s.json' % day):
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text)

    print('สำรองแล้ว — งาน %d ชิ้น · links %d รายการ · docs %d'
          % (len(tasks), len(payload['links']), len(payload.get('docs') or [])))


if __name__ == '__main__':
    main()
