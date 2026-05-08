export function adminPageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>External Agent Admin Console</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172026; background: #f5f7f9; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    main { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0 48px; }
    header { display: grid; gap: 8px; margin-bottom: 22px; }
    h1, h2 { margin: 0; }
    h1 { font-size: clamp(28px, 4vw, 44px); letter-spacing: 0; }
    h2 { font-size: 18px; }
    p { margin: 0; color: #526b76; line-height: 1.5; }
    section, .status { display: grid; gap: 14px; border: 1px solid #dbe3e8; border-radius: 14px; padding: 16px; background: #fff; box-shadow: 0 10px 26px rgba(30, 41, 59, 0.05); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .fact { display: grid; gap: 5px; min-width: 0; border: 1px solid #edf1f3; border-radius: 10px; padding: 10px; background: #fbfcfd; }
    .fact span, label span, .eyebrow { color: #526b76; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .fact strong, code { overflow-wrap: anywhere; }
    label { display: grid; gap: 6px; }
    input, select, textarea { width: 100%; border: 1px solid #c7d2d8; border-radius: 10px; padding: 10px 11px; color: #172026; background: #fff; font: inherit; }
    textarea { min-height: 106px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; font-size: 13px; }
    button { width: fit-content; border: 0; border-radius: 10px; padding: 10px 13px; color: #fff; background: #14213d; font-weight: 900; cursor: pointer; }
    button.secondary { color: #14213d; background: #eef3f6; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .message { min-height: 20px; font-size: 13px; font-weight: 800; }
    .error { color: #a1272d; }
    .ok { color: #1d6d3d; }
    .checklist { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .checklist li { display: flex; gap: 8px; align-items: center; color: #384b53; }
    .checklist li::before { content: ""; width: 9px; height: 9px; border-radius: 999px; background: #9aa8b0; }
    .checklist li.pass::before { background: #1d6d3d; }
    .checklist li.warn::before { background: #a1272d; }
    @media (max-width: 820px) { .grid, .facts { grid-template-columns: 1fr; } main { width: min(100% - 22px, 1180px); padding-top: 20px; } button { width: 100%; } }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">Local demo admin</p>
      <h1>External Agent Admin Console</h1>
      <p>Configure the external application identity that this agent uses before it can be onboarded by the Secure A2A Gateway.</p>
    </header>

    <div class="status">
      <div>
        <p class="eyebrow">Readiness Status</p>
        <h2 id="ready-title">Loading...</h2>
      </div>
      <ul class="checklist" id="readiness"></ul>
      <p id="warnings"></p>
    </div>

    <section>
      <p class="eyebrow">Agent Identity</p>
      <h2>Read-only external agent identity</h2>
      <div class="facts" id="agent-facts"></div>
    </section>

    <div class="grid">
      <section>
        <p class="eyebrow">Trusted Gateway Registration</p>
        <h2>Which Gateway may onboard this agent?</h2>
        <p>Paste the Gateway registration JSON from the Secure A2A Gateway. It contains public metadata only and is used to verify signed Gateway challenges.</p>
        <label><span>Paste Gateway Registration JSON</span><textarea id="gateway-json"></textarea></label>
        <div class="actions">
          <button id="save-gateway">Save Gateway Registration</button>
          <button class="secondary" id="reset-demo">Reset to local demo Gateway</button>
        </div>
        <p class="message" id="gateway-message"></p>
      </section>

      <section>
        <p class="eyebrow">OAuth Application Binding</p>
        <h2>External OAuth application</h2>
        <p>This OAuth application belongs to the external system. The Gateway will only verify that the agent's signed response references this registered application.</p>
        <label><span>Resource system</span><input id="resource-system" value="jira" disabled /></label>
        <label><span>OAuth Client ID</span><input id="oauth-client-id" /></label>
        <label><span>Authorization server / IdP issuer</span><input id="authorization-server-issuer" /></label>
        <label><span>Token endpoint auth method</span><select id="token-auth-method"><option value="private_key_jwt">private_key_jwt</option></select></label>
        <label><span>Granted scopes</span><textarea id="granted-scopes"></textarea></label>
        <label><span>Application status</span><select id="application-status"><option value="active">active</option><option value="disabled">disabled</option></select></label>
        <button id="save-oauth">Save OAuth Application</button>
        <p class="message" id="oauth-message"></p>
      </section>
    </div>

    <div class="grid">
      <section>
        <p class="eyebrow">Service Principal / Permissions</p>
        <h2>Integration principal</h2>
        <p>OAuth scopes are not enough. The service principal also needs resource-system permissions. The Gateway uses these permissions to derive approved and blocked capabilities.</p>
        <label><span>Principal type</span><select id="principal-type"><option value="service_account">service_account</option></select></label>
        <label><span>Principal ID</span><input id="principal-id" /></label>
        <label><span>Effective permissions</span><textarea id="effective-permissions"></textarea></label>
        <label><span>Denied permissions</span><textarea id="denied-permissions"></textarea></label>
        <button id="save-principal">Save Service Principal</button>
        <p class="message" id="principal-message"></p>
      </section>

      <section>
        <p class="eyebrow">Agent Capability Declaration</p>
        <h2>What this agent declares</h2>
        <p>These are declarations by the external agent. The Gateway does not approve them until OAuth grants and resource permissions are validated.</p>
        <label><span>Requested scopes</span><textarea id="requested-scopes"></textarea></label>
        <label><span>Agent-declared capabilities</span><textarea id="declared-capabilities"></textarea></label>
        <button id="save-capabilities">Save Capability Declaration</button>
        <p class="message" id="capability-message"></p>
      </section>
    </div>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    const lines = (items) => (items || []).join("\\n");
    const post = async (path, body) => {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
      const json = await response.json();
      if (!response.ok) throw new Error((json.errors || json.details || [json.error || "request failed"]).join(" "));
      return json.config || json;
    };
    const setMessage = (id, text, ok = true) => { const el = $(id); el.textContent = text; el.className = "message " + (ok ? "ok" : "error"); };
    function gatewayRegistration(config) {
      return {
        gatewayId: config.trustedGateway.gatewayId,
        clientId: config.trustedGateway.clientId,
        issuer: config.trustedGateway.issuer,
        jwksUri: config.trustedGateway.jwksUri,
        onboardingMethod: config.trustedGateway.onboardingMethod
      };
    }
    function render(config) {
      $("ready-title").textContent = config.ready ? "Ready for onboarding" : "Configuration incomplete";
      $("warnings").textContent = config.warnings.length ? config.warnings.join(" ") : "No warnings. This local demo config does not store or display secrets.";
      $("readiness").innerHTML = [
        ["Gateway registration configured", config.trustedGateway.clientId && config.trustedGateway.issuer && config.trustedGateway.jwksUri],
        ["OAuth application active", config.oauthApplication.status === "active"],
        ["OAuth client ID configured", config.oauthApplication.clientId],
        ["Granted scopes configured", config.oauthApplication.grantedScopes.length],
        ["Service principal configured", config.servicePrincipal.principalId],
        ["Agent-declared capabilities configured", config.capabilityDeclaration.agentDeclaredCapabilities.length],
        ["No secrets detected", !config.warnings.some((item) => item.toLowerCase().includes("secret"))],
        ["Ready to accept signed Gateway challenge", config.ready]
      ].map(([label, pass]) => '<li class="' + (pass ? 'pass' : 'warn') + '">' + label + '</li>').join("");
      $("agent-facts").innerHTML = [
        ["Agent ID", config.agent.agentId],
        ["Agent issuer", config.agent.issuer],
        ["JWKS URI", config.agent.jwksUri],
        ["Onboarding endpoint", config.agent.onboardingEndpoint],
        ["Runtime endpoint", config.agent.runtimeEndpoint],
        ["Resource system", config.agent.resourceSystem],
        ["Trust adapter", config.agent.trustAdapter],
        ["Runtime audience", config.agent.runtimeAudience]
      ].map(([label, value]) => '<div class="fact"><span>' + label + '</span><strong>' + value + '</strong></div>').join("");
      $("gateway-json").value = JSON.stringify(gatewayRegistration(config), null, 2);
      $("oauth-client-id").value = config.oauthApplication.clientId;
      $("authorization-server-issuer").value = config.oauthApplication.authorizationServerIssuer;
      $("token-auth-method").value = config.oauthApplication.tokenEndpointAuthMethod;
      $("granted-scopes").value = lines(config.oauthApplication.grantedScopes);
      $("application-status").value = config.oauthApplication.status;
      $("principal-id").value = config.servicePrincipal.principalId;
      $("effective-permissions").value = lines(config.servicePrincipal.effectivePermissions);
      $("denied-permissions").value = lines(config.servicePrincipal.deniedPermissions);
      $("requested-scopes").value = lines(config.capabilityDeclaration.requestedScopes);
      $("declared-capabilities").value = lines(config.capabilityDeclaration.agentDeclaredCapabilities);
    }
    async function load() {
      const response = await fetch("/admin/config");
      render(await response.json());
    }
    $("save-gateway").addEventListener("click", async () => {
      try { render(await post("/admin/trusted-gateway", JSON.parse($("gateway-json").value))); setMessage("gateway-message", "Gateway registration saved."); }
      catch (error) { setMessage("gateway-message", error.message, false); }
    });
    $("reset-demo").addEventListener("click", async () => {
      try { render(await post("/admin/reset-demo")); setMessage("gateway-message", "Demo configuration restored."); }
      catch (error) { setMessage("gateway-message", error.message, false); }
    });
    $("save-oauth").addEventListener("click", async () => {
      try { render(await post("/admin/oauth-application", { clientId: $("oauth-client-id").value, authorizationServerIssuer: $("authorization-server-issuer").value, tokenEndpointAuthMethod: $("token-auth-method").value, grantedScopes: $("granted-scopes").value, status: $("application-status").value })); setMessage("oauth-message", "OAuth application saved."); }
      catch (error) { setMessage("oauth-message", error.message, false); }
    });
    $("save-principal").addEventListener("click", async () => {
      try { render(await post("/admin/service-principal", { principalType: $("principal-type").value, principalId: $("principal-id").value, effectivePermissions: $("effective-permissions").value, deniedPermissions: $("denied-permissions").value })); setMessage("principal-message", "Service principal saved."); }
      catch (error) { setMessage("principal-message", error.message, false); }
    });
    $("save-capabilities").addEventListener("click", async () => {
      try { render(await post("/admin/capability-declaration", { requestedScopes: $("requested-scopes").value, agentDeclaredCapabilities: $("declared-capabilities").value })); setMessage("capability-message", "Capability declaration saved."); }
      catch (error) { setMessage("capability-message", error.message, false); }
    });
    load().catch((error) => { $("ready-title").textContent = "Unable to load config"; $("warnings").textContent = error.message; });
  </script>
</body>
</html>`;
}
