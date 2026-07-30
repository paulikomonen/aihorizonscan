(function () {
  "use strict";

  const backend = window.AIHorizonBackend;
  const DEFAULT_SYNTHESIS = "Across the current {{signal_count}}-signal set, AI is shifting from a tool-centric productivity story to a system-level innovation management challenge: value increasingly depends on redesigned workflows, AI-ready data, assurance gates, regulatory and procurement evidence, and the ability to govern agents, open models and multimodal systems across the full innovation process. The landscape is broadly distributed across PESTEC categories, showing that technological progress is tightly coupled with political compliance and sovereignty, economic compute concentration and operating-model redesign, environmental energy and water constraints, social skills and trust dynamics, and cultural questions of authenticity, disclosure and IP. Innovation teams need a dual posture: act now on governance, workflow redesign, cyber/content risks and infrastructure constraints; prepare capabilities for evaluation, data quality, skills, licensing and responsible scaling; and watch further-horizon discontinuities and wild cards such as deceptive agents and embodied-AI standardisation.";
  const MAX_LENGTH = 5000;
  let cachedRecord = null;
  let loadAttempted = false;
  let lastLoadError = null;
  let loadingPromise = null;
  let editorCheckPending = false;
  let renderTimer = null;
  let refreshDashboardOnNextRender = true;

  function onDashboard() {
    return (window.location.hash || "").includes("/dashboard");
  }

  function onUpdatePage() {
    return (window.location.hash || "").includes("/update");
  }

  function activeSignalCount() {
    if (Array.isArray(window.__AIHORIZON_LIVE_SIGNALS)) return window.__AIHORIZON_LIVE_SIGNALS.length;
    if (Array.isArray(window.__EMBEDDED_SIGNALS)) return window.__EMBEDDED_SIGNALS.length;
    return 0;
  }

  function renderContent(content) {
    return String(content || DEFAULT_SYNTHESIS).replace(/\{\{signal_count\}\}/g, String(activeSignalCount()));
  }

  function formattedDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function helpfulError(error) {
    const message = String(error && error.message ? error.message : error || "");
    if (/dashboard_content|set_qualitative_synthesis|schema cache|PGRST20[245]/i.test(message)) {
      return "Supabase dashboard content is not ready. Re-run supabase/dashboard-content-migration.sql in the Supabase SQL Editor, then reload this page.";
    }
    if (/row-level security|permission denied|42501/i.test(message)) {
      return "Supabase rejected the update. Confirm that you are signed in with an approved editor account, then re-run the dashboard content migration.";
    }
    if (/session is missing|session.*expired/i.test(message)) {
      return message;
    }
    if (/not approved/i.test(message)) {
      return message + " Check that the same lowercase email address is present in public.editor_accounts.";
    }
    return message || "The synthesis could not be saved.";
  }

  function ensureStyles() {
    if (document.getElementById("aih-synthesis-styles")) return;
    const style = document.createElement("style");
    style.id = "aih-synthesis-styles";
    style.textContent = `
      .aih-synthesis-admin{margin-top:14px}
      .aih-synthesis-editor{width:100%;min-height:210px;resize:vertical;margin-top:12px;padding:12px 13px;border:1px solid hsl(var(--border));border-radius:12px;background:hsl(var(--background));color:hsl(var(--foreground));font:inherit;font-size:13px;line-height:1.6;outline:none}
      .aih-synthesis-editor:focus{border-color:#180061;box-shadow:0 0 0 3px rgba(24,0,97,.08)}
      .aih-synthesis-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}
      .aih-synthesis-status{font-size:12px;line-height:1.4;color:hsl(var(--muted-foreground))}
      .aih-synthesis-counter{margin-left:auto;font-size:11px;color:hsl(var(--muted-foreground))}
      .aih-synthesis-meta{margin-top:7px;font-size:11px;color:hsl(var(--muted-foreground))}
      .aih-synthesis-dashboard-meta{margin-top:9px;font-size:11px;color:rgba(24,0,97,.58)}
      .dark .aih-synthesis-dashboard-meta{color:hsl(var(--muted-foreground))}
      @media(max-width:620px){.aih-synthesis-counter{width:100%;margin-left:0}}
    `;
    document.head.appendChild(style);
  }

  async function loadRecord(force) {
    if (!backend || !backend.state.configured || !backend.getQualitativeSynthesis) return null;
    if (loadAttempted && !force) return cachedRecord;
    if (loadingPromise) return loadingPromise;
    loadingPromise = (async function () {
      try {
        cachedRecord = await backend.getQualitativeSynthesis();
        lastLoadError = null;
        loadAttempted = true;
        return cachedRecord;
      } catch (error) {
        // Until the migration has been run, the existing static synthesis remains
        // visible and Update Tracker explains what is missing.
        lastLoadError = error;
        loadAttempted = true;
        console.warn("Qualitative synthesis could not be loaded", error);
        return null;
      } finally {
        loadingPromise = null;
      }
    })();
    return loadingPromise;
  }

  function applyDashboardRecord(record) {
    if (!onDashboard() || !record || !record.content) return false;
    const target = document.querySelector(".foresight-synthesis-text");
    if (!target) return false;
    ensureStyles();
    const nextContent = renderContent(record.content);
    if (target.textContent !== nextContent) target.textContent = nextContent;
    const card = target.closest(".foresight-synthesis-card") || target.parentElement;
    let meta = card && card.querySelector(".aih-synthesis-dashboard-meta");
    if (card && !meta) {
      meta = document.createElement("div");
      meta.className = "aih-synthesis-dashboard-meta";
      card.appendChild(meta);
    }
    if (meta) {
      const nextMeta = record.updated_at ? "Editorial synthesis updated " + formattedDate(record.updated_at) : "";
      if (meta.textContent !== nextMeta) meta.textContent = nextMeta;
    }
    return true;
  }

  async function renderDashboard(force) {
    if (!onDashboard()) return false;
    const target = document.querySelector(".foresight-synthesis-text");
    if (!target) return false;
    const record = await loadRecord(Boolean(force));
    return applyDashboardRecord(record);
  }

  async function approvedEditor() {
    if (!backend || !backend.client || editorCheckPending) return false;
    editorCheckPending = true;
    try {
      const sessionResult = await backend.client.auth.getSession();
      const session = sessionResult.data && sessionResult.data.session;
      if (!session || !session.user || session.user.is_anonymous) return false;
      const access = await backend.client.rpc("is_editor");
      return !access.error && access.data === true;
    } finally {
      editorCheckPending = false;
    }
  }

  function updateCounter(panel) {
    const textarea = panel.querySelector("#aih-synthesis-editor");
    const counter = panel.querySelector("#aih-synthesis-counter");
    if (textarea && counter) counter.textContent = textarea.value.length + " / " + MAX_LENGTH;
  }

  async function renderEditor() {
    if (!onUpdatePage() || document.getElementById("aih-synthesis-admin")) return;
    if (!await approvedEditor()) return;
    ensureStyles();
    const anchor = document.getElementById("update-workflow-panel");
    if (!anchor) return;

    const panel = document.createElement("section");
    panel.id = "aih-synthesis-admin";
    panel.className = "foresight-panel aih-synthesis-admin";
    panel.setAttribute("aria-label", "Dashboard qualitative synthesis editor");
    panel.innerHTML = `
      <div class="foresight-kicker">Dashboard content</div>
      <h2 class="foresight-title" style="font-size:24px;margin-top:6px;">Update the qualitative synthesis</h2>
      <p class="foresight-body" style="margin-top:7px;max-width:900px;">Edit the interpretive synthesis shown on the Dashboard. Use <code>{{signal_count}}</code> where the current number of active signals should appear.</p>
      <textarea id="aih-synthesis-editor" class="aih-synthesis-editor" maxlength="${MAX_LENGTH}" aria-label="Qualitative synthesis"></textarea>
      <div class="aih-synthesis-actions">
        <button type="button" class="foresight-button" id="aih-save-synthesis">Save to Dashboard</button>
        <button type="button" class="foresight-button secondary" id="aih-reload-synthesis">Reload saved text</button>
        <button type="button" class="foresight-button secondary" id="aih-default-synthesis">Restore default draft</button>
        <span class="aih-synthesis-counter" id="aih-synthesis-counter"></span>
      </div>
      <div class="aih-synthesis-meta" id="aih-synthesis-meta"></div>
      <div class="aih-synthesis-status" id="aih-synthesis-status" aria-live="polite"></div>
    `;
    anchor.insertAdjacentElement("afterend", panel);

    const textarea = panel.querySelector("#aih-synthesis-editor");
    const status = panel.querySelector("#aih-synthesis-status");
    const meta = panel.querySelector("#aih-synthesis-meta");
    const saveButton = panel.querySelector("#aih-save-synthesis");

    async function populate(force) {
      status.textContent = "Loading the saved synthesis…";
      const record = await loadRecord(force);
      textarea.value = record && record.content ? record.content : DEFAULT_SYNTHESIS;
      meta.textContent = record && record.updated_at ? "Last saved " + formattedDate(record.updated_at) : "Using the built-in default until the first save.";
      status.textContent = record ? "" : lastLoadError
        ? helpfulError(lastLoadError)
        : "No saved synthesis was found. Save this draft to publish it.";
      updateCounter(panel);
    }

    textarea.addEventListener("input", function () {
      updateCounter(panel);
      status.textContent = "Unsaved changes.";
    });

    panel.querySelector("#aih-reload-synthesis").addEventListener("click", function () {
      populate(true);
    });

    panel.querySelector("#aih-default-synthesis").addEventListener("click", function () {
      textarea.value = DEFAULT_SYNTHESIS;
      updateCounter(panel);
      status.textContent = "Default text restored as a draft. Select Save to publish it.";
      textarea.focus();
    });

    saveButton.addEventListener("click", async function () {
      const content = textarea.value.trim();
      if (content.length < 20) {
        status.textContent = "Please enter at least 20 characters.";
        textarea.focus();
        return;
      }
      saveButton.disabled = true;
      saveButton.textContent = "Saving…";
      status.textContent = "Saving the synthesis to Supabase…";
      try {
        cachedRecord = await backend.saveQualitativeSynthesis(content);
        loadAttempted = true;
        lastLoadError = null;
        textarea.value = cachedRecord.content;
        meta.textContent = "Last saved " + formattedDate(cachedRecord.updated_at);
        status.textContent = "Saved and verified. The Dashboard now shows this synthesis.";
        updateCounter(panel);
      } catch (error) {
        status.textContent = helpfulError(error);
      } finally {
        saveButton.disabled = false;
        saveButton.textContent = "Save to Dashboard";
      }
    });

    populate(false);
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(function () {
      const forceRefresh = refreshDashboardOnNextRender && onDashboard();
      renderDashboard(forceRefresh).then(function (rendered) {
        if (forceRefresh && rendered) refreshDashboardOnNextRender = false;
      });
      renderEditor();
    }, 80);
  }

  window.addEventListener("hashchange", function () {
    if (onDashboard()) refreshDashboardOnNextRender = true;
    scheduleRender();
  });
  window.addEventListener("focus", function () {
    if (!onDashboard()) return;
    refreshDashboardOnNextRender = true;
    scheduleRender();
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible" || !onDashboard()) return;
    refreshDashboardOnNextRender = true;
    scheduleRender();
  });
  window.addEventListener("aihorizon:signals-updated", function () {
    if (onDashboard()) renderDashboard(false);
  });
  window.addEventListener("aihorizon:synthesis-updated", function (event) {
    if (event.detail) {
      cachedRecord = event.detail;
      loadAttempted = true;
      lastLoadError = null;
    }
    if (onDashboard()) applyDashboardRecord(cachedRecord);
  });
  new MutationObserver(scheduleRender).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleRender);
  else scheduleRender();
})();
