// เทสต์ตรรกะแยกตะกร้าของรายงานรายสัปดาห์ (ไม่ต้องมี Google — ดึงฟังก์ชันบริสุทธิ์ออกมารัน)
import { readFileSync } from 'fs';
import assert from 'assert';

const src = readFileSync('4-รายงานรายสัปดาห์.gs.txt', 'utf8');
const M = new Function(src + ';return{bucket_,readRow_,asDate_,mondayOf_,thaiDate_,reportText_};')();

// ศุกร์ 4 ก.ย. 2026 เวลา 11:00
const now = new Date(2026, 8, 4, 11, 0);
assert.strictEqual(now.getDay(), 5, 'วันอ้างอิงต้องเป็นวันศุกร์');
assert.strictEqual(M.mondayOf_(now).getDate(), 31, 'จันทร์ของสัปดาห์นั้นคือ 31 ส.ค.');
assert.strictEqual(M.mondayOf_(new Date(2026, 8, 6)).getDate(), 31, 'อาทิตย์ต้องถอยไปจันทร์เดิม ไม่ใช่จันทร์ถัดไป');

const row = (o) => {
  const r = new Array(21).fill('');
  r[0] = o.id; r[1] = o.list || 'Official'; r[2] = o.name; r[3] = o.status;
  r[4] = o.people || ''; r[7] = o.due ?? ''; r[18] = o.posted ?? '';
  return r;
};

const rows = [
  row({ id:'T1', name:'ค้างมาจากเดือนก่อน', status:'In Progress', people:'Korn',      due:new Date(2026,7,20) }),
  row({ id:'T2', name:'พลาดต้นสัปดาห์',     status:'Review',      people:'Korn, Ploy', due:new Date(2026,8,1) }),
  row({ id:'T3', name:'ครบวันนี้',          status:'In Progress', people:'Ploy',      due:new Date(2026,8,4) }),
  row({ id:'T4', name:'ครบวันอาทิตย์',      status:'Backlog',     people:'Ploy',      due:new Date(2026,8,6) }),
  row({ id:'T5', name:'เสร็จกลางสัปดาห์',   status:'Done',        people:'Korn',      due:new Date(2026,8,2) }),
  row({ id:'T6', name:'เสร็จแต่ของเก่า',    status:'Done',        people:'Korn',      due:new Date(2026,7,10) }),
  row({ id:'T7', name:'สัปดาห์หน้า',        status:'Backlog',     people:'Ploy',      due:'11/09/2026' }),
  row({ id:'T8', name:'อีกสองสัปดาห์',      status:'Backlog',     people:'Ploy',      due:'2026-09-18' }),
  row({ id:'T9', name:'ไม่ใส่กำหนด',        status:'Backlog',     people:'Korn' }),
  row({ id:'T10', name:'ลบจากเว็บ',         status:'(ลบจากเว็บแล้ว)', people:'Korn', due:new Date(2026,8,3) }),
  row({ id:'T11', name:'ลงสื่อแล้ว',        status:'Done',        people:'Ploy', due:new Date(2026,8,3), posted:new Date(2026,8,3) }),
  row({ id:'', name:'แถวว่าง', status:'' }),
];

const r = M.bucket_(rows, now);
const names = (a) => a.map(t => t.name);

assert.strictEqual(r.total, 10, 'แถวว่างกับแถวที่ลบต้องไม่ถูกนับ — ได้ ' + r.total);
assert.deepStrictEqual(names(r.overdue),      ['ค้างมาจากเดือนก่อน', 'พลาดต้นสัปดาห์'], 'เลยกำหนดต้องเรียงตามวันครบ');
assert.deepStrictEqual(names(r.thisWeekLeft), ['ครบวันนี้', 'ครบวันอาทิตย์'], 'ครบวันนี้ต้องนับว่ายังไม่เลยกำหนด');
assert.deepStrictEqual(names(r.doneThisWeek), ['เสร็จกลางสัปดาห์', 'ลงสื่อแล้ว'], 'เสร็จสัปดาห์นี้ต้องเรียงตามวันครบ');
assert.strictEqual(r.doneThisWeek.length, 2, 'งาน Done ที่ครบกำหนดนอกสัปดาห์ต้องไม่โผล่');
assert.deepStrictEqual(names(r.nextWeek), ['สัปดาห์หน้า'], 'dd/mm/yyyy ต้องอ่านออก และอีกสองสัปดาห์ต้องไม่ติดมา');
assert.deepStrictEqual(names(r.posted), ['ลงสื่อแล้ว'], 'คอลัมน์ S วันลงสื่อจริง');
assert.strictEqual(r.noDueCount, 1);

assert.deepStrictEqual(r.byPerson.Korn, { overdue: 2, left: 0, done: 1 }, 'Korn: ' + JSON.stringify(r.byPerson.Korn));
assert.deepStrictEqual(r.byPerson.Ploy, { overdue: 1, left: 2, done: 1 }, 'Ploy: ' + JSON.stringify(r.byPerson.Ploy));
assert.ok(!('Unassigned' in r.byPerson), 'Unassigned ต้องไม่ขึ้นเป็นชื่อคน');
assert.strictEqual(r.byStatus.Backlog, 4);

assert.strictEqual(M.thaiDate_(r.weekStart), '31 ส.ค.');
assert.strictEqual(M.thaiDate_(r.weekEnd), '6 ก.ย.');
assert.ok(M.reportText_(r).includes('ค้างมาจากเดือนก่อน'));

// ชีตว่าง ต้องไม่พัง
assert.strictEqual(M.bucket_([], now).total, 0);

console.log('no errors');
