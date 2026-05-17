import { connectorProfileHash, validateConnectorProfile } from "../connectors/profileValidation.js";
import type { ConnectorProfile } from "../connectors/types.js";
import type { ExternalAgentDiscovery, ExternalAgentTrustResponse } from "./types.js";
import { validateSafeExternalUrl } from "./requestValidation.js";
import { fetchJsonWithLimit, maxConnectorProfileJsonBytes } from "./utils.js";

export { connectorProfileHash };

export async function fetchExternalConnectorProfile(discovery: ExternalAgentDiscovery, agentBaseUrl: string): Promise<{ profile?: ConnectorProfile; details: string[] }> {
  const connectorProfileUrl = discovery.connectorProfileUrl;
  if (!connectorProfileUrl) {
    return { details: ["connector profile URL is missing from discovery."] };
  }

  const unsafe = validateSafeExternalUrl(connectorProfileUrl, agentBaseUrl);
  if (unsafe) {
    return { details: [`connectorProfileUrl: ${unsafe}`] };
  }

  try {
    const body = await fetchJsonWithLimit<unknown>(connectorProfileUrl, { method: "GET" }, maxConnectorProfileJsonBytes);
    const validated = validateConnectorProfile(body);
    if (!validated.profile) {
      return { details: validated.details };
    }
    if (discovery.connectorId && validated.profile.connectorId !== discovery.connectorId) {
      return { details: ["connector profile connectorId did not match discovery connectorId."] };
    }
    if (discovery.resourceSystem && validated.profile.resourceSystem !== discovery.resourceSystem) {
      return { details: ["connector profile resourceSystem did not match discovery resourceSystem."] };
    }
    return { profile: validated.profile, details: [] };
  } catch (error) {
    return {
      details: [`connector profile fetch failed: ${error instanceof Error ? error.message : "unknown error"}`]
    };
  }
}

export function verifyConnectorProfileBinding(params: {
  connectorProfile?: ConnectorProfile;
  connectorProfileDetails: string[];
  discovery: ExternalAgentDiscovery;
  trustResponse: ExternalAgentTrustResponse;
}): { verified: boolean; detail: string } {
  const { connectorProfile, connectorProfileDetails, discovery, trustResponse } = params;
  const hashMatches = Boolean(
    connectorProfile &&
      (!trustResponse.connectorProfileHash || connectorProfileHash(connectorProfile) === trustResponse.connectorProfileHash)
  );
  const identityMatches = Boolean(
    connectorProfile &&
      (!trustResponse.connectorId || connectorProfile.connectorId === trustResponse.connectorId) &&
      (!trustResponse.resourceSystem || connectorProfile.resourceSystem === trustResponse.resourceSystem) &&
      (!trustResponse.connectorProfileUrl || trustResponse.connectorProfileUrl === discovery.connectorProfileUrl)
  );

  return {
    verified: Boolean(connectorProfile && hashMatches && identityMatches),
    detail: [
      ...(connectorProfileDetails.length ? connectorProfileDetails : []),
      connectorProfile && !hashMatches ? "connector profile hash did not match signed trust response." : "",
      connectorProfile && !identityMatches ? "connector profile identity did not match signed trust response." : ""
    ].filter(Boolean).join(" ")
  };
}
