#!/usr/bin/env python3
"""Добавляет в xlsx настоящую сводную таблицу Excel (лист «Пивот») по листу «Данные».

Файл собирает scripts/gen-fw26-massiv-xlsx.ts с EXCEL_PIVOT=1 (лист «Данные» + пустой лист «Пивот»).
Здесь пишутся части OOXML: кэш сводной (pivotCacheDefinition, без записей: Excel обновляет его при открытии),
определение таблицы (pivotTable) и связи. Строки: Категория 1 → Тип меха → Категория 2; значения — суммы по числовым столбцам.

  python3 scripts/add-excel-pivot.py файл.xlsx
"""
import re
import shutil
import sys
import zipfile
from xml.sax.saxutils import escape, quoteattr

import openpyxl

path = sys.argv[1]
HEAD_ROW = 3
wb = openpyxl.load_workbook(path)
ws = wb["Данные"]
ncol = ws.max_column
# последняя строка данных: до пустой строки перед «Итого»
last = HEAD_ROW
for r in range(HEAD_ROW + 1, ws.max_row + 1):
    if ws.cell(r, 1).value in (None, "") or str(ws.cell(r, 1).value).startswith("Итого"):
        break
    last = r
heads = [ws.cell(HEAD_ROW, c).value for c in range(1, ncol + 1)]
rows = [[ws.cell(r, c).value for c in range(1, ncol + 1)] for r in range(HEAD_ROW + 1, last + 1)]
n = len(rows)

TXT = [0, 1, 2, 3, 4]  # тип меха, кат. 1, кат. 2, артикул, цвет
ROWF = [1, 0, 2]  # порядок строк сводной: кат. 1 → мех → кат. 2
DATAF = [i for i, h in enumerate(heads) if i >= 5 and not str(h).startswith("MU:")]

def order(col, vals):
    u = sorted(set(vals), key=lambda x: str(x).lower())
    if col == 1:
        u.sort(key=lambda x: {"Одежда": 0, "Аксессуары": 1}.get(x, 9))
    return u

items = {c: order(c, [r[c] if r[c] not in (None, "") else "(пусто)" for r in rows]) for c in TXT}
idx = {c: {v: i for i, v in enumerate(items[c])} for c in TXT}
val = lambda r, c: r[c] if r[c] not in (None, "") else "(пусто)"

# --- pivotCacheDefinition
fields = []
for c, h in enumerate(heads):
    if c in TXT:
        si = "".join(f"<s v={quoteattr(str(v))}/>" for v in items[c])
        fields.append(f'<cacheField name={quoteattr(str(h))} numFmtId="0"><sharedItems count="{len(items[c])}">{si}</sharedItems></cacheField>')
    else:
        nums = [r[c] or 0 for r in rows]
        integer = all(float(x).is_integer() for x in nums)
        fields.append(f'<cacheField name={quoteattr(str(h))} numFmtId="0"><sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1"{" containsInteger=\"1\"" if integer else ""} minValue="{min(nums)}" maxValue="{max(nums)}"/></cacheField>')
NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
cache = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheDefinition {NS} saveData="0" refreshOnLoad="1" refreshedBy="МехУчёт" refreshedDate="46332" createdVersion="6" refreshedVersion="6" minRefreshableVersion="3" recordCount="{n}">'
         f'<cacheSource type="worksheet"><worksheetSource ref="A{HEAD_ROW}:{openpyxl.utils.get_column_letter(ncol)}{last}" sheet="Данные"/></cacheSource>'
         f'<cacheFields count="{ncol}">{"".join(fields)}</cacheFields></pivotCacheDefinition>')

# --- pivotTable
pf = []
for c in range(ncol):
    if c in ROWF:
        its = "".join(f'<item x="{i}"/>' for i in range(len(items[c]))) + '<item t="default"/>'
        pf.append(f'<pivotField axis="axisRow" showAll="0"><items count="{len(items[c]) + 1}">{its}</items></pivotField>')
    elif c in DATAF:
        pf.append('<pivotField dataField="1" showAll="0"/>')
    else:
        pf.append('<pivotField showAll="0"/>')

tree = {}
for r in rows:
    tree.setdefault(val(r, 1), {}).setdefault(val(r, 0), set()).add(val(r, 2))
ri = []
for c1 in items[1]:
    if c1 not in tree:
        continue
    ri.append(f'<i><x v="{idx[1][c1]}"/></i>')
    for fur in items[0]:
        if fur not in tree[c1]:
            continue
        ri.append(f'<i r="1"><x v="{idx[0][fur]}"/></i>')
        for c2 in items[2]:
            if c2 in tree[c1][fur]:
                ri.append(f'<i r="2"><x v="{idx[2][c2]}"/></i>')
ri.append('<i t="grand"><x/></i>')
ci = '<i><x/></i>' + "".join(f'<i i="{k}"><x v="{k}"/></i>' for k in range(1, len(DATAF))) + ''
dfs = "".join(f'<dataField name={quoteattr("Σ " + str(heads[c]))} fld="{c}" baseField="0" baseItem="0" numFmtId="3"/>' for c in DATAF)
first_row = 3
last_row = first_row + len(ri)
loc = f'A{first_row}:{openpyxl.utils.get_column_letter(1 + len(DATAF))}{last_row}'
pt = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotTableDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="ПивотFW26" cacheId="1" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="Значения" updatedVersion="6" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="6" indent="0" outline="1" outlineData="1" multipleFieldFilters="0" rowHeaderCaption="Категория 1 → тип меха → категория 2">'
      f'<location ref="{loc}" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/>'
      f'<pivotFields count="{ncol}">{"".join(pf)}</pivotFields>'
      f'<rowFields count="{len(ROWF)}">{"".join(f"<field x=\"{c}\"/>" for c in ROWF)}</rowFields>'
      f'<rowItems count="{len(ri)}">{"".join(ri)}</rowItems>'
      f'<colFields count="1"><field x="-2"/></colFields><colItems count="{len(DATAF)}">{ci}</colItems>'
      f'<dataFields count="{len(DATAF)}">{dfs}</dataFields>'
      '<pivotTableStyleInfo name="PivotStyleMedium2" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>')

# --- пересборка пакета
tmp = path + ".tmp"
with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == "[Content_Types].xml":
            t = data.decode("utf-8")
            t = t.replace("</Types>", '<Override PartName="/xl/pivotCache/pivotCacheDefinition1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/><Override PartName="/xl/pivotTables/pivotTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/></Types>')
            data = t.encode("utf-8")
        elif item.filename == "xl/workbook.xml":
            t = data.decode("utf-8")
            t = re.sub(r"(<calcPr[^>]*/>)", r'\1<pivotCaches><pivotCache cacheId="1" r:id="rIdPC1"/></pivotCaches>', t)
            data = t.encode("utf-8")
        elif item.filename == "xl/_rels/workbook.xml.rels":
            t = data.decode("utf-8")
            t = t.replace("</Relationships>", '<Relationship Id="rIdPC1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/></Relationships>')
            data = t.encode("utf-8")
        zout.writestr(item, data)
    zout.writestr("xl/pivotCache/pivotCacheDefinition1.xml", cache)
    zout.writestr("xl/pivotTables/pivotTable1.xml", pt)
    zout.writestr("xl/pivotTables/_rels/pivotTable1.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition1.xml"/></Relationships>')
    zout.writestr("xl/worksheets/_rels/sheet2.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable" Target="../pivotTables/pivotTable1.xml"/></Relationships>')
shutil.move(tmp, path)
print("сводная добавлена:", path, "строк данных", n, "строк сводной", len(ri), "значений", len(DATAF))
