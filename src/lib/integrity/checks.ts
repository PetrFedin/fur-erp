// Инварианты самопроверки: проверки — по разделам в _checks/, основа — checks-base.ts. Порядок проверок прежний.
import { fmt, money, sgn, type CheckDef } from "./checks-base";
import { STOCK_CHECKS } from "./_checks/stock";
import { PURCHASE_CHECKS } from "./_checks/purchases";
import { ORDER_CHECKS } from "./_checks/orders";
import { PAYMENT_CHECKS } from "./_checks/payments";
import { REF_CHECKS } from "./_checks/refs";
import { VERIFY_CHECKS } from "./_checks/verify";
import { DUPE_CHECKS } from "./_checks/dupes";
export { ROUND_TOL_RUB, makeHelpers } from "./checks-base";
export type { Ctx, DebtProbe, CheckDef, Helpers } from "./checks-base";

const CHECKS: CheckDef[] = [...STOCK_CHECKS, ...PURCHASE_CHECKS, ...ORDER_CHECKS, ...PAYMENT_CHECKS, ...REF_CHECKS, ...VERIFY_CHECKS, ...DUPE_CHECKS];

export const ALL_CHECKS: readonly CheckDef[] = CHECKS;
export { fmt as fmtNum, money as fmtMoney, sgn as fmtSigned };
