// Generic incident taxonomy for local fallback extraction. These terms describe
// incident categories and handoff fields, not system routing rules, agent
// selection rules, or authorization policy.
export const incidentTaxonomy = {
  environments: ["production", "prod", "staging", "stage", "dev", "test", "qa", "sandbox"],
  impactPhrases: [
    { terms: ["only me", "one user"], value: "one user" },
    { terms: ["everyone", "all users", "it happens for everyone"], value: "all users" },
    { terms: ["a group", "team"], value: "group" },
    { terms: ["all deployments"], value: "all deployments" },
    { terms: ["one service"], value: "one service" },
    { terms: ["one repository"], value: "one repository" },
    { terms: ["production users"], value: "production users" },
    { terms: ["finance users", "all finance users"], value: "all finance users" }
  ],
  errorPhrases: [
    "permission denied",
    "access denied",
    "invalid credentials",
    "password is wrong",
    "wrong password",
    "timeout error",
    "login error",
    "sso error",
    "mfa error"
  ],
  categories: [
    {
      id: "login_auth",
      label: "login/authentication issue",
      assignmentGroup: "IAM / Identity / SSO Support",
      terms: ["login", "log in", "sign in", "signin", "authentication", "sso", "mfa", "invalid credentials", "access denied", "can't login", "cannot login", "password"]
    },
    {
      id: "deployment_pipeline",
      label: "deployment/pipeline failure",
      assignmentGroup: "CI/CD Platform / DevOps Tools",
      terms: ["pipeline", "deployment", "deploy", "build", "test stage", "release", "artifact"]
    },
    {
      id: "data_platform",
      label: "data/query/platform issue",
      assignmentGroup: "Data Platform Support",
      terms: ["query timeout", "dashboard not loading", "dashboard", "report failing", "data refresh"]
    },
    {
      id: "connectivity_network",
      label: "connectivity/network issue",
      assignmentGroup: "Network / Endpoint Support",
      terms: ["vpn", "connection failed", "cannot connect", "can't connect", "timeout", "dns", "tls", "network"]
    },
    {
      id: "sync_integration",
      label: "sync/integration issue",
      assignmentGroup: "Integration Platform Support",
      terms: ["sync failed", "sync", "webhook", "api error", "callback"]
    }
  ],
  defaultAssignmentGroup: "Service Desk Triage"
} as const;
