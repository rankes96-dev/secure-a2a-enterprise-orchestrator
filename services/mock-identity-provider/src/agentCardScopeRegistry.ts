import { buildA2AResourceRegistry, referenceA2AResources, type DiscoveredA2AResourceRegistry } from "@a2a/shared";
import { sensitiveScopesNeverIssuedByMockIdp } from "./config/oauthApplications.js";

export type { DiscoveredA2AResourceRegistry };

export function buildDiscoveredA2AResourceRegistry(): DiscoveredA2AResourceRegistry {
  return buildA2AResourceRegistry(referenceA2AResources(), {
    deniedScopes: sensitiveScopesNeverIssuedByMockIdp
  });
}
