#!/usr/bin/env python3
"""Полная сверка приложения с реестром и документами (только чтение БД через JSON-выгрузки).
Вход (SCRATCH): db_orders.json, db_batches.json, db_purch.json, db_pay.json, db_ppay.json, db_orders2.json, models.json,
  reg.pkl (листы реестра), scripts/crosscheck-data/*.json.  Выход: docs-inventory/full-crosscheck.{json,md},
  crosscheck-pending.json, crosscheck-fixes-plan.json (читает apply-crosscheck-fixes.ts).
Запуск: SCRATCH=<папка> python3 scripts/build-crosscheck.py
"""
import json,re,os,pickle,collections,datetime
S=os.environ['SCRATCH']; R=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); INV=R+'/docs-inventory'
L=lambda n: json.load(open(S+'/'+n+'.json'))
orders=L('db_orders'); batches=L('db_batches'); purch=L('db_purch'); pay=L('db_pay'); ppay=L('db_ppay'); usages={x['number']:x['usages'] for x in L('db_orders2')}; models=L('models')
regpos=json.load(open(R+'/scripts/crosscheck-data/registry-tz-positions.json')); wo=json.load(open(R+'/scripts/crosscheck-data/drive-tz-appendices.json'))
reg=pickle.load(open(S+'/reg.pkl','rb'))
cov=json.load(open(INV+'/coverage-matrix.json'))
CY=str.maketrans('АВЕКМНОРСТХаеорсх','ABEKMHOPCTXaeopcx')
def nm(s): return re.sub(r'[^A-Z0-9]','',(s or '').translate(CY).upper()).replace('O','0')
def sizes(s):
    if s is None: return None
    if isinstance(s,list): s=' '.join(map(str,s))
    s=str(s)
    if re.search(r'един|ns|\*',s,re.I): return ('single',)
    s=re.sub(r'\(.*?\)','',s); out=[]
    for m in re.finditer(r'(\d+)(?:\s*[x×]\s*(\d+))?',s): out+=[m.group(1)]*(int(m.group(2)) if m.group(2) else 1)
    return tuple(sorted(out))
def fnum(x):
    if isinstance(x,dict): return x.get('vat22') or x.get('vat20')
    if isinstance(x,str):
        try: return float(x.replace(' ','').replace(',','.'))
        except: return None
    return x
ROWS=[]; PEND=[]; FIX=[]
def row(entity,id,status,fields=None,note=''): ROWS.append(dict(entity=entity,id=id,status=status,fields=fields or [],note=note))
def pend(entity,id,field,db,registry,doc,candidate,note): PEND.append(dict(entity=entity,id=id,field=field,db=db,registry=registry,doc=doc,candidate=candidate,note=note))

# ---------- доказательства поставки по партиям
EV={}
for b in range(1,10): EV[b]=('balance','баланс 040226.xlsx: «отгрузка» партии %d (сумма отгрузки = работа всех ТЗ партии + шкуры)'%b)
EV[10]=('letter','письмо 18–19.02.2026 «расчёт доплаты по партии 10 (26 ед) + счёт №41», согласовано'); EV[11]=('letter','письмо 24.02–02.03.2026 «поставка 11 – 14 ед – 347 895», подтверждено 27.02.2026')
EV[12]=('letter','письмо 14–20.04.2026: «изделия отгружены в начале марта 2026» (партия 12 остаток 1 ед)'); EV[13]=('letter','письмо 14–20.04.2026: «изделия отгружены в начале марта 2026» (партия 13, 20 ед)')
EV[14]=('direct','письмо «Партия 14» 03.07.2026: поставка 06.07.2026'); EV[19]=('direct','письмо «Партия 19 (41 изделие)» 18.09.2026: поставка принята 17.09.2026')
EV[20]=('direct','письмо «Партия 20 (68 изделий)» 25.09.2026: поставка принята 25.09.2026')
EV[17]=('indirect','письмо 12.08.2026: «срочная поставка 03.07.2026 для съёмки»; акта нет'); EV[18]=('indirect','письмо 01.09.2026: «поставка 02.09.2026» (план на завтра); акта приёмки нет')
# ---------- ТЗ
R_=collections.defaultdict(list)
for p in regpos: R_[(p['tz'],nm(p['model']))].append(p)
W_=collections.defaultdict(list)
for w in wo:
    if w.get('tzNumber') is not None: W_[(int(w['tzNumber']),nm(w['model']))].append(w)
bysz=lambda s: re.sub(r'\s+',' ',str(s or '').replace(',',' ')).strip()
orders_by_batch=collections.defaultdict(list)
SIZEFIX=[]
for o in orders:
    num_=o['number']; tz=int(o['tz']); k=(tz,nm(o['model'])); f=[]; notes=[]
    rs=R_.get(k) or ([p for p in regpos if p['tz']==116] if tz==116 else [])
    ws=W_.get(k) or []
    sibs=[x for x in orders if (int(x['tz']),nm(x['model']))==k]
    st='match'
    if not rs and tz<=151: st='only_db'; notes.append('ТЗ нет в реестре (≤151)')
    elif not rs: st='only_db'; notes.append('ТЗ %d создано по документам Drive после даты реестра (реестр заканчивается ТЗ 151)'%tz)
    elif len(sibs)==1:
        r=rs[0]; rq=sum(p['qty'] or 0 for p in rs)
        if abs(rq-o['planned'])>.001: f.append(dict(field='plannedQuantity',db=o['planned'],registry=rq,doc=[w['quantity'] for w in ws] or None,source='Реестр (единый) стр.%s'%r['row']))
        rw=sum(p['wtot'] or 0 for p in rs); dw=o['planned']*(o['wprice'] or 0)
        if abs(rw-dw)>1.01: f.append(dict(field='workTotal',db=round(dw,2),registry=rw,doc=[fnum(w.get('workPricePerUnit')) for w in ws if w.get('workPricePerUnit')] or None,source='Реестр (единый) стр.%s'%r['row']))
        if r['batch'] not in (None,'') and str(int(r['batch']))!=str(o['batch']): f.append(dict(field='batch',db=o['batch'],registry=r['batch'],doc=None,source='Реестр (единый)'))
        if sizes(r['size']) and sizes(r['size'])!=sizes(o['size']) and sizes(o['size'])!=('single',) and tz!=116: f.append(dict(field='size',db=o['size'],registry=r['size'],doc=[w.get('sizes') for w in ws] or None,source='Реестр (единый) стр.%s'%r['row']))
    # документы (приложения ТЗ / расчёты доплат)
    dstat='no_doc'
    if ws and len(sibs)==1:
        dstat='ok'; dd=[]
        if not any(abs((fnum(w['quantity']) or 0)-o['planned'])<.001 for w in ws): dd.append('qty'); f.append(dict(field='plannedQuantity(doc)',db=o['planned'],registry=None,doc=[w['quantity'] for w in ws],source=ws[0]['_file']))
        osz=sizes(o['size']); dsz=[sizes(w.get('sizes')) for w in ws if w.get('sizes') is not None]
        if dsz and osz not in dsz and osz!=('single',):
            dd.append('size')
            good=[d for d in dsz if d and d!=('single',) and len(d)==round(o['planned'])]
            # размер в БД хранит уникальные значения, документ — полный список: однозначная правка
            if good and set(good[0])==set(osz or ()) :
                txt=[w for w in ws if sizes(w.get('sizes'))==good[0]][0]
                norm=','.join(good[0][::-1]) if False else None
                SIZEFIX.append((o,good[0],txt))
            else: f.append(dict(field='size(doc)',db=o['size'],registry=None,doc=[w.get('sizes') for w in ws],source=ws[0]['_file']))
        wp=[fnum(w.get('workPricePerUnit')) for w in ws if fnum(w.get('workPricePerUnit'))]
        if wp and not any(abs(x-(o['wprice'] or 0))<1.01 for x in wp): dd.append('wprice'); f.append(dict(field='workPricePerUnit(doc)',db=o['wprice'],registry=None,doc=wp,source=ws[0]['_file']))
        if dd: dstat='diff'
    # выпуск / статус
    b=o['batch']; ev=EV.get(b)
    prodnote=None
    if o['status']=='COMPLETED' and o['produced']==0: f.append(dict(field='producedQuantity',db=0,registry=None,doc=None,source='COMPLETED при выпуске 0 — ошибка данных')); st='diff'
    if o['status']!='COMPLETED' and o['produced']==0:
        src=None
        if b and ev and ev[0] in('balance','letter','direct') and tz<=151 or (b==20 and ev):
            src=ev[1]+('; ТЗ №%d есть в «Реестре произведённых артикулов» (≤151)'%tz if tz<=151 else '')
        if src:
            FIX.append(dict(kind='produced',order=num_,planned=o['planned'],value=o['planned'],basis=src))
            pend('ProductionOrder',num_,'status',o['status'],None,src,'COMPLETED','Выпуск проставлен скриптом (producedQuantity=план). Статус не меняли: «Завершить» на карточке ТЗ оприходует изделия на склад и снимает себестоимость%s.'%('' if usages.get(num_) else ' (у ТЗ нет списаний сырья — приложение не даст завершить; решение владельца)'))
            f.append(dict(field='producedQuantity',db=0,registry=o['planned'] if tz<=151 else None,doc=o['planned'],source=src)); st='diff'
        else:
            why='партия 21: приёмка поставки в документах не найдена (расчёт 23.09, счёт №275 от 01.10.2026)' if b==21 else 'ТЗ 116 «Ремонт пальто»: только строка реестра (7 ед.), ни даты, ни партии, ни документа приёмки'
            pend('ProductionOrder',num_,'producedQuantity',0,o['planned'] if tz<=151 else None,None,o['planned'],'Ждёт ручного ввода: '+why+'. Подсказка: при подтверждении факта ввести %s шт. (кнопка «Завершить» / поле «Фактически произведено»).'%int(o['planned']))
            f.append(dict(field='producedQuantity',db=0,registry=None,doc=None,source='ждёт ручного ввода: '+why)); st='diff'
    if ev and ev[0]=='indirect' and o['status']=='COMPLETED': pass
    if f and st=='match': st='diff'
    row('ProductionOrder',num_+' (ТЗ %d, %s)'%(tz,o['model']),st if st!='match' else ('match' if dstat in('ok','no_doc') else 'diff'),f,'; '.join(notes))
    orders_by_batch[b].append(o)
# размеры: правка по документам (полный список вместо уникальных)
for (o,tup,w) in SIZEFIX:
    new=','.join(sorted(tup,key=lambda x:int(x)))
    FIX.append(dict(kind='size',order=o['number'],old=o['size'],value=new,basis='расчёт/приложение «%s»: размеры %s (в БД записан список без повторов; кол-во %s = число размеров)'%(w['_file'],w.get('sizes'),int(o['planned']))))
    for r in ROWS:
        if r['id'].startswith(o['number']): r['status']='diff'; r['fields'].append(dict(field='size',db=o['size'],registry=None,doc=w.get('sizes'),source=w['_file']))
# ТЗ 110
for r in ROWS:
    if r['id'].startswith('П-2026-0116'): r['note']='Реестр: 3 ед. (при той же сумме 217 350), БД и документы (расчёт партии 12, письмо «партия 12 остаток – 1 ед»): 1 ед. — БД верна'
# ---------- партии
for b in batches:
    n=b['number']; f=[]; st='match'; ev=EV.get(n)
    if b['n']==0: st='only_db'; pend('ProductionBatch',n,'orders',0,None,None,None,'Пустая партия: ни в реестре (колонка «партия»), ни в Drive (папок «поставка 15/16» нет), ни в письмах. НЕ удалена — ждёт решения владельца (вероятно, зарезервированный номер).')
    else:
        if b['planned']!=b['pl']: f.append(dict(field='plannedUnits',db=b['planned'],registry=b['pl'],doc=None,source='Σ ТЗ'))
        rq=sum(p['qty'] or 0 for p in regpos if p['batch'] not in(None,'') and int(p['batch'])==n)
        if rq and abs(rq-b['pl'])>.001: f.append(dict(field='изделий',db=b['pl'],registry=rq,doc=None,source='Реестр (единый)'))
        if n==21: pend('ProductionBatch',n,'delivery',None,None,None,None,'Приёмка поставки 21 (14 изд.) не подтверждена: есть расчёт 23.09.2026 и счёт №275 от 01.10.2026')
        if ev and ev[0]=='indirect': pend('ProductionBatch',n,'status/delivery','ТЗ COMPLETED',None,ev[1],None,'Статус COMPLETED у ТЗ партии держится на реестре; акта приёмки нет — подтвердить поставку')
        if n==8: f.append(dict(field='производство',db='3 ТЗ MGL IN_PROGRESS, выпуск 0',registry=24,doc='баланс 040226',source='ТЗ 88'))
        if n in(7,10,11,20,8): f.append(dict(field='producedQuantity',db=b['produced'],registry=None,doc=b['pl'],source=(ev or ('',''))[1]))
        if f: st='diff'
    row('ProductionBatch','Партия %d'%n,st,f,b['name'] or '')
# ---------- закупки
for p in purch:
    k=p['number']; c=cov['purchases'].get(k); f=[]; st='match'; notes=[]
    if not c: st='only_db'; notes.append('нет в coverage-matrix')
    else:
        if not c['registry']['found']: st='only_db'; notes.append('нет в реестрах (остатки/закупка F25/FW26/отчёт)')
        if c.get('missing'): notes.append('; '.join(c['missing']))
    if p['status']=='RECEIVED' and not p['upd']: f.append(dict(field='status',db='RECEIVED',registry=None,doc=None,source='нет УПД/документа поставки')); st='diff'; pend('Purchase',k,'status','RECEIVED',None,None,'DRAFT?' ,'Принята без УПД и документа: подтвердить поставку (%s)'%('; '.join(c['missing'][:3]) if c else ''))
    if p['status']=='DRAFT' and p['upd']: f.append(dict(field='status',db='DRAFT',registry=None,doc=p['upd'],source='есть УПД')); st='diff'; pend('Purchase',k,'status','DRAFT',None,p['upd'],'RECEIVED','Есть УПД, но стоит черновик')
    if k=='З-2026-0058': f.append(dict(field='qty/amount',db='371 шт / 3 581 815,79 (УПД №253)',registry='376 шт / 3 320 504,56 (предв. расчёт)',doc='УПД №253',source='отчёт 08.06.2026, закупка FW26')); st='diff'; pend('Purchase',k,'quantity/amount','371 шт / 3 581 815,79','376 шт / 3 320 504,56','УПД №253','оставить по УПД','Отчёт — предварительный расчёт; БД по УПД. Подтвердить.')
    if k in('З-2026-0010','З-2026-0011','З-2026-0012','З-2026-0013'): pend('Purchase',k,'document','нет УПД',None,None,None,'«Доп закупка сырья партия N»: документов нет, возможный двойной учёт шкур подрядчика (уже в доплатах партий 5/6/7/9)')
    if p['status']=='DRAFT' and not p['upd']: notes.append('DRAFT соответствует документам (УПД/поставки нет)')
    row('Purchase',k+' ('+(p['ses'] or '')+', сч. '+str(p['inv'] or '')+')',st,f,'; '.join(notes))
for e in cov['registryOnly']:
    if e['kind']!='purchase': continue
    row('Purchase',e['title'][:80],'only_registry',[dict(field='all',db=None,registry=e.get('amount'),doc=None,source=e['registry']['sheet'])],'; '.join(e.get('missing',[])))
    if e['kind']=='purchase': pend('Purchase','Бобр Invoice 1-2026 (З-2026-0063)','document',None,'587 шт / 4 490 090',None,None,'В БД есть черновик З-2026-0063; нет инвойса, спецификации, УПД, платёжки (beaver-findings.md)')
# ---------- платежи поставщику
TT=[]
for r in reg['TTL сырье'][15:31]:
    m=re.search(r'(\d+)\s+от\s+(\d\d)-(\d\d)-(\d{4})',str(r[3]))
    if m: TT.append((m.group(1),'%s-%s-%s'%(m.group(4),m.group(3),m.group(2)),round(float(r[2]),2)))
TT.append(('54214','2025-07-03',1455842.0))
dbp=collections.defaultdict(list)
for p in pay: dbp[p['paid']].append(p)
matched=set()
for (pp,dt,amt) in TT:
    c=dbp.get(dt,[]); s=round(sum(x['amount'] for x in c),2)
    one=[x for x in c if abs(x['amount']-amt)<1.01]
    if one: matched.add(one[0]['id']); row('Payment','п/п %s %s %s'%(pp,dt,amt),'match',[],'докRef: '+str(one[0]['docRef'])[:60]); continue
    if c and abs(s-amt)<1.01: [matched.add(x['id']) for x in c]; row('Payment','п/п %s %s %s'%(pp,dt,amt),'match',[],'реестр одна платёжка = %d записи БД'%len(c)); continue
    pair=[(a,b) for i,a in enumerate(c) for b in c[i+1:] if abs(a['amount']+b['amount']-amt)<1.01]
    if pair: matched.update([pair[0][0]['id'],pair[0][1]['id']]); row('Payment','п/п %s %s %s'%(pp,dt,amt),'match',[],'реестр одна платёжка = 2 записи БД (разнесение РП/СП)'); continue
    cand=[x for x in pay if abs(x['amount']-amt)<1.01]
    if cand:
        matched.add(cand[0]['id']); row('Payment','п/п %s %s %s'%(pp,dt,amt),'diff',[dict(field='paidAt',db=cand[0]['paid'],registry=dt,doc=cand[0]['docRef'],source='TTL сырье')],'сумма совпала, дата другая')
        pend('Payment','п/п %s'%pp,'paidAt',cand[0]['paid'],dt,cand[0]['docRef'],dt,'В реестре п/п 56327 от 15.07.2025, в БД 27.06.2025 (УПД №96 называет п/п 53423). Источники расходятся — не меняли.')
    else: row('Payment','п/п %s %s %s'%(pp,dt,amt),'only_registry',[dict(field='all',db=None,registry=amt,doc=None,source='TTL сырье')],'нет в БД')
for p in pay:
    if p['id'] in matched: continue
    st='only_db'; note='нет в реестре (платёж после даты реестра/вне 2025)' if p['paid']>='2025-09' else 'нет в реестре'
    row('Payment','%s %s %s'%(p['paid'],p['amount'],(p['docRef'] or '')[:40]),st,[],note+('; confirmed=false (платёжки нет)' if not p['confirmed'] else ''))
    if not p['confirmed']: pend('Payment',p['paid']+' '+str(p['amount']),'confirmed',False,None,p['docRef'],None,'Упомянуто в документах, платёжки/п/п нет — приложить банковскую выписку')
dups=collections.Counter((p['paid'],p['amount']) for p in pay); [pend('Payment',str(k),'duplicate',None,None,None,None,'Возможный дубль') for k,v in dups.items() if v>1]
pend('Payment','п/п 33979/33980 14.03.2025','docRef','п/п 33980 (24 556 500) и «№33979 по УПД №78» (79 898 902)','33979 → 24 556 500; 33980 → 79 898 902',None,None,'Номера двух платёжек от 14.03.2025 в реестре и УПД расходятся; суммы и даты совпали — подтвердить по выписке')
# ---------- платежи производства
rp=[('60610','2025-08-04',21627900.0)]
for r_ in ppay:
    ok=r_['paid']=='2025-08-04' and sum(x['amount'] for x in ppay if x['paid']=='2025-08-04')>=21627900-1
    row('ProductionPayment','%s %s %s'%(r_['paid'],r_['amount'],r_['docRef']),'match' if ok else 'only_db',[],'аванс 21 627 900 в реестре разнесён по партиям (сумма совпала)' if ok else 'нет в реестре (реестр без оплат заказчика после 08.2025); подтверждено счетами/балансом 040226/письмами')
row('ProductionPayment','п/п 60610 04.08.2025 21 627 900 (реестр)','match',[],'Σ частей в БД = 21 627 900')
pend('ProductionPayment','партии 8–14, 17–21','missing',None,None,'нет платёжек',None,'Оплат производства по партиям 8–14, 17–21 нет в БД и в реестре; нужны платёжки/письма «оплачено» (OWNER-TODO п.1)')
# ---------- модели и цены
P=collections.defaultdict(set)
for sh in ['EB заказ','Лист12']:
    for r in reg[sh][9:]:
        if r[2]:
            try: v=float(r[24])
            except: v=None
            if v: P[nm(str(r[2]).split('/')[0])].add(v)
for m in models:
    a=nm(m['name']); allp=sorted(P.get(a,[]))
    if not allp: row('ProductModel',m['name'],'only_db',[],'нет в листах заказа (EB заказ/Лист12)'); continue
    if m['sp'] is None: row('ProductModel',m['name'],'diff',[dict(field='sellingPrice',db=None,registry=allp,doc=None,source='EB заказ/Лист12 П.Р.Ц.')],'цена пуста'); pend('ProductModel',m['name'],'sellingPrice',None,allp,None,allp[0] if len(allp)==1 else None,'Цена в реестре есть, в БД пуста'); continue
    if m['sp'] in allp and len(allp)==1: row('ProductModel',m['name'],'match')
    elif m['sp'] in allp: row('ProductModel',m['name'],'match',[],'в реестре несколько цен по цветам %s; БД = одна из них'%allp)
    else:
        row('ProductModel',m['name'],'diff',[dict(field='sellingPrice',db=m['sp'],registry=allp,doc=None,source='EB заказ/Лист12 П.Р.Ц.')],'')
        pend('ProductModel',m['name'],'sellingPrice',m['sp'],allp,None,allp[0] if len(allp)==1 else None,'Цена БД не найдена среди цен реестра (ProductModel вне зоны записи этого прогона)')
# ---------- вывод
json.dump(dict(generatedAt=datetime.date.today().isoformat(),rows=ROWS),open(INV+'/full-crosscheck.json','w'),ensure_ascii=False,indent=1)
json.dump(PEND,open(INV+'/crosscheck-pending.json','w'),ensure_ascii=False,indent=1)
json.dump(FIX,open(INV+'/crosscheck-fixes-plan.json','w'),ensure_ascii=False,indent=1)
cnt=collections.defaultdict(collections.Counter)
for r in ROWS: cnt[r['entity']][r['status']]+=1
LBL=dict(match='совпало на 100%',diff='расхождение',only_registry='только в реестре',only_db='только в БД')
md=['# Полная сверка приложения с реестром и документами','','Срез %s. БД → реестр xlsx (21-08) → документы Drive «мех» (выгрузки docs-inventory/extract). Построено scripts/build-crosscheck.py; исправления — scripts/apply-crosscheck-fixes.ts (журнал corrections-journal-crosscheck.json, откат --rollback). Спорное — crosscheck-pending.json (%d записей).'%(datetime.date.today().isoformat(),len(PEND)),'','## Сводка','','| Сущность | Всего | '+' | '.join(LBL.values())+' |','|---|---|'+'---|'*4]
for e,c in cnt.items(): md.append('| %s | %d | '%(e,sum(c.values()))+' | '.join(str(c.get(k,0)) for k in LBL)+' |')
md+=['','Запланировано исправлений скриптом: %d (producedQuantity: %d, размеры: %d).'%(len(FIX),sum(1 for x in FIX if x['kind']=='produced'),sum(1 for x in FIX if x['kind']=='size')),'']
for e in cnt:
    md+=['## '+e,'']
    for k in ('diff','only_registry','only_db'):
        rs=[r for r in ROWS if r['entity']==e and r['status']==k]
        if not rs: continue
        md+=['### '+LBL[k]+' (%d)'%len(rs),'']
        for r in rs:
            fs='; '.join('%s: БД=%s, реестр=%s, док=%s [%s]'%(x['field'],x['db'],x['registry'],x['doc'],x['source']) for x in r['fields'])
            md.append('- **%s** %s %s'%(r['id'],fs,('— '+r['note']) if r['note'] else ''))
        md.append('')
    md.append('Совпало на 100%%: %d строк (список в full-crosscheck.json).'%cnt[e]['match']); md.append('')
open(INV+'/full-crosscheck.md','w').write('\n'.join(md))
print({e:dict(c) for e,c in cnt.items()}, 'fix',len(FIX),'pend',len(PEND))
