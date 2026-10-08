import type { BatchHeader, Decisions, DocKindKey, IntakeRow, Mapping } from "@/lib/batch-intake";

export type WizardRefs = {
  auctions: { id: string; name: string; house: string | null; currency: string | null; aliases: string[] }[];
  suppliers: { id: string; name: string }[];
  warehouses: { id: string; name: string; isDefault: boolean }[];
  materials: { id: string; name: string }[];
  furRefs: { id: string; name: string; nameEn: string | null; aliases: string[]; note: string | null }[];
  colors: { id: string; name: string; aliases: string[]; note: string | null }[];
  lotsByAuction: Record<string, [string, string][]>;
};

export type TableInfo = { fileName: string | null; headers: string[]; headerIdx: number; mapping: Mapping; table: string[][]; note: string };

export type DocState = {
  id: string;
  file: File;
  name: string;
  size: number;
  kind: DocKindKey;
  number: string;
  date: string;
  amount: string;
  textRead: boolean;
  notes: string[];
};

export type Draft = {
  v: 1;
  savedAt: number;
  step: number;
  header: BatchHeader;
  rows: IntakeRow[];
  decisions: Decisions;
  pct: Partial<Record<"fee" | "broker", boolean>>;
  info: Omit<TableInfo, "table"> | null;
  nextN: number;
};
