#!/usr/bin/env python3
"""Excel «Сырьё: куплено, потрачено, остаток; остаток FW26; план и закупка FW27» — 7 листов, сводные и расчёт формулами.

  python3 -I scripts/build-raw-budget-xlsx.py <lots.json> <data.json> <out.xlsx>

lots.json — scripts/export-raw-lots-json.ts (лоты как на Главной, включая «Заказано, не получено» и шкуры подрядчика);
data.json — scripts/export-raw-budget-data.ts (прогноз по артикулам остатка FW26, склад, цены, бюджет FW27, Budget PCS).
Жёлтые ячейки — ввод: меняете — пересчитываются сводные и закупка.
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
USAGE = json.load(open(sys.argv[4], encoding="utf-8")) if len(sys.argv) > 4 else []  # списания норки по ТЗ (scripts/export-mink-usage-json.ts)
HERE = os.path.dirname(os.path.abspath(__file__))
OWNER = json.load(open(os.path.join(HERE, "fw27-owner-plan-2026-11-01.json"), encoding="utf-8"))  # решения владельца 01.11: запас, доли норки, пол, комментарии
SEX = json.load(open(os.path.join(HERE, "..", "src", "lib", "data", "mink-lot-sex.json"), encoding="utf-8"))  # пол шкур норки по лотам (общий с приложением)

NAME = {"Свакара": "Каракульча"}  # как в бюджете и Budget PCS
FUR_ORDER = ["Соболь", "Норка", "Каракульча", "Лиса", "Рысь"]
fur_of = lambda f: NAME.get(f, f)

# ---------- стиль ----------
INK = "1F2933"
F_HEAD = PatternFill("solid", fgColor="E8ECF1")
F_FUR = PatternFill("solid", fgColor="D9E2EC")
F_GRP = PatternFill("solid", fgColor="EEF2F6")
F_TOT = PatternFill("solid", fgColor="BCCCDC")
F_IN = PatternFill("solid", fgColor="FFF3BF")
thin = Side(style="thin", color="C7CED6")
B = Border(left=thin, right=thin, top=thin, bottom=thin)
BOLD = Font(bold=True, color=INK)
TITLE = Font(bold=True, size=14, color=INK)
NOTE = Font(italic=True, size=9, color="52606D")
INT, RUB, USD, PCT, DEC = '#,##0;-#,##0;"–"', '#,##0" ₽";-#,##0" ₽";"–"', '#,##0.00" $";-#,##0.00" $";"–"', '0%', '#,##0.0;-#,##0.0;"–"'
WRAP = Alignment(wrap_text=True, vertical="top")


def head(ws, row, cols, widths=None):
    for i, c in enumerate(cols, 1):
        x = ws.cell(row, i, c)
        x.font, x.fill, x.border, x.alignment = BOLD, F_HEAD, B, Alignment(wrap_text=True, vertical="center", horizontal="center")
    ws.row_dimensions[row].height = 42
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


wb = Workbook()

# =====================================================================
# Лист 1. Лоты
# =====================================================================
ws1 = wb.active
ws1.title = "1 Лоты"
title(ws1, "Всё купленное сырьё по лотам", [
    f"Данные на {data['asOf']} (МСК). Как на Главной: лоты склада + «Заказано, не получено» + шкуры подрядчика. Суммы в ₽ — с НДС.",
    "Цена $ — цена молотка за шкуру на аукционе (там, где она есть в документах); средневзвешенная по количеству. Подкладка и прочие материалы в лист не входят.",
    "Пол норки — признак лота «Самец» / «Самка» (Настройки → Признаки меха); «Признаки» — все признаки лота из справочника.",
])
C1 = ["Тип меха", "Год", "Аукцион", "Источник", "Лот", "Сорт", "Цвет",
      "Куплено шк", "Ср цена USD", "Ср цена руб", "Куплено руб",
      "Потрачено шк", "Потрачено руб", "Остаток шк", "Остаток руб",
      "Куплено шк с USD", "Куплено USD", "Потрачено шк с USD", "Потрачено USD", "Остаток шк с USD", "Остаток USD", "Пол норки", "Пол: откуда", "Признаки"]
HR1 = 5
head(ws1, HR1, C1, [12, 7, 20, 20, 16, 34, 14, 10, 11, 12, 15, 10, 15, 10, 15, 10, 13, 10, 13, 10, 13, 9, 50, 30])
rows = sorted(lots, key=lambda r: (FUR_ORDER.index(fur_of(r["item"])) if fur_of(r["item"]) in FUR_ORDER else 99, r["item"], r["year"], r["auction"], r["lot"]))
r = HR1 + 1
for x in rows:
    put(ws1, r, 1, fur_of(x["item"]))
    put(ws1, r, 2, int(x["year"]) if str(x["year"]).isdigit() else x["year"])
    put(ws1, r, 3, x["auction"])
    put(ws1, r, 4, x["src"])
    put(ws1, r, 5, x["lot"])
    put(ws1, r, 6, x["grade"])
    put(ws1, r, 7, x["color"])
    put(ws1, r, 8, x["recv"], INT)
    put(ws1, r, 9, f"=IFERROR(Q{r}/P{r},0)", USD)
    put(ws1, r, 10, f"=IFERROR(K{r}/H{r},0)", RUB)
    put(ws1, r, 11, x["recvIn"], RUB)
    put(ws1, r, 12, x["used"], INT)
    put(ws1, r, 13, x["usedIn"], RUB)
    put(ws1, r, 14, x["rem"], INT)
    put(ws1, r, 15, x["remIn"], RUB)
    put(ws1, r, 16, x["usdQty"], INT)
    put(ws1, r, 17, x["usdSub"], USD)
    put(ws1, r, 18, x["usdUQty"], INT)
    put(ws1, r, 19, x["usdUSub"], USD)
    put(ws1, r, 20, x["usdRQty"], INT)
    put(ws1, r, 21, x["usdRSub"], USD)
    if fur_of(x["item"]) == "Норка":
        sx = SEX.get(x["lot"]) or (["?", "заказано, не получено: пол не указан"] if x["lot"] == "Заказано, не получено" else ["?", "нет в списке src/lib/data/mink-lot-sex.json"])
        put(ws1, r, 22, sx[0])
        put(ws1, r, 23, sx[1])
    else:
        put(ws1, r, 22, "—")
        put(ws1, r, 23, None)
    put(ws1, r, 24, x.get("attrs") or "—")
    r += 1
LAST1 = r - 1
put(ws1, r, 1, "ИТОГО", fill=F_TOT, bold=True)
for c in [2, 3, 4, 5, 6, 7, 22, 23, 24]:
    put(ws1, r, c, None, fill=F_TOT)
for c in [8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]:
    put(ws1, r, c, f"=SUBTOTAL(9,{L(c)}{HR1+1}:{L(c)}{LAST1})", ws1.cell(LAST1, c).number_format, F_TOT, True)
put(ws1, r, 9, f"=IFERROR(Q{r}/P{r},0)", USD, F_TOT, True)
put(ws1, r, 10, f"=IFERROR(K{r}/H{r},0)", RUB, F_TOT, True)
ws1.auto_filter.ref = f"A{HR1}:{L(len(C1))}{LAST1}"
ws1.freeze_panes = f"H{HR1+1}"
LOT = lambda col: f"'1 Лоты'!${col}${HR1+1}:${col}${LAST1}"

# =====================================================================
# Лист 2. Сводная: тип меха → год
# =====================================================================
ws2 = wb.create_sheet("2 Сводная сырьё")
title(ws2, "Сводная (pivot) по листу «1 Лоты»: тип меха → год — куплено, потрачено, остаток", [
    "Настоящая сводная таблица Excel: поля можно перетаскивать (Анализ сводной таблицы → Список полей). После правок листа 1 — Данные → Обновить всё.",
])
add_pivot(ws2, ws1, HR1, LAST1, C1, ["Тип меха", "Год"], [
    ("Куплено, шк.", "Куплено шк", 3), ("Куплено, ср. $", "Ср USD куплено", 4), ("Куплено, ср. ₽", "Ср руб куплено", 3), ("Куплено, ₽", "Куплено руб", 3),
    ("Потрачено, шк.", "Потрачено шк", 3), ("Потрачено, ср. $", "Ср USD потрачено", 4), ("Потрачено, ср. ₽", "Ср руб потрачено", 3), ("Потрачено, ₽", "Потрачено руб", 3),
    ("Остаток, шк.", "Остаток шк", 3), ("Остаток, ср. $", "Ср USD остаток", 4), ("Остаток, ср. ₽", "Ср руб остаток", 3), ("Остаток, ₽", "Остаток руб", 3),
], "Сводная_сырьё", calc=[
    ("Ср USD куплено", "=IFERROR('Куплено USD'/'Куплено шк с USD',0)"), ("Ср руб куплено", "=IFERROR('Куплено руб'/'Куплено шк',0)"),
    ("Ср USD потрачено", "=IFERROR('Потрачено USD'/'Потрачено шк с USD',0)"), ("Ср руб потрачено", "=IFERROR('Потрачено руб'/'Потрачено шк',0)"),
    ("Ср USD остаток", "=IFERROR('Остаток USD'/'Остаток шк с USD',0)"), ("Ср руб остаток", "=IFERROR('Остаток руб'/'Остаток шк',0)"),
], anchor="A4")
furs_all = []
for x in rows:
    f = fur_of(x["item"])
    if f not in furs_all:
        furs_all.append(f)

# =====================================================================
# Лист 3. Артикулы остатка FW26 в производстве
# =====================================================================
ws3 = wb.create_sheet("3 Артикулы FW26")
title(ws3, "Данные: непроизведённые изделия заказа FW26 — расход сырья и затраты по каждому артикулу", [
    "Не произведено = объём ТЗ модели − получено в рознице (как в приложении, «Сырьё на остаток FW26»): по ТЗ, отмеченным завершёнными, + в работе.",
    "Шкуры по ТЗ, отмеченным завершёнными, и уже выданные в работу — со склада списаны; «Ещё уйдёт со склада» = в работе × шкур на изд. − выдано.",
    "Расход на изделие — из ТЗ этой модели; нет своих ТЗ — по категории того же меха или аналогу (столбец «Источник»). Жёлтые ячейки можно менять.",
])
C3 = ["Артикул", "Блок", "Категория", "Тип меха", "Не произведено шт", "По завершенным ТЗ шт", "В работе шт", "Шкур на изд", "Шкур всего",
      "Выдано в работу шк", "Еще уйдет со склада шк", "Уже списано шк", "Цена шкуры руб", "Сырье руб", "Подкладка м на изд", "Подкладка м",
      "Цена м руб", "Подкладка руб", "Работа руб на изд", "Работа руб", "Надбавка 4 руб", "Итого руб", "Источник"]
HR3 = 6
head(ws3, HR3, C3, [18, 12, 18, 14, 11, 11, 10, 9, 10, 10, 11, 10, 11, 14, 9, 9, 10, 12, 12, 14, 11, 15, 46])
fc = sorted(data["forecast"], key=lambda l: (l["cls"], l["cat2"], l["acode"]))
r = HR3 + 1
for l in fc:
    f = l["fur"] if " + " in l["fur"] else fur_of(l["fur"])
    vals = [l["acode"], l["cls"], l["cat2"], f, l["left"]]
    for c, v in enumerate(vals, 1):
        put(ws3, r, c, v, INT if c == 5 else None)
    put(ws3, r, 6, round(l.get("produced") or 0, 2), INT)
    put(ws3, r, 7, round(l.get("inWork") or 0, 2), INT)
    inp(ws3, r, 8, round(l["hp"], 2) if l["hp"] else None, DEC)
    put(ws3, r, 9, f"=E{r}*H{r}", DEC)
    put(ws3, r, 10, round(l.get("issued") or 0, 2), DEC)
    put(ws3, r, 11, f"=MAX(0,G{r}*H{r}-J{r})", DEC)
    put(ws3, r, 12, f"=I{r}-K{r}", DEC)
    pr = l["hidePrice"] or data["price"].get(f)
    inp(ws3, r, 13, round(pr) if pr else None, RUB)
    put(ws3, r, 14, f"=I{r}*M{r}", RUB)
    inp(ws3, r, 15, round(l["mp"], 2) if l["mp"] else 0, DEC)
    put(ws3, r, 16, f"=E{r}*O{r}", DEC)
    inp(ws3, r, 17, round(l["meterPrice"]) if l["meterPrice"] else 0, RUB)
    put(ws3, r, 18, f"=P{r}*Q{r}", RUB)
    inp(ws3, r, 19, round(l["wp"]) if l["wp"] else None, RUB)
    put(ws3, r, 20, f"=E{r}*S{r}", RUB)
    put(ws3, r, 21, f"=(N{r}+R{r})*0.04", RUB)
    put(ws3, r, 22, f"=N{r}+R{r}+T{r}+U{r}", RUB)
    src = l["source"] + (f" · {l['sourceNote']}" if l.get("sourceNote") else "") + (f" · работа: {l['wpEst']}" if l.get("wpEst") else "")
    put(ws3, r, 23, src)
    r += 1
LAST3 = r - 1
r += 1
put(ws3, r, 1, "ИТОГО", fill=F_TOT, bold=True)
for c in range(2, 24):
    put(ws3, r, c, None, fill=F_TOT)
for c in [5, 6, 7, 9, 10, 11, 12, 14, 16, 18, 20, 21, 22]:
    put(ws3, r, c, f"=SUM({L(c)}{HR3+1}:{L(c)}{LAST3})", ws3.cell(LAST3, c).number_format, F_TOT, True)
ws3.freeze_panes = f"B{HR3+1}"
ART = lambda col: f"'3 Артикулы FW26'!${col}${HR3+1}:${col}${LAST3}"

ws3a = wb.create_sheet("3а Сводная артикулы")
title(ws3a, "Сводная (pivot) по листу 3: блок → категория → тип меха", ["После правок жёлтых ячеек листа 3 — Данные → Обновить всё."])
add_pivot(ws3a, ws3, HR3, LAST3, C3, ["Блок", "Категория", "Тип меха"], [
    ("Не произведено, шт.", "Не произведено шт", 3), ("Шкур всего", "Шкур всего", 3), ("Уже списано, шк.", "Уже списано шк", 3),
    ("Ещё уйдёт со склада, шк.", "Еще уйдет со склада шк", 3), ("Сырьё, ₽", "Сырье руб", 3), ("Подкладка, ₽", "Подкладка руб", 3),
    ("Работа, ₽", "Работа руб", 3), ("Надбавка 4 %, ₽", "Надбавка 4 руб", 3), ("Итого, ₽", "Итого руб", 3),
], "Сводная_артикулы", anchor="A3")

# =====================================================================
# Лист 4. Сводная: что уйдёт на остаток FW26 и что останется
# =====================================================================
ws4 = wb.create_sheet("4 Остаток FW26")
title(ws4, "Отчёт: сырьё на складе, сколько ещё уйдёт на непроизведённые изделия FW26 и что останется", [
    "Склад — остаток по лотам (лист 1, с заказанным, но не полученным). «Уйдёт со склада» — с листа 3 (без шкур, уже списанных по ТЗ). «Норка + Соболь» делится по доле норки (жёлтые ячейки).",
])
ws4["A4"], ws4["A5"] = "Доля норки в «Норка + Соболь», одежда", "Доля норки в «Норка + Соболь», аксессуары"
for a_ in ("A4", "A5"):
    ws4[a_].font = BOLD
inp(ws4, 4, 3, round(data["mix"]["RTW"], 4), PCT)
inp(ws4, 5, 3, round(data["mix"]["Acc"], 4), PCT)
MIX_RTW, MIX_ACC = "'4 Остаток FW26'!$C$4", "'4 Остаток FW26'!$C$5"
C4 = ["Тип меха", "На складе, шк.", "Склад, ₽", "Ещё уйдёт со склада, шк.", "из них одежда", "из них аксессуары",
      "Шкур на непроизведённые всего", "из них уже списано по ТЗ", "Затраты на непроизведённые, ₽", "Останется после производства, шк.", "Останется, ₽ (ср. цена склада)", "Не хватает, шк."]
HR4 = 7
head(ws4, HR4, C4, [32, 12, 15, 13, 11, 11, 14, 13, 16, 14, 16, 11])


def by_fur(col, fur, blk=None):
    cond = f',{ART("B")},"{blk}"' if blk else ""
    own = f'SUMIFS({ART(col)},{ART("D")},"{fur}"{cond})'
    if fur not in ("Норка", "Соболь"):
        return own
    sh = lambda b_, mix: f'SUMIFS({ART(col)},{ART("D")},"Норка + Соболь",{ART("B")},"{b_}")*{mix if fur == "Норка" else "(1-" + mix + ")"}'
    parts = [p_ for p_ in (("Одежда", MIX_RTW), ("Аксессуары", MIX_ACC)) if blk in (None, p_[0])]
    return own + "".join("+" + sh(b_, m_) for b_, m_ in parts)


r = HR4 + 1
rows4 = []
for f in furs_all:
    put(ws4, r, 1, f, bold=f in FUR_ORDER)
    put(ws4, r, 2, f'=SUMIFS({LOT("N")},{LOT("A")},A{r})', INT)
    put(ws4, r, 3, f'=SUMIFS({LOT("O")},{LOT("A")},A{r})', RUB)
    put(ws4, r, 4, f"={by_fur('K', f)}", INT)
    put(ws4, r, 5, f"={by_fur('K', f, 'Одежда')}", INT)
    put(ws4, r, 6, f"={by_fur('K', f, 'Аксессуары')}", INT)
    put(ws4, r, 7, f"={by_fur('I', f)}", INT)
    put(ws4, r, 8, f"={by_fur('L', f)}", INT)
    put(ws4, r, 9, f"={by_fur('V', f)}", RUB)
    put(ws4, r, 10, f"=MAX(0,B{r}-D{r})", INT)
    put(ws4, r, 11, f"=IFERROR(J{r}*C{r}/B{r},0)", RUB)
    put(ws4, r, 12, f"=MAX(0,D{r}-B{r})", INT)
    rows4.append(r)
    r += 1
put(ws4, r, 1, "ВСЕГО", fill=F_TOT, bold=True)
for c, fmt in zip(range(2, 13), [INT, RUB, INT, INT, INT, INT, INT, RUB, INT, RUB, INT]):
    put(ws4, r, c, f"=SUM({L(c)}{HR4+1}:{L(c)}{r-1})", fmt, F_TOT, True)
TOT4 = r
ws4.cell(r + 2, 1, "Проверка: по листу 3 — шкур всего, ещё уйдёт со склада, затраты").font = NOTE
put(ws4, r + 2, 7, f"=SUM({ART('I')})", INT)
put(ws4, r + 2, 4, f"=SUM({ART('K')})", INT)
put(ws4, r + 2, 9, f"=SUM({ART('V')})", RUB)
ws4.freeze_panes = f"B{HR4+1}"
LEFT_ROW = {f: x for f, x in zip(furs_all, rows4)}

# =====================================================================
# Лист 5. План 2027: что хотим произвести
# =====================================================================
ws5 = wb.create_sheet("5 План 2027")
title(ws5, "План производства 2027 (бюджет FW27): категории, тип меха, длина, количество и расход меха", [
    "Одежда — как в бюджете (RTW от 19.10). Аксессуары — новые количества по файлу MVST W FURS ACC от 27.10 (905 шт.).",
    "Шкур на изделие — из бюджета FW27 (статистика ТЗ по категории и длине; курсивом — примерная оценка по аналогам). Нормы с комментариями владельца от 01.11 внесены в бюджет вручную.",
    "«Норка+Соболь»: шкуры делятся по доле норки строки (жёлтая ячейка). Пол норки: M — самцы, F — самки, любой — без требования (используется на листе 7).",
])
C5 = ["Тип меха", "Блок", "Категория", "Длина", "Кол-во шт", "Шкур на изд", "Шкур всего", "Подкладка м на изд", "Подкладка м", "Оценка / комментарий владельца",
      "Доля норки", "Шкур норки", "Шкур соболя", "Пол норки"]
HR5 = 5
head(ws5, HR5, C5, [14, 13, 24, 10, 10, 11, 11, 11, 12, 60, 9, 10, 10, 9])
FO = ["Соболь", "Норка", "Норка+Соболь", "Лиса", "Каракульча", "Рысь"]
bud = sorted(data["budget"], key=lambda b: (FO.index(b["fur"]) if b["fur"] in FO else 99, 0 if b["group"] == "Одежда" else 1, b["cat"], ["Short", "Regular", "Long", ""].index(b["len"]) if b["len"] in ["Short", "Regular", "Long", ""] else 9))
r = HR5 + 1
for b in bud:
    put(ws5, r, 1, b["fur"])
    put(ws5, r, 2, b["group"])
    put(ws5, r, 3, b["cat"])
    put(ws5, r, 4, b["len"] or "—")
    inp(ws5, r, 5, b["pcs"], INT)
    inp(ws5, r, 6, round(b["hides"], 2), DEC)
    put(ws5, r, 7, f"=E{r}*F{r}", INT)
    put(ws5, r, 8, round(b["meters"] or 0, 2), DEC)
    put(ws5, r, 9, f"=E{r}*H{r}", DEC)
    key = f'{b["fur"]}|{b["cat"]}|{b["len"]}'
    note = OWNER["comments"].get(key)
    put(ws5, r, 10, " · ".join(x for x in [b["est"], note] if x) or "").alignment = WRAP
    if b["est"]:
        ws5.cell(r, 6).font = Font(italic=True, bold=True, color="7C5E10")
    share = {"Норка": 1, "Соболь": 0}.get(b["fur"])
    if b["fur"] == "Норка+Соболь":
        share = OWNER["minkShare"].get(f'{b["cat"]}|{b["len"]}')
        if share is None:
            share = data["mix"]["RTW" if b["group"] == "Одежда" else "Acc"]
            put(ws5, r, 10, (ws5.cell(r, 10).value + " · " if ws5.cell(r, 10).value else "") + "доля норки — как в прошлых ТЗ «Норка + Соболь»").alignment = WRAP
        inp(ws5, r, 11, round(share, 4), PCT)
    else:
        put(ws5, r, 11, share, PCT)
    put(ws5, r, 12, f"=G{r}*K{r}" if share is not None else 0, INT)
    put(ws5, r, 13, f"=G{r}*(1-K{r})" if share is not None else 0, INT)
    if b["fur"] in ("Норка", "Норка+Соболь"):
        inp(ws5, r, 14, OWNER["minkSex"].get(key, "любой"))
    else:
        put(ws5, r, 14, "—")
    r += 1
LAST5 = r - 1
put(ws5, r, 1, "ИТОГО", fill=F_TOT, bold=True)
for c in range(2, 15):
    put(ws5, r, c, None, fill=F_TOT)
for c in [5, 7, 9, 12, 13]:
    put(ws5, r, c, f"=SUBTOTAL(9,{L(c)}{HR5+1}:{L(c)}{LAST5})", ws5.cell(LAST5, c).number_format, F_TOT, True)
put(ws5, r, 6, f"=IFERROR(G{r}/E{r},0)", DEC, F_TOT, True)
ws5.auto_filter.ref = f"A{HR5}:{L(len(C5))}{LAST5}"
ws5.freeze_panes = f"E{HR5+1}"
P5 = lambda col: f"'5 План 2027'!${col}${HR5+1}:${col}${LAST5}"

ws5a = wb.create_sheet("5а Сводная план 2027")
title(ws5a, "Сводная (pivot) по листу 5: тип меха → блок → категория → длина", ["После правок количества или расхода на листе 5 — Данные → Обновить всё."])
add_pivot(ws5a, ws5, HR5, LAST5, C5, ["Тип меха", "Блок", "Категория", "Длина"], [
    ("Кол-во, шт.", "Кол-во шт", 3), ("Шкур всего", "Шкур всего", 3), ("Шкур на изделие", "Ср шкур", 4), ("Подкладка, м", "Подкладка м", 4),
], "Сводная_план_2027", calc=[("Ср шкур", "=IFERROR('Шкур всего'/'Кол-во шт',0)")], anchor="A3")

# =====================================================================
# Лист 6. Budget PCS 2027: деньги на сырьё
# =====================================================================
ws6 = wb.create_sheet("6 Budget PCS 2027")
title(ws6, "MVST · Budget PCS 2027: сколько сырья и денег на весь сезон (без учёта остатков)", [
    "Количество и шкур на изделие — с листа 5. Ср. цена шкуры — из бюджета FW27 по категории (средневзвешенная по ТЗ); рост цены задаётся сверху.",
])
ws6["A4"] = "Рост цены шкуры, %"
ws6["A4"].font = BOLD
inp(ws6, 4, 3, 0.10, PCT)
UP = "'6 Budget PCS 2027'!$C$4"
C6 = ["Уровень", "Тип меха", "Категория 1", "Категория 2", "Длина", "Кол-во, шт.", "Ср. шкур на изд.", "Шкур всего", "Ср. цена шкуры, ₽", "Цена с ростом, ₽", "На сырьё, ₽"]
HR6 = 6
head(ws6, HR6, C6, [11, 14, 13, 24, 10, 10, 11, 11, 13, 13, 16])
# листья
r = HR6 + 1
leaf_first = r
for i, b in enumerate(bud):
    src = HR5 + 1 + i  # строка листа 5
    put(ws6, r, 1, "строка")
    put(ws6, r, 2, b["fur"])
    put(ws6, r, 3, b["group"])
    put(ws6, r, 4, b["cat"])
    put(ws6, r, 5, b["len"] or "—")
    put(ws6, r, 6, f"='5 План 2027'!E{src}", INT)
    put(ws6, r, 7, f"='5 План 2027'!F{src}", DEC)
    put(ws6, r, 8, f"=F{r}*G{r}", INT)
    inp(ws6, r, 9, round(b["hidePrice"] or 0), RUB)
    put(ws6, r, 10, f"=I{r}*(1+{UP})", RUB)
    put(ws6, r, 11, f"=H{r}*J{r}", RUB)
    r += 1
leaf_last = r - 1
P6 = lambda col: f"'6 Budget PCS 2027'!${col}${leaf_first}:${col}${leaf_last}"
r += 1
ws6.cell(r, 1, "Сводная как в отчёте MVST: TOTAL → тип меха → категория 1 → категория 2").font = BOLD
r += 1
head(ws6, r, C6)
r += 1


def agg_row(r, level, crit, labels, fill=None):
    put(ws6, r, 1, level, fill=fill, bold=bool(fill))
    for c, v in zip([2, 3, 4, 5], labels):
        put(ws6, r, c, v, fill=fill, bold=bool(fill))
    sf = lambda col: f"SUMIFS({P6(col)},{crit})" if crit else f"SUM({P6(col)})"
    put(ws6, r, 6, f"={sf('F')}", INT, fill, bool(fill))
    put(ws6, r, 8, f"={sf('H')}", INT, fill, bool(fill))
    put(ws6, r, 11, f"={sf('K')}", RUB, fill, bool(fill))
    put(ws6, r, 7, f"=IFERROR(H{r}/F{r},0)", DEC, fill, bool(fill))
    put(ws6, r, 10, f"=IFERROR(K{r}/H{r},0)", RUB, fill, bool(fill))
    put(ws6, r, 9, f"=IFERROR(J{r}/(1+{UP}),0)", RUB, fill, bool(fill))


agg_row(r, "TOTAL", None, ["Все", "", "", ""], F_TOT)
TOT6 = r
r += 1
for f in FO:
    if not any(b["fur"] == f for b in bud):
        continue
    agg_row(r, "тип меха", f'{P6("B")},"{f}"', [f, "", "", ""], F_FUR)
    r += 1
    for g in ["Одежда", "Аксессуары"]:
        cats = []
        for b in bud:
            if b["fur"] == f and b["group"] == g and b["cat"] not in cats:
                cats.append(b["cat"])
        if not cats:
            continue
        agg_row(r, "категория 1", f'{P6("B")},"{f}",{P6("C")},"{g}"', [f, g, "", ""], F_GRP)
        r += 1
        for c in cats:
            agg_row(r, "категория 2", f'{P6("B")},"{f}",{P6("C")},"{g}",{P6("D")},"{c}"', [f, g, c, ""])
            r += 1
ws6.freeze_panes = f"F{HR6+1}"

# =====================================================================
# Лист 7. Расчёт закупки с остатками и запасом
# =====================================================================
ws7 = wb.create_sheet("7 Расчёт закупки")
title(ws7, "Сколько сырья докупить на план 2027 с учётом остатка после FW26, качества остатка и запаса", [
    "Порядок: остаток после производства FW26 (лист 4) × годная доля = можно использовать; годное делится: аксессуарам — их доля, одежде — остальное (лучшая часть).",
    "Нужно из новой покупки = шкур на план (лист 6) − можно использовать. Закупить = нужно ÷ (1 − желаемый остаток): после всего заказа 2027 остаётся этот % от купленного (владелец 01.11: соболь, норка, каракульча 30 %, лиса 20 %, рысь 15 %).",
    "Сверху — значения по умолчанию; в таблице «Параметры по типам меха» их можно переопределить для каждого типа (жёлтые ячейки).",
])
G = {}
params = [("Годная доля остатка, %", 0.70, "g_use"), ("Годная доля остатка, рысь, %", 0.85, "g_use_lynx"), ("Из годного остатка — в аксессуары, %", 0.75, "g_acc")]
for i, (t, v, k) in enumerate(params):
    rr = 6 + i
    ws7.cell(rr, 1, t).font = BOLD
    inp(ws7, rr, 4, v, PCT)
    G[k] = f"$D${rr}"
ws7.cell(11, 1, "Рост цены шкуры, %").font = BOLD
put(ws7, 11, 4, f"={UP}", PCT)
ws7.cell(11, 5, "← задаётся на листе 6").font = NOTE
G["up"] = "$D$11"
# параметры по типам меха
r = 13
ws7.cell(r, 1, "Параметры по типам меха (можно менять каждый)").font = BOLD
r += 1
head(ws7, r, ["Тип меха", "Годная доля остатка", "В аксессуары из годного", "Желаемый остаток после заказа 2027, % от закупки", "Ср. цена шкуры, ₽ (база)"])
r += 1
PR = {}
for f in FUR_ORDER:
    put(ws7, r, 1, f, bold=True)
    lynx = f == "Рысь"
    inp(ws7, r, 2, f"={G['g_use_lynx'] if lynx else G['g_use']}", PCT)
    if lynx:
        put(ws7, r, 3, "по потребности")
    else:
        inp(ws7, r, 3, f"={G['g_acc']}", PCT)
    inp(ws7, r, 4, OWNER["reserve"][f], PCT)
    inp(ws7, r, 5, round(data["price"].get(f, 0)), RUB)
    PR[f] = r
    r += 1
r += 1
C7 = ["Тип меха", "Блок", "Изделий на план, шт.", "Шкур на план (TTL)", "Шкур на изделие", "Остаток после FW26, шк.", "Годная доля", "Можно использовать, шк.",
      "Нужно из новой покупки, шк.", "Желаемый остаток", "Закупить с запасом, шк.", "Останется после 2027 (запас), шк.", "Ср. цена шкуры, ₽", "Цена с ростом, ₽", "На закупку, ₽"]
HR7 = r
head(ws7, HR7, C7, [34, 12, 12, 12, 10, 13, 9, 13, 13, 8, 13, 13, 12, 12, 16])
r += 1


def ttl6(fur, blk):
    # норка и соболь — по столбцам «Шкур норки» / «Шкур соболя» листа 5 (там же доля норки каждой строки «Норка+Соболь»)
    if fur == "Норка":
        return f'SUMIFS({P5("L")},{P5("B")},"{blk}")'
    if fur == "Соболь":
        return f'SUMIFS({P5("M")},{P5("B")},"{blk}")'
    return f'SUMIFS({P6("H")},{P6("B")},"{fur}",{P6("C")},"{blk}")'


def pcs6(fur, blk):
    return f'SUMIFS({P6("F")},{P6("B")},"{fur}",{P6("C")},"{blk}")'


tot_rows = []
for f in FUR_ORDER:
    p = PR[f]
    lr = LEFT_ROW.get(f)
    left_total = f"'4 Остаток FW26'!J{lr}" if lr else "0"
    short_total = f"'4 Остаток FW26'!L{lr}" if lr else "0"
    first = r
    for blk in ["Одежда", "Аксессуары"]:
        put(ws7, r, 1, f, bold=True)
        put(ws7, r, 2, blk)
        put(ws7, r, 3, f"={pcs6(f, blk)}", INT)
        put(ws7, r, 4, f"={ttl6(f, blk)}", INT)
        put(ws7, r, 5, f"=IFERROR(D{r}/C{r},0)", DEC)
        if f == "Рысь":
            share = f"IFERROR(D{r}/({ttl6(f, 'Одежда')}+{ttl6(f, 'Аксессуары')}),0.5)"
        else:
            share = f"$C${p}" if blk == "Аксессуары" else f"(1-$C${p})"
        put(ws7, r, 6, f"={left_total}*{share}", INT)
        put(ws7, r, 7, f"=$B${p}", PCT)
        put(ws7, r, 8, f"=F{r}*G{r}", INT)
        put(ws7, r, 9, f"=MAX(0,D{r}-H{r})+{short_total}*{share}", INT)
        put(ws7, r, 10, f"=$D${p}", PCT)
        put(ws7, r, 11, f"=IFERROR(I{r}/(1-J{r}),0)", INT)
        put(ws7, r, 12, f"=K{r}-I{r}+MAX(0,H{r}-D{r})", INT)
        put(ws7, r, 13, f"=$E${p}", RUB)
        put(ws7, r, 14, f"=M{r}*(1+{G['up']})", RUB)
        put(ws7, r, 15, f"=K{r}*N{r}", RUB)
        r += 1
    put(ws7, r, 1, f"{f} — итого", fill=F_FUR, bold=True)
    put(ws7, r, 2, "", fill=F_FUR)
    for c, fmt in [(3, INT), (4, INT), (6, INT), (8, INT), (9, INT), (11, INT), (12, INT), (15, RUB)]:
        put(ws7, r, c, f"=SUM({L(c)}{first}:{L(c)}{r-1})", fmt, F_FUR, True)
    put(ws7, r, 5, f"=IFERROR(D{r}/C{r},0)", DEC, F_FUR, True)
    for c in (7, 10, 13):
        put(ws7, r, c, None, fill=F_FUR)
    put(ws7, r, 14, f"=IFERROR(O{r}/K{r},0)", RUB, F_FUR, True)
    tot_rows.append(r)
    r += 1
put(ws7, r, 1, "ВСЕГО (норка и соболь включают свою долю «Норка + Соболь»)", fill=F_TOT, bold=True)
put(ws7, r, 2, "", fill=F_TOT)
for c, fmt in [(3, INT), (4, INT), (6, INT), (8, INT), (9, INT), (11, INT), (12, INT), (15, RUB)]:
    put(ws7, r, c, "=" + "+".join(f"{L(c)}{x}" for x in tot_rows), fmt, F_TOT, True)
put(ws7, r, 14, f"=IFERROR(O{r}/K{r},0)", RUB, F_TOT, True)
for c in (5, 7, 10, 13):
    put(ws7, r, c, None, fill=F_TOT)
put(ws7, r, 5, f"=IFERROR(D{r}/C{r},0)", DEC, F_TOT, True)
TOT7 = r
r += 1
ws7.cell(r, 1, "«Изделий на план» у норки и соболя не включает изделия «Норка + Соболь» (их шкуры — включены). Изделий «Норка + Соболь»:").font = NOTE
put(ws7, r, 3, f'=SUMIFS({P6("F")},{P6("B")},"Норка+Соболь")', INT)
r += 2

# ---------- Норка по полу: самцы (M) и самки (F) ----------
ws7.cell(r, 1, "Норка по полу: хватит ли самцов и самок").font = TITLE
r += 1
for n_ in [
    "Склад — по лотам листа 1 (столбец «Пол норки»: из названия лота и реестров закупок). Расход на остаток FW26 делится по полу пропорционально складу (пол в ТЗ FW26 не указан).",
    "Нужно — столбцы «Шкур норки» и «Пол норки» листа 5: короткие шубы — самцы, длинные — самки (владелец 01.11). Остальным изделиям пол не важен: им идут лоты без пола и лишние самцы/самки.",
]:
    ws7.cell(r, 1, n_).font = NOTE
    r += 1
head(ws7, r, ["Пол", "На складе сейчас, шк.", "Доля склада", "Останется после FW26, шк.", "Годное, шк.", "Нужно на план 2027, шк.",
              "Не хватает, шк.", "Лишнее, шк.", "Закупить с запасом, шк."])
r += 1
pm = PR["Норка"]
mink_left = f"'4 Остаток FW26'!J{LEFT_ROW['Норка']}" if "Норка" in LEFT_ROW else "0"
SXR = {}
first_sx = r
for code, label in [("M", "Самцы (M)"), ("F", "Самки (F)"), ("?", "Пол не указан / пол не важен")]:
    SXR[code] = r
    put(ws7, r, 1, label, bold=True)
    put(ws7, r, 2, f'=SUMIFS({LOT("N")},{LOT("A")},"Норка",{LOT("V")},"{code}")', INT)
    r += 1
last_sx = r - 1
for code, rr in SXR.items():
    put(ws7, rr, 3, f"=IFERROR(B{rr}/SUM(B{first_sx}:B{last_sx}),0)", PCT)
    put(ws7, rr, 4, f"={mink_left}*C{rr}", INT)
    put(ws7, rr, 5, f"=D{rr}*$B${pm}", INT)
    need_code = "любой" if code == "?" else code
    put(ws7, rr, 6, f'=SUMIFS({P5("L")},{P5("N")},"{need_code}")', INT)
    if code == "?":
        avail = f"E{rr}+H{SXR['M']}+H{SXR['F']}"
        put(ws7, rr, 7, f"=MAX(0,F{rr}-({avail}))", INT)
        put(ws7, rr, 8, f"=MAX(0,({avail})-F{rr})", INT)
    else:
        put(ws7, rr, 7, f"=MAX(0,F{rr}-E{rr})", INT)
        put(ws7, rr, 8, f"=MAX(0,E{rr}-F{rr})", INT)
    put(ws7, rr, 9, f"=IFERROR(G{rr}/(1-$D${pm}),0)", INT)
put(ws7, r, 1, "Норка — итого", fill=F_FUR, bold=True)
for c, fmt in [(2, INT), (4, INT), (5, INT), (6, INT), (9, INT)]:
    put(ws7, r, c, f"=SUM({L(c)}{first_sx}:{L(c)}{last_sx})", fmt, F_FUR, True)
for c in (3, 7, 8):
    put(ws7, r, c, None, fill=F_FUR)
r += 1
mink_tot7 = tot_rows[FUR_ORDER.index("Норка")]
ws7.cell(r, 1, "Для сравнения: закупка норки по блокам (таблица выше), шк.").font = NOTE
put(ws7, r, 9, f"=K{mink_tot7}", INT)
r += 1
ws7.cell(r, 1, "Расчёт по полу точнее для шуб, по блокам — для деления остатка между одеждой и аксессуарами; закупать норки — по большему из двух, самцов и самок — не меньше, чем в строках M и F.").font = NOTE
r += 2
ws7.cell(r, 1, "Кратко").font = TITLE
r += 1
for t, fml, fmt in [
    ("Сырьё на складе сейчас, шк. (лист 4)", f"='4 Остаток FW26'!B{TOT4}", INT),
    ("Уйдёт на остаток заказа FW26, шк.", f"='4 Остаток FW26'!D{TOT4}", INT),
    ("Останется после FW26, шк.", f"='4 Остаток FW26'!J{TOT4}", INT),
    ("Нужно шкур на план 2027 (TTL)", f"=D{TOT7}", INT),
    ("Из остатка можно использовать, шк.", f"=H{TOT7}", INT),
    ("Закупить с запасом, шк.", f"=K{TOT7}", INT),
    ("из них норка: самцов (M), шк.", f"=I{SXR['M']}", INT),
    ("из них норка: самок (F), шк.", f"=I{SXR['F']}", INT),
    ("из них норка: пол не важен, шк.", f"=I{SXR['?']}", INT),
    ("На закупку сырья, ₽ (с ростом цены, с НДС)", f"=O{TOT7}", RUB),
    ("Для сравнения: сырьё на весь план без остатков, ₽ (лист 6)", f"='6 Budget PCS 2027'!K{TOT6}", RUB),
]:
    ws7.cell(r, 1, t)
    put(ws7, r, 4, fml, fmt, bold=True)
    r += 1
ws7.freeze_panes = f"C{HR7+1}"

# =====================================================================
# Лист 8. Где использована норка: пол → лот → ТЗ → артикул → партия
# =====================================================================
if USAGE:
    ws8 = wb.create_sheet("8 Норка по полу в ТЗ")
    title(ws8, "Данные: каждое списание шкур норки в ТЗ — пол лота, лот, аукцион, ТЗ, артикул, партия", [
        "Пол — признак лота «Самец» / «Самка» (из названия лота и реестров закупок). ТЗ без отменённых. ₽ — стоимость списания с НДС, как в ТЗ.",
    ])
    C8 = ["Пол", "Лот", "Год", "Аукцион", "Сорт лота", "Признаки лота", "ТЗ", "Статус ТЗ", "Артикул", "Категория", "Партия", "Изделий в ТЗ", "Шкур", "Сумма руб", "Дата списания"]
    HR8 = 4
    head(ws8, HR8, C8, [12, 14, 7, 18, 34, 22, 16, 12, 14, 16, 22, 10, 9, 14, 12])
    r = HR8 + 1
    for u in USAGE:
        for c, v in enumerate([u["sex"], u["lot"], int(u["year"]) if u["year"].isdigit() else u["year"], u["auction"], u["grade"], u["attrs"], u["tz"], u["status"], u["article"], u["category"], u["batch"]], 1):
            put(ws8, r, c, v)
        put(ws8, r, 12, u["pcs"], INT)
        put(ws8, r, 13, u["qty"], DEC)
        put(ws8, r, 14, u["sum"], RUB)
        put(ws8, r, 15, u["date"])
        r += 1
    LAST8 = r - 1
    put(ws8, r, 1, "ИТОГО", fill=F_TOT, bold=True)
    for c in range(2, 16):
        put(ws8, r, c, None, fill=F_TOT)
    put(ws8, r, 13, f"=SUBTOTAL(9,M{HR8+1}:M{LAST8})", DEC, F_TOT, True)
    put(ws8, r, 14, f"=SUBTOTAL(9,N{HR8+1}:N{LAST8})", RUB, F_TOT, True)
    ws8.auto_filter.ref = f"A{HR8}:{L(len(C8))}{LAST8}"
    ws8.freeze_panes = f"C{HR8+1}"
    ws8a = wb.create_sheet("8а Сводная пол норки")
    title(ws8a, "Сводная (pivot) по листу 8: пол → артикул → ТЗ → лот (шкур и ₽); партию и аукцион можно перетащить из списка полей", ["После правок листа 8 — Данные → Обновить всё."])
    add_pivot(ws8a, ws8, HR8, LAST8, C8, ["Пол", "Артикул", "ТЗ", "Лот"], [("Шкур", "Шкур", 3), ("Сумма, ₽", "Сумма руб", 3)], "Сводная_пол_норки", anchor="A3")

for ws in wb.worksheets:
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 0
wb.calculation.fullCalcOnLoad = True
wb.save(OUT)
print("сохранено:", OUT)
