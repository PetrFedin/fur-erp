#!/usr/bin/env python3
"""Excel «Сырьё и бюджет FW27»: только шкуры и деньги на мех (без подкладки и работы); соболь, норка, каракульча, лиса, рысь.

  python3 -I scripts/build-raw-budget-xlsx.py <lots.json> <data.json> <out.xlsx>

lots.json  — scripts/export-raw-lots-json.ts (лоты как на Главной);
data.json  — scripts/export-raw-budget-data.ts (непроизведённые FW26 по ТЗ, склад, цены, бюджет FW27);
Жёлтые ячейки — ввод: меняете — пересчитываются все расчёты; после правок данных — Данные → Обновить всё (сводные).

Цены: «сейчас» — средневзвешенная цена шкуры без роста (списания в ТЗ: Σ ₽ ÷ Σ шкур; рысь — средняя цена заказа). Рост (+10 %) задаётся один раз на листе 7.
Цены бюджета FW27 уже содержат рост — на листе 6 из них берётся цена без роста (base), чтобы рост не считался дважды.
"""
import json
import math
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
HERE = os.path.dirname(os.path.abspath(__file__))
OWNER = json.load(open(os.path.join(HERE, "fw27-owner-plan-2026-11-01.json"), encoding="utf-8"))
SEX = json.load(open(os.path.join(HERE, "..", "src", "lib", "data", "mink-lot-sex.json"), encoding="utf-8"))

FURS = ["Соболь", "Норка", "Каракульча", "Лиса", "Рысь"]  # прочие меха (бобр, выдра, кошка, фишер, шиншилла) в отчёт не входят
NAME = {"Свакара": "Каракульча"}
fur_of = lambda f: NAME.get(f, f)
MIX = data["mix"]  # доля норки в «Норка + Соболь» по факту ТЗ FW26 (одежда / аксессуары)
PRICE = {f: data["price"].get(f, 0) for f in FURS}  # без роста, как в приложении

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


def head(ws, row, cols, widths=None, height=60):
    for i, c in enumerate(cols, 1):
        x = ws.cell(row, i, c)
        x.font, x.fill, x.border, x.alignment = BOLD, F_HEAD, B, Alignment(wrap_text=True, vertical="center", horizontal="center")
    ws.row_dimensions[row].height = height
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


def sex_of(fur, cat, ln):
    """Пол норки строки плана: явное решение владельца, иначе по длине (история ТЗ: Short — самцы, Regular и Long — самки), иначе любой."""
    v = OWNER["minkSex"].get(f"{fur}|{cat}|{ln}")
    if v in ("M", "F"):
        return {"M": "Самец", "F": "Самка"}[v]
    return {"Short": "Самец", "Regular": "Самка", "Long": "Самка"}.get(ln, "любой")


wb = Workbook()

# =====================================================================
# Лист 1. Лоты (данные)
# =====================================================================
ws1 = wb.active
ws1.title = "1 Лоты"
title(ws1, "Данные: всё купленное сырьё по лотам — куплено, потрачено по ТЗ, остаток (шкуры, ₽, $)", [
    f"Данные на {data['asOf']} (МСК). Как на Главной: лоты склада + «Заказано, не получено» + шкуры подрядчика. ₽ — с НДС. Только соболь, норка, каракульча, лиса, рысь.",
    "Потрачено = списано в ТЗ. Цена $ — цена молотка на аукционе, где она есть в документах. Пол норки — признак лота «Самец» / «Самка».",
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
    at = x.get("attrs") or ""
    if f != "Норка":
        sx = ["—", None]
    elif "Самец" in at or "Самка" in at:  # признак лота «Пол» в приложении — главный источник
        sx = ["M" if "Самец" in at else "F", "признак лота «Пол» в приложении" + (f" ({SEX[x['lot']][1]})" if x["lot"] in SEX else "")]
    else:
        sx = SEX.get(x["lot"]) or ["?", "пол в документах не указан" if x["lot"] != "Заказано, не получено" else "заказано, не получено: пол не указан"]
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
    ("Потрачено, шк.", "Потрачено шк", 3), ("Потрачено, ср. ₽", "Ср руб потрачено", 3), ("Потрачено, ₽", "Потрачено руб", 3),
    ("Остаток, шк.", "Остаток шк", 3), ("Остаток, ср. ₽", "Ср руб остаток", 3), ("Остаток, ₽", "Остаток руб", 3),
], "Сводная_сырьё", calc=[
    ("Ср USD куплено", "=IFERROR('Куплено USD'/'Куплено шк с USD',0)"), ("Ср руб куплено", "=IFERROR('Куплено руб'/'Куплено шк',0)"),
    ("Ср руб потрачено", "=IFERROR('Потрачено руб'/'Потрачено шк',0)"), ("Ср руб остаток", "=IFERROR('Остаток руб'/'Остаток шк',0)"),
], anchor="A4")

# =====================================================================
# Лист 7 (параметры) — номера строк нужны листам 3–6, сам лист создаётся ниже
# =====================================================================
P7_UP = 7                      # рост цены
P7_HEAD = 10                   # заголовок таблицы параметров по типам меха
PR = {f: P7_HEAD + 1 + i for i, f in enumerate(FURS)}
UP = f"'7 Расчёт закупки 2027'!$D${P7_UP}"
PRICE_REF = lambda f: f"'7 Расчёт закупки 2027'!$F${PR[f]}"

# =====================================================================
# Лист 3. Непроизведённые изделия FW26 по ТЗ (данные)
# =====================================================================
ws3 = wb.create_sheet("3 Непроизведённые FW26")
title(ws3, "Данные: непроизведённые изделия заказа FW26 — артикул, цвет, размер, штук, сколько шкур предполагаем на них и ₽", [
    "Заказ FW26 = объём всех наших ТЗ (723 изд.); не произведено = объём ТЗ модели − получено в розницу. Остаток модели разложен по её ТЗ: полученное считаем пришедшим из более ранних ТЗ.",
    "Шкур на оставшиеся изделия = штук × шкур на изделие (норма из ТЗ этой модели, жёлтая — можно менять). ₽ = шкур × средневзвешенная цена шкуры без роста (лист 7).",
    "Часть этих шкур уже выдана подрядчику по ТЗ и со склада списана — это учитывает лист 4 (столбцы P–Q здесь скрыты, служебные).",
])
C3 = ["Артикул", "Тип меха", "Категория", "ТЗ", "Статус ТЗ", "Цвет", "Размер", "Партия", "Не произведено шт", "Шкур на изд",
      "Шкур на оставшиеся изделия", "Ср цена шкуры руб", "Сумма руб", "Норма: откуда", "", "Уже выдано по ТЗ шк", "Еще уйдет со склада шк"]
HR3 = 6
head(ws3, HR3, C3, [12, 12, 18, 12, 24, 14, 16, 22, 11, 10, 13, 13, 15, 44, 2, 12, 12])
fw = []
for x in data["fw26"]:
    f = x["fur"]
    if " + " in f:  # смесь «Норка + Соболь»: делим по факту ТЗ
        m = MIX["Acc" if x["cls"] in ("acc", "Аксессуары") else "RTW"]
        for ff, sh in (("Норка", m), ("Соболь", 1 - m)):
            fw.append({**x, "fur": ff, "qty": x["qty"] * sh, "done": x["done"] * sh, "hpSource": x["hpSource"] + f" · доля {ff.lower()} {sh:.0%}"})
    else:
        fw.append({**x, "fur": fur_of(f)})
fw.sort(key=lambda x: (FURS.index(x["fur"]) if x["fur"] in FURS else 99, x["model"], x["tz"]))
r = HR3 + 1
for x in fw:
    for c, v in enumerate([x["model"], x["fur"], x["cat2"], x["tz"], x["status"], x["color"], x["size"], x["batch"]], 1):
        put(ws3, r, c, v)
    put(ws3, r, 9, round(x["qty"], 4), INT)
    inp(ws3, r, 10, x["hp"], DEC)
    put(ws3, r, 11, f"=I{r}*J{r}", DEC)
    put(ws3, r, 12, f"={PRICE_REF(x['fur'])}" if x["fur"] in FURS else 0, RUB)
    put(ws3, r, 13, f"=K{r}*L{r}", RUB)
    put(ws3, r, 14, x["hpSource"])
    put(ws3, r, 16, round(x["done"], 4), DEC)
    # по завершённым ТЗ шкуры уже выданы целиком; по ТЗ в работе — ещё уйдёт норма за вычетом выданного
    put(ws3, r, 17, f'=IF(E{r}="ТЗ завершено, не получено",0,MAX(0,K{r}-P{r}))', DEC)
    r += 1
LAST3 = r - 1
total_row(ws3, r, 17, [(9, INT), (11, DEC), (13, RUB), (16, DEC), (17, DEC)], first=HR3 + 1, last=LAST3)
put(ws3, r, 10, f"=IFERROR(K{r}/I{r},0)", DEC, F_TOT, True)
put(ws3, r, 12, f"=IFERROR(M{r}/K{r},0)", RUB, F_TOT, True)
for col in ("O", "P", "Q"):
    ws3.column_dimensions[col].hidden = True
ws3.auto_filter.ref = f"A{HR3}:{L(14)}{LAST3}"
ws3.freeze_panes = f"C{HR3+1}"
ART = lambda col: f"'3 Непроизведённые FW26'!${col}${HR3+1}:${col}${LAST3}"

ws3a = wb.create_sheet("3а Сводная FW26")
title(ws3a, "Сводная по листу 3: тип меха → артикул → цвет → размер", ["После правок листа 3 — Данные → Обновить всё. ТЗ, статус и партию можно перетащить из списка полей."])
add_pivot(ws3a, ws3, HR3, LAST3, C3[:14], ["Тип меха", "Артикул", "Цвет", "Размер"], [
    ("Не произведено, шт.", "Не произведено шт", 3), ("Шкур на оставшиеся изделия", "Шкур на оставшиеся изделия", 4), ("Сумма, ₽", "Сумма руб", 3),
], "Сводная_FW26", anchor="A3")

# =====================================================================
# Лист 4. Остаток на конец 2026
# =====================================================================
ws4 = wb.create_sheet("4 Остаток на конец 2026")
title(ws4, "Сырьё на складе сейчас → сколько ещё возьмём со склада на оставшиеся изделия FW26 → сколько останется на конец 2026", [
    "Шкур на оставшиеся изделия — лист 3 (штук × норма) + запас (жёлтая ячейка). Часть этих шкур уже выдана подрядчику по ТЗ — они со склада уже списаны и в «на складе» не входят.",
    "Поэтому склад уменьшится только на «ещё возьмём со склада» = шкур с запасом − уже выдано по ТЗ. ₽ — по средней цене склада (остаток ₽ ÷ остаток шк листа 1).",
])
ws4["A5"] = "Запас на оставшиеся модели FW26, % к расходу по норме"
ws4["A5"].font = BOLD
inp(ws4, 5, 4, 0.05, PCT)
EXTRA4 = "'4 Остаток на конец 2026'!$D$5"
C4 = ["Тип меха", "На складе сейчас, шк.", "На складе, ₽", "Ср. цена склада, ₽", "Шкур на оставшиеся изделия по норме", "Запас, шк.", "Шкур на оставшиеся изделия с запасом",
      "из них уже выдано подрядчику по ТЗ (со склада уже списано)", "Ещё возьмём со склада, шк.", "Ещё возьмём, ₽", "Останется на конец 2026, шк.", "Останется, ₽", "Не хватает на FW26, шк."]
HR4 = 7
head(ws4, HR4, C4, [16, 12, 15, 12, 14, 10, 14, 17, 13, 13, 14, 15, 12], height=75)
r = HR4 + 1
LEFT_ROW = {}
for f in FURS:
    put(ws4, r, 1, f, bold=True)
    put(ws4, r, 2, f'=SUMIFS({LOT("N")},{LOT("A")},A{r})', INT)
    put(ws4, r, 3, f'=SUMIFS({LOT("O")},{LOT("A")},A{r})', RUB)
    put(ws4, r, 4, f"=IFERROR(C{r}/B{r},0)", RUB)
    put(ws4, r, 5, f'=SUMIFS({ART("K")},{ART("B")},A{r})', DEC)
    put(ws4, r, 6, f"=E{r}*$D$5", DEC)
    put(ws4, r, 7, f"=E{r}+F{r}", DEC)
    put(ws4, r, 8, f'=E{r}-SUMIFS({ART("Q")},{ART("B")},A{r})', DEC)  # как в приложении: по норме − ещё не выдано
    put(ws4, r, 9, f"=MAX(0,G{r}-H{r})", DEC)
    put(ws4, r, 10, f"=I{r}*D{r}", RUB)
    put(ws4, r, 11, f"=MAX(0,B{r}-I{r})", DEC)
    put(ws4, r, 12, f"=K{r}*D{r}", RUB)
    put(ws4, r, 13, f"=MAX(0,I{r}-B{r})", DEC)
    LEFT_ROW[f] = r
    r += 1
total_row(ws4, r, 13, [(c, ws4.cell(r - 1, c).number_format) for c in [2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13]], label="ВСЕГО", first=HR4 + 1, last=r - 1, fn="SUM(")
put(ws4, r, 4, f"=IFERROR(C{r}/B{r},0)", RUB, F_TOT, True)
TOT4 = r
mr = LEFT_ROW["Норка"]
ws4.cell(r + 2, 1, "Как читать (пример — норка):").font = BOLD
ws4.cell(r + 3, 1, f'="на оставшиеся изделия по норме "&TEXT(E{mr},"0,0")&" шк. + запас "&TEXT(F{mr},"0,0")&" = "&TEXT(G{mr},"0,0")&"; из них "&TEXT(H{mr},"0")&" уже выданы подрядчику по ТЗ (со склада списаны раньше); '
                    f'ещё возьмём со склада "&TEXT(I{mr},"0,0")&"; было на складе "&TEXT(B{mr},"0")&" → останется на конец 2026 "&TEXT(K{mr},"0,0")&"."')
ws4.freeze_panes = f"B{HR4+1}"

# =====================================================================
# Лист 5. План 2027 (данные)
# =====================================================================
ws5 = wb.create_sheet("5 План 2027")
title(ws5, "Данные: план производства 2027 (бюджет FW27) — 1 460 изделий, шкур на изделие и всего", [
    "Одежда — бюджет RTW от 19.10, аксессуары — файл MVST W FURS ACC от 27.10. Шкур на изделие — бюджет FW27: нормы владельца от 01.11, иначе статистика ТЗ (столбец «Норма: откуда»).",
    "«Норка+Соболь»: шкуры делятся по доле норки строки. Пол норки: по истории ТЗ Short — самцы (100 %), Regular и Long — самки (91–100 %), аксессуары — любой (кроме косынки «Норка+Соболь» — самцы, решение владельца). Жёлтые ячейки можно менять.",
])
C5 = ["Тип меха", "Блок", "Категория", "Длина", "Кол-во шт", "Шкур на изд", "Шкур всего", "Доля норки", "Шкур норки", "Шкур соболя", "Пол норки",
      "Норма: откуда", "Норма владельца 01.11", "Сверка нормы", "Комментарий владельца / оценка"]
HR5 = 5
head(ws5, HR5, C5, [14, 12, 24, 10, 9, 10, 11, 9, 10, 10, 10, 34, 11, 11, 60])
FO = ["Соболь", "Норка", "Норка+Соболь", "Каракульча", "Лиса", "Рысь"]
LENS = ["Short", "Regular", "Long", ""]
bud = sorted(data["budget"], key=lambda b: (FO.index(b["fur"]) if b["fur"] in FO else 99, 0 if b["group"] == "Одежда" else 1, b["cat"], LENS.index(b["len"]) if b["len"] in LENS else 9))


def norm_src(b, key):
    if key in OWNER["norms"] and abs(OWNER["norms"][key] - b["hides"]) < 0.01 and b["src"] == "manual":
        st = f"; статистика ТЗ была {b['statHides']:.2f}" if b.get("statHides") else ""
        return f"владелец 01.11{st}"
    if b["src"] == "len":
        return f"статистика ТЗ: категория и длина, {b['sample']} изд."
    if b["src"] == "pair":
        return f"статистика ТЗ: категория, {b['sample']} изд."
    if b["src"] == "manual":
        return "вручную в бюджете" + (" (расчёт рыси FW26)" if b["fur"] == "Рысь" else "")
    return "оценка по аналогу (данных ТЗ нет)"


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
        inp(ws5, r, 11, sex_of(b["fur"], b["cat"], b["len"]))
    else:
        put(ws5, r, 11, "—")
    put(ws5, r, 12, norm_src(b, key))
    nv = OWNER["norms"].get(key)
    if nv is not None:
        put(ws5, r, 13, nv, DEC)
        put(ws5, r, 14, f'=IF(ABS(F{r}-M{r})<0.01,"✓ учтена","≠ проверить")')
    else:
        put(ws5, r, 13, None)
        put(ws5, r, 14, "—")
    put(ws5, r, 15, " · ".join(v for v in [OWNER["comments"].get(key), b["est"]] if v) or None).alignment = WRAP
    r += 1
LAST5 = r - 1
total_row(ws5, r, 15, [(5, INT), (7, DEC), (9, DEC), (10, DEC)], first=HR5 + 1, last=LAST5)
put(ws5, r, 6, f"=IFERROR(G{r}/E{r},0)", DEC, F_TOT, True)
TOT5 = r
ws5.auto_filter.ref = f"A{HR5}:{L(len(C5))}{LAST5}"
ws5.freeze_panes = f"E{HR5+1}"
P5 = lambda col: f"'5 План 2027'!${col}${HR5+1}:${col}${LAST5}"

# =====================================================================
# Лист 5а. Свод плана 2027 (формулы, без сводной таблицы)
# =====================================================================
ws5a = wb.create_sheet("5а Свод план 2027")
title(ws5a, "Свод по листу 5: тип меха → категория → длина — изделий, шкур, шкур на изделие, деньги на мех сейчас и с ростом; у «Норка+Соболь» — сколько норки и соболя", [
    "Считается формулами — пересчитывается сразу после правок листа 5. Деньги — с листа 6 (цена шкуры категории сейчас; с ростом — рост с листа 7).",
])
C5a = ["Тип меха", "Категория", "Длина", "Кол-во, шт.", "Шкур всего", "Шкур на изд.", "из них норка, шк.", "из них соболь, шк.",
       "Цена шкуры сейчас, ₽", "На мех сейчас, ₽", "Цена с ростом, ₽", "На мех с ростом, ₽"]
head(ws5a, 4, C5a, [16, 26, 10, 11, 12, 11, 12, 12, 13, 16, 13, 16], height=45)
r = 5
P6E = lambda col: f"'6 Budget PCS 2027'!${col}$7:${col}${6 + len(bud)}"  # строки данных листа 6 (в том же порядке, что лист 5)


def agg5(r, crit, labels, fill=None):
    for c, v in zip([1, 2, 3], labels):
        put(ws5a, r, c, v, fill=fill, bold=bool(fill))
    sf = lambda col: f"SUMIFS({P5(col)},{crit})" if crit else f"SUM({P5(col)})"
    c6 = crit.replace(P5("A"), P6E("A")).replace(P5("C"), P6E("C")).replace(P5("D"), P6E("D")) if crit else None
    s6 = lambda col: f"SUMIFS({P6E(col)},{c6})" if c6 else f"SUM({P6E(col)})"
    put(ws5a, r, 4, f"={sf('E')}", INT, fill, bool(fill))
    put(ws5a, r, 5, f"={sf('G')}", DEC, fill, bool(fill))
    put(ws5a, r, 6, f"=IFERROR(E{r}/D{r},0)", DEC, fill, bool(fill))
    put(ws5a, r, 7, f"={sf('I')}", DEC, fill, bool(fill))
    put(ws5a, r, 8, f"={sf('J')}", DEC, fill, bool(fill))
    put(ws5a, r, 10, f"={s6('I')}", RUB, fill, bool(fill))
    put(ws5a, r, 9, f"=IFERROR(J{r}/E{r},0)", RUB, fill, bool(fill))
    put(ws5a, r, 12, f"={s6('K')}", RUB, fill, bool(fill))
    put(ws5a, r, 11, f"=IFERROR(L{r}/E{r},0)", RUB, fill, bool(fill))


agg5(r, None, ["ВСЕГО", "", ""], F_TOT)
r += 1
for f in FO:
    if not any(b["fur"] == f for b in bud):
        continue
    agg5(r, f'{P5("A")},"{f}"', [f, "", ""], F_FUR)
    r += 1
    for c in dict.fromkeys(b["cat"] for b in bud if b["fur"] == f):
        lens = [b["len"] for b in bud if b["fur"] == f and b["cat"] == c and b["len"]]
        agg5(r, f'{P5("A")},"{f}",{P5("C")},"{c}"', [f, c, ""], F_GRP if lens else None)
        r += 1
        for ln in lens:
            agg5(r, f'{P5("A")},"{f}",{P5("C")},"{c}",{P5("D")},"{ln}"', [f, c, ln])
            r += 1
ws5a.freeze_panes = "D5"

# =====================================================================
# Лист 6. Budget PCS 2027 — деньги на мех без учёта остатков
# =====================================================================
ws6 = wb.create_sheet("6 Budget PCS 2027")
title(ws6, "MVST · Budget PCS 2027: сколько шкур и денег на мех на весь план (без учёта остатков) — сейчас и с ростом цены", [
    "Количество и шкур на изделие — с листа 5. Цена шкуры сейчас — средневзвешенная по ТЗ этой категории без роста (в бюджете FW27 цена уже с ростом — здесь он снят); рысь — средняя цена заказанного. Рост — лист 7.",
])
ws6["A4"] = "Рост цены шкуры (задаётся на листе 7)"
ws6["A4"].font = BOLD
put(ws6, 4, 4, f"={UP}", PCT, bold=True)
C6 = ["Тип меха", "Категория 1", "Категория 2", "Длина", "Кол-во, шт.", "Шкур на изд.", "Шкур всего", "Цена шкуры сейчас, ₽", "На мех сейчас, ₽", "Цена с ростом, ₽", "На мех с ростом, ₽"]
HR6 = 6
head(ws6, HR6, C6, [16, 13, 26, 10, 10, 11, 12, 13, 16, 13, 16])
r = HR6 + 1
leaf_first = r
for i, b in enumerate(bud):
    src = HR5 + 1 + i
    for c, v in enumerate([b["fur"], b["group"], b["cat"], b["len"] or "—"], 1):
        put(ws6, r, c, v)
    put(ws6, r, 5, f"='5 План 2027'!E{src}", INT)
    put(ws6, r, 6, f"='5 План 2027'!F{src}", DEC)
    put(ws6, r, 7, f"=E{r}*F{r}", DEC)
    # рысь: в ТЗ её ещё не было — цена шкуры = средняя цена заказанного (как на листе 7), а не цена расчёта FW26 из бюджета
    put(ws6, r, 8, f"={PRICE_REF('Рысь')}", RUB) if b["fur"] == "Рысь" else inp(ws6, r, 8, b["basePrice"] or 0, RUB)
    put(ws6, r, 9, f"=G{r}*H{r}", RUB)
    put(ws6, r, 10, f"=H{r}*(1+$D$4)", RUB)
    put(ws6, r, 11, f"=G{r}*J{r}", RUB)
    r += 1
leaf_last = r - 1
P6 = lambda col: f"'6 Budget PCS 2027'!${col}${leaf_first}:${col}${leaf_last}"


def agg6(r, crit, labels, fill=None):
    for c, v in zip([1, 2, 3, 4], labels):
        put(ws6, r, c, v, fill=fill, bold=bool(fill))
    sf = lambda col: f"SUMIFS({P6(col)},{crit})" if crit else f"SUM({P6(col)})"
    put(ws6, r, 5, f"={sf('E')}", INT, fill, bool(fill))
    put(ws6, r, 7, f"={sf('G')}", DEC, fill, bool(fill))
    put(ws6, r, 9, f"={sf('I')}", RUB, fill, bool(fill))
    put(ws6, r, 11, f"={sf('K')}", RUB, fill, bool(fill))
    put(ws6, r, 6, f"=IFERROR(G{r}/E{r},0)", DEC, fill, bool(fill))
    put(ws6, r, 8, f"=IFERROR(I{r}/G{r},0)", RUB, fill, bool(fill))
    put(ws6, r, 10, f"=IFERROR(K{r}/G{r},0)", RUB, fill, bool(fill))


agg6(r, None, ["ИТОГО", "", "", ""], F_TOT)
r += 2
ws6.cell(r, 1, "Сводная как в отчёте MVST: TOTAL → тип меха → категория 1 (одежда / аксессуары) → категория 2 → длина").font = H2
r += 1
head(ws6, r, C6)
r += 1
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
            lens = [b["len"] for b in bud if b["fur"] == f and b["group"] == g and b["cat"] == c and b["len"]]
            agg6(r, f'{P6("A")},"{f}",{P6("B")},"{g}",{P6("C")},"{c}"', [f, g, c, "все" if lens else "—"])
            r += 1
            for ln in lens:
                agg6(r, f'{P6("A")},"{f}",{P6("B")},"{g}",{P6("C")},"{c}",{P6("D")},"{ln}"', [f, g, c, ln])
                r += 1
ws6.freeze_panes = f"E{HR6+1}"

# =====================================================================
# Лист 7. Расчёт закупки 2027
# =====================================================================
ws7 = wb.create_sheet("7 Расчёт закупки 2027")
title(ws7, "Сколько шкур купить на план 2027: остаток на конец 2026 → что из него используем → покупка с запасом", [
    "1) Остаток на конец 2026 (лист 4). Часть не будет востребована — «невостребованное в остатке 2026, %» (владелец: соболь, норка, каракульча 30 %, лиса 20 %, рысь 15 %).",
    "2) Годный остаток делится: «в одежду, %» по виду меха, остальное — в аксессуары; лишний годный остаток одного блока отдаём другому блоку того же меха (решение владельца 02.11). Используем = меньшее из «нужно» и «своё годное + лишнее другого блока».",
    "3) Закупить = нужно из покупки ÷ (1 − «остаток купленного, %»): после заказа 2027 от купленного в 2027 остаётся этот процент. Неиспользованный остаток 2026 сюда не входит — он показан отдельно.",
    "4) Деньги — «сейчас» (средневзвешенная цена шкуры без роста) и «с ростом» (+ рост цены ниже). Все жёлтые ячейки можно менять — всё пересчитывается.",
])
ws7.cell(P7_UP, 1, "Рост цены шкуры к цене сейчас, %").font = BOLD
inp(ws7, P7_UP, 4, 0.10, PCT)
ws7.cell(P7_HEAD - 1, 1, "Параметры по типам меха (жёлтые — можно менять)").font = H2
head(ws7, P7_HEAD, ["Тип меха", "Невостребованное в остатке 2026, %", "Остаток купленного после заказа 2027, % (по умолчанию = невостребованному)", "Годный остаток — в одежду, %",
                    "Годный остаток — в аксессуары, %", "Цена шкуры сейчас, ₽ (средневзв. по ТЗ, без роста)", "Цена с ростом, ₽"], height=75)
for f in FURS:
    p = PR[f]
    put(ws7, p, 1, f, bold=True)
    inp(ws7, p, 2, OWNER["reserve"][f], PCT)
    inp(ws7, p, 3, f"=B{p}", PCT)
    inp(ws7, p, 4, OWNER["rtwShare"][f], PCT)
    put(ws7, p, 5, f"=1-D{p}", PCT)
    inp(ws7, p, 6, PRICE[f], RUB)
    put(ws7, p, 7, f"=F{p}*(1+$D${P7_UP})", RUB)
ws7.cell(PR[FURS[-1]] + 1, 1, "Цена сейчас: соболь, норка, каракульча, лиса — Σ ₽ ÷ Σ шкур, списанных в ТЗ (лист 1, «потрачено ₽ ÷ потрачено шк»); рысь — средняя цена заказанного (списаний ещё нет).").font = NOTE
r = PR[FURS[-1]] + 3
ws7.cell(r, 1, "Расчёт по типам меха и блокам").font = H2
r += 1
C7 = ["Тип меха", "Блок", "Изделий на план, шт.", "Шкур на план 2027", "Остаток на конец 2026, шк.", "Не будет востребовано, шк.", "Годный остаток, шк.",
      "Используем из остатка (своё + лишнее другого блока), шк.", "Годное, но не пригодится, шк.", "Нужно из покупки, шк.", "Закупить, шк.", "Останется купленного после 2027, шк.",
      "Останется от остатка 2026 (не использовано), шк.", "Всего останется после 2027, шк.", "Цена сейчас, ₽", "На закупку сейчас, ₽", "Цена с ростом, ₽", "На закупку с ростом, ₽"]
HR7 = r
head(ws7, HR7, C7, [40, 12, 11, 12, 13, 13, 12, 13, 13, 12, 12, 13, 15, 13, 12, 16, 12, 16], height=75)
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
    left, short = f"'4 Остаток на конец 2026'!K{lr}", f"'4 Остаток на конец 2026'!M{lr}"
    first = r
    for blk in ["Одежда", "Аксессуары"]:
        put(ws7, r, 1, f)
        put(ws7, r, 2, blk)
        put(ws7, r, 3, f'=SUMIFS({P5("E")},{P5("A")},"{f}",{P5("B")},"{blk}")', INT)
        put(ws7, r, 4, f"={ttl_ref(f, blk)}", DEC)
        share = f"$D${p}" if blk == "Одежда" else f"$E${p}"
        put(ws7, r, 5, f"={left}*{share}", DEC)
        put(ws7, r, 6, f"=E{r}*$B${p}", DEC)
        put(ws7, r, 7, f"=E{r}-F{r}", DEC)
        o = r + 1 if blk == "Одежда" else r - 1  # строка другого блока того же меха
        put(ws7, r, 8, f"=MIN(D{r},G{r}+MAX(0,G{o}-D{o}))", DEC)   # своё годное + лишнее другого блока
        put(ws7, r, 9, f"=MAX(0,G{r}-D{r}-MAX(0,D{o}-G{o}))", DEC)  # своё лишнее, которое не забрал другой блок
        put(ws7, r, 10, f"=D{r}-H{r}+{short}*{share}", DEC)
        for c in range(11, 19):
            put(ws7, r, c, None)
        r += 1
    put(ws7, r, 1, f"{f} — итого", fill=F_FUR, bold=True)
    put(ws7, r, 2, "", fill=F_FUR)
    for c in range(3, 11):
        put(ws7, r, c, f"=SUM({L(c)}{first}:{L(c)}{r-1})", INT if c == 3 else DEC, F_FUR, True)
    put(ws7, r, 11, f"=IFERROR(J{r}/(1-$C${p}),0)", INT, F_FUR, True)
    put(ws7, r, 12, f"=K{r}-J{r}", INT, F_FUR, True)
    put(ws7, r, 13, f"=F{r}+I{r}", INT, F_FUR, True)
    put(ws7, r, 14, f"=L{r}+M{r}", INT, F_FUR, True)
    put(ws7, r, 15, f"=$F${p}", RUB, F_FUR, True)
    put(ws7, r, 16, f"=K{r}*O{r}", RUB, F_FUR, True)
    put(ws7, r, 17, f"=$G${p}", RUB, F_FUR, True)
    put(ws7, r, 18, f"=K{r}*Q{r}", RUB, F_FUR, True)
    tot_rows.append(r)
    r += 1
put(ws7, r, 1, "Норка+Соболь — изделий (их шкуры входят в норку и соболь выше)")
put(ws7, r, 2, "")
put(ws7, r, 3, f'=SUMIFS({P5("E")},{P5("A")},"Норка+Соболь")', INT)
for c in range(4, 19):
    put(ws7, r, c, None)
MIX7 = r
r += 1
put(ws7, r, 1, "ВСЕГО", fill=F_TOT, bold=True)
put(ws7, r, 2, "", fill=F_TOT)
put(ws7, r, 3, "=" + "+".join(f"C{x}" for x in tot_rows) + f"+C{MIX7}", INT, F_TOT, True)
for c in [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18]:
    put(ws7, r, c, "=" + "+".join(f"{L(c)}{x}" for x in tot_rows), RUB if c in (16, 18) else INT if c >= 11 else DEC, F_TOT, True)
put(ws7, r, 15, None, fill=F_TOT)
put(ws7, r, 17, None, fill=F_TOT)
TOT7 = r
r += 2

# ---------- Норка по полу ----------
ws7.cell(r, 1, "Норка по полу: сколько самцов и самок купить").font = H2
r += 1
ws7.cell(r, 1, "Склад — лоты с признаком «Самец» / «Самка» (лист 1). Остаток 2026 и невостребованное — в пропорции склада. Нужно — лист 5: Short — самцы, Regular и Long — самки, аксессуары — любой (косынка «Норка+Соболь» — самцы).").font = NOTE
r += 1
ws7.cell(r, 1, "Закупить по полу = не хватает ÷ (1 − «остаток купленного, %» норки). Лишние самцы / самки идут туда, где пол не важен.").font = NOTE
r += 1
head(ws7, r, ["Пол", "На складе, шк.", "Доля склада", "Остаток на конец 2026, шк.", "Не будет востребовано, шк.", "Годный остаток, шк.", "Нужно на план 2027, шк.",
              "Не хватает, шк.", "Лишнее, шк.", "Закупить, шк."])
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
    put(ws7, rr, 10, f"=H{rr}/(1-$C${pm})", INT)
put(ws7, r, 1, "Норка — итого по полу", fill=F_FUR, bold=True)
for c in [2, 4, 5, 6, 7, 8, 10]:
    put(ws7, r, c, f"=SUM({L(c)}{first_sx}:{L(c)}{r-1})", INT, F_FUR, True)
for c in (3, 9):
    put(ws7, r, c, None, fill=F_FUR)
SXT = r
r += 1
ws7.cell(r, 1, "Норка — нужно купить по блокам (одежда / аксессуары)")
put(ws7, r, 10, f"=IFERROR(J{mink_tot}/(1-$C${pm}),0)", INT, bold=True)
r += 1
ws7.cell(r, 1, "Норка — закупить = большее из «по блокам» и «по полу» (это число в таблице выше); самцов и самок — не меньше, чем по полу").font = BOLD
put(ws7, r, 10, f"=K{mink_tot}", INT, F_FUR, True)
# закупка норки в таблице: большее из «по блокам» и «по полу» (деньги, приход на листе 8 — от неё)
ws7.cell(mink_tot, 11).value = f"=MAX(IFERROR(J{mink_tot}/(1-$C${pm}),0),J{SXT})"
MINK_BUY = r
r += 2

# ---------- Кратко ----------
ws7.cell(r, 1, "Кратко: вся цепочка").font = H2
r += 1
for t_, fml, fmt in [
    ("Сырьё на складе сейчас, шк.", f"='4 Остаток на конец 2026'!B{TOT4}", INT),
    ("Шкур на оставшиеся изделия FW26 с запасом, шк.", f"='4 Остаток на конец 2026'!G{TOT4}", DEC),
    ("   из них ещё возьмём со склада, шк.", f"='4 Остаток на конец 2026'!I{TOT4}", DEC),
    ("Остаток сырья на конец 2026, шк.", f"=E{TOT7}", INT),
    ("   из него не будет востребовано, шк.", f"=F{TOT7}", INT),
    ("   годный остаток, шк.", f"=G{TOT7}", INT),
    ("Изделий на план 2027, шт.", f"=C{TOT7}", INT),
    ("Шкур на план 2027, шк.", f"=D{TOT7}", INT),
    ("   из остатка 2026 используем, шк.", f"=H{TOT7}", INT),
    ("   нужно из покупки, шк.", f"=J{TOT7}", INT),
    ("Закупить, шк.", f"=K{TOT7}", INT),
    ("   норка: из них самцов не меньше, шк.", f"=J{SXR['Самец']}", INT),
    ("   норка: из них самок не меньше, шк.", f"=J{SXR['Самка']}", INT),
    ("На закупку меха сейчас (без роста), ₽", f"=P{TOT7}", RUB),
    ("На закупку меха с ростом цены, ₽", f"=R{TOT7}", RUB),
    ("Останется после заказа 2027: купленного, шк.", f"=L{TOT7}", INT),
    ("Останется после заказа 2027: от остатка 2026, шк.", f"=M{TOT7}", INT),
    ("Для сравнения: мех на весь план без остатков, с ростом, ₽ (лист 6)", f"='6 Budget PCS 2027'!K{TOT6}", RUB),
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
    ("Остаток на конец 2026 = лист 4", f'=IF(ABS(E{TOT7}-\'4 Остаток на конец 2026\'!K{TOT4})<0.5,"✓","≠ проверить")'),
    ("Цена сейчас = «потрачено ₽ ÷ шк» по лотам (лист 1)", "=" + "&".join(f'IF(ABS(IFERROR(SUMIFS({LOT("M")},{LOT("A")},"{f}")/SUMIFS({LOT("L")},{LOT("A")},"{f}"),0)-$F${PR[f]})<1,"✓","≠{f} ")' for f in FURS[:4])),
    ("Нормы владельца 01.11 учтены (лист 5)", f'=IF(COUNTIF(\'5 План 2027\'!N{HR5+1}:N{LAST5},"≠*")=0,"✓ все "&COUNTIF(\'5 План 2027\'!N{HR5+1}:N{LAST5},"✓*"),"≠ есть расхождения")'),
    ("Закупка норки покрывает и блоки, и самцов/самок", f'=IF(AND(K{mink_tot}>=J{SXT}-0.5,K{mink_tot}>=IFERROR(J{mink_tot}/(1-$C${pm}),0)-0.5),"✓","≠ проверить")'),
]:
    ws7.cell(r, 1, t_)
    put(ws7, r, 4, fml, fill=F_OK, bold=True)
    r += 1
ws7.freeze_panes = f"C{HR7+1}"

# =====================================================================
# Лист 8. План производства 2027 по месяцам (январь — ноябрь) и сырьё
# =====================================================================
from openpyxl.worksheet.properties import Outline
MONTHS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя"]
NM = len(MONTHS)
# Приход купленного сырья на склад по месяцам (выделанные шкуры; по датам прихода лотов 2025–2026, весенние аукционы — не раньше лета):
# соболь РП/СП март–май → июнь–июль, СП осень → сентябрь, СП декабрь → ноябрь; норка SAGA март → июль–август, AME май → сентябрь;
# каракульча SAGA март/июнь → июль–август, прочее → октябрь; лиса SAGA март → июль–август; рысь FH июнь → октябрь.
INTAKE = {
    "Соболь": {6: 0.40, 7: 0.40, 9: 0.17, 11: 0.03},
    "Норка": {7: 0.45, 8: 0.50, 9: 0.05},
    "Каракульча": {7: 0.40, 8: 0.45, 10: 0.15},
    "Лиса": {7: 0.65, 8: 0.35},
    "Рысь": {10: 1.0},
}
# Целевая загрузка одежды (владелец 02.11): с января не меньше 50 %, июль 25–30 % (отпуска), к сентябрю ≈ 70 % плана, без 100 % в конце года.
TARGET_LOAD = [0.5] * 6 + [0.28] + [0.8] * 4
LYNX_FROM = 8  # рысь шьём к сентябрю–ноябрю (сырьё — остаток 2026, есть с декабря 2026)


def spread(total, weights):
    """Целые штуки по месяцам пропорционально весам, сумма = total (метод наибольших остатков)."""
    s = sum(weights)
    if total <= 0 or s <= 0:
        return [0] * len(weights)
    raw = [total * w / s for w in weights]
    out = [int(x) for x in raw]
    for i in sorted(range(len(raw)), key=lambda i: raw[i] - out[i], reverse=True)[: total - sum(out)]:
        out[i] += 1
    return out

# --- значения листов 4 и 7 (те же формулы, что в ячейках) — для раскладки; дальше лист 8 считает формулами
stock_v = {f: sum(x["rem"] for x in rows1 if fur_of(x["item"]) == f) for f in FURS}
norm_v = {f: sum(x["qty"] * (x["hp"] or 0) for x in fw if x["fur"] == f) for f in FURS}
togo0_v = {f: sum(0 if x["status"].startswith("ТЗ завершено") else max(0, x["qty"] * (x["hp"] or 0) - x["done"]) for x in fw if x["fur"] == f) for f in FURS}
left_v = {f: max(0, stock_v[f] - (togo0_v[f] + 0.05 * norm_v[f])) for f in FURS}
ttl_v = {f: {"Одежда": 0.0, "Аксессуары": 0.0} for f in FURS}
for b in bud:
    t_ = b["pcs"] * b["hides"]
    if b["fur"] == "Норка+Соболь":
        s_ = OWNER["minkShare"].get(f'{b["cat"]}|{b["len"]}', MIX["RTW" if b["group"] == "Одежда" else "Acc"])
        ttl_v["Норка"][b["group"]] += t_ * s_
        ttl_v["Соболь"][b["group"]] += t_ * (1 - s_)
    elif b["fur"] in FURS:
        ttl_v[b["fur"]][b["group"]] += t_
lpool, buy_v = {}, {}
for f in FURS:
    X = OWNER["reserve"][f]
    u = {"Одежда": left_v[f] * OWNER["rtwShare"][f] * (1 - X), "Аксессуары": left_v[f] * (1 - OWNER["rtwShare"][f]) * (1 - X)}
    need_buy = 0.0
    for g, o in (("Одежда", "Аксессуары"), ("Аксессуары", "Одежда")):
        h = min(ttl_v[f][g], u[g] + max(0, u[o] - ttl_v[f][o]))   # своё годное + лишнее другого блока (как лист 7)
        lpool[(f, g)] = h
        need_buy += ttl_v[f][g] - h
    buy_v[f] = need_buy / (1 - X)

# --- строки производства и шкур на изделие по видам сырья
PR8 = []
for f in FO:
    for g in ("Одежда", "Аксессуары"):
        bs = [b for b in bud if b["fur"] == f and b["group"] == g]
        pcs = sum(b["pcs"] for b in bs)
        if not pcs:
            continue
        per = {}
        for b in bs:
            t_ = b["pcs"] * b["hides"]
            if f == "Норка+Соболь":
                s_ = OWNER["minkShare"].get(f'{b["cat"]}|{b["len"]}', MIX["RTW" if g == "Одежда" else "Acc"])
                per["Норка"] = per.get("Норка", 0) + t_ * s_
                per["Соболь"] = per.get("Соболь", 0) + t_ * (1 - s_)
            else:
                per[f] = per.get(f, 0) + t_
        PR8.append({"f": f, "g": g, "pcs": pcs, "per": {k: v / pcs for k, v in per.items()}})


def schedule(rtw_targets):
    """Помесячная раскладка: сначала сырьё из остатка 2026 своего блока, потом купленное (с месяца после прихода)."""
    lp = dict(lpool); bp = {f: 0.0 for f in FURS}
    left = [r["pcs"] for r in PR8]; out = [[0] * NM for _ in PR8]
    def can(i):
        r = PR8[i]
        return all(lp[(fu, r["g"])] + bp[fu] >= p - 1e-9 for fu, p in r["per"].items())
    def take(i):
        r = PR8[i]
        for fu, p in r["per"].items():
            a = min(p, lp[(fu, r["g"])]); lp[(fu, r["g"])] -= a; bp[fu] -= p - a
        left[i] -= 1
    for m in range(NM):
        for fu in FURS:
            bp[fu] += buy_v[fu] * INTAKE[fu].get(m, 0)   # приход в месяце m (номер 1..12) → шьём с месяца m+1 (индекс m)
        for g in ("Одежда", "Аксессуары"):
            idx = [i for i, r in enumerate(PR8) if r["g"] == g and not (r["f"] == "Рысь" and m < LYNX_FROM)]
            rem = sum(left[i] for i in idx) + (sum(left[i] for i, r in enumerate(PR8) if r["g"] == g and r["f"] == "Рысь") if m < LYNX_FROM else 0)
            t = rtw_targets[m] if g == "Одежда" and rtw_targets[m] is not None else -(-rem // (NM - m))
            got = [0] * len(PR8)
            # рысь — ровно по месяцам сентябрь–ноябрь (не больше своей доли месяца)
            lim = {i: (-(-left[i] // (NM - m)) if PR8[i]["f"] == "Рысь" else 10 ** 6) for i in idx}  # на начало месяца
            for _ in range(int(t)):
                cand = [i for i in idx if left[i] > 0 and got[i] < lim[i] and can(i)]
                if not cand:
                    break
                i = max(cand, key=lambda i: left[i] / PR8[i]["pcs"])
                take(i); out[i][m] += 1; got[i] += 1
    return out, left


RTW_TOTAL = sum(r["pcs"] for r in PR8 if r["g"] == "Одежда")
C_TARGET = math.ceil(RTW_TOTAL / sum(TARGET_LOAD))  # мощность, при которой целевой профиль даёт ровно план
# Одежда по целевой загрузке, шт. по месяцам
tgt = [round(C_TARGET * x) for x in TARGET_LOAD]
tgt[-1] = RTW_TOTAL - sum(tgt[:-1])
SUMMER = {f: dict(v) for f, v in INTAKE.items()}  # приход как в 2025–2026 (весенние аукционы — летом)


def deficits(acc_plan):
    """Сколько шкур не хватает к концу каждого месяца, чтобы шить одежду по целевой загрузке (нарастающим итогом)."""
    need = {f: [0.0] * NM for f in FURS}
    rem = {i: r["pcs"] for i, r in enumerate(PR8) if r["g"] == "Одежда"}
    nc = {f: 0.0 for f in FURS}; hc = {f: sum(lpool[(f, g)] for g in ("Одежда", "Аксессуары")) for f in FURS}
    for m in range(NM):
        pool_i = [i for i in rem if rem[i] > 0 and not (PR8[i]["f"] == "Рысь" and m < LYNX_FROM)]
        tot = sum(rem[i] for i in pool_i) or 1
        for i, k in zip(pool_i, spread(min(tgt[m], sum(rem[i] for i in pool_i)), [rem[i] / tot for i in pool_i])):
            rem[i] -= k
            for fu, p in PR8[i]["per"].items():
                nc[fu] += k * p
        for fu in FURS:
            hc[fu] += buy_v[fu] * INTAKE[fu].get(m, 0)
            for i, r in enumerate(PR8):
                if r["g"] == "Аксессуары":
                    nc[fu] += acc_plan[i][m] * r["per"].get(fu, 0)
            need[fu][m] = max(0.0, nc[fu] - hc[fu])
    return need


# Без зимней закупки: сколько не хватает (для справки на листе)
base_plan, _ = schedule(tgt[:-1] + [None])
need_base = deficits(base_plan)
# Зимние аукционы (декабрь 2026 — февраль 2027): часть закупки приходит к месяцу, когда без неё не хватит; летний приход уменьшается на столько же
WINTER = {f: {} for f in FURS}
for _ in range(10):
    plan_try, _l = schedule(tgt[:-1] + [None])
    nd = deficits(plan_try)
    if all(max(v) < 0.5 for v in nd.values()):
        break
    for f in FURS:
        firsts = [m for m in range(NM) if nd[f][m] >= 0.5]
        if not firsts:
            continue
        key = max(1, firsts[0])  # пришло в месяце key (январь = 1) → в работу с месяца key + 1
        WINTER[f][key] = WINTER[f].get(key, 0) + math.ceil(max(nd[f]) * 1.15) / buy_v[f]
    for f in FURS:
        w_ = sum(WINTER[f].values())
        INTAKE[f] = {k: v * (1 - w_) for k, v in SUMMER[f].items()}
        for k, v in WINTER[f].items():
            INTAKE[f][k] = INTAKE[f].get(k, 0) + v
TGT_RUN = tgt[:-1] + [None]  # ноябрь — всё, что осталось до плана
need_cum = deficits(schedule(TGT_RUN)[0])
plan8, left8 = schedule(TGT_RUN)
assert sum(left8) == 0, f"не разложено {left8}"
rtw_m = [sum(plan8[i][m] for i, r in enumerate(PR8) if r["g"] == "Одежда") for m in range(NM)]
acc_m = [sum(plan8[i][m] for i, r in enumerate(PR8) if r["g"] == "Аксессуары") for m in range(NM)]
C_ACC = max(acc_m)

ws8 = wb.create_sheet("8 План производства 2027")
ws8.sheet_properties.outlinePr = Outline(summaryBelow=False, summaryRight=False)
title(ws8, "План производства 2027 по месяцам: сколько изделий шьём, приход и расход сырья, остаток на складе (январь — ноябрь)", [
    "Одежда — по целевой загрузке (владелец 02.11): с января 50 % мощности, июль 28 % (отпуска), август–ноябрь ≈80 %, к сентябрю ≈75 % плана. Аксессуары — ровно весь год. Рысь — сентябрь–ноябрь из остатка (есть с декабря 2026).",
    "Весенний мех приходит только летом, поэтому часть закупки заложена на зимних аукционах (декабрь 2026 — февраль 2027) — сколько и к какому месяцу, см. раздел 4; общий объём закупки (лист 7) не меняется, меняются только сроки.",
    "Править: «+» слева от строки раскрывает «долю по месяцам, %» и «поправку, шт.» — штуки месяца = план × доля + поправка, ноябрь — остаток до плана. Мощность, целевая загрузка и приход сырья — жёлтые ячейки; сырьё пересчитывается само.",
    "Шкур на изделие — средняя по блоку (короткие и длинные вместе), поэтому помесячный расход сырья примерный.",
])
CAPR = 7
ws8.cell(CAPR, 1, "Мощность в месяц, изделий: одежда").font = BOLD
inp(ws8, CAPR, 3, C_TARGET, INT)
ws8.cell(CAPR, 5, "← по умолчанию — мощность, при которой целевая загрузка (строка «Целевая загрузка одежды») даёт ровно план одежды").font = NOTE
ws8.cell(CAPR + 1, 1, "Мощность в месяц, изделий: аксессуары").font = BOLD
inp(ws8, CAPR + 1, 3, C_ACC, INT)
r = CAPR + 3
ws8.cell(r, 1, "1. Производство, шт. (раскройте «+», чтобы править долю по месяцам и поправку)").font = H2
r += 1
C8 = ["Тип меха", "Блок"] + MONTHS + ["Итого", "По плану (лист 5)", "Сверка", "Шкур на изделие, среднее по блоку: свой мех (у «Норка+Соболь» — норка)", "Шкур на изделие: соболь (у «Норка+Соболь»)"]
HR8 = r
head(ws8, HR8, C8, [34, 12] + [8] * NM + [9, 11, 9, 16, 14], height=75)
r += 1
MC = lambda i: L(3 + i)
COL_TOT, COL_PLAN, COL_CHK, COL_S1, COL_S2 = 3 + NM, 4 + NM, 5 + NM, 6 + NM, 7 + NM
prow_of = {}
main_rows = {"Одежда": [], "Аксессуары": []}
for i, pr in enumerate(PR8):
    f, g, pcs = pr["f"], pr["g"], pr["pcs"]
    rm, rs, rc = r, r + 1, r + 2
    put(ws8, rm, 1, f, bold=True)
    put(ws8, rm, 2, g)
    put(ws8, rm, COL_PLAN, f'=SUMIFS({P5("E")},{P5("A")},"{f}",{P5("B")},"{g}")', INT)
    put(ws8, rs, 1, "   доля плана по месяцам, %")
    put(ws8, rs, 2, "")
    put(ws8, rc, 1, "   поправка, шт. (+/−)")
    put(ws8, rc, 2, "")
    for m in range(NM):
        inp(ws8, rs, 3 + m, round(plan8[i][m] / pcs, 6) if pcs else 0, '0.0%')
        inp(ws8, rc, 3 + m, 0, INT)
        if m < NM - 1:
            put(ws8, rm, 3 + m, f"=ROUND(${L(COL_PLAN)}{rm}*{MC(m)}{rs},0)+{MC(m)}{rc}", INT)
        else:
            put(ws8, rm, 3 + m, f"=${L(COL_PLAN)}{rm}-SUM({MC(0)}{rm}:{MC(NM-2)}{rm})", INT)
    put(ws8, rs, COL_TOT, f"=SUM({MC(0)}{rs}:{MC(NM-1)}{rs})", '0.0%')
    put(ws8, rc, COL_TOT, f"=SUM({MC(0)}{rc}:{MC(NM-1)}{rc})", INT)
    put(ws8, rm, COL_TOT, f"=SUM({MC(0)}{rm}:{MC(NM-1)}{rm})", INT)
    put(ws8, rm, COL_CHK, f'=IF(AND({L(COL_TOT)}{rm}={L(COL_PLAN)}{rm},MIN({MC(0)}{rm}:{MC(NM-1)}{rm})>=0),"✓","≠ проверить")', fill=F_OK)
    pc = f'SUMIFS({P5("E")},{P5("A")},"{f}",{P5("B")},"{g}")'
    if f == "Норка+Соболь":
        put(ws8, rm, COL_S1, f'=IFERROR(SUMIFS({P5("I")},{P5("A")},"{f}",{P5("B")},"{g}")/{pc},0)', DEC)
        put(ws8, rm, COL_S2, f'=IFERROR(SUMIFS({P5("J")},{P5("A")},"{f}",{P5("B")},"{g}")/{pc},0)', DEC)
    else:
        put(ws8, rm, COL_S1, f'=IFERROR(SUMIFS({P5("G")},{P5("A")},"{f}",{P5("B")},"{g}")/{pc},0)', DEC)
    ws8.row_dimensions.group(rs, rc, outline_level=1, hidden=True)
    prow_of[(f, g)] = rm
    main_rows[g].append(rm)
    r += 3
blk_rows = {}
for g in ("Одежда", "Аксессуары"):
    put(ws8, r, 1, f"{g} — всего", fill=F_GRP, bold=True)
    put(ws8, r, 2, "", fill=F_GRP)
    for c in list(range(3, 3 + NM)) + [COL_TOT, COL_PLAN]:
        put(ws8, r, c, "=" + "+".join(f"{L(c)}{x}" for x in main_rows[g]), INT, F_GRP, True)
    blk_rows[g] = r
    r += 1
put(ws8, r, 1, "ВСЕГО изделий", fill=F_TOT, bold=True)
put(ws8, r, 2, "", fill=F_TOT)
for c in list(range(3, 3 + NM)) + [COL_TOT, COL_PLAN]:
    put(ws8, r, c, f"={L(c)}{blk_rows['Одежда']}+{L(c)}{blk_rows['Аксессуары']}", INT, F_TOT, True)
put(ws8, r, COL_CHK, f'=IF({L(COL_TOT)}{r}={L(COL_PLAN)}{r},"✓ "&TEXT({L(COL_TOT)}{r},"0"),"≠ проверить")', fill=F_OK, bold=True)
r += 1
LOADR = {}
for g, cr in (("Одежда", CAPR), ("Аксессуары", CAPR + 1)):
    put(ws8, r, 1, f"Загрузка мощности: {g.lower()}")
    put(ws8, r, 2, "")
    for m in range(NM):
        put(ws8, r, 3 + m, f"=IFERROR({MC(m)}{blk_rows[g]}/$C${cr},0)", PCT)
    put(ws8, r, COL_TOT, f'=IF(MAX({MC(0)}{r}:{MC(NM-1)}{r})>1,"перегруз","✓ не выше 100 %")', fill=F_OK)
    LOADR[g] = r
    r += 1
put(ws8, r, 1, "Одежда: сшито нарастающим итогом, % плана")
put(ws8, r, 2, "")
for m in range(NM):
    put(ws8, r, 3 + m, f"=IFERROR(SUM(${MC(0)}{blk_rows['Одежда']}:{MC(m)}{blk_rows['Одежда']})/${L(COL_PLAN)}{blk_rows['Одежда']},0)", PCT)
CUMR = r
r += 1
put(ws8, r, 1, "Целевая загрузка одежды, % мощности")
put(ws8, r, 2, "")
for m in range(NM):
    inp(ws8, r, 3 + m, TARGET_LOAD[m], PCT)
TLR = r
r += 1
put(ws8, r, 1, "Одежда по целевой загрузке, шт.")
put(ws8, r, 2, "")
for m in range(NM):
    put(ws8, r, 3 + m, f"=ROUND($C${CAPR}*{MC(m)}{TLR},0)", INT)
put(ws8, r, COL_TOT, f"=SUM({MC(0)}{r}:{MC(NM-1)}{r})", INT)
r += 1
put(ws8, r, 1, "Одежда по целевой загрузке: нарастающим итогом, % плана")
put(ws8, r, 2, "")
for m in range(NM):
    put(ws8, r, 3 + m, f"=IFERROR(SUM(${MC(0)}{r-1}:{MC(m)}{r-1})/${L(COL_PLAN)}{blk_rows['Одежда']},0)", PCT)
r += 2

# --- приход сырья по месяцам, доли
ws8.cell(r, 1, "2. Приход купленного сырья на склад по месяцам, % от закупки (лист 7); в работу — с месяца после прихода").font = H2
r += 1
head(ws8, r, ["Тип меха", ""] + MONTHS + ["Итого"], height=30)
r += 1
INR = {}
for f in FURS:
    put(ws8, r, 1, f, bold=True)
    put(ws8, r, 2, "")
    for m in range(NM):
        inp(ws8, r, 3 + m, INTAKE[f].get(m + 1, 0), PCT)
    put(ws8, r, COL_TOT, f"=SUM({MC(0)}{r}:{MC(NM-1)}{r})", PCT)
    INR[f] = r
    r += 1
ws8.cell(r, 1, "Январь–май — приход с зимних аукционов (раздел 4). Летний — по датам прихода лотов 2025–2026: соболь РП/СП весна — июнь–июль, СП осень — сентябрь; норка SAGA март — июль–август, AME май — сентябрь; каракульча и лиса — июль–август; рысь FH июнь — октябрь.").font = NOTE
r += 2

# --- сырьё по видам меха
ws8.cell(r, 1, "3. Сырьё по месяцам, шк.: остаток на начало → приход → расход на шитьё → остаток на конец").font = H2
r += 1
head(ws8, r, ["Тип меха", "Строка"] + MONTHS + ["Итого"], height=30)
r += 1
L4 = lambda col, f: f"'4 Остаток на конец 2026'!{col}{LEFT_ROW[f]}"
for f in FURS:
    tr = tot_rows[FURS.index(f)]
    r0 = r
    labels = ["Остаток на начало месяца", "Приход (закупка 2027)", "Расход на шитьё", "Остаток на конец месяца", "в т.ч. невостребованное (в расход не идёт)", "Годный остаток на конец месяца"]
    for k, lab in enumerate(labels):
        put(ws8, r0 + k, 1, f if k == 0 else "", bold=k == 0, fill=F_FUR if k == 0 else None)
        put(ws8, r0 + k, 2, lab, fill=F_FUR if k == 0 else None)
    for m in range(NM):
        c = MC(m)
        put(ws8, r0, 3 + m, f"={L4('K', f)}" if m == 0 else f"={MC(m-1)}{r0+3}", INT, F_FUR)
        put(ws8, r0 + 1, 3 + m, f"='7 Расчёт закупки 2027'!$K${tr}*{c}{INR[f]}", INT)
        parts = []
        for (pf, pg), pr in prow_of.items():
            if pf == f:
                parts.append(f"{c}{pr}*${L(COL_S1)}{pr}")
            elif pf == "Норка+Соболь" and f in ("Норка", "Соболь"):
                parts.append(f"{c}{pr}*${L(COL_S1 if f == 'Норка' else COL_S2)}{pr}")
        put(ws8, r0 + 2, 3 + m, "=" + ("+".join(parts) if parts else "0"), INT)
        put(ws8, r0 + 3, 3 + m, f"={c}{r0}+{c}{r0+1}-{c}{r0+2}", INT, bold=True)
        put(ws8, r0 + 4, 3 + m, f"='7 Расчёт закупки 2027'!$F${tr}", INT)
        put(ws8, r0 + 5, 3 + m, f"={c}{r0+3}-{c}{r0+4}", INT)
    put(ws8, r0, COL_TOT, None, fill=F_FUR)
    put(ws8, r0 + 1, COL_TOT, f"=SUM({MC(0)}{r0+1}:{MC(NM-1)}{r0+1})", INT)
    put(ws8, r0 + 2, COL_TOT, f"=SUM({MC(0)}{r0+2}:{MC(NM-1)}{r0+2})", INT)
    put(ws8, r0 + 3, COL_TOT, f"={MC(NM-1)}{r0+3}", INT, bold=True)
    put(ws8, r0 + 4, COL_TOT, None)
    put(ws8, r0 + 5, COL_TOT, f'=IF(MIN({MC(0)}{r0+5}:{MC(NM-1)}{r0+5})<0,"≠ не хватает — сдвиньте шитьё","✓ хватает")', fill=F_OK)
    r = r0 + len(labels)
ws8.cell(r, 1, "Расход за год = шкур на план 2027 (лист 7); остаток на конец ноября = «всего останется после 2027» листа 7. Проверка по меху целиком; распределение между одеждой и аксессуарами — как на листе 7.").font = NOTE
r += 2

# --- что нужно для целевой загрузки
ws8.cell(r, 1, "4. Закупка на зимних аукционах (декабрь 2026 — февраль 2027), чтобы шить одежду по целевой загрузке").font = H2
r += 1
ws8.cell(r, 1, "Сколько шкур должно прийти к началу месяца, чтобы не встать: остальная закупка — летом, как обычно. Где покупать — СП (соболь, декабрь; в 2025 пришёл в том же месяце), зимние продажи SAGA (норка, каракульча, лиса) — уточнить у Веллмеха сроки и выделку.").font = NOTE
r += 1
head(ws8, r, ["Тип меха", "", "Закупить зимой, шк.", "Доля закупки 2027", "Должно прийти (месяц)", "Без зимней закупки не хватило бы, шк. (макс.)", "к месяцу"], height=45)
r += 1
for f in FURS:
    w_ = WINTER[f]
    qty = sum(v for v in w_.values()) * buy_v[f]
    put(ws8, r, 1, f, bold=True)
    put(ws8, r, 2, "")
    put(ws8, r, 3, f"='7 Расчёт закупки 2027'!$K${tot_rows[FURS.index(f)]}*({'+'.join(f'{MC(k-1)}{INR[f]}' for k in sorted(w_)) or '0'})" if w_ else 0, INT, bold=True)
    put(ws8, r, 4, f"=IFERROR(C{r}/'7 Расчёт закупки 2027'!$K${tot_rows[FURS.index(f)]},0)", PCT)
    put(ws8, r, 5, ", ".join(MONTHS[k - 1] for k in sorted(w_)) if w_ else "не нужно")
    mx = max(need_base[f])
    put(ws8, r, 6, round(mx), INT)
    put(ws8, r, 7, MONTHS[need_base[f].index(mx)] if mx >= 0.5 else "—")
    r += 1
r += 1
ws8.cell(r, 1, "Проверка: сколько не хватает к концу месяца при приходе выше (на момент построения файла; должно быть 0)").font = NOTE
r += 1
head(ws8, r, ["Тип меха", ""] + MONTHS + ["Макс."], height=30)
r += 1
for f in FURS:
    put(ws8, r, 1, f, bold=True)
    put(ws8, r, 2, "")
    for m in range(NM):
        put(ws8, r, 3 + m, round(need_cum[f][m]), INT)
    put(ws8, r, COL_TOT, round(max(need_cum[f])), INT, bold=True)
    r += 1
ws8.freeze_panes = f"C{HR8+1}"

for ws in wb.worksheets:
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 0
wb.calculation.fullCalcOnLoad = True
wb.save(OUT)
print("сохранено:", OUT)
