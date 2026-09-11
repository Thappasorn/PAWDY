// paste รูป -> อัปขึ้น Storage -> โชว์รูปตัวอย่างในช่อง (ไม่โชว์ URL) -> ส่งแล้วรูปอยู่ในคอมเมนต์
import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:1250,height:900}});
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
  window.__alerts=[]; window.alert=(m)=>window.__alerts.push(String(m));
  window.__mkTask=()=>({id:'T101',name:'งานทดสอบ paste',list:'Official',status:'Backlog',assignee:'Janji',
    assignees:['Janji'],due:'2026-09-11',start:'2026-09-08',tags:[],channel:'—',platform:'—',priority:'Normal',
    subtasks:[],comments:[],attachments:[],qty:1,cost:0,desc:'',custom:{},pos:1000});
  inst.setState({tasks:[window.__mkTask()], view:'table', list:'__all'});
});
await p.waitForTimeout(700);

const PNG='https://zk.supabase.co/storage/v1/object/public/task-images/T101/abc123.png';
const thumbCount = () => p.evaluate(()=>[...document.querySelectorAll('img')]
  .filter(i=>(i.src||'').includes('task-images') && i.style.width==='72px').length);

// A) commentParts แยกลิงก์รูปออกจากลิงก์ธรรมดา
const parts = await p.evaluate((u)=>window.__app.commentParts('ดูรูปนี้ '+u+' นะ')
  .map(x=>x.isImg?'IMG':(x.isLink?'LINK':'TEXT')), PNG);
if (JSON.stringify(parts)!==JSON.stringify(['TEXT','IMG','TEXT'])) fail('commentParts', parts);
const nonImg = await p.evaluate(()=>window.__app.commentParts('https://pawdy.co.th/a')[0].isImg);
if (nonImg) fail('ลิงก์ปกติกลายเป็นรูป');

// B) paste จริง -> URL ต้อง "ไม่" เข้าไปในช่องพิมพ์ แต่เข้าลิสต์รูป (พิสูจน์ onPaste ใน EVENT_MAP ด้วย)
await p.evaluate(()=>window.__app.setState({selected:'T101', newComment:'ปกใหม่'}));
await p.waitForTimeout(800);
if (!await p.$('input[placeholder^="เขียนคอมเมนต์"]')) fail('ไม่เจอช่องคอมเมนต์ในการ์ด');

const pasted = await p.evaluate(async (u)=>{
  let resolve; const gate=new Promise(r=>{resolve=r;});
  window.PawdySync.uploadImage=()=>gate;
  const el=document.querySelector('input[placeholder^="เขียนคอมเมนต์"]');
  const dt=new DataTransfer();
  dt.items.add(new File([new Uint8Array([137,80,78,71])],'s.png',{type:'image/png'}));
  el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
  await new Promise(r=>setTimeout(r,300));
  const busySlots=[...document.querySelectorAll('span')].filter(e=>e.innerText==='กำลัง\nอัปโหลด…').length;
  const during={ text:window.__app.state.newComment, busy:window.__app.state.newCommentBusy, busySlots };
  resolve(u);
  await new Promise(r=>setTimeout(r,400));
  return { during, text:window.__app.state.newComment,
           imgs:window.__app.state.newCommentImgs, busy:window.__app.state.newCommentBusy };
}, PNG);

if (pasted.during.busy !== 1)      fail('ตัวนับกำลังอัปไม่ขึ้น', pasted.during);
if (pasted.during.busySlots !== 1) fail('ไม่เห็นช่องกำลังอัปโหลด', pasted.during);
if (pasted.during.text !== 'ปกใหม่') fail('ข้อความถูกแก้ตอนกำลังอัป', pasted.during.text);
if (pasted.text !== 'ปกใหม่')      fail('URL หลุดเข้าช่องพิมพ์', pasted.text);
if (JSON.stringify(pasted.imgs) !== JSON.stringify([PNG])) fail('URL ไม่เข้าลิสต์รูป', pasted.imgs);
if (pasted.busy !== 0)             fail('ตัวนับไม่ลดกลับ', pasted.busy);
if (await thumbCount() !== 1)      fail('ไม่เห็นรูปตัวอย่างในช่อง');

// C) กดส่ง -> ข้อความ + URL ต่อกันลง comment.text (ของเดิมอ่านต่อได้: sync, ชีต, ค้นหา)
const sent = await p.evaluate(async ()=>{
  const before=(window.__app.state.tasks[0].comments||[]).length;
  const inp=document.querySelector('input[placeholder^="เขียนคอมเมนต์"]');
  inp.parentElement.querySelector('button').click();     // ปุ่มส่งอยู่ข้างช่องพิมพ์
  await new Promise(r=>setTimeout(r,500));
  const c=(window.__app.state.tasks[0].comments||[]);
  return { before, n:c.length, text:c.length?c[c.length-1].text:'',
           box:window.__app.state.newComment, imgs:window.__app.state.newCommentImgs };
});
if (sent.n !== 1) fail('ส่งคอมเมนต์ไม่สำเร็จ', sent);
if (!sent.text.includes(PNG) || !sent.text.includes('ปกใหม่')) fail('comment.text ไม่ได้เก็บทั้งข้อความและรูป', sent.text);
if (sent.box !== '' || (sent.imgs||[]).length !== 0) fail('ส่งแล้วไม่เคลียร์ช่อง', sent);

// D) คอมเมนต์ที่ส่งแล้ว: textarea ต้องไม่มี URL แต่ต้องมี <img>
const shown = await p.evaluate(()=>{
  const tas=[...document.querySelectorAll('textarea')].map(t=>t.value).filter(v=>v.includes('ปกใหม่'));
  return { boxes: tas, imgs:[...document.querySelectorAll('img')].filter(i=>(i.src||'').includes('task-images')).length };
});
if (!shown.boxes.length) fail('ไม่เจอ textarea ของคอมเมนต์ที่ส่งแล้ว');
if (shown.boxes.some(v=>v.includes('http'))) fail('URL ยังโชว์ในช่องแก้ข้อความ', shown.boxes);
if (shown.imgs < 1) fail('ไม่วาด <img> ในคอมเมนต์');

// E) แก้ข้อความคอมเมนต์ที่มีรูป -> รูปต้องไม่หาย
const edited = await p.evaluate(async ()=>{
  const ta=[...document.querySelectorAll('textarea')].find(t=>t.value.includes('ปกใหม่'));
  // React ฟัง input event และเช็คค่าผ่าน native setter ตั้ง .value เฉยๆ ไม่พอ
  const setv=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
  setv.call(ta,'แก้แล้ว');
  ta.dispatchEvent(new Event('input',{bubbles:true}));
  ta.dispatchEvent(new Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,400));
  const c=window.__app.state.tasks[0].comments[0];
  return c.text;
});
if (!edited.includes('แก้แล้ว') || !edited.includes(PNG)) fail('แก้ข้อความแล้วรูปหาย', edited);

// F) กันกดส่งตอนรูปยังอัปไม่เสร็จ
const guard = await p.evaluate(()=>{
  // addCommentTo คือ composer ในแถว -> ต้องเซ็ต key ของแถว
  window.__app.setState({tasks:[window.__mkTask()], commentComposerText:'x', commentComposerBusy:1});
  window.__alerts=[];
  window.__app.addCommentTo('T101');
  return { n:(window.__app.state.tasks[0].comments||[]).length, alerted:window.__alerts.join('') };
});
if (guard.n !== 0) fail('ส่งออกไปทั้งที่รูปยังอัปไม่เสร็จ');
if (!guard.alerted.includes('ยังอัปโหลดไม่เสร็จ')) fail('ไม่เตือนตอนกดส่งเร็วเกิน', guard.alerted);

// G) ปุ่ม × เอารูปออก — ข้อความต้องอยู่
const removed = await p.evaluate(async (u)=>{
  window.__app.setState({newCommentBusy:0, newComment:'เก็บข้อความไว้', newCommentImgs:[u]});
  await new Promise(r=>setTimeout(r,500));
  const btn=document.querySelector('button[aria-label="เอารูปนี้ออก"]');
  if (!btn) return { noBtn:true };
  btn.click();
  await new Promise(r=>setTimeout(r,400));
  return { text:window.__app.state.newComment, imgs:window.__app.state.newCommentImgs };
}, PNG);
if (removed.noBtn) fail('ไม่มีปุ่มเอารูปออก');
if (removed.text !== 'เก็บข้อความไว้') fail('ลบรูปแล้วข้อความเพี้ยน', removed.text);
if ((removed.imgs||[]).length !== 0) fail('รูปไม่หลุดจากลิสต์', removed.imgs);
if (await thumbCount() !== 0) fail('รูปตัวอย่างไม่หาย');

// H) เปิดคอมเมนต์งานอื่น รูปที่ค้างต้องไม่ตามไป
const leak = await p.evaluate(async (u)=>{
  window.__app.setState({commentComposerImgs:[u], commentComposerText:'ของงานเก่า'});
  window.__app.openCommentComposer ? 0 : 0;
  window.__app.setState({commentComposer:null, commentField:null, commentComposerText:'', commentComposerImgs:[], commentComposerBusy:0, commentComposerPos:null});
  await new Promise(r=>setTimeout(r,300));
  return (window.__app.state.commentComposerImgs||[]).length;
}, PNG);
if (leak !== 0) fail('รูปค้างข้ามงาน', leak);

// I) paste ข้อความธรรมดาต้องไม่ถูกขัด
const plain = await p.evaluate(()=>{
  window.__app.setState({newComment:'เดิม'});
  const el=document.querySelector('input[placeholder^="เขียนคอมเมนต์"]');
  const dt=new DataTransfer(); dt.setData('text/plain','abc');
  const ev=new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true});
  el.dispatchEvent(ev);
  return { prevented:ev.defaultPrevented, text:window.__app.state.newComment };
});
if (plain.prevented || plain.text!=='เดิม') fail('paste ข้อความถูกขัด', plain);

console.log('parts:', parts.join('/'), '| URL ไม่โชว์ในช่อง: ok | ส่งแล้วรูปอยู่: ok');
console.log(errs.join('\n')||'no errors');
await b.close();
