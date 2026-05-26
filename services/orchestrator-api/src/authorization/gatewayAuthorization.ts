import { randomUUID } from "node:crypto";
import { gatewayCapabilityRequirements, gatewaySystemSourceCapabilities } from "./gatewayAuthorizationPolicy.js";
import type { GatewayAuthorizationDecision, GatewayAuthorizationInput } from "./gatewayAuthorizationTypes.js";

function safeRole(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim().toLowerCase() : "";
  return trimmed || undefined;
}

function safeActorRoles(roles: string[] | undefined): string[] {
  return [...new Set((roles ?? []).map((role) => safeRole(role)).filter((role): role is string => Boolean(role)))];
}

function decision(params: Omit<GatewayAuthorizationDecision, "decisionId" | "createdAt" | "protectedMaterialExposed" | "tokenMaterialStored">): GatewayAuthorizationDecision {
  return {
    ...params,
    decisionId: randomUUID(),
    createdAt: new Date().toISOString(),
    protectedMaterialExposed: false,
    tokenMaterialStored: false
  };
}

export function evaluateGatewayAuthorization(input: GatewayAuthorizationInput): GatewayAuthorizationDecision {
  const requirement = gatewayCapabilityRequirements[input.capability];
  const requiredRolesAny = requirement?.rolesAny ?? [];
  const actorRoles = safeActorRoles(input.actor?.roles);

  if (!requirement) {
    return decision({
      tenantId: input.tenantId,
      effect: "block",
      capability: input.capability,
      route: input.route,
      method: input.method,
      reason: "No gateway authorization policy is defined for this capability.",
      requiredRolesAny,
      actorRoles
    });
  }

  if (input.source === "api_key" || input.source === "internal_service_token") {
    if (gatewaySystemSourceCapabilities.has(input.capability)) {
      return decision({
        tenantId: input.tenantId,
        effect: "allow",
        capability: input.capability,
        route: input.route,
        method: input.method,
        reason: "Trusted system source is allowed for this gateway capability.",
        matchedRole: "admin",
        requiredRolesAny,
        actorRoles: []
      });
    }

    return decision({
      tenantId: input.tenantId,
      effect: "block",
      capability: input.capability,
      route: input.route,
      method: input.method,
      reason: "Trusted system source is not allowed for this gateway capability.",
      requiredRolesAny,
      actorRoles: []
    });
  }

  const matchedRole = requiredRolesAny.find((role) => actorRoles.includes(role));
  if (matchedRole) {
    return decision({
      tenantId: input.tenantId,
      effect: "allow",
      capability: input.capability,
      route: input.route,
      method: input.method,
      reason: `Verified identity has required gateway role ${matchedRole}.`,
      matchedRole,
      requiredRolesAny,
      actorRoles
    });
  }

  return decision({
    tenantId: input.tenantId,
    effect: "block",
    capability: input.capability,
    route: input.route,
    method: input.method,
    reason: "Verified identity does not have a required gateway role for this capability.",
    requiredRolesAny,
    actorRoles
  });
}

export function isGatewayAuthorized(decision: GatewayAuthorizationDecision): boolean {
  return decision.effect === "allow";
}
