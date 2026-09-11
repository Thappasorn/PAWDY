// ปุ่ม Export comment -> ได้ไฟล์ .csv ออกมาเลย ไม่ต้องวางเอง
import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const ctx = await b.newContext({acceptDownloads:true});
const p = await ctx.newPage();
await p.setViewportSize({width:1250,height:700});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
const fail=(m,x)=>{ console.log('FAIL '+m, x===undefined?'':JSON.stringify(x)); process.exit(1); };

// CSV parser เล็กๆ — ต้องแกะ "" ให้ถูก ไม่งั้นสูตร =IMAGE("...") จะพัง
const parseCsv = (txt) => {
  const rows=[]; let row=[], cur='', q=false;
  const t = txt.replace(/^﻿/,'');
  for (let i=0;i<t.length;i++){
    const c=t[i];
    if (q) {
      if (c==='"') { if (t[i+1]==='"'){ cur+='"'; i++; } else q=false; }
      else cur+=c;
    } else if (c==='"') q=true;
    else if (c===',') { row.push(cur); cur=''; }
    else if (c==='\r') {}
    else if (c==='\n') { row.push(cur); rows.push(row); row=[]; cur=''; }
    else cur+=c;
  }
  if (cur!=='' || row.length) { row.push(cur); rows.push(row); }
  return rows;
};

await p.goto('file://' + process.cwd() + '/index.html');
await p.waitForTimeout(2600);

const PNG='https://zk.supabase.co/storage/v1/object/public/task-images/T1/a.png';
const JPG='https://zk.supabase.co/storage/v1/object/public/task-images/T1/b.jpg';

await p.evaluate(({png,jpg})=>{
  const a=document.getElementById('pw-auth'); if(a) a.remove();
  const root=document.querySelector('[data-root]');
  const key=Object.keys(root).find(k=>k.startsWith('__reactFiber$'));
  let f=root[key], sc=null, g=0;
  while(f && g++<40){ if(f.stateNode && f.stateNode.setState){ sc=f.stateNode; break; } f=f.return; }
  let inst=null;
  for (const k of Object.keys(sc)) { const v=sc[k];
    if (v && typeof v==='object' && v.state && v.state.tasks!==undefined && typeof v.setState==='function') { inst=v; break; } }
  window.__app=inst;
  window.__alerts=[]; window.alert=(m)=>window.__alerts.push(String(m));
  const T=(id,name,comments,custom)=>({id,name,list:'Official',status:'Backlog',assignee:'Janji',assignees:['Janji'],
    due:'2026-09-11',start:'2026-09-08',tags:[],channel:'—',platform:'—',priority:'Normal',subtasks:[],
    comments:comments||[],attachments:[],qty:1,cost:0,desc:'',custom:custom||{},pos:1000});
  inst.setState({ view:'table', list:'__all', tasks:[
    T('T1','งานหนึ่ง',[
      {author:'Korn', text:'ปกใหม่ '+png, when:'just now', at:Date.UTC(2026,8,11,4,30)},
      {author:'Ploy', text:'สองรูป '+png+' '+jpg, when:'1d ago'},
      {author:'Ploy', text:'มี "อัญประกาศ" กับ, คอมมา\nและขึ้นบรรทัดใหม่', when:'2d ago'}
    ]),
    T('T2','งานสอง',[],{F1:[{author:'Beam', text:'ใน field '+jpg, when:'just now'}], F2:'ค่าธรรมดา'}),
    T('T3','ไม่มีคอมเมนต์',[])
  ]});
}, {png:PNG, jpg:JPG});
await p.waitForTimeout(700);

// ---- กดปุ่ม ❝ บนแถบบน -> ต้องได้ไฟล์ดาวน์โหลดออกมาเลย ไม่มี popup ให้กดต่อ
const btn = await p.$('button[title^="Export คอมเมนต์ทุกงาน"]');
if (!btn) fail('ไม่เจอปุ่ม export ทุกงานบนแถบบน');
const [dl] = await Promise.all([ p.waitForEvent('download', {timeout:8000}), btn.click() ]);

const name = dl.suggestedFilename();
if (!/^Pawdy_comments_.*\.csv$/.test(name)) fail('ชื่อไฟล์', name);
const leftover = await p.evaluate(()=>window.__alerts.join(' '));
if (leftover) fail('ยังมี popup ให้คนกดต่อ', leftover);

const fs = await import('fs');
const csv = fs.readFileSync(await dl.path(), 'utf8');
if (!csv.startsWith('﻿')) fail('ไม่มี BOM — Excel จะอ่านภาษาไทยเพี้ยน');

const rows = parseCsv(csv);
if (rows.length !== 5) fail('จำนวนแถว (หัว+4)', rows.length);
if (rows[0].length !== 9 || rows[0][0] !== 'Task ID' || rows[0][7] !== 'รูป') fail('หัวตาราง', rows[0]);

const r1 = rows[1];
if (r1[2] !== 'งานหนึ่ง' || r1[3] !== 'Korn') fail('ข้อมูลแถวแรก', r1);
if (!r1[4].includes('11/9/2026')) fail('เวลาไม่ได้แปลงจาก at', r1[4]);
if (r1[5] !== 'ปกใหม่') fail('ข้อความต้องไม่มี URL', r1[5]);
if (r1[6] !== '1') fail('นับรูป', r1[6]);
// อาร์กิวเมนต์เดียว ไม่งั้น Excel ขึ้น #VALUE! (ลำดับพารามิเตอร์คนละแบบกับ Google Sheets)
if (r1[7] !== '=IMAGE("'+PNG+'")') fail('สูตร IMAGE แกะกลับมาไม่ตรง', r1[7]);
if (/IMAGE\([^)]*,/.test(r1[7])) fail('สูตรมีอาร์กิวเมนต์เกิน Excel จะพัง', r1[7]);
if (r1[8] !== PNG) fail('ลิงก์รูป', r1[8]);

if (rows[2][6] !== '2') fail('นับสองรูป', rows[2][6]);
if (rows[2][8] !== PNG+'\n'+JPG) fail('ลิงก์ทั้งหมดไม่ครบ', rows[2][8]);

// อัญประกาศ / คอมมา / ขึ้นบรรทัดใหม่ ต้องไม่ทำคอลัมน์เลื่อน
const r3 = rows[3];
if (r3.length !== 9) fail('อักขระพิเศษทำคอลัมน์เพี้ยน', r3);
if (!r3[5].includes('"อัญประกาศ"') || !r3[5].includes(', คอมมา')) fail('ข้อความเพี้ยน', r3[5]);
if (!r3[5].includes('\n')) fail('ขึ้นบรรทัดใหม่ในเซลล์ต้องยังอยู่', r3[5]);

if (rows[4][0] !== 'T2' || rows[4][3] !== 'Beam') fail('คอมเมนต์ใน custom field หาย', rows[4]);

// ---- ปุ่ม "Export comment" ในการ์ด -> เฉพาะงานนั้น
await p.evaluate(()=>window.__app.setState({selected:'T1'}));
await p.waitForTimeout(900);
const perBtn = await p.$('button[title^="Export คอมเมนต์ของงานนี้"]');
if (!perBtn) fail('ไม่เจอปุ่ม Export comment บนหัวช่อง comment');
const [dl2] = await Promise.all([ p.waitForEvent('download', {timeout:8000}), perBtn.click() ]);
const rows2 = parseCsv(fs.readFileSync(await dl2.path(), 'utf8'));
if (rows2.length !== 4) fail('ปุ่มในการ์ดควรได้หัว+3', rows2.length);
if (rows2.some(r=>r[0]==='T2')) fail('งานอื่นหลุดมา', rows2.map(r=>r[0]));
if (!dl2.suggestedFilename().includes('งานหนึ่ง')) fail('ชื่อไฟล์ไม่มีชื่องาน', dl2.suggestedFilename());

// ---- ไม่มีคอมเมนต์ -> เตือน ไม่สร้างไฟล์เปล่า
const empty = await p.evaluate(async ()=>{
  window.__app.setState(s=>({selected:null, tasks:s.tasks.map(t=>Object.assign({},t,{comments:[],custom:{}}))}));
  await new Promise(r=>setTimeout(r,400));
  window.__alerts=[];
  window.__app.exportComments();
  return window.__alerts.join(' ');
});
if (!empty.includes('ยังไม่มีคอมเมนต์')) fail('ไม่เตือนตอนไม่มีคอมเมนต์', empty);

console.log('ไฟล์:', name, '| แถว:', rows.length, '| สูตร IMAGE: ok | อักขระพิเศษ: ok');
console.log(errs.join('\n')||'no errors');
await b.close();
