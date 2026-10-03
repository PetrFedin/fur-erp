// Официальный курс ЦБ РФ на дату: https://www.cbr.ru/scripts/XML_daily.asp?date_req=DD/MM/YYYY.
// XML в кодировке windows-1251, парсим без внешних зависимостей. Кэш по (дата, валюта) на сутки
// (курс на прошедшую дату не меняется; на «сегодня/завтра» ЦБ мог обновить — сутки приемлемы).

const TIMEOUT_MS = 8000;
const TTL_MS = 24 * 60 * 60 * 1000;

export type CbrRateResult = { rate: string; date: string } | { error: string };

type Table = Map<string, { nominal: number; value: number }>;
const cache = new Map<string, { at: number; table: Table; date: string }>();

/** «2025-07-01» -> «01/07/2025». */
function toCbrDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Разбор XML_daily: CharCode, Nominal, Value («79,7500»). */
export function parseCbrXml(xml: string): { date: string; table: Table } {
  const table: Table = new Map();
  const date = /<ValCurs[^>]*\sDate="([^"]+)"/.exec(xml)?.[1] ?? "";
  for (const m of xml.matchAll(/<Valute\b[^>]*>([\s\S]*?)<\/Valute>/g)) {
    const body = m[1];
    const code = /<CharCode>\s*([A-Z]{3})\s*<\/CharCode>/.exec(body)?.[1];
    const nominal = Number(/<Nominal>\s*([\d\s]+?)\s*<\/Nominal>/.exec(body)?.[1]?.replace(/\s/g, ""));
    const value = Number(/<Value>\s*([\d\s.,]+?)\s*<\/Value>/.exec(body)?.[1]?.replace(/\s/g, "").replace(",", "."));
    if (code && nominal > 0 && Number.isFinite(value) && value > 0) table.set(code, { nominal, value });
  }
  return { date, table };
}

export async function fetchCbrRate(currency: string, isoDate: string): Promise<CbrRateResult> {
  const cur = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) return { error: "Некорректный код валюты." };
  if (cur === "RUB") return { rate: "1.0000", date: isoDate };
  const req = toCbrDate(isoDate);
  if (!req) return { error: "Укажите корректную дату." };

  let entry = cache.get(req);
  if (!entry || Date.now() - entry.at > TTL_MS) {
    try {
      const res = await fetch(`https://www.cbr.ru/scripts/XML_daily.asp?date_req=${req}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
        headers: { Accept: "application/xml,text/xml" },
      });
      if (!res.ok) return { error: `Сайт ЦБ РФ ответил ошибкой (${res.status}). Введите курс вручную.` };
      const xml = new TextDecoder("windows-1251").decode(await res.arrayBuffer());
      const { date, table } = parseCbrXml(xml);
      if (table.size === 0) return { error: "ЦБ РФ вернул ответ без курсов. Введите курс вручную." };
      entry = { at: Date.now(), table, date };
      cache.set(req, entry);
    } catch {
      return { error: "Не удалось получить курс с сайта ЦБ РФ (сайт недоступен или не ответил за 8 секунд). Введите курс вручную." };
    }
  }
  const r = entry.table.get(cur);
  if (!r) return { error: `ЦБ РФ не публикует курс валюты ${cur}. Введите курс вручную.` };
  return { rate: (r.value / r.nominal).toFixed(4), date: entry.date };
}
