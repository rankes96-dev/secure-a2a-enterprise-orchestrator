import type { AdminConfig } from "./adminConfig.js";
import {
  getConnectorProfile as getRegisteredConnectorProfile,
  getConnectorProfileForResourceSystem,
  getDefaultConnectorProfile,
  listSupportedConnectors
} from "./connectors/registry.js";
import type { ConnectorCatalogItem as CatalogItem, ConnectorProfile, ConnectorSkillRequirement as ActionCatalogItem, SupportedConnector } from "./connectors/types.js";

export type { ActionCatalogItem, CatalogItem, ConnectorProfile, SupportedConnector };
export { getConnectorProfileForResourceSystem, getDefaultConnectorProfile, listSupportedConnectors };

export type ActionReadinessPreview = {
  actionId: string;
  label: string;
  status:
    | "ready"
    | "disabled"
    | "blocked_missing_application_grant"
    | "blocked_missing_effective_permission"
    | "blocked_denied_permission"
    | "blocked_application_grant_and_permission";
  missingApplicationGrants: string[];
  missingEffectivePermissions: string[];
  deniedPermissions: string[];
};

export function getConnectorProfile(connectorId?: string): ConnectorProfile {
  const profile = connectorId ? getRegisteredConnectorProfile(connectorId) : undefined;
  return profile ?? getDefaultConnectorProfile();
}

export function actionRequirementsFor(actionId: string, connectorId?: string): ActionCatalogItem | undefined {
  return getConnectorProfile(connectorId).skillCatalog.find((action) => action.id === actionId);
}

export function deriveRequestedApplicationGrants(enabledActionIds: string[], connectorId?: string): string[] {
  const requested = new Set<string>();
  for (const actionId of enabledActionIds) {
    const action = actionRequirementsFor(actionId, connectorId);
    action?.requiredApplicationGrants.forEach((grant) => requested.add(grant));
  }
  return [...requested];
}

export function previewActionReadiness(config: AdminConfig): ActionReadinessPreview[] {
  const profile = getConnectorProfile(config.selectedConnectorId);
  const selectedGrants = new Set(config.oauthApplication.applicationAccessGrants);
  const effectivePermissions = new Set(config.servicePrincipal.effectivePermissions);
  const deniedPermissions = new Set(config.servicePrincipal.deniedPermissions);
  const enabledActions = new Set(config.capabilityDeclaration.agentDeclaredCapabilities);

  return profile.skillCatalog.map((action) => {
    if (!enabledActions.has(action.id)) {
      return {
        actionId: action.id,
        label: action.label,
        status: "disabled",
        missingApplicationGrants: [],
        missingEffectivePermissions: [],
        deniedPermissions: []
      };
    }

    const missingApplicationGrants = action.requiredApplicationGrants.filter((grant) => !selectedGrants.has(grant));
    const denied = action.requiredEffectivePermissions.filter((permission) => deniedPermissions.has(permission));
    const missingEffectivePermissions = action.requiredEffectivePermissions.filter((permission) => !effectivePermissions.has(permission) && !deniedPermissions.has(permission));
    const hasApplicationGrantBlock = missingApplicationGrants.length > 0;
    const hasPermissionBlock = missingEffectivePermissions.length > 0 || denied.length > 0;

    return {
      actionId: action.id,
      label: action.label,
      status: hasApplicationGrantBlock && hasPermissionBlock
        ? "blocked_application_grant_and_permission"
        : hasApplicationGrantBlock
          ? "blocked_missing_application_grant"
          : denied.length > 0
            ? "blocked_denied_permission"
            : missingEffectivePermissions.length > 0
              ? "blocked_missing_effective_permission"
              : "ready",
      missingApplicationGrants,
      missingEffectivePermissions,
      deniedPermissions: denied
    };
  });
}
