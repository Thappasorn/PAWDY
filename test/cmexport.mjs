// แปลง doc.comments -> แถวสำหรับแท็บ Comments (ไม่ต้องมี Google)
import { readFileSync } from 'fs';
import assert from 'assert';

const src = readFileSync('5-Export-คอมเมนต์ลงชีต.gs.txt', 'utf8');
// Utilities/SpreadsheetApp ถูกเรียกแค่ในฟังก์ชันที่เราไม่แตะ แต่ cmWhen_ ใช้ -> ใส่ stub ให้
const M = new Function('Utilities', src + ';return{commentRows_,imgUrlsIn_,stripImgUrls_,cmWhen_};')({
  formatDate: (d) => d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear()
});

const PNG = 'https://zk.supabase.co/storage/v1/object/public/task-images/T1/a.png';
const JPG = 'https://zk.supabase.co/storage/v1/object/public/task-images/T1/b.jpg';

// แยกลิงก์รูปออกจากข้อความ
assert.deepStrictEqual(M.imgUrlsIn_('ดูนี่ ' + PNG + ' กับ ' + JPG), [PNG, JPG]);
assert.deepStrictEqual(M.imgUrlsIn_('https://pawdy.co.th/a'), [], 'ลิงก์ปกติต้องไม่ถูกนับเป็นรูป');
assert.strictEqual(M.stripImgUrls_('ปกใหม่\n' + PNG), 'ปกใหม่');
assert.strictEqual(M.stripImgUrls_(PNG), '', 'คอมเมนต์ที่มีแต่รูปต้องได้ข้อความว่าง');
assert.strictEqual(M.stripImgUrls_('ก่อน ' + PNG + ' หลัง'), 'ก่อน หลัง');

// เวลา: ใช้ at ถ้ามี ไม่มีก็ตกไปใช้ when เดิม
assert.strictEqual(M.cmWhen_({ when: '2d ago' }), '2d ago');
assert.ok(M.cmWhen_({ at: Date.UTC(2026, 8, 11), when: 'just now' }).includes('2026'));

const tasks = [
  { id: 'T1', doc: { id: 'T1', list: 'Official', name: 'งานหนึ่ง', comments: [
      { author: 'Korn', text: 'ปกใหม่ ' + PNG, when: 'just now', at: Date.UTC(2026, 8, 11) },
      { author: 'Ploy', text: 'สองรูป ' + PNG + ' ' + JPG, when: '1d ago' },
      { author: 'Ploy', text: 'ไม่มีรูป', when: '2d ago' }
  ] } },
  // คอมเมนต์ใน custom field แบบ thread ต้องติดมาด้วย
  { id: 'T2', doc: { id: 'T2', list: 'Ads', name: 'งานสอง', comments: [],
      custom: { F1: [{ author: 'Beam', text: 'ใน field ' + JPG, when: 'just now' }], F2: 'ค่าธรรมดา' } } },
  { id: 'T3', doc: { id: 'T3', list: 'Ads', name: 'ไม่มีคอมเมนต์', comments: [] } },
  { id: 'T4', doc: {} },
];

const rows = M.commentRows_(tasks);
assert.strictEqual(rows.length, 4, 'ได้ ' + rows.length + ' แถว');

const [r0, r1, r2, r3] = rows;
assert.deepStrictEqual(r0.slice(0, 7), ['T1', 'Official', 'งานหนึ่ง', 'Korn', M.cmWhen_({at:Date.UTC(2026,8,11)}), 'ปกใหม่', 1]);
assert.ok(r0[7].startsWith('=IMAGE("' + PNG + '", 4, '), 'ต้องเป็นสูตร IMAGE: ' + r0[7]);
assert.strictEqual(r0[8], PNG);
assert.ok(r0[9].endsWith('/#/t/T1'), 'ลิงก์เปิดการ์ดต้องเป็นแบบสั้น: ' + r0[9]);

assert.strictEqual(r1[6], 2, 'นับรูปได้ 2');
assert.strictEqual(r1[8], PNG + '\n' + JPG, 'ลิงก์ทั้งหมดต้องอยู่ครบ');
assert.ok(r1[7].indexOf(PNG) > 0 && r1[7].indexOf(JPG) < 0, 'ช่องรูปโชว์รูปแรก ที่เหลืออยู่ในช่องลิงก์');

assert.strictEqual(r2[6], '', 'ไม่มีรูป -> ช่องจำนวนว่าง');
assert.strictEqual(r2[7], '', 'ไม่มีรูป -> ไม่มีสูตร IMAGE');

assert.strictEqual(r3[0], 'T2');
assert.strictEqual(r3[3], 'Beam', 'คอมเมนต์ใน custom field ต้องติดมา');

// ไม่มีข้อมูลต้องไม่พัง
assert.deepStrictEqual(M.commentRows_([]), []);
assert.deepStrictEqual(M.commentRows_(null), []);

console.log('no errors');
