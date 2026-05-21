export const AuditEvents = {
  USER_LOGIN_SUCCEEDED: "user.login.succeeded",
  USER_IDENTITY_VERIFIED: "user.identity.verified",

  CONNECTOR_DISCOVERY_STARTED: "connector.discovery.started",
  CONNECTOR_DISCOVERY_SUCCEEDED: "connector.discovery.succeeded",
  CONNECTOR_DISCOVERY_FAILED: "connector.discovery.failed",

  CONNECTOR_PROFILE_FETCHED: "connector.profile.fetched",
  CONNECTOR_PROFILE_VERIFIED: "connector.profile.verified",
  CONNECTOR_PROFILE_FAILED: "connector.profile.failed",

  GATEWAY_CHALLENGE_SIGNED: "gateway.challenge.signed",
  AGENT_ATTESTATION_RECEIVED: "agent.attestation.received",
  AGENT_ATTESTATION_VERIFIED: "agent.attestation.verified",

  OAUTH_APP_ATTESTATION_VERIFIED: "oauth.app.attestation.verified",
  SERVICE_PRINCIPAL_ATTESTATION_VERIFIED: "service.principal.attestation.verified",

  SKILL_DECISION_DERIVED: "skill.decision.derived",
  SKILL_APPROVED: "skill.approved",
  SKILL_BLOCKED: "skill.blocked",

  CONNECTOR_RUNTIME_TOKEN_REQUESTED: "connector.runtime.token.requested",
  CONNECTOR_RUNTIME_TOKEN_ISSUED: "connector.runtime.token.issued",
  CONNECTOR_RUNTIME_SUCCEEDED: "connector.runtime.succeeded",
  CONNECTOR_RUNTIME_FAILED: "connector.runtime.failed",
  CONNECTOR_RUNTIME_AUTHORIZATION_REQUIRED: "connector.runtime.authorization_required",
  CONNECTOR_RUNTIME_CALL_STARTED: "connector.runtime.call.started",
  CONNECTOR_RUNTIME_CALL_SUCCEEDED: "connector.runtime.call.succeeded",
  CONNECTOR_RUNTIME_CALL_FAILED: "connector.runtime.call.failed",
  CONNECTOR_RUNTIME_CONFIG_STALE: "connector.runtime.config.stale",

  POLICY_EVALUATION_STARTED: "policy.evaluation.started",
  POLICY_EVALUATION_PASSED: "policy.evaluation.passed",
  POLICY_EVALUATION_BLOCKED: "policy.evaluation.blocked",
  POLICY_EVALUATION_NEEDS_APPROVAL: "policy.evaluation.needs.approval",

  CONNECTOR_ONBOARDING_TRUSTED: "connector.onboarding.trusted",
  SECURITY_REQUEST_BLOCKED: "security.request.blocked"
} as const;
