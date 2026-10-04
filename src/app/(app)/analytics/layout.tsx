import { AnalyticsTabs } from "./analytics-tabs";

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <AnalyticsTabs />
      {children}
    </div>
  );
}
