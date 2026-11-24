"use client";

import { formatMoney, formatNum } from "@/lib/utils";

export const usd = (v: number) => `$${formatNum(v, 1)}`;

export const rub = (v: number) => formatMoney(v.toFixed(2));

export const MAIN_FUR_TILES = ["Соболь", "Норка", "Рысь", "Свакара", "Лиса"];
