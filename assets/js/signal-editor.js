(function () {
  "use strict";

  const backend = window.AIHorizonBackend;
  if (!backend || !backend.state || !backend.state.configured || !backend.client) return;

  const SIGNALS_KEY = "ai-horizon-signal-tracker.signals.dynamic_json.v1";
  const UNDO_KEY = "ai-horizon-signal-editor.undo.v1";
  const RADAR_MODE_KEY = "ai-horizon-signal-editor.radar-mode.v1";
  const PESTEC = ["Political", "Economic", "Social", "Technological", "Environmental", "Cultural"];
  const RESPONSES = ["Act", "Prepare", "Watch"];
  const DIRECTIONS = ["Opportunity", "Risk", "Mixed"];
  const FORESIGHT = ["Weak signal", "Trend", "Wild card", "Emerging issue", "Discontinuity"];
  const INNOVATION_STAGES = ["Identify opportunities", "Create concepts", "Validate concepts", "Develop solutions", "Deploy solutions"];

  let editorAllowed = null;
  let editorCheck = null;
  let selectedSignalId = "";
  let radarEditMode = false;
  let dragState = null;
  let suppressClickUntil = 0;
  let scheduleTimer = null;

  try { radarEditMode = sessionStorage.getItem(RADAR_MODE_KEY) === "on"; } catch (error) {}

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function esc(value) {
    return text(value).replace(/[&<>"']/g, function (character) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character];
    });
  }

  function onSignalsPage() {
    return (window.location.hash || "").includes("/signals");
  }

  function onRadarPage() {
    return (window.location.hash || "").includes("/radar");
  }

  function readSignals() {
    if (Array.isArray(window.__AIHORIZON_LIVE_SIGNALS)) return window.__AIHORIZON_LIVE_SIGNALS;
    try {
      const stored = localStorage.getItem(SIGNALS_KEY);
      const parsed = stored ? JSON.parse(stored) : null;
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.signals)) return parsed.signals;
    } catch (error) {}
    return Array.isArray(window.__EMBEDDED_SIGNALS) ? window.__EMBEDDED_SIGNALS : [];
  }

  function findSignal(signalId) {
    const wanted = text(signalId);
    return readSignals().find(function (signal) { return text(signal.signalId) === wanted; }) || null;
  }

  async function hasEditorAccess(force) {
    if (editorAllowed !== null && !force) return editorAllowed;
    if (editorCheck) return editorCheck;
    editorCheck = (async function () {
      try {
        const sessionResult = await backend.client.auth.getSession();
        if (sessionResult.error) throw sessionResult.error;
        const session = sessionResult.data && sessionResult.data.session;
        if (!session || !session.user || session.user.is_anonymous) return false;
        const access = await backend.client.rpc("is_editor");
        if (access.error) throw access.error;
        return access.data === true;
      } catch (error) {
        console.warn("Signal editor access could not be verified", error);
        return false;
      } finally {
        editorCheck = null;
      }
    })();
    editorAllowed = await editorCheck;
    return editorAllowed;
  }

  function ensureStyles() {
    if (document.getElementById("aih-signal-editor-styles")) return;
    const style = document.createElement("style");
    style.id = "aih-signal-editor-styles";
    style.textContent = `
      .aih-editor-button{display:inline-flex;align-items:center;justify-content:center;border:1px solid hsl(var(--border));border-radius:8px;padding:7px 11px;background:hsl(var(--background));color:hsl(var(--foreground));font-size:12px;font-weight:700;cursor:pointer;transition:.15s ease}
      .aih-editor-button:hover{border-color:#180061;background:rgba(24,0,97,.05)}
      .aih-editor-button:disabled{opacity:.55;cursor:not-allowed}
      .aih-signal-edit-button{margin-right:8px}
      .aih-signal-add-wrap{display:flex;align-items:center;gap:9px;margin-top:10px}
      .aih-editor-overlay{position:fixed;inset:0;z-index:10000;background:rgba(10,5,30,.58);display:flex;align-items:center;justify-content:center;padding:20px}
      .aih-editor-modal{width:min(960px,100%);max-height:min(92vh,940px);overflow:auto;border-radius:18px;border:1px solid hsl(var(--border));background:hsl(var(--background));color:hsl(var(--foreground));box-shadow:0 28px 90px rgba(0,0,0,.3)}
      .aih-editor-header{position:sticky;top:0;z-index:2;display:flex;align-items:flex-start;gap:16px;padding:20px 22px;border-bottom:1px solid hsl(var(--border));background:hsl(var(--background))}
      .aih-editor-header h2{font-size:22px;line-height:1.2;margin:4px 0 0}
      .aih-editor-close{margin-left:auto;border:0;background:transparent;color:hsl(var(--muted-foreground));font-size:25px;line-height:1;cursor:pointer}
      .aih-editor-form{padding:20px 22px 24px}
      .aih-editor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
      .aih-editor-field{display:grid;gap:6px}
      .aih-editor-field.full{grid-column:1/-1}
      .aih-editor-field label,.aih-editor-legend{font-size:10px;text-transform:uppercase;letter-spacing:.1em;font-weight:750;color:hsl(var(--muted-foreground))}
      .aih-editor-input,.aih-editor-select,.aih-editor-textarea{width:100%;box-sizing:border-box;border:1px solid hsl(var(--border));border-radius:10px;padding:9px 11px;background:hsl(var(--background));color:hsl(var(--foreground));font:inherit;font-size:13px;outline:none}
      .aih-editor-input:focus,.aih-editor-select:focus,.aih-editor-textarea:focus{border-color:#180061;box-shadow:0 0 0 3px rgba(24,0,97,.08)}
      .aih-editor-input[readonly]{background:hsl(var(--muted)/.45);color:hsl(var(--muted-foreground))}
      .aih-editor-textarea{min-height:92px;resize:vertical;line-height:1.5}
      .aih-editor-checks{display:flex;flex-wrap:wrap;gap:8px}
      .aih-editor-check{display:flex;align-items:center;gap:6px;border:1px solid hsl(var(--border));border-radius:999px;padding:7px 9px;font-size:12px;background:hsl(var(--card))}
      .aih-editor-actions{display:flex;align-items:center;justify-content:flex-end;gap:9px;margin-top:18px;padding-top:16px;border-top:1px solid hsl(var(--border))}
      .aih-editor-status{margin-right:auto;font-size:12px;color:hsl(var(--muted-foreground))}
      .aih-editor-save{border-color:#180061;background:#180061;color:white}
      .aih-editor-save:hover{background:#2a1375;color:white}
      .aih-edit-notice{position:fixed;z-index:10020;right:18px;bottom:18px;width:min(430px,calc(100vw - 36px));border:1px solid hsl(var(--border));border-left:4px solid #2a9d62;border-radius:13px;padding:12px 13px;background:hsl(var(--background));color:hsl(var(--foreground));box-shadow:0 18px 45px rgba(0,0,0,.2);font-size:12px;line-height:1.45}
      .aih-edit-notice.error{border-left-color:#d94a55}
      .aih-edit-notice-actions{display:flex;gap:7px;margin-top:9px}
      .aih-radar-editor-note{margin:8px 0 0;padding:9px 11px;border:1px solid rgba(24,0,97,.18);border-radius:10px;background:rgba(24,0,97,.045);font-size:12px;color:hsl(var(--muted-foreground))}
      [data-testid^="radar-dot-"].aih-radar-editable{cursor:grab!important;touch-action:none}
      [data-testid^="radar-dot-"].aih-radar-editable>circle:first-of-type{stroke:#ffd400!important;stroke-width:2.5!important}
      [data-testid^="radar-dot-"].aih-radar-dragging{cursor:grabbing!important;filter:drop-shadow(0 8px 10px rgba(24,0,97,.2));transition:none!important}
      .aih-radar-drag-label{position:fixed;z-index:10010;pointer-events:none;border-radius:999px;padding:6px 9px;background:#180061;color:white;font-size:12px;font-weight:750;box-shadow:0 8px 20px rgba(24,0,97,.2)}
      @media(max-width:720px){.aih-editor-overlay{padding:8px}.aih-editor-grid{grid-template-columns:1fr}.aih-editor-field.full{grid-column:auto}.aih-editor-modal{max-height:96vh}.aih-editor-header,.aih-editor-form{padding-left:15px;padding-right:15px}}
    `;
    document.head.appendChild(style);
  }

  function showNotice(message, options) {
    ensureStyles();
    const settings = options || {};
    const old = document.getElementById("aih-edit-notice");
    if (old) old.remove();
    const notice = document.createElement("div");
    notice.id = "aih-edit-notice";
    notice.className = "aih-edit-notice" + (settings.error ? " error" : "");
    notice.setAttribute("role", "status");
    notice.innerHTML = '<div class="aih-edit-notice-message"></div><div class="aih-edit-notice-actions"></div>';
    notice.querySelector(".aih-edit-notice-message").textContent = message;
    const actions = notice.querySelector(".aih-edit-notice-actions");
    if (settings.undo) {
      const undo = document.createElement("button");
      undo.type = "button";
      undo.className = "aih-editor-button";
      undo.textContent = "Undo change";
      undo.addEventListener("click", undoLastChange);
      actions.appendChild(undo);
    }
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "aih-editor-button";
    dismiss.textContent = "Dismiss";
    dismiss.addEventListener("click", function () {
      if (settings.undo) {
        try { sessionStorage.removeItem(UNDO_KEY); } catch (error) {}
      }
      notice.remove();
    });
    actions.appendChild(dismiss);
    document.body.appendChild(notice);
    if (!settings.persistent) setTimeout(function () { if (notice.isConnected) notice.remove(); }, 7000);
  }

  async function updateSignal(signalId, signal) {
    const response = await window.fetch("/api/signals/" + encodeURIComponent(signalId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signal)
    });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(payload.message || "Signal update failed (" + response.status + ").");
    return payload.signal;
  }

  async function createSignal(signal) {
    const response = await window.fetch("/api/signals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signal)
    });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(payload.message || "Signal creation failed (" + response.status + ").");
    return payload.signal;
  }

  function storeUndo(previous, message) {
    try {
      sessionStorage.setItem(UNDO_KEY, JSON.stringify({
        previous: previous,
        message: message,
        createdAt: Date.now()
      }));
    } catch (error) {}
  }

  function readUndo() {
    try {
      const item = JSON.parse(sessionStorage.getItem(UNDO_KEY) || "null");
      if (!item || !item.previous || Date.now() - Number(item.createdAt || 0) > 10 * 60 * 1000) {
        sessionStorage.removeItem(UNDO_KEY);
        return null;
      }
      return item;
    } catch (error) {
      return null;
    }
  }

  async function undoLastChange() {
    const item = readUndo();
    if (!item) return;
    const notice = document.getElementById("aih-edit-notice");
    const button = notice && notice.querySelector("button");
    if (button) { button.disabled = true; button.textContent = "Undoing…"; }
    try {
      await updateSignal(item.previous.signalId, item.previous);
      sessionStorage.removeItem(UNDO_KEY);
      window.location.reload();
    } catch (error) {
      showNotice(error.message || "The change could not be undone.", { error: true, persistent: true });
    }
  }

  function showStoredNotice() {
    const item = readUndo();
    if (item && !document.getElementById("aih-edit-notice")) showNotice(item.message, { undo: true, persistent: true });
  }

  function selectOptions(values, selected) {
    return values.map(function (value) {
      return '<option value="' + esc(value) + '"' + (value === selected ? " selected" : "") + ">" + esc(value) + "</option>";
    }).join("");
  }

  function field(name, label, value, options) {
    const settings = options || {};
    const className = "aih-editor-field" + (settings.full ? " full" : "");
    if (settings.type === "select") {
      return '<div class="' + className + '"><label for="aih-field-' + name + '">' + esc(label) + '</label><select class="aih-editor-select" id="aih-field-' + name + '" name="' + name + '">' + selectOptions(settings.values, text(value)) + "</select></div>";
    }
    if (settings.type === "textarea") {
      return '<div class="' + className + '"><label for="aih-field-' + name + '">' + esc(label) + '</label><textarea class="aih-editor-textarea" id="aih-field-' + name + '" name="' + name + '" rows="' + (settings.rows || 3) + '">' + esc(value) + "</textarea></div>";
    }
    return '<div class="' + className + '"><label for="aih-field-' + name + '">' + esc(label) + '</label><input class="aih-editor-input" id="aih-field-' + name + '" name="' + name + '" type="' + (settings.type || "text") + '" value="' + esc(value) + '"' + (settings.readonly ? " readonly" : "") + "></div>";
  }

  function nextSignalId() {
    const used = new Set(readSignals().map(function (signal) { return text(signal.signalId); }));
    const highest = Array.from(used).reduce(function (current, signalId) {
      const match = signalId.match(/^AI-(\d+)$/i);
      return match ? Math.max(current, Number(match[1]) || 0) : current;
    }, 0);
    let number = highest + 1;
    let candidate = "";
    do {
      candidate = "AI-" + String(number).padStart(3, "0");
      number += 1;
    } while (used.has(candidate));
    return candidate;
  }

  function newSignalTemplate() {
    const now = new Date();
    const localDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
    return {
      signalId: nextSignalId(),
      date: localDate,
      geography: "Global",
      pestecClass: "Technological",
      aiDomain: "",
      sector: "Cross-sector",
      foresightCharacter: "Weak signal",
      responseStage: "Watch",
      direction: "Mixed",
      evidenceType: "",
      title: "",
      description: "",
      mainActors: "",
      indicators: "",
      innovationStages: "Identify opportunities",
      innovationImpact: "",
      source: "",
      origin: "web-editor"
    };
  }

  function openSignalEditor(signalId, options) {
    const settings = options || {};
    const isNew = settings.create === true;
    const signal = isNew ? newSignalTemplate() : findSignal(signalId);
    if (!signal) {
      showNotice("The selected signal could not be found. Refresh the page and try again.", { error: true });
      return;
    }
    ensureStyles();
    const existing = document.getElementById("aih-signal-editor-overlay");
    if (existing) existing.remove();
    const selectedStages = new Set(text(signal.innovationStages).split(/[;,]/).map(function (item) { return item.trim(); }).filter(Boolean));
    const overlay = document.createElement("div");
    overlay.id = "aih-signal-editor-overlay";
    overlay.className = "aih-editor-overlay";
    overlay.innerHTML = `
      <div class="aih-editor-modal" role="dialog" aria-modal="true" aria-labelledby="aih-editor-title">
        <div class="aih-editor-header">
          <div><div class="foresight-kicker">Signal database</div><h2 id="aih-editor-title">${isNew ? "Add new signal" : "Edit signal content"}</h2></div>
          <button type="button" class="aih-editor-close" aria-label="Close editor">×</button>
        </div>
        <form class="aih-editor-form" id="aih-signal-editor-form">
          <div class="aih-editor-grid">
            ${field("signalId", "Signal ID (locked)", signal.signalId, { readonly: true })}
            ${field("date", "Date", signal.date, { type: "date" })}
            ${field("geography", "Geography", signal.geography)}
            ${field("pestecClass", "PESTEC class", signal.pestecClass, { type: "select", values: PESTEC })}
            ${field("aiDomain", "AI domain", signal.aiDomain)}
            ${field("sector", "Sector", signal.sector)}
            ${field("foresightCharacter", "Foresight character", signal.foresightCharacter, { type: "select", values: FORESIGHT })}
            ${field("responseStage", "Organisational response stage", signal.responseStage, { type: "select", values: RESPONSES })}
            ${field("direction", "Direction", signal.direction, { type: "select", values: DIRECTIONS })}
            ${field("evidenceType", "Evidence type", signal.evidenceType)}
            ${field("title", "Title", signal.title, { full: true })}
            ${field("description", "Description", signal.description, { type: "textarea", rows: 4, full: true })}
            ${field("mainActors", "Main actors", signal.mainActors, { type: "textarea", rows: 2, full: true })}
            ${field("indicators", "Indicators", signal.indicators, { type: "textarea", rows: 3, full: true })}
            <fieldset class="aih-editor-field full" style="border:0;padding:0;margin:0">
              <legend class="aih-editor-legend" style="margin-bottom:7px">Innovation management process stage(s)</legend>
              <div class="aih-editor-checks">${INNOVATION_STAGES.map(function (stage) {
                return '<label class="aih-editor-check"><input type="checkbox" name="innovationStage" value="' + esc(stage) + '"' + (selectedStages.has(stage) ? " checked" : "") + '><span>' + esc(stage) + "</span></label>";
              }).join("")}</div>
            </fieldset>
            ${field("innovationImpact", "Impact on innovation management", signal.innovationImpact, { type: "textarea", rows: 3, full: true })}
            ${field("source", "Source URL", signal.source, { type: "url", full: true })}
          </div>
          <div class="aih-editor-actions">
            <span class="aih-editor-status" id="aih-editor-status" aria-live="polite">${isNew ? "A unique Signal ID has been assigned automatically." : "Changes will update all website views after saving."}</span>
            <button type="button" class="aih-editor-button" data-action="cancel">Cancel</button>
            <button type="submit" class="aih-editor-button aih-editor-save">${isNew ? "Add signal" : "Save changes"}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector("#aih-signal-editor-form");
    const close = function () { overlay.remove(); };
    overlay.querySelector(".aih-editor-close").addEventListener("click", close);
    overlay.querySelector('[data-action="cancel"]').addEventListener("click", close);
    overlay.addEventListener("click", function (event) { if (event.target === overlay) close(); });
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const status = form.querySelector("#aih-editor-status");
      const saveButton = form.querySelector('button[type="submit"]');
      const formData = new FormData(form);
      const next = Object.assign({}, signal, {
        signalId: signal.signalId,
        date: text(formData.get("date")),
        geography: text(formData.get("geography")),
        pestecClass: text(formData.get("pestecClass")),
        aiDomain: text(formData.get("aiDomain")),
        sector: text(formData.get("sector")),
        foresightCharacter: text(formData.get("foresightCharacter")),
        responseStage: text(formData.get("responseStage")),
        direction: text(formData.get("direction")),
        evidenceType: text(formData.get("evidenceType")),
        title: text(formData.get("title")),
        description: text(formData.get("description")),
        mainActors: text(formData.get("mainActors")),
        indicators: text(formData.get("indicators")),
        innovationStages: formData.getAll("innovationStage").map(text).filter(Boolean).join("; "),
        innovationImpact: text(formData.get("innovationImpact")),
        source: text(formData.get("source"))
      });
      const error = validateSignal(next, isNew);
      if (error) { status.textContent = error; return; }
      saveButton.disabled = true;
      saveButton.textContent = "Saving…";
      status.textContent = "Saving the signal to Supabase…";
      try {
        if (isNew) {
          await createSignal(next);
        } else {
          await updateSignal(signal.signalId, next);
          storeUndo(signal, signal.signalId + " was updated. All views now use the revised content.");
        }
        status.textContent = "Saved. Refreshing the website…";
        setTimeout(function () { window.location.reload(); }, 350);
      } catch (error) {
        saveButton.disabled = false;
        saveButton.textContent = isNew ? "Add signal" : "Save changes";
        status.textContent = error.message || "The signal could not be saved.";
      }
    });
    overlay.querySelector('[name="title"]').focus();
  }

  function validateSignal(signal, isNew) {
    if (!signal.signalId) return "Signal ID is required.";
    if (isNew && findSignal(signal.signalId)) return "That Signal ID already exists. Close the form and try again.";
    if (!signal.title || signal.title.length < 3) return "Enter a signal title.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(signal.date)) return "Enter a valid date.";
    if (!PESTEC.includes(signal.pestecClass)) return "Select a valid PESTEC class.";
    if (!RESPONSES.includes(signal.responseStage)) return "Select a valid response stage.";
    if (!DIRECTIONS.includes(signal.direction)) return "Select a valid direction.";
    if (!FORESIGHT.includes(signal.foresightCharacter)) return "Select a valid foresight character.";
    if (!signal.innovationStages) return "Select at least one innovation management stage.";
    if (signal.source) {
      try {
        const source = new URL(signal.source);
        if (!/^https?:$/.test(source.protocol)) throw new Error("protocol");
      } catch (error) { return "Use a complete http:// or https:// source URL."; }
    }
    return "";
  }

  function installSignalEditButton() {
    if (!onSignalsPage() || editorAllowed !== true) return;
    let deleteButton = document.querySelector('[data-testid^="button-delete-"]');
    if (deleteButton) selectedSignalId = deleteButton.getAttribute("data-testid").replace(/^button-delete-/, "");
    if (!selectedSignalId) return;
    const dialog = (deleteButton && deleteButton.closest('[role="dialog"]')) || Array.from(document.querySelectorAll('[role="dialog"]')).find(function (item) {
      return item.getBoundingClientRect().width > 0 && item.getBoundingClientRect().height > 0;
    });
    if (!dialog || dialog.querySelector(".aih-signal-edit-button")) return;
    let actionArea = deleteButton && deleteButton.parentElement;
    if (!actionArea) actionArea = dialog.querySelector(".pt-4.border-t") || dialog;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "aih-editor-button aih-signal-edit-button";
    button.textContent = "Edit signal";
    button.setAttribute("data-aih-edit-signal", selectedSignalId);
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      openSignalEditor(selectedSignalId);
    });
    if (deleteButton) actionArea.insertBefore(button, deleteButton);
    else actionArea.appendChild(button);
  }

  function installSignalAddButton() {
    if (!onSignalsPage() || editorAllowed !== true || document.getElementById("aih-add-signal-button")) return;
    const heading = Array.from(document.querySelectorAll("h1, h2")).find(function (item) {
      return text(item.textContent) === "Signals";
    });
    const header = heading && (heading.closest("header") || heading.parentElement);
    if (!header) return;
    const wrap = document.createElement("div");
    wrap.className = "aih-signal-add-wrap";
    const button = document.createElement("button");
    button.id = "aih-add-signal-button";
    button.type = "button";
    button.className = "foresight-button";
    button.textContent = "+ Add new signal";
    button.addEventListener("click", function () { openSignalEditor("", { create: true }); });
    const hint = document.createElement("span");
    hint.className = "aih-editor-status";
    hint.textContent = "Add directly to the shared signal database.";
    wrap.appendChild(button);
    wrap.appendChild(hint);
    header.appendChild(wrap);
  }

  function setRadarMode(enabled) {
    radarEditMode = Boolean(enabled);
    try { sessionStorage.setItem(RADAR_MODE_KEY, radarEditMode ? "on" : "off"); } catch (error) {}
    installRadarControls();
  }

  function installRadarControls() {
    if (!onRadarPage() || editorAllowed !== true) return;
    ensureStyles();
    const labelsButton = document.querySelector('[data-testid="toggle-labels"]');
    const radar = document.querySelector('[data-testid="signal-radar"]');
    if (!labelsButton || !radar) return;
    let toggle = document.getElementById("aih-radar-edit-toggle");
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.id = "aih-radar-edit-toggle";
      toggle.type = "button";
      toggle.className = "px-3 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground";
      toggle.addEventListener("click", function () { setRadarMode(!radarEditMode); });
      labelsButton.parentElement.insertBefore(toggle, labelsButton);
    }
    toggle.textContent = radarEditMode ? "Reposition signals: On" : "Reposition signals: Off";
    toggle.setAttribute("aria-pressed", radarEditMode ? "true" : "false");
    let note = document.getElementById("aih-radar-editor-note");
    if (radarEditMode && !note) {
      note = document.createElement("div");
      note.id = "aih-radar-editor-note";
      note.className = "aih-radar-editor-note";
      note.textContent = "Editor mode: drag a dot smoothly inward or outward, then release to snap it to Act, Prepare or Watch. The PESTEC sector remains unchanged.";
      labelsButton.parentElement.insertAdjacentElement("afterend", note);
    }
    if (!radarEditMode && note) note.remove();
    radar.querySelectorAll('[data-testid^="radar-dot-"]').forEach(function (dot) {
      dot.classList.toggle("aih-radar-editable", radarEditMode);
    });
  }

  function mainCircle(dot) {
    return Array.from(dot.querySelectorAll(":scope > circle")).find(function (circle) {
      return !circle.classList.contains("sr-collab-group-ring");
    }) || null;
  }

  function directRadarCircles(svg) {
    return Array.from(svg.children).filter(function (child) {
      return child.tagName && child.tagName.toLowerCase() === "circle";
    });
  }

  function svgPoint(svg, event) {
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    return matrix ? point.matrixTransform(matrix.inverse()) : { x: event.clientX, y: event.clientY };
  }

  function stageFromRadius(radius, innerRadius, outerRadius) {
    const width = (outerRadius - innerRadius) / RESPONSES.length;
    const index = Math.max(0, Math.min(RESPONSES.length - 1, Math.floor((radius - innerRadius) / width)));
    return RESPONSES[index];
  }

  function stageRadius(stage, innerRadius, outerRadius) {
    const index = Math.max(0, RESPONSES.indexOf(stage));
    return innerRadius + (index + 0.5) * (outerRadius - innerRadius) / RESPONSES.length;
  }

  function updateDragPreview(event) {
    if (!dragState) return;
    const point = svgPoint(dragState.svg, event);
    const radius = Math.hypot(point.x - dragState.centerX, point.y - dragState.centerY);
    const stage = stageFromRadius(radius, dragState.innerRadius, dragState.outerRadius);
    // Follow the pointer continuously during the preview. The target stage is
    // still derived from the ring beneath the pointer and is snapped on save.
    const previewRadius = Math.max(dragState.innerRadius + 9, Math.min(dragState.outerRadius - 9, radius));
    const targetX = dragState.centerX + previewRadius * Math.cos(dragState.angle);
    const targetY = dragState.centerY + previewRadius * Math.sin(dragState.angle);
    dragState.targetStage = stage;
    dragState.dot.setAttribute("transform", "translate(" + (targetX - dragState.baseX).toFixed(2) + " " + (targetY - dragState.baseY).toFixed(2) + ")");
    let label = document.getElementById("aih-radar-drag-label");
    if (!label) {
      label = document.createElement("div");
      label.id = "aih-radar-drag-label";
      label.className = "aih-radar-drag-label";
      document.body.appendChild(label);
    }
    label.textContent = stage;
    label.style.left = event.clientX + 13 + "px";
    label.style.top = event.clientY + 13 + "px";
  }

  function cancelDrag() {
    if (!dragState) return;
    if (dragState.originalTransform) dragState.dot.setAttribute("transform", dragState.originalTransform);
    else dragState.dot.removeAttribute("transform");
    dragState.dot.classList.remove("aih-radar-dragging");
    const label = document.getElementById("aih-radar-drag-label");
    if (label) label.remove();
    dragState = null;
  }

  function beginRadarDrag(event, dot) {
    const signalId = dot.getAttribute("data-testid").replace(/^radar-dot-/, "");
    const signal = findSignal(signalId);
    const circle = mainCircle(dot);
    const svg = dot.closest('[data-testid="signal-radar"]');
    if (!signal || !circle || !svg) return;
    const directCircles = directRadarCircles(svg);
    const radii = directCircles.map(function (item) { return Number(item.getAttribute("r") || 0); }).filter(Boolean);
    const viewBox = svg.viewBox && svg.viewBox.baseVal;
    const centerX = viewBox && viewBox.width ? viewBox.x + viewBox.width / 2 : 430;
    const centerY = viewBox && viewBox.height ? viewBox.y + viewBox.height / 2 : 430;
    const innerRadius = radii.length ? Math.min.apply(Math, radii) : 70;
    const outerRadius = radii.length ? Math.max.apply(Math, radii) : 360;
    const baseX = Number(circle.getAttribute("cx") || centerX);
    const baseY = Number(circle.getAttribute("cy") || centerY);
    dragState = {
      pointerId: event.pointerId,
      signal: signal,
      signalId: signalId,
      dot: dot,
      svg: svg,
      baseX: baseX,
      baseY: baseY,
      centerX: centerX,
      centerY: centerY,
      innerRadius: innerRadius,
      outerRadius: outerRadius,
      angle: Math.atan2(baseY - centerY, baseX - centerX),
      originalTransform: dot.getAttribute("transform") || "",
      targetStage: signal.responseStage
    };
    dot.classList.add("aih-radar-dragging");
    try { svg.setPointerCapture(event.pointerId); } catch (error) {}
    updateDragPreview(event);
  }

  async function finishRadarDrag(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const state = dragState;
    const label = document.getElementById("aih-radar-drag-label");
    if (label) label.remove();
    suppressClickUntil = Date.now() + 700;
    if (state.targetStage === state.signal.responseStage) {
      cancelDrag();
      return;
    }
    const confirmed = window.confirm("Move " + state.signalId + " from " + state.signal.responseStage + " to " + state.targetStage + "?\n\nThis updates the signal content in Supabase.");
    if (!confirmed) {
      cancelDrag();
      return;
    }
    const snappedRadius = stageRadius(state.targetStage, state.innerRadius, state.outerRadius);
    const snappedX = state.centerX + snappedRadius * Math.cos(state.angle);
    const snappedY = state.centerY + snappedRadius * Math.sin(state.angle);
    state.dot.setAttribute("transform", "translate(" + (snappedX - state.baseX).toFixed(2) + " " + (snappedY - state.baseY).toFixed(2) + ")");
    dragState = null;
    showNotice("Saving " + state.signalId + " as " + state.targetStage + "…", { persistent: true });
    try {
      const next = Object.assign({}, state.signal, { responseStage: state.targetStage });
      await updateSignal(state.signalId, next);
      storeUndo(state.signal, state.signalId + " moved from " + state.signal.responseStage + " to " + state.targetStage + ".");
      setTimeout(function () { window.location.reload(); }, 300);
    } catch (error) {
      if (state.originalTransform) state.dot.setAttribute("transform", state.originalTransform);
      else state.dot.removeAttribute("transform");
      state.dot.classList.remove("aih-radar-dragging");
      showNotice(error.message || "The radar position could not be saved.", { error: true, persistent: true });
    }
  }

  function scheduleInstall() {
    clearTimeout(scheduleTimer);
    scheduleTimer = setTimeout(async function () {
      ensureStyles();
      showStoredNotice();
      if (!onSignalsPage() && !onRadarPage()) return;
      const allowed = await hasEditorAccess(false);
      if (!allowed) return;
      installSignalAddButton();
      installSignalEditButton();
      installRadarControls();
    }, 90);
  }

  document.addEventListener("click", function (event) {
    const row = event.target.closest && event.target.closest('[data-testid^="row-signal-"]');
    if (row) selectedSignalId = row.getAttribute("data-testid").replace(/^row-signal-/, "");
    if (Date.now() < suppressClickUntil && event.target.closest && event.target.closest('[data-testid^="radar-dot-"]')) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  document.addEventListener("pointerdown", function (event) {
    if (!radarEditMode || editorAllowed !== true || !onRadarPage()) return;
    const dot = event.target.closest && event.target.closest('[data-testid^="radar-dot-"]');
    if (!dot) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    beginRadarDrag(event, dot);
  }, true);

  document.addEventListener("pointermove", function (event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    updateDragPreview(event);
  }, true);

  document.addEventListener("pointerup", function (event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    finishRadarDrag(event);
  }, true);

  document.addEventListener("pointercancel", function () { cancelDrag(); }, true);
  window.addEventListener("hashchange", function () { selectedSignalId = ""; cancelDrag(); scheduleInstall(); });
  window.addEventListener("aihorizon:signals-updated", scheduleInstall);
  backend.client.auth.onAuthStateChange(function () { editorAllowed = null; scheduleInstall(); });
  new MutationObserver(scheduleInstall).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleInstall);
  else scheduleInstall();
})();
