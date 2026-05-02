import type { IncomingMessage } from "node:http";
import { evaluateSourceIpAllowlist } from "../services/mock-identity-provider/src/security/sourceIpAllowlist";

type CheckCase = {
  name: string;
  env: Record<string, string | undefined>;
  remoteAddress: string;
  headers?: Record<string, string>;
  expected: { ok: boolean; matchedBy?: "disabled" | "ip" | "cidr"; sourceIp?: string };
};

const managedEnvVars = [
  "MOCK_IDP_ENFORCE_IP_ALLOWLIST",
  "MOCK_IDP_ALLOWED_SOURCE_IPS",
  "MOCK_IDP_ALLOWED_SOURCE_CIDRS",
  "TRUST_PROXY_HEADERS"
] as const;

function withEnv<T>(env: CheckCase["env"], callback: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const name of managedEnvVars) {
    previous.set(name, process.env[name]);
    const nextValue = env[name];
    if (nextValue === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = nextValue;
    }
  }

  try {
    return callback();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

function mockRequest(remoteAddress: string, headers: Record<string, string> = {}): IncomingMessage {
  return {
    headers,
    socket: { remoteAddress }
  } as IncomingMessage;
}

const cases: CheckCase[] = [
  {
    name: "disabled allowlist permits local request",
    env: { MOCK_IDP_ENFORCE_IP_ALLOWLIST: "false", TRUST_PROXY_HEADERS: "false" },
    remoteAddress: "127.0.0.1",
    expected: { ok: true, matchedBy: "disabled", sourceIp: "127.0.0.1" }
  },
  {
    name: "loopback exact allowlist permits IPv4-mapped local request",
    env: {
      MOCK_IDP_ENFORCE_IP_ALLOWLIST: "true",
      MOCK_IDP_ALLOWED_SOURCE_IPS: "127.0.0.1,::1,::ffff:127.0.0.1",
      TRUST_PROXY_HEADERS: "false"
    },
    remoteAddress: "::ffff:127.0.0.1",
    expected: { ok: true, matchedBy: "ip", sourceIp: "::ffff:127.0.0.1" }
  },
  {
    name: "IPv4 CIDR permits private network source",
    env: {
      MOCK_IDP_ENFORCE_IP_ALLOWLIST: "true",
      MOCK_IDP_ALLOWED_SOURCE_IPS: "",
      MOCK_IDP_ALLOWED_SOURCE_CIDRS: "10.0.0.0/8",
      TRUST_PROXY_HEADERS: "false"
    },
    remoteAddress: "10.25.30.40",
    expected: { ok: true, matchedBy: "cidr", sourceIp: "10.25.30.40" }
  },
  {
    name: "trusted proxy denied IP simulation blocks forwarded source",
    env: {
      MOCK_IDP_ENFORCE_IP_ALLOWLIST: "true",
      MOCK_IDP_ALLOWED_SOURCE_IPS: "10.10.10.10",
      TRUST_PROXY_HEADERS: "true"
    },
    remoteAddress: "127.0.0.1",
    headers: { "x-forwarded-for": "203.0.113.50" },
    expected: { ok: false, sourceIp: "203.0.113.50" }
  },
  {
    name: "trusted proxy permits forwarded source",
    env: {
      MOCK_IDP_ENFORCE_IP_ALLOWLIST: "true",
      MOCK_IDP_ALLOWED_SOURCE_IPS: "203.0.113.50",
      TRUST_PROXY_HEADERS: "true"
    },
    remoteAddress: "127.0.0.1",
    headers: { "x-forwarded-for": "203.0.113.50" },
    expected: { ok: true, matchedBy: "ip", sourceIp: "203.0.113.50" }
  },
  {
    name: "untrusted proxy headers cannot bypass socket source",
    env: {
      MOCK_IDP_ENFORCE_IP_ALLOWLIST: "true",
      MOCK_IDP_ALLOWED_SOURCE_IPS: "203.0.113.50",
      TRUST_PROXY_HEADERS: "false"
    },
    remoteAddress: "127.0.0.1",
    headers: { "x-forwarded-for": "203.0.113.50" },
    expected: { ok: false, sourceIp: "127.0.0.1" }
  }
];

for (const checkCase of cases) {
  withEnv(checkCase.env, () => {
    const result = evaluateSourceIpAllowlist(mockRequest(checkCase.remoteAddress, checkCase.headers));
    const matchedExpectation =
      result.ok === checkCase.expected.ok &&
      (!checkCase.expected.matchedBy || (result.ok && result.matchedBy === checkCase.expected.matchedBy)) &&
      (!checkCase.expected.sourceIp || result.sourceIp === checkCase.expected.sourceIp);

    if (!matchedExpectation) {
      throw new Error(`${checkCase.name} failed: ${JSON.stringify(result)}`);
    }

    console.log(`${checkCase.name}: ok`);
  });
}
