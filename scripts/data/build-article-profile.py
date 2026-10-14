# Сборка профиля артикулов по Word-ТЗ + расценок/расхода из «Расчёт стоимости пошива ММ FW26» + мех/длина из АРТИКУЛА.xlsx.
# python3 -I scripts/data/build-article-profile.py  (пути к извлечённым вложениям — константы ниже)
import json,re,collections,glob,openpyxl
S='/private/tmp/claude-501/-Users-petr-Documents-claude/d078d416-b2d7-4795-b3e7-4401793187b6/scratchpad'
C2L=dict(zip("АВЕКМНОРСТХавекмнорстх","ABEKMHOPCTXabekmhopctx"))
nc=lambda s:''.join(C2L.get(c,c) for c in s).upper().replace('-','').replace(' ','')
rows=json.load(open(S+'/prof/rows.json'))
rows.append({'tz':'27','model':'М017','name':'Жакет женский из норки','color':'белый','size':'46','lin':'Шелк 93%, эластан 7%','mat':'норка отбеленная','work':'221 790.00','hides':''})
ok=[]
for r in rows:
    m=nc(r['model']).replace('O','0') if r['model'] else ''
    if re.match(r'^M[A-Z]{0,2}\d{2,3}[A-Z]?$',m): r['code']=m; ok.append(r)
def num(s):
    s=re.sub(r'\s','',s).replace(',','.')
    m=re.match(r'^(\d+(?:\.\d+)?)',s)
    return round(float(m.group(1))) if m else None
KINDS=[('Соболь',['соболь','соболя','соболе','соболи','sable']),('Норка',['норк','mink']),('Каракуль (свакара)',['каракул','свакар','swakara']),('Каракуль (брутейл)',['брутейл','broadtail']),('Лиса',['лис','fox']),('Бобр',['бобр']),('Рысь',['рысь','рыси','lynx'])]
def kinds(t):
    t=t.lower();return [k for k,w in KINDS if any(x in t for x in w)]
prof={}
byc=collections.defaultdict(list)
for r in ok: byc[r['code']].append(r)
def tzkey(x): return int(x) if x and x.isdigit() else 0
for c,rs in byc.items():
    seen=set();u=[]
    for r in rs:
        k=(r['tz'],r['name'],r['color'],r['size'],r['lin'],r['mat'],r['work'],r['hides'])
        if k not in seen: seen.add(k);u.append(r)
    names=collections.defaultdict(set);colors=collections.defaultdict(set);sizes=set();lin=collections.defaultdict(lambda:[set(),''])
    fur=collections.Counter();work=[];hides=[];tzs=set()
    for r in u:
        tz=r['tz'];tzs.add(tz)
        n=re.sub(r'\s*\(',' (',r['name']).strip()
        if n: names[n[0].upper()+n[1:]].add(tz)
        for cl in re.split(r'[,/;]',r['color']):
            cl=cl.strip().lower()
            if cl and cl not in('-','нет'): colors[cl[0].upper()+cl[1:]].add(tz)
        for sz in ([r['size'].strip()] if '*' in r['size'] else re.split(r'[\s,;]+',r['size'])):
            if not sz or sz in('-',): continue
            if re.match(r'^(ед|ns\b|one)',sz,re.I) or sz.lower() in('единый','размер'): sz='Единый размер'
            sizes.add(sz)
        l=re.sub(r'\s+',' ',r['lin']).strip()
        l=re.sub(r'\s+%','%',l); l=re.sub(r'([а-яёa-z])(\d)',r'\1 \2',l); l=re.sub(r'(%)([А-Яа-яA-Za-z])',r'\1 \2',l)
        l=re.sub(r'\s*(арт\.?|артикул)?\s*№?\s*\(?(LC\s?\d+|№\s?\d+)\)?(\s*\(№?\d+\))?','',l)
        l=re.sub(r'\s*(Colombo|Paicenza)\s*[\d ]*(DIS\.\d+)?\s*(Beige|Black)?','',l)
        l=re.sub(r'\s*№\s*\d*$','',l); l=re.sub(r'\s*\((?=[^)]*$)','',l) if l.count('(')>l.count(')') else l
        l=l.rstrip(') ').strip() if l.count(')')>l.count('(') else l.strip()
        if l and l.lower() not in('нет','-','—'):
            key=re.sub(r'[^0-9a-zа-я%]','',l.lower())
            lin[key][0].add(tz); lin[key][1]=lin[key][1] or l
        for kd in set(kinds(r['mat'])): fur[kd]+=1
        w=num(r['work']); 
        if w and w>1000 or (w and c.startswith('MG')): work.append([w,tz])
        h=num(r['hides'])
        if h: hides.append([h,tz])
    srt=lambda d:[[k,len(v)] for k,v in sorted(d.items(),key=lambda x:(-len(x[1]),x[0]))]
    def sk(s):
        return (0,int(s)) if s.isdigit() else (1,s)
    prof[c]={'names':srt(names),'colors':srt(colors),'sizes':sorted(sizes,key=sk),'linings':[[v[1],len(v[0])] for k,v in sorted(lin.items(),key=lambda x:-len(x[1][0]))],
      'furs':[k for k,_ in fur.most_common()],'tz':sorted({int(t) for t in tzs if t and t.isdigit()}),'work':work,'hides':hides}
# FW26 «шубы»
wb=openpyxl.load_workbook((glob.glob(S+'/m_all/194__*')+glob.glob(S+'/m_research/194__*'))[0],data_only=True);ws=wb['шубы']
sheet=collections.defaultdict(lambda:{'work':set(),'hides':set()})
for row in ws.iter_rows(values_only=True):
    if row[1] and isinstance(row[0],(int,float)):
        c=nc(str(row[1])).replace('O','0')
        h=row[5]; w=row[9]
        if isinstance(w,(int,float)): sheet[c]['work'].add(round(w))
        if isinstance(h,(int,float)): sheet[c]['hides'].add(round(h,3))
for c,v in sheet.items():
    p=prof.setdefault(c,{'names':[],'colors':[],'sizes':[],'linings':[],'furs':[],'tz':[],'work':[],'hides':[]})
    p['sheet_work']=sorted(v['work']);p['sheet_hides']=sorted(v['hides'])
# АРТИКУЛА.xlsx
ws=openpyxl.load_workbook('/Users/petr/Downloads/АРТИКУЛА.xlsx',data_only=True).active
lens=collections.defaultdict(set);ff=collections.defaultdict(collections.Counter)
for row in list(ws.iter_rows(values_only=True))[1:]:
    if not row[0]: continue
    c=nc(str(row[0]));lens[c].add(str(row[1]).strip())
    for kd in kinds(str(row[3] or '')): ff[c][kd]+=1
for c in set(lens)|set(prof):
    p=prof.setdefault(c,{'names':[],'colors':[],'sizes':[],'linings':[],'furs':[],'tz':[],'work':[],'hides':[]})
    p['file_len']=sorted(lens.get(c,[]));p['file_furs']=[k for k,_ in ff[c].most_common()]
json.dump(prof,open('scripts/data/article-profile-src.json','w'),ensure_ascii=False,indent=1)
pub={c:{k:p[k] for k in('names','colors','sizes','linings','furs','tz')} for c,p in prof.items() if p['tz']}
json.dump(pub,open('src/lib/data/article-tz-profile.json','w'),ensure_ascii=False,separators=(',',':'))
print(len(prof),len(pub))
