import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:1400,height:800}});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
await p.route('**/exec*', route => route.fulfill({status:200, contentType:'application/json',
  body: JSON.stringify({ok:true, tabs:[{name:'ชีตทดสอบ', rows:[['A','B'],['1','2']]}]})}));
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
  inst.setState({ config: Object.assign({}, inst.state.config||{}, { sheetApi:{url:'https://x/exec',token:'t'},
    views:[{id:'V1',name:'Sheet ทีมตัดต่อ',type:'sheet',src:{id:'AAA',kind:'sheet'}}] }), view:'table', list:'__all', customView:null });
});
await p.waitForTimeout(1200);
console.log('จำนวนปุ่ม ✎:', await p.evaluate(()=>document.querySelectorAll('button[title="เปลี่ยนชื่อแท็บนี้"],button[title="เปลี่ยนชื่อมุมมองนี้"]').length));
// เปลี่ยนชื่อแท็บ Table
await p.locator('button[title="เปลี่ยนชื่อแท็บนี้"]').first().click({force:true});
await p.waitForTimeout(400);
await p.keyboard.press('Control+a'); await p.keyboard.type('ตารางงาน');
await p.keyboard.press('Enter');
await p.waitForTimeout(800);
console.log('viewLabels:', await p.evaluate(()=>JSON.stringify(window.__app.cfg().viewLabels||{})));
console.log('ป้ายแท็บ:', await p.evaluate(()=>JSON.stringify(window.__app.renderVals().viewTabs.map(t=>t.label))));
console.log('งานยังอยู่:', await p.evaluate(()=>window.__app.state.tasks.length + ' tasks, view=' + window.__app.state.view));
// เปลี่ยนชื่อ Dashboard แล้ว Esc
await p.locator('button[title="เปลี่ยนชื่อแท็บนี้"]').nth(5).click({force:true});
await p.waitForTimeout(400);
await p.keyboard.press('Control+a'); await p.keyboard.type('ห้ามเปลี่ยน');
await p.keyboard.press('Escape');
await p.waitForTimeout(600);
console.log('หลัง Esc:', await p.evaluate(()=>JSON.stringify(window.__app.renderVals().viewTabs.map(t=>t.label))));
// คืนค่าเดิมด้วยการพิมพ์ชื่อ default
await p.locator('button[title="เปลี่ยนชื่อแท็บนี้"]').first().click({force:true});
await p.waitForTimeout(400);
await p.keyboard.press('Control+a'); await p.keyboard.type('Table');
await p.keyboard.press('Enter');
await p.waitForTimeout(700);
console.log('คืนค่าเดิม → viewLabels:', await p.evaluate(()=>JSON.stringify(window.__app.cfg().viewLabels||{})));
await p.screenshot({path:'/tmp/tabs2.png', clip:{x:236,y:60,width:1100,height:70}});
console.log(errs.join('\n')||'no errors');
await b.close();
