// บอร์ด: paste รูปในช่องเพิ่มการ์ด -> การ์ดใหม่มีหน้าปก และบอร์ดโชว์รูป
import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:1350,height:900}});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
const fail=(m,x)=>{ console.log('FAIL '+m, x===undefined?'':JSON.stringify(x)); process.exit(1); };
await p.goto('file://' + process.cwd() + '/index.html');
await p.waitForTimeout(2600);

const PNG='https://zk.supabase.co/storage/v1/object/public/task-images/T9/cover.png';

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
  inst.setState({ view:'board', list:'__all', tasks:[] });
});
await p.waitForTimeout(800);

const boardImgs = () => p.evaluate(()=>[...document.querySelectorAll('[data-card] img')].map(i=>i.getAttribute('src')));

// ---- A) หน้าปกที่ตั้งไว้แล้วต้องขึ้นบนบอร์ด
await p.evaluate((u)=>{
  const T=(id,name,extra)=>Object.assign({id,name,list:'Official',status:'Backlog',assignee:'Janji',assignees:['Janji'],
    due:'2026-09-25',start:'2026-09-20',tags:[],channel:'—',platform:'—',priority:'Normal',subtasks:[],
    comments:[],attachments:[],qty:1,cost:0,desc:'',custom:{},pos:1000}, extra||{});
  window.__app.setState({tasks:[
    T('T1','มีหน้าปกตั้งเอง',{cover:u}),
    T('T2','ไม่มีหน้าปก'),
    T('T3','เอาจากไฟล์แนบ',{attachments:[{name:'a',url:u.replace('cover','att')}]}),
    T('T4','สั่งไม่เอาหน้าปก',{cover:'__none', attachments:[{name:'a',url:u}]})
  ]});
}, PNG);
await p.waitForTimeout(900);
let imgs = await boardImgs();
if (imgs.length !== 2) fail('บอร์ดควรโชว์หน้าปก 2 การ์ด (ตั้งเอง + จากไฟล์แนบ)', imgs);
if (!imgs.includes(PNG)) fail('หน้าปกที่ตั้งเองไม่ขึ้น', imgs);
if (!imgs.some(u=>u.includes('att'))) fail('หน้าปกจากไฟล์แนบไม่ขึ้น', imgs);
if (imgs.some(u=>u===PNG && false)) fail('x');

// ---- B) paste รูปในช่องเพิ่มการ์ด
await p.evaluate(()=>{ window.__app.setState({tasks:[]}); window.__app.openComposer('Backlog'); });
await p.waitForTimeout(700);
const ta = await p.$('textarea[placeholder^="พิมพ์ชื่องาน"]');
if (!ta) fail('ไม่เจอช่องเพิ่มการ์ดบนบอร์ด');

const pasted = await p.evaluate(async (u)=>{
  let resolve; const gate=new Promise(r=>{resolve=r;});
  window.PawdySync.uploadImage=()=>gate;
  const el=document.querySelector('textarea[placeholder^="พิมพ์ชื่องาน"]');
  const dt=new DataTransfer();
  dt.items.add(new File([new Uint8Array([137,80,78,71])],'s.png',{type:'image/png'}));
  el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
  await new Promise(r=>setTimeout(r,300));
  const busySlot=[...document.querySelectorAll('span')].some(e=>e.innerText==='กำลัง\nอัปโหลด…');
  const duringText=window.__app.state.composerText;
  resolve(u);
  await new Promise(r=>setTimeout(r,400));
  return { busySlot, duringText, text:window.__app.state.composerText, imgs:window.__app.state.composerImgs };
}, PNG);
if (!pasted.busySlot) fail('ไม่เห็นช่องกำลังอัปโหลด', pasted);
if (pasted.text !== '') fail('URL หลุดเข้าช่องพิมพ์ชื่องาน', pasted.text);
if (JSON.stringify(pasted.imgs) !== JSON.stringify([PNG])) fail('รูปไม่เข้าลิสต์', pasted.imgs);

const thumb = await p.evaluate(()=>[...document.querySelectorAll('img')].filter(i=>i.style.width==='72px').length);
if (thumb !== 1) fail('ไม่เห็นรูปตัวอย่างในช่องเพิ่มการ์ด', thumb);

// ---- C) กด Add card -> ได้การ์ดที่มีหน้าปก และบอร์ดโชว์รูปทันที
await p.evaluate(()=>{
  window.__app.setState({composerText:'งานใหม่มีรูป'});
});
await p.waitForTimeout(300);
await p.evaluate(()=>{
  [...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Add card').click();
});
await p.waitForTimeout(900);
const made = await p.evaluate(()=>{
  const t=window.__app.state.tasks[0];
  return { name:t.name, cover:t.cover, atts:(t.attachments||[]).map(a=>a.url),
           left:{text:window.__app.state.composerText, imgs:window.__app.state.composerImgs} };
});
if (made.name !== 'งานใหม่มีรูป') fail('ชื่อการ์ดผิด', made);
if (made.cover !== PNG) fail('การ์ดใหม่ไม่ได้หน้าปก', made);
if (!made.atts.includes(PNG)) fail('รูปไม่ได้ถูกเก็บเป็นไฟล์แนบ', made);
if (made.left.text !== '' || made.left.imgs.length) fail('สร้างแล้วไม่เคลียร์ช่อง', made.left);
imgs = await boardImgs();
if (!imgs.includes(PNG)) fail('การ์ดใหม่ไม่โชว์รูปบนบอร์ด', imgs);

// ---- D) แปะรูปอย่างเดียวไม่พิมพ์ชื่อ ก็สร้างได้
const onlyImg = await p.evaluate(async (u)=>{
  window.__app.openComposer('Backlog');
  await new Promise(r=>setTimeout(r,300));
  window.__app.setState({composerImgs:[u], composerText:''});
  await new Promise(r=>setTimeout(r,300));
  window.__app.addFromComposer('Backlog');
  await new Promise(r=>setTimeout(r,500));
  return window.__app.state.tasks[0];
}, PNG);
if (onlyImg.cover !== PNG) fail('แปะรูปอย่างเดียวแล้วไม่ได้การ์ด', onlyImg);
if (!onlyImg.name) fail('การ์ดต้องมีชื่อกันหาย', onlyImg);

// ---- E) กันสร้างตอนรูปยังอัปไม่เสร็จ
const guard = await p.evaluate(async ()=>{
  const n=window.__app.state.tasks.length;
  window.__app.openComposer('Backlog');
  await new Promise(r=>setTimeout(r,200));
  window.__app.setState({composerText:'x', composerBusy:1});
  window.__alerts=[];
  window.__app.addFromComposer('Backlog');
  await new Promise(r=>setTimeout(r,300));
  return { same: window.__app.state.tasks.length === n, alerted: window.__alerts.join('') };
});
if (!guard.same) fail('สร้างการ์ดทั้งที่รูปยังอัปไม่เสร็จ');
if (!guard.alerted.includes('ยังอัปโหลดไม่เสร็จ')) fail('ไม่เตือน', guard.alerted);

// ---- F) ปิดช่องแล้วรูปที่ค้างต้องไม่ตามไปคอลัมน์อื่น
const leak = await p.evaluate(async (u)=>{
  window.__app.setState({composerBusy:0, composerImgs:[u]});
  window.__app.closeComposer();
  await new Promise(r=>setTimeout(r,300));
  return (window.__app.state.composerImgs||[]).length;
}, PNG);
if (leak !== 0) fail('รูปค้างข้ามคอลัมน์', leak);

console.log('หน้าปกบนบอร์ด: ok | paste ในช่องเพิ่มการ์ด: ok');
console.log(errs.join('\n')||'no errors');
await b.close();
