import type { ReactNode } from "react";

export function ActionRow({ children }: { children: ReactNode }) {
  return <div className="cluster action-row">{children}</div>;
}
