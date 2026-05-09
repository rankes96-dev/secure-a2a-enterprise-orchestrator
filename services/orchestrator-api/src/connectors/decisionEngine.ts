import type { ConnectorActionDecision, ConnectorDecisionInput } from "./types";

function joinReasons(reasons: string[]): string {
  if (reasons.length === 0) {
    return "required application access grants and effective permissions are present";
  }

  return reasons.join(" and ");
}

export function decideConnectorActions(input: ConnectorDecisionInput): ConnectorActionDecision[] {
  const catalog = input.connectorProfile.skillCatalog.length ? input.connectorProfile.skillCatalog : input.connectorProfile.actionCatalog;
  const actionsById = new Map(catalog.map((action) => [action.id, action]));
  const requestedApplicationGrants = new Set(input.requestedApplicationGrants);
  const applicationAccessGrants = new Set(input.applicationAccessGrants);
  const effectivePermissions = new Set(input.effectivePermissions);
  const deniedPermissions = new Set(input.deniedPermissions);

  const declaredSkills = input.declaredSkills.length ? input.declaredSkills : input.declaredActions ?? [];
  return declaredSkills.map((actionId) => {
    const action = actionsById.get(actionId);
    if (!action) {
      return {
        actionId,
        label: actionId,
        status: "blocked",
        reason: `Unknown action for connector profile ${input.connectorProfile.connectorId}.`,
        requiredApplicationGrants: [],
        requiredEffectivePermissions: [],
        missingApplicationGrants: [],
        missingEffectivePermissions: [],
        deniedEffectivePermissions: []
      };
    }

    const requiredApplicationGrants = action.requiredApplicationGrants;
    const requiredEffectivePermissions = action.requiredEffectivePermissions;
    const missingRequestedApplicationGrants = requiredApplicationGrants.filter((grant) => !requestedApplicationGrants.has(grant));
    const missingApplicationGrants = requiredApplicationGrants.filter((grant) => !applicationAccessGrants.has(grant));
    const missingEffectivePermissions = requiredEffectivePermissions.filter((permission) => !effectivePermissions.has(permission) && !deniedPermissions.has(permission));
    const deniedEffectivePermissions = requiredEffectivePermissions.filter((permission) => deniedPermissions.has(permission));
    const effectiveMissingApplicationGrants = [...new Set([...missingRequestedApplicationGrants, ...missingApplicationGrants])];
    const blockReasons = [
      ...effectiveMissingApplicationGrants.map((grant) => `missing application access grant ${grant}`),
      ...missingEffectivePermissions.map((permission) => `missing effective permission ${permission}`),
      ...deniedEffectivePermissions.map((permission) => `denied permission ${permission}`)
    ];

    return {
      actionId,
      label: action.label,
      status: blockReasons.length === 0 ? "approved" : "blocked",
      reason: joinReasons(blockReasons),
      requiredApplicationGrants: [...requiredApplicationGrants],
      requiredEffectivePermissions: [...requiredEffectivePermissions],
      missingApplicationGrants: effectiveMissingApplicationGrants,
      missingEffectivePermissions,
      deniedEffectivePermissions
    };
  });
}
