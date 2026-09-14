'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../drafts/tiktok/TikTokReporting.gs.txt'), 'utf8');
const ctx = vm.createContext({Date, Set});
vm.runInContext(source, ctx);
const response = (body, status=200) => ({getContentText:()=>JSON.stringify(body), getResponseCode:()=>status});
test('loading draft does not stop another script; live sync remains blocked', () => {
  assert.throws(()=>ctx.syncTikTokNow(), /disabled/);
  assert.throws(()=>ctx.installTikTokTriggers(), /disabled/);
  assert.throws(()=>ctx.exchangeTikTokAdsCode('test'), /disabled/);
});
test('Display success envelope and Business success envelope', () => {
  assert.equal(ctx.parseResponse_(response({data:{ok:1},error:{code:'ok'}})).ok, 1);
  assert.equal(ctx.parseResponse_(response({code:0,data:{ok:2}})).ok, 2);
});
test('error messages cannot expose response secrets', () => {
  for(const body of [{error:'invalid_token',error_description:'SECRET'}, {code:400,message:'SECRET'}]) {
    assert.throws(()=>ctx.parseResponse_(response(body)), error => !error.message.includes('SECRET'));
  }
});
test('missing spend and shares stay blank; real zero remains zero', () => {
  const r = ctx.blankRow_(); r[5]=100; r[6]=10; r[7]=2;
  const out = ctx.calculateRow_(r);
  for(const i of [23,24,28,29,30,31,32,34]) assert.equal(out[i], '');
  r[8]=0; r[9]=0; r[12]=1000;
  ctx.calculateRow_(r);
  assert.equal(r[23],0); assert.equal(r[24],0.12); assert.equal(r[29],0);
});
test('IDs retain exact decimal text and numeric IDs fail closed', () => {
  assert.equal(ctx.exactId_('1234567890123456789'),'1234567890123456789');
  assert.throws(()=>ctx.exactId_(1234567890123456789), /decimal text/);
});
test('multiple ads aggregate per post, unmapped ads fail before writing', () => {
  const rows = {'123':ctx.blankRow_()};
  const ad = (id, spend) => ({postId:'123',adId:id,spend,impressions:100,views:50,starts:50,views2s:20,views6s:10,completions:5,clicks:2});
  ctx.mergeAds_(rows,[ad('1',10),ad('2',20)]);
  assert.equal(rows['123'][9],30); assert.equal(rows['123'][12],200);
  assert.throws(()=>ctx.mergeAds_(rows,[{postId:'',adId:'3'}]),/Unmapped/);
  assert.throws(()=>ctx.mergeAds_(rows,[ad('1',10),ad('1',10)]),/Duplicate/);
});
test('headers can follow title rows; changed headers are rejected', () => {
  assert.equal(ctx.headerRow_([['Title'],['Status'],['Notes'],Array.from(ctx.TT_COLUMNS)]),3);
  assert.throws(()=>ctx.headerRow_([['Post ID']]), /incompatible/);
});
test('captions starting with = are written as literal strings', () => {
  const request=ctx.ttCells_(1,4,4,['=IMPORTXML("https://example.invalid")']);
  assert.equal(request.updateCells.rows[0].values[0].userEnteredValue.stringValue,'=IMPORTXML("https://example.invalid")');
  assert.equal(request.updateCells.rows[0].values[0].userEnteredValue.formulaValue,undefined);
});
test('batch preserves headers, business cells and unrelated columns', () => {
  const r=ctx.blankRow_(); r[1]='123'; r[5]=100; r[6]=1; r[7]=0; r[8]=0; r.ttOrganic=true;
  const rows={'123':r}; Object.defineProperty(rows,'_layout',{value:{header:3,end:5,positions:{'123':4}}});
  const requests=ctx.tikTokRequests_({getSheetId:()=>7,getLastColumn:()=>40},rows);
  for(const req of requests) if(req.updateCells) {
    assert.equal(req.updateCells.start.rowIndex,4);
    const from=req.updateCells.start.columnIndex, to=from+req.updateCells.rows[0].values.length;
    assert.ok(!(from<=19 && to>19)); assert.ok(!(from<=20 && to>20));
  }
  const sort=requests.at(-1).sortRange.range;
  assert.equal(sort.startRowIndex,4); assert.equal(sort.endColumnIndex,40);
  assert.ok(!requests.some(r=>r.deleteDimension || r.clear));
});
test('Business token without expiration is not sent to invented refresh API', () => {
  ctx.PropertiesService={getScriptProperties:()=>({getProperty:k=>k==='TIKTOK_ADS_ACCESS_TOKEN'?'test-token':null})};
  assert.equal(ctx.token_('TIKTOK_ADS'),'test-token');
});
test('report requests use GET and retain Access-Token in the header', () => {
  let request;
  ctx.UrlFetchApp={fetch:(url,options)=>{request={url,options};return response({code:0,data:{list:[]}});}};
  ctx.getJson_('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/',{page:1},{'Access-Token':'test-token'});
  assert.equal(request.options.method,'get');
  assert.ok(!request.url.includes('test-token'));
});
