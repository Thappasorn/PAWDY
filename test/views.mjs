import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:1300,height:800}});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
const seen=[];
await p.route('**/exec*', route => {
  const u = route.request().url(); seen.push(u.replace(/&t=\d+/,''));
  const isDoc = /[?&]doc=/.test(u);
  const id = (u.match(/[?&](?:id|doc)=([^&]+)/)||[])[1] || '';
  route.fulfill({status:200, contentType:'application/json', body: JSON.stringify( isDoc
    ? {ok:true, tabs:[{name:'บรีฟงาน '+id, rows:[['หัวข้อ:'],['บรรทัดแรกของเอกสาร'],[''],['https://drive.google.com/file/d/1a/view']]}]}
    : {ok:true, tabs:[{name:'ชีตของ '+id, rows:[['COL A','COL B'],['x1','y1'],['x2','y2']]}]} )});
});
await p.goto('file://' + process.cwd() + '/index.html');
await p.waitForTimeout(2600);
const boot = async () => p.evaluate(()=>{
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
  inst.setState({ config: Object.assign({}, inst.state.config||{}, { sheetApi:{url:'https://x/exec',token:'t'}, views:[] }), view:'sheet', list:'__all', customView:null });
});
await boot();
await p.waitForTimeout(1200);
// สร้าง view A
await p.evaluate(()=>window.__app.createView('sheet','Sheet A'));
await p.waitForTimeout(900);
console.log('A ยังไม่ต่อ → มีช่องวางลิงก์:', await p.evaluate(()=>!!document.querySelector('input[placeholder^="https://docs.google.com"]')));
await p.fill('input[placeholder^="https://docs.google.com"]','https://docs.google.com/spreadsheets/d/AAAAAAAAAAAAAAAAAAAAAAAAAA/edit');
await p.locator('button:has-text("เชื่อม")').first().click({force:true});
await p.waitForTimeout(1400);
console.log('A tab:', await p.evaluate(()=>window.__app.renderVals().sheetVM.tabName));
// สร้าง view B ต่อ Google Doc
await p.evaluate(()=>window.__app.createView('sheet','Doc B'));
await p.waitForTimeout(900);
console.log('B ยังไม่ต่อ → มีช่องวางลิงก์:', await p.evaluate(()=>!!document.querySelector('input[placeholder^="https://docs.google.com"]')));
await p.fill('input[placeholder^="https://docs.google.com"]','https://docs.google.com/document/d/BBBBBBBBBBBBBBBBBBBBBBBBBB/edit');
await p.locator('button:has-text("เชื่อม")').first().click({force:true});
await p.waitForTimeout(1400);
console.log('B doc:', await p.evaluate(()=>{const v=window.__app.renderVals().sheetVM;return JSON.stringify({isDoc:v.isDoc,showDoc:v.showDoc,lines:v.docLines.map(l=>l.text)});}));
// สลับกลับ A
const ids = await p.evaluate(()=>window.__app.savedViews().map(v=>({id:v.id,name:v.name,src:v.src||null})));
console.log('views:', JSON.stringify(ids));
await p.evaluate(id=>window.__app.openSavedView(id), ids[0].id);
await p.waitForTimeout(1500);
console.log('กลับมา A:', await p.evaluate(()=>{const v=window.__app.renderVals().sheetVM;return JSON.stringify({tab:v.tabName, doc:v.isDoc, heads:v.headCells.map(h=>h.label)});}));
console.log('calls:', JSON.stringify(seen.map(u=>u.replace('https://x/exec?token=t',''))));
console.log(errs.join('\n')||'no errors');
await b.close();
