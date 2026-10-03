import { requireSession } from "@/lib/session";

// Чистый макет для печатных форм: без меню и верхней панели.
// Данные по-прежнему только своей организации (requireSession + organizationId в запросах страниц).
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return (
    <div className="min-h-screen bg-neutral-100 print:bg-white">
      <style>{`
        @page { size: A4; margin: 15mm; }
        @media print {
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
          .print-sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; max-width: none !important; width: auto !important; }
          tr { break-inside: avoid; }
          .keep-together { break-inside: avoid; }
        }
      `}</style>
      {children}
    </div>
  );
}
