export type ServiceNowCatalogItem = {
  id: string;
  name: string;
  keywords: string[];
  deepLink: string;
  requiredFields: string[];
  description: string;
};

export const serviceNowCatalogItems: ServiceNowCatalogItem[] = [
  {
    id: "CAT-AWS-PROD-ACCESS",
    name: "AWS Access Request",
    keywords: ["aws", "amazon", "cloud", "production access", "prod access", "הרשאה ל-aws", "הרשאה ל aws"],
    deepLink: "https://servicenow.example.com/sp?id=sc_cat_item&sys_id=CAT-AWS-PROD-ACCESS",
    requiredFields: ["AWS account or application", "Requested role", "Business justification", "Manager approval", "Requested duration"],
    description: "Request time-bound AWS account access through the Cloud Access approval flow."
  },
  {
    id: "CAT-DL-REQUEST",
    name: "Distribution List Request",
    keywords: ["mailing list", "distribution list", "dl", "תפוצה", "רשימת תפוצה", "מייל"],
    deepLink: "https://servicenow.example.com/sp?id=sc_cat_item&sys_id=CAT-DL-REQUEST",
    requiredFields: ["List name", "Owner", "Members", "External sender policy", "Business purpose"],
    description: "Create or change an email distribution list after owner approval."
  },
  {
    id: "CAT-SHARED-MAILBOX",
    name: "Shared Mailbox Request",
    keywords: ["shared mailbox", "mailbox", "תיבת דואר", "mail box"],
    deepLink: "https://servicenow.example.com/sp?id=sc_cat_item&sys_id=CAT-SHARED-MAILBOX",
    requiredFields: ["Mailbox display name", "Owner", "Members", "Send-as requirement", "Business purpose"],
    description: "Create or update a shared mailbox for a team or function."
  },
  {
    id: "CAT-GENERIC-ACCESS",
    name: "Generic Access Request",
    keywords: ["access", "permission", "הרשאה", "request access"],
    deepLink: "https://servicenow.example.com/sp?id=sc_cat_item&sys_id=CAT-GENERIC-ACCESS",
    requiredFields: ["System name", "Access level", "Business justification", "Manager approval", "Duration"],
    description: "Request access to a system that does not have a dedicated catalog item."
  }
];

export function recommendServiceNowCatalogItem(message: string): ServiceNowCatalogItem | undefined {
  const normalized = message.toLowerCase();
  return serviceNowCatalogItems.find((item) => item.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())));
}
