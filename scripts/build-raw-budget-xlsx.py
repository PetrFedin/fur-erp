#!/usr/bin/env python3
"""Excel «Сырьё и бюджет FW27»: только шкуры и деньги на мех (без подкладки и работы); соболь, норка, каракульча, лиса, рысь.

  python3 -I scripts/build-raw-budget-xlsx.py <lots.json> <data.json> <out.xlsx> <usage.json>

lots.json  — scripts/export-raw-lots-json.ts (лоты как на Главной);
data.json  — scripts/export-raw-budget-data.ts (непроизведённые FW26 по ТЗ, склад, цены, бюджет FW27);
usage.json — scripts/export-fur-usage-json.ts (каждое списание шкур в ТЗ).
Жёлтые ячейки — ввод: меняете — пересчитываются все расчёты; после правок данных — Данные → Обновить всё (сводные).

Листы: 1 Лоты (данные) · 2 сводная · 3 Непроизведённые FW26 по ТЗ (данные) · 3а сводная · 4 Остаток на конец 2026 · 5 План 2027 (данные) · 5а сводная ·
6 Budget PCS 2027 · 7 Расчёт закупки 2027 · 8 Расход по ТЗ (данные) · 8а сводная.
"""
import json
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xlsx_pivot import add_pivot  # noqa: E402
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as L
from openpyxl.worksheet.properties import PageSetupProperties

lots = json.load(open(sys.argv[1], encoding="utf-8"))
data = json.load(open(sys.argv[2], encoding="utf-8"))
OUT = sys.argv[3]
USAGE = json.load(open(sys.argv[4], encoding="utf-8")) if len(sys.argv) > 4 else []
HERE = os.path.dirname(os.path.abspath(__file__))
OWNER = json.load(open(os.path.join(HERE, "fw27-owner-plan-2026-11-01.json"), encoding="utf-8"))
SEX = json.load(open(os.path.join(HERE, "..", "src", "lib", "data", "mink-lot-sex.json"), encoding="utf-8"))

FURS = ["Соболь", "Норка", "Каракульча", "Лиса", "Рысь"]  # прочие меха (бобр, выдра, кошка, фишер, шиншилла) в отчёт не входят
NAME = {"Свакара": "Каракульча"}
fur_of = lambda f: NAME.get(f, f)
MIX = data["mix"]  # доля норки в «Норка + Соболь» по факту ТЗ FW26 (одежда / аксессуары)
PRICE = {f: data["price"].get(f, 0) for f in FURS}  # без округления — как в приложении

# ---------- стиль ----------
INK = "1F2933"
F_HEAD = PatternFill("solid", fgColor="E8ECF1")
F_FUR = PatternFill("solid", fgColor="D9E2EC")
F_GRP = PatternFill("solid", fgColor="EEF2F6")
F_TOT = PatternFill("solid", fgColor="BCCCDC")
F_IN = PatternFill("solid", fgColor="FFF3BF")
F_OK = PatternFill("solid", fgColor="E3F9E5")
thin = Side(style="thin", color="C7CED6")
B = Border(left=thin, right=thin, top=thin, bottom=thin)
BOLD = Font(bold=True, color=INK)
TITLE = Font(bold=True, size=14, color=INK)
H2 = Font(bold=True, size=12, color=INK)
NOTE = Font(italic=True, size=9, color="52606D")
INT, RUB, USD, PCT, DEC = '#,##0;-#,##0;"–"', '#,##0" ₽";-#,##0" ₽";"–"', '#,##0.00" $";-#,##0.00" $";"–"', '0%', '#,##0.0#;-#,##0.0#;"–"'
WRAP = Alignment(wrap_text=True, vertical="top")


def head(ws, row, cols, widths=None):
    for i, c in enumerate(cols, 1):
        x = ws.cell(row, i, c)
        x.font, x.fill, x.border, x.alignment = BOLD, F_HEAD, B, Alignment(wrap_text=True, vertical="center", horizontal="center")
    ws.row_dimensions[row].height = 45
    if widths:
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[L(i)].width = w


def title(ws, text, notes):
    ws["A1"] = text
    ws["A1"].font = TITLE
    for i, n in enumerate(notes, 2):
        ws.cell(i, 1, n).font = NOTE


def put(ws, r, c, v, fmt=None, fill=None, bold=False):
    x = ws.cell(r, c, v)
    x.border = B
    if fmt:
        x.number_format = fmt
    if fill:
        x.fill = fill
    if bold:
        x.font = BOLD
    return x


def inp(ws, r, c, v, fmt=None):
    x = put(ws, r, c, v, fmt, F_IN)
    x.font = Font(bold=True, color="7C5E10")
    return x


def total_row(ws, r, ncols, sums, label="ИТОГО", fill=F_TOT, first=None, last=None, fn="SUBTOTAL(9,"):
    put(ws, r, 1, label, fill=fill, bold=True)
    for c in range(2, ncols + 1):
        put(ws, r, c, None, fill=fill)
    for c, fmt in sums:
        put(ws, r, c, f"={fn}{L(c)}{first}:{L(c)}{last})", fmt, fill, True)


wb = Workbook()

# =====================================================================
# Лист 1. Лоты (данные)
# =====================================================================
ws1 = wb.active
ws1.title = "1 Лоты"
title(ws1, "Данные: всё купленное сырьё по лотам — куплено, потрачено по ТЗ, остаток (шкуры, ₽, $)", [
    f"Данные на {data['asOf']} (МСК). Как на Главной: лоты склада + «Заказано, не получено» + шкуры подрядчика. ₽ — с НДС. Только соболь, норка, каракульча, лиса, рысь.",
    "Потрачено = списано в ТЗ (совпадает с листом 8). Цена $ — цена молотка на аукционе, где она есть в документах. Пол норки — признак лота «Самец» / «Самка».",
])
C1 = ["Тип меха", "Год", "Аукцион", "Источник", "Лот", "Сорт", "Цвет", "Пол норки", "Признаки",
      "Куплено шк", "Куплено руб", "Потрачено шк", "Потрачено руб", "Остаток шк", "Остаток руб", "Ср цена руб", "Ср цена USD",
      "Куплено шк с USD", "Куплено USD", "Потрачено шк с USD", "Потрачено USD", "Остаток шк с USD", "Остаток USD", "Пол: откуда"]
HR1 = 5
head(ws1, HR1, C1, [12, 7, 20, 20, 16, 34, 14, 10, 24, 10, 15, 10, 15, 10, 15, 12, 11, 10, 13, 10, 13, 10, 13, 50])
rows1 = sorted([x for x in lots if fur_of(x["item"]) in FURS], key=lambda r: (FURS.index(fur_of(r["item"])), r["year"], r["auction"], r["lot"]))
r = HR1 + 1
for x in rows1:
    f = fur_of(x["item"])
    sx = (SEX.get(x["lot"]) or ["?", "пол в документах не указан" if x["lot"] != "Заказано, не получено" else "заказано, не получено: пол не указан"]) if f == "Норка" else ["—", None]
    for c, v in enumerate([f, int(x["year"]) if str(x["year"]).isdigit() else x["year"], x["auction"], x["src"], x["lot"], x["grade"], x["color"],
                           {"M": "Самец", "F": "Самка", "?": "Пол не указан"}.get(sx[0], sx[0]), x.get("attrs") or "—"], 1):
        put(ws1, r, c, v)
    for c, k in [(10, "recv"), (11, "recvIn"), (12, "used"), (13, "usedIn"), (14, "rem"), (15, "remIn"), (18, "usdQty"), (19, "usdSub"), (20, "usdUQty"), (21, "usdUSub"), (22, "usdRQty"), (23, "usdRSub")]:
        put(ws1, r, c, x[k], RUB if k.endswith("In") else USD if "Sub" in k else INT)
    put(ws1, r, 16, f"=IFERROR(K{r}/J{r},0)", RUB)
    put(ws1, r, 17, f"=IFERROR(S{r}/R{r},0)", USD)
    put(ws1, r, 24, sx[1])
    r += 1
LAST1 = r - 1
total_row(ws1, r, 24, [(c, ws1.cell(LAST1, c).number_format) for c in [10, 11, 12, 13, 14, 15, 18, 19, 20, 21, 22, 23]], first=HR1 + 1, last=LAST1)
put(ws1, r, 16, f"=IFERROR(K{r}/J{r},0)", RUB, F_TOT, True)
put(ws1, r, 17, f"=IFERROR(S{r}/R{r},0)", USD, F_TOT, True)
ws1.auto_filter.ref = f"A{HR1}:{L(len(C1))}{LAST1}"
ws1.freeze_panes = f"J{HR1+1}"
LOT = lambda col: f"'1 Лоты'!${col}${HR1+1}:${col}${LAST1}"

# =====================================================================
# Лист 2. Сводная по лотам
# =====================================================================
ws2 = wb.create_sheet("2 Сводная сырьё")
title(ws2, "Сводная по листу 1: тип меха → год — куплено, потрачено, остаток, средние $ и ₽", [
    "Поля можно перетаскивать (Анализ сводной таблицы → Список полей): аукцион, пол норки, признаки. После правок листа 1 — Данные → Обновить всё.",
])
add_pivot(ws2, ws1, HR1, LAST1, C1, ["Тип меха", "Год"], [
    ("Куплено, шк.", "Куплено шк", 3), ("Куплено, ср. $", "Ср USD куплено", 4), ("Куплено, ср. ₽", "Ср руб куплено", 3), ("Куплено, ₽", "Куплено руб", 3),
    ("Потрачено, шк.", "Потрачено шк", 3), ("Потрачено, ₽", "Потрачено руб", 3),
    ("Остаток, шк.", "Остаток шк", 3), ("Остаток, ср. ₽", "Ср руб остаток", 3), ("Остаток, ₽", "Остаток руб", 3),
], "Сводная_сырьё", calc=[
    ("Ср USD куплено", "=IFERROR('Куплено USD'/'Куплено шк с USD',0)"), ("Ср руб куплено", "=IFERROR('Куплено руб'/'Куплено шк',0)"),
    ("Ср руб остаток", "=IFERROR('Остаток руб'/'Остаток шк',0)"),
], anchor="A4")

# =====================================================================
# Лист 7 (параметры) — номера строк нужны листам 3–6, сам лист создаётся ниже
# =====================================================================
P7_UP, P7_RTW = 6, 7           # рост цены; годный остаток — в одежду (по умолчанию)
P7_HEAD = 10                   # заголовок таблицы параметров по типам меха
PR = {f: P7_HEAD + 1 + i for i, f in enumerate(FURS)}
UP = f"'7 Расчёт закупки 2027'!$D${P7_UP}"
PRICE_REF = lambda f: f"'7 Расчёт закупки 2027'!$F${PR[f]}"

# =====================================================================
# Лист 3. Непроизведённые изделия FW26 по ТЗ (данные)
# =====================================================================
ws3 = wb.create_sheet("3 Непроизведённые FW26")
title(ws3, "Данные: непроизведённые изделия заказа FW26 — артикул, цвет, размер, штук, шкур и ₽ по средневзвешенной цене", [
    "Заказ FW26 = объём всех наших ТЗ (723 изд.); не произведено = объём ТЗ модели − получено в розницу. Остаток модели разложен по её ТЗ: полученное считаем пришедшим из более ранних ТЗ.",
    "«ТЗ завершено, не получено» — шкуры уже списаны по ТЗ (фактически). «ТЗ в работе» — ещё уйдёт со склада = штук × шкур на изделие − уже выдано по ТЗ.",
    "Шкур на изделие — норма из ТЗ этой модели (жёлтая — можно менять). ₽ = шкур всего × средневзвешенная цена шкуры вида меха (лист 7, таблица параметров).",
])
C3 = ["Артикул", "Тип меха", "Категория", "ТЗ", "Статус ТЗ", "Цвет", "Размер", "Партия", "Не произведено шт", "Шкур на изд",
      "Уже списано по ТЗ шк", "Еще уйдет со склада шк", "Шкур всего", "Ср цена шкуры руб", "Сумма руб", "Норма: откуда"]
HR3 = 6
head(ws3, HR3, C3, [12, 12, 18, 12, 24, 14, 16, 22, 11, 10, 12, 12, 11, 13, 15, 44])
fw = []
for x in data["fw26"]:
    f = x["fur"]
    if " + " in f:  # смесь «Норка + Соболь»: делим по факту ТЗ
        m = MIX["Acc" if x["cls"] == "acc" else "RTW"]
        for ff, sh in (("Норка", m), ("Соболь", 1 - m)):
            fw.append({**x, "fur": ff, "qty": x["qty"] * sh, "done": x["done"] * sh, "toGo": x["toGo"] * sh, "hpSource": x["hpSource"] + f" · доля {ff.lower()} {sh:.0%}"})
    else:
        fw.append({**x, "fur": fur_of(f)})
fw.sort(key=lambda x: (FURS.index(x["fur"]) if x["fur"] in FURS else 99, x["model"], x["tz"]))
r = HR3 + 1
for x in fw:
    for c, v in enumerate([x["model"], x["fur"], x["cat2"], x["tz"], x["status"], x["color"], x["size"], x["batch"]], 1):
        put(ws3, r, c, v)
    put(ws3, r, 9, round(x["qty"], 4), INT)
    inp(ws3, r, 10, x["hp"], DEC)
    put(ws3, r, 11, round(x["done"], 4), DEC)
    put(ws3, r, 12, f'=IF(E{r}="ТЗ завершено, не получено",0,MAX(0,I{r}*J{r}-K{r}))', DEC)
    put(ws3, r, 13, f"=K{r}+L{r}", DEC)
    put(ws3, r, 14, f"={PRICE_REF(x['fur'])}" if x["fur"] in FURS else 0, RUB)
    put(ws3, r, 15, f"=M{r}*N{r}", RUB)
    put(ws3, r, 16, x["hpSource"])
    r += 1
LAST3 = r - 1
total_row(ws3, r, 16, [(9, INT), (11, DEC), (12, DEC), (13, DEC), (15, RUB)], first=HR3 + 1, last=LAST3)
put(ws3, r, 14, f"=IFERROR(O{r}/M{r},0)", RUB, F_TOT, True)
ws3.auto_filter.ref = f"A{HR3}:{L(len(C3))}{LAST3}"
ws3.freeze_panes = f"C{HR3+1}"
ART = lambda col: f"'3 Непроизведённые FW26'!${col}${HR3+1}:${col}${LAST3}"

ws3a = wb.create_sheet("3а Сводная FW26")
title(ws3a, "Сводная по листу 3: тип меха → артикул → цвет → размер", ["После правок листа 3 — Данные → Обновить всё. ТЗ, статус и партию можно перетащить из списка полей."])
add_pivot(ws3a, ws3, HR3, LAST3, C3, ["Тип меха", "Артикул", "Цвет", "Размер"], [
    ("Не произведено, шт.", "Не произведено шт", 3), ("Шкур всего", "Шкур всего", 4), ("Уже списано, шк.", "Уже списано по ТЗ шк", 4),
    ("Ещё уйдёт со склада, шк.", "Еще уйдет со склада шк", 4), ("Сумма, ₽", "Сумма руб", 3),
], "Сводная_FW26", anchor="A3")

# =====================================================================
# Лист 4. Остаток на конец 2026
# =====================================================================
ws4 = wb.create_sheet("4 Остаток на конец 2026")
title(ws4, "Сырьё на складе, сколько ещё уйдёт на непроизведённые изделия FW26 и сколько останется на конец 2026", [
    "На складе — остаток лотов (лист 1). Уйдёт — «ещё уйдёт со склада» листа 3 (шкуры по завершённым ТЗ уже списаны и на складе не числятся). ₽ — по средней цене склада.",
])
C4 = ["Тип меха", "На складе, шк.", "На складе, ₽", "Ср. цена склада, ₽", "Уйдёт на непроизведённые FW26, шк.", "Уйдёт, ₽",
      "Останется на конец 2026, шк.", "Останется, ₽", "Не хватает на FW26, шк.", "Справочно: уже списано на непроизведённые, шк."]
HR4 = 5
head(ws4, HR4, C4, [16, 12, 15, 12, 14, 14, 14, 15, 12, 16])
r = HR4 + 1
LEFT_ROW = {}
for f in FURS:
    put(ws4, r, 1, f, bold=True)
    put(ws4, r, 2, f'=SUMIFS({LOT("N")},{LOT("A")},A{r})', INT)
    put(ws4, r, 3, f'=SUMIFS({LOT("O")},{LOT("A")},A{r})', RUB)
    put(ws4, r, 4, f"=IFERROR(C{r}/B{r},0)", RUB)
    put(ws4, r, 5, f'=SUMIFS({ART("L")},{ART("B")},A{r})', DEC)
    put(ws4, r, 6, f"=E{r}*D{r}", RUB)
    put(ws4, r, 7, f"=MAX(0,B{r}-E{r})", DEC)
    put(ws4, r, 8, f"=G{r}*D{r}", RUB)
    put(ws4, r, 9, f"=MAX(0,E{r}-B{r})", DEC)
    put(ws4, r, 10, f'=SUMIFS({ART("K")},{ART("B")},A{r})', DEC)
    LEFT_ROW[f] = r
    r += 1
total_row(ws4, r, 10, [(c, ws4.cell(r - 1, c).number_format) for c in [2, 3, 5, 6, 7, 8, 9, 10]], label="ВСЕГО", first=HR4 + 1, last=r - 1, fn="SUM(")
put(ws4, r, 4, f"=IFERROR(C{r}/B{r},0)", RUB, F_TOT, True)
TOT4 = r
ws4.cell(r + 2, 1, "Проверка: «уйдёт» и «уже списано» по листу 3 целиком (должно совпасть с ВСЕГО)").font = NOTE
put(ws4, r + 2, 5, f"=SUM({ART('L')})", DEC)
put(ws4, r + 2, 10, f"=SUM({ART('K')})", DEC)
ws4.freeze_panes = f"B{HR4+1}"

# =====================================================================
# Лист 5. План 2027 (данные)
# =====================================================================
ws5 = wb.create_sheet("5 План 2027")
title(ws5, "Данные: план производства 2027 (бюджет FW27) — 1 460 изделий, шкур на изделие и всего", [
    "Одежда — бюджет RTW от 19.10, аксессуары — файл MVST W FURS ACC от 27.10. Шкур на изделие — бюджет FW27 с нормами владельца от 01.11 (столбцы «Норма владельца» и «Сверка»).",
    "«Норка+Соболь»: шкуры делятся по доле норки строки. Пол норки: Самец / Самка / любой — используется на листе 7 (таблица «Норка по полу»). Жёлтые ячейки можно менять.",
])
C5 = ["Тип меха", "Блок", "Категория", "Длина", "Кол-во шт", "Шкур на изд", "Шкур всего", "Доля норки", "Шкур норки", "Шкур соболя", "Пол норки",
      "Норма владельца 01.11", "Сверка нормы", "Комментарий владельца / оценка"]
HR5 = 5
head(ws5, HR5, C5, [14, 12, 24, 10, 9, 10, 11, 9, 10, 10, 10, 11, 10, 70])
FO = ["Соболь", "Норка", "Норка+Соболь", "Каракульча", "Лиса", "Рысь"]
LENS = ["Short", "Regular", "Long", ""]
bud = sorted(data["budget"], key=lambda b: (FO.index(b["fur"]) if b["fur"] in FO else 99, 0 if b["group"] == "Одежда" else 1, b["cat"], LENS.index(b["len"]) if b["len"] in LENS else 9))
SEXLBL = {"M": "Самец", "F": "Самка"}
r = HR5 + 1
for b in bud:
    key = f'{b["fur"]}|{b["cat"]}|{b["len"]}'
    for c, v in enumerate([b["fur"], b["group"], b["cat"], b["len"] or "—"], 1):
        put(ws5, r, c, v)
    inp(ws5, r, 5, b["pcs"], INT)
    inp(ws5, r, 6, b["hides"], DEC)
    if b["est"]:
        ws5.cell(r, 6).font = Font(italic=True, bold=True, color="7C5E10")
    put(ws5, r, 7, f"=E{r}*F{r}", DEC)
    if b["fur"] == "Норка+Соболь":
        share = OWNER["minkShare"].get(f'{b["cat"]}|{b["len"]}')
        inp(ws5, r, 8, round(share if share is not None else MIX["RTW" if b["group"] == "Одежда" else "Acc"], 4), PCT)
    else:
        put(ws5, r, 8, {"Норка": 1, "Соболь": 0}.get(b["fur"], 0), PCT)
    put(ws5, r, 9, f'=IF(OR(A{r}="Норка",A{r}="Норка+Соболь"),G{r}*H{r},0)', DEC)
    put(ws5, r, 10, f'=IF(OR(A{r}="Соболь",A{r}="Норка+Соболь"),G{r}*(1-H{r}),0)', DEC)
    if b["fur"] in ("Норка", "Норка+Соболь"):
        inp(ws5, r, 11, SEXLBL.get(OWNER["minkSex"].get(key, ""), "любой"))
    else:
        put(ws5, r, 11, "—")
    nv = OWNER["norms"].get(key)
    if nv is not None:
        put(ws5, r, 12, nv, DEC)
        put(ws5, r, 13, f'=IF(ABS(F{r}-L{r})<0.01,"✓ учтена","≠ проверить")')
    else:
        put(ws5, r, 12, None)
        put(ws5, r, 13, "—")
    put(ws5, r, 14, " · ".join(v for v in [OWNER["comments"].get(key), b["est"]] if v) or None).alignment = WRAP
    r += 1
LAST5 = r - 1
total_row(ws5, r, 14, [(5, INT), (7, DEC), (9, DEC), (10, DEC)], first=HR5 + 1, last=LAST5)
put(ws5, r, 6, f"=IFERROR(G{r}/E{r},0)", DEC, F_TOT, True)
TOT5 = r
ws5.auto_filter.ref = f"A{HR5}:{L(len(C5))}{LAST5}"
ws5.freeze_panes = f"E{HR5+1}"
P5 = lambda col: f"'5 План 2027'!${col}${HR5+1}:${col}${LAST5}"

ws5a = wb.create_sheet("5а Сводная план 2027")
title(ws5a, "Сводная по листу 5: тип меха → блок → категория → длина", ["После правок листа 5 — Данные → Обновить всё."])
add_pivot(ws5a, ws5, HR5, LAST5, C5, ["Тип меха", "Блок", "Категория", "Длина"], [
    ("Кол-во, шт.", "Кол-во шт", 3), ("Шкур всего", "Шкур всего", 4), ("Шкур на изделие", "Ср шкур", 4), ("Шкур норки", "Шкур норки", 4), ("Шкур соболя", "Шкур соболя", 4),
], "Сводная_план_2027", calc=[("Ср шкур", "=IFERROR('Шкур всего'/'Кол-во шт',0)")], anchor="A3")

# =====================================================================
# Лист 6. Budget PCS 2027 — деньги на мех без учёта остатков
# =====================================================================
ws6 = wb.create_sheet("6 Budget PCS 2027")
title(ws6, "MVST · Budget PCS 2027: сколько шкур и денег на мех на весь план (без учёта остатков)", [
    "Количество и шкур на изделие — с листа 5. Ср. цена шкуры — бюджет FW27 по категории (средневзвешенная по ТЗ, жёлтая — можно менять). Рост цены — лист 7.",
])
ws6["A4"] = "Рост цены шкуры (задаётся на листе 7)"
ws6["A4"].font = BOLD
put(ws6, 4, 4, f"={UP}", PCT, bold=True)
C6 = ["Тип меха", "Категория 1", "Категория 2", "Длина", "Кол-во, шт.", "Шкур на изд.", "Шкур всего", "Ср. цена шкуры, ₽", "Цена с ростом, ₽", "На мех, ₽"]
HR6 = 6
head(ws6, HR6, C6, [16, 13, 26, 10, 10, 11, 12, 14, 14, 17])
r = HR6 + 1
leaf_first = r
for i, b in enumerate(bud):
    src = HR5 + 1 + i
    for c, v in enumerate([b["fur"], b["group"], b["cat"], b["len"] or "—"], 1):
        put(ws6, r, c, v)
    put(ws6, r, 5, f"='5 План 2027'!E{src}", INT)
    put(ws6, r, 6, f"='5 План 2027'!F{src}", DEC)
    put(ws6, r, 7, f"=E{r}*F{r}", DEC)
    inp(ws6, r, 8, round(b["hidePrice"] or 0), RUB)
    put(ws6, r, 9, f"=H{r}*(1+$D$4)", RUB)
    put(ws6, r, 10, f"=G{r}*I{r}", RUB)
    r += 1
leaf_last = r - 1
total_row(ws6, r, 10, [(5, INT), (7, DEC), (10, RUB)], first=leaf_first, last=leaf_last)
put(ws6, r, 6, f"=IFERROR(G{r}/E{r},0)", DEC, F_TOT, True)
put(ws6, r, 9, f"=IFERROR(J{r}/G{r},0)", RUB, F_TOT, True)
put(ws6, r, 8, f"=IFERROR(I{r}/(1+$D$4),0)", RUB, F_TOT, True)
P6 = lambda col: f"'6 Budget PCS 2027'!${col}${leaf_first}:${col}${leaf_last}"
r += 2
ws6.cell(r, 1, "Сводная как в отчёте MVST: TOTAL → тип меха → категория 1 (одежда / аксессуары) → категория 2").font = H2
r += 1
head(ws6, r, C6)
r += 1


def agg6(r, crit, labels, fill=None):
    for c, v in zip([1, 2, 3, 4], labels):
        put(ws6, r, c, v, fill=fill, bold=bool(fill))
    sf = lambda col: f"SUMIFS({P6(col)},{crit})" if crit else f"SUM({P6(col)})"
    put(ws6, r, 5, f"={sf('E')}", INT, fill, bool(fill))
    put(ws6, r, 7, f"={sf('G')}", DEC, fill, bool(fill))
    put(ws6, r, 10, f"={sf('J')}", RUB, fill, bool(fill))
    put(ws6, r, 6, f"=IFERROR(G{r}/E{r},0)", DEC, fill, bool(fill))
    put(ws6, r, 9, f"=IFERROR(J{r}/G{r},0)", RUB, fill, bool(fill))
    put(ws6, r, 8, f"=IFERROR(I{r}/(1+$D$4),0)", RUB, fill, bool(fill))


agg6(r, None, ["TOTAL", "", "", ""], F_TOT)
TOT6 = r
r += 1
for f in FO:
    if not any(b["fur"] == f for b in bud):
        continue
    agg6(r, f'{P6("A")},"{f}"', [f, "", "", ""], F_FUR)
    r += 1
    for g in ["Одежда", "Аксессуары"]:
        cats = list(dict.fromkeys(b["cat"] for b in bud if b["fur"] == f and b["group"] == g))
        if not cats:
            continue
        agg6(r, f'{P6("A")},"{f}",{P6("B")},"{g}"', [f, g, "", ""], F_GRP)
        r += 1
        for c in cats:
            agg6(r, f'{P6("A")},"{f}",{P6("B")},"{g}",{P6("C")},"{c}"', [f, g, c, ""])
            r += 1
ws6.freeze_panes = f"E{HR6+1}"

# =====================================================================
# Лист 7. Расчёт закупки 2027
# =====================================================================
ws7 = wb.create_sheet("7 Расчёт закупки 2027")
title(ws7, "Сколько шкур купить на план 2027: остаток на конец 2026 → что из него используем → покупка с учётом невостребованного сырья", [
    "1) Остаток на конец 2026 (лист 4). Часть его не будет востребована: «невостребованное сырьё, %» вида меха (владелец: соболь, норка, каракульча 30 %, лиса 20 %, рысь 15 %).",
    "2) Годный остаток делится: в одежду — «в одежду, %», остальное — в аксессуары; лишнее одного блока в другой не переходит. Используем = меньшее из «нужно» и «годного».",
    "3) Закупить так, чтобы после всего заказа 2027 неиспользованным осталось не больше «остаток после 2027, %» от всего сырья (остаток 2026 + покупка), но не меньше, чем нужно из покупки.",
    "Все жёлтые ячейки можно менять — всё пересчитывается.",
])
ws7.cell(P7_UP, 1, "Рост цены шкуры к средневзвешенной, %").font = BOLD
inp(ws7, P7_UP, 4, 0.10, PCT)
ws7.cell(P7_RTW, 1, "Годный остаток 2026 — в одежду, % (по умолчанию; остальное — в аксессуары)").font = BOLD
inp(ws7, P7_RTW, 4, 0.25, PCT)
ws7.cell(P7_HEAD - 1, 1, "Параметры по типам меха (жёлтые — можно менять)").font = H2
head(ws7, P7_HEAD, ["Тип меха", "Невостребованное сырьё в остатке 2026, %", "Остаток после заказа 2027, % от всего сырья", "Годный остаток — в одежду, %",
                    "Годный остаток — в аксессуары", "Ср. цена шкуры, ₽ (средневзв. по ТЗ)", "Цена с ростом, ₽"])
for f in FURS:
    p = PR[f]
    put(ws7, p, 1, f, bold=True)
    inp(ws7, p, 2, OWNER["reserve"][f], PCT)
    inp(ws7, p, 3, f"=B{p}", PCT)
    if f == "Рысь":
        put(ws7, p, 4, "по потребности")
        put(ws7, p, 5, "по потребности")
    else:
        inp(ws7, p, 4, f"=$D${P7_RTW}", PCT)
        put(ws7, p, 5, f"=1-D{p}", PCT)
    inp(ws7, p, 6, PRICE[f], RUB)
    put(ws7, p, 7, f"=F{p}*(1+$D${P7_UP})", RUB)
r = PR[FURS[-1]] + 2
ws7.cell(r, 1, "Расчёт по типам меха и блокам").font = H2
r += 1
C7 = ["Тип меха", "Блок", "Изделий на план, шт.", "Шкур на план 2027", "Остаток на конец 2026, шк.", "Не будет востребовано, шк.", "Годный остаток, шк.",
      "Используем из остатка, шк.", "Годное, но не пригодится, шк.", "Нужно из покупки, шк.", "Закупить, шк.", "Останется после заказа 2027, шк.",
      "Доля остатка после 2027", "Цена с ростом, ₽", "На закупку, ₽"]
HR7 = r
head(ws7, HR7, C7, [40, 12, 11, 12, 13, 13, 12, 13, 13, 12, 12, 14, 11, 12, 16])
r += 1


def ttl_ref(fur, blk):
    if fur == "Норка":
        return f'SUMIFS({P5("I")},{P5("B")},"{blk}")'
    if fur == "Соболь":
        return f'SUMIFS({P5("J")},{P5("B")},"{blk}")'
    return f'SUMIFS({P5("G")},{P5("A")},"{fur}",{P5("B")},"{blk}")'


tot_rows = []
for f in FURS:
    p, lr = PR[f], LEFT_ROW[f]
    left, short = f"'4 Остаток на конец 2026'!G{lr}", f"'4 Остаток на конец 2026'!I{lr}"
    first = r
    for blk in ["Одежда", "Аксессуары"]:
        put(ws7, r, 1, f)
        put(ws7, r, 2, blk)
        put(ws7, r, 3, f'=SUMIFS({P5("E")},{P5("A")},"{f}",{P5("B")},"{blk}")', INT)
        put(ws7, r, 4, f"={ttl_ref(f, blk)}", DEC)
        share = (f"IFERROR(D{r}/({ttl_ref(f, 'Одежда')}+{ttl_ref(f, 'Аксессуары')}),0.5)" if f == "Рысь"
                 else f"$D${p}" if blk == "Одежда" else f"$E${p}")
        put(ws7, r, 5, f"={left}*{share}", DEC)
        put(ws7, r, 6, f"=E{r}*$B${p}", DEC)
        put(ws7, r, 7, f"=E{r}-F{r}", DEC)
        put(ws7, r, 8, f"=MIN(D{r},G{r})", DEC)
        put(ws7, r, 9, f"=G{r}-H{r}", DEC)
        put(ws7, r, 10, f"=D{r}-H{r}+{short}*{share}", DEC)
        for c in range(11, 16):
            put(ws7, r, c, None)
        r += 1
    put(ws7, r, 1, f"{f} — итого", fill=F_FUR, bold=True)
    put(ws7, r, 2, "", fill=F_FUR)
    for c in range(3, 11):
        put(ws7, r, c, f"=SUM({L(c)}{first}:{L(c)}{r-1})", INT if c == 3 else DEC, F_FUR, True)
    # закупка: не меньше «нужно из покупки»; столько, чтобы после 2027 осталось не больше X % от (остаток 2026 + покупка)
    put(ws7, r, 11, f"=MAX(J{r},(D{r}+{short})/(1-$C${p})-E{r})", INT, F_FUR, True)
    put(ws7, r, 12, f"=E{r}+K{r}-D{r}-{short}", INT, F_FUR, True)
    put(ws7, r, 13, f"=IFERROR(L{r}/(E{r}+K{r}),0)", PCT, F_FUR, True)
    put(ws7, r, 14, f"=$G${p}", RUB, F_FUR, True)
    put(ws7, r, 15, f"=K{r}*N{r}", RUB, F_FUR, True)
    tot_rows.append(r)
    r += 1
put(ws7, r, 1, "Норка+Соболь — изделий (их шкуры входят в норку и соболь выше)")
put(ws7, r, 2, "")
put(ws7, r, 3, f'=SUMIFS({P5("E")},{P5("A")},"Норка+Соболь")', INT)
for c in range(4, 16):
    put(ws7, r, c, None)
MIX7 = r
r += 1
put(ws7, r, 1, "ВСЕГО", fill=F_TOT, bold=True)
put(ws7, r, 2, "", fill=F_TOT)
put(ws7, r, 3, "=" + "+".join(f"C{x}" for x in tot_rows) + f"+C{MIX7}", INT, F_TOT, True)
for c in [4, 5, 6, 7, 8, 9, 10, 11, 12, 15]:
    put(ws7, r, c, "=" + "+".join(f"{L(c)}{x}" for x in tot_rows), INT if c in (11, 12) else RUB if c == 15 else DEC, F_TOT, True)
put(ws7, r, 13, f"=IFERROR(L{r}/(E{r}+K{r}),0)", PCT, F_TOT, True)
put(ws7, r, 14, f"=IFERROR(O{r}/K{r},0)", RUB, F_TOT, True)
TOT7 = r
r += 1
ws7.cell(r, 1, "«Доля остатка после 2027» = останется ÷ (остаток 2026 + закупка). Больше заданного % — значит, остатка 2026 больше, чем можно использовать по плану (годное, но не пригодится), докупать сверх нужного не требуется.").font = NOTE
r += 2

# ---------- Норка по полу ----------
ws7.cell(r, 1, "Норка по полу: хватит ли самцов и самок").font = H2
r += 1
ws7.cell(r, 1, "Склад — лоты с признаком «Самец» / «Самка» (лист 1). Остаток на конец 2026 и невостребованное — в той же пропорции, что склад. Нужно — лист 5 (пол норки: короткие шубы — самцы, длинные — самки).").font = NOTE
r += 1
head(ws7, r, ["Пол", "На складе, шк.", "Доля склада", "Остаток на конец 2026, шк.", "Не будет востребовано, шк.", "Годный остаток, шк.", "Нужно на план 2027, шк.", "Не хватает, шк.", "Лишнее, шк."])
r += 1
pm, mink_tot = PR["Норка"], tot_rows[FURS.index("Норка")]
SXR = {}
first_sx = r
for code, label, need_lbl in [("Самец", "Самцы", "Самец"), ("Самка", "Самки", "Самка"), ("Пол не указан", "Пол не указан / пол не важен", "любой")]:
    SXR[code] = r
    put(ws7, r, 1, label, bold=True)
    put(ws7, r, 2, f'=SUMIFS({LOT("N")},{LOT("A")},"Норка",{LOT("H")},"{code}")', INT)
    put(ws7, r, 7, f'=SUMIFS({P5("I")},{P5("K")},"{need_lbl}")', DEC)
    r += 1
for code, rr in SXR.items():
    put(ws7, rr, 3, f"=IFERROR(B{rr}/SUM(B{first_sx}:B{r-1}),0)", PCT)
    put(ws7, rr, 4, f"=E{mink_tot}*C{rr}", DEC)
    put(ws7, rr, 5, f"=D{rr}*$B${pm}", DEC)
    put(ws7, rr, 6, f"=D{rr}-E{rr}", DEC)
    if code == "Пол не указан":
        avail = f"F{rr}+I{SXR['Самец']}+I{SXR['Самка']}"
        put(ws7, rr, 8, f"=MAX(0,G{rr}-({avail}))", DEC)
        put(ws7, rr, 9, f"=MAX(0,({avail})-G{rr})", DEC)
    else:
        put(ws7, rr, 8, f"=MAX(0,G{rr}-F{rr})", DEC)
        put(ws7, rr, 9, f"=MAX(0,F{rr}-G{rr})", DEC)
put(ws7, r, 1, "Норка — итого", fill=F_FUR, bold=True)
for c in [2, 4, 5, 6, 7]:
    put(ws7, r, c, f"=SUM({L(c)}{first_sx}:{L(c)}{r-1})", INT, F_FUR, True)
for c in (3, 8, 9):
    put(ws7, r, c, None, fill=F_FUR)
r += 1
for t_, fml in [("Из закупки норки — самцов не меньше, шк.", f"=H{SXR['Самец']}"), ("Из закупки норки — самок не меньше, шк.", f"=H{SXR['Самка']}"),
                ("Остальная закупка норки — пол не важен, шк.", f"=MAX(0,K{mink_tot}-H{SXR['Самец']}-H{SXR['Самка']})")]:
    ws7.cell(r, 1, t_)
    put(ws7, r, 4, fml, INT, bold=True)
    r += 1
r += 1

# ---------- Кратко ----------
ws7.cell(r, 1, "Кратко: вся цепочка").font = H2
r += 1
for t_, fml, fmt in [
    ("Сырьё на складе сейчас, шк.", f"='4 Остаток на конец 2026'!B{TOT4}", INT),
    ("Уйдёт на непроизведённые изделия FW26, шк.", f"='4 Остаток на конец 2026'!E{TOT4}", DEC),
    ("Остаток сырья на конец 2026, шк.", f"=E{TOT7}", INT),
    ("   из него не будет востребовано, шк.", f"=F{TOT7}", INT),
    ("   годный остаток, шк.", f"=G{TOT7}", INT),
    ("Изделий на план 2027, шт.", f"=C{TOT7}", INT),
    ("Шкур на план 2027, шк.", f"=D{TOT7}", INT),
    ("   из остатка 2026 используем, шк.", f"=H{TOT7}", INT),
    ("   годное, но по плану 2027 не пригодится, шк.", f"=I{TOT7}", INT),
    ("   нужно из покупки, шк.", f"=J{TOT7}", INT),
    ("Закупить, шк.", f"=K{TOT7}", INT),
    ("Останется после заказа 2027 (весь остаток), шк.", f"=L{TOT7}", INT),
    ("На закупку меха, ₽ (с ростом цены, с НДС)", f"=O{TOT7}", RUB),
    ("Для сравнения: мех на весь план без остатков, ₽ (лист 6)", f"='6 Budget PCS 2027'!J{TOT6}", RUB),
]:
    ws7.cell(r, 1, t_)
    put(ws7, r, 4, fml, fmt, bold=True)
    r += 1
r += 1
ws7.cell(r, 1, "Проверки").font = H2
r += 1
for t_, fml in [
    ("Изделий на план = лист 5 (1 460)", f'=IF(ABS(C{TOT7}-\'5 План 2027\'!E{TOT5})<0.5,"✓ "&TEXT(C{TOT7},"0"),"≠ проверить")'),
    ("Шкур на план = лист 5", f'=IF(ABS(D{TOT7}-\'5 План 2027\'!G{TOT5})<0.5,"✓","≠ проверить")'),
    ("Шкур на план = лист 6", f'=IF(ABS(D{TOT7}-\'6 Budget PCS 2027\'!G{TOT6})<0.5,"✓","≠ проверить")'),
    ("Остаток на конец 2026 = лист 4", f'=IF(ABS(E{TOT7}-\'4 Остаток на конец 2026\'!G{TOT4})<0.5,"✓","≠ проверить")'),
    ("Нормы владельца 01.11 учтены (лист 5)", f'=IF(COUNTIF(\'5 План 2027\'!M{HR5+1}:M{LAST5},"≠*")=0,"✓ все "&COUNTIF(\'5 План 2027\'!M{HR5+1}:M{LAST5},"✓*"),"≠ есть расхождения")'),
]:
    ws7.cell(r, 1, t_)
    put(ws7, r, 4, fml, fill=F_OK, bold=True)
    r += 1
ws7.freeze_panes = f"C{HR7+1}"

# =====================================================================
# Лист 8. Расход по ТЗ (данные)
# =====================================================================
if USAGE:
    ws8 = wb.create_sheet("8 Расход по ТЗ")
    title(ws8, "Данные: каждое списание шкур в ТЗ — вид меха, пол норки, лот, аукцион, ТЗ, артикул, партия, шкур, ₽", [
        "ТЗ без отменённых. ₽ — стоимость списания с НДС, как в ТЗ. Сумма шкур по виду меха = «Потрачено» листа 1.",
    ])
    C8 = ["Тип меха", "Пол норки", "Лот", "Год", "Аукцион", "Сорт лота", "Признаки лота", "ТЗ", "Статус ТЗ", "Артикул", "Категория", "Партия", "Изделий в ТЗ", "Шкур", "Сумма руб", "Дата списания"]
    HR8 = 4
    head(ws8, HR8, C8, [12, 12, 14, 7, 18, 34, 22, 14, 12, 12, 16, 22, 10, 9, 14, 12])
    r = HR8 + 1
    for u in USAGE:
        for c, v in enumerate([u["fur"], u["sex"], u["lot"], int(u["year"]) if u["year"].isdigit() else u["year"], u["auction"], u["grade"], u["attrs"], u["tz"], u["status"], u["article"], u["category"], u["batch"]], 1):
            put(ws8, r, c, v)
        put(ws8, r, 13, u["pcs"], INT)
        put(ws8, r, 14, u["qty"], DEC)
        put(ws8, r, 15, u["sum"], RUB)
        put(ws8, r, 16, u["date"])
        r += 1
    LAST8 = r - 1
    total_row(ws8, r, 16, [(14, DEC), (15, RUB)], first=HR8 + 1, last=LAST8)
    ws8.auto_filter.ref = f"A{HR8}:{L(len(C8))}{LAST8}"
    ws8.freeze_panes = f"C{HR8+1}"
    ws8.cell(r + 2, 1, "Проверка: шкур по листу 8 = «Потрачено» листа 1").font = NOTE
    put(ws8, r + 2, 14, f'=IF(ABS(SUM(N{HR8+1}:N{LAST8})-\'1 Лоты\'!L{LAST1+1})<0.5,"✓","≠ проверить")', fill=F_OK, bold=True)
    ws8a = wb.create_sheet("8а Сводная расход")
    title(ws8a, "Сводная по листу 8: тип меха → пол норки → артикул → ТЗ (шкур и ₽)", ["Партию, лот и аукцион можно перетащить из списка полей. После правок листа 8 — Данные → Обновить всё."])
    add_pivot(ws8a, ws8, HR8, LAST8, C8, ["Тип меха", "Пол норки", "Артикул", "ТЗ"], [("Шкур", "Шкур", 4), ("Сумма, ₽", "Сумма руб", 3)], "Сводная_расход", anchor="A3")

for ws in wb.worksheets:
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 0
wb.calculation.fullCalcOnLoad = True
wb.save(OUT)
print("сохранено:", OUT)
