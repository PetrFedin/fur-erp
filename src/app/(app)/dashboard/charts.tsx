"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { formatMoney } from "@/lib/utils";

const COLORS = ["#171717", "#525252", "#a3a3a3", "#d4d4d4", "#737373", "#404040", "#e5e5e5"];

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

export function ExpenseBreakdownChart({ data }: { data: { name: string; value: number }[] }) {
  if (data.length === 0) {
    return <p className="py-12 text-center text-sm text-neutral-400">Нет данных о расходах</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(entry) => entry.name}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => formatMoney(Number(value))} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function ModelCostChart({ data }: { data: { name: string; unitCost: number }[] }) {
  if (data.length === 0) {
    return <p className="py-12 text-center text-sm text-neutral-400">Нет завершённых заказов</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} layout="vertical" margin={{ left: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v) => new Intl.NumberFormat("ru-RU", { notation: "compact" }).format(v)} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={140} />
        <Tooltip formatter={(value) => formatMoney(Number(value))} />
        <Bar dataKey="unitCost" fill="#171717" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
