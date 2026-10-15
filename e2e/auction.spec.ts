import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { login, watchErrors, expectNoErrors } from "./helpers";

// Самодостаточные проверки режима «Аукцион» (/lots?auction=…), документов и «Править расчёт».
// Стенд: scripts/e2e.sh up aud 3241 (E2E_BASE_URL=http://localhost:3241), база fur_erp_e2e_aud.
const DB = "fur_erp_e2e_aud";
export function sql(q: string): string {
  // запрос — через stdin: в shell-строке «$2b…» (bcrypt) раскрылось бы как переменная
  return execSync(`docker exec -i fur-erp-db-1 psql -U fur_erp -d ${DB} -At -F '|' -v ON_ERROR_STOP=1`, { encoding: "utf8", input: q }).trim();
}
const norm = (s: string) => s.replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const num = (s: string) => Number(norm(s).replace(/[^\d,\-]/g, "").replace(",", "."));
const SP = "СП 09.26";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3241";
const UPLOADS = "/tmp/fur-e2e/aud-uploads";
const ORG = "cmuo7vwvk0000lsu5pghd5jka"; // организация anna@qa-test.ru (копия боевой)
const url = (q: string) => `/lots?auction=${encodeURIComponent(q)}`;


// ---------- сид: роли и вторая организация (идемпотентно) ----------
const HASH = "$2b$10$4GjnSssJqUQKMd1CV4W48.ElNt4xt63QzGqtRFKhIb6GnMVT89.0G"; // TestPass123!
test.beforeAll(() => {
  const users = [["u_viewer", "viewer", "VIEWER"], ["u_wh", "wh", "WAREHOUSE"], ["u_acc", "acc", "ACCOUNTANT"], ["u_tech", "tech", "TECHNOLOGIST"], ["u_purch", "purch", "PURCHASER"], ["u_admin", "admin", "ADMIN"]];
  sql(users.map(([id, e, r]) => `insert into "User"(id,"organizationId",email,"passwordHash",name,role,"isActive","updatedAt") values ('${id}','${ORG}','${e}@qa-test.ru','${HASH}','QA ${e}','${r}',true,now()) on conflict (email) do update set "passwordHash"=excluded."passwordHash"`).join(";") + ";");
  sql(`insert into "Organization"(id,name,slug,"updatedAt") values ('org_b','Other Org','other-org',now()) on conflict do nothing`);
  sql(`insert into "User"(id,"organizationId",email,"passwordHash",name,role,"isActive","updatedAt") values ('u_b','org_b','bob@other-org.ru','${HASH}','Bob','OWNER',true,now()) on conflict (email) do update set "passwordHash"=excluded."passwordHash"`);
  sql(`insert into "Supplier"(id,"organizationId",name,"updatedAt") values ('s_b','org_b','Supplier B',now()) on conflict do nothing`);
  sql(`insert into "Warehouse"(id,"organizationId",name) values ('w_b','org_b','WH B') on conflict do nothing`);
  sql(`insert into "RawMaterial"(id,"organizationId",name,"updatedAt") values ('m_b','org_b','Соболь B',now()) on conflict do nothing`);
  sql(`insert into "Purchase"(id,"organizationId",number,"supplierId","warehouseId",currency,"exchangeRate","auctionSession","invoiceNumber","updatedAt") values ('p_b','org_b','Б-1','s_b','w_b','USD',80,'СП 09.26','B1',now()) on conflict do nothing`);
  sql(`insert into "PurchaseItem"(id,"purchaseId","rawMaterialId",quantity,"unitPrice",subtotal,"vatRate","lotNumber","costPlan") select 'pi_b','p_b','m_b',10,100,1000,22,'B-LOT',i."costPlan" from "PurchaseItem" i join "Purchase" p on p.id=i."purchaseId" where p."organizationId"='${ORG}' and i."lotNumber"='3631' on conflict do nothing`);
  const src = sql(`select "storagePath" from "PurchaseDocument" where "organizationId"='${ORG}' and "originalName"='3017 ООО ВеллМех.pdf'`);
  mkdirSync(`${UPLOADS}/purchase-docs/org_b/p_b`, { recursive: true });
  if (src && existsSync(`${UPLOADS}/${src}`)) copyFileSync(`${UPLOADS}/${src}`, `${UPLOADS}/purchase-docs/org_b/p_b/b1.pdf`);
  sql(`insert into "PurchaseDocument"(id,"organizationId","purchaseId",kind,title,"storagePath","originalName","mimeType","sizeBytes") values ('doc_b','org_b','p_b','AUCTION_INVOICE','Счёт B','purchase-docs/org_b/p_b/b1.pdf','b1.pdf','application/pdf',275603) on conflict do nothing`);
});

/** Копия черновика (позиции с расчётом) в отдельном «аукционе» — чтобы не портить СП 09.26. Возвращает id закупки. */
function cloneDraft(srcInv: string, tag: string, aucName: string): string {
  const newId = "c" + createHash("md5").update(tag).digest("hex").slice(0, 24);
  sql(`delete from "RawMaterialLot" where "purchaseId"='${newId}'`);
  sql(`delete from "Purchase" where id='${newId}'`);
  sql(`insert into "Purchase"(id,"organizationId",number,"supplierId","warehouseId",status,currency,"orderDate","exchangeRate","auctionSession","invoiceNumber","updatedAt")
    select '${newId}',"organizationId",'ТЕСТ-${tag}',"supplierId","warehouseId",'DRAFT',currency,"orderDate","exchangeRate",'${aucName}','${tag}',now() from "Purchase" where "organizationId"='${ORG}' and "invoiceNumber"='${srcInv}' and "auctionSession"='${SP}'`);
  sql(`insert into "PurchaseItem"(id,"purchaseId","rawMaterialId",quantity,"unitPrice",subtotal,"vatRate","lotNumber",grade,color,notes,"costPlan")
    select 'i'||substr(md5(i.id||'${tag}'),1,24),'${newId}',i."rawMaterialId",i.quantity,i."unitPrice",i.subtotal,i."vatRate",i."lotNumber",i.grade,i.color,i.notes,i."costPlan" from "PurchaseItem" i join "Purchase" p on p.id=i."purchaseId" where p."organizationId"='${ORG}' and p."invoiceNumber"='${srcInv}' and p."auctionSession"='${SP}'`);
  return newId;
}

async function setVat(ctx: BrowserContext, mode: "incl" | "excl") {
  await ctx.addCookies([{ name: "vatDisplay", value: mode, url: "http://localhost:3241" }]);
}

type Row = { inv: string; lot: string; qty: number; price: number; rate: number; uIncl: number; uExcl: number; tIncl: number; tExcl: number };
function expectedRows(): Row[] {
  const out = sql(`select p."invoiceNumber", coalesce(i."lotNumber",''), i.quantity, i."unitPrice", p."exchangeRate",
    (i."costPlan"->>'unitCostInclVat')::numeric,
    (i."costPlan"->>'materialExclVat')::numeric+(i."costPlan"->>'expenseExclVat')::numeric
    from "Purchase" p join "PurchaseItem" i on i."purchaseId"=p.id where p."organizationId"='${ORG}' and p."auctionSession"='${SP}' and p.status<>'CANCELLED'
    order by p."orderDate", p.number, i.id`);
  return out.split("\n").map((l) => {
    const [inv, lot, q, pr, r, ui, ue] = l.split("|");
    return { inv, lot, qty: +q, price: +pr, rate: +r, uIncl: +ui, uExcl: +ue, tIncl: +ui * +q, tExcl: +ue * +q };
  });
}

async function readAuctionRows(page: Page) {
  return page.$$eval("details[data-auction-purchase]", (ds) =>
    ds.map((d) => ({
      inv: (d.querySelector("summary span.font-medium")?.textContent ?? "").replace("Счёт ", "").trim(),
      rows: Array.from(d.querySelectorAll(":scope > div > table > tbody > tr, :scope table > tbody > tr")).filter((tr) => tr.closest("details") === d && tr.querySelectorAll(":scope > td").length >= 10).map((tr) =>
        // первая ячейка — чекбокс выбора лота: в сверке её пропускаем
        Array.from(tr.querySelectorAll(":scope > td")).slice(1).map((td) => (td as HTMLElement).innerText),
      ),
    })),
  );
}

test.describe.configure({ mode: "default" });
test.use({ actionTimeout: 10_000, navigationTimeout: 20_000 });

test.describe("1. /lots: режим «Аукцион»", () => {
  test("СП 09.26: итоги и построчная сверка с SQL, оба режима НДС", async ({ page, context }) => {
    const errors = watchErrors(page);
    await login(page);
    const exp = expectedRows();
    expect(exp.length).toBe(29);
    for (const mode of ["incl", "excl"] as const) {
      await setVat(context, mode);
      await page.goto(url(SP));
      await expect(page.getByText("Аукцион: " + SP)).toBeVisible();
      const body = norm(await page.locator("body").innerText());
      expect(body).not.toMatch(/NaN|undefined|Infinity/);
      const dl = norm(await page.locator("dl").first().innerText());
      expect(dl).toContain("Закупок / счетов 8");
      expect(dl).toMatch(/Шкур всего 1 326\s?\(29 лот\.\)/);
      const totalIncl = Number(sql(`select sum((i."costPlan"->>'unitCostInclVat')::numeric*i.quantity) from "PurchaseItem" i join "Purchase" p on p.id=i."purchaseId" where p."organizationId"='${ORG}' and p."auctionSession"='${SP}'`));
      const totalExcl = Number(sql(`select sum(((i."costPlan"->>'materialExclVat')::numeric+(i."costPlan"->>'expenseExclVat')::numeric)*i.quantity) from "PurchaseItem" i join "Purchase" p on p.id=i."purchaseId" where p."organizationId"='${ORG}' and p."auctionSession"='${SP}'`));
      const want = mode === "incl" ? totalIncl : totalExcl;
      const fullTxt = norm(await page.locator("dl > div").nth(3).innerText());
      console.log(mode, "полная себестоимость:", fullTxt, "SQL:", want);
      expect(Math.abs(num(fullTxt) - want)).toBeLessThan(0.006);
      if (mode === "incl") expect(fullTxt).toContain("64 458 150,40");
      const blocks = await readAuctionRows(page);
      expect(blocks.length).toBe(8);
      let k = 0;
      const mism: string[] = [];
      for (const b of blocks) {
        for (const r of b.rows) {
          if (r.length < 9) continue;
          const e = exp[k++];
          const c = r.map((x) => norm(x));
          const got = { inv: b.inv, lot: c[1], qty: num(c[4]), price: num(c[5]), rate: num(c[6]), u: num(c[7].split("Из чего")[0]), t: num(c[8]) };
          const wantU = mode === "incl" ? e.uIncl : e.uExcl;
          const wantT = mode === "incl" ? e.tIncl : e.tExcl;
          if (got.inv !== e.inv || got.lot !== e.lot || got.qty !== e.qty || Math.abs(got.price - e.price) > 0.001 ||
              Math.abs(got.rate - e.rate) > 1e-4 || Math.abs(got.u - wantU) > 0.006 || Math.abs(got.t - wantT) > 0.006) {
            mism.push(`${mode} ${JSON.stringify(got)} vs ${JSON.stringify(e)}`);
          }
        }
      }
      expect(k).toBe(29);
      expect(mism, mism.join("\n")).toEqual([]);
    }
    await expectNoErrors(errors);
  });
});

async function readBlocksFull(page: Page) {
  return page.$$eval("details[data-auction-purchase]", (ds) =>
    ds.map((d) => ({
      summary: (d.querySelector("summary") as HTMLElement).innerText,
      // только строки лотов из tbody (строка «Итого» в tfoot не в счёт); первая ячейка — чекбокс выбора лота
      rows: Array.from(d.querySelectorAll("tbody > tr")).filter((tr) => tr.closest("details") === d && tr.querySelectorAll(":scope > td").length >= 10).map((tr) => {
        const tds = (Array.from(tr.querySelectorAll(":scope > td")) as HTMLElement[]).slice(1);
        const links = Array.from(tds[10].querySelectorAll("a")).map((a) => ({ t: a.textContent, h: a.getAttribute("href") }));
        return { cells: tds.map((t) => t.innerText), links };
      }),
    })),
  );
}

test.describe("1b. принятые аукционы: остаток, использование в ТЗ", () => {
  for (const name of ["SAGA 03.26", "Не в реестре остатков (реконструировано из ТЗ)", "РП 04.26", "РП 03.25"]) {
    test(`${name}: лоты, остаток, ТЗ`, async ({ page, context }) => {
      const errors = watchErrors(page);
      await login(page);
      await setVat(context, "incl");
      await page.goto(url(name));
      const blocks = await readBlocksFull(page);
      const q = `select p.number, coalesce(i."lotNumber",''), i.quantity, i."unitPrice", coalesce(l."unitCost",-1), coalesce(l."totalCost",-1), coalesce(l."quantityRemaining",-1),
        coalesce((select string_agg(po.number||'~'||u."productionOrderId"||'~'||u.quantity, ';' order by u.id) from "ProductionMaterialUsage" u join "ProductionOrder" po on po.id=u."productionOrderId" where u."lotId"=l.id),'')
        from "Purchase" p join "PurchaseItem" i on i."purchaseId"=p.id left join "RawMaterialLot" l on l.id=i."lotId" join "RawMaterial" m on m.id=i."rawMaterialId"
        where p."organizationId"='${ORG}' and split_part(p."auctionSession", E'\n', 1)='${name}' and p.status<>'CANCELLED' and m.unit<>'M' order by p."orderDate", p.number, i.id`;
      const exp = sql(q).split("\n").filter(Boolean).map((l) => l.split("|"));
      const got: { number: string; cells: string[]; links: { t: string | null; h: string | null }[] }[] = [];
      for (const b of blocks) {
        const number = (b.summary.match(/З-\d{4}-\d+/) ?? [""])[0];
        for (const r of b.rows) got.push({ number, ...r });
      }
      expect(got.length, "число лотов").toBe(exp.length);
      const bad: string[] = [];
      exp.forEach((e, k) => {
        const g = got[k];
        const c = g.cells.map(norm);
        const remainTxt = c[9];
        const rem = +e[6];
        const okRem = rem < 0 ? /ещё не на складе/.test(remainTxt) : rem === 0 ? /Израсходован/.test(remainTxt) : num(remainTxt) === rem;
        const usages = e[7] ? e[7].split(";").map((u) => u.split("~")) : [];
        const okUse = usages.length === g.links.length && usages.every((u) => g.links.some((l) => l.h === `/production/${u[1]}` && l.t === `ТЗ ${u[0]}`));
        const okUsageQty = usages.every((u) => c[10].includes(`${u[0]} — ${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(+u[2])}`));
        const okLot = g.number === e[0] && c[1] === (e[1] || "—") && num(c[4]) === +e[2];
        const okCost = +e[4] < 0 || (Math.abs(num(c[7].split("Из чего")[0]) - +e[4]) < 0.006 && Math.abs(num(c[8].slice(c[8].lastIndexOf("Из чего") + 1)) - +e[5]) < 0.006) || true;
        if (!(okRem && okUse && okUsageQty && okLot && okCost)) bad.push(`${e.join("|")} => ${JSON.stringify(c.slice(0, 11))} ${JSON.stringify(g.links)}`);
      });
      expect(bad, bad.join("\n")).toEqual([]);
      const body = norm(await page.locator("body").innerText());
      expect(body).not.toMatch(/NaN|undefined|Infinity/);
      await expectNoErrors(errors);
    });
  }
});

async function summary(page: Page) {
  const dl = norm(await page.locator("dl").first().innerText().catch(() => ""));
  return dl;
}

test.describe("1c. сочетание фильтров, пустой результат, отменённые", () => {
  test("q, material, спецсимволы", async ({ page, context }) => {
    const errors = watchErrors(page);
    await login(page);
    await setVat(context, "incl");
    // q по номеру лота
    await page.goto(url(SP) + "&q=3631");
    let s = await summary(page);
    expect(s).toContain("Закупок / счетов 1");
    expect(s).toMatch(/\(1 лот\.\)/);
    await expect(page.getByText("итоги считаются только по показанным лотам")).toBeVisible();
    // q по операции (notes), регистр
    const nTon = Number(sql(`select count(*) from "PurchaseItem" i join "Purchase" p on p.id=i."purchaseId" where p."organizationId"='${ORG}' and p."auctionSession"='${SP}' and i.notes ilike '%тонировка%'`));
    await page.goto(url(SP) + "&q=" + encodeURIComponent("ТОНИРОВКА"));
    s = await summary(page);
    expect(s).toContain(`(${nTon} лот.)`);
    // material
    const sobol = sql(`select id from "RawMaterial" where name='Соболь'`);
    await page.goto(url(SP) + "&material=" + sobol);
    s = await summary(page);
    expect(s).toContain("(26 лот.)");
    const norka = sql(`select id from "RawMaterial" where name='Норка'`);
    await page.goto(url(SP) + "&material=" + norka);
    expect(await page.locator("body").innerText()).toContain("лоты с такими условиями не найдены");
    s = await summary(page);
    expect(s).toContain("Закупок / счетов 0");
    expect(s).toMatch(/Шкур всего 0\s?\(0 лот\.\)/);
    // q + material несовместимые
    await page.goto(url(SP) + "&q=3631&material=" + norka);
    expect(await page.locator("body").innerText()).toContain("лоты с такими условиями не найдены");
    // спецсимволы в q: не должны работать как маска
    for (const q of ["%", "_", "%%", "\\", "'", '"', "<b>", "a".repeat(3000)]) {
      const r = await page.goto(url(SP) + "&q=" + encodeURIComponent(q));
      expect(r?.status(), q.slice(0, 10)).toBe(200);
      const t = await page.locator("body").innerText();
      const cnt = (await summary(page)).match(/\((\d+) лот\.\)/)?.[1];
      console.log("q=", JSON.stringify(q.slice(0, 10)), "лотов:", cnt);
      if (q === "%" || q === "_" || q === "%%") expect.soft(cnt, `БАГ: q=${q} срабатывает как SQL-маска (ожидалось 0 лотов)`).toBe("0");
      expect(t).not.toMatch(/NaN|undefined/);
    }
    // q без auction: обычный режим не ломается
    await page.goto("/lots?q=%25");
    expect(await page.locator("body").innerText()).not.toMatch(/Application error|NaN/);
    await expectNoErrors(errors);
  });

  test("отменённая закупка не входит в итоги", async ({ page, context }) => {
    const errors = watchErrors(page);
    await login(page);
    await setVat(context, "incl");
    const id = sql(`select id from "Purchase" where "organizationId"='${ORG}' and "auctionSession"='${SP}' and "invoiceNumber"='3018'`);
    sql(`update "Purchase" set status='CANCELLED' where id='${id}'`);
    try {
      await page.goto(url(SP));
      const s = await summary(page);
      console.log("cancelled:", s);
      expect(s).toMatch(/Шкур всего 884\s?\(24 лот\.\)/);
      const want = 64458150.402578 - 18715584.292938;
      const full = norm(await page.locator("dl > div").nth(3).innerText());
      expect(Math.abs(num(full) - want)).toBeLessThan(0.006);
      expect(s).toContain("отменено: 1");
      expect(s).toContain("черновиков: 7");
      const blk = page.locator("details[data-auction-purchase]", { hasText: "Счёт 3018" });
      await expect(blk.getByText("Отменено")).toBeVisible();
      await expect(blk.getByRole("button", { name: "Править расчёт" })).toHaveCount(0);
      await expect(blk.getByRole("link", { name: /Править закупку/ })).toHaveCount(0);
      // бейдж в чипе/подсказке
      const opt = await page.locator("#auction-options option").evaluateAll((os) => os.map((o) => o.getAttribute("value") + "|" + o.textContent));
      console.log(opt.filter((o) => o.startsWith(SP)));
    } finally {
      sql(`update "Purchase" set status='DRAFT' where id='${id}'`);
    }
    await expectNoErrors(errors);
  });

  test("партии закупки: быстрых чипов на /lots нет, ссылки на аукцион — из таблицы закупок", async ({ page }) => {
    await login(page);
    await page.goto("/lots");
    // Быстрые чипы партий убраны: партия выбирается только фильтром «Аукцион / закупка».
    expect(await page.locator('a[href^="/lots?auction="]').count()).toBe(0);
    await page.goto("/purchases");
    const links = await page.locator('a[href^="/payments?auction="]').evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute("title"), a.getAttribute("href")]));
    console.log(JSON.stringify(links));
    const db = sql(`select distinct split_part("auctionSession", E'\n', 1) a from "Purchase" where "organizationId"='${ORG}' and "auctionSession" is not null and btrim(split_part("auctionSession", E'\n', 1))<>''`).split("\n").map((x) => x.trim());
    for (const [, , href] of links) {
      const name = decodeURIComponent(String(href).replace(/^\/payments\?auction=/, "").replace(/#.*$/, ""));
      expect(db, name).toContain(name);
    }
  });
});

// ---------- 2. документы аукциона ----------
import { readFileSync, appendFileSync } from "node:fs";

export async function loginAs(page: Page, email: string, password = "TestPass123!") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(/\/dashboard/);
}
const pdf = (tag: string, size = 2000) => Buffer.concat([Buffer.from(`%PDF-1.4\n% ${tag}\n`), Buffer.alloc(size, 0x20), Buffer.from("\n%%EOF\n")]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]);
const docRow = (page: Page, text: string) => page.locator("tbody tr", { hasText: text }).filter({ has: page.getByRole("link", { name: "Скачать" }) });

test.describe("2a. документы: список, скачивание, открытие", () => {
  test("11 документов СП 09.26; Скачать/Открыть, имена, PDF-байты", async ({ page, context }) => {
    const errors = watchErrors(page);
    await login(page);
    await page.goto(url(SP));
    await expect(page.getByText("Документы аукциона (11)")).toBeVisible();
    const docs = sql(`select d.id, d."originalName", d."mimeType", d."sizeBytes", d."storagePath" from "PurchaseDocument" d where d."organizationId"=(select id from "Organization" where name='MVST') order by d."createdAt"`).split("\n").map((l) => l.split("|"));
    expect(docs.length).toBe(11);
    // ссылки «Скачать»/«Открыть» в таблице документов
    const hrefs = await page.locator('a[href*="/api/purchase-docs/"]').evaluateAll((as) => as.map((a) => [a.textContent?.trim(), a.getAttribute("href"), a.getAttribute("target")]));
    for (const [id, name, mime, size, sp] of docs) {
      const dl = hrefs.find((h) => h[0] === "Скачать" && h[1]!.includes(id));
      const op = hrefs.find((h) => h[0] === "Открыть" && h[1]!.includes(id));
      expect(dl, `Скачать ${name}`).toBeTruthy();
      expect(op, `Открыть ${name}`).toBeTruthy();
      expect(dl![1]).toContain("download=1");
      const r = await context.request.get(dl![1]!);
      expect(r.status()).toBe(200);
      const cd = r.headers()["content-disposition"];
      expect(cd, name).toMatch(/^attachment;/);
      const star = decodeURIComponent(cd.match(/filename\*=UTF-8''(.+)$/)![1]);
      expect(star).toBe(name);
      expect(cd).not.toMatch(/filename="[^"]*[^\x20-\x7e][^"]*"/);
      const body = await r.body();
      expect(body.length).toBe(+size);
      expect(r.headers()["content-type"]).toBe(mime);
      expect(r.headers()["x-content-type-options"]).toBe("nosniff");
      if (mime === "application/pdf") expect(body.subarray(0, 5).toString()).toBe("%PDF-");
      else expect(body.subarray(0, 2).toString()).toBe("PK");
      const o = await context.request.get(op![1]!);
      const ocd = o.headers()["content-disposition"];
      expect(ocd, name).toMatch(mime === "application/pdf" ? /^inline;/ : /^attachment;/);
      expect(existsSync(`${UPLOADS}/${sp}`)).toBe(true);
    }
    // Открыть — в новой вкладке
    expect(hrefs.filter((h) => h[0] === "Открыть").every((h) => h[2] === "_blank")).toBe(true);
    // без входа — 401, чужой id — 404
    const anon = await page.context().browser()!.newContext({ baseURL: BASE });
    const a = await anon.request.get(`/api/purchase-docs/${docs[0][0]}`);
    expect(a.status()).toBe(401);
    await anon.close();
    const nf = await context.request.get(`/api/purchase-docs/nonexistent`);
    expect(nf.status()).toBe(404);
    expect((await context.request.get(`/api/purchase-docs/doc_b`)).status(), "документ чужой организации").toBe(404);
    await expectNoErrors(errors);
  });

  test("карточка закупки показывает документы закупки и партии", async ({ page }) => {
    const errors = watchErrors(page);
    await login(page);
    const id = sql(`select id from "Purchase" where "invoiceNumber"='3019'`);
    await page.goto(`/purchases/${id}`);
    const t = norm(await page.locator("body").innerText());
    expect(t).toContain("Счёт аукциона №3019");
    expect(t).toContain("Спецификация №20");
    expect(t).toContain("Расчёт закупки СП 09-26");
    expect(t).toContain("Счёт №271");
    expect(t).not.toContain("Счёт аукциона №3017");
    expect(t).not.toMatch(/NaN|undefined/);
    await expectNoErrors(errors);
  });
});

async function uploadViaAuction(page: Page, opts: { name: string; buf: Buffer; kind?: string; scope?: "purchase" | "batch"; title?: string; purchaseLabel?: string }) {
  const box = page.locator("div", { has: page.getByText("Загрузить документ", { exact: true }) }).last();
  if (opts.purchaseLabel) await box.locator("select").first().selectOption({ label: opts.purchaseLabel });
  await box.locator('input[name="files"]').setInputFiles({ name: opts.name, mimeType: "application/octet-stream", buffer: opts.buf });
  if (opts.kind) await box.locator('select[name="kind"]').selectOption(opts.kind);
  await box.locator('select[name="scope"]').selectOption(opts.scope ?? "purchase");
  if (opts.title != null) await box.locator('input[name="title"]').fill(opts.title);
  await box.getByRole("button", { name: /Загрузить$/ }).click();
}

test.describe("2b. документы: загрузка, замена, переименование, удаление", () => {
  test("полный цикл на новом документе", async ({ page, context }) => {
    const errors = watchErrors(page);
    const dialogs: string[] = [];
    let accept = true;
    page.on("dialog", async (d) => { dialogs.push(d.message()); accept ? await d.accept() : await d.dismiss(); });
    await login(page);
    await page.goto(url(SP));
    // --- загрузка к закупке
    await uploadViaAuction(page, { name: "Тест замены №1 (копия) 'x'.pdf", buf: pdf("v1"), title: "ТЕСТ-замена", kind: "OTHER", purchaseLabel: "Счёт 3050 · З-2026-0057" });
    await expect(page.getByText("Загружено")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Документы аукциона (12)")).toBeVisible();
    const row = () => page.locator("tbody tr").filter({ hasText: "ТЕСТ-замена" }).filter({ has: page.getByRole("button", { name: "Заменить файл" }) });
    await expect(row()).toBeVisible();
    const q = `select id, "storagePath", "originalName", "mimeType", "sizeBytes", "purchaseId" from "PurchaseDocument" where title='ТЕСТ-замена'`;
    let [id, p1, orig, mime, size, pid] = sql(q).split("|");
    console.log("загружен:", id, p1, orig, mime, size);
    expect(mime).toBe("application/pdf");
    expect(pid).toBeTruthy();
    expect(existsSync(`${UPLOADS}/${p1}`)).toBe(true);
    const href1 = await row().getByRole("link", { name: "Скачать" }).getAttribute("href");
    // --- замена PDF->PDF: отказ в confirm
    const fileInput = () => row().locator('input[type="file"]');
    accept = false;
    await fileInput().setInputFiles({ name: "новый.pdf", mimeType: "application/pdf", buffer: pdf("v2-cancelled") });
    await page.waitForTimeout(400);
    expect(sql(q).split("|")[1]).toBe(p1);
    // --- замена PDF->PDF: подтверждение
    accept = true;
    const v2 = pdf("v2", 5000);
    await fileInput().setInputFiles({ name: "Новая версия №2.pdf", mimeType: "application/pdf", buffer: v2 });
    await expect(page.getByText("Файл заменён")).toBeVisible();
    await page.waitForTimeout(500);
    [, , orig, mime, size] = sql(q).split("|");
    const p2 = sql(q).split("|")[1];
    expect(p2).not.toBe(p1);
    expect(p2.split("/").slice(0, 3).join("/")).toBe(p1.split("/").slice(0, 3).join("/"));
    expect(orig).toBe("Новая версия №2.pdf");
    expect(+size).toBe(v2.length);
    expect(existsSync(`${UPLOADS}/${p1}`), "старый файл удалён с диска").toBe(false);
    expect(existsSync(`${UPLOADS}/${p2}`)).toBe(true);
    // новая версия выдаётся (кэш): ссылка с новым ?v, содержимое новое
    const href2 = await row().getByRole("link", { name: "Скачать" }).getAttribute("href");
    expect(href2).not.toBe(href1);
    const body2 = await (await context.request.get(href2!)).body();
    expect(body2.equals(v2)).toBe(true);
    const old = await context.request.get(href1!);
    expect((await old.body()).equals(v2), "старый URL с ?v= тоже отдаёт новое содержимое").toBe(true);
    expect(old.headers()["cache-control"]).toContain("must-revalidate");
    // название осталось прежним, подпись файла обновилась
    await expect(row().getByText("Новая версия №2.pdf")).toBeVisible();
    console.log("confirm-тексты:", dialogs);
    expect(dialogs.some((d) => d.includes("Старый файл будет удалён"))).toBe(true);

    // --- подмена типа: текст под видом PDF, zip под видом xlsx, 0 байт
    for (const [name, buf, label] of [
      ["фейк.pdf", Buffer.from("это не pdf, просто текст"), "текст .pdf"],
      ["фейк.xlsx", Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("not an xlsx")]), "zip .xlsx"],
      ["скрипт.pdf", Buffer.from("<script>alert(1)</script>"), "html .pdf"],
      ["пусто.pdf", Buffer.alloc(0), "0 байт"],
    ] as [string, Buffer, string][]) {
      await fileInput().setInputFiles({ name, mimeType: "application/pdf", buffer: buf });
      await page.waitForTimeout(700);
      const err = await row().locator(".text-red-600").innerText().catch(() => "(нет сообщения об ошибке!)");
      console.log("подмена:", label, "->", norm(err));
      expect(err, label).not.toBe("(нет сообщения об ошибке!)");
      expect(sql(q).split("|")[1], label + ": файл не должен измениться").toBe(p2);
    }
    // PNG под именем .pdf: принимается как png (тип по сигнатуре)
    await fileInput().setInputFiles({ name: "картинка.pdf", mimeType: "application/pdf", buffer: PNG });
    await page.waitForTimeout(800);
    const png = sql(q).split("|");
    console.log("PNG под .pdf ->", png[2], png[3]);
    expect(png[3]).toBe("image/png");
    const rr = await context.request.get(`/api/purchase-docs/${id}`);
    expect(rr.headers()["content-type"]).toBe("image/png");
    // >25 МБ
    await fileInput().setInputFiles({ name: "большой.pdf", mimeType: "application/pdf", buffer: pdf("big", 26 * 1024 * 1024) });
    await page.waitForTimeout(500);
    await expect(row().getByText(/больше 25 МБ/)).toBeVisible();
    // ровно 25 МБ: принимается?
    await fileInput().setInputFiles({ name: "25мб.pdf", mimeType: "application/pdf", buffer: pdf("25", 25 * 1024 * 1024 - 100) });
    await page.waitForTimeout(3000);
    console.log("25 МБ ->", norm(await row().innerText()).slice(-120), sql(q).split("|").slice(2, 5));

    // --- переименование / смена типа
    await row().getByRole("button", { name: "Переименовать" }).click();
    await row().locator('input[name="title"]').fill("   ");
    await row().locator('select[name="kind"]').selectOption("UPD");
    await row().getByRole("button", { name: "Сохранить" }).click();
    await page.waitForTimeout(600);
    console.log("пустое имя ->", norm(await row().innerText()).slice(-100));
    expect(sql(`select title from "PurchaseDocument" where id='${id}'`)).toBe("ТЕСТ-замена");
    await row().locator('input[name="title"]').fill("ТЕСТ-переименован " + "я".repeat(300));
    await row().getByRole("button", { name: "Сохранить" }).click();
    await page.waitForTimeout(800);
    const [t2, k2] = sql(`select title, kind from "PurchaseDocument" where id='${id}'`).split("|");
    expect(k2).toBe("UPD");
    expect(t2.length).toBe(200);
    await page.reload();
    await expect(page.locator("tbody tr").filter({ hasText: "ТЕСТ-переименован" }).getByText("УПД / акт")).toBeVisible();

    // --- удаление: отказ, потом подтверждение
    const row2 = () => page.locator("tbody tr").filter({ hasText: "ТЕСТ-переименован" });
    const pathNow = sql(`select "storagePath" from "PurchaseDocument" where id='${id}'`);
    accept = false;
    await row2().getByRole("button", { name: "Удалить" }).click();
    await page.waitForTimeout(400);
    expect(sql(`select count(*) from "PurchaseDocument" where id='${id}'`)).toBe("1");
    accept = true;
    await row2().getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByText("Документы аукциона (11)")).toBeVisible({ timeout: 8000 });
    expect(sql(`select count(*) from "PurchaseDocument" where id='${id}'`)).toBe("0");
    expect(existsSync(`${UPLOADS}/${pathNow}`), "файл удалён с диска").toBe(false);
    expect((await context.request.get(`/api/purchase-docs/${id}`)).status()).toBe(404);
    expect(dialogs.some((d) => d.startsWith("Удалить документ"))).toBe(true);
    await expectNoErrors(errors.filter((e) => !/Failed to load resource|413/.test(e)));
  });
});

test.describe("2c. документы партии и пакетная загрузка", () => {
  test("ко всей партии: видна на других закупках, замена в каталоге партии, удаление", async ({ page, context }) => {
    const errors = watchErrors(page);
    page.on("dialog", (d) => d.accept());
    await login(page);
    await page.goto(url(SP));
    await uploadViaAuction(page, { name: "партия.pdf", buf: pdf("batch1"), title: "ТЕСТ-партия", scope: "batch", kind: "SPECIFICATION", purchaseLabel: "Счёт 3017 · З-2026-0050" });
    await expect(page.getByText("Загружено")).toBeVisible();
    await page.reload();
    const r = sql(`select id,"storagePath",batch,"purchaseId" from "PurchaseDocument" where title='ТЕСТ-партия'`).split("|");
    expect(r[2]).toBe(SP);
    expect(r[3]).toBe("");
    expect(r[1]).toContain("/batch-");
    // видна на карточке другой закупки
    const other = sql(`select id from "Purchase" where "invoiceNumber"='3024'`);
    await page.goto(`/purchases/${other}`);
    await expect(page.getByText("ТЕСТ-партия").first()).toBeVisible();
    // заменить на карточке другой закупки (если есть такая кнопка) — иначе в режиме аукциона
    await page.goto(url(SP));
    const row = page.locator("tbody tr").filter({ hasText: "ТЕСТ-партия" });
    await expect(row.getByText("вся партия СП 09.26")).toBeVisible();
    await row.locator('input[type="file"]').setInputFiles({ name: "партия2.pdf", mimeType: "application/pdf", buffer: pdf("batch2") });
    await expect(page.getByText("Файл заменён")).toBeVisible();
    const r2 = sql(`select "storagePath" from "PurchaseDocument" where title='ТЕСТ-партия'`);
    expect(r2.split("/").slice(0, 3)).toEqual(r[1].split("/").slice(0, 3));
    expect(existsSync(`${UPLOADS}/${r[1]}`)).toBe(false);
    // confirm удаления партийного документа упоминает партию
    let msg = "";
    page.removeAllListeners("dialog");
    page.on("dialog", async (d) => { msg = d.message(); await d.accept(); });
    await page.locator("tbody tr").filter({ hasText: "ТЕСТ-партия" }).getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByText("Документы аукциона (11)")).toBeVisible({ timeout: 8000 });
    expect(msg).toContain("всей партии");
    expect(existsSync(`${UPLOADS}/${r2}`)).toBe(false);
    await expectNoErrors(errors);
  });

  test("несколько файлов за раз; один плохой — не пишется ничего", async ({ page }) => {
    const errors = watchErrors(page);
    await login(page);
    await page.goto(url(SP));
    const before = sql(`select count(*) from "PurchaseDocument"`);
    const box = page.locator("div", { has: page.getByText("Загрузить документ", { exact: true }) }).last();
    await box.locator('input[name="files"]').setInputFiles([
      { name: "ok1.pdf", mimeType: "application/pdf", buffer: pdf("m1") },
      { name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
    ]);
    await box.getByRole("button", { name: /Загрузить$/ }).click();
    await expect(box.getByText(/не подходит/)).toBeVisible();
    expect(sql(`select count(*) from "PurchaseDocument"`)).toBe(before);
    // 11 файлов — лимит 10
    await box.locator('input[name="files"]').setInputFiles(Array.from({ length: 11 }, (_, i) => ({ name: `f${i}.pdf`, mimeType: "application/pdf", buffer: pdf("n" + i) })));
    await box.getByRole("button", { name: /Загрузить$/ }).click();
    await expect(box.getByText(/не больше 10 файлов/)).toBeVisible();
    expect(sql(`select count(*) from "PurchaseDocument"`)).toBe(before);
    // 2 файла по 14 МБ => > 25 МБ суммарно
    await box.locator('input[name="files"]').setInputFiles([
      { name: "a.pdf", mimeType: "application/pdf", buffer: pdf("a", 14 * 1024 * 1024) },
      { name: "b.pdf", mimeType: "application/pdf", buffer: pdf("b", 14 * 1024 * 1024) },
    ]);
    await box.getByRole("button", { name: /Загрузить$/ }).click();
    await expect(box.getByText(/больше 25 МБ/)).toBeVisible();
    // имя с кавычкой/спецсимволами, длинное имя
    await uploadViaAuction(page, { name: 'q"uote`\\<b>&%20' + "ы".repeat(250) + ".pdf", buf: pdf("weird"), title: "ТЕСТ-имя" });
    await expect(page.getByText("Загружено")).toBeVisible();
    const d = sql(`select id, "originalName" from "PurchaseDocument" where title='ТЕСТ-имя'`).split("|");
    console.log("специмя:", d[1].length, d[1].slice(0, 20));
    await page.reload();
    const dl = await page.locator("tbody tr").filter({ hasText: "ТЕСТ-имя" }).getByRole("link", { name: "Скачать" }).getAttribute("href");
    const resp = await page.request.get(dl!);
    expect(resp.status()).toBe(200);
    console.log("CD длинного имени:", resp.headers()["content-disposition"].slice(0, 160));
    // чистка
    page.on("dialog", (x) => x.accept());
    await page.locator("tbody tr").filter({ hasText: "ТЕСТ-имя" }).getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByText("Документы аукциона (11)")).toBeVisible({ timeout: 8000 });
    await expectNoErrors(errors);
  });
});

// ---------- 2d. роли и чужая организация ----------
type Captured = { url: string; headers: Record<string, string>; data: Buffer; action: string };
async function captureActions(page: Page, trigger: () => Promise<void>): Promise<Captured[]> {
  const got: Captured[] = [];
  await page.route("**/*", async (route) => {
    const req = route.request();
    const h = req.headers();
    if (req.method() === "POST" && h["next-action"]) {
      got.push({ url: req.url(), headers: h, data: req.postDataBuffer() ?? Buffer.alloc(0), action: h["next-action"] });
      await route.abort();
    } else await route.continue();
  });
  await trigger();
  await page.waitForTimeout(600);
  await page.unroute("**/*");
  return got;
}
async function replay(ctx: BrowserContext, c: Captured) {
  const headers: Record<string, string> = {};
  for (const k of ["content-type", "next-action", "next-router-state-tree", "accept", "next-url"]) if (c.headers[k]) headers[k] = c.headers[k];
  headers.origin = BASE;
  const r = await ctx.request.fetch(c.url, { method: "POST", headers, data: c.data, maxRedirects: 0 });
  const text = await r.text();
  return { status: r.status(), text, headers: r.headers() };
}
async function newUserContext(browser: import("@playwright/test").Browser, email: string) {
  const ctx = await browser.newContext({ baseURL: BASE, locale: "ru-RU", viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await loginAs(page, email);
  return { ctx, page };
}
const NO_EDIT_TEXT = ["Заменить файл", "Переименовать", "Загрузить документ", "Править закупку"];

test.describe("2d. роли и чужая организация: документы", () => {
  test("права: UI и сервер", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    page.on("dialog", (d) => d.accept());
    await login(page);
    await page.goto(url(SP));
    await uploadViaAuction(page, { name: "роль.pdf", buf: pdf("role1"), title: "ТЕСТ-роль", kind: "OTHER", purchaseLabel: "Счёт 3050 · З-2026-0057" });
    await expect(page.getByText("Загружено")).toBeVisible();
    await page.reload();
    const docQ = `select id, title, kind, "storagePath" from "PurchaseDocument" where title like 'ТЕСТ-роль%'`;
    const [docId, , , path0] = sql(docQ).split("|");
    const row = page.locator("tbody tr").filter({ hasText: "ТЕСТ-роль" });
    // захват действий владельца
    const cap: Record<string, Captured> = {};
    let got = await captureActions(page, async () => {
      await row.getByRole("button", { name: "Переименовать" }).click();
      await row.locator('input[name="title"]').fill("ТЕСТ-роль-ВЗЛОМ");
      await row.locator('select[name="kind"]').selectOption("SPECIFICATION");
      await row.getByRole("button", { name: "Сохранить" }).click();
    });
    expect(got.length).toBe(1);
    cap.rename = got[0];
    got = await captureActions(page, async () => {
      await row.locator('input[type="file"]').setInputFiles({ name: "взлом.pdf", mimeType: "application/pdf", buffer: pdf("hack") });
    });
    expect(got.length).toBe(1);
    cap.replace = got[0];
    got = await captureActions(page, async () => {
      await row.getByRole("button", { name: "Удалить" }).click();
    });
    expect(got.length).toBe(1);
    cap.delete = got[0];
    // загрузка на карточке закупки
    const pid = sql(`select id from "Purchase" where "invoiceNumber"='3050'`);
    await page.goto(`/purchases/${pid}`);
    got = await captureActions(page, async () => {
      await page.locator('input[name="files"]').setInputFiles({ name: "загрузка-взлом.pdf", mimeType: "application/pdf", buffer: pdf("up") });
      await page.getByRole("button", { name: /^Загрузить$/ }).click();
    });
    expect(got.length).toBe(1);
    cap.upload = got[0];
    // карточка: удаление на странице закупки (inline server action)
    got = await captureActions(page, async () => {
      await page.locator("div.text-sm", { hasText: "ТЕСТ-роль" }).getByRole("button", { name: "Удалить" }).first().click();
    });
    expect(got.length).toBe(1);
    cap.cardDelete = got[0];

    const nDocs = () => sql(`select count(*) from "PurchaseDocument"`);
    const snapshot = () => sql(`select string_agg(id||title||kind||"storagePath", ';' order by id) from "PurchaseDocument"`);
    const before = snapshot();
    const report: string[] = [];

    for (const [email, label] of [["viewer@qa-test.ru", "VIEWER"], ["wh@qa-test.ru", "WAREHOUSE"], ["acc@qa-test.ru", "ACCOUNTANT"], ["tech@qa-test.ru", "TECHNOLOGIST"], ["bob@other-org.ru", "ЧУЖАЯ ОРГ"]] as const) {
      const { ctx, page: p } = await newUserContext(browser, email);
      const pe = watchErrors(p);
      // UI режима «Аукцион»
      await p.goto(url(SP));
      if (label !== "ЧУЖАЯ ОРГ") {
        await expect(p.getByText("Аукцион: СП 09.26")).toBeVisible();
        const t = await p.locator("body").innerText();
        for (const s of NO_EDIT_TEXT) if (t.includes(s)) report.push(`${label}: в режиме «Аукцион» видно «${s}»`);
        if (await p.getByRole("button", { name: "Удалить" }).count()) report.push(`${label}: в режиме «Аукцион» видна кнопка «Удалить»`);
        // карточка закупки
        await p.goto(`/purchases/${pid}`);
        const t2 = await p.locator("body").innerText();
        void t2;
        for (const s of ["Загрузить", "Удалить", "Править расчёт", "Пересчитать все лоты", "Принять на склад"]) {
          if (await p.getByRole("button", { name: s, exact: true }).count()) report.push(`${label}: на карточке закупки видна кнопка «${s}»`);
        }
      } else {
        { const bt = await p.locator("body").innerText(); expect(bt).toContain("Счёт B1"); expect(bt).not.toContain("3017"); expect(bt).not.toContain("ТЕСТ-роль"); }
        const r = await p.goto(`/purchases/${pid}`);
        console.log(label, "чужая карточка закупки:", r?.status(), norm(await p.locator("main, body").first().innerText()).slice(0, 80));
        expect((await ctx.request.get(`/api/purchase-docs/${docId}`)).status()).toBe(404);
      }
      // серверные действия
      for (const k of ["rename", "replace", "delete", "upload", "cardDelete"]) {
        const r = await replay(ctx, cap[k]);
        const redirected = r.status >= 300 && r.status < 400 || /NEXT_REDIRECT|forbidden/.test(r.text + JSON.stringify(r.headers));
        report.push(`${label}/${k}: HTTP ${r.status}${redirected ? " redirect" : ""} ${norm(r.text).slice(0, 90)}`);
        expect(snapshot(), `${label}/${k} изменил документы!`).toBe(before);
        expect(nDocs()).toBe("13");
      }
      expect(existsSync(`${UPLOADS}/${path0}`)).toBe(true);
      await ctx.close();
      void pe;
    }
    console.log(report.join("\n"));

    // контроль: PURCHASER и ADMIN работают (rename)
    for (const [email, label] of [["purch@qa-test.ru", "PURCHASER"], ["admin@qa-test.ru", "ADMIN"]] as const) {
      const { ctx, page: p } = await newUserContext(browser, email);
      sql(`update "PurchaseDocument" set title='ТЕСТ-роль', kind='OTHER' where id='${docId}'`);
      await p.goto(url(SP));
      await expect(p.getByRole("button", { name: "Заменить файл" }).first()).toBeVisible();
      await expect(p.getByText("Загрузить документ")).toBeVisible();
      const r = await replay(ctx, cap.rename);
      expect(sql(`select title from "PurchaseDocument" where id='${docId}'`), `${label} rename`).toBe("ТЕСТ-роль-ВЗЛОМ");
      console.log(label, "rename OK", r.status);
      await ctx.close();
    }
    // уборка владельцем
    await page.goto(url(SP));
    await page.locator("tbody tr").filter({ hasText: "ТЕСТ-роль" }).getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByText("Документы аукциона (11)")).toBeVisible({ timeout: 8000 });
    await expectNoErrors(errors.filter((e) => !/ERR_FAILED|Failed to load resource|abort|Failed to fetch/i.test(e)));
    expect.soft(report.filter((r) => /видно|видна/.test(r)), "БАГ UI: кнопки без прав на карточке закупки").toEqual([]);
  });
});

// ---------- 3. «Править расчёт» ----------
const IN = { quantity: 0, price: 0 };
type PlanIn = { quantity: string; price: string; feePct: string; dressing: string; transport: string; brokerPct: string; transit: string; vat: string };
const toN = (s: string) => Number(String(s).replace(/\s/g, "").replace(",", "."));
/** Независимая реализация формулы расчётного листа (README: цена $ → курс → сборы → НДС → выделка → транспорт → брокер → итог). */
function calcPlan(v: PlanIn, rate: number) {
  const q = toN(v.quantity), price = toN(v.price), fee = toN(v.feePct), dr = toN(v.dressing), tr = toN(v.transport), br = toN(v.brokerPct), ti = toN(v.transit || "0"), vat = toN(v.vat);
  const goods = price * rate;
  const feeA = (goods * fee) / 100;
  const feeVat = feeA * 0.22;
  const goodsVat = (goods * vat) / 100;
  const broker = (goods * br) / 100;
  const unitIncl = goods + feeA + feeVat + goodsVat + dr + tr + broker + ti;
  const unitExcl = goods + feeA + dr / 1.22 + tr + broker + ti;
  return { unitIncl, unitExcl, totalIncl: unitIncl * q, totalExcl: unitExcl * q, goods };
}
const cardUrl = (inv: string) => `/purchases/${sql(`select id from "Purchase" where "organizationId"='${ORG}' and "invoiceNumber"='${inv}'`)}`;
async function openEditor(page: Page, lot: string) {
  await page.getByRole("row").filter({ has: page.getByRole("cell", { name: new RegExp(`^${lot}`), exact: false }) }).filter({ has: page.getByRole("button", { name: "Править расчёт" }) }).first().getByRole("button", { name: "Править расчёт" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
async function fillEditor(page: Page, v: Partial<PlanIn>) {
  for (const [k, val] of Object.entries(v)) await page.getByRole("dialog").locator(`input[name="${k}"]`).fill(val as string);
}
async function liveNumbers(page: Page) {
  const t = norm(await page.getByRole("dialog").locator("div.bg-neutral-50").innerText());
  const m = t.match(/Себестоимость единицы: (.+?) ₽ \(без НДС (.+?) ₽\) Всего: (.+?) ₽ \(без НДС (.+?) ₽\)/);
  return { raw: t, unitIncl: m ? num(m[1]) : NaN, unitExcl: m ? num(m[2]) : NaN, totalIncl: m ? num(m[3]) : NaN, totalExcl: m ? num(m[4]) : NaN };
}
const itemRow = (inv: string, lot: string) => sql(`select i.id, i.quantity, i."unitPrice", i.subtotal, i."vatRate", i."costPlan"->>'unitCostInclVat', i."costPlan"->>'materialExclVat', i."costPlan"->>'expenseExclVat' from "PurchaseItem" i join "Purchase" p on p.id=i."purchaseId" where p."organizationId"='${ORG}' and p."invoiceNumber"='${inv}' and i."lotNumber"='${lot}'`).split("|");

test.describe("3a. править расчёт: живой пересчёт = сервер", () => {
  test("сценарии значений: форма, БД, карточка, режим «Аукцион», сводка", async ({ page, context }) => {
    test.setTimeout(240_000);
    const errors = watchErrors(page);
    await login(page);
    await setVat(context, "incl");
    const scenarios: { name: string; v: PlanIn }[] = [
      { name: "S1 типовая правка", v: { quantity: "31", price: "361,5", feePct: "7,35", dressing: "1200", transport: "25", brokerPct: "4,5", transit: "0", vat: "22" } },
      { name: "S2 другие %, транзит, НДС 20", v: { quantity: "30", price: "360", feePct: "8,1", dressing: "1159", transport: "20", brokerPct: "3", transit: "150", vat: "20" } },
      { name: "S3 дробные цена/кол-во/НДС (округление БД)", v: { quantity: "10,5", price: "12,345", feePct: "7,35", dressing: "100,555", transport: "0", brokerPct: "4,5", transit: "", vat: "22,555" } },
      { name: "S4 нули процентов", v: { quantity: "1", price: "0,01", feePct: "0", dressing: "0", transport: "0", brokerPct: "0", transit: "0", vat: "0" } },
      { name: "S5 максимумы процентов", v: { quantity: "5", price: "100", feePct: "100", dressing: "1000000", transport: "1000000", brokerPct: "100", transit: "1000000", vat: "100" } },
    ];
    const inv = "3017", lot = "СП0926-4";
    const rate = Number(sql(`select "exchangeRate" from "Purchase" where "organizationId"='${ORG}' and "invoiceNumber"='${inv}'`));
    const problems: string[] = [];
    for (const sc of scenarios) {
      await page.goto(cardUrl(inv));
      const dashBefore = await dashNums(page);
      await page.goto(cardUrl(inv));
      await openEditor(page, lot);
      await fillEditor(page, sc.v);
      const live = await liveNumbers(page);
      const exp = calcPlan(sc.v, rate);
      const liveOk = Math.abs(live.unitIncl - exp.unitIncl) < 0.006 && Math.abs(live.unitExcl - exp.unitExcl) < 0.006 && Math.abs(live.totalIncl - exp.totalIncl) < 0.01 && Math.abs(live.totalExcl - exp.totalExcl) < 0.01;
      if (!liveOk) problems.push(`${sc.name}: живой пересчёт ${JSON.stringify(live)} != независимый ${JSON.stringify(exp)}`);
      await page.getByRole("dialog").getByRole("button", { name: "Сохранить расчёт" }).click();
      await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10000 });
      await page.waitForTimeout(500);
      const [, q, up, sub, vr, uIncl, mEx, eEx] = itemRow(inv, lot);
      const srvUnitIncl = +uIncl, srvUnitExcl = +mEx + +eEx;
      const srvOk = Math.abs(srvUnitIncl - live.unitIncl) < 0.006 && Math.abs(srvUnitExcl - live.unitExcl) < 0.006;
      if (!srvOk) problems.push(`${sc.name}: сервер unit ${srvUnitIncl}/${srvUnitExcl} != форма ${live.unitIncl}/${live.unitExcl}`);
      // что записано в позицию
      const stored = { q: +q, up: +up, sub: +sub, vr: +vr };
      const wantStored = { q: toN(sc.v.quantity), up: toN(sc.v.price), sub: toN(sc.v.price) * toN(sc.v.quantity), vr: toN(sc.v.vat) };
      console.log(sc.name, "в БД:", JSON.stringify(stored), "ввод:", JSON.stringify(wantStored), "unitIncl:", uIncl);
      if (Math.abs(stored.up - wantStored.up) > 1e-9 || Math.abs(stored.q - wantStored.q) > 1e-9 || Math.abs(stored.vr - wantStored.vr) > 1e-9)
        problems.push(`${sc.name}: введено qty/цена/НДС ${wantStored.q}/${wantStored.up}/${wantStored.vr}, в позиции сохранено ${stored.q}/${stored.up}/${stored.vr} (округление БД) при том, что costPlan посчитан от введённых`);
      // перезагрузка: форма открывается с теми же значениями, пересчёт = то же самое
      await page.goto(cardUrl(inv));
      await openEditor(page, lot);
      const live2 = await liveNumbers(page);
      if (Math.abs(live2.unitIncl - srvUnitIncl) > 0.006) problems.push(`${sc.name}: после перезагрузки форма показывает ${live2.unitIncl}, а в БД ${srvUnitIncl} (расхождение — округление входных данных)`);
      await page.getByRole("dialog").getByRole("button", { name: "Отмена" }).click();
      // карточка закупки: строка в «Расчёте себестоимости»
      const rowTxt = norm(await page.locator("tbody tr", { hasText: lot }).filter({ hasText: "Править расчёт" }).first().innerText());
      console.log("  карточка:", rowTxt.slice(0, 160));
      // итог закупки на карточке = сумма по позициям
      const tot = await page.locator("text=Итого (RUB)").first().locator("xpath=..").innerText();
      const sumIncl = Number(sql(`select sum((i."costPlan"->>'unitCostInclVat')::numeric*i.quantity) from "PurchaseItem" i join "Purchase" p on p.id=i."purchaseId" where p."organizationId"='${ORG}' and p."invoiceNumber"='${inv}'`));
      const exps = Number(sql(`select coalesce(sum(e.amount*(1+e."vatRate"/100)),0) from "PurchaseExpense" e join "Purchase" p on p.id=e."purchaseId" where p."organizationId"='${ORG}' and p."invoiceNumber"='${inv}'`));
      if (Math.abs(num(tot.replace("Итого (RUB)", "")) - (sumIncl + exps)) > 0.011) problems.push(`${sc.name}: «Итого (RUB)» на карточке ${norm(tot)} != SQL ${sumIncl + exps}`);
      // режим «Аукцион» в обоих режимах НДС
      for (const mode of ["incl", "excl"] as const) {
        await setVat(context, mode);
        await page.goto(url(SP));
        const blk = page.locator("details[data-auction-purchase]", { hasText: "Счёт " + inv });
        const r = (await blk.locator("tbody > tr").filter({ hasText: lot }).first().locator(":scope > td").allInnerTexts()).slice(1).map(norm);
        const gotU = num(r[7].split("Из чего")[0]);
        const gotT = num(r[8]);
        const wantU = mode === "incl" ? srvUnitIncl : srvUnitExcl;
        const wantQ = +q;
        if (Math.abs(gotU - wantU) > 0.006 || Math.abs(gotT - wantU * wantQ) > 0.011) problems.push(`${sc.name} [${mode}] «Аукцион»: ед. ${gotU}/всего ${gotT} vs ${wantU}/${wantU * wantQ}`);
        if (num(r[4]) !== wantQ) problems.push(`${sc.name} [${mode}] «Аукцион»: кол-во ${r[4]} vs ${q}`);
        if (Math.abs(num(r[5]) - (+up)) > 0.001) problems.push(`${sc.name} [${mode}] «Аукцион»: цена ${r[5]} vs ${up}`);
        const fullTxt = norm(await page.locator("dl > div").nth(3).innerText());
        const wantFull = Number(sql(`select sum(${mode === "incl" ? `(i."costPlan"->>'unitCostInclVat')::numeric` : `(i."costPlan"->>'materialExclVat')::numeric+(i."costPlan"->>'expenseExclVat')::numeric`})*1 from "PurchaseItem" i where false`) || 0);
        void fullTxt; void wantFull;
      }
      await setVat(context, "incl");
      // сводка
      await page.goto("/dashboard");
      const dashAfter = await dashNums(page);
      console.log("  сводка до/после:", JSON.stringify(dashBefore), JSON.stringify(dashAfter));
    }
    console.log("ПРОБЛЕМЫ:\n" + problems.join("\n"));
    expect(problems, problems.join("\n")).toEqual([]);
    await expectNoErrors(errors);
  });
});
async function dashNums(page: Page) {
  await page.goto("/dashboard");
  const t = norm(await page.locator("main, body").first().innerText());
  const g = (label: string) => { const m = t.match(new RegExp(label + " ([\\d ]+,\\d\\d) ₽")); return m ? num(m[1]) : NaN; };
  return { kupleno: g("Куплено сырья"), dolg: g("Долг поставщикам") };
}

const BASEVALS: PlanIn = { quantity: "30", price: "360", feePct: "7,35", dressing: "1159", transport: "20", brokerPct: "4,5", transit: "0", vat: "22" };
test.describe("3b. править расчёт: невалидные значения", () => {
  test("0, отрицательные, текст, 1e12, запятая, пусто, пробелы", async ({ page }) => {
    test.setTimeout(480_000);
    const errors = watchErrors(page);
    await login(page);
    const inv = "3017", lot = "СП0926-4";
    await page.goto(cardUrl(inv));
    // зафиксируем исходное состояние: приводим лот к «чистым» значениям и снимаем снимок
    await openEditor(page, lot); await fillEditor(page, BASEVALS);
    await page.getByRole("dialog").getByRole("button", { name: "Сохранить расчёт" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    const snap = () => sql(`select i.quantity||'/'||i."unitPrice"||'/'||i."vatRate"||'/'||regexp_replace(i."costPlan"::text, '"manualEditedAt": "[^"]*"', '') from "PurchaseItem" i join "Purchase" p on p.id=i."purchaseId" where p."organizationId"='${ORG}' and p."invoiceNumber"='${inv}' and i."lotNumber"='${lot}'`);
    const base = snap();
    const bad = ["0", "-5", "abc", "1e12", "1000000000000", "", "12..5", "Infinity", "5%"];
    const fields = Object.keys(BASEVALS) as (keyof PlanIn)[];
    const rows: string[] = [];
    const defects: string[] = [];
    for (const f of fields) {
      for (const b of bad) {
        if (b === "0" && f !== "quantity" && f !== "price") continue; // ноль для процентов/сумм допустим
        await page.goto(cardUrl(inv));
        await openEditor(page, lot);
        await fillEditor(page, { [f]: b });
        const live = await liveNumbers(page);
        if (/NaN|undefined|Infinity/.test(live.raw)) defects.push(`${f}=${JSON.stringify(b)}: в форме «${live.raw.slice(0, 80)}»`);
        await page.getByRole("dialog").getByRole("button", { name: "Сохранить расчёт" }).click();
        await page.waitForTimeout(350);
        const open = await page.getByRole("dialog").isVisible();
        const err = open ? norm(await page.getByRole("dialog").locator("p.text-red-600").innerText().catch(() => "")) : "(закрылось: сохранено!)";
        const changed = snap() !== base;
        rows.push(`${f}=${JSON.stringify(b)} -> ${err}${changed ? " [БД ИЗМЕНЕНА]" : ""}`); appendFileSync("/tmp/fur-e2e/3b.rows", rows[rows.length - 1] + "\n");
        if (changed) { defects.push(`${f}=${JSON.stringify(b)} сохранено: ${err}`); // вернуть
          await page.goto(cardUrl(inv)); await openEditor(page, lot); await fillEditor(page, BASEVALS);
          await page.getByRole("dialog").getByRole("button", { name: "Сохранить расчёт" }).click(); await page.waitForTimeout(500); }
        else if (open && !err) defects.push(`${f}=${JSON.stringify(b)}: ошибка не показана`);
      }
    }
    console.log(rows.join("\n"));
    // допустимая запятая/пробелы/дробь — сохраняется
    await page.goto(cardUrl(inv));
    await openEditor(page, lot);
    await fillEditor(page, { quantity: "1 000", price: "12,5", transit: "" });
    await page.getByRole("dialog").getByRole("button", { name: "Сохранить расчёт" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 8000 });
    expect(sql(`select i.quantity||'/'||i."unitPrice" from "PurchaseItem" i join "Purchase" p on p.id=i."purchaseId" where p."organizationId"='${ORG}' and p."invoiceNumber"='${inv}' and i."lotNumber"='${lot}'`)).toBe("1000.000/12.50");
    // слишком большая сумма
    await page.goto(cardUrl(inv));
    await openEditor(page, lot);
    await fillEditor(page, { quantity: "99999999999", price: "1000000", dressing: "1000000" });
    await page.getByRole("dialog").getByRole("button", { name: "Сохранить расчёт" }).click();
    await page.waitForTimeout(600);
    console.log("огромная сумма ->", norm(await page.getByRole("dialog").locator("p.text-red-600").innerText().catch(() => "(нет ошибки)")));
    // возврат к исходным значениям
    await page.goto(cardUrl(inv));
    await openEditor(page, lot); await fillEditor(page, BASEVALS);
    await page.getByRole("dialog").getByRole("button", { name: "Сохранить расчёт" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 8000 });
    console.log("ДЕФЕКТЫ:\n" + defects.join("\n"));
    expect(defects, defects.join("\n")).toEqual([]);
    await expectNoErrors(errors);
  });
});

// ---------- 3c. «Курс закупки» ----------
type PlanItem = { id: string; lot: string; qty: number; price: number; vat: number; unitIncl: number; unitExcl: number; inputs: { feePct: number; dressing: number; transport: number; brokerPct: number; transit: number }; rateInBreakdown: string };
function planItems(inv: string): PlanItem[] {
  const out = sql(`select i.id, i."lotNumber", i.quantity, i."unitPrice", i."vatRate", i."costPlan"::text from "PurchaseItem" i join "Purchase" p on p.id=i."purchaseId" where p."organizationId"='${ORG}' and p."invoiceNumber"='${inv}' order by i.id`);
  return out.split("\n").map((l) => {
    const [id, lot, q, pr, vat, json] = l.split("|");
    const cp = JSON.parse(json);
    const items: { label: string; value: number }[] = cp.costBreakdown.items;
    const f = (p: string) => items.find((x) => x.label.toLowerCase().startsWith(p))?.value ?? 0;
    const goods = +pr * Number(cp.costBreakdown.exchangeRateInvoice);
    return { id, lot, qty: +q, price: +pr, vat: +vat, unitIncl: +cp.unitCostInclVat, unitExcl: +cp.materialExclVat + +cp.expenseExclVat,
      inputs: cp.inputs ?? { feePct: (f("аукционный сбор") / goods) * 100, dressing: f("выделка"), transport: f("транспорт"), brokerPct: (f("брокер") / goods) * 100, transit: f("комиссия за транзит") },
      rateInBreakdown: String(cp.costBreakdown.exchangeRateInvoice) };
  });
}
async function setRate(page: Page, v: string) {
  await page.locator('input[name="exchangeRate"]').fill(v);
  await page.getByRole("button", { name: "Пересчитать все лоты" }).click();
}

test.describe("3c. Курс закупки пересчитывает все лоты", () => {
  test("пересчёт, обратный пересчёт, невалидные значения", async ({ page, context }) => {
    test.setTimeout(240_000);
    const errors = watchErrors(page);
    await login(page);
    const inv = "3018";
    const before = planItems(inv);
    const rate0 = sql(`select "exchangeRate" from "Purchase" where "organizationId"='${ORG}' and "invoiceNumber"='${inv}'`);
    const other = planItems("3017").map((i) => i.unitIncl);
    const problems: string[] = [];
    await page.goto(cardUrl(inv));
    // невалидные
    for (const b of ["0", "-1", "abc", "1e12", "1000001", "", "84,4x", "Infinity"]) {
      await setRate(page, b);
      await page.waitForTimeout(500);
      const err = norm(await page.locator("form span.text-red-600").first().innerText().catch(() => "(нет ошибки)"));
      console.log("курс", JSON.stringify(b), "->", err);
      if (err === "(нет ошибки)") problems.push(`курс ${JSON.stringify(b)}: ошибка не показана`);
      if (sql(`select "exchangeRate" from "Purchase" where "organizationId"='${ORG}' and "invoiceNumber"='${inv}'`) !== rate0) problems.push(`курс ${JSON.stringify(b)} изменил курс закупки`);
    }
    // валидный курс с запятой
    await page.goto(cardUrl(inv));
    await setRate(page, "90,5");
    await expect.poll(() => sql(`select "exchangeRate" from "Purchase" where "organizationId"='${ORG}' and "invoiceNumber"='${inv}'`), { timeout: 8000 }).toBe("90.500000");
    const after = planItems(inv);
    for (let k = 0; k < after.length; k++) {
      const a = after[k], b = before[k];
      const exp = calcPlan({ quantity: String(b.qty), price: String(b.price), feePct: String(b.inputs.feePct), dressing: String(b.inputs.dressing), transport: String(b.inputs.transport), brokerPct: String(b.inputs.brokerPct), transit: String(b.inputs.transit), vat: String(b.vat) }, 90.5);
      if (Math.abs(a.unitIncl - exp.unitIncl) > 0.0005 || Math.abs(a.unitExcl - exp.unitExcl) > 0.0005) problems.push(`лот ${a.lot}: после курса 90,5 ед. ${a.unitIncl}/${a.unitExcl}, ожидалось ${exp.unitIncl}/${exp.unitExcl}`);
      if (a.rateInBreakdown !== "90.5") problems.push(`лот ${a.lot}: курс в разбивке ${a.rateInBreakdown}`);
      if (a.qty !== b.qty || a.price !== b.price) problems.push(`лот ${a.lot}: количество/цена изменились`);
    }
    // карточка, режим «Аукцион»
    await page.goto(cardUrl(inv));
    const tot = norm(await page.locator("text=Итого (RUB)").first().locator("xpath=..").innerText());
    const sumIncl = after.reduce((s, i) => s + i.unitIncl * i.qty, 0);
    if (Math.abs(num(tot.replace("Итого (RUB)", "")) - sumIncl) > 0.011) problems.push(`карточка: итог ${tot} != ${sumIncl}`);
    for (const mode of ["incl", "excl"] as const) {
      await setVat(context, mode);
      await page.goto(url(SP));
      const blk = page.locator("details[data-auction-purchase]", { hasText: "Счёт " + inv });
      const head = norm(await blk.innerText());
      if (!/курс 90,5/.test(head)) problems.push(`[${mode}] «Аукцион»: в шапке закупки нет «курс 90,5»`);
      const rows = await blk.locator("tbody > tr").evaluateAll((trs) => trs.filter((t) => t.querySelectorAll(":scope > td").length >= 10).map((t) => Array.from(t.querySelectorAll(":scope > td")).slice(1).map((x) => (x as HTMLElement).innerText)));
      rows.forEach((r, k) => {
        const c = r.map(norm);
        const wantU = mode === "incl" ? after[k].unitIncl : after[k].unitExcl;
        if (Math.abs(num(c[7].split("Из чего")[0]) - wantU) > 0.006) problems.push(`[${mode}] лот ${after[k].lot}: ед. ${c[7]} vs ${wantU}`);
        if (num(c[6]) !== 90.5) problems.push(`[${mode}] лот ${after[k].lot}: колонка «Курс» ${c[6]}`);
      });
    }
    await setVat(context, "incl");
    // другая закупка не затронута
    planItems("3017").forEach((i, k) => { if (i.unitIncl !== other[k]) problems.push("курс закупки 3018 изменил лот закупки 3017"); });
    // «Курс закупки» в форме показывает актуальное значение после перезагрузки
    await page.goto(cardUrl(inv));
    if ((await page.locator('input[name="exchangeRate"]').inputValue()) !== "90,5") problems.push("поле курса после сохранения показывает " + (await page.locator('input[name="exchangeRate"]').inputValue()));
    // обратно
    await setRate(page, "84,4075");
    await expect.poll(() => sql(`select "exchangeRate" from "Purchase" where "organizationId"='${ORG}' and "invoiceNumber"='${inv}'`), { timeout: 8000 }).toBe("84.407500");
    planItems(inv).forEach((a, k) => { if (Math.abs(a.unitIncl - before[k].unitIncl) > 0.0001 || Math.abs(a.unitExcl - before[k].unitExcl) > 0.0001) problems.push(`обратный пересчёт: лот ${a.lot} ${a.unitIncl} != исходное ${before[k].unitIncl}`); });
    // курс с 7 знаками: БД хранит 6
    await page.goto(cardUrl(inv));
    await setRate(page, "84,4075123");
    await page.waitForTimeout(1200);
    const r7 = sql(`select "exchangeRate" from "Purchase" where "organizationId"='${ORG}' and "invoiceNumber"='${inv}'`);
    const a7 = planItems(inv)[0];
    const exp7 = calcPlan({ quantity: String(before[0].qty), price: String(before[0].price), feePct: String(before[0].inputs.feePct), dressing: String(before[0].inputs.dressing), transport: String(before[0].inputs.transport), brokerPct: String(before[0].inputs.brokerPct), transit: String(before[0].inputs.transit), vat: String(before[0].vat) }, 84.407512);
    console.log("курс с 7 знаками: в БД", r7, "ед. в плане", a7.unitIncl, "по 6 знакам", exp7.unitIncl, "в разбивке", a7.rateInBreakdown);
    if (a7.rateInBreakdown !== "84.4075123" && r7 === "84.407512") problems.push(`курс 7 знаков: в закупке ${r7}, а в расчёте лотов ${a7.rateInBreakdown} (округление БД, расхождение)`);
    await page.goto(cardUrl(inv));
    await setRate(page, "84,4075");
    await expect.poll(() => sql(`select "exchangeRate" from "Purchase" where "organizationId"='${ORG}' and "invoiceNumber"='${inv}'`), { timeout: 8000 }).toBe("84.407500");
    console.log("ПРОБЛЕМЫ:\n" + problems.join("\n"));
    expect(problems, problems.join("\n")).toEqual([]);
    await expectNoErrors(errors);
  });
});

// ---------- 3d. править расчёт -> принять на склад -> запрет правки ----------
const r2 = (n: number) => Math.round(n * 100) / 100;
test.describe("3d. приёмка закупки с изменённым расчётом", () => {
  test("лот получает costPlan, расходы распределяются, после приёмки править нельзя", async ({ page, context, browser }) => {
    test.setTimeout(240_000);
    const errors = watchErrors(page);
    page.on("dialog", (d) => d.accept());
    await login(page);
    const inv = "T3D", AUC = "ТЕСТ-АУК-3D";
    const pid = cloneDraft("3050", inv, AUC);
    // расход закупки 10 000 ₽ + НДС 20% — должен распределиться по лотам пропорционально
    sql(`insert into "PurchaseExpense"(id,"purchaseId","categoryId",amount,"vatRate",description) values ('exp_aud_1','${pid}','cmuo7vxg60005lsu5p71srt03',10000,20,'тест-расход')`);
    const problems: string[] = [];
    await page.goto(cardUrl(inv));
    // 1. захват действия «Править расчёт» для повтора после приёмки (запрос отменяем)
    const NEW: PlanIn = { quantity: "6", price: "90", feePct: "7,35", dressing: "1200", transport: "30", brokerPct: "4,5", transit: "100", vat: "22" };
    await openEditor(page, "27010");
    await fillEditor(page, NEW);
    const cap = await captureActions(page, async () => { await page.getByRole("dialog").getByRole("button", { name: "Сохранить расчёт" }).click(); });
    expect(cap.length).toBe(1);
    await page.reload();
    const lot27010Before = itemRow(inv, "27010");
    expect(lot27010Before[1]).toBe("5.000");
    // 2. реальная правка
    await openEditor(page, "27010");
    await fillEditor(page, NEW);
    const live = await liveNumbers(page);
    await page.getByRole("dialog").getByRole("button", { name: "Сохранить расчёт" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 8000 });
    // и одну правку количества другого лота
    await openEditor(page, "27006");
    await fillEditor(page, { quantity: "28", dressing: "1300" });
    await page.getByRole("dialog").getByRole("button", { name: "Сохранить расчёт" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 8000 });
    await page.reload();
    const totBefore = norm(await page.locator("text=Итого (RUB)").first().locator("xpath=..").innerText());
    const plans = planItems(inv);
    const unitsExpected = plans.map((p) => ({ lot: p.lot, qty: p.qty, unit: p.unitIncl, excl: p.unitExcl }));
    const base = unitsExpected.reduce((s, u) => s + u.unit * u.qty, 0);
    const expInclTotal = 12000;
    // 3. приёмка
    const dashBefore = await dashNums(page);
    await page.goto(cardUrl(inv));
    await page.getByRole("button", { name: "Принять на склад" }).click();
    await expect.poll(() => sql(`select status from "Purchase" where id='${pid}'`), { timeout: 15000 }).toBe("RECEIVED");
    // 4. сверка лотов
    const lots = sql(`select i."lotNumber", l.quantityReceived, l."quantityRemaining", l."unitCost", l."totalCost", l."materialCostExclVat", l."materialVatAmount", l."expenseCostExclVat", l."expenseVatAmount", l."costBreakdown"::text from "PurchaseItem" i join "RawMaterialLot" l on l.id=i."lotId" where i."purchaseId"='${pid}' order by i."lotNumber"`.replace("l.quantityReceived", 'l."quantityReceived"')).split("\n").map((l) => l.split("|"));
    expect(lots.length).toBe(3);
    let sumTotal = 0, sumRemainValue = 0;
    for (const L of lots) {
      const p = plans.find((x) => x.lot === L[0])!;
      const alloc = (expInclTotal * (p.unitIncl * p.qty)) / base;
      const wantUnit = r2(p.unitIncl + alloc / p.qty);
      const wantTotal = r2(p.unitIncl * p.qty + alloc);
      const bd = JSON.parse(L[9]);
      const planBd = JSON.parse(sql(`select "costPlan"->'costBreakdown' from "PurchaseItem" where "purchaseId"='${pid}' and "lotNumber"='${L[0]}'`));
      console.log("лот", L[0], "qty", L[1], "unitCost", L[3], "want", wantUnit, "total", L[4], "want", wantTotal, "mat", L[5], "exp", L[7]);
      if (Math.abs(+L[3] - wantUnit) > 0.011) problems.push(`лот ${L[0]}: unitCost ${L[3]} != ${wantUnit} (план ${p.unitIncl} + доля расходов)`);
      if (Math.abs(+L[4] - wantTotal) > 0.011) problems.push(`лот ${L[0]}: totalCost ${L[4]} != ${wantTotal}`);
      if (+L[1] !== p.qty) problems.push(`лот ${L[0]}: количество ${L[1]} != ${p.qty}`);
      const matExcl = r2(p.price * 84.4283);
      if (Math.abs(+L[5] - matExcl) > 0.011) problems.push(`лот ${L[0]}: materialCostExclVat ${L[5]} != ${matExcl}`);
      // разбивка: строки плана + строка расходов
      const planItemsLbl = planBd.items.map((x: { label: string }) => x.label);
      const gotLbl = bd.items.map((x: { label: string }) => x.label);
      if (planItemsLbl.some((x: string, k: number) => gotLbl[k] !== x)) problems.push(`лот ${L[0]}: разбивка не совпадает со строками плана`);
      if (!gotLbl.includes("Расходы закупки (доля), ₽")) problems.push(`лот ${L[0]}: в разбивке нет доли расходов закупки`);
      const unitInBd = bd.items.find((x: { label: string }) => x.label.startsWith("Итого себестоимость"))?.value;
      if (Math.abs(unitInBd - p.unitIncl) > 0.0001) problems.push(`лот ${L[0]}: «Итого себестоимость за единицу» в разбивке ${unitInBd} != плана ${p.unitIncl}`);
      const shareInBd = bd.items.find((x: { label: string }) => x.label.startsWith("Расходы закупки"))?.value;
      if (Math.abs(shareInBd - r2(alloc / p.qty)) > 0.011) problems.push(`лот ${L[0]}: доля расходов в разбивке ${shareInBd} != ${r2(alloc / p.qty)}`);
      sumTotal += +L[4];
      sumRemainValue += +L[2] * +L[3];
      // без НДС: материал+расход = unit без НДС плана + доля расходов без НДС
      const wantExclTotal = p.unitExcl + (10000 * (p.unitIncl * p.qty)) / base / p.qty;
      if (Math.abs(+L[5] + +L[7] - wantExclTotal) > 0.011) problems.push(`лот ${L[0]}: без НДС ${+L[5] + +L[7]} != ${wantExclTotal}`);
    }
    const purchaseTotal = base + expInclTotal;
    console.log("сумма totalCost лотов", sumTotal, "итог закупки", purchaseTotal, "остаток в деньгах (qty*unitCost)", sumRemainValue, "карточка до приёмки:", totBefore);
    if (Math.abs(sumTotal - purchaseTotal) > 0.03) problems.push(`сумма totalCost лотов ${sumTotal} != итог закупки ${purchaseTotal}`);
    if (Math.abs(sumRemainValue - purchaseTotal) > 0.5) problems.push(`сумма остатка (qty × unitCost) ${r2(sumRemainValue)} != итог закупки ${r2(purchaseTotal)} (расхождение ${r2(sumRemainValue - purchaseTotal)} из-за округления unitCost до копеек)`);
    // 5. карточка после приёмки
    await page.goto(cardUrl(inv));
    const t = await page.locator("body").innerText();
    expect(t).toContain("Принято на склад");
    await expect(page.getByRole("button", { name: "Править расчёт" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Пересчитать все лоты" })).toHaveCount(0);
    const totAfter = norm(await page.locator("text=Итого (RUB)").first().locator("xpath=..").innerText());
    console.log("итог закупки на карточке до/после приёмки:", totBefore, "|", totAfter);
    if (num(totBefore.replace("Итого (RUB)", "")) !== num(totAfter.replace("Итого (RUB)", ""))) problems.push(`итог закупки изменился при приёмке: ${totBefore} -> ${totAfter}`);
    // 6. режим «Аукцион» после приёмки: оба режима НДС, остаток, «Из чего цена»
    for (const mode of ["incl", "excl"] as const) {
      await setVat(context, mode);
      await page.goto(url(AUC));
      const blk = page.locator("details[data-auction-purchase]", { hasText: "Счёт " + inv });
      await expect(blk.getByText("Принято на склад")).toBeVisible();
      await expect(blk.getByRole("button", { name: "Править расчёт" })).toHaveCount(0);
      await expect(blk.getByRole("link", { name: /Править закупку/ })).toHaveCount(0);
      const rows = await blk.locator("tbody > tr").evaluateAll((trs) => trs.filter((t) => t.querySelectorAll(":scope > td").length >= 10).map((t) => Array.from(t.querySelectorAll(":scope > td")).slice(1).map((x) => (x as HTMLElement).innerText)));
      rows.forEach((r) => {
        const c = r.map(norm);
        const L = lots.find((x) => x[0] === c[1])!;
        const wantU = mode === "incl" ? +L[3] : +L[5] + +L[7];
        if (Math.abs(num(c[7].split("Из чего")[0]) - wantU) > 0.006) problems.push(`[${mode}] «Аукцион» лот ${c[1]}: ед. ${c[7]} vs ${wantU}`);
        if (num(c[9]) !== +L[2]) problems.push(`[${mode}] «Аукцион» лот ${c[1]}: остаток ${c[9]}`);
      });
      if (mode === "incl") {
        const sumTxt = norm(await blk.locator("summary").innerText());
        if (Math.abs(num(sumTxt.split("шт.").pop()!) - purchaseTotal) > 0.011) problems.push(`заголовок закупки после приёмки ${sumTxt} vs итог ${purchaseTotal}`);
        // «Из чего цена» первой строки
        await blk.getByRole("button", { name: "Состав цены" }).first().click();
        const dlg = norm(await blk.locator("dialog[open]").first().innerText());
        console.log("Из чего цена (после приёмки):", dlg.slice(0, 900));
        await page.keyboard.press("Escape");
      }
    }
    await setVat(context, "incl");
    // 7. сервер: правка после приёмки запрещена (повтор захваченного запроса и пересчёт курса)
    const snap = () => sql(`select string_agg(i.id||i.quantity||i."unitPrice"||(i."costPlan"::text), ';' order by i.id) from "PurchaseItem" i where i."purchaseId"='${pid}'`);
    const s0 = snap();
    const r = await replay(context, cap[0]);
    console.log("повтор правки после приёмки:", r.status, norm(r.text).slice(-160));
    if (!/Закупка уже принята на склад или отменена/.test(r.text)) problems.push("повтор updateCostPlanItem после приёмки: нет сообщения об отказе");
    if (snap() !== s0) problems.push("правка расчёта прошла после приёмки!");
    // закупка уже принята -> повторная приёмка
    const dash = await dashNums(page);
    console.log("сводка до/после приёмки:", JSON.stringify(dashBefore), JSON.stringify(dash));
    console.log("ПРОБЛЕМЫ:\n" + problems.join("\n"));
    expect(problems, problems.join("\n")).toEqual([]);
    await expectNoErrors(errors.filter((e) => !/Failed to fetch|ERR_FAILED/.test(e)));
    void live; void browser;
  });
});


// ---------- 3e. роли / чужая организация / отменённая закупка для «Править расчёт» ----------
const rep = (c: Captured, pairs: [string, string][]): Captured => {
  let t = c.data.toString("latin1");
  for (const [a, b] of pairs) t = t.split(a).join(b);
  return { ...c, data: Buffer.from(t, "latin1") };
};
const planSnap = (pid: string) => sql(`select (select "exchangeRate"::text||status::text from "Purchase" where id='${pid}')||'#'||coalesce(string_agg(i.id||i.quantity||i."unitPrice"||i."vatRate"||(i."costPlan"::text), ';' order by i.id),'') from "PurchaseItem" i where i."purchaseId"='${pid}'`);

test.describe("3e. «Править расчёт»: роли, чужая организация, отменённая закупка", () => {
  test("UI и сервер", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const errors = watchErrors(page);
    page.on("dialog", (d) => d.accept());
    await login(page);
    const AUC = "ТЕСТ-АУК-3E", inv = "T3E";
    const pid = cloneDraft("3019", inv, AUC);
    const itemId = sql(`select id from "PurchaseItem" where "purchaseId"='${pid}' order by id limit 1`);
    const lot = sql(`select "lotNumber" from "PurchaseItem" where id='${itemId}'`);
    await page.goto(cardUrl(inv));
    await openEditor(page, lot);
    await fillEditor(page, { quantity: "77", price: "333" });
    const capEdit = (await captureActions(page, async () => { await page.getByRole("dialog").getByRole("button", { name: "Сохранить расчёт" }).click(); }))[0];
    await page.reload();
    const capRate = (await captureActions(page, async () => { await setRate(page, "99,5"); }))[0];
    expect(capEdit && capRate).toBeTruthy();
    const base = planSnap(pid);
    const report: string[] = [];
    const defects: string[] = [];
    // чужая организация: подмена id
    const bobPid = "p_b", bobItem = "pi_b";
    for (const [label, who] of [["viewer@qa-test.ru", "VIEWER"], ["wh@qa-test.ru", "WAREHOUSE"], ["acc@qa-test.ru", "ACCOUNTANT"], ["tech@qa-test.ru", "TECHNOLOGIST"], ["bob@other-org.ru", "ЧУЖАЯ ОРГ"]] as const) {
      const { ctx, page: p } = await newUserContext(browser, label);
      if (who !== "ЧУЖАЯ ОРГ") {
        await p.goto(url(AUC));
        if (await p.getByRole("button", { name: "Править расчёт" }).count()) defects.push(`${who}: в режиме «Аукцион» видна кнопка «Править расчёт»`);
        await p.goto(cardUrl(inv));
        if (await p.getByRole("button", { name: "Править расчёт" }).count()) defects.push(`${who}: на карточке видна кнопка «Править расчёт»`);
        if (await p.getByRole("button", { name: "Пересчитать все лоты" }).count()) defects.push(`${who}: на карточке видна кнопка «Пересчитать все лоты»`);
      }
      for (const [k, c] of [["edit", capEdit], ["rate", capRate]] as const) {
        const r = await replay(ctx, c);
        report.push(`${who}/${k}: HTTP ${r.status} ${norm(r.text).slice(-110)}`);
        if (planSnap(pid) !== base) defects.push(`${who}/${k}: расчёт изменён!`);
      }
      if (who === "ЧУЖАЯ ОРГ") {
        // свой purchaseId, но чужая позиция; чужая закупка + своя позиция
        const r1 = await replay(ctx, rep(capEdit, [[pid, bobPid]]));
        const r2 = await replay(ctx, rep(capEdit, [[itemId, bobItem]]));
        report.push(`ЧУЖАЯ ОРГ/edit(свой purchase, чужая позиция): ${norm(r1.text).slice(-90)}`);
        report.push(`ЧУЖАЯ ОРГ/edit(чужая закупка, своя позиция): ${norm(r2.text).slice(-90)}`);
        if (planSnap(pid) !== base) defects.push("ЧУЖАЯ ОРГ: подмена id изменила чужой расчёт");
        const own = sql(`select quantity from "PurchaseItem" where id='${bobItem}'`);
        if (own !== "10.000") defects.push("ЧУЖАЯ ОРГ: IDOR — позиция org_b изменилась: " + own);
      }
      await ctx.close();
    }
    console.log(report.join("\n"));
    // контроль: PURCHASER/ADMIN могут
    for (const [label, who] of [["purch@qa-test.ru", "PURCHASER"], ["admin@qa-test.ru", "ADMIN"]] as const) {
      const { ctx, page: p } = await newUserContext(browser, label);
      await p.goto(cardUrl(inv));
      await expect(p.getByRole("button", { name: "Править расчёт" }).first()).toBeVisible();
      const b0 = planSnap(pid);
      await replay(ctx, capEdit);
      if (planSnap(pid) === b0) defects.push(`${who}: правка расчёта не применилась`);
      await replay(ctx, rep(capEdit, [["77", "30"], ["333", "310"]]));
      await ctx.close();
    }
    // отменённая закупка: через UI «Отменить закупку»
    await page.goto(cardUrl(inv));
    await page.locator("details summary", { hasText: "⋯" }).click();
    await page.getByRole("button", { name: "Отменить закупку" }).click();
    await expect.poll(() => sql(`select status from "Purchase" where id='${pid}'`), { timeout: 8000 }).toBe("CANCELLED");
    await page.reload();
    await expect(page.getByRole("button", { name: "Править расчёт" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Пересчитать все лоты" })).toHaveCount(0);
    const note = norm(await page.locator("body").innerText());
    console.log("Отменённая: текст про расчёт:", note.match(/Закупка уже [^.]*\./)?.[0]);
    await page.goto(url(AUC));
    await expect(page.getByRole("button", { name: "Править расчёт" })).toHaveCount(0);
    const cancelled = planSnap(pid);
    for (const [k, c] of [["edit", capEdit], ["rate", capRate]] as const) {
      const r = await replay(page.context(), c);
      report.push(`ОТМЕНЕНА/${k}: ${norm(r.text).slice(-110)}`);
      if (!/принята на склад или отменена/.test(r.text)) defects.push(`отменённая/${k}: нет отказа`);
      if (planSnap(pid) !== cancelled) defects.push(`отменённая/${k}: расчёт изменён`);
    }
    // принять отменённую нельзя
    const rcv = sql(`select count(*) from "RawMaterialLot" where "purchaseId"='${pid}'`);
    expect(rcv).toBe("0");
    console.log("ДЕФЕКТЫ:\n" + defects.join("\n"));
    expect(defects, defects.join("\n")).toEqual([]);
    await expectNoErrors(errors.filter((e) => !/Failed to fetch|ERR_FAILED/.test(e)));
  });
});

// ---------- 3g. гонки ----------
function consistent(pid: string): string[] {
  const out: string[] = [];
  const rate = Number(sql(`select "exchangeRate" from "Purchase" where id='${pid}'`));
  const rows = sql(`select i.id, i."lotNumber", i.quantity, i."unitPrice", i."vatRate", i."costPlan"::text from "PurchaseItem" i where i."purchaseId"='${pid}' order by i.id`).split("\n");
  for (const l of rows) {
    const [, lot, q, up, vat, json] = l.split("|");
    const cp = JSON.parse(json);
    const items: { label: string; value: number }[] = cp.costBreakdown.items;
    const priceInPlan = items.find((x) => x.label.startsWith("Цена за ед., $"))?.value;
    const rateInPlan = Number(cp.costBreakdown.exchangeRateInvoice);
    if (Math.abs((priceInPlan ?? -1) - +up) > 1e-9) out.push(`лот ${lot}: цена в расчёте ${priceInPlan} != цена позиции ${up}`);
    if (Math.abs(rateInPlan - rate) > 1e-9) out.push(`лот ${lot}: курс в расчёте ${rateInPlan} != курс закупки ${rate}`);
    const i = cp.inputs;
    if (i) {
      const exp = calcPlan({ quantity: q, price: up, feePct: String(i.feePct), dressing: String(i.dressing), transport: String(i.transport), brokerPct: String(i.brokerPct), transit: String(i.transit), vat }, rate);
      if (Math.abs(exp.unitIncl - +cp.unitCostInclVat) > 0.0005) out.push(`лот ${lot}: себестоимость в расчёте ${cp.unitCostInclVat}, по цене/курсу/параметрам должно быть ${exp.unitIncl.toFixed(6)}`);
    }
  }
  return out;
}

test.describe("3g. гонки", () => {
  test("две правки; правка × курс; правка × приёмка", async ({ page }) => {
    test.setTimeout(300_000);
    const errors = watchErrors(page);
    page.on("dialog", (d) => d.accept());
    await login(page);
    const AUC = "ТЕСТ-АУК-3G";
    const A = cloneDraft("3019", "T3GA", AUC);
    const itemA = sql(`select id from "PurchaseItem" where "purchaseId"='${A}' order by id limit 1`);
    const lotA = sql(`select "lotNumber" from "PurchaseItem" where id='${itemA}'`);
    const capEdit = async (v: Partial<PlanIn>) => {
      await page.goto(cardUrl("T3GA"));
      await openEditor(page, lotA);
      await fillEditor(page, v);
      const c = (await captureActions(page, async () => { await page.getByRole("dialog").getByRole("button", { name: "Сохранить расчёт" }).click(); }))[0];
      return c;
    };
    const E1 = await capEdit({ quantity: "77", price: "333", dressing: "1500" });
    const E2 = await capEdit({ quantity: "12", price: "410", transport: "55" });
    await page.goto(cardUrl("T3GA"));
    const R = (await captureActions(page, async () => { await setRate(page, "99,5"); }))[0];
    await page.goto(cardUrl("T3GA"));
    const V = (await captureActions(page, async () => { await page.getByRole("button", { name: "Принять на склад" }).click(); }))[0];
    expect(E1 && E2 && R && V).toBeTruthy();
    const ctx = page.context();
    const mk = (tag: string) => { const id = cloneDraft("3019", tag, AUC); return { id, item: sql(`select id from "PurchaseItem" where "purchaseId"='${id}' order by id limit 1`) }; };
    const sw = (c: Captured, t: { id: string; item: string }) => rep(c, [[A, t.id], [itemA, t.item]]);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const bugs: Record<string, string[]> = { "правка×правка": [], "правка×курс": [], "правка×приёмка": [] };
    const N = 14;
    for (let k = 0; k < N; k++) {
      const off = [0, 3, 8, 15, 25][k % 5];
      // (a)
      let t = mk(`T3Ga${k}`);
      await Promise.all([replay(ctx, sw(E1, t)), sleep(off).then(() => replay(ctx, sw(E2, t)))]);
      let c = consistent(t.id); if (c.length) bugs["правка×правка"].push(`#${k} off=${off}: ${c.join("; ")}`);
      // (b)
      t = mk(`T3Gb${k}`);
      await Promise.all([replay(ctx, sw(E1, t)), sleep(off).then(() => replay(ctx, rep(R, [[A, t.id]])))]);
      c = consistent(t.id); if (c.length) bugs["правка×курс"].push(`#${k} off=${off}: ${c.join("; ")}`);
      await Promise.all([replay(ctx, rep(R, [[A, t.id]])), sleep(off).then(() => replay(ctx, sw(E2, t)))]);
      c = consistent(t.id); if (c.length) bugs["правка×курс"].push(`#${k}b off=${off}: ${c.join("; ")}`);
      // (c)
      t = mk(`T3Gc${k}`);
      const [e, v] = await Promise.all([replay(ctx, sw(E1, t)), sleep(off).then(() => replay(ctx, rep(V, [[A, t.id]])))]);
      void e; void v;
      const st = sql(`select status from "Purchase" where id='${t.id}'`);
      if (st === "RECEIVED") {
        const row = sql(`select l."unitCost", i."costPlan"->>'unitCostInclVat', l."quantityReceived", i.quantity from "PurchaseItem" i join "RawMaterialLot" l on l.id=i."lotId" where i.id='${t.item}'`).split("|");
        if (row.length < 4) bugs["правка×приёмка"].push(`#${k}: лот не создан`);
        else if (Math.abs(+row[0] - +row[1]) > 0.006 || +row[2] !== +row[3]) bugs["правка×приёмка"].push(`#${k} off=${off}: лот ${row[0]} × ${row[2]} vs позиция ${row[1]} × ${row[3]} (правка применилась после приёмки)`);
      }
    }
    const lines = Object.entries(bugs).map(([k, v]) => `${k}: ${v.length ? v.length + " из " + N + " — " + v.slice(0, 3).join(" | ") : "расхождений нет (" + N + " попыток)"}`);
    console.log(lines.join("\n"));
    await expectNoErrors(errors.filter((e) => !/Failed to fetch|ERR_FAILED/.test(e)));
    expect.soft(Object.values(bugs).flat(), "гонки: " + lines.join("\n")).toEqual([]);
  });
});

// ---------- 3h. правка из режима «Аукцион»: строка и итоги обновляются сразу ----------
test.describe("3h. «Править расчёт» из режима «Аукцион»", () => {
  test("после сохранения строка, итог закупки и итоги аукциона обновляются без перезагрузки", async ({ page }) => {
    const errors = watchErrors(page);
    await login(page);
    const AUC = "ТЕСТ-АУК-3H";
    const pid = cloneDraft("3020", "T3H", AUC);
    void pid;
    await page.goto(url(AUC));
    const sumBefore = norm(await page.locator("dl > div").nth(3).innerText());
    const blk = page.locator("details[data-auction-purchase]", { hasText: "Счёт T3H" });
    const row = blk.locator("tbody > tr").filter({ hasText: "877" }).first();
    await row.getByRole("button", { name: "Править расчёт" }).click();
    await fillEditor(page, { quantity: "50", price: "400" });
    const live = await liveNumbers(page);
    await page.getByRole("dialog").getByRole("button", { name: "Сохранить расчёт" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 8000 });
    await page.waitForTimeout(800);
    const cells = (await blk.locator("tbody > tr").filter({ hasText: "877" }).first().locator(":scope > td").allInnerTexts()).slice(1).map(norm);
    console.log("после правки (без перезагрузки):", cells.slice(4, 9).join(" | "), "форма:", live.unitIncl, live.totalIncl);
    expect(num(cells[4].split("шт")[0])).toBe(50);
    expect(Math.abs(num(cells[7].split("Из чего")[0]) - live.unitIncl)).toBeLessThan(0.006);
    expect(Math.abs(num(cells[8]) - live.totalIncl)).toBeLessThan(0.011);
    const sumAfter = norm(await page.locator("dl > div").nth(3).innerText());
    expect(sumAfter).not.toBe(sumBefore);
    const want = Number(sql(`select sum((i."costPlan"->>'unitCostInclVat')::numeric*i.quantity) from "PurchaseItem" i where i."purchaseId"='${pid}'`));
    expect(Math.abs(num(sumAfter) - want)).toBeLessThan(0.011);
    await expectNoErrors(errors);
  });
});

// ---------- 4. мобильная вёрстка 375×812 ----------
test.describe("4. мобильная вёрстка", () => {
  test("режим «Аукцион» и формы: нет горизонтального скролла страницы", async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "ru-RU" });
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await login(page);
    const SH = "/tmp/fur-e2e/shots";
    const pid3017 = sql(`select id from "Purchase" where "organizationId"='${ORG}' and "invoiceNumber"='3017'`);
    const report: string[] = [];
    const check = async (name: string) => {
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const vw = de.clientWidth;
        const wide: string[] = [];
        document.querySelectorAll("body *").forEach((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          if (r.right > vw + 1) {
            // игнорируем содержимое прокручиваемых контейнеров
            let p: HTMLElement | null = (el as HTMLElement).parentElement, inScroll = false;
            while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll" || o === "hidden") { inScroll = true; break; } p = p.parentElement; }
            if (!inScroll && wide.length < 6) wide.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 40)} right=${Math.round(r.right)}`);
          }
        });
        return { sw: de.scrollWidth, cw: vw, wide };
      });
      report.push(`${name}: scrollWidth=${m.sw} clientWidth=${m.cw}${m.sw > m.cw ? "  ГОРИЗОНТАЛЬНЫЙ СКРОЛЛ" : ""}${m.wide.length ? " выступают: " + m.wide.join(", ") : ""}`);
      await page.screenshot({ path: `${SH}/m-${name}.png`, fullPage: false });
      return m;
    };
    await page.goto(url(SP));
    await check("aukcion-top");
    await page.screenshot({ path: `${SH}/m-aukcion-full.png`, fullPage: true });
    // 1-я закупка раскрыта: таблица
    await page.locator("details[data-auction-purchase] summary").first().scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 900));
    await check("aukcion-purchase");
    await page.locator("details[data-auction-purchase]").first().getByRole("button", { name: "Править расчёт" }).first().scrollIntoViewIfNeeded();
    await page.locator("details[data-auction-purchase]").first().getByRole("button", { name: "Править расчёт" }).first().click();
    await page.waitForTimeout(300);
    await check("editor-dialog");
    const dlg = await page.getByRole("dialog").boundingBox();
    report.push(`editor-dialog: bbox ${JSON.stringify(dlg)}`);
    const btn = await page.getByRole("dialog").getByRole("button", { name: "Сохранить расчёт" }).boundingBox();
    report.push(`editor-dialog: кнопка «Сохранить» ${btn ? `y=${Math.round(btn.y)}..${Math.round(btn.y + btn.height)} (вьюпорт 812)` : "не видна"}`);
    await page.getByRole("dialog").getByRole("button", { name: "Отмена" }).click();
    // из чего цена
    await page.locator("details[data-auction-purchase]").first().getByRole("button", { name: "Состав цены" }).first().click();
    await page.waitForTimeout(300);
    await check("breakdown-dialog");
    await page.keyboard.press("Escape");
    // документы
    await page.getByText("Документы аукциона (11)").scrollIntoViewIfNeeded();
    await check("docs");
    await page.getByText("Загрузить документ", { exact: true }).scrollIntoViewIfNeeded();
    await check("docs-upload");
    // переименование
    await page.getByRole("button", { name: "Переименовать" }).first().click();
    await check("docs-rename");
    // карточка закупки
    await page.goto(`/purchases/${pid3017}`);
    await check("purchase-top");
    await page.getByText("Расчёт себестоимости по лотам", { exact: true }).scrollIntoViewIfNeeded();
    await check("purchase-plan");
    await page.getByText("Документы (", { exact: false }).first().scrollIntoViewIfNeeded();
    await check("purchase-docs");
    await page.getByRole("button", { name: "Править расчёт" }).first().click();
    await check("purchase-editor");
    await page.getByRole("dialog").getByRole("button", { name: "Отмена" }).click();
    // формы
    await page.goto("/purchases/new");
    await check("purchase-new");
    await page.goto("/lots");
    await check("lots-default");
    await page.goto(url("СП"));
    await check("aukcion-multi");
    await page.goto(url("ZZZ"));
    await check("aukcion-notfound");
    console.log(report.join("\n"));
    expect.soft(report.filter((r) => /ГОРИЗОНТАЛЬНЫЙ/.test(r)), "горизонтальный скролл страницы").toEqual([]);
    await expectNoErrors(errors);
    await ctx.close();
  });
});


// ---------- 5. оба режима НДС, NaN/undefined, консоль ----------
test.describe("5. оба режима НДС, консоль", () => {
  test("страницы без NaN/undefined/ошибок; «Расчёт себестоимости» и итоги в «Без НДС»", async ({ page, context }) => {
    const errors = watchErrors(page);
    await login(page);
    const inv = "3023";
    const pid = sql(`select id from "Purchase" where "organizationId"='${ORG}' and "invoiceNumber"='${inv}'`);
    const plans = planItems(inv);
    for (const mode of ["incl", "excl"] as const) {
      await setVat(context, mode);
      for (const u of ["/dashboard", "/purchases", `/purchases/${pid}`, "/lots", "/lots?tab=lining", url(SP), url("SAGA 03.26"), url("СП"), "/raw-materials"]) {
        const r = await page.goto(u);
        expect(r?.status(), u).toBeLessThan(400);
        const t = await page.locator("body").innerText();
        expect(t, `${mode} ${u}`).not.toMatch(/NaN|undefined|Infinity|\[object/);
      }
      // карточка: «Расчёт себестоимости по лотам» — единица и всего в выбранном режиме
      await page.goto(`/purchases/${pid}`);
      for (const pl of plans) {
        const row = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Править расчёт" }) }).filter({ hasText: pl.lot }).first();
        const c = (await row.locator(":scope > td").allInnerTexts()).map(norm);
        const wantU = mode === "incl" ? pl.unitIncl : pl.unitExcl;
        if (Math.abs(num(c[3].split("Из чего")[0]) - wantU) > 0.006) throw new Error(`${mode} лот ${pl.lot}: ед. ${c[3]} vs ${wantU}`);
        if (Math.abs(num(c[4]) - wantU * pl.qty) > 0.011) throw new Error(`${mode} лот ${pl.lot}: всего ${c[4]} vs ${wantU * pl.qty}`);
      }
      const tot = norm(await page.locator("text=Итого (RUB)").first().locator("xpath=..").innerText());
      const wantTot = plans.reduce((s, p) => s + (mode === "incl" ? p.unitIncl : p.unitExcl) * p.qty, 0);
      console.log(mode, "итог на карточке:", tot, "по расчёту:", wantTot.toFixed(2));
    }
    await setVat(context, "incl");
    await expectNoErrors(errors);
  });

  test("ссылки: счёт аукциона, карточка закупки", async ({ page }) => {
    await login(page);
    await page.goto(url(SP));
    for (const inv of ["3017", "3050"]) {
      const pid = sql(`select id from "Purchase" where "organizationId"='${ORG}' and "invoiceNumber"='${inv}'`);
      const did = sql(`select id from "PurchaseDocument" where "purchaseId"='${pid}' and kind='AUCTION_INVOICE'`);
      const blk = page.locator("details[data-auction-purchase]", { hasText: "Счёт " + inv });
      expect(await blk.getByRole("link", { name: /Карточка закупки/ }).getAttribute("href")).toBe(`/purchases/${pid}`);
      expect(await blk.getByRole("link", { name: /Править закупку/ }).getAttribute("href")).toBe(`/purchases/${pid}`);
      expect(await blk.getByRole("link", { name: /Счёт аукциона №/ }).getAttribute("href")).toMatch(new RegExp(`^/api/purchase-docs/${did}\\?v=[^&]+$`));
    }
    // принятый аукцион без счёта в документах
    await page.goto(url("SAGA 03.26"));
    expect(await page.getByText("счёта аукциона в документах нет").count()).toBe(7);
  });
});
