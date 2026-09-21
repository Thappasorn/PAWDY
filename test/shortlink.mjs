// ลิงก์ของงานต้องสั้น และเปิดกลับมาได้ถูกงาน
import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const ctx = await b.newContext({permissions:['clipboard-read','clipboard-write']});
const p = await ctx.newPage();
await p.setViewportSize({width:1350,height:880});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
const fail=(m,x)=>{ console.log('FAIL '+m, x===undefined?'':JSON.stringify(x)); process.exit(1); };
const LIST='หมอไม้กับนายพอดี (ละครสั้น)';

const boot = async (hash) => {
  await p.goto('file://' + process.cwd() + '/index.html' + (hash||''));
  await p.waitForTimeout(2600);
  await p.evaluate((list)=>{
    const a=document.getElementById('pw-auth'); if(a) a.remove();
    const root=document.querySelector('[data-root]');
    const key=Object.keys(root).find(k=>k.startsWith('__reactFiber$'));
    let f=root[key], sc=null, g=0;
    while(f && g++<40){ if(f.stateNode && f.stateNode.setState){ sc=f.stateNode; break; } f=f.return; }
    let inst=null;
    for (const k of Object.keys(sc)) { const v=sc[k];
      if (v && typeof v==='object' && v.state && v.state.tasks!==undefined && typeof v.setState==='function') { inst=v; break; } }
    window.__app=inst;
    inst.setState({ view:'table', list:list, tasks:[{
      id:'T87052', name:'งานทดสอบลิงก์', list:list, status:'Backlog', assignee:'Janji', assignees:['Janji'],
      due:'2026-10-09', start:'2026-09-20', tags:[], channel:'—', platform:'—', priority:'Normal',
      subtasks:[{t:'ก',done:false},{t:'ข',done:false}], comments:[], attachments:[], qty:1, cost:0,
      desc:'', custom:{}, pos:1000 }]});
  }, LIST);
  await p.waitForTimeout(800);
};

await boot();

// ---- A) ลิงก์ต้องสั้น ไม่มีชื่อ list ที่ถูก encode
const link = await p.evaluate(()=>window.__app.taskLink('T87052'));
if (!/#\/t\/T87052$/.test(link)) fail('รูปแบบลิงก์ไม่ใช่แบบสั้น', link);
if (link.includes('%E0%B8')) fail('ยังมีชื่อไทยที่ถูก encode ในลิงก์', link);
const hash = link.slice(link.indexOf('#'));
if (hash.length > 20) fail('ลิงก์ยังยาวเกิน', hash);

// ---- B) ลิงก์ subtask ก็ต้องสั้น
const sub = await p.evaluate(()=>window.__app.taskLink('T87052', 1));
if (!/#\/t\/T87052\/sub\/2$/.test(sub)) fail('ลิงก์ subtask ผิด', sub);

// ---- C) เปิดลิงก์สั้นแล้วต้องได้งานนั้น และพื้นหลังเด้งไป list ของงาน
await boot('#/t/T87052');
let st = await p.evaluate(()=>({ sel: window.__app.state.selected, list: window.__app.state.list }));
if (st.sel !== 'T87052') fail('เปิดลิงก์สั้นแล้วไม่ได้เลือกงาน', st);

// จำลองว่าข้อมูลมาถึงทีหลัง -> list ต้องถูกเติมให้
const filled = await p.evaluate(async (list)=>{
  window.__app._routeTask = 'T87052';
  window.__app._routeTaskOnly = true;
  window.__app.setState({ list: '__all' });
  await new Promise(r=>setTimeout(r,200));
  // เลียนแบบจุดที่ข้อมูลเข้ามา
  const incoming = window.__app.state.tasks;
  const rt = incoming.filter(t=>t.id===window.__app._routeTask)[0];
  const only = window.__app._routeTaskOnly;
  window.__app._routeTask=null; window.__app._routeTaskOnly=false;
  let want = rt.deleted ? '__trash' : (rt.archived ? '__archive' : null);
  if (!want && only && rt.list) want = rt.list;
  if (want) window.__app.setState({ list: want });
  await new Promise(r=>setTimeout(r,300));
  return window.__app.state.list;
}, LIST);
if (filled !== LIST) fail('ลิงก์สั้นไม่ได้เติม list ให้', filled);

// ---- D) ลิงก์สั้นที่ชี้ subtask ต้องตั้ง subFocus ถูก
await boot('#/t/T87052/sub/2');
st = await p.evaluate(()=>({ sel: window.__app.state.selected, sf: window.__app.state.subFocus }));
if (st.sel !== 'T87052') fail('subtask link ไม่ได้เลือกงาน', st);
if (!st.sf || st.sf.i !== 1) fail('subFocus ผิด', st);

// ---- E) ลิงก์แบบเดิมต้องยังเปิดได้ (ของที่แชร์ไปแล้วต้องไม่พัง)
await boot('#/list/' + encodeURIComponent(LIST) + '/table/task/T87052');
st = await p.evaluate(()=>({ sel: window.__app.state.selected, list: window.__app.state.list }));
if (st.sel !== 'T87052') fail('ลิงก์แบบเดิมเปิดไม่ได้', st);
if (st.list !== LIST) fail('ลิงก์แบบเดิม list ผิด', st);

console.log('ลิงก์:', hash, '| subtask:', sub.slice(sub.indexOf('#')), '| ของเดิมยังเปิดได้');
console.log(errs.join('\n')||'no errors');
await b.close();
