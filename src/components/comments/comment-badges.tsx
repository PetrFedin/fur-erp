import { cn } from "@/lib/utils";
import { KIND_LABEL, PRIORITY_LABEL, STATUS_LABEL, type CKind, type CPriority, type CStatus } from "@/lib/comments-core";

const KIND_TONE: Record<CKind, string> = {
  REMARK: "bg-neutral-100 text-neutral-700",
  BUG: "bg-red-100 text-red-700",
  IDEA: "bg-emerald-100 text-emerald-800",
  QUESTION: "bg-blue-100 text-blue-700",
};
const PRIO_TONE: Record<CPriority, string> = { LOW: "bg-neutral-100 text-neutral-500", NORMAL: "bg-neutral-100 text-neutral-700", HIGH: "bg-amber-100 text-amber-900" };
const STATUS_TONE: Record<CStatus, string> = { OPEN: "bg-amber-100 text-amber-900", DONE: "bg-emerald-100 text-emerald-800", WONTFIX: "bg-neutral-200 text-neutral-600" };
const base = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";

export const KindBadge = ({ kind }: { kind: CKind }) => <span className={cn(base, KIND_TONE[kind])}>{KIND_LABEL[kind]}</span>;
export const PriorityBadge = ({ priority }: { priority: CPriority }) => (priority === "NORMAL" ? null : <span className={cn(base, PRIO_TONE[priority])}>{PRIORITY_LABEL[priority]} приоритет</span>);
export const StatusBadge = ({ status }: { status: CStatus }) => <span className={cn(base, STATUS_TONE[status])}>{STATUS_LABEL[status]}</span>;
