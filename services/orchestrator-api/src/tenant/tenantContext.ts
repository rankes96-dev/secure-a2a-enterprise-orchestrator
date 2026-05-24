export type TenantContext = {
  tenantId: string;
};

export function defaultTenantId(): string {
  return process.env.DEFAULT_TENANT_ID?.trim() || "default";
}
