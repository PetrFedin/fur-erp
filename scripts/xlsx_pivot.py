"""Сводные таблицы Excel (PivotTable) через openpyxl: кэш на диапазоне листа данных, строки, значения, вычисляемые поля.
Кэш без записей и с refreshOnLoad — Excel строит сводную при открытии файла (Данные → Обновить всё — после правок данных)."""
from openpyxl.pivot.cache import CacheDefinition, CacheField, CacheSource, SharedItems, WorksheetSource
from openpyxl.pivot.fields import Number, Text
from openpyxl.pivot.table import DataField, FieldItem, Location, PivotField, PivotTableStyle, RowColField, TableDefinition

_next_cache = [100]


def add_pivot(target_ws, src_ws, header_row, last_row, headers, rows, values, name, calc=(), anchor="A4"):
    """headers — заголовки столбцов листа данных (по порядку, начиная с A); rows — поля в строки (по порядку);
    values — [(подпись, поле или вычисляемое поле, numFmtId)]; calc — [(имя, формула Excel по именам полей в кавычках)]."""
    from openpyxl.utils import get_column_letter as L
    ref = f"A{header_row}:{L(len(headers))}{last_row}"
    fields = []
    for i, h in enumerate(headers):
        if h in rows:
            vals = []
            for r in range(header_row + 1, last_row + 1):
                v = src_ws.cell(r, i + 1).value
                if v is not None and v not in vals:
                    vals.append(v)
            num = all(isinstance(v, (int, float)) for v in vals)
            items = [Number(v=v) for v in vals] if num else [Text(v=str(v)) for v in vals]
            si = SharedItems(_fields=items, count=len(items), containsNumber=True if num else None, containsInteger=True if num else None,
                             containsString=False if num else None, containsSemiMixedTypes=False if num else None)
            fields.append((h, CacheField(name=h, numFmtId=0, sharedItems=si), len(items)))
        else:
            fields.append((h, CacheField(name=h, numFmtId=0, sharedItems=SharedItems()), 0))
    for cname, formula in calc:
        fields.append((cname, CacheField(name=cname, numFmtId=0, formula=formula, databaseField=False, sharedItems=None), -1))
    cache = CacheDefinition(refreshOnLoad=True, createdVersion=6, refreshedVersion=6, minRefreshableVersion=3, recordCount=0,
                            cacheSource=CacheSource(type="worksheet", worksheetSource=WorksheetSource(ref=ref, sheet=src_ws.title)),
                            cacheFields=[f[1] for f in fields])
    idx = {f[0]: i for i, f in enumerate(fields)}
    data_names = {v[1] for v in values}
    pf = []
    for h, _, n in fields:
        if h in rows:
            pf.append(PivotField(axis="axisRow", showAll=False, compact=False, outline=True, items=[FieldItem(x=i) for i in range(n)] + [FieldItem(t="default")]))
        elif n == -1:
            pf.append(PivotField(dataField=True, showAll=False, dragToRow=False, dragToCol=False, dragToPage=False, compact=False))
        else:
            pf.append(PivotField(dataField=True if h in data_names else None, showAll=False, compact=False))
    _next_cache[0] += 1
    t = TableDefinition(name=name, cacheId=_next_cache[0], dataCaption="Значения", updatedVersion=6, minRefreshableVersion=3, createdVersion=6,
                        compact=False, compactData=False, outline=True, outlineData=True, indent=0, applyNumberFormats=False, applyBorderFormats=False,
                        applyFontFormats=False, applyPatternFormats=False, applyAlignmentFormats=False, applyWidthHeightFormats=True, itemPrintTitles=True,
                        location=Location(ref=f"{anchor}:{anchor}", firstHeaderRow=1, firstDataRow=1, firstDataCol=1),
                        pivotFields=pf, rowFields=[RowColField(x=idx[r]) for r in rows],
                        colFields=[RowColField(x=-2)] if len(values) > 1 else [],
                        dataFields=[DataField(name=cap, fld=idx[f], subtotal="sum", baseField=0, baseItem=0, numFmtId=fmt) for cap, f, fmt in values],
                        pivotTableStyleInfo=PivotTableStyle(name="PivotStyleMedium2", showRowHeaders=True, showColHeaders=True, showRowStripes=False, showColStripes=False, showLastColumn=True))
    t.cache = cache
    target_ws._pivots.append(t)
    return t
