import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:1250,height:560}});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
await p.goto('file://' + process.cwd() + '/index.html');
await p.waitForTimeout(2600);
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
  inst.setState({
    fields:[{id:'Ffl',label:'Freelance',type:'select',options:['พี่เอ๋','กร'],multi:true}],
    tasks:[{id:'T1',name:'ถ่ายงานที่โกดัง',list:'Official',status:'Backlog',assignee:'Unassigned',assignees:['Unassigned'],
            due:'2026-08-20',start:'2026-08-12',tags:[],channel:'—',platform:'—',priority:'Normal',subtasks:[],comments:[],attachments:[],qty:1,cost:0,desc:'',custom:{},pos:1000}],
    view:'table', list:'__all', query:''
  });
});
await p.waitForTimeout(800);
console.log('rows before:', await p.evaluate(()=>document.querySelectorAll('[data-task-row]').length));
await p.locator('button:has-text("+ Add task")').first().click({force:true});
await p.waitForTimeout(700);
console.log('rows after click:', await p.evaluate(()=>document.querySelectorAll('[data-task-row]').length));
console.log('focused:', await p.evaluate(()=>{
  const el=document.activeElement;
  return el ? (el.tagName+'/'+(el.value===''?'(empty)':el.value)+'/'+(!!el.closest('[data-task-row]'))) : 'none';
}));
console.log('composer panel present:', await p.evaluate(()=>!!document.querySelector('[data-panel] select')));
await p.keyboard.type('งานใหม่จากแถว');
await p.waitForTimeout(400);
await p.keyboard.press('Enter');
await p.waitForTimeout(700);
console.log('rows after Enter:', await p.evaluate(()=>document.querySelectorAll('[data-task-row]').length));
console.log('names:', await p.evaluate(()=>window.__app.state.tasks.map(t=>t.name+'|'+t.status)));
await p.screenshot({path:'/tmp/inline.png', clip:{x:236,y:120,width:1014,height:230}});
await p.keyboard.press('Escape');
await p.waitForTimeout(600);
console.log('after Esc on empty row → rows:', await p.evaluate(()=>document.querySelectorAll('[data-task-row]').length),
  '| deleted flags:', await p.evaluate(()=>window.__app.state.tasks.map(t=>(t.name||'(ว่าง)')+':'+(t.deleted?'ลบ':'อยู่')).join(', ')));
console.log(errs.join('\n')||'no errors');
await b.close();
