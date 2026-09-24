import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const rubFormatter = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 2,
});

export function formatMoney(value: number | string) {
  return rubFormatter.format(Number(value));
}

const qtyFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 3,
});

export function formatQty(value: number | string) {
  return qtyFormatter.format(Number(value));
}

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function formatDate(value: Date | string) {
  return dateFormatter.format(new Date(value));
}
