"""
Разбор презентации «MVST FUR RUS FW27.pdf» (WMN FW27/28): слайды → фото моделей (вырезаны из файла) и подписи «N pcs».
Запуск (нужны pymupdf и pillow, например в venv):  python scripts/extract-fw27-presentation.py [файл.pdf] [папка_вывода]
Результат: <вывод>/slides.json и <вывод>/img/NN-k.jpg. Загрузка в систему: scripts/import-fw27-presentation-2026-10-27.ts.
Слайд → (мех, категория, длина) по заголовку; длина берётся из заголовка (короткий/средний/длинный), у жилетов наследуется от предыдущего слайда.
"""
import sys
import pymupdf, json, re, os
from PIL import Image
import io
SRC=sys.argv[1] if len(sys.argv)>1 else os.path.expanduser("~/Downloads/MVST FUR RUS FW27.pdf")
BASE=sys.argv[2] if len(sys.argv)>2 else "fw27"
OUT=os.path.join(BASE,"img"); os.makedirs(OUT,exist_ok=True)
d=pymupdf.open(SRC)
FUR=[("+ соболь","Норка+Соболь"),("соболь","Соболь"),("соболя","Соболь"),("норк","Норка"),("лис","Лиса"),("свакар","Каракульча"),("рысь","Рысь")]
def parse_title(t):
    tl=t.lower()
    kind="CO" if re.match(r"^(co|со)\b",tl) else ("NEW" if tl.startswith("нов") else None)
    fur=None
    if "+ соболь" in tl: fur="Норка+Соболь"
    else:
        for k,v in FUR:
            if k in tl: fur=v; break
    cat=None
    if "жилет" in tl: cat="Жилет меховой"
    elif "кардиган" in tl: cat="Кардиган меховой"
    elif "на молнии" in tl: cat="Куртки меховые"
    elif fur: cat="Шубы"
    ln=None
    if "коротк" in tl: ln="Short"
    elif "средн" in tl: ln="Regular"
    elif "длинн" in tl: ln="Long"
    # свакара: «короткая» — куртки, «длинная» — шубы (как в плане)
    if fur=="Каракульча" and ln=="Short": cat="Куртки меховые"
    return kind,fur,cat,ln
def pcs_of(txt):
    nums=[int(x) for x in re.findall(r"(\d+)\s*pcs",txt)]
    m=re.search(r"pcs\s*/\s*(\d+)",txt)
    # «10 pcs / 6 (+розовый)» — второй цвет без слова pcs
    extra=[int(x) for x in re.findall(r"/\s*(\d+)\s*(?:\(|$)",txt) if int(x) not in nums]
    tot=sum(nums)+sum(extra) if nums else None
    return tot
slides=[]; prev=None; seq=0
for pi,p in enumerate(d):
    blocks=[]
    for b in p.get_text("dict")["blocks"]:
        if b["type"]!=0: continue
        for l in b["lines"]:
            txt="".join(s["text"] for s in l["spans"]).strip()
            if txt: blocks.append({"t":txt,"bbox":l["bbox"],"size":max(s["size"] for s in l["spans"])})
    title=" ".join(b["t"] for b in blocks if b["size"]>=24 and b["bbox"][1]<200).strip()
    imgs=[]
    for im in [b for b in p.get_text("dict")["blocks"] if b["type"]==1]:
        x0,y0,x1,y1=im["bbox"]
        x0=max(0,x0);y0=max(0,y0);x1=min(960,x1);y1=min(540,y1)
        if (y1-y0)<150 or (x1-x0)<80 or (x1-x0)>=900: continue
        imgs.append((x0,y0,x1,y1))
    if not imgs: 
        continue
    if not title and prev: title=prev["title"]
    kind,fur,cat,ln=parse_title(title)
    if prev and fur==prev.get("fur") and cat==prev.get("cat") and ln is None and prev.get("lenInherit") is not None and False: pass
    # длина наследуется от предыдущего слайда того же меха/категории (жилеты: 30→31, 32→33)
    inh=False
    if ln is None and prev and prev["fur"]==fur and prev["cat"]==cat and cat in ("Жилет меховой",) and prev["len"]:
        ln=prev["len"]; inh=True
    labels=[b for b in blocks if b["size"]<24 and b["bbox"][1]>100]
    items=[]
    imgs.sort(key=lambda r:r[0])
    own={}  # подпись → один снимок (ближайший по горизонтали): перекрывающиеся фото не дублируют штуки
    for li,b in enumerate(labels):
        bx0,by0,bx1,by1=b["bbox"]; cx=(bx0+bx1)/2
        best=None
        for k,(x0,y0,x1,y1) in enumerate(imgs):
            near_v=(abs(by0-y1)<80) or (by1<=y0+5 and y0-by1<60)
            if x0-10<=cx<=x1+10 and near_v:
                dist=abs(cx-(x0+x1)/2)
                if best is None or dist<best[0]: best=(dist,k)
        if best: own[li]=best[1]
    for k,(x0,y0,x1,y1) in enumerate(imgs):
        mine=[labels[li] for li,kk in own.items() if kk==k]
        txts=[b["t"] for b in sorted(mine,key=lambda b:b["bbox"][1])]
        pc=None; cap=[]
        for t in txts:
            if "pcs" in t:
                v=pcs_of(t)
                if v is not None: pc=(pc or 0)+v
            else: cap.append(t)
        ptxt=" ".join(t for t in txts if "pcs" in t)
        fn=f"{p.number+1:02d}-{k+1}.jpg"
        pix=p.get_pixmap(clip=pymupdf.Rect(x0,y0,x1,y1),dpi=140)
        im=Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB"); im.thumbnail((640,900)); im.save(os.path.join(OUT,fn),"JPEG",quality=82)
        items.append({"id":f"{p.number+1}-{k+1}","file":fn,"pcs":pc,"pcsText":ptxt or None,"caption":" · ".join(cap) or None})
    cur={"page":p.number+1,"title":title,"kind":kind,"fur":fur,"cat":cat,"len":ln,"lenInherited":inh,"items":items}
    slides.append(cur); prev=cur
json.dump(slides,open(os.path.join(BASE,"slides.json"),"w"),ensure_ascii=False,indent=1)
print(len(slides), sum(len(s["items"]) for s in slides))
