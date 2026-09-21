// คลิกรูปในช่อง -> ดูใหญ่ ปรับขนาด และบันทึกไฟล์ต้นฉบับ
import pw from 'playwright';
const { chromium } = pw;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC','base64');
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const ctx = await b.newContext({acceptDownloads:true});
const p = await ctx.newPage();
await p.setViewportSize({width:1350,height:950});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
const fail=(m,x)=>{ console.log('FAIL '+m, x===undefined?'':JSON.stringify(x)); process.exit(1); };

let served = 0;
await p.route('**/task-images/**', route => {
  served++;
  route.fulfill({status:200, contentType:'image/png', body:PNG, headers:{'content-length':String(PNG.length)}});
});

await p.goto('file://' + process.cwd() + '/index.html');
await p.waitForTimeout(2600);
const URL_='https://zk.supabase.co/storage/v1/object/public/task-images/T1/pic.png';

await p.evaluate((u)=>{
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
    id:'T1', name:'งานทดสอบรูป', list:'Official', status:'Backlog', assignee:'Janji', assignees:['Janji'],
    due:'2026-10-09', start:'2026-09-20', tags:[], channel:'—', platform:'—', priority:'Normal',
    subtasks:[], comments:[], attachments:[], qty:1, cost:0, custom:{}, pos:1000,
    desc:'บรีฟ\n' + u }]});
}, URL_);
await p.waitForTimeout(1400);

// ---- A) คลิกรูปในช่อง -> กล่องดูรูปเปิด พร้อมขนาดไฟล์จริง
await p.evaluate(()=>document.querySelector('[data-descedit] img').click());
await p.waitForTimeout(900);
const open = await p.evaluate(()=>{
  const el=document.querySelector('[data-imgview]');
  return el ? { txt: el.innerText, url: window.__app.state.imgView.url } : null;
});
if (!open) fail('กล่องดูรูปไม่เปิด');
if (!/1 × 1 px/.test(open.txt)) fail('ไม่ได้อ่านขนาดจริงของรูป', open.txt);
if (!/บันทึกรูป/.test(open.txt)) fail('ไม่มีปุ่มบันทึก', open.txt);

// ---- B) กดขยาย -> ขนาดถูกเก็บลง desc เป็น #w= และรูปในช่องกว้างขึ้นจริง
const bigger = await p.evaluate(async ()=>{
  [...document.querySelectorAll('[data-imgview] button')].find(b=>b.innerText.includes('ขยาย')).click();
  await new Promise(r=>setTimeout(r,600));
  const img=document.querySelector('[data-descedit] img');
  return { desc: window.__app.state.tasks[0].desc, w: img.style.width, src: img.getAttribute('src') };
});
if (!/#w=\d+/.test(bigger.desc)) fail('ขนาดไม่ได้ถูกเก็บลง desc', bigger.desc);
if (!bigger.w) fail('รูปในช่องไม่ได้กว้างขึ้น', bigger);
if (/#w=/.test(bigger.src)) fail('src ไม่ควรมี #w= (ใช้ URL เปล่าโหลดรูป)', bigger.src);

// ---- C) ยังนับเป็นรูปอยู่ (regex ต้องยอมรับ #w=)
const stillImg = await p.evaluate(()=>{
  const parts=window.__app.commentParts(window.__app.state.tasks[0].desc);
  return parts.filter(x=>x.isImg).length;
});
if (stillImg !== 1) fail('URL ที่มี #w= ไม่ถูกนับเป็นรูปแล้ว', stillImg);

// ---- D) รีเซ็ต -> #w= หลุดออก
const reset = await p.evaluate(async ()=>{
  [...document.querySelectorAll('[data-imgview] button')].find(b=>b.innerText.includes('รีเซ็ต')).click();
  await new Promise(r=>setTimeout(r,600));
  return window.__app.state.tasks[0].desc;
});
if (/#w=/.test(reset)) fail('รีเซ็ตแล้ว #w= ยังอยู่', reset);

// ---- E) บันทึก -> ได้ไฟล์ต้นฉบับ ไม่ใช่ภาพที่ย่อ
served = 0;
const [dl] = await Promise.all([
  p.waitForEvent('download', {timeout:10000}),
  p.evaluate(()=>[...document.querySelectorAll('[data-imgview] button')].find(b=>b.innerText.includes('บันทึกรูป')).click())
]);
if (dl.suggestedFilename() !== 'pic.png') fail('ชื่อไฟล์ผิด', dl.suggestedFilename());
const fs = await import('fs');
const got = fs.readFileSync(await dl.path());
if (!got.equals(PNG)) fail('ไฟล์ที่บันทึกไม่ตรงกับต้นฉบับ (ถูกบีบ/แปลง)', {size:got.length, want:PNG.length});

// ---- F) Esc ปิด
const closed = await p.evaluate(async ()=>{
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  await new Promise(r=>setTimeout(r,400));
  return !document.querySelector('[data-imgview]');
});
if (!closed) fail('Esc ไม่ปิดกล่องดูรูป');

console.log('รูป: เปิดดูได้ · ปรับขนาดเก็บใน URL · บันทึกได้ไฟล์ต้นฉบับตรงไบต์');
console.log(errs.join('\n')||'no errors');
await b.close();
