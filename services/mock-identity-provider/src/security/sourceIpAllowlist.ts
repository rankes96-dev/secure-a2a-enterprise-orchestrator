import type { IncomingMessage } from "node:http";

export type SourceIpCheckResult =
  | { ok: true; sourceIp: string; matchedBy: "disabled" | "ip" | "cidr" }
  | { ok: false; sourceIp: string; reason: string };

function envEnabled(name: string): boolean {
  return process.env[name] === "true";
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function firstForwardedForIp(value: string | string[] | undefined): string | undefined {
  return firstHeaderValue(value)?.split(",")[0]?.trim();
}

function normalizeIp(ip: string | undefined): string {
  return (ip ?? "unknown").trim().replace(/^\[(.*)\]$/, "$1") || "unknown";
}

function ipVariants(ip: string): Set<string> {
  const normalized = normalizeIp(ip);
  const variants = new Set([normalized]);
  const lower = normalized.toLowerCase();

  if (lower.startsWith("::ffff:")) {
    variants.add(normalized.slice("::ffff:".length));
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) {
    variants.add(`::ffff:${normalized}`);
  }

  return variants;
}

function getSourceIp(request: IncomingMessage): string {
  if (envEnabled("TRUST_PROXY_HEADERS")) {
    return normalizeIp(
      firstForwardedForIp(request.headers["x-forwarded-for"]) ??
        firstHeaderValue(request.headers["x-real-ip"]) ??
        request.socket.remoteAddress
    );
  }

  return normalizeIp(request.socket.remoteAddress);
}

function ipv4ToInt(ip: string): number | undefined {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return undefined;
  }

  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return undefined;
    }

    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return undefined;
    }

    value = (value << 8) + octet;
  }

  return value >>> 0;
}

function matchesIpv4Cidr(ip: string, cidr: string): boolean {
  const [networkIp, prefixText] = cidr.split("/");
  if (!networkIp || !prefixText) {
    return false;
  }

  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  const ipInt = ipv4ToInt(ip);
  const networkInt = ipv4ToInt(networkIp);
  if (ipInt === undefined || networkInt === undefined) {
    return false;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (networkInt & mask);
}

export function evaluateSourceIpAllowlist(request: IncomingMessage): SourceIpCheckResult {
  const sourceIp = getSourceIp(request);

  if (!envEnabled("MOCK_IDP_ENFORCE_IP_ALLOWLIST")) {
    return { ok: true, sourceIp, matchedBy: "disabled" };
  }

  const sourceVariants = ipVariants(sourceIp);
  const allowedIps = splitCsv(process.env.MOCK_IDP_ALLOWED_SOURCE_IPS);
  for (const allowedIp of allowedIps) {
    const allowedVariants = ipVariants(allowedIp);
    for (const variant of sourceVariants) {
      if (allowedVariants.has(variant)) {
        return { ok: true, sourceIp, matchedBy: "ip" };
      }
    }
  }

  const ipv4Source = [...sourceVariants].find((variant) => ipv4ToInt(variant) !== undefined);
  if (ipv4Source) {
    for (const cidr of splitCsv(process.env.MOCK_IDP_ALLOWED_SOURCE_CIDRS)) {
      if (matchesIpv4Cidr(ipv4Source, cidr)) {
        return { ok: true, sourceIp, matchedBy: "cidr" };
      }
    }
  }

  return { ok: false, sourceIp, reason: "allowlist_enabled_no_match" };
}
