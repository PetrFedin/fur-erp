// Домен денег: чистые функции (без базы). node --env-file=.env node_modules/.bin/tsx scripts/test-domain-money.ts
import { RUB_EPS, isNegative, isPositive, isZero, debtState, debtStateOfRest, payPair, sumPairs, transferOverpay, usedByMode, vatShare, withExtra } from "../src/domain/money";

let fails = 0, checks = 0;
const ok = (what: string, cond: boolean, extra = "") => { checks++; if (!cond) { fails++; console.log(`  ✗ ${what} ${extra}`); } };
const near = (what: string, a: number, b: number, tol = 1e-6) => ok(what, Math.abs(a - b) <= tol, `(${a} ≠ ${b})`);

// долг / переплата / допуск
ok("долг", debtState(100, 40).kind === "debt" && debtState(100, 40).amount === 60);
ok("переплата", debtState(100, 160).kind === "overpay" && debtState(100, 160).amount === 60);
ok("округление ниже допуска — ничего", debtState(100, 99.7).kind === "none" && debtState(100, 100.3).kind === "none");
ok("граница допуска", debtState(100, 100 - RUB_EPS - 0.01).kind === "debt");
ok("debtStateOfRest", debtStateOfRest(-55594.51).kind === "overpay" && debtStateOfRest(7440208).kind === "debt");

// пороги
ok("isZero/isPositive/isNegative", isZero(0.4) && isZero(-0.5) && !isZero(0.6) && isPositive(0.6) && !isPositive(0.5) && isNegative(-0.6) && !isNegative(-0.5));

// «без НДС»: куплено − оплачено = долг сходится в обоих режимах
{
  const boughtI = 582284674, boughtX = 480773906, paidI = 574900061;
  const sh = vatShare(boughtI, boughtX);
  const paid = payPair(paidI, sh), debt = payPair(boughtI - paidI, sh);
  near("с НДС: куплено − оплачено = долг", boughtI - paid.incl, debt.incl, 1e-6);
  near("без НДС: куплено − оплачено = долг", boughtX - paid.excl, debt.excl, 0.5);
}
ok("нет стоимости — доля 1", vatShare(0, 0) === 1);
const s = sumPairs([{ incl: 10, excl: 8 }, { incl: 5, excl: 4 }]);
ok("сумма пар", s.incl === 15 && s.excl === 12);

// надбавка 4 %
ok("с 4 % — к использованному", usedByMode("on", 100, 4).value === 104 && usedByMode("on", 100, 4).extra === 4);
ok("без 4 % — как есть и без упоминаний", usedByMode("off", 100, 4).value === 100 && usedByMode("off", 100, 4).extra === 0);
ok("ничтожная надбавка не показывается", usedByMode("on", 100, 0.3).extra === 0);
ok("withExtra", withExtra("on") && !withExtra("off"));

// перенос переплаты: подкладка → мех (как подкладка 05.26 → AME 05.26)
{
  const over = [{ name: "Подкладка 05.26", amount: 55594.51, to: "AME 05.26" }];
  const fur = transferOverpay({ total: 582284675, paid: 574844467, remaining: 7440208 }, over, new Set(["AME 05.26", "SAGA 03.26"]));
  const lin = transferOverpay({ total: 6820118, paid: 6875712, remaining: -55594 }, over, new Set(["Подкладка 05.26"]));
  near("мех: оплата выросла", fur.paid, 574844467 + 55594.51, 0.001);
  near("мех: долг уменьшился", fur.remaining, 7440208 - 55594.51, 0.001);
  near("подкладка: оплата уменьшилась", lin.paid, 6875712 - 55594.51, 0.001);
  near("подкладка: долг стал ≈ 0", lin.remaining, -55594 + 55594.51, 0.001);
  near("итог закупок не изменился", fur.total, 582284675);
  const both = transferOverpay({ total: 100, paid: 120, remaining: -20 }, [{ name: "A", amount: 20, to: "B" }], new Set(["A", "B"]));
  ok("источник и получатель в одном виде — без изменений", both.paid === 120 && both.remaining === -20);
  ok("без получателя — без изменений", transferOverpay({ total: 1, paid: 2, remaining: -1 }, [{ name: "A", amount: 1, to: null }], new Set(["A"])).paid === 2);
}

console.log(fails ? `\nПровалов: ${fails} из ${checks}` : `\nВсё в порядке (${checks} проверок)`);
process.exit(fails ? 1 : 0);
