// ตรวจตัวกรอง: ดึงเมธอดจริงออกจาก index.html มารันเลย จะได้ไม่ต้องก็อปโค้ดมาไว้สองที่
// รัน: node test_filters.js
const fs = require('fs');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/index.html', 'utf8');

function grab(name) {
  const i = src.indexOf('\n  ' + name + '(');
  assert.ok(i > 0, 'หาเมธอด ' + name + ' ไม่เจอ');
  let depth = 0, started = false, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') { depth++; started = true; }
    else if (src[k] === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('ปีกกาไม่ครบใน ' + name);
}

const App = new Function('TODAY', 'd', 'return class {' +
  ['filt', 'filterCount', 'selectFields', 'allLists', 'passFilter', 'multiValues', 'multiHas', 'assigneesOf', 'isDone']
    .map(grab).join('\n') + '}')('2026-08-14', (n) => '2026-08-2' + n);

const FREELANCE = 'Fzz1';
const app = new App();
app.state = {
  fields: [
    { id: FREELANCE, label: 'Freelance', type: 'select', options: ['Ann', 'Bee'], multi: true },
    { id: 'Fzz2', label: 'Note', type: 'text' }
  ],
  spaces: [{ name: 'Content', lists: ['Official', 'Ads'] }, { name: 'Ops', lists: ['Ads'] }],
  filters: {}
};

const task = (over) => Object.assign(
  { list: 'Official', status: 'Done', priority: 'Normal', assignee: 'Ann',
    channel: 'IG', platform: '—', due: '2026-08-14', custom: {} }, over);

const set = (f) => { app.state.filters = f; };

// --- filt() ต้องไม่ทิ้งคีย์ของ custom field ---
set({ [FREELANCE]: ['Ann'] });
assert.deepStrictEqual(app.filt()[FREELANCE], ['Ann'], 'filt() ทิ้งคีย์ custom field');
assert.deepStrictEqual(app.filt().list, [], 'filt() ต้องมี list เป็น []');

// --- filterCount() นับ custom + list ด้วย ---
set({ status: ['Done'], list: ['Official'], [FREELANCE]: ['Ann', 'Bee'], due: 'today' });
assert.strictEqual(app.filterCount(), 5, 'filterCount() นับผิด');

// --- กรองด้วย Freelance (ค่าเดี่ยว + หลายค่า) ---
set({ [FREELANCE]: ['Ann'] });
assert.ok(app.passFilter(task({ custom: { [FREELANCE]: 'Ann' } })), 'ค่าเดี่ยวควรผ่าน');
assert.ok(app.passFilter(task({ custom: { [FREELANCE]: ['Bee', 'Ann'] } })), 'ค่าหลายค่าควรผ่าน');
assert.ok(!app.passFilter(task({ custom: { [FREELANCE]: 'Bee' } })), 'คนละคนต้องไม่ผ่าน');
assert.ok(!app.passFilter(task({ custom: {} })), 'ยังไม่ระบุ freelance ต้องไม่ผ่าน');

// --- "—" = ยังไม่ได้เลือก ---
set({ [FREELANCE]: ['—'] });
assert.ok(app.passFilter(task({ custom: {} })), '— ควรจับงานที่ยังว่าง');
assert.ok(!app.passFilter(task({ custom: { [FREELANCE]: 'Ann' } })), '— ไม่ควรจับงานที่มีคนแล้ว');

// --- list ---
set({ list: ['Ads'] });
assert.ok(!app.passFilter(task({ list: 'Official' })));
assert.ok(app.passFilter(task({ list: 'Ads' })));

// --- หลายฟิลด์พร้อมกัน = AND ---
set({ list: ['Official'], [FREELANCE]: ['Ann'] });
assert.ok(app.passFilter(task({ custom: { [FREELANCE]: 'Ann' } })));
assert.ok(!app.passFilter(task({ list: 'Ads', custom: { [FREELANCE]: 'Ann' } })), 'ต้องเป็น AND');

// --- ไม่ตั้งตัวกรอง = ผ่านหมด, ฟิลด์ text ไม่ถูกเอามาทำตัวกรอง ---
set({});
assert.ok(app.passFilter(task({})));
assert.strictEqual(app.filterCount(), 0);
assert.deepStrictEqual(app.selectFields().map((x) => x.id), [FREELANCE], 'ฟิลด์ text ไม่ควรมาเป็นตัวกรอง');
assert.deepStrictEqual(app.allLists(), ['Official', 'Ads'], 'allLists() ต้องไม่ซ้ำ');

console.log('ผ่านหมด ✓');
