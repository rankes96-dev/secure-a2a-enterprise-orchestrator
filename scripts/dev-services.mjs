import { spawn, spawnSync } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const services = [
  { name: "web", args: ["run", "dev", "-w", "apps/web-ui"] },
  { name: "orchestrator", args: ["run", "dev", "-w", "services/orchestrator-api"], env: { PORT: "4000" } },
  { name: "triage", args: ["run", "dev", "-w", "services/end-user-triage-agent"], env: { PORT: "4106" } },
  { name: "jira", args: ["run", "dev", "-w", "services/jira-agent"], env: { PORT: "4101" } },
  { name: "github", args: ["run", "dev", "-w", "services/github-agent"], env: { PORT: "4102" } },
  { name: "pagerduty", args: ["run", "dev", "-w", "services/pagerduty-agent"], env: { PORT: "4103" } },
  { name: "oauth", args: ["run", "dev", "-w", "services/security-oauth-agent"], env: { PORT: "4104" } },
  { name: "health", args: ["run", "dev", "-w", "services/api-health-agent"], env: { PORT: "4105" } },
  { name: "idp", args: ["run", "dev", "-w", "services/mock-identity-provider"], env: { PORT: "4110" } },
  { name: "external-jira", args: ["run", "dev:jira", "-w", "real-external-agent"] },
  { name: "external-servicenow", args: ["run", "dev:servicenow", "-w", "real-external-agent"] },
  { name: "external-github", args: ["run", "dev:github", "-w", "real-external-agent"] }
];

const children = new Map();
let shuttingDown = false;

const sharedBuild = spawnSync(npmCommand, ["run", "build", "-w", "@a2a/shared"], { stdio: "inherit" });
if (sharedBuild.status !== 0) {
  process.exit(sharedBuild.status ?? 1);
}

function prefixStream(name, stream, writer) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) {
        writer.write(`[${name}] ${line}\n`);
      }
    }
  });
  stream.on("end", () => {
    if (buffer.length > 0) {
      writer.write(`[${name}] ${buffer}\n`);
    }
  });
}

function stopAll(signal = "SIGTERM") {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children.values()) {
    child.kill(signal);
  }
}

for (const service of services) {
  const child = spawn(npmCommand, service.args, {
    env: { ...process.env, ...service.env },
    stdio: ["ignore", "pipe", "pipe"]
  });

  children.set(service.name, child);
  prefixStream(service.name, child.stdout, process.stdout);
  prefixStream(service.name, child.stderr, process.stderr);

  child.on("exit", (code, signal) => {
    children.delete(service.name);
    if (!shuttingDown && code !== 0) {
      console.error(`[dev] ${service.name} exited with ${signal ?? code}`);
      stopAll();
      process.exitCode = code ?? 1;
    }
  });
}

process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));
