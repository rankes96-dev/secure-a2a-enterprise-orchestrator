import { importJWK, jwtVerify, type JWK } from "jose";
import type { OAuthClientAuthMethod } from "@a2a/shared";
import type { OAuthApplicationRegistration } from "../config/oauthApplications";

export type TokenRequestClientAuthFields = {
  client_id?: string;
  client_secret?: string;
  client_assertion_type?: string;
  client_assertion?: string;
};

export type ClientAuthenticationResult =
  | {
      ok: true;
      authMethod: OAuthClientAuthMethod;
    }
  | {
      ok: false;
      status: 400 | 401;
      error: string;
      authMethod?: OAuthClientAuthMethod | "unknown";
    };

const jwtBearerAssertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

function hasAuthMethod(application: OAuthApplicationRegistration, method: OAuthClientAuthMethod): boolean {
  return application.allowedAuthMethods.includes(method);
}

function parsePublicJwk(publicJwkJson: string): JWK | undefined {
  try {
    const parsed = JSON.parse(publicJwkJson) as JWK;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function authenticateOAuthClient(params: {
  body: TokenRequestClientAuthFields;
  application: OAuthApplicationRegistration;
}): Promise<ClientAuthenticationResult> {
  const { body, application } = params;

  if (body.client_assertion || body.client_assertion_type) {
    if (!hasAuthMethod(application, "private_key_jwt")) {
      return { ok: false, status: 401, error: "unsupported_client_auth_method", authMethod: "private_key_jwt" };
    }

    if (!application.privateKeyJwt?.enabled || !application.privateKeyJwt.publicJwkJson) {
      return { ok: false, status: 401, error: "invalid_client", authMethod: "private_key_jwt" };
    }

    if (body.client_assertion_type !== jwtBearerAssertionType) {
      return { ok: false, status: 400, error: "invalid_client_assertion_type", authMethod: "private_key_jwt" };
    }

    if (!body.client_assertion || !body.client_id) {
      return { ok: false, status: 401, error: "invalid_client_assertion", authMethod: "private_key_jwt" };
    }

    const publicJwk = parsePublicJwk(application.privateKeyJwt.publicJwkJson);
    if (!publicJwk) {
      return { ok: false, status: 401, error: "invalid_client", authMethod: "private_key_jwt" };
    }

    try {
      const key = await importJWK(publicJwk, "RS256");
      const { payload } = await jwtVerify(body.client_assertion, key, {
        issuer: body.client_id,
        subject: body.client_id,
        audience: application.privateKeyJwt.expectedAudience
      });

      if (typeof payload.jti !== "string" || !payload.jti) {
        return { ok: false, status: 401, error: "invalid_client_assertion", authMethod: "private_key_jwt" };
      }

      if (typeof payload.iat !== "number" || typeof payload.exp !== "number" || payload.exp - payload.iat > 120) {
        return { ok: false, status: 401, error: "invalid_client_assertion", authMethod: "private_key_jwt" };
      }

      return { ok: true, authMethod: "private_key_jwt" };
    } catch {
      return { ok: false, status: 401, error: "invalid_client_assertion", authMethod: "private_key_jwt" };
    }
  }

  if (!hasAuthMethod(application, "client_secret_post")) {
    return { ok: false, status: 401, error: "unsupported_client_auth_method", authMethod: "client_secret_post" };
  }

  if (!body.client_secret || body.client_secret !== application.clientSecret) {
    return { ok: false, status: 401, error: "invalid_client", authMethod: "client_secret_post" };
  }

  return { ok: true, authMethod: "client_secret_post" };
}
