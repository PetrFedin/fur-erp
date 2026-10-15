/**
 * Реквизиты сторон для документов, которые кабинет Веллмеха собирает сам (счёт на оплату).
 * Источник — счета на оплату Веллмеха из переписки (№31/2025 … №275/2026: реквизиты везде одинаковые), проверено по текстам PDF.
 * Документы собираются только по реквизитам продавца-поставщика и покупателя; других данных (цены продажи, себестоимость изделий) здесь нет.
 */
export type PartyReq = { name: string; inn: string; kpp: string; address: string; phone?: string };
export type VendorReq = {
  inn: string;
  seller: PartyReq;
  buyer: PartyReq;
  bank: { name: string; bik: string; corrAccount: string; account: string };
  signer: string;
  /** Договор купли-продажи сырья (основание счетов на шкурки). */
  contract: { title: string; number: string; date: string };
};

export const WELLMEKH_REQ: VendorReq = {
  inn: "9729114877",
  seller: { name: "ООО \"ВеллМех\"", inn: "9729114877", kpp: "772901001", address: "119620, Москва г, вн.тер.г. муниципальный округ Солнцево, пр-кт Солнцевский, д. 14, помещ. 4/1", phone: "+74956181807" },
  buyer: { name: "ООО \"МЕРКУРИ МОДА\"", inn: "5032277847", kpp: "997350001", address: "143082, Московская область, г Одинцово, д Барвиха, дом 114, строение 2, этаж 1, помещение 100" },
  bank: { name: "ПАО Сбербанк г. Москва", bik: "044525225", corrAccount: "30101810400000000225", account: "40702810638000184298" },
  signer: "Вельмакина И. Е.",
  contract: { title: "Договор купли продажи", number: "2502", date: "26.02.2025" },
};

/** Реквизиты по ИНН поставщика; null — для этого поставщика счёт не собираем. */
export const requisitesByInn = (inn: string | null | undefined): VendorReq | null => (inn && inn.replace(/\D/g, "") === WELLMEKH_REQ.inn ? WELLMEKH_REQ : null);
