from __future__ import annotations
import csv, io, json, os, sqlite3, threading, time, uuid
from collections import Counter
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI, Depends, Header, HTTPException, UploadFile, File
from fastapi.responses import HTMLResponse
import uvicorn

DB_PATH = os.getenv('PAWDY_DB_PATH','/data/pawdy_social.db')
ADMIN_TOKEN = os.getenv('ADMIN_TOKEN','')
INGEST_SECRET = os.getenv('INGEST_SECRET','')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY','').strip()
OPENAI_MODEL = os.getenv('OPENAI_MODEL','gpt-5.6-luna')
TZ = ZoneInfo(os.getenv('TIMEZONE') or os.getenv('TZ') or 'Asia/Bangkok')
RUN_HOUR = int(os.getenv('DAILY_RUN_HOUR','9'))

app = FastAPI(title='Pawdy Social Intelligence', version='4.0')

TOPIC_RULES = [
    ('Senior Dog Nutrition',['หมาแก่','senior','7+','สูงวัย']),
    ('Food Allergy',['แพ้','คัน','ขนร่วง','โปรตีนทางเลือก']),
    ('Appetite',['กินน้อย','ไม่กิน','เบื่ออาหาร']),
    ('Weight Management',['อ้วน','ลดน้ำหนัก','weight']),
    ('Joint & Mobility',['ข้อ','เดินไม่ไหว','mobility']),
    ('Astaxanthin',['astaxanthin','astareal']),
    ('Puppy Nutrition',['ลูกหมา','puppy']),
    ('Cat Nutrition',['แมว','cat']),
]
NEG = ['ไม่ดี','แย่','แพ้','คัน','อันตราย','หลอก','ไม่กิน','กินน้อย','ขนร่วง','ท้องเสีย','อ้วก','ผิดหวัง']
POS = ['ดี','ชอบ','ดีขึ้น','แข็งแรง','สดใส','แนะนำ','คุ้ม','ถูกใจ']
BUY = ['ราคา','ซื้อ','พิกัด','ร้านไหน','ยี่ห้อไหนดี','แนะนำ','สั่ง','โปรโมชั่น','โปร']
RISK = ['ตาย','อันตราย','ร้องเรียน','ฟ้อง','หลอกลวง','สารพิษ','ปนเปื้อน','เจ็บหนัก']

def uid(): return uuid.uuid4().hex
def now_iso(): return datetime.now(timezone.utc).isoformat()

def db():
    os.makedirs(os.path.dirname(DB_PATH) or '.', exist_ok=True)
    con=sqlite3.connect(DB_PATH, timeout=30)
    con.row_factory=sqlite3.Row
    con.execute('PRAGMA journal_mode=WAL')
    return con

def init_db():
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS videos(
          id TEXT PRIMARY KEY, platform_video_id TEXT UNIQUE, url TEXT NOT NULL,
          creator TEXT, caption TEXT, transcript TEXT, search_keyword TEXT, source TEXT,
          view_count INTEGER DEFAULT 0, like_count INTEGER DEFAULT 0,
          comment_count INTEGER DEFAULT 0, share_count INTEGER DEFAULT 0,
          comments_json TEXT DEFAULT '[]', published_at TEXT, collected_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS analyses(
          video_id TEXT PRIMARY KEY, topic TEXT, sentiment TEXT, sentiment_score REAL,
          pain_points TEXT, questions TEXT, purchase_intent TEXT,
          opportunity TEXT, opportunity_score REAL, risk_level TEXT, summary TEXT,
          model TEXT, analyzed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS daily_insights(
          day TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL
        );
        ''')

def admin(authorization: str|None=Header(default=None)):
    if not ADMIN_TOKEN or authorization != f'Bearer {ADMIN_TOKEN}':
        raise HTTPException(401,'invalid admin token')

def ingest_auth(x_ingest_secret: str|None=Header(default=None)):
    if not INGEST_SECRET or x_ingest_secret != INGEST_SECRET:
        raise HTTPException(401,'invalid ingest secret')

def fallback_analysis(video: dict):
    comments=json.loads(video.get('comments_json') or '[]')
    text=' '.join([video.get('caption') or '', video.get('transcript') or '']+[str(x.get('text') or '') for x in comments]).lower()
    scored=[]
    for topic, words in TOPIC_RULES:
        n=sum(text.count(w.lower()) for w in words)
        if n: scored.append((n,topic))
    scored.sort(reverse=True)
    topic=scored[0][1] if scored else 'General Pet Nutrition'
    pos=sum(text.count(x) for x in POS); neg=sum(text.count(x) for x in NEG)
    sentiment_score=0 if pos+neg==0 else round((pos-neg)/(pos+neg),3)
    sentiment='neutral' if pos+neg==0 else ('mixed' if pos and neg else ('positive' if sentiment_score>0 else 'negative'))
    questions=[]
    for x in comments:
        t=str(x.get('text') or '').strip()
        if t and ('?' in t or any(k in t for k in ['ไหม','อะไร','ยังไง','เท่าไร','ไหนดี'])): questions.append(t[:180])
    pain=[p for p in ['หมาแก่กินน้อย','หมาไม่กินอาหาร','หมาแพ้อาหาร','ขนร่วง','หมาอ้วน','ข้อเสื่อม','ท้องเสีย'] if p in text]
    buy=sum(text.count(x) for x in BUY)
    intent='high' if buy>=4 else 'medium' if buy>=2 else 'low' if buy==1 else 'none'
    risk_hits=[x for x in RISK if x in text]
    risk='high' if len(risk_hits)>=2 else 'medium' if risk_hits else 'none'
    opportunity=questions[0] if questions else f'ทำคอนเทนต์ Q&A เรื่อง {topic} จาก pain point ที่คนกำลังพูดถึง'
    views=max(int(video.get('view_count') or 0),1)
    engagement=(int(video.get('like_count') or 0)+int(video.get('comment_count') or 0)+int(video.get('share_count') or 0))/views
    score=min(100, round(35*min(engagement/0.12,1)+25*min(int(video.get('comment_count') or 0)/300,1)+20*(1 if questions else .3)+20*({'high':1,'medium':.7,'low':.35,'none':0}[intent]),1))
    return dict(topic=topic,sentiment=sentiment,sentiment_score=sentiment_score,pain_points=pain[:8],questions=questions[:8],purchase_intent=intent,opportunity=opportunity,opportunity_score=score,risk_level=risk,summary=f'หัวข้อหลัก {topic}; sentiment {sentiment}; purchase intent {intent}.')

async def ai_analysis(video: dict):
    if not OPENAI_API_KEY: return fallback_analysis(video) | {'model':'fallback-rules-v2'}
    comments=json.loads(video.get('comments_json') or '[]')[:40]
    schema={
      'type':'object','additionalProperties':False,
      'properties':{
        'topic':{'type':'string'},'sentiment':{'type':'string','enum':['positive','neutral','negative','mixed']},
        'sentiment_score':{'type':'number','minimum':-1,'maximum':1},
        'pain_points':{'type':'array','items':{'type':'string'}},'questions':{'type':'array','items':{'type':'string'}},
        'purchase_intent':{'type':'string','enum':['none','low','medium','high']},
        'opportunity':{'type':'string'},'risk_level':{'type':'string','enum':['none','low','medium','high','critical']},
        'summary':{'type':'string'}},
      'required':['topic','sentiment','sentiment_score','pain_points','questions','purchase_intent','opportunity','risk_level','summary']}
    prompt={'caption':video.get('caption'),'transcript':video.get('transcript'),'top_comments':comments,'metrics':{k:video.get(k) for k in ['view_count','like_count','comment_count','share_count']}}
    body={'model':OPENAI_MODEL,'input':[{'role':'system','content':'Analyze Thai TikTok pet-food conversation. Use only supplied evidence. Avoid unsupported medical claims. Return actionable content intelligence.'},{'role':'user','content':json.dumps(prompt,ensure_ascii=False)}],'text':{'format':{'type':'json_schema','name':'analysis','strict':True,'schema':schema}}}
    async with httpx.AsyncClient(timeout=90) as client:
        r=await client.post('https://api.openai.com/v1/responses',headers={'Authorization':f'Bearer {OPENAI_API_KEY}','Content-Type':'application/json'},json=body)
        r.raise_for_status(); data=r.json()
    txt=data.get('output_text')
    if not txt:
        for item in data.get('output',[]):
            for part in item.get('content',[]):
                if part.get('type')=='output_text': txt=part.get('text'); break
    out=json.loads(txt)
    views=max(int(video.get('view_count') or 0),1); eng=(int(video.get('like_count') or 0)+int(video.get('comment_count') or 0)+int(video.get('share_count') or 0))/views
    out['opportunity_score']=min(100,round(35*min(eng/0.12,1)+25*min(int(video.get('comment_count') or 0)/300,1)+20*(1 if out['questions'] else .3)+20*({'high':1,'medium':.7,'low':.35,'none':0}[out['purchase_intent']]),1))
    out['model']=OPENAI_MODEL
    return out

async def analyze_pending(limit=200):
    with db() as c:
        rows=[dict(x) for x in c.execute('SELECT v.* FROM videos v LEFT JOIN analyses a ON a.video_id=v.id WHERE a.video_id IS NULL ORDER BY v.collected_at LIMIT ?', (limit,)).fetchall()]
    done=0; failed=[]
    for v in rows:
        try:
            a=await ai_analysis(v)
            with db() as c:
                c.execute('''INSERT OR REPLACE INTO analyses(video_id,topic,sentiment,sentiment_score,pain_points,questions,purchase_intent,opportunity,opportunity_score,risk_level,summary,model,analyzed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',(v['id'],a['topic'],a['sentiment'],a['sentiment_score'],json.dumps(a['pain_points'],ensure_ascii=False),json.dumps(a['questions'],ensure_ascii=False),a['purchase_intent'],a['opportunity'],a['opportunity_score'],a['risk_level'],a['summary'],a['model'],now_iso()))
            done+=1
        except Exception as e: failed.append({'video_id':v['id'],'error':str(e)})
    return {'analyzed':done,'failed':failed}

def generate_insight():
    now=datetime.now(timezone.utc); a0=now-timedelta(days=7); b0=now-timedelta(days=14)
    with db() as c:
        rows=[dict(x) for x in c.execute('''SELECT v.*,a.* FROM videos v JOIN analyses a ON a.video_id=v.id WHERE v.collected_at>=?''',(b0.isoformat(),)).fetchall()]
    cur=[x for x in rows if x['collected_at']>=a0.isoformat()]; prev=[x for x in rows if x['collected_at']<a0.isoformat()]
    def counts(xs): return Counter(x['topic'] for x in xs if x.get('topic'))
    cc,pc=counts(cur),counts(prev); rising=[]
    for topic,n in cc.most_common(12):
        p=pc.get(topic,0); growth=round((n-p)/max(p,1)*100,1)
        best=max([x.get('opportunity_score') or 0 for x in cur if x.get('topic')==topic] or [0])
        rising.append({'topic':topic,'mentions':n,'previous':p,'growth_pct':growth,'opportunity_score':best})
    rising.sort(key=lambda x:(x['growth_pct'],x['mentions']),reverse=True)
    qs=[]; pains=[]; ideas=[]; risks=[]
    for x in cur:
        qs += json.loads(x.get('questions') or '[]'); pains += json.loads(x.get('pain_points') or '[]')
        if x.get('opportunity'): ideas.append({'idea':x['opportunity'],'score':x.get('opportunity_score') or 0,'topic':x.get('topic')})
        if x.get('risk_level') in ('high','critical'): risks.append({'url':x.get('url'),'topic':x.get('topic'),'risk':x.get('risk_level'),'summary':x.get('summary')})
    ideas=sorted(ideas,key=lambda x:x['score'],reverse=True)[:10]
    payload={'day':datetime.now(TZ).date().isoformat(),'videos_7d':len(cur),'rising_topics':rising[:10],'consumer_questions':Counter(qs).most_common(10),'pain_points':Counter(pains).most_common(10),'content_ideas':ideas,'risks':risks[:10]}
    with db() as c: c.execute('INSERT OR REPLACE INTO daily_insights(day,payload,created_at) VALUES(?,?,?)',(payload['day'],json.dumps(payload,ensure_ascii=False),now_iso()))
    return payload

@app.on_event('startup')
def startup():
    init_db(); threading.Thread(target=scheduler,daemon=True).start()

@app.get('/health')
def health():
    with db() as c: n=c.execute('SELECT count(*) n FROM videos').fetchone()['n']
    return {'ok':True,'version':'4.0','db':True,'videos':n,'ai_mode':'openai' if OPENAI_API_KEY else 'fallback'}

@app.post('/api/ingest')
def ingest(body:dict,_=Depends(ingest_auth)):
    items=body.get('videos') if isinstance(body.get('videos'),list) else []
    count=0
    with db() as c:
        for item in items:
            pid=str(item.get('platform_video_id') or item.get('video_id') or '').strip(); url=str(item.get('url') or '').strip()
            if not pid or not url: continue
            vid=uid(); comments=item.get('comments') if isinstance(item.get('comments'),list) else []
            c.execute('''INSERT INTO videos(id,platform_video_id,url,creator,caption,transcript,search_keyword,source,view_count,like_count,comment_count,share_count,comments_json,published_at,collected_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(platform_video_id) DO UPDATE SET url=excluded.url,creator=excluded.creator,caption=excluded.caption,transcript=excluded.transcript,search_keyword=excluded.search_keyword,source=excluded.source,view_count=excluded.view_count,like_count=excluded.like_count,comment_count=excluded.comment_count,share_count=excluded.share_count,comments_json=excluded.comments_json,published_at=COALESCE(excluded.published_at,videos.published_at),collected_at=excluded.collected_at''',(vid,pid,url,(item.get('creator') or {}).get('username') if isinstance(item.get('creator'),dict) else item.get('creator'),item.get('caption'),item.get('transcript'),item.get('search_keyword') or body.get('search_keyword'),body.get('source') or 'provider',int(item.get('view_count') or 0),int(item.get('like_count') or 0),int(item.get('comment_count') or len(comments)),int(item.get('share_count') or 0),json.dumps(comments,ensure_ascii=False),item.get('published_at'),now_iso()))
            count+=1
    return {'ok':True,'ingested':count}

@app.post('/api/import/csv')
async def import_csv(file:UploadFile=File(...),_=Depends(admin)):
    raw=(await file.read()).decode('utf-8-sig'); rows=[]
    for i,r in enumerate(csv.DictReader(io.StringIO(raw))):
        pid=r.get('platform_video_id') or r.get('video_id') or f'csv-{int(time.time())}-{i}'
        rows.append({'platform_video_id':pid,'url':r.get('url') or f'https://www.tiktok.com/video/{pid}','creator':{'username':r.get('creator_username') or r.get('username') or 'csv_import'},'caption':r.get('caption') or '','transcript':r.get('transcript') or '','search_keyword':r.get('search_keyword') or 'CSV Import','view_count':int(float(r.get('view_count') or 0)),'like_count':int(float(r.get('like_count') or 0)),'comment_count':int(float(r.get('comment_count') or 0)),'share_count':int(float(r.get('share_count') or 0)),'published_at':r.get('published_at') or None,'comments':[]})
    return ingest({'source':'csv','videos':rows},None)

@app.post('/api/pipeline/run')
async def pipeline(_=Depends(admin)):
    a=await analyze_pending(); d=generate_insight(); return {'ok':True,'analysis':a,'daily':d}

@app.get('/api/dashboard')
def dashboard(_=Depends(admin)):
    with db() as c:
        feed=[dict(x) for x in c.execute('''SELECT v.*,a.topic,a.sentiment,a.sentiment_score,a.purchase_intent,a.opportunity,a.opportunity_score,a.risk_level,a.summary FROM videos v LEFT JOIN analyses a ON a.video_id=v.id ORDER BY v.collected_at DESC LIMIT 300''').fetchall()]
        di=c.execute('SELECT payload FROM daily_insights ORDER BY day DESC LIMIT 1').fetchone()
    views=sum(int(x.get('view_count') or 0) for x in feed[:100]); eng=sum(int(x.get('like_count') or 0)+int(x.get('comment_count') or 0)+int(x.get('share_count') or 0) for x in feed[:100])
    insight=json.loads(di['payload']) if di else {'rising_topics':[],'consumer_questions':[],'pain_points':[],'content_ideas':[],'risks':[]}
    return {'generatedAt':now_iso(),'summary':{'videos':len(feed),'views':views,'engagement_rate':round(eng/max(views,1)*100,2),'high_risk':sum(1 for x in feed if x.get('risk_level') in ('high','critical'))},'insight':insight,'feed':feed}

def scheduler():
    last=''
    while True:
        try:
            n=datetime.now(TZ); day=n.date().isoformat()
            if n.hour==RUN_HOUR and last!=day:
                import asyncio; asyncio.run(analyze_pending(500)); generate_insight(); last=day
        except Exception as e: print('scheduler',e,flush=True)
        time.sleep(30)

HTML='''<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pawdy Social Intelligence</title><style>body{font-family:system-ui;margin:0;background:#f4f7f2;color:#172012}header{background:#193c1b;color:white;padding:20px 5vw}main{padding:24px 5vw}.row{display:flex;gap:12px;flex-wrap:wrap}.card{background:white;border-radius:16px;padding:18px;box-shadow:0 2px 12px #0001;flex:1;min-width:220px;margin-bottom:16px}.big{font-size:32px;font-weight:800}.tag{background:#e9f4df;border-radius:999px;padding:6px 10px;display:inline-block;margin:3px}button,input{padding:10px 12px;border-radius:10px;border:1px solid #ccd6c6}button{background:#98ca40;border:0;font-weight:700;cursor:pointer}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:9px;border-bottom:1px solid #eee;font-size:14px}.muted{color:#667}</style><header><h1>Pawdy Social Intelligence</h1><div>TikTok Listening → AI Analysis → Daily Content Insight</div></header><main><div class="row"><input id="t" type="password" placeholder="Admin token"><button onclick="connect()">Connect</button><button onclick="run()">Run Pipeline</button></div><div id="app" style="margin-top:20px"></div></main><script>let token=localStorage.pawdyToken||'';document.getElementById('t').value=token;async function api(path,opt={}){opt.headers=Object.assign({'Authorization':'Bearer '+token},opt.headers||{});let r=await fetch(path,opt);if(!r.ok)throw new Error(await r.text());return r.json()}function connect(){token=document.getElementById('t').value.trim();localStorage.pawdyToken=token;load()}async function run(){await api('/api/pipeline/run',{method:'POST'});load()}function fmt(n){return new Intl.NumberFormat().format(n||0)}async function load(){try{let d=await api('/api/dashboard');let s=d.summary,i=d.insight;document.getElementById('app').innerHTML=`<div class=row><div class=card><div class=muted>Videos</div><div class=big>${fmt(s.videos)}</div></div><div class=card><div class=muted>Views</div><div class=big>${fmt(s.views)}</div></div><div class=card><div class=muted>Engagement</div><div class=big>${s.engagement_rate}%</div></div><div class=card><div class=muted>High Risk</div><div class=big>${s.high_risk}</div></div></div><div class=card><h2>🔥 Rising Topics</h2>${(i.rising_topics||[]).map(x=>`<span class=tag>${x.topic} ${x.growth_pct>=0?'+':''}${x.growth_pct}% · ${x.opportunity_score}/100</span>`).join('')||'ยังไม่มีข้อมูล'}</div><div class=row><div class=card><h2>💬 Questions</h2>${(i.consumer_questions||[]).map(x=>`<div>• ${Array.isArray(x)?x[0]:x}</div>`).join('')||'ยังไม่มีข้อมูล'}</div><div class=card><h2>💡 Content Ideas</h2>${(i.content_ideas||[]).map(x=>`<div><b>${x.score}</b> · ${x.idea}</div>`).join('')||'ยังไม่มีข้อมูล'}</div></div><div class=card><h2>Latest Feed</h2><table><thead><tr><th>Creator</th><th>Caption</th><th>Topic</th><th>Views</th><th>Score</th><th>Risk</th></tr></thead><tbody>${(d.feed||[]).slice(0,50).map(x=>`<tr><td>${x.creator||''}</td><td><a href="${x.url}" target=_blank>${(x.caption||'').slice(0,80)}</a></td><td>${x.topic||'-'}</td><td>${fmt(x.view_count)}</td><td>${x.opportunity_score||'-'}</td><td>${x.risk_level||'-'}</td></tr>`).join('')}</tbody></table></div>`}catch(e){document.getElementById('app').innerHTML='<div class=card>เชื่อมต่อไม่สำเร็จ: '+e.message+'</div>'}}if(token)load()</script></html>'''

@app.get('/',response_class=HTMLResponse)
def root(): return HTML

if __name__=='__main__':
    init_db(); uvicorn.run(app,host='0.0.0.0',port=int(os.getenv('PORT','8000')))
