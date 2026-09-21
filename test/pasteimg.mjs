// ช่องคอมเมนต์เป็นแบบเดียวกับ Description — รูปอยู่ในช่องปนกับข้อความ
import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:1350,height:950}});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
const fail=(m,x)=>{ console.log('FAIL '+m, x===undefined?'':JSON.stringify(x)); process.exit(1); };
await p.goto('file://' + process.cwd() + '/index.html');
await p.waitForTimeout(2600);

const PNG='https://zk.supabase.co/storage/v1/object/public/task-images/T101/abc123.png';
const CARD='[data-richedit][aria-label="เขียนคอมเมนต์"]';
const SENT='[data-richedit][aria-label="แก้คอมเมนต์"]';

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
  window.__alerts=[]; window.alert=(m)=>window.__alerts.push(String(m));
  window.__mk=()=>({id:'T101',name:'งานทดสอบ',list:'Official',status:'Backlog',assignee:'Janji',
    assignees:['Janji'],due:'2026-09-25',start:'2026-09-20',tags:[],channel:'—',platform:'—',priority:'Normal',
    subtasks:[],comments:[],attachments:[],qty:1,cost:0,desc:'',custom:{},pos:1000});
  inst.setState({tasks:[window.__mk()], view:'table', list:'__all', selected:'T101'});
});
await p.waitForTimeout(1200);

const look = (sel) => p.evaluate((s)=>{
  const el=document.querySelector(s);
  return el ? { text: el.innerText, imgs: [...el.querySelectorAll('img')].map(i=>i.getAttribute('data-img')) } : null;
}, sel);

// ---- A) ช่องคอมเมนต์ในการ์ดต้องเป็น contenteditable แล้ว
if (!await p.$(CARD)) fail('ไม่เจอช่องคอมเมนต์แบบใหม่ในการ์ด');
if (await p.$('input[placeholder^="เขียนคอมเมนต์"]')) fail('ยังเป็น input อยู่');

// ---- B) paste รูป -> <img> อยู่ในช่อง ไม่ใช่ URL เป็นตัวหนังสือ
const pasted = await p.evaluate(async ({u,sel})=>{
  let resolve; const gate=new Promise(r=>{resolve=r;});
  window.PawdySync.uploadImage=()=>gate;
  const el=document.querySelector(sel);
  el.focus();
  document.execCommand('insertText', false, 'ปกใหม่');
  el.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(r=>setTimeout(r,200));
  const dt=new DataTransfer();
  dt.items.add(new File([new Uint8Array([137,80,78,71])],'s.png',{type:'image/png'}));
  el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
  await new Promise(r=>setTimeout(r,250));
  const busy=[...document.querySelectorAll('span')].some(e=>e.innerText==='กำลัง\nอัปโหลด…');
  resolve(u);
  await new Promise(r=>setTimeout(r,700));
  return { busy, state: window.__app.state.newComment };
}, {u:PNG, sel:CARD});
if (!pasted.busy) fail('ไม่เห็นตัวบอกกำลังอัปโหลด');
if (!pasted.state.includes(PNG)) fail('URL ไม่เข้า state', pasted.state);
if (!pasted.state.includes('ปกใหม่')) fail('ข้อความหาย', pasted.state);

let v = await look(CARD);
if (v.imgs.length !== 1 || v.imgs[0] !== PNG) fail('รูปไม่ได้อยู่ในช่อง', v);
if (v.text.includes(PNG)) fail('URL โผล่เป็นตัวหนังสือในช่อง', v.text);

// ---- C) กดส่ง -> comment.text เก็บข้อความ+URL และช่องถูกล้าง
const sent = await p.evaluate(async (sel)=>{
  document.querySelector(sel).closest('[data-richbox]').parentElement.querySelector('button').click();
  await new Promise(r=>setTimeout(r,700));
  const c=window.__app.state.tasks[0].comments;
  return { n:c.length, text:c.length?c[0].text:'', box:window.__app.state.newComment };
}, CARD);
if (sent.n !== 1) fail('ส่งไม่สำเร็จ', sent);
if (!sent.text.includes(PNG) || !sent.text.includes('ปกใหม่')) fail('comment.text ไม่ครบ', sent.text);
if (sent.box !== '') fail('ส่งแล้วไม่ล้างช่อง', sent.box);

// ---- D) คอมเมนต์ที่ส่งแล้วต้องโชว์รูปในช่องแก้ไข ไม่ใช่ URL
await p.waitForTimeout(500);
v = await look(SENT);
if (!v) fail('ไม่เจอช่องแก้คอมเมนต์');
if (v.imgs.length !== 1) fail('คอมเมนต์ที่ส่งแล้วไม่โชว์รูปในช่อง', v);
if (v.text.includes('http')) fail('URL โผล่ในช่องแก้คอมเมนต์', v.text);

// ---- E) แก้ข้อความคอมเมนต์ -> รูปต้องไม่หาย
const edited = await p.evaluate(async (sel)=>{
  const el=document.querySelector(sel);
  el.focus();
  const r=document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
  document.execCommand('insertText', false, ' แก้แล้ว');
  el.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(r2=>setTimeout(r2,600));
  return { text: window.__app.state.tasks[0].comments[0].text,
           imgs: document.querySelectorAll(sel+' img').length };
}, SENT);
if (!edited.text.includes('แก้แล้ว')) fail('แก้ไม่ติด', edited.text);
if (!edited.text.includes(PNG)) fail('แก้ข้อความแล้วรูปหาย', edited.text);
if (edited.imgs !== 1) fail('รูปหายจากช่อง', edited);

// ---- F) ลบรูปในช่องแก้คอมเมนต์ -> URL หลุดจาก comment.text
const removed = await p.evaluate(async (sel)=>{
  const el=document.querySelector(sel);
  el.querySelector('img').remove();
  el.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(r=>setTimeout(r,600));
  return window.__app.state.tasks[0].comments[0].text;
}, SENT);
if (removed.includes('task-images')) fail('ลบรูปแล้ว URL ยังค้าง', removed);
if (!removed.includes('แก้แล้ว')) fail('ลบรูปแล้วข้อความหาย', removed);

// ---- G) วางข้อความธรรมดาต้องไม่ลาก markup
const plain = await p.evaluate(async (sel)=>{
  const el=document.querySelector(sel);
  el.focus();
  const dt=new DataTransfer();
  dt.setData('text/plain','ล้วน');
  dt.setData('text/html','<b style="color:red">ล้วน</b>');
  const ev=new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true});
  el.dispatchEvent(ev);
  await new Promise(r=>setTimeout(r,400));
  return { prevented: ev.defaultPrevented, html: el.innerHTML };
}, CARD);
if (!plain.prevented) fail('ไม่ได้ดักวางข้อความ');
if (/<b[ >]|color:red/i.test(plain.html)) fail('markup หลุดเข้ามา', plain.html);

// ---- H) กันส่งตอนรูปยังอัปไม่เสร็จ
const guard = await p.evaluate(async ()=>{
  window.__app.setState({tasks:[window.__mk()], commentComposerText:'x', richBusy:{rowc:1}});
  await new Promise(r=>setTimeout(r,200));
  window.__alerts=[];
  window.__app.addCommentTo('T101');
  return { n:(window.__app.state.tasks[0].comments||[]).length, alerted:window.__alerts.join('') };
});
if (guard.n !== 0) fail('ส่งออกไปทั้งที่รูปยังไม่เสร็จ');
if (!guard.alerted.includes('ยังอัปโหลดไม่เสร็จ')) fail('ไม่เตือน', guard.alerted);

console.log('คอมเมนต์: contenteditable · รูปในช่อง · ส่ง/แก้/ลบ/วาง ครบ');
console.log(errs.join('\n')||'no errors');
await b.close();
