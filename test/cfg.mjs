import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:1100,height:500}});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
await p.goto('file://' + process.cwd() + '/index.html');
await p.waitForTimeout(2500);
console.log(await p.evaluate(()=>{
  const root=document.querySelector('[data-root]');
  const key=Object.keys(root).find(k=>k.startsWith('__reactFiber$'));
  let f=root[key], sc=null, g=0;
  while(f && g++<40){ if(f.stateNode && f.stateNode.setState){ sc=f.stateNode; break; } f=f.return; }
  let inst=null;
  for (const k of Object.keys(sc)) { const v=sc[k];
    if (v && typeof v==='object' && v.state && v.state.tasks!==undefined && typeof v.setState==='function') { inst=v; break; } }
  // ใส่ค่าแปลกๆ ที่โค้ด saveCfg ไม่รู้จัก แล้วสั่ง saveCfg ดูว่าหายไหม
  inst.state.config = Object.assign({}, inst.state.config||{}, {
    sheetApi:{url:'https://x/exec', token:'tok'}, myRandomKey:'ต้องไม่หาย'
  });
  inst.saveCfg({ listColors: { a:'#fff' } });          // จำลอง "กด + View / แก้ตั้งค่า"
  const c = inst.state.config||{};
  return JSON.stringify({ sheetApi: !!(c.sheetApi&&c.sheetApi.url), custom: c.myRandomKey||null, listColors: !!c.listColors });
}));
console.log(errs.join('\n')||'no errors');
await b.close();
