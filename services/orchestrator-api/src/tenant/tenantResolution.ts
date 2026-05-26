import type { VerifiedUserIdentity } from "../security/userIdentity.js";
import { defaultTenantId } from "./tenantContext.js";

export type TenantResolutionSource =
  | "auth0_org"
  | "email_domain_mapping"
  | "session_default"
  | "configured_default";

export type TenantResolutionInput = {
  identity?: VerifiedUserIdentity;
  requestedTenantId?: string;
};

export type ResolvedTenantContext = {
  tenantId: string;
  source: TenantResolutionSource;
  requestedTenantId?: string;
  requestedTenantAccepted: boolean;
  reason: string;
};

function cleanTenantId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function identityOrgTenantId(identity: VerifiedUserIdentity | undefined): string | undefined {
  const candidate = identity as (VerifiedUserIdentity & {
    org_id?: unknown;
    organization?: unknown;
    orgId?: unknown;
  }) | undefined;
  const orgId = candidate?.org_id ?? candidate?.organization ?? candidate?.orgId;
  return typeof orgId === "string" ? cleanTenantId(orgId) : undefined;
}

export function resolveTenantContext(input: TenantResolutionInput = {}): ResolvedTenantContext {
  const requestedTenantId = cleanTenantId(input.requestedTenantId);
  const auth0OrgTenantId = identityOrgTenantId(input.identity);
  const tenantId = auth0OrgTenantId ?? defaultTenantId();
  const source: TenantResolutionSource = auth0OrgTenantId ? "auth0_org" : input.identity ? "session_default" : "configured_default";

  if (!requestedTenantId) {
    return {
      tenantId,
      source,
      requestedTenantAccepted: true,
      reason: "No tenant was requested; using Ogen-resolved tenant context."
    };
  }

  if (requestedTenantId === tenantId) {
    return {
      tenantId,
      source,
      requestedTenantId,
      requestedTenantAccepted: true,
      reason: "Requested tenant matches Ogen-resolved tenant context."
    };
  }

  return {
    tenantId,
    source,
    requestedTenantId,
    requestedTenantAccepted: false,
    reason: "Requested tenant is not authorized for the resolved identity or configured tenant context."
  };
}

export function requireRequestedTenantAllowed(context: ResolvedTenantContext): boolean {
  return context.requestedTenantAccepted;
}
