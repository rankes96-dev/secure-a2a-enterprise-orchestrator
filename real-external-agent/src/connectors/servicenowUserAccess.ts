export type ServiceNowApprovalContext = {
  requestNumber: string;
  approver: string;
  delegatedTo?: string;
  blockedReason?: string;
};

export const serviceNowApprovalContexts: ServiceNowApprovalContext[] = [
  {
    requestNumber: "RITM0042088",
    approver: "admin@company.com"
  },
  {
    requestNumber: "RITM0042119",
    approver: "manager@company.com",
    delegatedTo: "admin@company.com",
    blockedReason: "Approval delegation is active, but the delegated approver has not accepted the queue assignment."
  }
];

export function isApprovalPrompt(message: string): boolean {
  return /\b(approve|approval|approver|ritm|waiting for approval|can't approve|cannot approve)\b/i.test(message);
}

export function findApprovalContext(message: string): ServiceNowApprovalContext | undefined {
  const requestNumber = message.match(/\bRITM\d{7}\b/i)?.[0]?.toUpperCase();
  if (requestNumber) {
    return serviceNowApprovalContexts.find((context) => context.requestNumber === requestNumber);
  }
  return serviceNowApprovalContexts[0];
}
