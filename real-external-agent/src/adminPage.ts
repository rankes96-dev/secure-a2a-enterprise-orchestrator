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
    main { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 48px; }
    header { display: grid; gap: 10px; margin-bottom: 18px; }
    h1, h2, h3, h4 { margin: 0; letter-spacing: 0; }
    h1 { font-size: clamp(28px, 4vw, 42px); }
    h2 { font-size: 20px; }
    h3 { font-size: 16px; }
    h4 { font-size: 14px; }
    p { margin: 0; color: #526b76; line-height: 1.5; }
    code, pre, strong, span { overflow-wrap: anywhere; }
    pre { max-width: 100%; overflow-x: auto; white-space: pre-wrap; border: 1px solid #dbe3e8; border-radius: 10px; padding: 10px; color: #253d47; background: #f8fafb; font-size: 12px; }
    section, .readiness-panel, .developer-panel { display: grid; gap: 14px; border: 1px solid #dbe3e8; border-radius: 14px; padding: 16px; background: #fff; box-shadow: 0 10px 26px rgba(30, 41, 59, 0.05); }
    label { display: grid; gap: 6px; min-width: 0; }
    input, select, textarea { width: 100%; border: 1px solid #c7d2d8; border-radius: 10px; padding: 10px 11px; color: #172026; background: #fff; font: inherit; }
    textarea { min-height: 104px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; font-size: 13px; }
    button, .button-link { display: inline-flex; justify-content: center; align-items: center; width: fit-content; border: 0; border-radius: 10px; padding: 10px 13px; color: #fff; background: #14213d; font-weight: 900; text-decoration: none; cursor: pointer; }
    button.secondary { color: #14213d; background: #eef3f6; }
    button.chip { border: 1px solid #c7d2d8; color: #253d47; background: #f8fafb; font-size: 12px; padding: 7px 9px; }
    button.chip.selected { color: #fff; border-color: #14213d; background: #14213d; }
    button.chip.warn { color: #8a5a00; border-color: #f0deaa; background: #fff7df; }
    details { min-width: 0; border: 1px solid #dbe3e8; border-radius: 10px; padding: 10px; background: #fbfcfd; }
    details summary { cursor: pointer; color: #14213d; font-weight: 900; }
    .eyebrow, label span, .fact span, .section-kicker { color: #526b76; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .top-row { display: flex; justify-content: space-between; gap: 14px; align-items: start; }
    .view-toggle { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; border: 1px solid #dbe3e8; border-radius: 10px; padding: 8px; background: #fff; }
    .view-toggle span { color: #526b76; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .view-toggle button { border: 1px solid #c7d2d8; color: #253d47; background: #f8fafb; }
    .view-toggle button.active { color: #fff; border-color: #14213d; background: #14213d; }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
    .setup-flow { display: grid; gap: 14px; min-width: 0; }
    .readiness-panel { position: sticky; top: 16px; }
    .status-title { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .status-badge { width: fit-content; border-radius: 999px; padding: 5px 9px; color: #6a4f13; background: #fff8e7; font-size: 12px; font-weight: 900; }
    .status-badge.ready { color: #1d6d3d; background: #eef8f0; }
    .status-badge.blocked { color: #8a5a00; background: #fff7df; }
    .status-badge.incomplete { color: #a1272d; background: #fff0f0; }
    .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .facts.compact { grid-template-columns: 1fr; }
    .fact { display: grid; gap: 5px; min-width: 0; border: 1px solid #edf1f3; border-radius: 10px; padding: 10px; background: #fbfcfd; }
    .field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .message { min-height: 20px; font-size: 13px; font-weight: 800; }
    .error { color: #a1272d; }
    .ok { color: #1d6d3d; }
    .checklist { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .checklist li { display: flex; gap: 8px; align-items: center; color: #384b53; font-size: 13px; }
    .checklist li::before { content: ""; flex: 0 0 auto; width: 9px; height: 9px; border-radius: 999px; background: #9aa8b0; }
    .checklist li.pass::before { background: #1d6d3d; }
    .checklist li.warn::before { background: #a1272d; }
    .collector { display: grid; gap: 9px; }
    .collector-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .collector-column { display: grid; gap: 8px; min-width: 0; border: 1px solid #edf1f3; border-radius: 10px; padding: 10px; background: #fbfcfd; }
    .collector-column h4 { display: flex; justify-content: space-between; gap: 8px; color: #253d47; }
    .chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
    .selected-chip { display: inline-flex; gap: 6px; align-items: center; border: 1px solid #c7d2d8; border-radius: 999px; padding: 6px 8px; color: #253d47; background: #f8fafb; font-size: 12px; font-weight: 800; }
    .selected-chip button { border-radius: 999px; padding: 1px 6px; color: #526b76; background: #e9eff2; font-size: 12px; }
    .collector-list { display: grid; gap: 8px; min-width: 0; }
    .collector-option { display: grid; justify-content: stretch; align-items: start; width: 100%; gap: 4px; border: 1px solid #dbe3e8; border-radius: 10px; padding: 10px; color: #172026; background: #fff; text-align: left; font-weight: 800; }
    .collector-option:hover { border-color: #9fb1bc; background: #f8fafb; }
    .collector-option strong, .selected-item strong { color: #172026; font-size: 13px; line-height: 1.25; }
    .collector-option small, .selected-item small, .item-list small { color: #526b76; font-size: 12px; line-height: 1.35; font-weight: 700; }
    .selected-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; min-width: 0; border: 1px solid #dbe3e8; border-radius: 10px; padding: 9px 10px; color: #172026; background: #fff; }
    .selected-item > div { display: grid; gap: 2px; min-width: 0; }
    .selected-item.warning { border-color: #efcf84; background: #fff8e7; }
    .selected-item.warning strong::before { content: "Denied"; display: inline-flex; margin-right: 7px; border-radius: 999px; padding: 2px 6px; color: #8a5a00; background: #ffe8a8; font-size: 10px; font-weight: 900; text-transform: uppercase; vertical-align: middle; }
    .selected-item button { border-radius: 8px; padding: 6px 8px; color: #253d47; background: #eef3f6; font-size: 12px; white-space: nowrap; }
    .action-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .action-card { display: grid; gap: 9px; min-width: 0; border: 1px solid #dbe3e8; border-radius: 12px; padding: 12px; background: #fbfcfd; }
    .action-card.ready { border-color: #cfe8d4; background: #f6fbf7; }
    .action-card.blocked { border-color: #f0deaa; background: #fffaf0; }
    .action-card.disabled { opacity: 0.72; }
    .action-card small { color: #526b76; line-height: 1.4; }
    .preview-pill { width: fit-content; border-radius: 999px; padding: 4px 8px; color: #1d6d3d; background: #eef8f0; font-size: 11px; font-weight: 900; }
    .preview-pill.blocked { color: #8a5a00; background: #fff7df; }
    .preview-pill.disabled { color: #526b76; background: #eef3f6; }
    .requirement-block { display: grid; gap: 6px; }
    .requirement-block strong { color: #253d47; font-size: 12px; }
    .item-list { display: grid; gap: 5px; margin: 0; padding: 0; list-style: none; }
    .item-list li { display: grid; gap: 1px; border: 1px solid #edf1f3; border-radius: 8px; padding: 7px 8px; background: rgba(255,255,255,0.72); }
    .item-list.warning li { border-color: #efcf84; background: #fff8e7; }
    .decision-section { display: grid; gap: 7px; border-top: 1px solid #edf1f3; padding-top: 10px; }
    .decision-section h3 { font-size: 13px; color: #253d47; }
    .developer-panel { display: none; }
    .developer-panel.active { display: grid; }
    .bizapps-view.hidden { display: none; }
    .developer-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .contract-list { display: grid; gap: 8px; }
    .contract-list code { border: 1px solid #dbe3e8; border-radius: 999px; padding: 7px 9px; background: #f8fafb; font-size: 12px; }
    .muted { color: #526b76; font-size: 13px; }
    @media (max-width: 980px) {
      .layout, .developer-grid, .action-grid, .field-grid, .facts, .collector-grid { grid-template-columns: 1fr; }
      .readiness-panel { position: static; }
    }
    @media (max-width: 640px) {
      main { width: min(100% - 22px, 1180px); padding-top: 18px; }
      .top-row, .view-toggle, .actions { display: grid; grid-template-columns: 1fr; }
      button, .button-link, .view-toggle button { width: 100%; }
      section, .readiness-panel, .developer-panel { padding: 14px; }
      .chip-row { gap: 7px; }
      .selected-item { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="top-row">
        <div>
          <p class="eyebrow">Local external system admin</p>
          <h1>External Agent Integration Setup</h1>
          <p>Configure this external agent the way a BizApps admin would configure an integration app before the Secure A2A Gateway onboards it.</p>
        </div>
        <div class="view-toggle" aria-label="View">
          <span>View:</span>
          <button type="button" id="bizapps-tab" class="active">BizApps setup</button>
          <button type="button" id="developer-tab">Developer details</button>
        </div>
      </div>
    </header>

    <div class="layout bizapps-view" id="bizapps-view">
      <div class="setup-flow">
        <section>
          <p class="section-kicker">Connector</p>
          <h2>External system / Connector type</h2>
          <p>Choose the external system profile this agent belongs to. The connector profile defines the available application access grants, effective permissions, and agent skills/actions.</p>
          <label><span>External system / Connector type</span><select id="connector-select"></select></label>
          <p class="muted" id="connector-description"></p>
        </section>

        <section>
          <p class="section-kicker">Step 1</p>
          <h2>Gateway trust</h2>
          <h3>Trust this Gateway</h3>
          <p>Paste the public Gateway registration from the Secure A2A Gateway. This lets this external agent verify signed Gateway onboarding challenges.</p>
          <div class="facts" id="gateway-facts"></div>
          <details id="gateway-json-details">
            <summary>Gateway registration JSON</summary>
            <label><span>Public Gateway registration</span><textarea id="gateway-json"></textarea></label>
          </details>
          <div class="actions">
            <button id="save-gateway">Save Gateway trust</button>
            <button class="secondary" id="reset-demo">Reset to local demo Gateway</button>
          </div>
          <p class="message" id="gateway-message"></p>
        </section>

        <section>
          <p class="section-kicker">Step 2</p>
          <h2>OAuth application</h2>
          <p>The OAuth application belongs to the external system. The Gateway will verify that this agent's signed response references this registered application and application access grants.</p>
          <div class="field-grid">
            <label><span>OAuth application name</span><input id="oauth-app-name" /></label>
            <label><span>OAuth Client ID</span><input id="oauth-client-id" /></label>
            <label><span>Client authentication method</span><select id="token-auth-method"><option value="private_key_jwt">private_key_jwt</option></select></label>
            <label><span>Application status</span><select id="application-status"><option value="active">active</option><option value="disabled">disabled</option></select></label>
          </div>
          <div class="collector">
            <h3>Application access grants</h3>
            <p class="muted">These are the OAuth/API grants assigned to the connected app. They define what the app can request from the external system.</p>
            <div class="collector-grid">
              <div class="collector-column">
                <h4>Available grants <span id="available-grants-count">0</span></h4>
                <div class="collector-list" id="available-grants"></div>
              </div>
              <div class="collector-column">
                <h4>Selected grants <span id="selected-grants-count">0</span></h4>
                <div class="collector-list" id="selected-grants"></div>
              </div>
            </div>
          </div>
          <details>
            <summary>Advanced OAuth details</summary>
            <label><span>Authorization server issuer</span><input id="authorization-server-issuer" /></label>
          </details>
          <button id="save-oauth">Save OAuth application</button>
          <p class="message" id="oauth-message"></p>
        </section>

        <section>
          <p class="section-kicker">Step 3</p>
          <h2>Service account access</h2>
          <h3>Integration user access</h3>
          <p>Application access grants define what the app can ask for. The service account / integration user defines what it can actually do in the resource system.</p>
          <div class="field-grid">
            <label><span>Account type</span><select id="principal-type"><option value="service_account">service account</option></select></label>
            <label><span>Service account / Integration user</span><input id="principal-id" /></label>
          </div>
          <div class="collector">
            <h3>Effective permissions</h3>
            <p class="muted">These are the roles/permissions held by the service account or integration user inside the external system.</p>
            <div class="collector-grid">
              <div class="collector-column">
                <h4>Available permissions <span id="available-permissions-count">0</span></h4>
                <div class="collector-list" id="available-permissions"></div>
              </div>
              <div class="collector-column">
                <h4>Granted permissions <span id="selected-permissions-count">0</span></h4>
                <div class="collector-list" id="selected-permissions"></div>
              </div>
            </div>
          </div>
          <div class="collector">
            <h3>Explicitly denied permissions</h3>
            <p class="muted">These permissions are explicitly blocked for this integration user.</p>
            <div class="collector-grid">
              <div class="collector-column">
                <h4>Available to deny <span id="available-denied-permissions-count">0</span></h4>
                <div class="collector-list" id="available-denied-permissions"></div>
              </div>
              <div class="collector-column">
                <h4>Denied permissions <span id="selected-denied-permissions-count">0</span></h4>
                <div class="collector-list" id="selected-denied-permissions"></div>
              </div>
            </div>
          </div>
          <button id="save-principal">Save service account access</button>
          <p class="message" id="principal-message"></p>
        </section>

        <section>
          <p class="section-kicker">Step 4</p>
          <h2>Agent actions</h2>
          <h3>Actions this agent can expose</h3>
          <p>These are actions the external agent can declare. The Gateway approves or blocks each action based on application access grants and effective permissions.</p>
          <div class="action-grid" id="action-grid"></div>
          <button id="save-capabilities">Save agent actions</button>
          <p class="message" id="capability-message"></p>
        </section>

        <section>
          <p class="section-kicker">Step 5</p>
          <h2>Readiness</h2>
          <p id="readiness-copy">Loading readiness...</p>
          <ul class="checklist" id="readiness-detail"></ul>
        </section>
      </div>

      <aside class="readiness-panel">
        <div>
          <p class="eyebrow">Readiness</p>
          <div class="status-title">
            <h2 id="ready-title">Loading...</h2>
            <span class="status-badge" id="ready-badge">Checking</span>
          </div>
        </div>
        <ul class="checklist" id="readiness"></ul>
        <div class="facts compact" id="decision-preview"></div>
        <p id="warnings"></p>
      </aside>
    </div>

    <section class="developer-panel" id="developer-view">
      <div>
        <p class="eyebrow">Developer details</p>
        <h2>External agent integration details</h2>
        <p>This is for developers integrating an external agent. BizApps users should use the setup view.</p>
      </div>
      <div class="developer-grid">
        <article>
          <h3>Endpoint contract</h3>
          <div class="contract-list">
            <code>GET /.well-known/a2a-agent.json</code>
            <code>GET /.well-known/jwks.json</code>
            <code>POST /onboarding/challenge</code>
            <code>POST /a2a/task</code>
          </div>
        </article>
        <article>
          <h3>Signed response field names</h3>
          <div class="chip-row" id="signed-response-fields"></div>
        </article>
        <article>
          <h3>Technical skill IDs</h3>
          <div class="chip-row" id="technical-capabilities"></div>
        </article>
        <article>
          <h3>Gateway registration JSON</h3>
          <pre id="developer-gateway-json">{}</pre>
        </article>
        <article>
          <h3>Raw admin config JSON</h3>
          <pre id="developer-config-json">{}</pre>
        </article>
      </div>
    </section>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    const signedResponseFields = ["agentId", "issuer", "clientId", "audience", "connectorId", "resourceSystem", "connectorProfileHash", "externalConfigHash", "requestedApplicationGrants", "requestedScopes", "agentDeclaredSkills", "agentDeclaredCapabilities", "oauthApplication", "servicePrincipal", "nonce", "signedTrustResponse"];
    let currentConfig = null;
    let connectorProfile = null;
    let selectedApplicationGrants = [];
    let effectivePermissions = [];
    let deniedPermissions = [];
    let enabledActionIds = [];

    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
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
    function toggleItem(list, item) {
      return list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
    }
    function addUnique(list, item) {
      return list.includes(item) ? list : [...list, item];
    }
    function catalogItem(catalog, id) {
      return catalog.find((item) => item.id === id) || { id, label: id, description: id };
    }
    function grantItem(id) {
      return catalogItem(connectorProfile.applicationAccessGrantCatalog, id);
    }
    function permissionItem(id) {
      return catalogItem(connectorProfile.effectivePermissionCatalog, id);
    }
    function collectorOption(item, action, secondary = "id") {
      const supporting = secondary === "description" ? item.description : item.id;
      return '<button type="button" class="collector-option" data-action="' + action + '" data-value="' + escapeHtml(item.id) + '">' +
        '<strong>' + escapeHtml(item.label) + '</strong>' +
        '<small>' + escapeHtml(supporting) + '</small>' +
      '</button>';
    }
    function selectedItem(item, action, warning = false) {
      return '<div class="selected-item ' + (warning ? "warning" : "") + '">' +
        '<div><strong>' + escapeHtml(item.label) + '</strong><small>' + escapeHtml(item.id) + '</small></div>' +
        '<button type="button" data-action="' + action + '" data-value="' + escapeHtml(item.id) + '">Remove</button>' +
      '</div>';
    }
    function renderCollector(catalog, selected, availableId, selectedId, availableCountId, selectedCountId, addAction, removeAction, options = {}) {
      const selectedSet = new Set(selected);
      const available = catalog.filter((item) => !selectedSet.has(item.id));
      const selectedItems = selected.map((id) => catalogItem(catalog, id));
      $(availableCountId).textContent = String(available.length);
      $(selectedCountId).textContent = String(selectedItems.length);
      $(availableId).innerHTML = available.length ? available.map((item) => collectorOption(item, addAction, options.availableSecondary || "id")).join("") : '<p class="muted">None available.</p>';
      $(selectedId).innerHTML = selectedItems.length ? selectedItems.map((item) => selectedItem(item, removeAction, Boolean(options.warning))).join("") : '<p class="muted">' + escapeHtml(options.emptySelected || "None selected.") + '</p>';
    }
    function renderCollectors() {
      renderCollector(connectorProfile.applicationAccessGrantCatalog, selectedApplicationGrants, "available-grants", "selected-grants", "available-grants-count", "selected-grants-count", "add-grant", "remove-grant", { availableSecondary: "id", emptySelected: "No grants selected." });
      renderCollector(connectorProfile.effectivePermissionCatalog, effectivePermissions, "available-permissions", "selected-permissions", "available-permissions-count", "selected-permissions-count", "add-permission", "remove-permission", { availableSecondary: "description", emptySelected: "No permissions granted." });
      const deniedCatalog = connectorProfile.effectivePermissionCatalog;
      renderCollector(deniedCatalog, deniedPermissions, "available-denied-permissions", "selected-denied-permissions", "available-denied-permissions-count", "selected-denied-permissions-count", "add-denied", "remove-denied", { availableSecondary: "description", warning: true, emptySelected: "No permissions denied." });
    }
    function itemList(items, resolver, warning = false) {
      return '<ul class="item-list ' + (warning ? "warning" : "") + '">' + items.map((id) => {
        const item = resolver(id);
        return '<li><strong>' + escapeHtml(item.label) + '</strong><small>' + escapeHtml(item.id) + '</small></li>';
      }).join("") + '</ul>';
    }
    function actionPreview(action) {
      const missingApplicationGrants = action.requiredApplicationGrants.filter((grant) => !selectedApplicationGrants.includes(grant));
      const denied = action.requiredEffectivePermissions.filter((permission) => deniedPermissions.includes(permission));
      const missingPermissions = action.requiredEffectivePermissions.filter((permission) => !effectivePermissions.includes(permission) && !deniedPermissions.includes(permission));
      const ready = missingApplicationGrants.length === 0 && missingPermissions.length === 0 && denied.length === 0;
      const status = !ready && missingApplicationGrants.length && (missingPermissions.length || denied.length)
        ? "Blocked by multiple requirements"
        : missingApplicationGrants.length
          ? "Blocked by application access"
          : denied.length
            ? "Blocked by denied permission"
            : missingPermissions.length
              ? "Blocked by effective permission"
              : "Ready";
      return { ready, status, missingApplicationGrants, missingPermissions, denied };
    }
    function renderActions() {
      const skills = connectorProfile.skillCatalog || connectorProfile.actionCatalog || [];
      $("action-grid").innerHTML = skills.map((action) => {
        const enabled = enabledActionIds.includes(action.id);
        const preview = actionPreview(action);
        const statusClass = enabled ? (preview.ready ? "ready" : "blocked") : "disabled";
        const detailBlocks = [
          preview.missingApplicationGrants.length ? '<div class="requirement-block"><strong>Missing application access</strong>' + itemList(preview.missingApplicationGrants, grantItem, true) + '</div>' : '',
          preview.missingPermissions.length ? '<div class="requirement-block"><strong>Missing effective permissions</strong>' + itemList(preview.missingPermissions, permissionItem, true) + '</div>' : '',
          preview.denied.length ? '<div class="requirement-block"><strong>Denied permissions</strong>' + itemList(preview.denied, permissionItem, true) + '</div>' : ''
        ].join("");
        return '<article class="action-card ' + statusClass + '">' +
          '<div><h3>' + escapeHtml(action.label) + '</h3><p>' + escapeHtml(action.description) + '</p></div>' +
          '<span class="preview-pill ' + (enabled ? (preview.ready ? "" : "blocked") : "disabled") + '">' + (enabled ? preview.status : "Disabled") + '</span>' +
          '<div class="requirement-block"><strong>Required application access grants</strong>' + itemList(action.requiredApplicationGrants, grantItem) + '</div>' +
          '<div class="requirement-block"><strong>Required effective permissions</strong>' + itemList(action.requiredEffectivePermissions, permissionItem) + '</div>' +
          (enabled && !preview.ready ? detailBlocks : '') +
          '<details><summary>Advanced metadata</summary><code>' + escapeHtml(action.id) + '</code></details>' +
          '<button type="button" class="' + (enabled ? "secondary" : "") + '" data-action="toggle-action" data-value="' + escapeHtml(action.id) + '">' + (enabled ? "Enabled" : "Disabled") + '</button>' +
        '</article>';
      }).join("");
    }
    function renderReadiness(config) {
      const gatewayReady = Boolean(config.trustedGateway.clientId && config.trustedGateway.issuer && config.trustedGateway.jwksUri);
      const grantsReady = selectedApplicationGrants.length > 0;
      const serviceAccountReady = Boolean(config.servicePrincipal.principalId);
      const permissionsReady = effectivePermissions.length > 0;
      const actionsReady = enabledActionIds.length > 0;
      const noSecrets = ![...config.warnings, ...config.blockers].some((item) => item.toLowerCase().includes("secret"));
      const skills = connectorProfile.skillCatalog || connectorProfile.actionCatalog || [];
      const previews = skills.filter((action) => enabledActionIds.includes(action.id)).map(actionPreview);
      const approved = previews.filter((preview) => preview.ready).length;
      const blocked = previews.length - approved;
      const missingGrants = [...new Set(previews.flatMap((preview) => preview.missingApplicationGrants))];
      const missingPermissions = [...new Set(previews.flatMap((preview) => preview.missingPermissions))];
      const deniedAffectingActions = [...new Set(previews.flatMap((preview) => preview.denied))];
      const uiState = !config.ready ? "incomplete" : blocked > 0 ? "blocked" : "ready";
      $("ready-title").textContent = uiState === "incomplete" ? "Configuration incomplete" : uiState === "blocked" ? "Ready to verify" : "All selected actions ready";
      $("ready-badge").textContent = uiState === "incomplete" ? "Cannot run" : uiState === "blocked" ? "Can run" : "Ready";
      $("ready-badge").className = "status-badge " + (uiState === "ready" ? "ready" : uiState === "blocked" ? "blocked" : "incomplete");
      $("warnings").textContent = [...config.blockers, ...config.warnings].length
        ? [...config.blockers, ...config.warnings].join(" ")
        : uiState === "blocked"
          ? "Configuration is valid; blocked actions need more grants or permissions before the Gateway will approve them."
          : "No warnings. This local demo config does not store or display secrets.";
      const checks = [
        ["Gateway trust configured", gatewayReady],
        ["OAuth app active", config.oauthApplication.status === "active"],
        ["Application access grants selected", grantsReady],
        ["Service account configured", serviceAccountReady],
        ["Effective permissions selected", permissionsReady],
        ["Agent actions selected", actionsReady],
        ["No secrets detected", noSecrets]
      ];
      const html = checks.map(([label, pass]) => '<li class="' + (pass ? "pass" : "warn") + '">' + escapeHtml(label) + '</li>').join("");
      $("readiness").innerHTML = html;
      $("readiness-detail").innerHTML = html;
      $("readiness-copy").textContent = uiState === "incomplete"
        ? "Complete the required setup items before Gateway onboarding."
        : uiState === "blocked"
          ? "Gateway onboarding can run, but some actions will be blocked."
          : "Gateway onboarding can run and all selected actions are ready.";
      const detailSections = [
        ["Missing application access grants", missingGrants, grantItem],
        ["Missing effective permissions", missingPermissions, permissionItem],
        ["Denied permissions", deniedAffectingActions, permissionItem]
      ].map(([label, values, resolver]) => '<div class="decision-section"><h3>' + escapeHtml(label) + '</h3>' + (values.length ? itemList(values, resolver, true) : '<p class="muted">None.</p>') + '</div>').join("");
      $("decision-preview").innerHTML =
        '<div class="fact"><span>Gateway onboarding</span><strong>' + (config.ready ? "Can run" : "Cannot run") + '</strong></div>' +
        '<div class="fact"><span>Ready actions</span><strong>' + escapeHtml(approved) + '</strong></div>' +
        '<div class="fact"><span>Blocked actions</span><strong>' + escapeHtml(blocked) + '</strong></div>' +
        detailSections +
        '<div class="decision-section"><h3>Gateway authority</h3><p class="muted">Final decision happens in the Gateway.</p></div>';
    }
    function renderDeveloper(config) {
      $("signed-response-fields").innerHTML = signedResponseFields.map((field) => '<span class="selected-chip">' + escapeHtml(field) + '</span>').join("");
      $("technical-capabilities").innerHTML = config.capabilityDeclaration.agentDeclaredCapabilities.map((capability) => '<span class="selected-chip">' + escapeHtml(capability) + '</span>').join("");
      $("developer-gateway-json").textContent = JSON.stringify(gatewayRegistration(config), null, 2);
      $("developer-config-json").textContent = JSON.stringify(config, null, 2);
    }
    function render(config) {
      currentConfig = config;
      connectorProfile = config.connectorProfile;
      selectedApplicationGrants = [...(config.oauthApplication.applicationAccessGrants || config.oauthApplication.grantedScopes || [])];
      effectivePermissions = [...config.servicePrincipal.effectivePermissions];
      deniedPermissions = [...config.servicePrincipal.deniedPermissions];
      enabledActionIds = [...(config.capabilityDeclaration.enabledActionIds || config.capabilityDeclaration.agentDeclaredCapabilities)];
      $("connector-select").innerHTML = (config.supportedConnectors || []).map((connector) => '<option value="' + escapeHtml(connector.connectorId) + '" ' + (connector.status !== "available" ? "disabled" : "") + '>' + escapeHtml(connector.displayName + (connector.status === "available" ? "" : " (coming soon)")) + '</option>').join("");
      $("connector-select").value = config.selectedConnectorId;
      $("connector-select").disabled = true;
      $("connector-description").textContent = (config.selectedConnector?.description || "Reference connector profile for this external system.") + " Additional connector profiles will be enabled through the connector registry.";
      $("gateway-facts").innerHTML = [
        ["Gateway Client ID", config.trustedGateway.clientId],
        ["Gateway Issuer", config.trustedGateway.issuer],
        ["Gateway JWKS URI", config.trustedGateway.jwksUri],
        ["Onboarding method", config.trustedGateway.onboardingMethod]
      ].map(([label, value]) => '<div class="fact"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>').join("");
      $("gateway-json").value = JSON.stringify(gatewayRegistration(config), null, 2);
      $("gateway-json-details").open = !config.trustedGateway.clientId;
      $("oauth-app-name").value = config.oauthApplication.appName || "External Agent Connected App";
      $("oauth-client-id").value = config.oauthApplication.clientId;
      $("authorization-server-issuer").value = config.oauthApplication.authorizationServerIssuer;
      $("token-auth-method").value = config.oauthApplication.tokenEndpointAuthMethod;
      $("application-status").value = config.oauthApplication.status;
      $("principal-id").value = config.servicePrincipal.principalId;
      renderCollectors();
      renderActions();
      renderReadiness(config);
      renderDeveloper(config);
    }
    function rerenderLocalPreview() {
      if (!currentConfig) return;
      renderCollectors();
      renderActions();
      renderReadiness(currentConfig);
    }
    async function load() {
      const response = await fetch("/admin/config");
      render(await response.json());
    }
    document.body.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      const action = target.getAttribute("data-action");
      const value = target.getAttribute("data-value");
      if (!value) return;
      if (action === "add-grant") selectedApplicationGrants = addUnique(selectedApplicationGrants, value);
      if (action === "remove-grant") selectedApplicationGrants = selectedApplicationGrants.filter((item) => item !== value);
      if (action === "add-permission") {
        effectivePermissions = addUnique(effectivePermissions, value);
        deniedPermissions = deniedPermissions.filter((item) => item !== value);
      }
      if (action === "remove-permission") effectivePermissions = effectivePermissions.filter((item) => item !== value);
      if (action === "add-denied") {
        deniedPermissions = addUnique(deniedPermissions, value);
        effectivePermissions = effectivePermissions.filter((item) => item !== value);
      }
      if (action === "remove-denied") deniedPermissions = deniedPermissions.filter((item) => item !== value);
      if (action === "toggle-permission") {
        effectivePermissions = toggleItem(effectivePermissions, value);
        if (effectivePermissions.includes(value)) deniedPermissions = deniedPermissions.filter((item) => item !== value);
      }
      if (action === "toggle-denied") {
        deniedPermissions = toggleItem(deniedPermissions, value);
        if (deniedPermissions.includes(value)) effectivePermissions = effectivePermissions.filter((item) => item !== value);
      }
      if (action === "toggle-action") enabledActionIds = toggleItem(enabledActionIds, value);
      rerenderLocalPreview();
    });
    $("bizapps-tab").addEventListener("click", () => {
      $("bizapps-tab").classList.add("active");
      $("developer-tab").classList.remove("active");
      $("bizapps-view").classList.remove("hidden");
      $("developer-view").classList.remove("active");
    });
    $("developer-tab").addEventListener("click", () => {
      $("developer-tab").classList.add("active");
      $("bizapps-tab").classList.remove("active");
      $("bizapps-view").classList.add("hidden");
      $("developer-view").classList.add("active");
    });
    $("save-gateway").addEventListener("click", async () => {
      try { render(await post("/admin/trusted-gateway", JSON.parse($("gateway-json").value))); setMessage("gateway-message", "Gateway trust saved. Configuration changed. Re-run Gateway onboarding to refresh trusted connector attestation."); }
      catch (error) { setMessage("gateway-message", error.message, false); }
    });
    $("reset-demo").addEventListener("click", async () => {
      try { render(await post("/admin/reset-demo")); setMessage("gateway-message", "Demo configuration restored. Re-run Gateway onboarding to refresh trusted connector attestation."); }
      catch (error) { setMessage("gateway-message", error.message, false); }
    });
    $("save-oauth").addEventListener("click", async () => {
      try {
        render(await post("/admin/oauth-application", {
          appName: $("oauth-app-name").value,
          clientId: $("oauth-client-id").value,
          authorizationServerIssuer: $("authorization-server-issuer").value,
          tokenEndpointAuthMethod: $("token-auth-method").value,
          applicationAccessGrants: selectedApplicationGrants,
          grantedScopes: selectedApplicationGrants,
          status: $("application-status").value
        }));
        setMessage("oauth-message", "OAuth application saved. Configuration changed. Re-run Gateway onboarding to refresh trusted connector attestation.");
      } catch (error) { setMessage("oauth-message", error.message, false); }
    });
    $("save-principal").addEventListener("click", async () => {
      try {
        render(await post("/admin/service-principal", {
          principalType: $("principal-type").value,
          principalId: $("principal-id").value,
          effectivePermissions,
          deniedPermissions
        }));
        setMessage("principal-message", "Service account access saved. Configuration changed. Re-run Gateway onboarding to refresh trusted connector attestation.");
      } catch (error) { setMessage("principal-message", error.message, false); }
    });
    $("save-capabilities").addEventListener("click", async () => {
      try {
        render(await post("/admin/skill-declaration", {
          requestedApplicationGrants: selectedApplicationGrants,
          requestedScopes: selectedApplicationGrants,
          enabledSkillIds: enabledActionIds,
          enabledActionIds,
          agentDeclaredSkills: enabledActionIds,
          agentDeclaredCapabilities: enabledActionIds
        }));
        setMessage("capability-message", "Agent actions saved. Configuration changed. Re-run Gateway onboarding to refresh trusted connector attestation.");
      } catch (error) { setMessage("capability-message", error.message, false); }
    });
    load().catch((error) => { $("ready-title").textContent = "Unable to load config"; $("warnings").textContent = error.message; });
  </script>
</body>
</html>`;
}
