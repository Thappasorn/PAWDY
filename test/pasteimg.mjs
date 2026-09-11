// paste รูปลงช่องคอมเมนต์ -> อัปขึ้น Storage -> URL โผล่ในช่อง -> วาดเป็น <img>
import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:1250,height:820}});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
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
  window.__alerts=[];
  window.alert=(m)=>window.__alerts.push(String(m));
  inst.setState({
    tasks:[{id:'T101',name:'งานทดสอบ paste',list:'Official',status:'Backlog',assignee:'Janji',assignees:['Janji'],
      due:'2026-09-11',start:'2026-09-08',tags:[],channel:'—',platform:'—',priority:'Normal',
      subtasks:[],comments:[],attachments:[],qty:1,cost:0,desc:'',custom:{},pos:1000}],
    view:'table', list:'__all'
  });
});
await p.waitForTimeout(700);

const PNG='https://zk.supabase.co/storage/v1/object/public/task-images/T101/abc123.png';

// A) commentParts รู้จักลิงก์รูป
const parts = await p.evaluate((u)=>{
  const ps=window.__app.commentParts('ดูรูปนี้ '+u+' นะ');
  return ps.map(x=>x.isImg?'IMG':(x.isLink?'LINK':'TEXT'));
}, PNG);
if (JSON.stringify(parts)!==JSON.stringify(['TEXT','IMG','TEXT'])) {
  console.log('FAIL commentParts:', parts); process.exit(1);
}
const nonImg = await p.evaluate(()=>window.__app.commentParts('https://pawdy.co.th/a').map(x=>x.isImg?'IMG':'LINK'));
if (nonImg[0]!=='LINK') { console.log('FAIL ลิงก์ปกติกลายเป็นรูป:', nonImg); process.exit(1); }

// B) paste จริงในช่องคอมเมนต์ของการ์ด -> ต้องได้ URL (พิสูจน์ว่า onPaste ใน EVENT_MAP ทำงาน)
await p.evaluate(()=>window.__app.setState({selected:'T101'}));
await p.waitForTimeout(800);
const box = await p.$('input[placeholder^="เขียนคอมเมนต์"]');
if (!box) { console.log('FAIL ไม่เจอช่องคอมเมนต์ในการ์ด'); process.exit(1); }

const pasted = await p.evaluate(async (u)=>{
  let resolve; const gate=new Promise(r=>{resolve=r;});
  window.PawdySync.uploadImage=()=>gate;
  const el=document.querySelector('input[placeholder^="เขียนคอมเมนต์"]');
  const dt=new DataTransfer();
  dt.items.add(new File([new Uint8Array([137,80,78,71])],'s.png',{type:'image/png'}));
  el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
  await new Promise(r=>setTimeout(r,250));
  const during=window.__app.state.newComment;          // ต้องเห็นตัวบอกกำลังอัป
  resolve(u);
  await new Promise(r=>setTimeout(r,350));
  return { during, after: window.__app.state.newComment };
}, PNG);

if (!pasted.during.includes('กำลังอัปโหลด')) { console.log('FAIL ไม่ขึ้นสถานะกำลังอัป:', pasted.during); process.exit(1); }
if (pasted.after!==PNG) { console.log('FAIL URL ไม่ลงช่อง:', JSON.stringify(pasted.after)); process.exit(1); }

// C) กันส่งตอนรูปยังไม่เสร็จ
const guard = await p.evaluate(()=>{
  window.__app.setState({newComment:'ข้อความ '+window.__app.PASTE_MARK()});
  window.__alerts=[];
  const n=(window.__app.state.tasks[0].comments||[]).length;
  window.__app.addCommentTo('T101');
  return { alerted: window.__alerts.join(''), before:n, after:(window.__app.state.tasks[0].comments||[]).length };
});
if (guard.after!==guard.before) { console.log('FAIL ส่งคอมเมนต์ออกไปทั้งที่รูปยังไม่เสร็จ'); process.exit(1); }

// D) อัปพลาด -> ตัวบอกสถานะต้องหาย ไม่ค้างในช่อง
const failed = await p.evaluate(async ()=>{
  window.PawdySync.uploadImage=()=>Promise.reject(new Error('bucket not found'));
  window.__app.setState({newComment:''});
  window.__alerts=[];
  const el=document.querySelector('input[placeholder^="เขียนคอมเมนต์"]');
  const dt=new DataTransfer();
  dt.items.add(new File([new Uint8Array([1])],'s.png',{type:'image/png'}));
  el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
  await new Promise(r=>setTimeout(r,400));
  return { text: window.__app.state.newComment, alerted: window.__alerts.join(' ') };
});
if (failed.text.includes('กำลังอัปโหลด')) { console.log('FAIL ตัวบอกสถานะค้าง:', failed.text); process.exit(1); }
if (!failed.alerted.includes('อัปรูปไม่สำเร็จ')) { console.log('FAIL ไม่เตือนเวลาอัปพลาด:', failed.alerted); process.exit(1); }

// E) paste ข้อความธรรมดาต้องไม่ถูกขัด
const plain = await p.evaluate(()=>{
  window.__app.setState({newComment:'เดิม'});
  const el=document.querySelector('input[placeholder^="เขียนคอมเมนต์"]');
  const dt=new DataTransfer(); dt.setData('text/plain','abc');
  const ev=new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true});
  el.dispatchEvent(ev);
  return { prevented: ev.defaultPrevented, text: window.__app.state.newComment };
});
if (plain.prevented || plain.text!=='เดิม') { console.log('FAIL paste ข้อความถูกขัด:', plain); process.exit(1); }

// F) คอมเมนต์ที่มีลิงก์รูปต้องวาดเป็น <img>
const rendered = await p.evaluate(async (u)=>{
  window.__app.setState(s=>({tasks:s.tasks.map(t=>t.id==='T101'
    ? Object.assign({},t,{comments:[{author:'Korn',text:'ปกใหม่ '+u,when:'just now'}]}) : t)}));
  await new Promise(r=>setTimeout(r,600));
  return [...document.querySelectorAll('img')].map(i=>i.getAttribute('src')).filter(s=>s&&s.includes('task-images')).length;
}, PNG);
if (rendered < 1) { console.log('FAIL ไม่วาด <img> ในคอมเมนต์'); process.exit(1); }

console.log('parts:', parts.join('/'), '| img rendered:', rendered);
console.log(errs.join('\n')||'no errors');
await b.close();
