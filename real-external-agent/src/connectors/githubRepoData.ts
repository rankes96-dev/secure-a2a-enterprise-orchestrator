export type GitHubRepository = {
  name: string;
  visibility: "private" | "internal" | "public";
  ownerTeam: string;
  allowedUsers: string[];
  allowedGroups: string[];
  accessRequestUrl: string;
  rateLimitStatus?: string;
  appInstallationStatus?: string;
};

export const githubRepositories: GitHubRepository[] = [
  {
    name: "billing-api",
    visibility: "private",
    ownerTeam: "Payments Platform",
    allowedUsers: ["ran@company.com", "analyst@company.com"],
    allowedGroups: ["it-support", "read-only"],
    accessRequestUrl: "https://github.example.com/orgs/acme/sso/access/billing-api",
    rateLimitStatus: "Installation used 4,820 of 5,000 REST requests in the current window.",
    appInstallationStatus: "GitHub App is installed, but repository contents permission is read-only."
  },
  {
    name: "identity-admin",
    visibility: "private",
    ownerTeam: "Identity Platform",
    allowedUsers: ["admin@company.com"],
    allowedGroups: ["identity-admin"],
    accessRequestUrl: "https://github.example.com/orgs/acme/sso/access/identity-admin",
    appInstallationStatus: "GitHub App is installed for selected repositories only."
  }
];

export function findGitHubRepository(message: string): GitHubRepository | undefined {
  const normalized = message.toLowerCase();
  return githubRepositories.find((repo) => normalized.includes(repo.name.toLowerCase()));
}

export function canAccessGitHubRepository(repo: GitHubRepository, actor?: string, roles: string[] = []): boolean {
  const normalizedActor = actor?.toLowerCase();
  const normalizedRoles = new Set(roles.map((role) => role.toLowerCase()));
  return Boolean(
    normalizedActor &&
      (
        repo.allowedUsers.map((user) => user.toLowerCase()).includes(normalizedActor) ||
        repo.allowedGroups.some((group) => normalizedRoles.has(group.toLowerCase()))
      )
  );
}

export function requestedGitHubAccessLevel(message: string): "read" | "write" | "admin" | undefined {
  const normalized = message.toLowerCase();
  if (/\badmin\b/.test(normalized)) return "admin";
  if (/\bwrite|push|maintain|contribute\b/.test(normalized)) return "write";
  if (/\bread|view|access\b/.test(normalized)) return "read";
  return undefined;
}
