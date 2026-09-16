// เวลาบนคอมเมนต์ต้องคำนวณจาก at ใหม่ทุกครั้ง ไม่ใช่ข้อความแช่แข็ง
import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:1250,height:800}});
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
  const MIN=60000, HR=3600000, DAY=86400000, now=Date.now();
  inst.setState({ view:'table', list:'__all', tasks:[{
    id:'T1', name:'งานทดสอบเวลา', list:'Official', status:'Backlog', assignee:'Janji', assignees:['Janji'],
    due:'2026-09-16', start:'2026-09-10', tags:[], channel:'—', platform:'—', priority:'Normal',
    subtasks:[], attachments:[], qty:1, cost:0, desc:'', custom:{}, pos:1000,
    comments:[
      {author:'Korn', text:'เพิ่งพิมพ์',   when:'just now', at: now - 10000},
      {author:'Korn', text:'ห้านาที',      when:'just now', at: now - 5*MIN},
      {author:'Ploy', text:'สามชั่วโมง',   when:'just now', at: now - 3*HR},
      {author:'Ploy', text:'เมื่อวานนี้',  when:'just now', at: now - 30*HR},
      {author:'Beam', text:'สามวัน',       when:'just now', at: now - 3*DAY},
      {author:'Beam', text:'สิบวัน',       when:'just now', at: now - 10*DAY},
      {author:'Mai',  text:'ของเก่าไม่มี at', when:'2d ago'}
    ]}]});
});
await p.waitForTimeout(700);

// เช็คตัวคำนวณตรงๆ
const got = await p.evaluate(()=>window.__app.state.tasks[0].comments.map(c=>window.__app.commentAgo(c)));
const want = ['เมื่อสักครู่','5 นาทีก่อน','3 ชั่วโมงก่อน','เมื่อวาน','3 วันก่อน',null,'2d ago'];
want.forEach((w,i)=>{ if(w!==null && got[i]!==w) fail('แถว '+i+' ควรเป็น "'+w+'"', got[i]); });
if (!/^\d+\/\d+\/\d{4}/.test(got[5])) fail('เกิน 7 วันควรเป็นวันที่', got[5]);

// ที่สำคัญ: ไม่มีอันไหนค้างเป็น just now ทั้งที่มี at
if (got.slice(0,6).some(x=>/just now/i.test(x))) fail('ยังมีเวลาแช่แข็ง just now', got);

// เช็คว่าขึ้นบนหน้าจอจริงในการ์ด + มี tooltip เวลาเต็ม
await p.evaluate(()=>window.__app.setState({selected:'T1'}));
await p.waitForTimeout(900);
const ui = await p.evaluate(()=>{
  const spans=[...document.querySelectorAll('span[title]')].filter(s=>/นาทีก่อน|ชั่วโมงก่อน|เมื่อวาน|วันก่อน|เมื่อสักครู่/.test(s.innerText));
  return { n: spans.length, texts: spans.map(s=>s.innerText.trim()), tips: spans.map(s=>s.getAttribute('title')) };
});
if (ui.n < 5) fail('หน้าจอยังไม่โชว์เวลาที่คำนวณใหม่', ui);
if (ui.texts.some(t=>/just now/i.test(t))) fail('บนหน้าจอยังมี just now', ui.texts);
if (!ui.tips.some(t=>/^\d+\/\d+\/\d{4} \d{2}:\d{2}$/.test(t||''))) fail('tooltip ไม่มีวันเวลาเต็ม', ui.tips);

// คอมเมนต์ที่เพิ่งส่งต้องได้ at จริง ไม่ค้าง
const fresh = await p.evaluate(async ()=>{
  window.__app.setState({newComment:'คอมเมนต์ใหม่'});
  await new Promise(r=>setTimeout(r,200));
  document.querySelector('input[placeholder^="เขียนคอมเมนต์"]').parentElement.querySelector('button').click();
  await new Promise(r=>setTimeout(r,600));
  const cs=window.__app.state.tasks[0].comments;
  const last=cs[cs.length-1];
  return { hasAt: !!last.at, shown: window.__app.commentAgo(last) };
});
if (!fresh.hasAt) fail('คอมเมนต์ใหม่ไม่ได้เก็บเวลาจริง');
if (fresh.shown !== 'เมื่อสักครู่') fail('คอมเมนต์ใหม่แสดงเวลาผิด', fresh.shown);

console.log('เวลา:', got.slice(0,6).join(' · '), '| ของเก่าไม่มี at:', got[6]);
console.log(errs.join('\n')||'no errors');
await b.close();
