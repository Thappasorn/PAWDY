// Due date ใช้ปฏิทินสวยตัวเดียวกับ Timeline แต่เลือกวันเดียว
import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:1400,height:900}});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
const fail=(m,x)=>{ console.log('FAIL '+m, x===undefined?'':JSON.stringify(x)); process.exit(1); };
await p.goto('file://' + process.cwd() + '/index.html');
await p.waitForTimeout(2600);

await p.evaluate(()=>{
  const a=document.getElementById('pw-auth'); if(a) a.remove();
  const root=document.querySelector('[data-root]');
  const key=Object.keys(root).find(k=>k.startsWith('__reactFiber$'));
  let f=root[key], sc=null, g=0;
  while(f && g++<40){ if(f.stateNode && f.stateNode.setState){ sc=f.stateNode; break; } f=f.return; }
  let inst=null;
  for (const k of Object.keys(sc)) { const v=sc[k];
    if (v && typeof v==='object' && v.state && v.state.tasks!==undefined && typeof v.setState==='function') { inst=v; break; } }
  window.__app=inst;
  inst.setState({ view:'table', list:'__all', selected:null, tasks:[{
    id:'T1', name:'งานทดสอบ due', list:'Official', status:'Backlog', assignee:'Janji', assignees:['Janji'],
    due:'2026-10-09', start:'2026-09-20', tags:[], channel:'—', platform:'—', priority:'Normal',
    subtasks:[], comments:[], attachments:[], qty:1, cost:0, desc:'', custom:{}, pos:1000
  }]});
});
await p.waitForTimeout(1200);

// ---- A) ช่อง due ในตารางเป็นปุ่มเปิดปฏิทินแล้ว ไม่ใช่ input type=date
const found = await p.evaluate(()=>({
  btns: document.querySelectorAll('button[aria-label="เลือกวันครบกำหนด"]').length,
  nativeDue: [...document.querySelectorAll('input[type=date]')].length
}));
if (!found.btns) fail('ไม่เจอปุ่มเลือกวันครบกำหนด');

// ---- B) กดแล้วปฏิทินเปิด และเป็นโหมดวันเดียว (ไม่มีช่องวันสิ้นสุด)
await p.evaluate(()=>document.querySelector('button[aria-label="เลือกวันครบกำหนด"]').click());
await p.waitForTimeout(600);
const open = await p.evaluate(()=>{
  const el=document.querySelector('[data-timeline-picker]');
  if (!el) return null;
  return { txt: el.innerText, mode: window.__app.state.timelinePicker && window.__app.state.timelinePicker.mode };
});
if (!open) fail('ปฏิทินไม่เปิด');
if (open.mode !== 'single') fail('ไม่ได้อยู่โหมดวันเดียว', open.mode);
if (open.txt.includes('วันสิ้นสุด')) fail('โหมดวันเดียวยังโชว์ช่องวันสิ้นสุด', open.txt);
if (!open.txt.includes('วันนี้')) fail('ไม่มีตัวเลือกลัด', open.txt);

// ---- C) คลิกวันในปฏิทิน -> due เปลี่ยน แล้วปฏิทินปิด
const picked = await p.evaluate(async ()=>{
  const btns=[...document.querySelectorAll('[data-timeline-picker] button')]
    .filter(b=>/^\d+$/.test(b.innerText.trim()) && b.getAttribute('title'));
  const target=btns.find(b=>b.getAttribute('title')==='2026-10-20');
  if (!target) return { miss:true, titles: btns.slice(0,5).map(b=>b.getAttribute('title')) };
  target.click();
  await new Promise(r=>setTimeout(r,600));
  return { due: window.__app.state.tasks[0].due, open: !!document.querySelector('[data-timeline-picker]') };
});
if (picked.miss) fail('ไม่เจอวันที่ในปฏิทิน', picked.titles);
if (picked.due !== '2026-10-20') fail('เลือกวันแล้ว due ไม่เปลี่ยน', picked.due);
if (picked.open) fail('เลือกแล้วปฏิทินไม่ปิด');

// ---- D) ตัวเลือกลัด "พรุ่งนี้" ต้องได้พรุ่งนี้
const preset = await p.evaluate(async ()=>{
  document.querySelector('button[aria-label="เลือกวันครบกำหนด"]').click();
  await new Promise(r=>setTimeout(r,500));
  const b=[...document.querySelectorAll('[data-timeline-picker] button')].find(x=>x.innerText.includes('พรุ่งนี้'));
  b.click();
  await new Promise(r=>setTimeout(r,500));
  const d=new Date(); d.setDate(d.getDate()+1);
  const want=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  return { due: window.__app.state.tasks[0].due, want };
});
if (preset.due !== preset.want) fail('ตัวเลือกลัดพรุ่งนี้ผิด', preset);

// ---- E) Timeline ยังเป็นโหมดช่วงวันเหมือนเดิม ไม่พังตาม
const range = await p.evaluate(async ()=>{
  window.__app.setState({selected:null});
  await new Promise(r=>setTimeout(r,300));
  window.__app.openTimelinePicker({currentTarget:{getBoundingClientRect:()=>({left:100,top:100,bottom:130})}},
    'T1', 'F1', {from:'2026-10-01', to:'2026-10-05'});
  await new Promise(r=>setTimeout(r,500));
  const el=document.querySelector('[data-timeline-picker]');
  return { mode: window.__app.state.timelinePicker.mode, hasTo: el.innerText.includes('5 ต.ค.') || el.innerText.includes('วันสิ้นสุด') };
});
if (range.mode !== 'range') fail('Timeline ไม่ได้อยู่โหมดช่วงวัน', range.mode);
if (!range.hasTo) fail('Timeline ไม่มีช่องวันสิ้นสุดแล้ว', range);

console.log('due: ปฏิทินสวย · โหมดวันเดียว · ตัวเลือกลัดใช้ได้ · timeline ไม่พัง');
console.log(errs.join('\n')||'no errors');
await b.close();
