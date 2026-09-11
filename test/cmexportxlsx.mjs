// Export comment -> ไฟล์ .xlsx ที่ฝังรูปไว้ในไฟล์ เปิดได้ทุกโปรแกรมไม่ต้องต่อเน็ต
import pw from 'playwright';
import fs from 'fs';
const { chromium } = pw;
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC','base64');

const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const ctx = await b.newContext({acceptDownloads:true});
const p = await ctx.newPage();
await p.setViewportSize({width:1250,height:700});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
const fail=(m,x)=>{ console.log('FAIL '+m, x===undefined?'':JSON.stringify(x)); process.exit(1); };

// เสิร์ฟรูปจริงแทน bucket
let served = 0;
await p.route('**/task-images/**', route => { served++; route.fulfill({status:200, contentType:'image/png', body:PNG1}); });

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
      {author:'Ploy', text:'มี "อัญประกาศ" กับ, คอมมา\nและขึ้นบรรทัดใหม่ ไม่มีรูป', when:'2d ago'}
    ]),
    T('T2','งานสอง',[],{F1:[{author:'Beam', text:'ใน field '+jpg, when:'just now'}], F2:'ค่าธรรมดา'}),
    T('T3','ไม่มีคอมเมนต์',[])
  ]});
}, {png:PNG, jpg:JPG});
await p.waitForTimeout(700);

const btn = await p.$('button[title^="Export คอมเมนต์ทุกงาน"]');
if (!btn) fail('ไม่เจอปุ่ม export ทุกงานบนแถบบน');
const [dl] = await Promise.all([ p.waitForEvent('download', {timeout:20000}), btn.click() ]);

const name = dl.suggestedFilename();
if (!/^Pawdy_comments_.*\.xlsx$/.test(name)) fail('ชื่อไฟล์ต้องเป็น .xlsx', name);
if (served !== 3) fail('ควรดึงรูป 3 รูป (คอมเมนต์ที่มีรูป)', served);
const leftover = await p.evaluate(()=>window.__alerts.join(' '));
if (leftover) fail('ไม่ควรมี popup ตอนสำเร็จ', leftover);

// ---- ตรวจโครงไฟล์ที่ได้จริง
const out = '/private/tmp/claude-501/-Users-korn-Claude-PAWDY/4cd8c349-8b25-4251-ae4e-61538bd09b3a/scratchpad/out.xlsx';
fs.copyFileSync(await dl.path(), out);

const { execFileSync } = await import('child_process');
const names = execFileSync('unzip', ['-Z1', out], {encoding:'utf8'}).trim().split('\n');
const need = ['[Content_Types].xml','xl/workbook.xml','xl/worksheets/sheet1.xml',
              'xl/worksheets/_rels/sheet1.xml.rels','xl/drawings/drawing1.xml',
              'xl/drawings/_rels/drawing1.xml.rels'];
need.forEach(n=>{ if(!names.includes(n)) fail('ขาด part '+n, names); });

const media = names.filter(n=>n.startsWith('xl/media/'));
if (media.length !== 3) fail('จำนวนรูปที่ฝัง', media);
// นามสกุลต้องตรงกับไบต์จริง — เสิร์ฟ PNG หมด ก็ต้องเป็น .png หมด
if (media.some(n=>!n.endsWith('.png'))) fail('นามสกุลไม่ตรงกับไบต์จริง Excel จะไม่รับรูป', media);

// อ่านผ่าน python เพราะ unzip มองวงเล็บเหลี่ยมใน [Content_Types].xml เป็น glob
const rd = (n)=>execFileSync('python3',
  ['-c','import zipfile,sys;sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode())', out, n],
  {encoding:'utf8'});
const draw = rd('xl/drawings/drawing1.xml');
const embeds = [...draw.matchAll(/r:embed="([^"]+)"/g)].map(m=>m[1]);
const relIds = [...rd('xl/drawings/_rels/drawing1.xml.rels').matchAll(/Id="([^"]+)"/g)].map(m=>m[1]);
if (embeds.length !== 3) fail('anchor ไม่ครบ', embeds);
embeds.forEach(e=>{ if(!relIds.includes(e)) fail('r:embed ไม่มี relationship รองรับ: '+e, relIds); });

const ws = rd('xl/worksheets/sheet1.xml');
if (!ws.includes('<drawing r:id="rIdDraw"/>')) fail('ชีตไม่ได้อ้าง drawing');
if (!ws.split('<sheetViews>')[0].includes('xmlns:r=')) fail('ชีตอ้าง r:id แต่ไม่ประกาศ namespace r');
if (ws.indexOf('<drawing') < ws.indexOf('</sheetData>')) fail('<drawing> ต้องอยู่หลัง sheetData ตาม schema');
const hts = [...ws.matchAll(/<row r="(\d+)" ht="/g)].map(m=>m[1]);
if (hts.join(',') !== '2,3,5') fail('แถวที่มีรูปต้องถูกขยายความสูง (2,3,5)', hts);

const ct = rd('[Content_Types].xml');
if (!ct.includes('Extension="png"')) fail('[Content_Types] ไม่ประกาศ png');
if (!ct.includes('drawing1.xml')) fail('[Content_Types] ไม่ประกาศ drawing');

// ข้อความยังถูก: ไม่มี URL ในคอลัมน์ข้อความ และช่องรูปว่าง (รูปลอยทับ)
if (ws.includes('=IMAGE(')) fail('ยังมีสูตร IMAGE ค้างอยู่ ควรฝังรูปแทน');
if (!ws.includes('อัญประกาศ')) fail('ข้อความหาย');

console.log('parts:', names.length, '| รูปฝัง:', media.length, '| แถวขยาย:', hts.join(','), '| ดึงรูป:', served);
console.log(errs.join('\n')||'no errors');
await b.close();
