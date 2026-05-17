import { spawn, spawnSync } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function npmSpawnArgs(args) {
  if (process.platform !== "win32") {
    return { command: npmCommand, args };
  }

  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", npmCommand, ...args]
  };
}

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

console.log("[dev] building @a2a/shared before starting services...");
const sharedBuildCommand = npmSpawnArgs(["run", "build", "-w", "@a2a/shared"]);
const sharedBuild = spawnSync(sharedBuildCommand.command, sharedBuildCommand.args, { stdio: "inherit" });
if (sharedBuild.status !== 0) {
  console.error(`[dev] @a2a/shared build failed with ${sharedBuild.signal ?? sharedBuild.status ?? "unknown status"}`);
  if (sharedBuild.error) {
    console.error(`[dev] failed to start shared build: ${sharedBuild.error.message}`);
  }
  process.exit(sharedBuild.status ?? 1);
}
console.log("[dev] @a2a/shared build completed.");

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
  const serviceCommand = npmSpawnArgs(service.args);
  console.log(`[dev] starting ${service.name}: ${npmCommand} ${service.args.join(" ")}`);
  const child = spawn(serviceCommand.command, serviceCommand.args, {
    env: { ...process.env, ...service.env },
    stdio: ["ignore", "pipe", "pipe"]
  });

  children.set(service.name, child);
  console.log(`[dev] spawned ${service.name} pid=${child.pid ?? "unknown"}`);
  prefixStream(service.name, child.stdout, process.stdout);
  prefixStream(service.name, child.stderr, process.stderr);

  child.on("error", (error) => {
    children.delete(service.name);
    console.error(`[dev] failed to spawn ${service.name}: ${error.message}`);
    if (!shuttingDown) {
      stopAll();
      process.exitCode = 1;
    }
  });

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
