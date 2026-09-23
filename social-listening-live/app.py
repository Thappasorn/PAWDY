from __future__ import annotations
import base64, csv, hashlib, io, json, os, secrets, sqlite3, threading, time, uuid
from urllib.parse import urlencode
from collections import Counter
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI, Depends, Header, HTTPException, UploadFile, File
from fastapi.responses import HTMLResponse
from cryptography.fernet import Fernet, InvalidToken
import uvicorn

DB_PATH = os.getenv('PAWDY_DB_PATH','/data/pawdy_social.db')
ADMIN_TOKEN = os.getenv('ADMIN_TOKEN','')
INGEST_SECRET = os.getenv('INGEST_SECRET','')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY','').strip()
OPENAI_MODEL = os.getenv('OPENAI_MODEL','gpt-5.6-luna')
TZ = ZoneInfo(os.getenv('TIMEZONE') or os.getenv('TZ') or 'Asia/Bangkok')
RUN_HOUR = int(os.getenv('DAILY_RUN_HOUR','9'))
MELTWATER_API_TOKEN = os.getenv('MELTWATER_API_TOKEN','').strip()
MELTWATER_SEARCH_ID = os.getenv('MELTWATER_SEARCH_ID','').strip()
TIKTOK_ACCESS_TOKEN = os.getenv('TIKTOK_ACCESS_TOKEN','').strip()
PROVIDER_SYNC_MINUTES = int(os.getenv('PROVIDER_SYNC_MINUTES','360'))
APIFY_SEARCH_ACTOR = os.getenv('APIFY_SEARCH_ACTOR','stanvanrooy6~tiktok-search-scraper').strip()
APIFY_COMMENTS_ACTOR = os.getenv('APIFY_COMMENTS_ACTOR','abotapi~tiktok-comments-scraper').strip()
APIFY_KEYWORDS_PER_RUN = int(os.getenv('APIFY_KEYWORDS_PER_RUN','5'))
APIFY_RESULTS_PER_KEYWORD = int(os.getenv('APIFY_RESULTS_PER_KEYWORD','10'))
APIFY_COMMENTS_VIDEOS_DAILY = int(os.getenv('APIFY_COMMENTS_VIDEOS_DAILY','5'))
APIFY_COMMENTS_PER_VIDEO = int(os.getenv('APIFY_COMMENTS_PER_VIDEO','20'))
APIFY_REGION = os.getenv('APIFY_REGION','TH').strip()
APIFY_LANGUAGE = os.getenv('APIFY_LANGUAGE','th').strip()
APIFY_PUBLISHED_WITHIN = os.getenv('APIFY_PUBLISHED_WITHIN','week').strip()
APP_SECRET_KEY = os.getenv('APP_SECRET_KEY','').strip()
TIKTOK_REDIRECT_URI = os.getenv('TIKTOK_REDIRECT_URI','https://pawdycontent.vercel.app/tiktok-callback.html').strip()
TIKTOK_BUSINESS_BASE = 'https://business-api.tiktok.com/open_api/v1.3'
TIKTOK_BUSINESS_CALLBACK = os.getenv('TIKTOK_BUSINESS_CALLBACK','https://pawdy-social-listening-production.up.railway.app/api/tiktok/business/callback').strip()
TIKTOK_BUSINESS_SCOPES = os.getenv('TIKTOK_BUSINESS_SCOPES','').strip()
TIKTOK_MENTIONS_REGIONS = [x.strip().upper() for x in os.getenv('TIKTOK_MENTIONS_REGIONS','TH').split(',') if x.strip()]
TIKTOK_MENTIONS_DAYS = max(1,min(int(os.getenv('TIKTOK_MENTIONS_DAYS','90')),90))

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


def _fernet():
    if not APP_SECRET_KEY:
        raise RuntimeError('APP_SECRET_KEY is not configured')
    raw=hashlib.sha256(APP_SECRET_KEY.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(raw))

def set_secret(name:str, value:str):
    if value is None: return
    enc=_fernet().encrypt(str(value).encode()).decode()
    with db() as c:
        c.execute('INSERT OR REPLACE INTO app_secrets(name,value_enc,updated_at) VALUES(?,?,?)',(name,enc,now_iso()))

def get_secret(name:str, env_name:str|None=None):
    try:
        with db() as c:
            row=c.execute('SELECT value_enc FROM app_secrets WHERE name=?',(name,)).fetchone()
        if row:
            return _fernet().decrypt(row['value_enc'].encode()).decode()
    except (InvalidToken, RuntimeError):
        pass
    return os.getenv(env_name,'').strip() if env_name else ''

def openai_key(): return get_secret('openai_api_key','OPENAI_API_KEY')
def apify_token(): return get_secret('apify_api_token','APIFY_API_TOKEN')
def meltwater_token(): return get_secret('meltwater_api_token','MELTWATER_API_TOKEN')
def meltwater_search_id(): return get_secret('meltwater_search_id','MELTWATER_SEARCH_ID')
def tiktok_client_key(): return get_secret('tiktok_client_key','TIKTOK_CLIENT_KEY')
def tiktok_client_secret(): return get_secret('tiktok_client_secret','TIKTOK_CLIENT_SECRET')
def tiktok_business_app_id():
    return get_secret('tiktok_business_app_id','TIKTOK_BUSINESS_APP_ID') or tiktok_client_key()
def tiktok_business_app_secret():
    return get_secret('tiktok_business_app_secret','TIKTOK_BUSINESS_APP_SECRET') or tiktok_client_secret()

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
        CREATE TABLE IF NOT EXISTS keywords(
          id TEXT PRIMARY KEY, keyword TEXT UNIQUE NOT NULL, category TEXT DEFAULT 'custom',
          enabled INTEGER DEFAULT 1, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS provider_health(
          provider TEXT PRIMARY KEY, ok INTEGER NOT NULL, detail TEXT,
          checked_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_secrets(
          name TEXT PRIMARY KEY, value_enc TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS oauth_states(
          state TEXT PRIMARY KEY, provider TEXT NOT NULL, expires_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_state(
          name TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL
        );
        ''')


def get_state(name:str, default=''):
    with db() as c:
        row=c.execute('SELECT value FROM app_state WHERE name=?',(name,)).fetchone()
    return row['value'] if row else default

def set_state(name:str, value):
    with db() as c:
        c.execute('INSERT OR REPLACE INTO app_state(name,value,updated_at) VALUES(?,?,?)',(name,str(value),now_iso()))

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
    key=openai_key()
    if not key: return fallback_analysis(video) | {'model':'fallback-rules-v2'}
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
        r=await client.post('https://api.openai.com/v1/responses',headers={'Authorization':f'Bearer {key}','Content-Type':'application/json'},json=body)
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
    if not rows:
        set_provider_health('openai_analysis',True,{'analyzed':0,'pending':0,'message':'up to date'})
        return {'analyzed':0,'failed':[],'pending':0}
    import asyncio
    sem=asyncio.Semaphore(5)
    async def one(v):
        async with sem:
            try:
                a=await ai_analysis(v)
                with db() as c:
                    c.execute('''INSERT OR REPLACE INTO analyses(video_id,topic,sentiment,sentiment_score,pain_points,questions,purchase_intent,opportunity,opportunity_score,risk_level,summary,model,analyzed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                      (v['id'],a['topic'],a['sentiment'],a['sentiment_score'],json.dumps(a['pain_points'],ensure_ascii=False),
                       json.dumps(a['questions'],ensure_ascii=False),a['purchase_intent'],a['opportunity'],a['opportunity_score'],
                       a['risk_level'],a['summary'],a['model'],now_iso()))
                return {'ok':True,'video_id':v['id']}
            except Exception as e:
                print('analysis failed',v.get('id'),str(e)[:500],flush=True)
                return {'ok':False,'video_id':v['id'],'error':str(e)}
    results=await asyncio.gather(*(one(v) for v in rows))
    done=sum(1 for x in results if x['ok'])
    failed=[x for x in results if not x['ok']]
    with db() as c:
        pending=c.execute('SELECT count(*) n FROM videos v LEFT JOIN analyses a ON a.video_id=v.id WHERE a.video_id IS NULL').fetchone()['n']
    set_provider_health('openai_analysis',not failed,{'analyzed':done,'failed':len(failed),'pending':pending,'model':OPENAI_MODEL if openai_key() else 'fallback-rules-v2'})
    print('analysis complete',json.dumps({'analyzed':done,'failed':len(failed),'pending':pending,'model':OPENAI_MODEL if openai_key() else 'fallback-rules-v2'}),flush=True)
    return {'analyzed':done,'failed':failed[:20],'pending':pending}


async def reanalyze_fallback(limit=500):
    if not openai_key():
        return {'reanalyzed':0,'skipped':'OpenAI not configured'}
    with db() as c:
        rows=[dict(x) for x in c.execute("""
          SELECT v.* FROM videos v JOIN analyses a ON a.video_id=v.id
          WHERE a.model='fallback-rules-v2'
          ORDER BY a.analyzed_at DESC LIMIT ?
        """,(limit,)).fetchall()]
    done=0; failed=[]
    for v in rows:
        try:
            a=await ai_analysis(v)
            with db() as c:
                c.execute("""UPDATE analyses SET topic=?,sentiment=?,sentiment_score=?,pain_points=?,questions=?,
                  purchase_intent=?,opportunity=?,opportunity_score=?,risk_level=?,summary=?,model=?,analyzed_at=?
                  WHERE video_id=?""",
                  (a['topic'],a['sentiment'],a['sentiment_score'],json.dumps(a['pain_points'],ensure_ascii=False),
                   json.dumps(a['questions'],ensure_ascii=False),a['purchase_intent'],a['opportunity'],
                   a['opportunity_score'],a['risk_level'],a['summary'],a['model'],now_iso(),v['id']))
            done+=1
        except Exception as e:
            failed.append({'video_id':v['id'],'error':str(e)})
    return {'reanalyzed':done,'failed':failed}

async def bootstrap_meltwater_search():
    token=meltwater_token()
    if not token:
        return {'ok':False,'error':'Meltwater API token not configured'}
    async with httpx.AsyncClient(timeout=45) as client:
        r=await client.get('https://api.meltwater.com/v3/searches',
            headers={'Accept':'application/json','apikey':token})
        if r.status_code!=200:
            return {'ok':False,'status':r.status_code,'error':r.text[:500]}
        data=r.json()
        searches=data.get('searches') or []
        target=next((x for x in searches if str(x.get('name','')).strip().lower()=='pawdy tiktok listening'),None)
        if not target:
            with db() as c:
                kws=[x['keyword'] for x in c.execute('SELECT keyword FROM keywords WHERE enabled=1 ORDER BY category,keyword').fetchall()]
            if not kws:
                return {'ok':False,'error':'No enabled keywords'}
            def q(s):
                return '"' + str(s).replace('\\','\\\\').replace('"','\\"') + '"'
            boolean=' OR '.join(q(x) for x in kws[:60])
            payload={'search':{'name':'Pawdy TikTok Listening','query':{'case_sensitivity':'no','boolean':boolean,'type':'boolean'}}}
            cr=await client.post('https://api.meltwater.com/v3/searches',
                headers={'Accept':'application/json','Content-Type':'application/json','apikey':token},json=payload)
            if cr.status_code not in (200,201):
                return {'ok':False,'status':cr.status_code,'error':cr.text[:700]}
            target=(cr.json().get('search') or {})
        sid=str(target.get('id') or '').strip()
        if not sid:
            return {'ok':False,'error':'Search ID missing from Meltwater response'}
        set_secret('meltwater_search_id',sid)
        return {'ok':True,'search_id':sid,'name':target.get('name') or 'Pawdy TikTok Listening'}

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


def _num(v):
    try: return int(float(v or 0))
    except: return 0


DEFAULT_KEYWORDS = [
 ('Pawdy','brand'),('พอดี้','brand'),('Pawdy Senior','brand'),('AstaReal','ingredient'),
 ('อาหารหมา','category'),('อาหารสุนัข','category'),('อาหารหมาแก่','life_stage'),
 ('อาหารลูกหมา','life_stage'),('อาหารแมว','category'),('หมาแก่กินน้อย','pain_point'),
 ('หมาไม่กินอาหาร','pain_point'),('หมาแพ้อาหาร','pain_point'),('หมาอ้วน','pain_point'),
 ('หมาขนร่วง','pain_point'),('หมาข้อเสื่อม','pain_point'),('หมาแก่กินอะไรดี','intent'),
 ('อาหารหมาอะไรดี','intent'),('อาหารหมาแก่ยี่ห้อไหนดี','intent'),
 ('Astaxanthin หมา','ingredient'),('Omega 3 หมา','ingredient'),('โปรตีนจระเข้','ingredient')
]

def seed_keywords():
    with db() as c:
        for kw,cat in DEFAULT_KEYWORDS:
            c.execute('INSERT OR IGNORE INTO keywords(id,keyword,category,enabled,created_at) VALUES(?,?,?,?,?)',
                      (uid(),kw,cat,1,now_iso()))

def set_provider_health(provider, ok, detail):
    with db() as c:
        c.execute('INSERT OR REPLACE INTO provider_health(provider,ok,detail,checked_at) VALUES(?,?,?,?)',
                  (provider,1 if ok else 0,str(detail)[:1000],now_iso()))

async def probe_tiktok_oembed():
    sample='https://www.tiktok.com/@scout2015/video/6718335390845095173'
    try:
        async with httpx.AsyncClient(timeout=20,follow_redirects=True) as client:
            r=await client.get('https://www.tiktok.com/oembed',params={'url':sample},
                               headers={'User-Agent':'PawdySocialIntelligence/1.0'})
            r.raise_for_status(); d=r.json()
        ok=bool(d.get('html') or d.get('title'))
        set_provider_health('tiktok_oembed',ok,{'author':d.get('author_name'),'title':(d.get('title') or '')[:120]})
        return {'ok':ok,'author':d.get('author_name'),'title':(d.get('title') or '')[:120]}
    except Exception as e:
        set_provider_health('tiktok_oembed',False,str(e))
        return {'ok':False,'error':str(e)}

def provider_status():
    with db() as c:
        ph={x['provider']:dict(x) for x in c.execute('SELECT * FROM provider_health').fetchall()}
    return {
      'apify': {'configured': bool(apify_token()), 'search_actor': APIFY_SEARCH_ACTOR, 'comments_actor': APIFY_COMMENTS_ACTOR, 'region': APIFY_REGION, 'health': ph.get('apify')},
      'meltwater': {'configured': bool(meltwater_token() and meltwater_search_id()), 'search_id': meltwater_search_id() or None},
      'tiktok_owned': {'configured': bool(get_secret('tiktok_business_access_token','TIKTOK_ACCESS_TOKEN')), 'oauth_ready': bool(tiktok_business_app_id() and tiktok_business_app_secret()), 'redirect_uri': TIKTOK_REDIRECT_URI, 'business_callback': TIKTOK_BUSINESS_CALLBACK},
      'tiktok_mentions': {'configured': bool(get_secret('tiktok_business_access_token','TIKTOK_ACCESS_TOKEN')), 'scope': get_secret('tiktok_business_scope') or None, 'health': ph.get('tiktok_business_mentions')},
      'tiktok_oembed': {'configured': True, 'health': ph.get('tiktok_oembed')},
      'openai': {'configured': bool(openai_key()), 'model': OPENAI_MODEL if openai_key() else 'fallback-rules-v2'}
    }

def upsert_items(items, source='provider', search_keyword=None):
    count=0
    with db() as c:
        for item in items:
            pid=str(item.get('platform_video_id') or item.get('video_id') or '').strip()
            url=str(item.get('url') or '').strip()
            if not pid or not url: continue
            vid=uid(); comments=item.get('comments') if isinstance(item.get('comments'),list) else []
            creator=item.get('creator')
            if isinstance(creator,dict): creator=creator.get('username') or creator.get('handle') or creator.get('name')
            c.execute('''INSERT INTO videos(id,platform_video_id,url,creator,caption,transcript,search_keyword,source,view_count,like_count,comment_count,share_count,comments_json,published_at,collected_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(platform_video_id) DO UPDATE SET
              url=excluded.url,creator=excluded.creator,caption=excluded.caption,transcript=excluded.transcript,
              search_keyword=excluded.search_keyword,source=excluded.source,view_count=excluded.view_count,
              like_count=excluded.like_count,comment_count=excluded.comment_count,share_count=excluded.share_count,
              comments_json=CASE WHEN excluded.comments_json!='[]' THEN excluded.comments_json ELSE videos.comments_json END,published_at=COALESCE(excluded.published_at,videos.published_at),
              collected_at=excluded.collected_at''',
              (vid,pid,url,creator,item.get('caption'),item.get('transcript'),
               item.get('search_keyword') or search_keyword,source,_num(item.get('view_count')),_num(item.get('like_count')),
               _num(item.get('comment_count') or len(comments)),_num(item.get('share_count')),
               json.dumps(comments,ensure_ascii=False),item.get('published_at'),now_iso()))
            count+=1
    return count

async def import_tiktok_urls(urls, keyword='Manual TikTok URL'):
    items=[]; errors=[]
    async with httpx.AsyncClient(timeout=30,follow_redirects=True) as client:
        for raw in urls[:100]:
            url=str(raw or '').strip()
            if not url: continue
            try:
                r=await client.get('https://www.tiktok.com/oembed',params={'url':url},headers={'User-Agent':'PawdySocialIntelligence/1.0'})
                r.raise_for_status(); d=r.json()
                import re
                m=re.search(r'/video/(\d+)',url) or re.search(r'data-video-id="(\d+)"',d.get('html',''))
                pid=m.group(1) if m else 'oembed-'+uuid.uuid5(uuid.NAMESPACE_URL,url).hex
                items.append({
                  'platform_video_id':pid,'url':url,'creator':{'username':d.get('author_name')},
                  'caption':d.get('title') or '', 'transcript':'','search_keyword':keyword or 'Manual TikTok URL',
                  'view_count':0,'like_count':0,'comment_count':0,'share_count':0,'comments':[]
                })
            except Exception as e:
                errors.append({'url':url,'error':str(e)})
    return {'ingested':upsert_items(items,'tiktok_oembed',keyword or 'Manual TikTok URL'),'errors':errors}

async def get_valid_tiktok_token():
    access=get_secret('tiktok_business_access_token','TIKTOK_ACCESS_TOKEN')
    refresh=get_secret('tiktok_business_refresh_token','TIKTOK_REFRESH_TOKEN')
    exp=get_secret('tiktok_business_access_expires_at')
    if access and exp:
        try:
            if datetime.fromisoformat(exp) > datetime.now(timezone.utc)+timedelta(minutes=10):
                return access
        except: pass
    if access and not refresh: return access
    if not refresh: return ''
    ck=tiktok_business_app_id(); cs=tiktok_business_app_secret()
    if not (ck and cs): return access or ''
    payload={'client_id':ck,'client_secret':cs,'grant_type':'refresh_token','refresh_token':refresh}
    async with httpx.AsyncClient(timeout=45) as client:
        r=await client.post(TIKTOK_BUSINESS_BASE+'/tt_user/oauth2/refresh_token/',
          headers={'Content-Type':'application/json'},json=payload)
        d=r.json()
    if r.status_code!=200 or d.get('code') not in (0,None):
        print('TikTok refresh failed',str(d)[:800],flush=True)
        return access or ''
    data=d.get('data') or {}
    if data.get('access_token'):
        set_secret('tiktok_business_access_token',data['access_token'])
        set_secret('tiktok_business_refresh_token',data.get('refresh_token') or refresh)
        set_secret('tiktok_business_access_expires_at',(datetime.now(timezone.utc)+timedelta(seconds=int(data.get('expires_in') or 86400))).isoformat())
        if data.get('scope'): set_secret('tiktok_business_scope',str(data.get('scope')))
        if data.get('open_id'): set_secret('tiktok_business_open_id',str(data.get('open_id')))
        return data['access_token']
    return access or ''

async def tiktok_business_token_info():
    token=await get_valid_tiktok_token()
    if not token: return {'ok':False,'error':'not connected'}
    async with httpx.AsyncClient(timeout=30) as client:
        r=await client.get(TIKTOK_BUSINESS_BASE+'/tt_user/token_info/get/',
          headers={'Access-Token':token,'Accept':'application/json'})
        try: d=r.json()
        except: return {'ok':False,'status':r.status_code,'error':r.text[:500]}
    ok=r.status_code==200 and d.get('code') in (0,None)
    return {'ok':ok,'status':r.status_code,'data':d.get('data'),'message':d.get('message'),'code':d.get('code')}

def _mention_items(payload):
    data=payload.get('data') or {}
    for key in ('videos','video_list','list','items','mention_list'):
        if isinstance(data.get(key),list): return data.get(key)
    if isinstance(data,list): return data
    return []

async def sync_tiktok_mentions():
    token=await get_valid_tiktok_token()
    if not token:
        return {'skipped':'TikTok API for Business not connected'}

    business_id=get_secret('tiktok_business_open_id')
    if not business_id:
        info=await tiktok_business_token_info()
        data=info.get('data') if isinstance(info,dict) else None
        if isinstance(data,dict):
            business_id=str(data.get('open_id') or data.get('business_id') or '').strip()
            if business_id:
                set_secret('tiktok_business_open_id',business_id)
    if not business_id:
        return {'skipped':'TikTok business_id/open_id missing; re-authorize TikTok Business'}

    video_fields=[
      'item_id','video_link','caption','likes','comments','shares',
      'create_time','thumbnail_url','views','reach','creator_handle_name'
    ]
    comment_fields=[
      'item_id','video_link','caption','video_likes','thumbnail_url',
      'commenter_display_name','comment_id','comment_type','comment_text',
      'comment_create_time','comment_likes'
    ]

    out={
      'ingested':0,
      'content':{'ok':False,'items':0,'pages':0},
      'comments':{'ok':False,'items':0,'pages':0},
      'business_id_present':True,
      'regions':TIKTOK_MENTIONS_REGIONS,
      'number_of_days':TIKTOK_MENTIONS_DAYS
    }

    async with httpx.AsyncClient(timeout=45) as client:
        # Content mentions: up to TikTok's top 1,000 results, 100 per page.
        cursor=0
        content_items=[]
        for page in range(10):
            params={
              'business_id':business_id,
              'fields':json.dumps(video_fields,separators=(',',':')),
              'sort_field':'CREATE_TIME',
              'sort_type':'DESC',
              'number_of_days':TIKTOK_MENTIONS_DAYS,
              'cursor':cursor,
              'max_count':100
            }
            if TIKTOK_MENTIONS_REGIONS:
                params['regions']=json.dumps(TIKTOK_MENTIONS_REGIONS,separators=(',',':'))
            r=await client.get(
              TIKTOK_BUSINESS_BASE+'/business/mention/video/list/',
              headers={'Access-Token':token,'Accept':'application/json'},
              params=params
            )
            try: d=r.json()
            except: d={'message':r.text[:700]}
            ok=r.status_code==200 and d.get('code') in (0,None)
            out['content'].update({'ok':ok,'status':r.status_code,'code':d.get('code'),'message':d.get('message')})
            if not ok:
                break
            data=d.get('data') or {}
            rows=data.get('videos') or []
            out['content']['pages']+=1
            for x in rows:
                pid=str(x.get('item_id') or '').strip()
                if not pid: continue
                ct=x.get('create_time')
                published=None
                try:
                    if ct is not None: published=datetime.fromtimestamp(int(ct),timezone.utc).isoformat()
                except: published=str(ct) if ct else None
                content_items.append({
                  'platform_video_id':pid,
                  'url':x.get('video_link') or f'https://www.tiktok.com/@/video/{pid}',
                  'creator':{'username':x.get('creator_handle_name') or 'tiktok_mention'},
                  'caption':x.get('caption') or '',
                  'transcript':'',
                  'search_keyword':'TikTok Official @Mention',
                  'view_count':x.get('views') or 0,
                  'like_count':x.get('likes') or 0,
                  'comment_count':x.get('comments') or 0,
                  'share_count':x.get('shares') or 0,
                  'published_at':published,
                  'comments':[]
                })
            if not data.get('has_more') or not rows:
                break
            cursor=int(data.get('cursor') or (cursor+len(rows)))
        if content_items:
            out['ingested']+=upsert_items(content_items,'tiktok_business_mentions','TikTok Official @Mention')
        out['content']['items']=len(content_items)

        # Comment mentions: group comments by source video so OpenAI gets conversation evidence.
        cursor=0
        grouped={}
        for page in range(10):
            params={
              'business_id':business_id,
              'fields':json.dumps(comment_fields,separators=(',',':')),
              'sort_field':'COMMENT_CREATE_TIME',
              'sort_type':'DESC',
              'number_of_days':TIKTOK_MENTIONS_DAYS,
              'cursor':cursor,
              'max_count':100
            }
            if TIKTOK_MENTIONS_REGIONS:
                params['regions']=json.dumps(TIKTOK_MENTIONS_REGIONS,separators=(',',':'))
            r=await client.get(
              TIKTOK_BUSINESS_BASE+'/business/mention/comment/list/',
              headers={'Access-Token':token,'Accept':'application/json'},
              params=params
            )
            try: d=r.json()
            except: d={'message':r.text[:700]}
            ok=r.status_code==200 and d.get('code') in (0,None)
            out['comments'].update({'ok':ok,'status':r.status_code,'code':d.get('code'),'message':d.get('message')})
            if not ok:
                break
            data=d.get('data') or {}
            rows=data.get('comments') or []
            out['comments']['pages']+=1
            for x in rows:
                pid=str(x.get('item_id') or '').strip()
                txt=str(x.get('comment_text') or '').strip()
                if not pid or not txt: continue
                g=grouped.setdefault(pid,{
                  'platform_video_id':pid,
                  'url':x.get('video_link') or f'https://www.tiktok.com/@/video/{pid}',
                  'creator':{'username':'tiktok_mention'},
                  'caption':x.get('caption') or '',
                  'transcript':'',
                  'search_keyword':'TikTok Official Comment Mention',
                  'view_count':0,
                  'like_count':x.get('video_likes') or 0,
                  'comment_count':0,
                  'share_count':0,
                  'published_at':None,
                  'comments':[]
                })
                ct=x.get('comment_create_time')
                try:
                    published=datetime.fromtimestamp(int(ct),timezone.utc).isoformat() if ct is not None else None
                except: published=str(ct) if ct else None
                g['comments'].append({
                  'text':txt,
                  'author':x.get('commenter_display_name'),
                  'likes':_num(x.get('comment_likes')),
                  'published_at':published,
                  'comment_id':str(x.get('comment_id') or ''),
                  'comment_type':x.get('comment_type')
                })
                g['comment_count']=len(g['comments'])
            if not data.get('has_more') or not rows:
                break
            cursor=int(data.get('cursor') or (cursor+len(rows)))

        comment_items=list(grouped.values())
        if comment_items:
            out['ingested']+=upsert_items(comment_items,'tiktok_business_mentions','TikTok Official Comment Mention')
            # Existing analyses must be regenerated now that comments are richer evidence.
            ids=[x['platform_video_id'] for x in comment_items]
            with db() as c:
                q=','.join('?' for _ in ids)
                rows=c.execute(f'SELECT id FROM videos WHERE platform_video_id IN ({q})',ids).fetchall()
                for row in rows:
                    c.execute('DELETE FROM analyses WHERE video_id=?',(row['id'],))
        out['comments']['items']=sum(len(x.get('comments') or []) for x in comment_items)

    set_provider_health('tiktok_business_mentions',bool(out['content'].get('ok') or out['comments'].get('ok')),out)
    return out

async def sync_tiktok_owned():
    # Business API is now the canonical TikTok connection. Mentions sync is the useful
    # market signal; owned-account sync can be added once Account Media permission is granted.
    return await sync_tiktok_mentions()


async def test_apify():
    token=apify_token()
    if not token: return {'ok':False,'error':'not configured'}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r=await client.get('https://api.apify.com/v2/users/me',headers={'Authorization':f'Bearer {token}'})
        ok=r.status_code==200
        detail={'status':r.status_code}
        if ok:
            d=(r.json().get('data') or {})
            detail.update({'username':d.get('username'),'plan':d.get('plan')})
        else:
            detail['error']=r.text[:300]
        set_provider_health('apify',ok,detail)
        return {'ok':ok,**detail}
    except Exception as e:
        set_provider_health('apify',False,str(e))
        return {'ok':False,'error':str(e)}

async def sync_apify_search():
    token=apify_token()
    if not token: return {'skipped':'APIFY_API_TOKEN not configured'}
    with db() as c:
        keywords=[x['keyword'] for x in c.execute('SELECT keyword FROM keywords WHERE enabled=1 ORDER BY category,keyword').fetchall()]
    if not keywords: return {'skipped':'no enabled keywords'}
    batch_size=max(1,min(APIFY_KEYWORDS_PER_RUN,len(keywords)))
    try: cursor=int(get_state('apify_keyword_cursor','0') or 0)
    except: cursor=0
    cursor=cursor%len(keywords)
    batch=[keywords[(cursor+i)%len(keywords)] for i in range(batch_size)]
    next_cursor=(cursor+batch_size)%len(keywords)

    payload={
      'keywords':batch,'region':APIFY_REGION,'language':APIFY_LANGUAGE,
      'maxResults':max(1,min(APIFY_RESULTS_PER_KEYWORD,100)),
      'sort':'relevance','publishedWithin':APIFY_PUBLISHED_WITHIN,
      'deepSearch':False,'includeAds':False
    }
    url=f'https://api.apify.com/v2/actors/{APIFY_SEARCH_ACTOR}/run-sync-get-dataset-items'
    async with httpx.AsyncClient(timeout=290) as client:
        r=await client.post(url,headers={'Authorization':f'Bearer {token}','Content-Type':'application/json','Accept':'application/json'},json=payload)
    if r.status_code not in (200,201):
        set_provider_health('apify',False,{'status':r.status_code,'error':r.text[:500]})
        raise RuntimeError(f'Apify search failed {r.status_code}: {r.text[:500]}')
    rows=r.json() if isinstance(r.json(),list) else []
    items=[]
    for x in rows:
        pid=str(x.get('video_id') or x.get('id') or '').strip()
        vurl=str(x.get('url') or x.get('share_url') or '').strip()
        if not pid or not vurl: continue
        author=x.get('author') or {}
        if isinstance(author,str): creator=author
        else: creator=author.get('unique_id') or author.get('username') or author.get('nickname')
        stats=x.get('stats') or {}
        published=x.get('create_time')
        if not isinstance(published,str):
            published=x.get('createTimeISO') or x.get('create_timestamp')
            if isinstance(published,(int,float)):
                published=datetime.fromtimestamp(published,timezone.utc).isoformat()
        items.append({
          'platform_video_id':pid,'url':vurl,'creator':{'username':creator},
          'caption':x.get('desc') or x.get('caption') or x.get('text') or '',
          'transcript':'','search_keyword':x.get('keyword') or '',
          'view_count':stats.get('play_count') or x.get('playCount') or x.get('views') or 0,
          'like_count':stats.get('digg_count') or x.get('diggCount') or x.get('likes') or 0,
          'comment_count':stats.get('comment_count') or x.get('commentCount') or x.get('comments') or 0,
          'share_count':stats.get('share_count') or x.get('shareCount') or x.get('shares') or 0,
          'published_at':published,'comments':[]
        })
    ingested=upsert_items(items,'apify_tiktok_search',None)
    set_state('apify_keyword_cursor',next_cursor)
    detail={'keywords':batch,'rows':len(rows),'ingested':ingested,'next_cursor':next_cursor}
    set_provider_health('apify',True,detail)
    return detail

async def enrich_apify_comments(limit_videos=None, comments_per_video=None):
    token=apify_token()
    if not token: return {'skipped':'APIFY_API_TOKEN not configured'}
    lv=max(1,min(int(limit_videos or APIFY_COMMENTS_VIDEOS_DAILY),20))
    cp=max(1,min(int(comments_per_video or APIFY_COMMENTS_PER_VIDEO),100))
    with db() as c:
        videos=[dict(x) for x in c.execute("""
          SELECT * FROM videos
          WHERE source='apify_tiktok_search' AND comment_count>0
            AND (comments_json IS NULL OR comments_json='[]')
          ORDER BY comment_count DESC, view_count DESC, collected_at DESC LIMIT ?
        """,(lv,)).fetchall()]
    if not videos: return {'enriched':0,'comments':0,'message':'no unenriched videos'}
    payload={
      'mode':'videos','videoUrls':[v['url'] for v in videos],
      'maxCommentsPerVideo':cp,'minCommentLikes':0,'excludeReplies':True,
      'commentsSinceDays':14,'fetchReplies':False,'proxyTier':'datacenter'
    }
    url=f'https://api.apify.com/v2/actors/{APIFY_COMMENTS_ACTOR}/run-sync-get-dataset-items'
    async with httpx.AsyncClient(timeout=290) as client:
        r=await client.post(url,headers={'Authorization':f'Bearer {token}','Content-Type':'application/json','Accept':'application/json'},json=payload)
    if r.status_code not in (200,201):
        raise RuntimeError(f'Apify comments failed {r.status_code}: {r.text[:500]}')
    rows=r.json() if isinstance(r.json(),list) else []
    grouped={}
    for x in rows:
        txt=str(x.get('text') or '').strip()
        if not txt: continue
        vid=str(x.get('videoId') or x.get('video_id') or '').strip()
        vurl=str(x.get('videoUrl') or x.get('inputVideo') or '')
        key=vid or vurl
        if not key: continue
        grouped.setdefault(key,[]).append({
          'text':txt,'author':x.get('authorUsername') or x.get('authorNickname'),
          'likes':_num(x.get('diggCount') or x.get('likes')),
          'published_at':x.get('createTimeIso') or x.get('create_time')
        })
    enriched=0; total_comments=0
    with db() as c:
        for v in videos:
            comments=grouped.get(str(v['platform_video_id'])) or grouped.get(v['url']) or []
            if not comments: continue
            c.execute('UPDATE videos SET comments_json=?, collected_at=? WHERE id=?',
                      (json.dumps(comments[:cp],ensure_ascii=False),now_iso(),v['id']))
            c.execute('DELETE FROM analyses WHERE video_id=?',(v['id'],))
            enriched+=1; total_comments+=len(comments[:cp])
    return {'enriched':enriched,'comments':total_comments,'requested_videos':len(videos)}

async def sync_meltwater(hours=6):
    token=meltwater_token(); search_id=meltwater_search_id()
    if not (token and search_id):
        return {'skipped':'Meltwater credentials not configured'}
    end=datetime.now(timezone.utc); start=end-timedelta(hours=max(1,min(hours,168)))
    payload={'start':start.replace(microsecond=0).isoformat().replace('+00:00','Z'),
             'end':end.replace(microsecond=0).isoformat().replace('+00:00','Z'),
             'page':1,'page_size':100,'sort_by':'date','sort_order':'desc','template':{'name':'api.json'}}
    items=[]; pages=0; total=0
    async with httpx.AsyncClient(timeout=60) as client:
        while pages<10:
            payload['page']=pages+1
            r=await client.post(f'https://api.meltwater.com/v3/search/{search_id}',
              headers={'Accept':'application/json','Content-Type':'application/json','apikey':token},json=payload)
            r.raise_for_status(); d=r.json()
            result=d.get('result') or {}; docs=result.get('documents') or []; total=result.get('document_count') or total
            if not docs: break
            for doc in docs:
                source=doc.get('source') or {}; source_blob=' '.join(str(source.get(k) or '') for k in ['id','name','domain','url']).lower()
                url=str(doc.get('url') or '')
                if 'tiktok' not in source_blob and 'tiktok.com' not in url.lower(): continue
                content=doc.get('content') or {}; author=doc.get('author') or {}; metrics=doc.get('metrics') or {}; eng=metrics.get('engagement') or {}
                matched=doc.get('matched') or {}
                pid=str(doc.get('external_id') or doc.get('id') or uuid.uuid5(uuid.NAMESPACE_URL,url or json.dumps(doc,sort_keys=True,default=str)).hex)
                caption=content.get('body') or content.get('opening_text') or content.get('title') or matched.get('hit_sentence') or ''
                kws=matched.get('keywords') or []
                items.append({
                  'platform_video_id':pid,'url':url or source.get('url') or f'https://www.tiktok.com/',
                  'creator':{'username':author.get('handle') or author.get('name')},'caption':caption,'transcript':'',
                  'search_keyword':', '.join(map(str,kws[:8])) or f'Meltwater Search {search_id}',
                  'view_count':metrics.get('views',0),'like_count':eng.get('likes',0),
                  'comment_count':eng.get('comments') or eng.get('replies') or 0,'share_count':eng.get('shares',0),
                  'published_at':doc.get('published_date'),'comments':[]
                })
            pages+=1
            if len(docs)<payload['page_size']: break
    return {'ingested':upsert_items(items,'meltwater',f'Meltwater {search_id}'),'pages':pages,'matched_total':total}

async def provider_sync():
    out={}
    try: out['tiktok_official']=await sync_tiktok_mentions()
    except Exception as e: out['tiktok_official']={'error':str(e)}
    if apify_token():
        try: out['apify']=await sync_apify_search()
        except Exception as e: out['apify']={'error':str(e)}
    elif meltwater_token() and meltwater_search_id():
        try: out['meltwater']=await sync_meltwater()
        except Exception as e: out['meltwater']={'error':str(e)}
    else:
        out['market_provider']={'skipped':'Apify/Meltwater not configured'}
    return out

async def refresh_market_and_analysis():
    before=await analyze_pending(200)
    providers=await provider_sync()
    after=await analyze_pending(200)
    daily=generate_insight()
    combined={
      'analyzed':int(before.get('analyzed') or 0)+int(after.get('analyzed') or 0),
      'pending':after.get('pending',before.get('pending',0)),
      'failed':(before.get('failed') or [])+(after.get('failed') or [])
    }
    print('refresh complete',json.dumps({'analysis':{'analyzed':combined['analyzed'],'pending':combined['pending'],'failed':len(combined['failed'])},'providers':list(providers.keys())},ensure_ascii=False),flush=True)
    return {'providers':providers,'analysis':combined,'daily':daily}

@app.on_event('startup')
def startup():
    init_db(); seed_keywords()
    print('tiktok readiness '+json.dumps({
      'app_id_ready':bool(tiktok_client_key()),
      'app_secret_ready':bool(tiktok_client_secret()),
      'redirect_uri':TIKTOK_REDIRECT_URI,
      'connected':bool(get_secret('tiktok_business_access_token','TIKTOK_ACCESS_TOKEN'))
    }),flush=True)
    def _probe():
        import asyncio
        try: asyncio.run(probe_tiktok_oembed())
        except Exception as e: print('probe',e,flush=True)
    threading.Thread(target=_probe,daemon=True).start()
    threading.Thread(target=scheduler,daemon=True).start()

@app.get('/health')
def health():
    with db() as c: n=c.execute('SELECT count(*) n FROM videos').fetchone()['n']
    return {'ok':True,'version':'4.1','db':True,'videos':n,'ai_mode':'openai' if openai_key() else 'fallback','providers':provider_status()}

@app.get('/ready')
def ready():
    with db() as c:
        videos=c.execute('SELECT count(*) n FROM videos').fetchone()['n']
        keywords=c.execute('SELECT count(*) n FROM keywords WHERE enabled=1').fetchone()['n']
        ph=c.execute("SELECT ok,detail,checked_at FROM provider_health WHERE provider='tiktok_oembed'").fetchone()
        analyzed=c.execute('SELECT count(*) n FROM analyses').fetchone()['n']
    probe=dict(ph) if ph else None
    return {
      'ready': bool(probe and probe.get('ok')),
      'version':'5.0',
      'database':True,
      'video_count':videos,
      'analyzed_count':analyzed,
      'pending_count':max(videos-analyzed,0),
      'keyword_count':keywords,
      'tiktok_oembed':probe,
      'ai_mode':'openai' if OPENAI_API_KEY else 'fallback',
      'owned_tiktok_connected':bool(get_secret('tiktok_business_access_token','TIKTOK_ACCESS_TOKEN')),
      'tiktok_app_id_ready':bool(tiktok_business_app_id()),
      'tiktok_app_secret_ready':bool(tiktok_business_app_secret()),
      'tiktok_redirect_uri':TIKTOK_REDIRECT_URI,
      'market_provider_connected':bool(apify_token() or (meltwater_token() and meltwater_search_id()))
    }


@app.get('/api/settings/status')
def settings_status(_=Depends(admin)):
    return {
      'openai':bool(openai_key()),
      'apify_token':bool(apify_token()),
      'apify_search_actor':APIFY_SEARCH_ACTOR,
      'apify_comments_actor':APIFY_COMMENTS_ACTOR,
      'apify_region':APIFY_REGION,
      'apify_keywords_per_run':APIFY_KEYWORDS_PER_RUN,
      'apify_results_per_keyword':APIFY_RESULTS_PER_KEYWORD,
      'meltwater_token':bool(meltwater_token()),
      'meltwater_search_id':bool(meltwater_search_id()),
      'tiktok_client_key':bool(tiktok_business_app_id()),
      'tiktok_client_secret':bool(tiktok_business_app_secret()),
      'tiktok_business_app_id_ready':bool(tiktok_business_app_id()),
      'tiktok_business_app_secret_ready':bool(tiktok_business_app_secret()),
      'tiktok_connected':bool(get_secret('tiktok_business_access_token','TIKTOK_ACCESS_TOKEN')),
      'tiktok_redirect_uri':TIKTOK_REDIRECT_URI,'tiktok_business_callback':TIKTOK_BUSINESS_CALLBACK,'tiktok_scope':get_secret('tiktok_business_scope') or None
    }

@app.post('/api/settings/secrets')
def settings_secrets(body:dict,_=Depends(admin)):
    allowed={'openai_api_key','apify_api_token','meltwater_api_token','meltwater_search_id','tiktok_client_key','tiktok_client_secret','tiktok_business_app_id','tiktok_business_app_secret'}
    saved=[]
    for name in allowed:
        val=body.get(name)
        if isinstance(val,str) and val.strip():
            set_secret(name,val.strip()); saved.append(name)
    return {'ok':True,'saved':saved}

@app.post('/api/settings/test')
async def settings_test(_=Depends(admin)):
    out={}
    key=openai_key()
    if key:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r=await client.get('https://api.openai.com/v1/models',headers={'Authorization':f'Bearer {key}'})
            out['openai']={'ok':r.status_code==200,'status':r.status_code}
            if r.status_code==200:
                out['openai']['reanalyze']=await reanalyze_fallback(500)
        except Exception as e: out['openai']={'ok':False,'error':str(e)}
    else: out['openai']={'ok':False,'error':'not configured'}
    out['apify']=await test_apify()
    if out['apify'].get('ok'):
        try:
            out['apify']['sync']=await sync_apify_search()
            out['analysis']=await analyze_pending(200)
            out['daily']=generate_insight()
        except Exception as e: out['apify']['sync_error']=str(e)
    if meltwater_token():
        out['meltwater']={'configured':True}
    out['tiktok_business']={
      'app_id_ready':bool(tiktok_business_app_id()),
      'app_secret_ready':bool(tiktok_business_app_secret()),
      'connected':bool(get_secret('tiktok_business_access_token','TIKTOK_ACCESS_TOKEN')),
      'redirect_uri':TIKTOK_REDIRECT_URI
    }
    if out['tiktok_business']['connected']:
        out['tiktok_business']['token_info']=await tiktok_business_token_info()
    return out

@app.post('/api/apify/sync')
async def apify_sync(_=Depends(admin)):
    return {'ok':True,'result':await sync_apify_search()}

@app.post('/api/apify/comments/enrich')
async def apify_comments_enrich(body:dict|None=None,_=Depends(admin)):
    body=body or {}
    result=await enrich_apify_comments(body.get('limit_videos'),body.get('comments_per_video'))
    if result.get('enriched'):
        result['analysis']=await analyze_pending(100)
        result['daily']=generate_insight()
    return {'ok':True,'result':result}

@app.get('/api/tiktok/oauth/url')
def tiktok_oauth_url(_=Depends(admin)):
    app_id=tiktok_business_app_id()
    if not (app_id and tiktok_business_app_secret()):
        raise HTTPException(400,'TikTok Business App ID / App Secret not configured')
    state=secrets.token_urlsafe(32)
    with db() as c:
        c.execute('DELETE FROM oauth_states WHERE expires_at < ?',(now_iso(),))
        c.execute('INSERT INTO oauth_states(state,provider,expires_at) VALUES(?,?,?)',
                  (state,'tiktok_business',(datetime.now(timezone.utc)+timedelta(minutes=15)).isoformat()))
    params={'client_key':app_id,'response_type':'code','redirect_uri':TIKTOK_REDIRECT_URI,'state':state}
    if TIKTOK_BUSINESS_SCOPES:
        params['scope']=TIKTOK_BUSINESS_SCOPES
    return {
      'url':'https://www.tiktok.com/v2/auth/authorize?'+urlencode(params),
      'redirect_uri':TIKTOK_REDIRECT_URI,
      'business_callback':TIKTOK_BUSINESS_CALLBACK,
      'scopes':TIKTOK_BUSINESS_SCOPES
    }

@app.get('/api/tiktok/business/callback',response_class=HTMLResponse)
async def tiktok_business_callback(auth_code:str|None=None,code:str|None=None,state:str|None=None,
                                   error:str|None=None,error_description:str|None=None):
    if error:
        return HTMLResponse('<meta charset="utf-8"><h2>TikTok authorization failed</h2><p>'+str(error)+'</p>',status_code=400)
    auth_code=auth_code or code
    if not auth_code or not state:
        return HTMLResponse('<meta charset="utf-8"><h2>Missing TikTok auth_code/state</h2>',status_code=400)
    with db() as c:
        row=c.execute("SELECT * FROM oauth_states WHERE state=? AND provider='tiktok_business'",(state,)).fetchone()
        if row: c.execute('DELETE FROM oauth_states WHERE state=?',(state,))
    if not row or row['expires_at'] < now_iso():
        return HTMLResponse('<meta charset="utf-8"><h2>Invalid or expired OAuth state</h2><p>กรุณากด Connect TikTok ใหม่จาก Dashboard</p>',status_code=400)
    try:
        payload={
          'client_id':tiktok_business_app_id(),
          'client_secret':tiktok_business_app_secret(),
          'grant_type':'authorization_code',
          'auth_code':auth_code,
          'redirect_uri':TIKTOK_REDIRECT_URI
        }
        async with httpx.AsyncClient(timeout=45) as client:
            r=await client.post(TIKTOK_BUSINESS_BASE+'/tt_user/oauth2/token/',
              headers={'Content-Type':'application/json'},json=payload)
            d=r.json()
        if r.status_code!=200 or d.get('code') not in (0,None):
            raise RuntimeError('TikTok token exchange: '+json.dumps(d,ensure_ascii=False)[:1000])
        data=d.get('data') or {}
        if not data.get('access_token'): raise RuntimeError('No access_token returned')
        set_secret('tiktok_business_access_token',data['access_token'])
        set_secret('tiktok_business_refresh_token',data.get('refresh_token') or '')
        set_secret('tiktok_business_access_expires_at',(datetime.now(timezone.utc)+timedelta(seconds=int(data.get('expires_in') or 86400))).isoformat())
        set_secret('tiktok_business_refresh_expires_at',(datetime.now(timezone.utc)+timedelta(seconds=int(data.get('refresh_token_expires_in') or 31536000))).isoformat())
        set_secret('tiktok_business_scope',str(data.get('scope') or ''))
        set_secret('tiktok_business_open_id',str(data.get('open_id') or ''))
        info=await tiktok_business_token_info()
        mentions=await sync_tiktok_mentions()
        await analyze_pending(200)
        generate_insight()
        return HTMLResponse('<meta charset="utf-8"><div style="font-family:system-ui;max-width:720px;margin:60px auto;padding:24px"><h2>✅ TikTok API for Business connected</h2><p>Token ถูกเก็บแบบเข้ารหัสแล้ว</p><p><b>Scopes:</b> '+str(data.get('scope') or '-')+'</p><p><b>Mentions Content:</b> '+('OK' if mentions.get('content',{}).get('ok') else 'ยังใช้ไม่ได้')+'</p><p><b>Mentions Comment:</b> '+('OK' if mentions.get('comments',{}).get('ok') else 'ยังใช้ไม่ได้')+'</p><p><a href="https://pawdy-social-listening-production.up.railway.app/">กลับ Dashboard</a></p></div>')
    except Exception as e:
        print('TikTok business callback failed',str(e),flush=True)
        return HTMLResponse('<meta charset="utf-8"><h2>TikTok token exchange failed</h2><pre>'+str(e)+'</pre>',status_code=500)

# Backward-compatible Railway callback: Vercel bridge should forward here.
@app.get('/api/tiktok/oauth/callback/',response_class=HTMLResponse)
async def tiktok_oauth_callback(auth_code:str|None=None,code:str|None=None,state:str|None=None,
                                error:str|None=None,error_description:str|None=None):
    return await tiktok_business_callback(auth_code,code,state,error,error_description)

@app.get('/api/tiktok/business/status')
async def tiktok_business_status(_=Depends(admin)):
    return {
      'connected':bool(get_secret('tiktok_business_access_token','TIKTOK_ACCESS_TOKEN')),
      'oauth_ready':bool(tiktok_business_app_id() and tiktok_business_app_secret()),
      'redirect_uri':TIKTOK_REDIRECT_URI,
      'scope':get_secret('tiktok_business_scope') or None,
      'open_id_present':bool(get_secret('tiktok_business_open_id')),
      'token_info':await tiktok_business_token_info()
    }

@app.get('/api/tiktok/business/diagnostic')
async def tiktok_business_diagnostic(_=Depends(admin)):
    info=await tiktok_business_token_info()
    saved_scope=get_secret('tiktok_business_scope') or ''
    token_data=info.get('data') if isinstance(info,dict) else None
    live_scope=''
    if isinstance(token_data,dict):
        live_scope=str(token_data.get('scope') or token_data.get('scopes') or '')
    scope=live_scope or saved_scope
    scopes=[x.strip() for x in scope.split(',') if x.strip()]
    return {
      'connected':bool(get_secret('tiktok_business_access_token','TIKTOK_ACCESS_TOKEN')),
      'app_id_ready':bool(tiktok_business_app_id()),
      'app_secret_ready':bool(tiktok_business_app_secret()),
      'redirect_uri':TIKTOK_REDIRECT_URI,
      'relay_target':TIKTOK_BUSINESS_CALLBACK,
      'open_id_present':bool(get_secret('tiktok_business_open_id')),
      'scope':scope or None,
      'scopes':scopes,
      'token_info_ok':bool(info.get('ok')) if isinstance(info,dict) else False,
      'token_info_message':info.get('message') if isinstance(info,dict) else None,
      'mentions_content_test':(await sync_tiktok_mentions()).get('content',{}) if get_secret('tiktok_business_access_token','TIKTOK_ACCESS_TOKEN') else {'ok':False,'message':'not connected'}
    }

@app.get('/api/tiktok/business/relay-template')
def tiktok_business_relay_template(_=Depends(admin)):
    html='''<!doctype html><html lang="th"><meta charset="utf-8"><title>TikTok Authorization</title>
<body style="font-family:system-ui;padding:40px"><h2>กำลังเชื่อม TikTok กับ Pawdy Social Intelligence…</h2>
<p id="s">กำลังส่ง authorization code ไปยังระบบที่ปลอดภัย</p>
<script>
const q=new URLSearchParams(location.search);
const target=new URL("https://pawdy-social-listening-production.up.railway.app/api/tiktok/business/callback");
["auth_code","code","state","error","error_description"].forEach(k=>{const v=q.get(k);if(v)target.searchParams.set(k,v)});
if((q.get("auth_code")||q.get("code")) && q.get("state")) location.replace(target.toString());
else document.getElementById("s").textContent="ไม่พบ auth_code/state กรุณากลับไปกด Connect TikTok Business ใหม่";
</script></body></html>'''
    return {'path':'/tiktok-callback.html','html':html,'relay_target':TIKTOK_BUSINESS_CALLBACK}

@app.post('/api/tiktok/mentions/sync')
async def tiktok_mentions_sync(_=Depends(admin)):
    r=await sync_tiktok_mentions()
    a=await analyze_pending(200)
    d=generate_insight()
    return {'ok':True,'mentions':r,'analysis':a,'daily':d}

@app.post('/api/ingest')
def ingest(body:dict,_=Depends(ingest_auth)):
    items=body.get('videos') if isinstance(body.get('videos'),list) else []
    return {'ok':True,'ingested':upsert_items(items,body.get('source') or 'provider',body.get('search_keyword'))}

@app.get('/api/providers/status')
def providers(_=Depends(admin)):
    return provider_status()


@app.get('/api/keywords')
def get_keywords(_=Depends(admin)):
    with db() as c:
        rows=[dict(x) for x in c.execute('SELECT * FROM keywords ORDER BY category,keyword').fetchall()]
    return {'keywords':rows}

@app.post('/api/keywords')
def add_keyword(body:dict,_=Depends(admin)):
    kw=str(body.get('keyword') or '').strip()
    if not kw: raise HTTPException(400,'keyword required')
    cat=str(body.get('category') or 'custom').strip()[:80]
    with db() as c:
        c.execute('INSERT OR IGNORE INTO keywords(id,keyword,category,enabled,created_at) VALUES(?,?,?,?,?)',
                  (uid(),kw,cat,1,now_iso()))
    return {'ok':True,'keyword':kw,'category':cat}

@app.delete('/api/keywords/{keyword_id}')
def delete_keyword(keyword_id:str,_=Depends(admin)):
    with db() as c: c.execute('DELETE FROM keywords WHERE id=?',(keyword_id,))
    return {'ok':True}

@app.post('/api/providers/probe')
async def probe_providers(_=Depends(admin)):
    return {'tiktok_oembed':await probe_tiktok_oembed(),'status':provider_status()}

@app.post('/api/tiktok/import_urls')
async def tiktok_import_urls(body:dict,_=Depends(admin)):
    urls=body.get('urls') if isinstance(body.get('urls'),list) else []
    keyword=str(body.get('keyword') or 'Manual TikTok URL').strip()
    return {'ok':True,**(await import_tiktok_urls(urls,keyword))}

@app.post('/api/tiktok/owned/sync')
async def tiktok_owned_sync(_=Depends(admin)):
    return {'ok':True,**(await sync_tiktok_owned())}

@app.post('/api/meltwater/sync')
async def meltwater_sync(_=Depends(admin)):
    return {'ok':True,**(await sync_meltwater())}

@app.post('/api/providers/sync')
async def providers_sync(_=Depends(admin)):
    return {'ok':True,**(await refresh_market_and_analysis())}

@app.post('/api/import/csv')
async def import_csv(file:UploadFile=File(...),_=Depends(admin)):
    raw=(await file.read()).decode('utf-8-sig'); rows=[]
    for i,r in enumerate(csv.DictReader(io.StringIO(raw))):
        pid=r.get('platform_video_id') or r.get('video_id') or f'csv-{int(time.time())}-{i}'
        rows.append({'platform_video_id':pid,'url':r.get('url') or f'https://www.tiktok.com/video/{pid}','creator':{'username':r.get('creator_username') or r.get('username') or 'csv_import'},'caption':r.get('caption') or '','transcript':r.get('transcript') or '','search_keyword':r.get('search_keyword') or 'CSV Import','view_count':int(float(r.get('view_count') or 0)),'like_count':int(float(r.get('like_count') or 0)),'comment_count':int(float(r.get('comment_count') or 0)),'share_count':int(float(r.get('share_count') or 0)),'published_at':r.get('published_at') or None,'comments':[]})
    return ingest({'source':'csv','videos':rows},None)

@app.post('/api/pipeline/run')
async def pipeline(_=Depends(admin)):
    return {'ok':True,**(await refresh_market_and_analysis())}

@app.get('/api/dashboard')
def dashboard(_=Depends(admin)):
    with db() as c:
        feed=[dict(x) for x in c.execute('''SELECT v.*,a.topic,a.sentiment,a.sentiment_score,a.purchase_intent,a.opportunity,a.opportunity_score,a.risk_level,a.summary FROM videos v LEFT JOIN analyses a ON a.video_id=v.id ORDER BY v.collected_at DESC LIMIT 300''').fetchall()]
        di=c.execute('SELECT payload FROM daily_insights ORDER BY day DESC LIMIT 1').fetchone()
        kws=[dict(x) for x in c.execute('SELECT * FROM keywords WHERE enabled=1 ORDER BY category,keyword').fetchall()]
    views=sum(int(x.get('view_count') or 0) for x in feed[:100]); eng=sum(int(x.get('like_count') or 0)+int(x.get('comment_count') or 0)+int(x.get('share_count') or 0) for x in feed[:100])
    analyzed=sum(1 for x in feed if x.get('topic'))
    insight=json.loads(di['payload']) if di else {'rising_topics':[],'consumer_questions':[],'pain_points':[],'content_ideas':[],'risks':[]}
    return {'generatedAt':now_iso(),'summary':{'videos':len(feed),'analyzed':analyzed,'pending':max(len(feed)-analyzed,0),'views':views,'engagement_rate':round(eng/max(views,1)*100,2),'high_risk':sum(1 for x in feed if x.get('risk_level') in ('high','critical'))},'providers':provider_status(),'keywords':kws,'insight':insight,'feed':feed}

def scheduler():
    last_daily=''; last_provider=0.0; last_probe=0.0
    while True:
        try:
            n=datetime.now(TZ); day=n.date().isoformat(); ts=time.time()
            if ts-last_provider >= max(PROVIDER_SYNC_MINUTES,10)*60:
                import asyncio
                asyncio.run(refresh_market_and_analysis())
                last_provider=ts
            if ts-last_probe >= 21600:
                import asyncio; asyncio.run(probe_tiktok_oembed()); last_probe=ts
            if n.hour==RUN_HOUR and last_daily!=day:
                import asyncio
                if apify_token():
                    try: asyncio.run(enrich_apify_comments())
                    except Exception as e: print('apify comments',e,flush=True)
                asyncio.run(analyze_pending(500)); generate_insight(); last_daily=day
        except Exception as e: print('scheduler',e,flush=True)
        time.sleep(30)

HTML=r'''<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pawdy Social Intelligence</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f4f7f2;color:#172012}
header{background:#193c1b;color:white;padding:20px 5vw}
main{padding:24px 5vw}.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.card{background:white;border-radius:16px;padding:18px;box-shadow:0 2px 12px #0001;flex:1;min-width:220px;margin-bottom:16px}
.big{font-size:32px;font-weight:800}.tag{background:#e9f4df;border-radius:999px;padding:6px 10px;display:inline-block;margin:3px;text-decoration:none;color:#27411c}
button,input,select,textarea{padding:10px 12px;border-radius:10px;border:1px solid #ccd6c6;font:inherit}
button{background:#98ca40;border:0;font-weight:700;cursor:pointer}button:disabled{opacity:.55;cursor:not-allowed}
textarea{box-sizing:border-box}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:9px;border-bottom:1px solid #eee;font-size:14px}
.muted{color:#667}.ok{color:#237a29;font-weight:700}.bad{color:#b3261e;font-weight:700}.status{padding:9px 12px;border-radius:10px;background:#eef3ea}
</style>
</head>
<body>
<header><h1>Pawdy Social Intelligence</h1><div>TikTok Listening → AI Analysis → Daily Content Insight</div></header>
<main>
<div class="row">
  <input id="t" type="password" placeholder="Admin token" autocomplete="current-password">
  <button id="connectBtn" onclick="connect()">Connect</button>
  <button onclick="run()">Run Pipeline</button>
  <button onclick="syncProviders()">Sync + Analyze</button>
  <span id="loginStatus" class="status muted">Not connected</span>
</div>

<div class="card" style="margin-top:16px">
<h3>🔐 Secure Connections</h3>
<div class="row">
  <input id="openaiKey" type="password" placeholder="OpenAI API key">
  <input id="apifyToken" type="password" placeholder="Apify API token">
  <span class="muted">Market: TH • rotating keywords • budget-safe</span>
</div>
<div class="row" style="margin-top:8px">
  <input id="ttKey" type="password" placeholder="TikTok Business App ID">
  <input id="ttSecret" type="password" placeholder="TikTok Business App Secret">
  <button onclick="saveSecrets()">Save & Test</button>
  <button onclick="connectTikTok()">Connect TikTok Business</button>
  <button onclick="checkTikTok()">Check TikTok Official</button>
  <button onclick="enrichComments()">Enrich Comments</button>
</div>
<div id="settingsStatus" class="muted" style="margin-top:10px"></div>
</div>

<div class="card">
<h3>Listening Workspace</h3>
<div class="row">
  <input id="newkw" placeholder="เพิ่ม keyword เช่น หมาแก่กินน้อย">
  <button onclick="addKeyword()">Add Keyword</button>
  <button onclick="probe()">Test TikTok Connection</button>
</div>
<div id="keywords" style="margin:12px 0"></div>
<select id="kwselect"></select>
<textarea id="urls" style="width:100%;min-height:90px;margin-top:8px" placeholder="วาง TikTok URL ทีละบรรทัด แล้วเลือก keyword ด้านบน"></textarea><br>
<button onclick="importUrls()">Import + Analyze</button>
<div id="providerStatus" class="muted" style="margin-top:10px"></div>
</div>

<div id="app"></div>
</main>

<script>
let token=localStorage.pawdyToken||'';
const $=id=>document.getElementById(id);
$('t').value=token;

function esc(v){
  return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function safeUrl(v){
  try{let u=new URL(v);return u.protocol==='https:'?u.href:'#'}catch{return '#'}
}
function setLogin(text,kind='muted'){
  $('loginStatus').className='status '+kind;
  $('loginStatus').textContent=text;
}
async function api(path,opt={}){
  opt.headers=Object.assign({'Authorization':'Bearer '+token},opt.headers||{});
  const r=await fetch(path,opt);
  if(r.status===401) throw new Error('Admin Token ไม่ถูกต้อง');
  if(!r.ok) throw new Error((await r.text())||('HTTP '+r.status));
  return r.json();
}
async function connect(){
  token=$('t').value.trim();
  if(!token){setLogin('กรุณาใส่ Admin Token','bad');return}
  localStorage.pawdyToken=token;
  $('connectBtn').disabled=true;
  setLogin('Connecting…');
  try{
    await api('/api/dashboard');
    setLogin('Connected ✓','ok');
    await Promise.all([loadStatus(),loadSettings(),loadKeywords()]);
    await load();
  }catch(e){
    setLogin(e.message,'bad');
    $('app').innerHTML='<div class="card bad">'+esc(e.message)+'</div>';
  }finally{$('connectBtn').disabled=false}
}
async function run(){
  try{setLogin('Running pipeline…');await api('/api/pipeline/run',{method:'POST'});setLogin('Connected ✓','ok');await load()}
  catch(e){setLogin(e.message,'bad')}
}
async function syncProviders(){
  try{
    setLogin('Syncing + analyzing…');
    const r=await api('/api/providers/sync',{method:'POST'});
    setLogin('Connected ✓','ok');
    alert('เสร็จแล้ว: วิเคราะห์ '+(r.analysis?.analyzed||0)+' คลิป • ค้าง '+(r.analysis?.pending||0));
    await Promise.all([loadStatus(),load()]);
  }catch(e){setLogin(e.message,'bad');alert(e.message)}
}
async function importUrls(){
  const urls=$('urls').value.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  if(!urls.length){alert('กรุณาวาง TikTok URL อย่างน้อย 1 URL');return}
  const keyword=$('kwselect').value||'Manual TikTok URL';
  try{
    const r=await api('/api/tiktok/import_urls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({urls,keyword})});
    await api('/api/pipeline/run',{method:'POST'});
    alert('Imported '+r.ingested+' URLs'+(r.errors?.length?' • '+r.errors.length+' errors':''));
    await load();
  }catch(e){alert(e.message)}
}
async function loadStatus(){
  try{
    const p=await api('/api/providers/status');
    const oe=p.tiktok_oembed?.health;
    $('providerStatus').textContent='TikTok URL='+(oe?.ok?'LIVE':'checking')+' • TikTok Official='+(p.tiktok_mentions?.configured?'connected':'not connected')+' • Apify='+(p.apify?.configured?'connected':'not connected')+' • AI='+(p.openai.configured?'OpenAI':'fallback rules');
  }catch(e){$('providerStatus').textContent=e.message}
}
async function loadSettings(){
  try{
    const x=await api('/api/settings/status');
    const tt=x.tiktok_connected?'connected ✓':(!x.tiktok_business_app_secret_ready?'ต้องใส่ App Secret':(x.tiktok_business_app_id_ready?'พร้อม authorize':'ต้องใส่ App ID/Secret'));
    $('settingsStatus').textContent='OpenAI='+(x.openai?'connected':'not connected')+' • Apify='+(x.apify_token?'connected':'not connected')+' ('+x.apify_region+', '+x.apify_keywords_per_run+' keywords/run × '+x.apify_results_per_keyword+' videos) • TikTok Official='+tt+(x.tiktok_scope?' • Scope: '+x.tiktok_scope:'');
  }catch(e){$('settingsStatus').textContent=e.message}
}
async function saveSecrets(){
  try{
    const body={
      openai_api_key:$('openaiKey').value,
      apify_api_token:$('apifyToken').value,
      tiktok_business_app_id:$('ttKey').value,
      tiktok_business_app_secret:$('ttSecret').value
    };
    await api('/api/settings/secrets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const t=await api('/api/settings/test',{method:'POST'});
    alert('OpenAI: '+(t.openai.ok?'OK':'FAILED')+' • Apify: '+(t.apify.ok?'OK':'FAILED')+(t.apify.sync?' • '+(t.apify.sync.ingested||0)+' videos imported':'')+' • TikTok App ID: '+(t.tiktok_business?.app_id_ready?'OK':'MISSING')+' • TikTok Secret: '+(t.tiktok_business?.app_secret_ready?'OK':'MISSING'));
    ['openaiKey','apifyToken','ttKey','ttSecret'].forEach(id=>$(id).value='');
    await Promise.all([loadSettings(),loadStatus()]);
  }catch(e){alert(e.message)}
}
async function enrichComments(){
  try{
    if(!confirm('ดึง comments ของคลิปใหม่ที่ engagement สูงสุด ระบบจะใช้ Apify credits ต่อหรือไม่?'))return;
    const r=await api('/api/apify/comments/enrich',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit_videos:5,comments_per_video:20})});
    alert('Enriched '+(r.result.enriched||0)+' videos • '+(r.result.comments||0)+' comments');
    await load();
  }catch(e){alert(e.message)}
}
async function checkTikTok(){
  try{
    const r=await api('/api/tiktok/business/diagnostic');
    alert('TikTok Official: '+(r.connected?'CONNECTED':'NOT CONNECTED')+' • App ID '+(r.app_id_ready?'OK':'MISSING')+' • Secret '+(r.app_secret_ready?'OK':'MISSING')+' • Token '+(r.token_info_ok?'OK':'NOT READY')+(r.scope?' • Scope: '+r.scope:''));
    await loadSettings();
  }catch(e){alert(e.message)}
}
async function connectTikTok(){
  try{const r=await api('/api/tiktok/oauth/url');location.href=r.url}catch(e){alert(e.message)}
}
async function loadKeywords(){
  try{
    const r=await api('/api/keywords'), k=r.keywords||[];
    $('keywords').innerHTML=k.map(x=>'<a class="tag" target="_blank" rel="noopener" href="https://www.tiktok.com/search?q='+encodeURIComponent(x.keyword)+'">'+esc(x.keyword)+'</a>').join('');
    $('kwselect').innerHTML=k.map(x=>'<option value="'+esc(x.keyword)+'">'+esc(x.keyword)+'</option>').join('');
  }catch(e){$('keywords').textContent=e.message}
}
async function addKeyword(){
  const keyword=$('newkw').value.trim();
  if(!keyword)return;
  try{
    await api('/api/keywords',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keyword,category:'custom'})});
    $('newkw').value='';
    await loadKeywords();
  }catch(e){alert(e.message)}
}
async function probe(){
  try{
    const r=await api('/api/providers/probe',{method:'POST'});
    alert('TikTok oEmbed: '+(r.tiktok_oembed.ok?'LIVE':'FAILED'));
    await loadStatus();
  }catch(e){alert(e.message)}
}
function fmt(n){return new Intl.NumberFormat().format(n||0)}
async function load(){
  try{
    const d=await api('/api/dashboard'), s=d.summary, i=d.insight;
    $('app').innerHTML=
      '<div class="row">'+
      '<div class="card"><div class="muted">Videos</div><div class="big">'+fmt(s.videos)+'</div></div>'+
      '<div class="card"><div class="muted">Analyzed</div><div class="big">'+fmt(s.analyzed)+'</div><div class="muted">Pending '+fmt(s.pending)+'</div></div>'+
      '<div class="card"><div class="muted">Views</div><div class="big">'+fmt(s.views)+'</div></div>'+
      '<div class="card"><div class="muted">Engagement</div><div class="big">'+esc(s.engagement_rate)+'%</div></div>'+
      '<div class="card"><div class="muted">High Risk</div><div class="big">'+fmt(s.high_risk)+'</div></div></div>'+
      '<div class="card"><h2>🔥 Rising Topics</h2>'+((i.rising_topics||[]).map(x=>'<span class="tag">'+esc(x.topic)+' '+(x.growth_pct>=0?'+':'')+esc(x.growth_pct)+'% · '+esc(x.opportunity_score)+'/100</span>').join('')||'ยังไม่มีข้อมูล')+'</div>'+
      '<div class="row"><div class="card"><h2>💬 Questions</h2>'+((i.consumer_questions||[]).map(x=>'<div>• '+esc(Array.isArray(x)?x[0]:x)+'</div>').join('')||'ยังไม่มีข้อมูล')+'</div>'+
      '<div class="card"><h2>💡 Content Ideas</h2>'+((i.content_ideas||[]).map(x=>'<div><b>'+esc(x.score)+'</b> · '+esc(x.idea)+'</div>').join('')||'ยังไม่มีข้อมูล')+'</div></div>'+
      '<div class="card"><h2>Latest Feed</h2><table><thead><tr><th>Creator</th><th>Caption</th><th>Topic</th><th>Views</th><th>Score</th><th>Risk</th></tr></thead><tbody>'+
      (d.feed||[]).slice(0,50).map(x=>'<tr><td>'+esc(x.creator)+'</td><td><a href="'+safeUrl(x.url)+'" target="_blank" rel="noopener">'+esc((x.caption||'').slice(0,80))+'</a></td><td>'+esc(x.topic||'-')+'</td><td>'+fmt(x.view_count)+'</td><td>'+esc(x.opportunity_score||'-')+'</td><td>'+esc(x.risk_level||'-')+'</td></tr>').join('')+
      '</tbody></table></div>';
  }catch(e){
    $('app').innerHTML='<div class="card bad">เชื่อมต่อไม่สำเร็จ: '+esc(e.message)+'</div>';
    throw e;
  }
}
if(token){connect()}
</script>
</body>
</html>'''

@app.get('/',response_class=HTMLResponse)
def root(): return HTML

if __name__=='__main__':
    init_db(); uvicorn.run(app,host='0.0.0.0',port=int(os.getenv('PORT','8000')))
