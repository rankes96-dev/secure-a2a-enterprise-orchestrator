import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, subtitle, action, children }: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="panel-header page-header">
      <div>
        <p className="active-panel-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p className="muted-note">{subtitle}</p>
        {children}
      </div>
      {action ? <div className="page-header-action">{action}</div> : null}
    </div>
  );
}
