#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pawdy — กู้ข้อมูลจากไฟล์ LevelDB ของเบราว์เซอร์

หลักการ:
  Chrome/Edge เก็บ localStorage เป็น LevelDB ซึ่งเป็นฐานข้อมูลแบบ "เขียนต่อท้าย"
  เวลาค่าถูกเขียนทับ ของเก่าจะยังนอนอยู่ในไฟล์ .log / .ldb จนกว่าจะโดน compaction
  สคริปต์นี้กวาดทุกไบต์ในโฟลเดอร์ หาก้อน JSON ของ Pawdy ที่ยังเหลืออยู่

ใช้ยังไง:
  python3 pawdy-leveldb-rescue.py "/path/to/Local Storage/leveldb"
  python3 pawdy-leveldb-rescue.py ~/pawdy-leveldb-copy      # โฟลเดอร์ที่ก๊อปมา

ผลลัพธ์:
  สร้างไฟล์ pawdy-rescued-<n>.json ให้ทุกก้อนที่กู้ได้ เรียงจากก้อนที่มีของเยอะสุด
"""

import sys, os, re, json, glob

MARKERS = ['"links"', '"tasks"', 'pawdy.workspace.cache']


def decodings(raw):
    """คืนสตริงที่ถอดรหัสได้หลายแบบ — Chrome เก็บ localStorage เป็น UTF-16LE
       (ค่าที่มีภาษาไทย) หรือ Latin-1 (ค่าที่เป็น ASCII ล้วน)"""
    out = []
    for off in (0, 1):
        try:
            out.append(raw[off:].decode('utf-16-le', errors='ignore'))
        except Exception:
            pass
    try:
        out.append(raw.decode('utf-8', errors='ignore'))
    except Exception:
        pass
    try:
        out.append(raw.decode('latin-1', errors='ignore'))
    except Exception:
        pass
    return out


def carve(text, start_idx, opener, closer):
    """ตัดก้อน JSON ที่วงเล็บครบคู่ ออกมาจากตำแหน่งที่กำหนด"""
    depth, in_str, esc = 0, False, False
    for i in range(start_idx, min(len(text), start_idx + 6_000_000)):
        c = text[i]
        if in_str:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == opener:
            depth += 1
        elif c == closer:
            depth -= 1
            if depth == 0:
                return text[start_idx:i + 1]
    return None


def find_objects(text, found):
    # 1) ก้อน cache ทั้งชุด — มีทั้ง tasks / links / docs
    for m in re.finditer(r'\{"tasks":', text):
        blob = carve(text, m.start(), '{', '}')
        if not blob:
            continue
        try:
            d = json.loads(blob)
        except Exception:
            continue
        if isinstance(d, dict):
            found.append(('cache', d))

    # 2) เฉพาะอาเรย์ links ที่หลุดออกมาเดี่ยวๆ
    for m in re.finditer(r'"links":\s*\[', text):
        blob = carve(text, m.end() - 1, '[', ']')
        if not blob:
            continue
        try:
            arr = json.loads(blob)
        except Exception:
            continue
        if isinstance(arr, list) and arr:
            found.append(('links', arr))

    # 3) รายการลิงก์เดี่ยวๆ ที่หลงเหลือ (เผื่ออาเรย์ขาด)
    for m in re.finditer(r'\{\s*"id"\s*:\s*"L[0-9a-z]{6,}"', text):
        blob = carve(text, m.start(), '{', '}')
        if not blob:
            continue
        try:
            d = json.loads(blob)
        except Exception:
            continue
        if isinstance(d, dict) and d.get('url'):
            found.append(('link1', d))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    root = os.path.expanduser(sys.argv[1])
    if not os.path.exists(root):
        print('ไม่พบโฟลเดอร์:', root)
        sys.exit(1)

    files = []
    if os.path.isfile(root):
        files = [root]
    else:
        for pat in ('**/*.ldb', '**/*.log', '**/*.sst', '**/MANIFEST*', '**/CURRENT',
                    '**/*.localstorage', '**/*.sqlite', '**/*.db'):
            files += glob.glob(os.path.join(root, pat), recursive=True)
        files = sorted(set(files))

    if not files:
        print('ไม่เจอไฟล์ฐานข้อมูลในโฟลเดอร์นี้')
        sys.exit(1)

    print('กำลังกวาด %d ไฟล์…\n' % len(files))
    found = []
    for f in files:
        try:
            raw = open(f, 'rb').read()
        except Exception as e:
            print('  ข้าม %s (%s)' % (os.path.basename(f), e))
            continue
        if not any(mk.encode('utf-8') in raw or mk.encode('utf-16-le') in raw for mk in MARKERS):
            continue
        n_before = len(found)
        for text in decodings(raw):
            find_objects(text, found)
        print('  %-34s เจอ %d ก้อน' % (os.path.basename(f), len(found) - n_before))

    # ---- รวมผล ----
    caches, link_arrays, singles = [], [], {}
    for kind, d in found:
        if kind == 'cache':
            caches.append(d)
        elif kind == 'links':
            link_arrays.append(d)
        elif kind == 'link1':
            singles[d.get('id') or d.get('url')] = d

    for c in caches:
        if isinstance(c.get('links'), list) and c['links']:
            link_arrays.append(c['links'])
        for l in (c.get('links') or []):
            if isinstance(l, dict) and l.get('url'):
                singles[l.get('id') or l['url']] = l

    # เอาอาเรย์ links ที่ยาวที่สุดเป็นตัวหลัก แล้วเติมรายการเดี่ยวที่ยังขาด
    best_links = max(link_arrays, key=len) if link_arrays else []
    have = {l.get('id') or l.get('url') for l in best_links if isinstance(l, dict)}
    for k, l in singles.items():
        if k not in have:
            best_links.append(l)

    caches.sort(key=lambda c: len(c.get('tasks') or []), reverse=True)

    print('\n' + '=' * 62)
    print('ผลการกู้')
    print('=' * 62)
    print('  ก้อน cache ที่เจอ      : %d' % len(caches))
    if caches:
        print('  ก้อนที่งานเยอะสุด      : %d งาน' % len(caches[0].get('tasks') or []))
    print('  ลิงก์ที่กู้ได้ทั้งหมด    : %d รายการ' % len(best_links))

    outs = []
    if best_links:
        payload = {'at': 'rescued-from-leveldb', 'links': best_links}
        if caches and (caches[0].get('tasks') or []):
            payload['tasks'] = caches[0]['tasks']
            for k in ('spaces', 'fields', 'config', 'docs', 'planner'):
                if caches[0].get(k):
                    payload[k] = caches[0][k]
        with open('pawdy-rescued-best.json', 'w', encoding='utf-8') as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=1)
        outs.append('pawdy-rescued-best.json')
        print('\n  ลิงก์ที่กู้ได้:')
        for l in best_links[:40]:
            print('    · %-28s %s' % (str(l.get('title'))[:26], str(l.get('url'))[:60]))

    for i, c in enumerate(caches[:5]):
        name = 'pawdy-rescued-cache-%d.json' % (i + 1)
        with open(name, 'w', encoding='utf-8') as fh:
            json.dump(c, fh, ensure_ascii=False, indent=1)
        outs.append(name)

    if outs:
        print('\n  สร้างไฟล์: ' + ', '.join(outs))
        print('  เอาไฟล์ pawdy-rescued-best.json ไปใส่ pawdy-restore.html ได้เลย')
    else:
        print('\n  ไม่เจอข้อมูลในโฟลเดอร์นี้ — ลองเบราว์เซอร์อื่น / เครื่องอื่น')


if __name__ == '__main__':
    main()
