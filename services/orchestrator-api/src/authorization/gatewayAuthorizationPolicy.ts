import type { GatewayCapability, GatewayRole } from "./gatewayAuthorizationTypes.js";

export type GatewayCapabilityRequirement = {
  rolesAny: GatewayRole[];
};

export const gatewayCapabilityRequirements: Record<GatewayCapability, GatewayCapabilityRequirement> = {
  "gateway.resolve": {
    rolesAny: ["end_user", "operator", "admin", "it-support", "gateway_admin", "tenant_admin"]
  },
  "runtime.authorize": {
    rolesAny: ["end_user", "operator", "admin", "it-support", "gateway_admin", "tenant_admin"]
  },
  "connector.onboarding.read": {
    rolesAny: ["end_user", "operator", "admin", "it-support", "connector_admin", "security_viewer", "gateway_admin", "tenant_admin"]
  },
  "connector.onboarding.discover": {
    rolesAny: ["connector_admin", "gateway_admin", "tenant_admin", "admin"]
  },
  "connector.onboarding.start": {
    rolesAny: ["connector_admin", "gateway_admin", "tenant_admin", "admin"]
  },
  "demo.prepare": {
    rolesAny: ["connector_admin", "gateway_admin", "tenant_admin", "admin", "it-support"]
  },
  "identity.session.attach": {
    rolesAny: ["end_user", "operator", "admin", "it-support", "gateway_admin", "tenant_admin"]
  },
  "identity.session.logout": {
    rolesAny: ["end_user", "operator", "admin", "it-support", "gateway_admin", "tenant_admin"]
  },
  "identity.trust_status.read": {
    rolesAny: ["security_viewer", "gateway_admin", "tenant_admin", "admin", "it-support"]
  },
  "health.read": {
    rolesAny: ["operator", "security_viewer", "gateway_admin", "tenant_admin", "admin", "it-support"]
  },
  "debug.ai_config.read": {
    rolesAny: ["gateway_admin", "tenant_admin", "admin"]
  },
  "audit.read": {
    rolesAny: ["security_viewer", "gateway_admin", "tenant_admin", "admin"]
  },
  "users.manage": {
    rolesAny: ["tenant_admin", "gateway_admin", "admin"]
  },
  "policy.manage": {
    rolesAny: ["tenant_admin", "gateway_admin", "admin"]
  }
};

export const gatewaySystemSourceCapabilities = new Set<GatewayCapability>([
  "connector.onboarding.read",
  "connector.onboarding.discover",
  "connector.onboarding.start",
  "demo.prepare",
  "identity.trust_status.read",
  "health.read",
  "debug.ai_config.read",
  "audit.read",
  "users.manage",
  "policy.manage"
]);
