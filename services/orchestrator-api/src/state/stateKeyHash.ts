import { createHash } from "node:crypto";

export function platformOwnerKeyHash(ownerKey: string): string {
  return createHash("sha256").update(ownerKey).digest("hex");
}
