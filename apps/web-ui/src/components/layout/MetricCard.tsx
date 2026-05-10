import type { ReactNode } from "react";

export function MetricCard({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {children}
    </article>
  );
}
