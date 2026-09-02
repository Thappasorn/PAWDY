import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:1250,height:620}});
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
    fields:[{id:'Ffm',label:'Format',type:'select',options:['Artwork','Video','Reels'],multi:true},
            {id:'Flk',label:'Link',type:'text',options:[],multi:false}],
    tasks:[{id:'T1',name:'ถ่ายงานที่โกดัง',list:'Official',status:'Backlog',assignee:'Janji',assignees:['Janji'],
      due:'2026-09-02',start:'2026-08-28',tags:[],channel:'—',platform:'—',priority:'Normal',subtasks:[],comments:[],attachments:[],qty:1,cost:0,desc:'',
      custom:{Ffm:['Video'], Flk:'https://drive.google.com/file/d/abc123/view'},pos:1000},
     {id:'T2',name:'งานไม่มีลิงก์',list:'Official',status:'Backlog',assignee:'Janji',assignees:['Janji'],
      due:'2026-09-02',start:'2026-08-28',tags:[],channel:'—',platform:'—',priority:'Normal',subtasks:[],comments:[],attachments:[],qty:1,cost:0,desc:'',
      custom:{Flk:'ยังไม่มีลิงก์'},pos:2000}],
    view:'table', list:'__all'
  });
});
await p.waitForTimeout(900);
console.log('link arrows in table:', await p.evaluate(()=>[...document.querySelectorAll('[data-task-row] a[href]')].map(a=>a.getAttribute('href'))));
// เปิดการ์ด
await p.evaluate(()=>window.__app.setState({selected:'T1'}));
await p.waitForTimeout(900);
console.log('link in detail card:', await p.evaluate(()=>{
  const as=[...document.querySelectorAll('a[href^="http"]')].map(a=>a.getAttribute('href'));
  return as.filter(h=>h.includes('drive.google'));
}));
await p.screenshot({path:'/tmp/link-card.png', clip:{x:300,y:80,width:900,height:420}});
console.log(errs.join('\n')||'no errors');
await b.close();
