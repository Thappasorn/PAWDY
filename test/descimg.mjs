// ช่อง Description: paste รูปได้ URL ไม่โชว์ในช่อง รูปขึ้นข้างล่าง
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
    desc: drive + '\n\nตัวอย่าง'
  }]});
}, {drive:DRIVE});
await p.waitForTimeout(1200);

const descBox = () => p.evaluate(()=>{
  const ta=[...document.querySelectorAll('textarea')].find(t=>(t.placeholder||'').indexOf('รายละเอียดงาน')===0);
  return ta ? ta.value : null;
});
const descImgs = () => p.evaluate(()=>[...document.querySelectorAll('img')]
  .filter(i=>(i.src||'').includes('task-images') && i.style.maxHeight==='200px').map(i=>i.src));

// ---- A) ลิงก์ที่ไม่ใช่รูป (Google Drive) ต้องอยู่ในช่องเหมือนเดิม ไม่ถูกตัด
let box = await descBox();
if (box === null) fail('ไม่เจอช่อง Description');
if (!box.includes('drive.google.com')) fail('ลิงก์ Drive หายจากช่อง', box);
if (!box.includes('ตัวอย่าง')) fail('ข้อความหาย', box);

// ---- B) paste รูป -> URL ไม่เข้าช่อง แต่รูปขึ้นข้างล่าง
const pasted = await p.evaluate(async (u)=>{
  let resolve; const gate=new Promise(r=>{resolve=r;});
  window.PawdySync.uploadImage=()=>gate;
  const ta=[...document.querySelectorAll('textarea')].find(t=>(t.placeholder||'').indexOf('รายละเอียดงาน')===0);
  const dt=new DataTransfer();
  dt.items.add(new File([new Uint8Array([137,80,78,71])],'s.png',{type:'image/png'}));
  ta.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
  await new Promise(r=>setTimeout(r,300));
  const busy=[...document.querySelectorAll('span')].some(e=>e.innerText==='กำลังอัปโหลด…');
  resolve(u);
  await new Promise(r=>setTimeout(r,500));
  return { busy, desc: window.__app.state.tasks[0].desc };
}, PNG);
if (!pasted.busy) fail('ไม่เห็นช่องกำลังอัปโหลด');
if (!pasted.desc.includes(PNG)) fail('URL ไม่ได้เข้า desc', pasted.desc);

box = await descBox();
if (box.includes(PNG)) fail('URL รูปโผล่ในช่องพิมพ์', box);
if (!box.includes('drive.google.com')) fail('ลิงก์ Drive หายไปหลัง paste', box);
let shown = await descImgs();
if (shown.length !== 1) fail('รูปไม่ขึ้นใต้ช่อง', shown);

// ---- C) แก้ข้อความแล้วรูปต้องไม่หาย
const edited = await p.evaluate(async ()=>{
  const ta=[...document.querySelectorAll('textarea')].find(t=>(t.placeholder||'').indexOf('รายละเอียดงาน')===0);
  const setv=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
  setv.call(ta,'บรีฟใหม่');
  ta.dispatchEvent(new Event('input',{bubbles:true}));
  ta.dispatchEvent(new Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,500));
  return window.__app.state.tasks[0].desc;
});
if (!edited.includes('บรีฟใหม่')) fail('แก้ข้อความไม่ติด', edited);
if (!edited.includes(PNG)) fail('แก้ข้อความแล้วรูปหาย', edited);
shown = await descImgs();
if (shown.length !== 1) fail('รูปหายจากหน้าจอหลังแก้ข้อความ', shown);

// ---- D) กด × เอารูปออก ข้อความต้องอยู่
const removed = await p.evaluate(async ()=>{
  document.querySelector('button[aria-label="เอารูปนี้ออก"]').click();
  await new Promise(r=>setTimeout(r,500));
  return window.__app.state.tasks[0].desc;
});
if (removed.includes('task-images')) fail('ลบรูปแล้ว URL ยังอยู่', removed);
if (!removed.includes('บรีฟใหม่')) fail('ลบรูปแล้วข้อความหาย', removed);
if ((await descImgs()).length !== 0) fail('รูปยังค้างบนหน้าจอ');

// ---- E) paste ข้อความธรรมดาต้องไม่ถูกขัด
const plain = await p.evaluate(()=>{
  const ta=[...document.querySelectorAll('textarea')].find(t=>(t.placeholder||'').indexOf('รายละเอียดงาน')===0);
  const dt=new DataTransfer(); dt.setData('text/plain','abc');
  const ev=new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true});
  ta.dispatchEvent(ev);
  return ev.defaultPrevented;
});
if (plain) fail('paste ข้อความถูกขัด');

console.log('desc: ลิงก์ปกติอยู่ครบ · รูปแยกออกมา · แก้ข้อความรูปไม่หาย');
console.log(errs.join('\n')||'no errors');
await b.close();
