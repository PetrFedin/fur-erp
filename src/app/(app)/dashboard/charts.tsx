"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { formatMoney } from "@/lib/utils";

export function MonthlyPurchasesChart({ data }: { data: { month: string; total: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} width={80} tickFormatter={(v) => new Intl.NumberFormat("ru-RU", { notation: "compact" }).format(v)} />
        <Tooltip formatter={(value) => formatMoney(Number(value))} />
        <Bar dataKey="total" fill="#171717" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
