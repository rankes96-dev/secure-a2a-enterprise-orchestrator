export type GatewayRole =
  | "end_user"
  | "operator"
  | "connector_admin"
  | "security_viewer"
  | "gateway_admin"
  | "tenant_admin"
  | "approver"
  | "admin"
  | "it-support";

export type GatewayCapability =
  | "gateway.resolve"
  | "runtime.authorize"
  | "connector.onboarding.read"
  | "connector.onboarding.discover"
  | "connector.onboarding.start"
  | "demo.prepare"
  | "identity.session.attach"
  | "identity.session.logout"
  | "identity.trust_status.read"
  | "health.read"
  | "debug.ai_config.read"
  | "audit.read"
  | "users.manage"
  | "policy.manage";

export type GatewayAuthorizationEffect =
  | "allow"
  | "block";

export type GatewayAuthorizationInput = {
  tenantId: string;
  capability: GatewayCapability;
  route: string;
  method: string;
  actor?: {
    provider?: string;
    issuer?: string;
    subject?: string;
    email?: string;
    roles: string[];
  };
  source?: "browser_session" | "api_key" | "internal_service_token";
};

export type GatewayAuthorizationDecision = {
  decisionId: string;
  tenantId: string;
  effect: GatewayAuthorizationEffect;
  capability: GatewayCapability;
  route: string;
  method: string;
  reason: string;
  matchedRole?: string;
  requiredRolesAny: string[];
  actorRoles: string[];
  createdAt: string;
  protectedMaterialExposed: false;
  tokenMaterialStored: false;
};
