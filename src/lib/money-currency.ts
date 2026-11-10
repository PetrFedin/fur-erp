/**
 * Валюта показа денег на Главной: ₽ или € (переключатель в панели сезона). Пересчёт всегда по курсу 110, пока курс не известен по документам закупки меха.
 * Переключатель только про экран: данные и расчёты остаются в рублях. Флаг выставляется компонентом DashCurrency на время показа Главной.
 */
export const EUR_RATE = 110;
let eur = false;
export const isMoneyEur = () => eur;
export const setMoneyEur = (v: boolean) => { eur = v; };
/** Сумма для показа: рубли как есть или рубли ÷ 110 в режиме €. */
export const shownMoney = (rub: number) => (eur ? rub / EUR_RATE : rub);
export const moneySign = () => (eur ? "€" : "₽");
