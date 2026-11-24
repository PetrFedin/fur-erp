import { auctionName } from "../../auction-names";
import { auctionKey } from "../../auction-key";

import type { Violation } from "../types";

import { CheckDef } from "../checks-base";

/** Проверки раздела «Справочники и кэш-тексты». */
export const REF_CHECKS: CheckDef[] = [
  {
    id: "cache-auction",
    title: "Аукцион в закупке = запись справочника",
    group: "Справочники",
    severity: "warn",
    tolerance: "нет",
    what: "Purchase.auctionSession (кэш-текст) совпадает с именем аукциона из справочника (или его прежним написанием), а у закупки с аукционом заполнена ссылка на справочник.",
    fix: "Настройки → Аукционы: переименование обновляет закупки, оплаты и документы одной транзакцией; закупка → выбрать аукцион из справочника.",
    run: ({ d, helpers: h }) => {
      const byId = new Map(d.auctions.map((a) => [a.id, a]));
      const v: Violation[] = [];
      let n = 0;
      for (const p of d.purchases) {
        const text = auctionName(p.auctionSession);
        if (!text) continue;
        n++;
        const a = p.auctionId ? byId.get(p.auctionId) : undefined;
        if (!p.auctionId) {
          v.push({ key: `${p.id}:noref`, message: `${h.ref.purchase(p).label}: аукцион «${text}» записан текстом, без ссылки на справочник`, delta: null, unit: "", entity: h.ref.purchase(p), href: h.href.purchase(p.id) });
        } else if (!a) {
          v.push({ key: `${p.id}:gone`, message: `${h.ref.purchase(p).label}: ссылка на аукцион, которого нет в справочнике`, delta: null, unit: "", entity: h.ref.purchase(p), href: h.href.purchase(p.id) });
        } else if (auctionKey(text) !== auctionKey(a.name) && !a.aliases.some((x) => auctionKey(x) === auctionKey(text))) {
          v.push({ key: `${p.id}:stale`, message: `${h.ref.purchase(p).label}: в закупке «${text}», в справочнике аукцион называется «${a.name}»`, delta: null, unit: "", entity: h.ref.purchase(p), href: h.href.purchase(p.id) });
        }
      }
      return { checked: n, violations: v };
    },
  },
  {
    id: "cache-color",
    title: "Цвет в лоте, позиции и ТЗ = справочник цветов",
    group: "Справочники",
    severity: "warn",
    tolerance: "нет",
    what: "Если у лота/ТЗ выбран цвет из справочника, текст цвета совпадает с названием в справочнике.",
    fix: "Настройки → Цвета: переименование обновляет все записи; либо правка цвета в лоте/ТЗ.",
    run: ({ d, helpers: h }) => {
      const v: Violation[] = [];
      let n = 0;
      for (const l of d.lots) {
        if (!l.colorRefId) continue;
        n++;
        if ((l.color ?? "") !== (l.colorRefName ?? "") && !l.colorRefAliases.includes(l.color ?? "")) v.push({ key: `lot:${l.id}`, message: `${h.ref.lot(l).label}: цвет «${l.color ?? ""}», в справочнике «${l.colorRefName}»`, delta: null, unit: "", entity: h.ref.lot(l), href: h.href.lot(l.id) });
      }
      for (const o of d.orders) {
        if (!o.colorRefId) continue;
        n++;
        if ((o.color ?? "") !== (o.colorRefName ?? "") && !o.colorRefAliases.includes(o.color ?? "") && !(o.color ?? "").includes("×")) v.push({ key: `order:${o.id}`, message: `${h.ref.order(o).label}: цвет «${o.color ?? ""}», в справочнике «${o.colorRefName}»`, delta: null, unit: "", entity: h.ref.order(o), href: h.href.order(o.id) });
      }
      return { checked: n, violations: v };
    },
  },
  {
    id: "cache-category",
    title: "Категория изделия = справочник категорий",
    group: "Справочники",
    severity: "warn",
    tolerance: "нет",
    what: "ProductModel.category (кэш-текст) совпадает с названием выбранной категории из справочника.",
    fix: "Настройки → Категории: переименование обновляет изделия; либо карточка изделия.",
    run: ({ d }) => {
      const v: Violation[] = [];
      let n = 0;
      for (const m of d.models) {
        if (!m.categoryRefId) continue;
        n++;
        if ((m.category ?? "") !== (m.categoryRefName ?? "")) v.push({ key: m.id, message: `Изделие «${m.name}»: категория «${m.category ?? ""}», в справочнике «${m.categoryRefName}»`, delta: null, unit: "", entity: { kind: "model", id: m.id, label: `Изделие ${m.name}` }, href: `/models/${m.id}` });
      }
      return { checked: n, violations: v };
    },
  },
  {
    id: "cache-lot-item",
    title: "Лот совпадает с позицией закупки (номер, сорт, цвет)",
    group: "Справочники",
    severity: "warn",
    tolerance: "нет",
    what: "Номер лота, сорт и цвет в лоте и в его единственной позиции закупки одинаковы (правка из любого места обновляет оба).",
    fix: "Лот → «Править» (обновляет и позицию закупки) либо позиция в закупке.",
    run: ({ d, helpers: h }) => {
      const norm = (s: string | null) => (s ?? "").trim();
      const v: Violation[] = [];
      let n = 0;
      for (const l of d.lots) {
        if (l.items.length !== 1) continue;
        n++;
        const i = l.items[0];
        const diffs: string[] = [];
        if (norm(l.lotNumber) !== norm(i.lotNumber)) diffs.push(`номер «${norm(l.lotNumber)}» / «${norm(i.lotNumber)}»`);
        if (norm(l.grade) !== norm(i.grade)) diffs.push(`сорт «${norm(l.grade)}» / «${norm(i.grade)}»`);
        if (norm(l.color) !== norm(i.color)) diffs.push(`цвет «${norm(l.color)}» / «${norm(i.color)}»`);
        if (diffs.length) {
          const p = l.purchaseId ? h.purchaseById.get(l.purchaseId) : undefined;
          v.push({ key: l.id, message: `${h.ref.lot(l).label}: лот и позиция закупки различаются — ${diffs.join("; ")}`, delta: null, unit: "", entity: p ? h.ref.purchase(p) : h.ref.lot(l), href: h.href.lot(l.id), also: [h.ref.lot(l)] });
        }
      }
      return { checked: n, violations: v };
    },
  },

];
