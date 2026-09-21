// Description เป็นช่องแก้ไขที่มีรูปปนกับข้อความจริงๆ (contenteditable)
import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:1350,height:950}});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
const fail=(m,x)=>{ console.log('FAIL '+m, x===undefined?'':JSON.stringify(x)); process.exit(1); };
await p.goto('file://' + process.cwd() + '/index.html');
await p.waitForTimeout(2600);

const PNG='https://zk.supabase.co/storage/v1/object/public/task-images/T1/d.png';
const DRIVE='https://drive.google.com/file/d/1ZNF6qOOeOYHCqgwbs7j8ImFsEwiyCD11/view?usp=drive_link';

await p.evaluate(({drive})=>{
  const a=document.getElementById('pw-auth'); if(a) a.remove();
  const root=document.querySelector('[data-root]');
  const key=Object.keys(root).find(k=>k.startsWith('__reactFiber$'));
  let f=root[key], sc=null, g=0;
  while(f && g++<40){ if(f.stateNode && f.stateNode.setState){ sc=f.stateNode; break; } f=f.return; }
  let inst=null;
  for (const k of Object.keys(sc)) { const v=sc[k];
    if (v && typeof v==='object' && v.state && v.state.tasks!==undefined && typeof v.setState==='function') { inst=v; break; } }
  window.__app=inst;
  window.__alerts=[]; window.alert=(m)=>window.__alerts.push(String(m));
  inst.setState({ view:'table', list:'__all', selected:'T1', tasks:[{
    id:'T1', name:'งานทดสอบ desc', list:'Official', status:'Backlog', assignee:'Janji', assignees:['Janji'],
    due:'2026-09-25', start:'2026-09-20', tags:[], channel:'—', platform:'—', priority:'Normal',
    subtasks:[], comments:[], attachments:[], qty:1, cost:0, custom:{}, pos:1000,
    desc: drive + '\nตัวอย่าง'
  }]});
}, {drive:DRIVE});
await p.waitForTimeout(1300);

const box = () => p.evaluate(()=>{
  const el=document.querySelector('[data-descedit]');
  return el ? { text: el.innerText, imgs: [...el.querySelectorAll('img')].map(i=>i.getAttribute('data-img')) } : null;
});
const desc = () => p.evaluate(()=>window.__app.state.tasks[0].desc);

// ---- A) ช่องต้องเป็น contenteditable และลิงก์ปกติยังเป็นข้อความ
const isCE = await p.evaluate(()=>{
  const el=document.querySelector('[data-descedit]');
  return !!el && el.getAttribute('contenteditable')==='true' && !document.querySelector('textarea[placeholder^="รายละเอียดงาน"]');
});
if (!isCE) fail('ยังไม่ได้เปลี่ยนเป็น contenteditable');
let v = await box();
if (!v.text.includes('drive.google.com')) fail('ลิงก์ Drive หาย', v.text);
if (!v.text.includes('ตัวอย่าง')) fail('ข้อความหาย', v.text);
if (v.imgs.length) fail('ไม่ควรมีรูป', v.imgs);

// ---- B) paste รูป -> <img> โผล่ "ในช่อง" และ URL ไม่เป็นตัวหนังสือ
const pasted = await p.evaluate(async (u)=>{
  let resolve; const gate=new Promise(r=>{resolve=r;});
  window.PawdySync.uploadImage=()=>gate;
  const el=document.querySelector('[data-descedit]');
  el.focus();
  const dt=new DataTransfer();
  dt.items.add(new File([new Uint8Array([137,80,78,71])],'s.png',{type:'image/png'}));
  el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
  await new Promise(r=>setTimeout(r,300));
  const busy=[...document.querySelectorAll('span')].some(e=>e.innerText==='กำลังอัปโหลด…');
  resolve(u);
  await new Promise(r=>setTimeout(r,700));
  return busy;
}, PNG);
if (!pasted) fail('ไม่เห็นตัวบอกกำลังอัปโหลด');

v = await box();
if (v.imgs.length !== 1 || v.imgs[0] !== PNG) fail('รูปไม่ได้อยู่ในช่อง', v);
if (v.text.includes(PNG)) fail('URL รูปโผล่เป็นตัวหนังสือในช่อง', v.text);
if (!v.text.includes('drive.google.com')) fail('ลิงก์ Drive หายหลัง paste', v.text);
if (!(await desc()).includes(PNG)) fail('desc ไม่ได้เก็บ URL', await desc());

// ---- C) พิมพ์ต่อแล้วรูปต้องไม่หาย
const typed = await p.evaluate(async ()=>{
  const el=document.querySelector('[data-descedit]');
  el.focus();
  const r=document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
  document.execCommand('insertText', false, 'บรีฟเพิ่ม');
  el.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(r2=>setTimeout(r2,500));
  return { desc: window.__app.state.tasks[0].desc,
           imgs: [...el.querySelectorAll('img')].length };
});
if (!typed.desc.includes('บรีฟเพิ่ม')) fail('พิมพ์ไม่ติด', typed.desc);
if (!typed.desc.includes(PNG)) fail('พิมพ์แล้วรูปหายจาก desc', typed.desc);
if (typed.imgs !== 1) fail('รูปหายจากช่องหลังพิมพ์', typed);

// ---- D) ลบรูปในช่อง (เลือกแล้วลบ) -> desc ต้องไม่มี URL แล้ว
const removed = await p.evaluate(async ()=>{
  const el=document.querySelector('[data-descedit]');
  el.querySelector('img').remove();
  el.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(r=>setTimeout(r,500));
  return { desc: window.__app.state.tasks[0].desc, imgs: el.querySelectorAll('img').length };
});
if (removed.imgs !== 0) fail('รูปยังอยู่');
if (removed.desc.includes('task-images')) fail('ลบรูปแล้ว URL ยังค้างใน desc', removed.desc);
if (!removed.desc.includes('บรีฟเพิ่ม')) fail('ลบรูปแล้วข้อความหาย', removed.desc);

// ---- E) วางข้อความธรรมดาต้องได้ข้อความล้วน ไม่ลาก markup เข้ามา
const plain = await p.evaluate(async ()=>{
  const el=document.querySelector('[data-descedit]');
  el.focus();
  const r=document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
  const dt=new DataTransfer();
  dt.setData('text/plain','ข้อความวาง');
  dt.setData('text/html','<b style="color:red">ข้อความวาง</b>');
  const ev=new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true});
  el.dispatchEvent(ev);
  await new Promise(r2=>setTimeout(r2,400));
  return { prevented: ev.defaultPrevented, html: el.innerHTML, desc: window.__app.state.tasks[0].desc };
});
if (!plain.prevented) fail('ไม่ได้ดักวางข้อความ');
if (/<b[ >]|color:red/i.test(plain.html)) fail('markup หลุดเข้ามาในช่อง', plain.html);   // ระวัง <br> ไม่ใช่ <b>
if (!plain.desc.includes('ข้อความวาง')) fail('ข้อความที่วางไม่เข้า desc', plain.desc);

console.log('desc: contenteditable · รูปอยู่ในช่อง · พิมพ์/ลบ/วาง ครบ');
console.log(errs.join('\n')||'no errors');
await b.close();
