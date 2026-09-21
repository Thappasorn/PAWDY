// เปิดเว็บมาแล้ว space ต้องกางลิสต์ให้เห็นทุกอัน
import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:1350,height:900}});
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
  // space ชื่อจริงของผู้ใช้ ไม่ใช่ชื่อตัวอย่าง
  inst.setState({ view:'table', list:'__all', tasks:[], spaces:[
    { name:'คอนเทนต์', color:'#4f46e5', lists:['Official','Pet Shop'] },
    { name:'ลูกค้า',   color:'#059669', lists:['หมอไม้กับนายพอดี (ละครสั้น)'] }
  ]});
});
await p.waitForTimeout(900);

const state = () => p.evaluate(()=>{
  const vm = window.__app.renderVals ? null : null;
  return { open: window.__app.state.open };
});
const carets = () => p.evaluate(()=>[...document.querySelectorAll('span')]
  .map(s=>s.innerText.trim()).filter(t=>t==='▾'||t==='▸'));
const listsVisible = () => p.evaluate(()=>{
  const all=[...document.querySelectorAll('button,span,div')].map(e=>e.innerText||'');
  return { pet: all.some(t=>t.trim()==='Pet Shop'), lakorn: all.some(t=>t.includes('ละครสั้น')) };
});

// ---- A) เปิดมาต้องกางหมด ไม่มีลูกศรปิด
let c = await carets();
if (!c.length) fail('ไม่เจอลูกศรของ space');
if (c.includes('▸')) fail('มี space ที่ปิดอยู่ตั้งแต่เปิดเว็บ', c);

// ---- B) ลิสต์ข้างในต้องเห็นจริง
let v = await listsVisible();
if (!v.pet || !v.lakorn) fail('ลิสต์ใน space ไม่ขึ้น', v);

// ---- C) กดพับได้ (ครั้งแรกต้องปิด ไม่ใช่ไม่มีอะไรเกิดขึ้น)
const folded = await p.evaluate(async ()=>{
  const btn=[...document.querySelectorAll('button')].find(b=>b.innerText.includes('คอนเทนต์'));
  const car=[...document.querySelectorAll('span')].filter(s=>s.innerText.trim()==='▾');
  // ลูกศรเป็นปุ่มแยก หาปุ่มที่มีลูกศรอยู่ข้างใน
  const tog=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='▾');
  (tog||btn).click();
  await new Promise(r=>setTimeout(r,500));
  return { open: window.__app.state.open };
});
if (folded.open['คอนเทนต์'] !== false && folded.open['ลูกค้า'] !== false) {
  fail('กดพับแล้วไม่ปิด', folded.open);
}

// ---- D) space ที่เพิ่งสร้างใหม่ก็ต้องเปิด
const fresh = await p.evaluate(async ()=>{
  window.__app.setState(s=>({ spaces: s.spaces.concat([{name:'ของใหม่',color:'#dc2626',lists:['ลิสต์ใหม่']}]) }));
  await new Promise(r=>setTimeout(r,600));
  return [...document.querySelectorAll('button,span,div')].some(e=>(e.innerText||'').trim()==='ลิสต์ใหม่');
});
if (!fresh) fail('space ที่เพิ่งสร้างไม่ได้กางให้');

console.log('space: เปิดเว็บมากางหมด · พับได้ · space ใหม่ก็กาง');
console.log(errs.join('\n')||'no errors');
await b.close();
