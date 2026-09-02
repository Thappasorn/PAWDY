import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:1250,height:700}});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
let lastUrl='';
await p.route('**/exec*', route => { lastUrl = route.request().url(); route.fulfill({status:200, contentType:'application/json', body: JSON.stringify({
  ok:true, tabs:[
    {name:'Sync', rows:[
      ['TASK ID','LIST','ชื่องาน','STATUS','ผู้รับผิดชอบ','','LINK POST'],
      ['T42066','Official','New task','Done','Janji','','https://www.facebook.com/share/p/1abc/'],
      ['T29203','Official','หมอไม้ x Pawdy_ทำไมคำรักหมา','ถ่ายทำ / กำลังทำ','Thappasorn','',''],
      ['T79939','','ตารางถ่าย','รับบรีฟ','','','']]},
    {name:'Content Plan', rows:[
      ['PAWDY · CONTENT & MEDIA PLAN — GANTT TIMELINE','','','','','','','','',''],
      ['เริ่ม Timeline ▶','28 ก.ค. 2026','← แก้วันเดียว Timeline เลื่อนทั้งแถบ','','','','','','',''],
      ['ช่อง / คอนเทนต์','วันเริ่มงาน','วันเสร็จงาน','วันลงสื่อ','ถ่ายใคร','คนตัด / คนทำ','สถานะ','Link drive','Note',''],
      ['Double Day 6.6','02/06','05/06','05/06','พี่เอ๋','กร','ลงสื่อแล้ว','https://drive.google.com/file/d/1a/view','',''],
      ['midmonth 15.6','08/06','13/06','13/06','บิ้ก','คุณอาร์ท (กร)','ถ่ายแล้ว','','','']]},
    {name:'2026', rows:[
      ['','','','','','','',''],
      ['4JAN','5JAN','6JAN\nหลัก - ทาสตื่นแล้ว_แมวเห็นผีจริงไหม\nhttps://drive.google.com/file/d/15q7/view','7JAN\nหลัก-น้องหมาชอบวิ่งไล่หาง','8JAN','9JAN','10JAN','']]}
  ]})});});
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
  try{ localStorage.removeItem('pawdy.sheetHead'); }catch(e){}
  inst._sheetHead=null;
  inst.setState({ config: Object.assign({}, inst.state.config||{}, { sheetApi:null }), view:'sheet', list:'__all' });
});
await p.waitForTimeout(900);
console.log('== ยังไม่เชื่อม: มีช่องวางลิงก์ไหม');
console.log('   input:', await p.evaluate(()=>!!document.querySelector('input[placeholder^="https://docs.google.com"]')));
// วางลิงก์แล้วกดเชื่อม
await p.fill('input[placeholder^="https://docs.google.com"]','https://docs.google.com/spreadsheets/d/1cWY6vCPivUwbJBz2rKOX6Oc2H6pRPWjZ-EY14KDNsRY/edit?gid=0#gid=0');
await p.locator('button:has-text("เชื่อม")').first().click({force:true});
await p.waitForTimeout(1500);
console.log('   fetched url has id:', /id=1cWY6vCPivUwbJBz2rKOX6Oc2H6pRPWjZ-EY14KDNsRY/.test(lastUrl), '|', lastUrl.slice(0,120));
console.log('   cfg.sheetApi:', await p.evaluate(()=>JSON.stringify((window.__app.cfg().sheetApi)||null)));
const dump = async(tag)=>console.log(tag, await p.evaluate(()=>{
  const vm=window.__app.renderVals().sheetVM;
  return JSON.stringify({tab:vm.tabName, head:vm.headPickLabel, heads:vm.headCells.map(h=>h.label),
    row1:(vm.bodyRows[0]||{cells:[]}).cells.map(c=>c.text), rows:vm.bodyRows.length});
}));
await dump('== Sync   ');
console.log('   align:', await p.evaluate(()=>{
  const rows=[...document.querySelectorAll('[data-root] div')].filter(d=>d.style.display==='flex'&&d.style.width&&d.children.length>2).slice(0,4);
  return rows.map(r=>[...r.children].map(c=>Math.round(c.getBoundingClientRect().left)).join(','));
}));
await p.locator('button:has-text("Content Plan")').first().click({force:true});
await p.waitForTimeout(700);
await dump('== Plan   ');
await p.screenshot({path:'/tmp/sh-plan.png', clip:{x:236,y:80,width:1014,height:330}});
await p.locator('button:has-text("▼")').first().click({force:true});
await p.waitForTimeout(500);
await dump('== Plan+1 ');
await p.locator('button:has-text("หัวตาราง")').first().click({force:true});
await p.waitForTimeout(500);
await dump('== Plan A ');
await p.locator('button:has-text("2026")').first().click({force:true});
await p.waitForTimeout(700);
console.log('== 2026 calendar:', await p.evaluate(()=>{const vm=window.__app.renderVals().sheetVM;return JSON.stringify({on:vm.calendar.on, showCal:vm.showCalendar});}));
await p.locator('button:has-text("Sync")').first().click({force:true});
await p.waitForTimeout(600);
await p.screenshot({path:'/tmp/sh-sync.png', clip:{x:236,y:80,width:1014,height:330}});
console.log(errs.join('\n')||'no errors');
await b.close();
