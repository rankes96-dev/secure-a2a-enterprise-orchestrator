import type { FastifyInstance } from "fastify";
import { gatewayMetadata, gatewayPublicJwks } from "../../security/gatewayIdentity.js";

const gatewayMetadataResponseSchema = {
  type: "object",
  required: ["gatewayId", "issuer", "clientId", "jwksUri", "supportedOnboardingMethods"],
  additionalProperties: false,
  properties: {
    gatewayId: { type: "string" },
    issuer: { type: "string" },
    clientId: { type: "string" },
    jwksUri: { type: "string" },
    supportedOnboardingMethods: {
      type: "array",
      items: { type: "string" }
    }
  }
} as const;

const jwksResponseSchema = {
  type: "object",
  required: ["keys"],
  additionalProperties: false,
  properties: {
    keys: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true
      }
    }
  }
} as const;

export async function registerPublicMetadataRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", {
    schema: {
      response: {
        200: {
          type: "object",
          required: ["status", "service"],
          additionalProperties: false,
          properties: {
            status: { type: "string" },
            service: { type: "string" }
          }
        }
      }
    }
  }, async () => ({
    status: "ok",
    service: "ogen-orchestrator-api"
  }));

  app.get("/.well-known/a2a-gateway.json", {
    schema: {
      response: {
        200: gatewayMetadataResponseSchema
      }
    }
  }, async () => gatewayMetadata());

  app.get("/.well-known/jwks.json", {
    schema: {
      response: {
        200: jwksResponseSchema
      }
    }
  }, async () => gatewayPublicJwks());
}
