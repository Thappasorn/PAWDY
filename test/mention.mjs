import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:1250,height:520}});
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
  const T=(id,name)=>({id:id,name:name,list:'Official',status:'Backlog',assignee:'Janji',assignees:['Janji'],
    due:'2026-09-02',start:'2026-08-28',tags:[],channel:'—',platform:'—',priority:'Normal',subtasks:[],comments:[],attachments:[],qty:1,cost:0,desc:'',custom:{},pos:1000});
  const now=Date.now();
  inst.setState({
    tasks:[T('T101','หมอไม้ x Pawdy_อาหารน้องแมว'), T('T102','Aw Gen Z ทายนิสัย'), T('T103','ถ่าย Pet Lap'), T('T104','งานเก่ามาก')],
    notifs:[
      {id:1,line:'Nan P. แท็กคุณในคอมเมนต์',detail:'“@Thappasorn ดูอันนี้หน่อย · T101”',at:now-60000,read:false,taskId:'T101',subject:'[Official] หมอไม้',from:'nan@pawdy.co.th'},
      {id:2,line:'Beam S. มอบหมายงานให้คุณ',detail:'· T102',at:now-120000,read:false,taskId:'T102',subject:'x',from:'beam@pawdy.co.th'},
      {id:3,line:'Ploy T. แท็กคุณในคอมเมนต์',detail:'“@Thappasorn · T103”',at:now-3600000,read:true,taskId:'T103',subject:'y',from:'ploy@pawdy.co.th'},
      {id:4,line:'Krit A. แท็กคุณในคอมเมนต์',detail:'“· T104”',at:now-7200000,read:true,taskId:'T104',subject:'z',from:'krit@pawdy.co.th'},
      {id:5,line:'Mai R. แท็กคุณในคอมเมนต์',detail:'“· T999 งานที่ถูกลบ”',at:now-9000000,read:true,taskId:'T999',subject:'w',from:'mai@pawdy.co.th'}
    ],
    view:'table', list:'__all'
  });
});
await p.waitForTimeout(900);
console.log('chips:', await p.evaluate(()=>{
  const d=document.querySelector('[data-mentions]');
  return d? [...d.querySelectorAll('button')].map(b=>b.innerText.trim()) : 'none';
}));
await p.screenshot({path:'/tmp/mention.png', clip:{x:236,y:0,width:1014,height:100}});
console.log(errs.join('\n')||'no errors');
await b.close();
