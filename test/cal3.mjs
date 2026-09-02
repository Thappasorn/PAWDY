import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:1300,height:800}});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
// เลียนแบบโครงจริง: 7 คอลัมน์วัน + 1 คอลัมน์โน้ต, ท้ายตารางเป็น "july" ล้วน
const rows2026 = [
  ['','','','','','','','บันทึกประจำสัปดาห์'],
  ['','','','1JAN','2JAN','3JAN\nงานสาม','4JAN',''],
  ['5JAN','6JAN\nหลัก - แมวเห็นผี\nhttps://drive.google.com/file/d/15q7/view','7JAN','8JAN','9JAN','10JAN','11JAN','คลิปออกรายการ'],
  ['22jun','23jun','24jun','25jun','26jun','27jun','28jun',''],
  ['29jun','30jun','july\n068_พี่ต้องตอบคอมเมนต์','july\n069_พี่ต้องตอบคอมเมนต์','july\npawdyguide shiba','july\nPawdyguide โกลเด้น','july',''],
  ['july\nPawdyguide ดัชชุน','july','july','july','july\npromote pet expo','july','july',''],
  ['july\nceo -07-คำโฆษณา','july\nceo -08-คำถามที่ลูกค้าถาม','july\nceo -เบื้องหลัง Petlab','july\nceo -แมวจรพี่จูตี้\ntest','july','',''],
];
await p.route('**/exec*', route => route.fulfill({status:200, contentType:'application/json', body: JSON.stringify({
  ok:true, tabs:[{name:'Sync', rows:[['ID','ชื่อ'],['T1','ก']]}, {name:'2026', rows: rows2026}]
})}));
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
  inst.setState({ config: Object.assign({}, inst.state.config||{}, { sheetApi:{url:'https://x/exec',token:'t'} }), view:'sheet', list:'__all' });
});
await p.waitForTimeout(1500);
await p.locator('button:has-text("2026")').first().click({force:true});
await p.waitForTimeout(800);
console.log('chips:', await p.evaluate(()=>JSON.stringify(window.__app.renderVals().sheetVM.calendar.monthChips.map(m=>m.label))));
await p.evaluate(()=>window.__app.setState({sheetCalMon:6}));
await p.waitForTimeout(700);
console.log('JULY:', await p.evaluate(()=>{
  const c=window.__app.renderVals().sheetVM.calendar;
  return JSON.stringify({label:c.label, filled:c.days.filter(d=>d.inMonth&&d.items.length).map(d=>d.num+':'+d.items.map(x=>x.text).join('/').slice(0,40))});
}));
await p.screenshot({path:'/tmp/cal-jul.png', clip:{x:236,y:60,width:1060,height:700}});
await p.evaluate(()=>window.__app.setState({sheetCalMon:0}));
await p.waitForTimeout(600);
console.log('JAN:', await p.evaluate(()=>{
  const c=window.__app.renderVals().sheetVM.calendar;
  return JSON.stringify({filled:c.days.filter(d=>d.inMonth&&d.items.length).map(d=>d.num+':'+d.items[0].text.slice(0,20))});
}));
console.log(errs.join('\n')||'no errors');
await b.close();
