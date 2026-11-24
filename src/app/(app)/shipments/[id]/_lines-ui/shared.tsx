"use client";

import { type ReactNode } from "react";
import { type ZiSumView } from "../zi-source";
import { type ReworkState, type Stage } from "@/lib/shipment-stage";

export type LineEditValues = { id: string; label: string; quantity: number; size: string; comment: string; accepted: string; returned: string; itemNo: string; stage: Stage };

// ───────────── стадии: просмотр → доработка → готов к отгрузке ─────────────

export type ReworkRow = { id: string; text: string; state: ReworkState; note: string; created: string; updated: string };

// ───────────── таблица «Примерка» ─────────────

export type LineRow = {
  id: string;
  /** Номер строки в таблице (для сообщений об ошибках). */
  n: number;
  order: ReactNode;
  article: ReactNode;
  /** Текстом: для поиска. */
  orderText: string;
  articleText: string;
  itemNo: string;
  stage: Stage;
  /** «кто, когда» последней смены стадии. */
  stageNote: string;
  reworks: ReworkRow[];
  color: string | null;
  size: string | null;
  furKind: string | null;
  inTz: number | null;
  quantity: number;
  accepted: number | null;
  returned: number | null;
  comment: string;
  /** «ТЗ 182 · артикул · цвет · р. 44» — для окон и подтверждений. */
  label: string;
  /** Почему строку нельзя убрать (есть приёмка); null — можно. */
  blockedReason: string | null;
  /** Подписи для мобильной карточки. */
  title: ReactNode;
  href: string;
  subtitle: string;
  /** Накладные ЦУМ (ЗИ): поставка, бутик, сумма без НДС (сумма — только наша сторона). */
  supply?: string;
  boutique?: string;
  sum?: number | null;
  /** Откуда сумма накладной (окно «Откуда цифра»). */
  sumSrc?: ZiSumView;
  /** Сверка «накладная ↔ ТЗ»: совпало или нет. */
  check?: { ok: boolean; text: string; full: string };
};
