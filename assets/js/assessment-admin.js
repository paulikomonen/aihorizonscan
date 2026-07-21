(function () {
  "use strict";

  const config = window.AIHORIZON_CONFIG || {};
  const backend = window.AIHorizonBackend;
  const url = new URL(window.location.href);
  const workshopSlug = url.searchParams.get("workshop") || config.defaultWorkshopSlug || "prototype";
  const assessmentsKey = "ai-horizon-radar.signal_assessments.v1";
  const selectedKey = "ai-horizon-radar.signal_assessments.last_selected.v1";
  const versionKey = "ai-horizon-radar.workshop-version." + workshopSlug;
  let checkingAccess = false;
  let editorAllowed = null;
  let renderTimer = null;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char];
    });
  }

  function onUpdatePage() {
    return (window.location.hash || "").includes("/update");
  }

  function ensureStyles() {
    if (document.getElementById("assessment-admin-styles")) return;
    const style = document.createElement("style");
    style.id = "assessment-admin-styles";
    style.textContent = `
      .assessment-admin-card{border:1px solid rgba(217,74,85,.28);border-radius:14px;background:rgba(217,74,85,.035);overflow:hidden}
      .assessment-admin-head{padding:18px 20px;border-bottom:1px solid rgba(217,74,85,.16)}
      .assessment-admin-body{padding:18px 20px}
      .assessment-admin-title{font-size:16px;font-weight:700;color:hsl(var(--foreground));margin-top:4px}
      .assessment-admin-copy{font-size:12px;line-height:1.55;color:hsl(var(--muted-foreground));margin-top:6px;max-width:720px}
      .assessment-admin-button{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:8px 13px;border:1px solid #d94a55;border-radius:9px;background:#d94a55;color:white;font-size:12px;font-weight:700;cursor:pointer}
      .assessment-admin-button.secondary{border-color:hsl(var(--border));background:hsl(var(--card));color:hsl(var(--foreground))}
      .assessment-admin-button:disabled{opacity:.45;cursor:not-allowed}
      .assessment-admin-confirm{margin-top:14px;padding:14px;border:1px solid rgba(217,74,85,.24);border-radius:12px;background:hsl(var(--card))}
      .assessment-admin-input{width:180px;height:36px;padding:7px 10px;border:1px solid hsl(var(--border));border-radius:8px;background:hsl(var(--background));color:hsl(var(--foreground));font:inherit;font-size:13px}
      .assessment-admin-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:11px}
      .assessment-admin-status{font-size:12px;color:hsl(var(--muted-foreground));margin-top:10px}
      .dark .assessment-admin-card{background:hsl(var(--card)/.72);border-color:rgba(217,74,85,.42)}
    `;
    document.head.appendChild(style);
  }

  async function hasEditorAccess() {
    if (!backend || !backend.state.configured || !backend.client) return false;
    const sessionResult = await backend.client.auth.getSession();
    const user = sessionResult.data && sessionResult.data.session && sessionResult.data.session.user;
    if (!user || user.is_anonymous) return false;
    const access = await backend.client.rpc("is_editor");
    return !access.error && access.data === true;
  }

  function findUpdateContainer() {
    const heading = Array.from(document.querySelectorAll("h1")).find(function (item) {
      return String(item.textContent || "").trim() === "Update tracker";
    });
    return heading && (heading.closest(".space-y-6") || heading.closest("main") || heading.parentElement);
  }

  function renderPanel() {
    if (!onUpdatePage() || editorAllowed !== true || document.getElementById("assessment-admin-panel")) return;
    const container = findUpdateContainer();
    if (!container) return;
    ensureStyles();
    const panel = document.createElement("section");
    panel.id = "assessment-admin-panel";
    panel.className = "assessment-admin-card";
    panel.innerHTML = `
      <div class="assessment-admin-head">
        <div class="text-xs uppercase tracking-[0.18em] font-semibold" style="color:#d94a55">Workshop administration</div>
        <div class="assessment-admin-title">Clear all Signal Radar assessments</div>
        <p class="assessment-admin-copy">Reset every shared rating and strategic note in workshop <strong>${esc(workshopSlug)}</strong>. Participant browsers will also discard their matching local assessments when they next connect.</p>
      </div>
      <div class="assessment-admin-body">
        <button type="button" class="assessment-admin-button" data-assessment-action="open">Clear all assessments…</button>
        <div class="assessment-admin-confirm" data-assessment-confirm hidden>
          <strong style="font-size:13px">Are you sure?</strong>
          <p class="assessment-admin-copy">This cannot be undone. Type <strong>CLEAR</strong> to confirm the workshop reset.</p>
          <div class="assessment-admin-actions">
            <input class="assessment-admin-input" data-assessment-confirmation autocomplete="off" aria-label="Type CLEAR to confirm" placeholder="Type CLEAR" />
            <button type="button" class="assessment-admin-button" data-assessment-action="clear" disabled>Permanently clear</button>
            <button type="button" class="assessment-admin-button secondary" data-assessment-action="cancel">Cancel</button>
          </div>
        </div>
        <div class="assessment-admin-status" data-assessment-status aria-live="polite"></div>
      </div>`;
    container.appendChild(panel);

    const confirmation = panel.querySelector("[data-assessment-confirm]");
    const input = panel.querySelector("[data-assessment-confirmation]");
    const clearButton = panel.querySelector('[data-assessment-action="clear"]');
    const status = panel.querySelector("[data-assessment-status]");

    input.addEventListener("input", function () {
      clearButton.disabled = input.value.trim() !== "CLEAR";
    });
    panel.addEventListener("click", async function (event) {
      const actionButton = event.target.closest && event.target.closest("[data-assessment-action]");
      if (!actionButton) return;
      const action = actionButton.getAttribute("data-assessment-action");
      if (action === "open") {
        confirmation.hidden = false;
        input.focus();
        return;
      }
      if (action === "cancel") {
        confirmation.hidden = true;
        input.value = "";
        clearButton.disabled = true;
        status.textContent = "";
        return;
      }
      if (action !== "clear" || input.value.trim() !== "CLEAR") return;

      actionButton.disabled = true;
      status.textContent = "Clearing workshop assessments…";
      try {
        const result = await backend.clearWorkshopRatings(workshopSlug);
        try {
          localStorage.removeItem(assessmentsKey);
          localStorage.removeItem(selectedKey);
          if (result.ratings_version != null) localStorage.setItem(versionKey, String(result.ratings_version));
        } catch (error) {}
        confirmation.hidden = true;
        input.value = "";
        const removed = Number(result.deleted_count) || 0;
        status.textContent = "Cleared " + removed + " shared assessment" + (removed === 1 ? "" : "s") + " from workshop “" + workshopSlug + "”.";
        window.dispatchEvent(new CustomEvent("aihorizon:ratings-cleared", { detail: result }));
      } catch (error) {
        const message = error && error.message ? error.message : "The workshop assessments could not be cleared.";
        status.textContent = /clear_workshop_ratings/i.test(message)
          ? "Assessment reset is not installed in Supabase yet. Run supabase/assessment-reset-migration.sql first."
          : message;
        actionButton.disabled = false;
      }
    });
  }

  async function initialisePanel() {
    if (!onUpdatePage() || checkingAccess || editorAllowed === false) return;
    if (editorAllowed === true) {
      renderPanel();
      return;
    }
    checkingAccess = true;
    try {
      editorAllowed = await hasEditorAccess();
      if (editorAllowed) renderPanel();
    } catch (error) {
      editorAllowed = false;
      console.error("Could not verify assessment administration access", error);
    } finally {
      checkingAccess = false;
    }
  }

  function schedule() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(initialisePanel, 100);
  }

  window.addEventListener("hashchange", function () {
    editorAllowed = null;
    schedule();
  });
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule); else schedule();
})();
