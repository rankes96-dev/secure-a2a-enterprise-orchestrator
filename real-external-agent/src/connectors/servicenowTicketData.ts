export type ServiceNowTicket = {
  number: string;
  type: "incident" | "request";
  state: string;
  shortDescription: string;
  assignedGroup: string;
  requester: string;
  openedBy: string;
  watchers: string[];
  allowedGroups: string[];
  lastUpdate: string;
  nextStep: string;
  approver?: string;
  missingInformation?: string;
};

export const serviceNowTickets: ServiceNowTicket[] = [
  {
    number: "INC0010245",
    type: "incident",
    state: "In Progress",
    shortDescription: "VPN login fails after MFA reset",
    assignedGroup: "Workplace Services",
    requester: "ran@company.com",
    openedBy: "ran@company.com",
    watchers: ["analyst@company.com"],
    allowedGroups: ["it-support"],
    lastUpdate: "Workplace Services confirmed the MFA reset and is checking the VPN profile assignment.",
    nextStep: "Wait for the VPN profile check, or add a screenshot of the VPN error if the issue happens again."
  },
  {
    number: "INC0010213",
    type: "incident",
    state: "Assigned",
    shortDescription: "Laptop replacement request is waiting for depot scheduling",
    assignedGroup: "Endpoint Support",
    requester: "ran@company.com",
    openedBy: "ran@company.com",
    watchers: ["analyst@company.com"],
    allowedGroups: ["it-support"],
    lastUpdate: "Endpoint Support confirmed stock availability and is waiting for the user to choose a pickup window.",
    nextStep: "Choose a depot pickup window or ask Endpoint Support to ship the replacement device."
  },
  {
    number: "INC0010310",
    type: "incident",
    state: "Pending Customer",
    shortDescription: "Shared mailbox cannot receive external mail",
    assignedGroup: "Messaging Operations",
    requester: "admin@company.com",
    openedBy: "admin@company.com",
    watchers: [],
    allowedGroups: ["identity-admin"],
    lastUpdate: "Messaging Operations asked for a recent failed sender address and timestamp.",
    nextStep: "Reply with the sender address and approximate time of the failed message."
  },
  {
    number: "RITM0042088",
    type: "request",
    state: "Waiting for Approval",
    shortDescription: "AWS production access for billing operations",
    assignedGroup: "Cloud Access",
    requester: "ran@company.com",
    openedBy: "ran@company.com",
    watchers: [],
    allowedGroups: ["it-support"],
    approver: "admin@company.com",
    missingInformation: "Business justification and requested duration are complete.",
    lastUpdate: "The request is waiting for approval from Identity Admin.",
    nextStep: "Ask the approver to review RITM0042088. No access has been granted yet."
  }
];

export function extractServiceNowTicketNumber(message: string): string | undefined {
  return message.match(/\b(?:INC|RITM|REQ)\d+\b/i)?.[0]?.toUpperCase();
}

export function findServiceNowTicketByNumber(ticketNumber: string): ServiceNowTicket | undefined {
  return serviceNowTickets.find((ticket) => ticket.number === ticketNumber);
}

export function findServiceNowTicket(message: string): ServiceNowTicket | undefined {
  const ticketNumber = extractServiceNowTicketNumber(message);
  return ticketNumber ? findServiceNowTicketByNumber(ticketNumber) : undefined;
}

export function canReadServiceNowTicket(ticket: ServiceNowTicket, actor?: string, roles: string[] = []): boolean {
  const normalizedActor = actor?.toLowerCase();
  const normalizedRoles = new Set(roles.map((role) => role.toLowerCase()));
  return Boolean(
    normalizedActor &&
      (
        ticket.requester.toLowerCase() === normalizedActor ||
        ticket.openedBy.toLowerCase() === normalizedActor ||
        ticket.watchers.map((watcher) => watcher.toLowerCase()).includes(normalizedActor) ||
        ticket.allowedGroups.some((group) => normalizedRoles.has(group.toLowerCase()))
      )
  );
}
