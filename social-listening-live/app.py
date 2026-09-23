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
PROVIDER_SYNC_MINUTES = int(os.getenv('PROVIDER_SYNC_MINUTES','60'))
APP_SECRET_KEY = os.getenv('APP_SECRET_KEY','').strip()
TIKTOK_REDIRECT_URI = os.getenv('TIKTOK_REDIRECT_URI','https://pawdy-social-listening-production.up.railway.app/api/tiktok/oauth/callback/').strip()

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
def meltwater_token(): return get_secret('meltwater_api_token','MELTWATER_API_TOKEN')
def meltwater_search_id(): return get_secret('meltwater_search_id','MELTWATER_SEARCH_ID')
def tiktok_client_key(): return get_secret('tiktok_client_key','TIKTOK_CLIENT_KEY')
def tiktok_client_secret(): return get_secret('tiktok_client_secret','TIKTOK_CLIENT_SECRET')

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
      'meltwater': {'configured': bool(meltwater_token() and meltwater_search_id()), 'search_id': meltwater_search_id() or None},
      'tiktok_owned': {'configured': bool(get_secret('tiktok_access_token','TIKTOK_ACCESS_TOKEN')), 'oauth_ready': bool(tiktok_client_key() and tiktok_client_secret()), 'redirect_uri': TIKTOK_REDIRECT_URI},
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
              comments_json=excluded.comments_json,published_at=COALESCE(excluded.published_at,videos.published_at),
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
    access=get_secret('tiktok_access_token','TIKTOK_ACCESS_TOKEN')
    refresh=get_secret('tiktok_refresh_token','TIKTOK_REFRESH_TOKEN')
    exp=get_secret('tiktok_access_expires_at')
    if access and exp:
        try:
            if datetime.fromisoformat(exp) > datetime.now(timezone.utc)+timedelta(minutes=10):
                return access
        except: pass
    if access and not refresh: return access
    if not refresh: return ''
    ck=tiktok_client_key(); cs=tiktok_client_secret()
    if not (ck and cs): return access or ''
    async with httpx.AsyncClient(timeout=45) as client:
        r=await client.post('https://open.tiktokapis.com/v2/oauth/token/',
          headers={'Content-Type':'application/x-www-form-urlencoded'},
          data={'client_key':ck,'client_secret':cs,'grant_type':'refresh_token','refresh_token':refresh})
        r.raise_for_status(); d=r.json()
    if d.get('access_token'):
        set_secret('tiktok_access_token',d['access_token'])
        set_secret('tiktok_refresh_token',d.get('refresh_token') or refresh)
        set_secret('tiktok_access_expires_at',(datetime.now(timezone.utc)+timedelta(seconds=int(d.get('expires_in') or 86400))).isoformat())
        return d['access_token']
    return ''

async def sync_tiktok_owned():
    token=await get_valid_tiktok_token()
    if not token: return {'skipped':'TikTok OAuth not connected'}
    fields='id,title,video_description,create_time,share_url,like_count,comment_count,share_count,view_count'
    items=[]; cursor=None; pages=0
    async with httpx.AsyncClient(timeout=45) as client:
        while pages<5:
            body={'max_count':20}
            if cursor: body['cursor']=cursor
            r=await client.post('https://open.tiktokapis.com/v2/video/list/',params={'fields':fields},
              headers={'Authorization':f'Bearer {token}','Content-Type':'application/json'},json=body)
            r.raise_for_status(); d=r.json()
            err=d.get('error') or {}
            if err.get('code') not in (None,'ok',0): raise RuntimeError(str(err))
            data=d.get('data') or {}
            for v in data.get('videos') or []:
                items.append({'platform_video_id':str(v.get('id')),'url':v.get('share_url') or f"https://www.tiktok.com/video/{v.get('id')}",'creator':{'username':'owned_tiktok'},'caption':v.get('video_description') or v.get('title') or '','transcript':'','search_keyword':'Owned TikTok','view_count':v.get('view_count',0),'like_count':v.get('like_count',0),'comment_count':v.get('comment_count',0),'share_count':v.get('share_count',0),'published_at':datetime.fromtimestamp(v.get('create_time',0),timezone.utc).isoformat() if v.get('create_time') else None,'comments':[]})
            pages+=1
            if not data.get('has_more'): break
            cursor=data.get('cursor')
    return {'ingested':upsert_items(items,'tiktok_display_api','Owned TikTok'),'pages':pages}

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
    try: out['tiktok_owned']=await sync_tiktok_owned()
    except Exception as e: out['tiktok_owned']={'error':str(e)}
    try: out['meltwater']=await sync_meltwater()
    except Exception as e: out['meltwater']={'error':str(e)}
    return out


@app.on_event('startup')
def startup():
    init_db(); seed_keywords()
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
    probe=dict(ph) if ph else None
    return {
      'ready': bool(probe and probe.get('ok')),
      'version':'4.2',
      'database':True,
      'video_count':videos,
      'keyword_count':keywords,
      'tiktok_oembed':probe,
      'ai_mode':'openai' if OPENAI_API_KEY else 'fallback',
      'owned_tiktok_connected':bool(get_secret('tiktok_access_token','TIKTOK_ACCESS_TOKEN')),
      'market_provider_connected':bool(meltwater_token() and meltwater_search_id())
    }


@app.get('/api/settings/status')
def settings_status(_=Depends(admin)):
    return {'openai':bool(openai_key()),'meltwater_token':bool(meltwater_token()),'meltwater_search_id':bool(meltwater_search_id()),'tiktok_client_key':bool(tiktok_client_key()),'tiktok_client_secret':bool(tiktok_client_secret()),'tiktok_connected':bool(get_secret('tiktok_access_token','TIKTOK_ACCESS_TOKEN')),'tiktok_redirect_uri':TIKTOK_REDIRECT_URI}

@app.post('/api/settings/secrets')
def settings_secrets(body:dict,_=Depends(admin)):
    allowed={'openai_api_key','meltwater_api_token','meltwater_search_id','tiktok_client_key','tiktok_client_secret'}
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
        except Exception as e: out['openai']={'ok':False,'error':str(e)}
    else: out['openai']={'ok':False,'error':'not configured'}
    mt=meltwater_token()
    if mt:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r=await client.get('https://api.meltwater.com/v3/searches',headers={'Accept':'application/json','apikey':mt})
            out['meltwater']={'ok':r.status_code==200,'status':r.status_code}
        except Exception as e: out['meltwater']={'ok':False,'error':str(e)}
    else: out['meltwater']={'ok':False,'error':'not configured'}
    return out

@app.get('/api/tiktok/oauth/url')
def tiktok_oauth_url(_=Depends(admin)):
    ck=tiktok_client_key()
    if not (ck and tiktok_client_secret()): raise HTTPException(400,'TikTok client key/secret not configured')
    state=secrets.token_urlsafe(32)
    with db() as c:
        c.execute('DELETE FROM oauth_states WHERE expires_at < ?',(now_iso(),))
        c.execute('INSERT INTO oauth_states(state,provider,expires_at) VALUES(?,?,?)',(state,'tiktok',(datetime.now(timezone.utc)+timedelta(minutes=15)).isoformat()))
    params={'client_key':ck,'response_type':'code','scope':'user.info.basic,video.list','redirect_uri':TIKTOK_REDIRECT_URI,'state':state,'disable_auto_auth':'1'}
    return {'url':'https://www.tiktok.com/v2/auth/authorize/?'+urlencode(params),'redirect_uri':TIKTOK_REDIRECT_URI}

@app.get('/api/tiktok/oauth/callback/',response_class=HTMLResponse)
async def tiktok_oauth_callback(code:str|None=None,state:str|None=None,error:str|None=None,error_description:str|None=None):
    if error: return HTMLResponse(f'<h2>TikTok authorization failed</h2><p>{error}: {error_description or ""}</p>',status_code=400)
    if not code or not state: return HTMLResponse('<h2>Missing TikTok authorization code/state</h2>',status_code=400)
    with db() as c:
        row=c.execute("SELECT * FROM oauth_states WHERE state=? AND provider='tiktok'",(state,)).fetchone()
        if row: c.execute('DELETE FROM oauth_states WHERE state=?',(state,))
    if not row or row['expires_at'] < now_iso(): return HTMLResponse('<h2>Invalid or expired OAuth state</h2>',status_code=400)
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            r=await client.post('https://open.tiktokapis.com/v2/oauth/token/',headers={'Content-Type':'application/x-www-form-urlencoded'},data={'client_key':tiktok_client_key(),'client_secret':tiktok_client_secret(),'code':code,'grant_type':'authorization_code','redirect_uri':TIKTOK_REDIRECT_URI})
            r.raise_for_status(); d=r.json()
        if not d.get('access_token'): raise RuntimeError(str(d))
        set_secret('tiktok_access_token',d['access_token'])
        set_secret('tiktok_refresh_token',d.get('refresh_token') or '')
        set_secret('tiktok_access_expires_at',(datetime.now(timezone.utc)+timedelta(seconds=int(d.get('expires_in') or 86400))).isoformat())
        sync=await sync_tiktok_owned()
        return HTMLResponse('<meta charset="utf-8"><div style="font-family:system-ui;padding:40px"><h2>✅ TikTok connected</h2><p>Authorization สำเร็จและ sync แล้ว</p><pre>'+json.dumps(sync,ensure_ascii=False,indent=2)+'</pre><p><a href="/">กลับ Dashboard</a></p></div>')
    except Exception as e:
        return HTMLResponse('<h2>TikTok token exchange failed</h2><pre>'+str(e)+'</pre>',status_code=500)

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
    return {'ok':True,'providers':await provider_sync()}

@app.post('/api/import/csv')
async def import_csv(file:UploadFile=File(...),_=Depends(admin)):
    raw=(await file.read()).decode('utf-8-sig'); rows=[]
    for i,r in enumerate(csv.DictReader(io.StringIO(raw))):
        pid=r.get('platform_video_id') or r.get('video_id') or f'csv-{int(time.time())}-{i}'
        rows.append({'platform_video_id':pid,'url':r.get('url') or f'https://www.tiktok.com/video/{pid}','creator':{'username':r.get('creator_username') or r.get('username') or 'csv_import'},'caption':r.get('caption') or '','transcript':r.get('transcript') or '','search_keyword':r.get('search_keyword') or 'CSV Import','view_count':int(float(r.get('view_count') or 0)),'like_count':int(float(r.get('like_count') or 0)),'comment_count':int(float(r.get('comment_count') or 0)),'share_count':int(float(r.get('share_count') or 0)),'published_at':r.get('published_at') or None,'comments':[]})
    return ingest({'source':'csv','videos':rows},None)

@app.post('/api/pipeline/run')
async def pipeline(_=Depends(admin)):
    p=await provider_sync(); a=await analyze_pending(); d=generate_insight(); return {'ok':True,'providers':p,'analysis':a,'daily':d}

@app.get('/api/dashboard')
def dashboard(_=Depends(admin)):
    with db() as c:
        feed=[dict(x) for x in c.execute('''SELECT v.*,a.topic,a.sentiment,a.sentiment_score,a.purchase_intent,a.opportunity,a.opportunity_score,a.risk_level,a.summary FROM videos v LEFT JOIN analyses a ON a.video_id=v.id ORDER BY v.collected_at DESC LIMIT 300''').fetchall()]
        di=c.execute('SELECT payload FROM daily_insights ORDER BY day DESC LIMIT 1').fetchone()
        kws=[dict(x) for x in c.execute('SELECT * FROM keywords WHERE enabled=1 ORDER BY category,keyword').fetchall()]
    views=sum(int(x.get('view_count') or 0) for x in feed[:100]); eng=sum(int(x.get('like_count') or 0)+int(x.get('comment_count') or 0)+int(x.get('share_count') or 0) for x in feed[:100])
    insight=json.loads(di['payload']) if di else {'rising_topics':[],'consumer_questions':[],'pain_points':[],'content_ideas':[],'risks':[]}
    return {'generatedAt':now_iso(),'summary':{'videos':len(feed),'views':views,'engagement_rate':round(eng/max(views,1)*100,2),'high_risk':sum(1 for x in feed if x.get('risk_level') in ('high','critical'))},'providers':provider_status(),'keywords':kws,'insight':insight,'feed':feed}

def scheduler():
    last_daily=''; last_provider=0.0; last_probe=0.0
    while True:
        try:
            n=datetime.now(TZ); day=n.date().isoformat(); ts=time.time()
            if ts-last_provider >= max(PROVIDER_SYNC_MINUTES,10)*60:
                import asyncio; asyncio.run(provider_sync()); last_provider=ts
            if ts-last_probe >= 21600:
                import asyncio; asyncio.run(probe_tiktok_oembed()); last_probe=ts
            if n.hour==RUN_HOUR and last_daily!=day:
                import asyncio; asyncio.run(analyze_pending(500)); generate_insight(); last_daily=day
        except Exception as e: print('scheduler',e,flush=True)
        time.sleep(30)

HTML='''<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pawdy Social Intelligence</title><style>body{font-family:system-ui;margin:0;background:#f4f7f2;color:#172012}header{background:#193c1b;color:white;padding:20px 5vw}main{padding:24px 5vw}.row{display:flex;gap:12px;flex-wrap:wrap}.card{background:white;border-radius:16px;padding:18px;box-shadow:0 2px 12px #0001;flex:1;min-width:220px;margin-bottom:16px}.big{font-size:32px;font-weight:800}.tag{background:#e9f4df;border-radius:999px;padding:6px 10px;display:inline-block;margin:3px}button,input{padding:10px 12px;border-radius:10px;border:1px solid #ccd6c6}button{background:#98ca40;border:0;font-weight:700;cursor:pointer}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:9px;border-bottom:1px solid #eee;font-size:14px}.muted{color:#667}</style><header><h1>Pawdy Social Intelligence</h1><div>TikTok Listening → AI Analysis → Daily Content Insight</div></header><main><div class="row"><input id="t" type="password" placeholder="Admin token"><button onclick="connect()">Connect</button><button onclick="run()">Run Pipeline</button><button onclick="syncProviders()">Sync Providers</button></div><div class="card" style="margin-top:16px"><h3>🔐 Secure Connections</h3><div class="row"><input id="openaiKey" type="password" placeholder="OpenAI API key"><input id="mwToken" type="password" placeholder="Meltwater API token"><input id="mwSearch" placeholder="Meltwater Search ID"></div><div class="row" style="margin-top:8px"><input id="ttKey" type="password" placeholder="TikTok Client Key"><input id="ttSecret" type="password" placeholder="TikTok Client Secret"><button onclick="saveSecrets()">Save & Test</button><button onclick="connectTikTok()">Connect TikTok</button></div><div id="settingsStatus" class="muted" style="margin-top:10px"></div></div><div class="card" style="margin-top:16px"><h3>Listening Workspace</h3><div class="row"><input id="newkw" placeholder="เพิ่ม keyword เช่น หมาแก่กินน้อย"><button onclick="addKeyword()">Add Keyword</button><button onclick="probe()">Test TikTok Connection</button></div><div id="keywords" style="margin:12px 0"></div><select id="kwselect" style="padding:10px;border-radius:10px;border:1px solid #ccd6c6"></select><textarea id="urls" style="width:100%;min-height:90px;margin-top:8px" placeholder="วาง TikTok URL ทีละบรรทัด แล้วเลือก keyword ด้านบน"></textarea><br><button onclick="importUrls()">Import + Analyze</button><div id="providerStatus" class="muted" style="margin-top:10px"></div></div><div id="app" style="margin-top:20px"></div></main><script>let token=localStorage.pawdyToken||'';document.getElementById('t').value=token;async function api(path,opt={}){opt.headers=Object.assign({'Authorization':'Bearer '+token},opt.headers||{});let r=await fetch(path,opt);if(!r.ok)throw new Error(await r.text());return r.json()}function connect(){token=document.getElementById('t').value.trim();localStorage.pawdyToken=token;load()}async function run(){await api('/api/pipeline/run',{method:'POST'});load()}async function syncProviders(){await api('/api/providers/sync',{method:'POST'});await loadStatus();load()}async function importUrls(){let urls=document.getElementById('urls').value.split(/\n+/).map(x=>x.trim()).filter(Boolean);let r=await api('/api/tiktok/import_urls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({urls})});alert('Imported '+r.ingested+' URLs');await run()}async function loadStatus(){try{let p=await api('/api/providers/status');document.getElementById('providerStatus').textContent='Provider status: '+Object.entries(p).map(([k,v])=>k+'='+(v.configured?'ready':'not connected')).join(' • ')}catch(e){}}async function loadSettings(){try{let x=await api('/api/settings/status');document.getElementById('settingsStatus').textContent='OpenAI='+(x.openai?'connected':'not connected')+' • Meltwater='+(x.meltwater_token&&x.meltwater_search_id?'connected':'not connected')+' • TikTok='+(x.tiktok_connected?'connected':(x.tiktok_client_key&&x.tiktok_client_secret?'ready to authorize':'needs app credentials'))+' • Redirect URI: '+x.tiktok_redirect_uri}catch(e){}}async function saveSecrets(){let body={openai_api_key:document.getElementById('openaiKey').value,meltwater_api_token:document.getElementById('mwToken').value,meltwater_search_id:document.getElementById('mwSearch').value,tiktok_client_key:document.getElementById('ttKey').value,tiktok_client_secret:document.getElementById('ttSecret').value};await api('/api/settings/secrets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});let t=await api('/api/settings/test',{method:'POST'});alert('OpenAI: '+(t.openai.ok?'OK':'FAILED')+' • Meltwater: '+(t.meltwater.ok?'OK':'FAILED'));['openaiKey','mwToken','ttKey','ttSecret'].forEach(id=>document.getElementById(id).value='');loadSettings();loadStatus()}async function connectTikTok(){let r=await api('/api/tiktok/oauth/url');location.href=r.url}function fmt(n){return new Intl.NumberFormat().format(n||0)}async function load(){try{let d=await api('/api/dashboard');let s=d.summary,i=d.insight;document.getElementById('app').innerHTML=`<div class=row><div class=card><div class=muted>Videos</div><div class=big>${fmt(s.videos)}</div></div><div class=card><div class=muted>Views</div><div class=big>${fmt(s.views)}</div></div><div class=card><div class=muted>Engagement</div><div class=big>${s.engagement_rate}%</div></div><div class=card><div class=muted>High Risk</div><div class=big>${s.high_risk}</div></div></div><div class=card><h2>🔥 Rising Topics</h2>${(i.rising_topics||[]).map(x=>`<span class=tag>${x.topic} ${x.growth_pct>=0?'+':''}${x.growth_pct}% · ${x.opportunity_score}/100</span>`).join('')||'ยังไม่มีข้อมูล'}</div><div class=row><div class=card><h2>💬 Questions</h2>${(i.consumer_questions||[]).map(x=>`<div>• ${Array.isArray(x)?x[0]:x}</div>`).join('')||'ยังไม่มีข้อมูล'}</div><div class=card><h2>💡 Content Ideas</h2>${(i.content_ideas||[]).map(x=>`<div><b>${x.score}</b> · ${x.idea}</div>`).join('')||'ยังไม่มีข้อมูล'}</div></div><div class=card><h2>Latest Feed</h2><table><thead><tr><th>Creator</th><th>Caption</th><th>Topic</th><th>Views</th><th>Score</th><th>Risk</th></tr></thead><tbody>${(d.feed||[]).slice(0,50).map(x=>`<tr><td>${x.creator||''}</td><td><a href="${x.url}" target=_blank>${(x.caption||'').slice(0,80)}</a></td><td>${x.topic||'-'}</td><td>${fmt(x.view_count)}</td><td>${x.opportunity_score||'-'}</td><td>${x.risk_level||'-'}</td></tr>`).join('')}</tbody></table></div>`}catch(e){document.getElementById('app').innerHTML='<div class=card>เชื่อมต่อไม่สำเร็จ: '+e.message+'</div>'}}if(token){loadStatus();loadSettings();loadKeywords();load()}</script></html>'''

@app.get('/',response_class=HTMLResponse)
def root(): return HTML

if __name__=='__main__':
    init_db(); uvicorn.run(app,host='0.0.0.0',port=int(os.getenv('PORT','8000')))
