import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:1150,height:560}});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
await p.goto('file://' + process.cwd() + '/index.html');
await p.waitForTimeout(2500);
await p.evaluate(()=>{
  document.documentElement.setAttribute('data-pw-theme','dark');
  const a=document.getElementById('pw-auth'); if(a) a.remove();
  const root=document.querySelector('[data-root]');
  const key=Object.keys(root).find(k=>k.startsWith('__reactFiber$'));
  let f=root[key], sc=null, g=0;
  while(f && g++<40){ if(f.stateNode && f.stateNode.setState){ sc=f.stateNode; break; } f=f.return; }
  let inst=null;
  for (const k of Object.keys(sc)) { const v=sc[k];
    if (v && typeof v==='object' && v.state && v.state.tasks!==undefined && typeof v.setState==='function') { inst=v; break; } }
  window.__app=inst;
  inst.setState({tasks:[{id:'T1',name:'ถ่ายงานที่โกดัง',list:'Official',status:'Backlog',assignee:'Janji',assignees:['Janji'],
    due:'2026-09-02',start:'2026-08-28',tags:[],channel:'—',platform:'—',priority:'Normal',subtasks:[],comments:[],attachments:[],qty:1,cost:0,desc:'',custom:{},pos:1000}],
    view:'table', list:'__all'});
});
await p.waitForTimeout(700);
// เปลี่ยนสถานะเป็น Done
await p.evaluate(()=>window.__app.patch('T1','status', window.__app.doneKey()));
await p.waitForTimeout(900);
console.log('toast:', await p.evaluate(()=>{
  const el=document.querySelector('[data-toast]');
  return el? JSON.stringify({text:el.innerText.replace(/\n/g,' | '), opacity:getComputedStyle(el).opacity}) : 'ไม่มี toast';
}));
await p.screenshot({path:'/tmp/toast.png', clip:{x:640,y:400,width:510,height:160}});
await p.waitForTimeout(2800);
console.log('กำลังจาง:', await p.evaluate(()=>{const el=document.querySelector('[data-toast]');return el?getComputedStyle(el).opacity:'หายแล้ว';}));
await p.waitForTimeout(900);
console.log('หลังหมดเวลา:', await p.evaluate(()=>document.querySelector('[data-toast]')?'ยังอยู่':'หายแล้ว'));
// กด Done ซ้ำต้องไม่เด้งอีก
await p.evaluate(()=>window.__app.patch('T1','status', window.__app.doneKey()));
await p.waitForTimeout(400);
console.log('กด Done ซ้ำ:', await p.evaluate(()=>document.querySelector('[data-toast]')?'เด้งอีก (ไม่ควร)':'ไม่เด้ง ✓'));
console.log(errs.join('\n')||'no errors');
await b.close();
