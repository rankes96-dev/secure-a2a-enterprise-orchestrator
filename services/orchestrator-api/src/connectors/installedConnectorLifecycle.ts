import type { TrustedOnboardedAgent } from "../agentOnboarding/types.js";
import { isConnectorRuntimeEndpointAllowed } from "../security/connectorRuntimeSafety.js";

export type InstalledConnectorLifecycleState =
  | "installed"
  | "verified"
  | "runtime_ready"
  | "needs_reverification"
  | "runtime_blocked"
  | "disabled"
  | "revoked";

export type InstalledConnectorLifecycle = {
  state: InstalledConnectorLifecycleState;
  label: string;
  reason: string;
};

function mergedActionCount(
  actions: TrustedOnboardedAgent["approvedActions"] | undefined,
  legacyCapabilities: TrustedOnboardedAgent["approvedCapabilities"] | undefined
): number {
  const ids = new Set<string>();
  for (const action of [...(actions ?? []), ...(legacyCapabilities ?? [])]) {
    ids.add(action.capability);
  }
  return ids.size;
}

// V1 derives lifecycle from current trusted onboarding metadata only.
// needs_reverification is surfaced from runtime responses such as
// connector_configuration_changed. Persistent lifecycle updates are V2.
export function deriveInstalledConnectorLifecycle(agent: TrustedOnboardedAgent): InstalledConnectorLifecycle {
  const approvedCount = mergedActionCount(agent.approvedActions, agent.approvedCapabilities);

  if (!agent.runtimeEndpoint || !isConnectorRuntimeEndpointAllowed(agent.runtimeEndpoint) || approvedCount === 0) {
    return {
      state: "runtime_blocked",
      label: "Runtime blocked",
      reason: "No approved runtime skills are currently available."
    };
  }

  if (
    agent.connectorProfileVerified === true &&
    agent.trustLevel === "trusted_metadata_only" &&
    agent.runtimeEndpoint &&
    approvedCount > 0 &&
    agent.externalConfigHash
  ) {
    return {
      state: "runtime_ready",
      label: "Runtime ready",
      reason: "Approved skills can execute through the trusted runtime endpoint with scoped A2A JWT."
    };
  }

  if (agent.connectorProfileVerified === true && agent.trustLevel === "trusted_metadata_only") {
    return {
      state: "verified",
      label: "Verified",
      reason: "Connector profile and onboarding attestation were verified, but runtime is not ready."
    };
  }

  return {
    state: "installed",
    label: "Installed",
    reason: "Connector onboarding exists, but lifecycle state cannot be derived more specifically."
  };
}
