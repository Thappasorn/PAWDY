#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ตัวอ่าน LevelDB แบบดิบ — อ่านทุกเรคอร์ดที่ยังเหลืออยู่ในไฟล์
รวมค่าที่ถูกเขียนทับไปแล้ว (LevelDB ไม่ลบทันที แค่ทับด้วยเวอร์ชันใหม่)

รองรับทั้ง .ldb/.sst (บีบอัด Snappy) และ .log (write-ahead log ไม่บีบอัด)
"""
import struct, sys, os, glob, json

try:
    import snappy
except ImportError:
    snappy = None


# ---------- varint ----------
def uvarint(buf, i):
    r = s = 0
    while True:
        b = buf[i]; i += 1
        r |= (b & 0x7F) << s
        if not (b & 0x80):
            return r, i
        s += 7


# ---------- SST (.ldb) ----------
def parse_block(block):
    """คืน list ของ (key, value) จาก data block หนึ่งก้อน"""
    out = []
    if len(block) < 4:
        return out
    n_restarts = struct.unpack('<I', block[-4:])[0]
    if n_restarts > 100000:
        return out
    end = len(block) - 4 - n_restarts * 4
    if end <= 0:
        return out
    i, last = 0, b''
    while i < end:
        try:
            shared, i = uvarint(block, i)
            non_shared, i = uvarint(block, i)
            vlen, i = uvarint(block, i)
        except (IndexError, ValueError):
            break
        if shared > len(last) or i + non_shared + vlen > len(block):
            break
        key = last[:shared] + block[i:i + non_shared]
        i += non_shared
        val = block[i:i + vlen]
        i += vlen
        last = key
        out.append((key, val))
    return out


def read_sst(path):
    raw = open(path, 'rb').read()
    recs = []
    # กวาดหา block ทุกก้อนแบบตรงไปตรงมา: ไล่ทีละ offset ที่เป็นไปได้จาก index
    # แต่ถ้า footer เพี้ยน ก็ยังใช้วิธี brute force ต่อได้
    handles = []
    try:
        footer = raw[-48:]
        if footer[-8:] == b'\x57\xfb\x80\x8b\x24\x75\x47\xdb':
            i = 0
            _, i = uvarint(footer, i)      # metaindex offset
            _, i = uvarint(footer, i)      # metaindex size
            io_, i = uvarint(footer, i)    # index offset
            is_, i = uvarint(footer, i)    # index size
            idx = decompress_block(raw, io_, is_)
            for k, v in parse_block(idx):
                j = 0
                off, j = uvarint(v, j)
                sz, j = uvarint(v, j)
                handles.append((off, sz))
    except Exception:
        pass

    for off, sz in handles:
        try:
            blk = decompress_block(raw, off, sz)
        except Exception:
            continue
        recs.extend(parse_block(blk))

    # เผื่อ footer พัง — ลองไล่ทุกจุดที่น่าจะเป็นก้อนบีบอัด
    if not recs and snappy:
        pos = 0
        while pos < len(raw) - 8:
            try:
                blk = snappy.uncompress(raw[pos:pos + 65536])
                recs.extend(parse_block(blk))
                pos += 1024
            except Exception:
                pos += 1
    return recs


def decompress_block(raw, off, size):
    blk = raw[off:off + size]
    ctype = raw[off + size]
    if ctype == 0:
        return blk
    if ctype == 1:
        if not snappy:
            raise RuntimeError('ต้องติดตั้ง python-snappy')
        return snappy.uncompress(blk)
    raise ValueError('compression %d ไม่รองรับ' % ctype)


# ---------- write-ahead log (.log) ----------
def read_log(path):
    raw = open(path, 'rb').read()
    recs, pos, pending = [], 0, b''
    while pos + 7 <= len(raw):
        length = struct.unpack('<H', raw[pos + 4:pos + 6])[0]
        rtype = raw[pos + 6]
        payload = raw[pos + 7:pos + 7 + length]
        pos += 7 + length
        if rtype in (1, 4):                    # FULL / LAST
            batch = pending + payload if rtype == 4 else payload
            pending = b''
            recs.extend(parse_batch(batch))
        elif rtype == 2:                       # FIRST
            pending = payload
        elif rtype == 3:                       # MIDDLE
            pending += payload
        if length == 0:
            pos = (pos // 32768 + 1) * 32768   # ข้ามไปบล็อกถัดไป
    return recs


def parse_batch(b):
    out = []
    if len(b) < 12:
        return out
    i = 12
    while i < len(b):
        try:
            t = b[i]; i += 1
            if t == 1:                          # put
                kl, i = uvarint(b, i); k = b[i:i + kl]; i += kl
                vl, i = uvarint(b, i); v = b[i:i + vl]; i += vl
                out.append((k + b'\x00' * 8, v))
            elif t == 0:                        # delete
                kl, i = uvarint(b, i); i += kl
            else:
                break
        except (IndexError, ValueError):
            break
    return out


# ---------- Chrome Local Storage ----------
def decode_value(v):
    if not v:
        return ''
    if v[0] == 0:
        return v[1:].decode('utf-16-le', errors='replace')
    if v[0] == 1:
        return v[1:].decode('latin-1', errors='replace')
    return v.decode('utf-8', errors='replace')


def decode_key(k):
    k = k[:-8] if len(k) > 8 else k             # ตัด internal key suffix
    if k.startswith(b'META:'):
        return 'META:' + k[5:].decode('utf-8', errors='replace'), None
    if k.startswith(b'_') and b'\x00\x01' in k:
        origin, rest = k[1:].split(b'\x00\x01', 1)
        try:
            name = rest.decode('utf-16-le') if len(rest) % 2 == 0 and b'\x00' in rest else rest.decode('utf-8', errors='replace')
        except Exception:
            name = rest.decode('utf-8', errors='replace')
        return origin.decode('utf-8', errors='replace'), name
    return k.decode('utf-8', errors='replace'), None


def scan(paths):
    out = []
    for p in paths:
        try:
            recs = read_log(p) if p.endswith('.log') else read_sst(p)
        except Exception as e:
            print('  ! %s: %s' % (os.path.basename(p), e))
            continue
        n = 0
        for k, v in recs:
            try:
                origin, name = decode_key(k)
            except Exception:
                continue
            if name is None:
                continue
            out.append({'file': os.path.basename(p), 'origin': origin, 'key': name, 'value': decode_value(v)})
            n += 1
        print('  %-16s %d เรคอร์ด' % (os.path.basename(p), n))
    return out


if __name__ == '__main__':
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    files = sorted(glob.glob(os.path.join(root, '**', '*.ldb'), recursive=True) +
                   glob.glob(os.path.join(root, '**', '*.log'), recursive=True) +
                   glob.glob(os.path.join(root, '**', '*.sst'), recursive=True))
    print('อ่าน %d ไฟล์' % len(files))
    rows = scan(files)
    hits = [r for r in rows if 'pawdy' in (r['origin'] + r['key']).lower()]
    print('\nเรคอร์ดที่เกี่ยวกับ Pawdy: %d' % len(hits))
    for r in hits:
        print('  [%s] %s | %s | %d ตัวอักษร' % (r['file'], r['origin'][:46], r['key'][:36], len(r['value'])))
    json.dump(rows, open('_ls_dump.json', 'w', encoding='utf-8'), ensure_ascii=False)
