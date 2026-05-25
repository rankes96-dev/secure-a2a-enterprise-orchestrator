import type { TrustedOnboardedAgent } from "./types.js";
import { getPlatformStateStore } from "../state/createPlatformStateStore.js";
import type { StoredConnectorTrustRecord } from "../state/platformStateStore.js";
import { platformOwnerKeyHash } from "../state/stateKeyHash.js";
import { defaultTenantId } from "../tenant/tenantContext.js";

// Local runtime mirror only. Phase 2.1 writes trusted connector records through
// PlatformStateStore; Phase 2.1b can move the read path async without changing
// the rest of onboarding in this checkpoint.
const trustedAgentsByOwner = new Map<string, TrustedOnboardedAgent[]>();

export function listTrustedOnboardedAgents(ownerKey: string): TrustedOnboardedAgent[] {
  return [...(trustedAgentsByOwner.get(ownerKey) ?? [])];
}

export function addTrustedOnboardedAgent(ownerKey: string, agent: TrustedOnboardedAgent): TrustedOnboardedAgent {
  const current = trustedAgentsByOwner.get(ownerKey) ?? [];
  trustedAgentsByOwner.set(ownerKey, [...current.filter((item) => item.agentId !== agent.agentId), agent]);
  return agent;
}

function metadataString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function metadataStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function metadataBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function metadataRecord<T>(value: unknown, fallback: T): T {
  return value && typeof value === "object" ? value as T : fallback;
}

export function toStoredConnectorTrustRecord(ownerKey: string, agent: TrustedOnboardedAgent): StoredConnectorTrustRecord {
  const now = new Date().toISOString();
  const tenantId = defaultTenantId();
  const ownerKeyHash = platformOwnerKeyHash(ownerKey);
  return {
    id: `${tenantId}:${ownerKeyHash}:${agent.agentId}`,
    tenantId,
    ownerKeyHash,
    connectorId: agent.connectorId ?? agent.connectorProfile?.connectorId,
    resourceSystem: agent.resourceSystem ?? agent.connectorProfile?.resourceSystem,
    agentId: agent.agentId,
    issuer: agent.issuer,
    audience: agent.audience,
    runtimeEndpoint: agent.runtimeEndpoint,
    connectorProfileHash: agent.connectorProfileHash,
    externalConfigHash: agent.externalConfigHash,
    trustedAt: now,
    updatedAt: now,
    safeMetadata: {
      clientId: agent.clientId,
      displayName: agent.connectorDisplayName ?? agent.connectorProfile?.displayName,
      connectorProfileUrl: agent.connectorProfileUrl,
      connectorProfile: agent.connectorProfile,
      requestedScopes: agent.requestedScopes,
      requestedApplicationGrants: agent.requestedApplicationGrants,
      agentDeclaredSkills: agent.agentDeclaredSkills,
      agentDeclaredCapabilities: agent.agentDeclaredCapabilities,
      applicationAccessGrants: agent.applicationAccessGrants,
      grantedScopes: agent.grantedScopes,
      effectivePermissions: agent.effectivePermissions,
      deniedPermissions: agent.deniedPermissions,
      approvedActions: agent.approvedActions,
      approvedCapabilities: agent.approvedCapabilities,
      blockedActions: agent.blockedActions,
      blockedCapabilities: agent.blockedCapabilities,
      lifecycle: agent.lifecycle,
      connectorProfileVerified: agent.connectorProfileVerified,
      trustLevel: agent.trustLevel,
      tokenEndpointAuthMethod: agent.tokenEndpointAuthMethod,
      oauthApplicationBound: agent.oauthApplicationBound,
      resourcePrincipal: agent.resourcePrincipal,
      connectorDecisionSource: agent.connectorDecisionSource
    }
  };
}

export function fromStoredConnectorTrustRecord(record: StoredConnectorTrustRecord): TrustedOnboardedAgent {
  const metadata = record.safeMetadata;
  const approvedActions = metadataRecord<TrustedOnboardedAgent["approvedActions"]>(metadata.approvedActions, []);
  const blockedActions = metadataRecord<TrustedOnboardedAgent["blockedActions"]>(metadata.blockedActions, []);
  const connectorProfile = metadataRecord<TrustedOnboardedAgent["connectorProfile"] | undefined>(metadata.connectorProfile, undefined);
  const tokenEndpointAuthMethod = metadataString(metadata.tokenEndpointAuthMethod);
  return {
    agentId: record.agentId,
    issuer: record.issuer,
    clientId: metadataString(metadata.clientId) ?? record.agentId,
    audience: record.audience,
    runtimeEndpoint: record.runtimeEndpoint,
    connectorProfileUrl: metadataString(metadata.connectorProfileUrl),
    connectorId: record.connectorId ?? connectorProfile?.connectorId,
    resourceSystem: record.resourceSystem ?? connectorProfile?.resourceSystem,
    connectorDisplayName: metadataString(metadata.displayName) ?? connectorProfile?.displayName,
    externalConfigHash: record.externalConfigHash,
    connectorProfileHash: record.connectorProfileHash,
    requestedScopes: metadataStringArray(metadata.requestedScopes),
    requestedApplicationGrants: metadataStringArray(metadata.requestedApplicationGrants),
    agentDeclaredSkills: metadataStringArray(metadata.agentDeclaredSkills),
    agentDeclaredCapabilities: metadataStringArray(metadata.agentDeclaredCapabilities),
    applicationAccessGrants: metadataStringArray(metadata.applicationAccessGrants),
    grantedScopes: metadataStringArray(metadata.grantedScopes),
    effectivePermissions: metadataStringArray(metadata.effectivePermissions),
    deniedPermissions: metadataStringArray(metadata.deniedPermissions),
    approvedActions,
    blockedActions,
    approvedCapabilities: metadataRecord<TrustedOnboardedAgent["approvedCapabilities"]>(metadata.approvedCapabilities, approvedActions),
    blockedCapabilities: metadataRecord<TrustedOnboardedAgent["blockedCapabilities"]>(metadata.blockedCapabilities, blockedActions),
    connectorProfile,
    connectorProfileVerified: metadataBoolean(metadata.connectorProfileVerified),
    connectorDecisionSource: metadataString(metadata.connectorDecisionSource) ?? "stored_connector_trust_record",
    lifecycle: metadataRecord<TrustedOnboardedAgent["lifecycle"] | undefined>(metadata.lifecycle, undefined),
    resourcePrincipal: metadataString(metadata.resourcePrincipal),
    trustLevel: metadataString(metadata.trustLevel) === "trusted_metadata_only" ? "trusted_metadata_only" : "trusted_metadata_only",
    executable: false,
    executionState: "metadata_only",
    tokenEndpointAuthMethod: tokenEndpointAuthMethod === "private-key-jwt" || tokenEndpointAuthMethod === "client-secret-post" ? tokenEndpointAuthMethod : "unknown",
    oauthApplicationBound: metadataBoolean(metadata.oauthApplicationBound)
  };
}

export async function persistTrustedOnboardedAgent(ownerKey: string, agent: TrustedOnboardedAgent): Promise<TrustedOnboardedAgent> {
  const storedRecord = toStoredConnectorTrustRecord(ownerKey, agent);
  await getPlatformStateStore().upsertConnectorTrustRecord(storedRecord);
  return addTrustedOnboardedAgent(ownerKey, agent);
}
