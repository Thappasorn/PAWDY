// ปุ่มก๊อปคอมเมนต์ -> TSV ที่วางในชีตเปล่าได้เลย
import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const ctx = await b.newContext({permissions:['clipboard-read','clipboard-write']});
const p = await ctx.newPage();
await p.setViewportSize({width:1250,height:700});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
const fail=(m,x)=>{ console.log('FAIL '+m, x===undefined?'':JSON.stringify(x)); process.exit(1); };
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
      {author:'Ploy', text:'บรรทัดแรก\nบรรทัดสอง\tมีแท็บ', when:'2d ago'}
    ]),
    T('T2','งานสอง',[],{F1:[{author:'Beam', text:'ใน field '+jpg, when:'just now'}], F2:'ค่าธรรมดา'}),
    T('T3','ไม่มีคอมเมนต์',[])
  ]});
}, {png:PNG, jpg:JPG});
await p.waitForTimeout(700);

// ปุ่มต้องอยู่บนแถบบนจริง และกดได้
const btn = await p.$('button[title^="ก๊อปคอมเมนต์ทุกงาน"]');
if (!btn) fail('ไม่เจอปุ่มก๊อปคอมเมนต์บนแถบบน');
await btn.click();
await p.waitForTimeout(500);

const alerted = await p.evaluate(()=>window.__alerts.join(' '));
if (!alerted.includes('4 รายการ')) fail('แจ้งจำนวนไม่ถูก (ควรได้ 4 รวมคอมเมนต์ใน custom field)', alerted);
if (!alerted.includes('⌘V')) fail('ไม่ได้บอกวิธีวาง', alerted);

const tsv = await p.evaluate(()=>navigator.clipboard.readText());
const lines = tsv.split('\n');
if (lines.length !== 5) fail('จำนวนบรรทัด (หัว+4)', lines.length);

const head = lines[0].split('\t');
if (head[0] !== 'Task ID' || head[7] !== 'รูป') fail('หัวตาราง', head);
if (head.length !== 9) fail('จำนวนคอลัมน์', head.length);

const r1 = lines[1].split('\t');
if (r1.length !== 9) fail('แถวแรกคอลัมน์ไม่ครบ', r1);
if (r1[2] !== 'งานหนึ่ง' || r1[3] !== 'Korn') fail('ข้อมูลแถวแรก', r1);
if (!r1[4].includes('11/9/2026')) fail('เวลาไม่ได้แปลงจาก at', r1[4]);
if (r1[5] !== 'ปกใหม่') fail('ข้อความต้องไม่มี URL', r1[5]);
if (r1[6] !== '1') fail('นับรูป', r1[6]);
if (!r1[7].startsWith('=IMAGE("'+PNG)) fail('ต้องเป็นสูตร IMAGE', r1[7]);

const r2 = lines[2].split('\t');
if (r2[6] !== '2') fail('นับสองรูป', r2[6]);
if (r2[8] !== PNG+' '+JPG) fail('ลิงก์ทั้งหมดไม่ครบ', r2[8]);

// tab/newline ในข้อความต้องไม่ทำคอลัมน์เลื่อน
const r3 = lines[3].split('\t');
if (r3.length !== 9) fail('tab/newline ในข้อความทำคอลัมน์เพี้ยน', r3);
if (r3[5].includes('\t')) fail('ยังมี tab ในเซลล์', r3[5]);
if (!r3[5].includes('บรรทัดแรก / บรรทัดสอง')) fail('ไม่ได้แปลง newline', r3[5]);

// คอมเมนต์ใน custom field
const r4 = lines[4].split('\t');
if (r4[0] !== 'T2' || r4[3] !== 'Beam') fail('คอมเมนต์ใน custom field หาย', r4);

// ปุ่ม "Export comment" บนหัวช่อง comment ในการ์ด -> ก๊อปแค่ของงานนั้น
const perTask = await p.evaluate(async ()=>{
  window.__app.setState({selected:'T1'});
  await new Promise(r=>setTimeout(r,900));
  const btn=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Export comment');
  if (!btn) return { noBtn:true };
  window.__alerts=[];
  btn.click();
  await new Promise(r=>setTimeout(r,500));
  return { alerted: window.__alerts.join(' '), tsv: await navigator.clipboard.readText() };
});
if (perTask.noBtn) fail('ไม่เจอปุ่ม Export comment บนหัวช่อง comment');
if (!perTask.alerted.includes('ของงานนี้ 3 รายการ')) fail('ควรได้แค่ 3 คอมเมนต์ของ T1', perTask.alerted);
const ptLines = perTask.tsv.split('\n');
if (ptLines.length !== 4) fail('ปุ่มในการ์ดควรได้หัว+3 บรรทัด', ptLines.length);
if (ptLines.some(l=>l.startsWith('T2'))) fail('งานอื่นหลุดมาด้วย', ptLines);
await p.evaluate(()=>window.__app.setState({selected:null}));
await p.waitForTimeout(400);

// ไม่มีคอมเมนต์เลยต้องเตือน ไม่ก๊อปว่าง
const empty = await p.evaluate(async ()=>{
  window.__app.setState(s=>({tasks:s.tasks.map(t=>Object.assign({},t,{comments:[],custom:{}}))}));
  await new Promise(r=>setTimeout(r,400));
  window.__alerts=[];
  window.__app.copyComments();
  return window.__alerts.join(' ');
});
if (!empty.includes('ยังไม่มีคอมเมนต์')) fail('ไม่เตือนตอนไม่มีคอมเมนต์', empty);

console.log('บรรทัด:', lines.length, '| คอลัมน์:', head.length, '| สูตร IMAGE: ok');
console.log(errs.join('\n')||'no errors');
await b.close();
