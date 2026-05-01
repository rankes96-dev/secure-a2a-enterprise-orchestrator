export type AccessRequestIntent = {
  isAccessRequest: boolean;
  targetSystem?: "Active Directory" | "Unknown";
  requestedAction?: "add_user_to_group" | "grant_access" | "remove_user_from_group" | "unknown";
  targetGroup?: string;
};

function normalizeGroupName(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return undefined;
  }

  return normalized.toLowerCase();
}

export function detectAccessRequestIntent(message: string): AccessRequestIntent {
  const lower = message.toLowerCase();
  const hasAccessPhrase = [
    "add me to",
    "add user to",
    "grant me access",
    "give me access",
    "add to group",
    "remove me from group",
    "join group",
    "permission request",
    "access request"
  ].some((phrase) => lower.includes(phrase));
  const hasDirectoryContext = ["active directory", " ad group", "ad group", "helpdesk group"].some((phrase) => lower.includes(phrase));

  if (!hasAccessPhrase && !hasDirectoryContext) {
    return { isAccessRequest: false };
  }

  const requestedAction = lower.includes("remove me from group")
    ? "remove_user_from_group"
    : lower.includes("add me to") || lower.includes("add user to") || lower.includes("add to group") || lower.includes("join group")
      ? "add_user_to_group"
      : lower.includes("grant me access") || lower.includes("give me access")
        ? "grant_access"
        : "unknown";
  const groupMatch =
    lower.match(/\b(?:add me to|add user to|add to|join)\s+(?:a\s+|the\s+)?([a-z0-9 _-]+?)\s+group\b/) ??
    lower.match(/\b([a-z0-9_-]+)\s+group\b/);

  return {
    isAccessRequest: true,
    targetSystem: lower.includes("active directory") || lower.includes("ad group") ? "Active Directory" : "Unknown",
    requestedAction,
    targetGroup: normalizeGroupName(groupMatch?.[1])
  };
}

export function buildManualAccessRequestAnswer(intent: AccessRequestIntent): string {
  const system = intent.targetSystem ?? "Unknown";
  const group = intent.targetGroup ? intent.targetGroup.replace(/\b\w/g, (char) => char.toUpperCase()) : "the requested group";
  const action = intent.requestedAction === "remove_user_from_group" ? "Remove user from group" : "Add user to group";

  return [
    "Manual ServiceNow Request Required.",
    "This looks like an access request, not an incident diagnosis.",
    "I do not currently have an Active Directory or Identity Access agent available to process this automatically.",
    "Please open a ServiceNow access request manually.",
    `Suggested fields: Request type: Access request; Requested system: ${system}; Requested action: ${action}; Requested group: ${group}; Approval needed: manager or AD group owner; Business justification: required.`
  ].join(" ");
}
