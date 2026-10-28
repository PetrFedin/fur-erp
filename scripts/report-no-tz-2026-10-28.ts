import "./stubs/server-only-shim";
(async()=>{
const {createAuditedClient}=await import("../src/lib/prisma");
const {loadModelCosts}=await import("../src/lib/margin-server");
const {normCode}=await import("../src/lib/sales-receipts-core");
const ExcelJS=(await import("exceljs")).default;
const p=createAuditedClient("script:otchet-bez-tz");
const org=await p.organization.findFirstOrThrow({orderBy:{createdAt:"asc"}});
const N=(s:string)=>s.replace(/[-\s_/.]/g,"").toUpperCase();
const WANT=["M012","M045","M046","M011A","M023","M026","M038","M039"];
const costs=await loadModelCosts(org.id,"on" as never);
const st:any=await p.systemState.findFirst({where:{key:"sales-report-sizes:2026-10-27"}});
const rep=st.value.rows as any[];
const models=await p.productModel.findMany({where:{organizationId:org.id},select:{id:true,name:true,salesCode:true,aliases:true,category:true,productionOrders:{where:{status:{not:"CANCELLED"}},select:{number:true,workOrderNumber:true,color:true,plannedQuantity:true,producedQuantity:true,status:true,endDate:true,workOrderDate:true,startDate:true,totalCost:true},orderBy:{number:"asc"}}}});
const keyOf=new Map<string,string>();for(const m of models)for(const k of [m.name,m.salesCode,...(m.aliases||[])])if(k){keyOf.set(N(k),m.id);const b=N(k.split(/[ /+]/)[0]);if(!keyOf.has(b))keyOf.set(b,m.id)}
const colorRefs=await p.colorRef.findMany({where:{organizationId:org.id},select:{name:true,aliases:true}});
const MAP:Record<string,string[]>={BGL:["блэкглама","чёрн","черн"],BLACK:["чёрн","черн"],BROWN:["коричнев"],LVD:["лаванд"],IRIS:["ирис"],PEARL:["жемчуг","перл","светло-беж","беж"],BORDEAUX:["бордов"],WHITE:["бел"],TORTORA:["беж","тортора"],NATURAL:["коричнев","натурал"],PASTEL:["пастел"]};
const ruColors=(art:string)=>{const tok=art.toUpperCase();const hits:string[]=[];for(const [k,v] of Object.entries(MAP))if(tok.includes(k))hits.push(...v);for(const c of colorRefs)for(const a of [c.name,...c.aliases])if(a&&tok.includes(a.toUpperCase()))hits.push(c.name.toLowerCase());return [...new Set(hits)]};
const rc=await p.salesReceiptLine.findMany({where:{organizationId:org.id,kind:"RECEIPT"},select:{article:true,modelCode:true,season:true,orderNo:true,date:true,pcs:true,retailRub:true,level4:true},orderBy:{date:"asc"}});
const wb=new ExcelJS.Workbook();
const clr=wb.addWorksheet("Сверх ТЗ по цветам");
clr.addRow(["Модель","Артикул (цвет)","Цвет по справочнику","Получено по артикулу, шт.","Заказано в ТЗ этого цвета, шт.","ТЗ этого цвета","Получено сверх ТЗ по цвету, шт.","Вывод"]);
const sum=wb.addWorksheet("Сводка"),lines=wb.addWorksheet("Приход по строкам"),tz=wb.addWorksheet("ТЗ моделей"),sz=wb.addWorksheet("Отчёт по размерам");
sum.addRow(["Товары, полученные сверх объёма ТЗ (на 28.10.2026). Приход MVST РМ 2025–2026 против ТЗ в системе. Стоимость сверх ТЗ = шт. × средняя себестоимость единицы модели (мех, подкладка, работа, 4%, с НДС); у модели без ТЗ себестоимости нет."]);
sum.addRow([]);
sum.addRow(["Модель","Изделие","Получено всего, шт.","Объём ТЗ (без отмен.), шт.","Получено сверх ТЗ, шт.","Себестоимость ед., ₽ с НДС","Стоимость сверх ТЗ, ₽","Заказано по отчёту (Conf), шт.","Пришло по отчёту (Delivery), шт.","Вывод"]);
let totOver=0,totCost=0;
for(const w of WANT){
 const m=models.find(x=>N(x.name)===w||N(x.salesCode||"")===w);
 const mrec=rc.filter(r=>{const id=keyOf.get(N(r.modelCode||""))??keyOf.get(N(r.article.split(/[ /+]/)[0]));return m&&id===m.id});
 const R=mrec.reduce((a,r)=>a+(r.pcs||0),0);
 const tzs=m?.productionOrders||[];
 const Q=tzs.reduce((a,o)=>a+(o.status==="COMPLETED"?Number(o.producedQuantity):Number(o.plannedQuantity)),0);
 const over=Math.max(0,R-Q);
 const c=costs.get(normCode(m?.name||w));const unit=c?c.unitIncl:null;
 const mrep=rep.filter(r=>N(r.modelCode||"")===w||N(r.acode).startsWith(w));
 const conf=mrep.reduce((a,r)=>a+(r.conf||0),0),del=mrep.reduce((a,r)=>a+(r.deliv||0),0);
 totOver+=over;if(unit)totCost+=over*unit;
 sum.addRow([m?.name||w,m?.category||"",R,Q,over,unit?Math.round(unit):"нет ТЗ",unit?Math.round(over*unit):"нет себестоимости",conf,del,
  tzs.length===0?"ТЗ на модель нет совсем: заказывали MVST по отчёту, у нас ТЗ не заведены (аналог: M038, та же норка с соболем)":over>0?`получено на ${over} шт. больше, чем в ТЗ: нужно заводить ТЗ или уточнить приход`:"в рамках ТЗ"]);
 // строки прихода: сверх ТЗ — последние по дате после покрытия объёма ТЗ
 const byArt=new Map<string,number>();for(const r of mrec)byArt.set(r.article,(byArt.get(r.article)||0)+(r.pcs||0));
 for(const [art,got] of byArt){const ru=ruColors(art);const match=tzs.filter(o=>ru.some(t=>(o.color||"").toLowerCase().includes(t)));const q=match.reduce((a,o)=>a+(o.status==="COMPLETED"?Number(o.producedQuantity):Number(o.plannedQuantity)),0);
  clr.addRow([m?.name||w,art,ru.join(" / ")||"—",got,q,match.map(o=>`${o.number} (${o.color}, ${o.status==="COMPLETED"?Number(o.producedQuantity):Number(o.plannedQuantity)} шт.)`).join("; ")||"ТЗ этого цвета нет",Math.max(0,got-q),tzs.length===0?"ТЗ на модель нет":ru.length===0?"цвет в названии артикула не указан: сверка только по модели (см. «Сводка»)":got>q?(match.length?"получено больше, чем в ТЗ этого цвета":"цвет в ТЗ не заказывали"):"в рамках ТЗ"])}
 let cum=0;
 for(const r of mrec){const q=r.pcs||0;const before=cum;cum+=q;const ex=q>0?Math.max(0,Math.min(q,cum-Math.max(Q,before))):0;
  lines.addRow([m?.name||w,r.article,r.level4||"",ruColors(r.article).join(" / ")||"—",r.season,r.orderNo,r.date.toISOString().slice(0,10),q,r.retailRub==null?"":Number(r.retailRub),ex>0?`СВЕРХ ТЗ ${ex} шт.`:"в рамках ТЗ"])}
 for(const o of tzs)tz.addRow([m?.name||w,o.number,o.workOrderNumber??"",o.color??"",o.status==="COMPLETED"?"завершено":o.status==="IN_PROGRESS"?"в работе":"запланировано",Number(o.plannedQuantity),Number(o.producedQuantity),(o.endDate??o.workOrderDate??o.startDate)?.toISOString().slice(0,10)??"",o.totalCost?Number(o.totalCost):""]);
 for(const r of mrep)sz.addRow([m?.name||w,r.acode,r.color,r.size,r.conf||0,r.deliv||0,r.sold||0,r.stock||0,r.fw26Conf||0,r.fw26Deliv||0]);
}
sum.addRow([]);sum.addRow(["ИТОГО","",rc.filter(r=>WANT.some(w=>(keyOf.get(N(r.modelCode||""))??"")===models.find(x=>N(x.name)===w)?.id)).reduce((a,r)=>a+(r.pcs||0),0),"",totOver,"",Math.round(totCost)]);
lines.insertRow(1,["Модель","Артикул (цвет)","Изделие","Цвет по справочнику","Сезон","Заказ №","Дата прихода","Шт.","Розница, ₽ (из файла)","Статус"]);
tz.insertRow(1,["Модель","ТЗ №","ТЗ в документе","Цвет","Статус","План, шт.","Факт, шт.","Дата","Себестоимость ТЗ, ₽"]);
sz.insertRow(1,["Модель","Артикул","Цвет","Размер","Заказано (Conf)","Пришло (Delivery)","Продано","Остаток","FW26/27 заказано","FW26/27 пришло"]);
clr.getRow(1).font={bold:true};clr.columns.forEach(c=>{c.width=24});clr.getColumn(6).width=60;clr.getColumn(8).width=40;
for(const ws of [sum,lines,tz,sz]){ws.getRow(ws===sum?3:1).font={bold:true};ws.columns.forEach(c=>{c.width=22})}
sum.getColumn(1).width=12;sum.getColumn(10).width=80;sum.getRow(1).alignment={wrapText:true};
await wb.xlsx.writeFile(process.argv[2]);
console.log("итого сверх ТЗ шт.",totOver,"сумма",Math.round(totCost));
await p.$disconnect();})();
