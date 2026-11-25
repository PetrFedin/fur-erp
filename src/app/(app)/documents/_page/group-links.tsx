import Link from "next/link";
import { type DocGroup } from "@/lib/drive-doc-list";
import { cn } from "@/lib/utils";
import { plural } from "./tones";

export function GroupLinks({ d, mobile }: { d: DocGroup; mobile?: boolean }) {
  if (d.links.length === 0) return <span className={mobile ? "text-xs text-amber-700" : "text-amber-700"}>не привязан</span>;
  const cls = mobile ? "inline-block py-1 text-xs underline" : "text-neutral-700 underline hover:text-neutral-900";
  const list = (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
      {d.links.map((l, i) => (
        <Link key={i} href={l.href} className={cls}>
          {l.label}
        </Link>
      ))}
    </span>
  );
  if (d.count === 1 && d.links.length <= 3) return list;
  return (
    <details>
      <summary className={cn("cursor-pointer text-neutral-700", mobile && "py-1 text-xs")}>
        {d.links.length} {plural(d.links.length, "привязка", "привязки", "привязок")}
        {d.unlinked > 0 ? <span className="ml-1 text-amber-700">· без привязки: {d.unlinked}</span> : null}
      </summary>
      <div className="mt-1">{list}</div>
    </details>
  );
}
