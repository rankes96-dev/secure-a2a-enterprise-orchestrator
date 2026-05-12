export type GitHubPullRequest = {
  repo: string;
  number: number;
  title: string;
  status: "open" | "merged" | "closed";
  checks: string;
  reviewers: string[];
  blockers: string[];
  nextStep: string;
};

export const githubPullRequests: GitHubPullRequest[] = [
  {
    repo: "billing-api",
    number: 42,
    title: "Add invoice reconciliation retry guard",
    status: "open",
    checks: "2 passed, 1 failing: integration-tests/payment-ledger",
    reviewers: ["maya-cohen", "ops-review"],
    blockers: ["Integration test failure on payment-ledger fixture", "Waiting for ops-review approval"],
    nextStep: "Fix the failing integration test or add a note explaining why the fixture changed, then request ops-review again."
  },
  {
    repo: "identity-admin",
    number: 17,
    title: "Rotate admin invite link secret",
    status: "merged",
    checks: "All checks passed",
    reviewers: ["security-review"],
    blockers: [],
    nextStep: "No action needed. The pull request has already merged."
  }
];

export function findGitHubPullRequest(message: string): GitHubPullRequest | undefined {
  const prNumber = Number(message.match(/\bPR\s*#?(\d+)\b/i)?.[1] ?? message.match(/\bpull request\s*#?(\d+)\b/i)?.[1]);
  if (!Number.isFinite(prNumber)) {
    return undefined;
  }
  const normalized = message.toLowerCase();
  return githubPullRequests.find((pr) =>
    pr.number === prNumber &&
      (!normalized.includes("-api") && !normalized.includes("repo") || normalized.includes(pr.repo.toLowerCase()))
  ) ?? githubPullRequests.find((pr) => pr.number === prNumber);
}
