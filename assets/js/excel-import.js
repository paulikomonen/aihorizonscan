(function () {
  "use strict";

  const backend = window.AIHorizonBackend;
  const enabled = Boolean(
    backend && backend.state && backend.state.configured &&
    (!window.AIHORIZON_CONFIG || window.AIHORIZON_CONFIG.enableDynamicSignals !== false)
  );
  if (!enabled) return;

  const requiredHeaders = [
    "Signal ID", "Date", "Geography", "PESTEC class", "AI domain", "Sector",
    "Foresight character", "Organisational response stage", "Title", "Description",
    "Main actors", "Direction", "Indicators", "Innovation management process stage(s)",
    "Impact on innovation management", "Source", "Evidence type"
  ];
  const pestecValues = ["Political", "Economic", "Social", "Technological", "Environmental", "Cultural"];
  const foresightValues = ["Weak signal", "Trend", "Wild card", "Emerging issue", "Discontinuity"];
  const responseValues = ["Act", "Prepare", "Watch"];
  const directionValues = ["Opportunity", "Risk", "Mixed"];
  const innovationValues = ["Identify opportunities", "Create concepts", "Validate concepts", "Develop solutions", "Deploy solutions"];
  const fields = [
    "signalId", "date", "geography", "pestecClass", "aiDomain", "sector",
    "foresightCharacter", "responseStage", "title", "description", "mainActors",
    "direction", "indicators", "innovationStages", "innovationImpact", "source", "evidenceType"
  ];

  let prepared = null;

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function excelDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
    }
    if (typeof value === "number" && window.XLSX && window.XLSX.SSF) {
      const parsed = window.XLSX.SSF.parse_date_code(value);
      if (parsed) return [parsed.y, String(parsed.m).padStart(2, "0"), String(parsed.d).padStart(2, "0")].join("-");
    }
    const raw = text(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    const european = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (european) return [european[3], european[2].padStart(2, "0"), european[1].padStart(2, "0")].join("-");
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
  }

  function normalize(row) {
    return {
      signalId: text(row["Signal ID"]),
      date: excelDate(row.Date),
      geography: text(row.Geography),
      pestecClass: text(row["PESTEC class"]),
      aiDomain: text(row["AI domain"]),
      sector: text(row.Sector),
      foresightCharacter: text(row["Foresight character"]),
      responseStage: text(row["Organisational response stage"]),
      title: text(row.Title),
      description: text(row.Description),
      mainActors: text(row["Main actors"]),
      direction: text(row.Direction),
      indicators: text(row.Indicators),
      innovationStages: text(row["Innovation management process stage(s)"]),
      innovationImpact: text(row["Impact on innovation management"]),
      source: text(row.Source),
      evidenceType: text(row["Evidence type"]),
      origin: "excel-master"
    };
  }

  function signature(signal) {
    return JSON.stringify(fields.map(function (field) { return text(signal[field]); }));
  }

  function validate(signals, headers) {
    const errors = [];
    const warnings = [];
    requiredHeaders.forEach(function (header) {
      if (!headers.includes(header)) errors.push('Missing required column: "' + header + '".');
    });
    const seen = new Set();
    signals.forEach(function (signal, index) {
      const row = index + 2;
      if (!signal.signalId) errors.push("Row " + row + ": Signal ID is required.");
      else if (seen.has(signal.signalId)) errors.push("Row " + row + ": duplicate Signal ID " + signal.signalId + ".");
      else seen.add(signal.signalId);
      if (!signal.date) errors.push("Row " + row + ": Date is missing or invalid.");
      if (!signal.title) errors.push("Row " + row + ": Title is required.");
      if (!pestecValues.includes(signal.pestecClass)) errors.push("Row " + row + ": invalid PESTEC class.");
      if (!foresightValues.includes(signal.foresightCharacter)) errors.push("Row " + row + ": invalid Foresight character.");
      if (!responseValues.includes(signal.responseStage)) errors.push("Row " + row + ": invalid Organisational response stage.");
      if (!directionValues.includes(signal.direction)) errors.push("Row " + row + ": invalid Direction.");
      const stages = signal.innovationStages.split(/[;,]/).map(function (item) { return item.trim(); }).filter(Boolean);
      const invalidStages = stages.filter(function (stage) { return !innovationValues.includes(stage); });
      if (!stages.length) errors.push("Row " + row + ": at least one innovation management stage is required.");
      if (invalidStages.length) errors.push("Row " + row + ": invalid innovation stage " + invalidStages.join(", ") + ".");
      if (!signal.source) warnings.push("Row " + row + ": Source is empty.");
    });
    return { errors: errors, warnings: warnings };
  }

  function currentSignals() {
    if (Array.isArray(window.__AIHORIZON_LIVE_SIGNALS)) return Promise.resolve(window.__AIHORIZON_LIVE_SIGNALS);
    return backend.loadSignals();
  }

  function setStatus(panel, message, kind) {
    const status = panel.querySelector("#excel-sync-status");
    status.textContent = message;
    status.style.display = "block";
    status.style.borderColor = kind === "error" ? "rgba(239,68,68,.4)" : kind === "success" ? "rgba(34,197,94,.4)" : "hsl(var(--border))";
    status.style.background = kind === "error" ? "rgba(239,68,68,.08)" : kind === "success" ? "rgba(34,197,94,.08)" : "hsl(var(--muted) / .35)";
  }

  function renderPreview(panel, result) {
    const preview = panel.querySelector("#excel-sync-preview");
    const button = panel.querySelector("#excel-sync-button");
    preview.style.display = "block";
    preview.innerHTML = "";
    const summary = document.createElement("div");
    summary.style.cssText = "display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px";
    [["Workbook", result.signals.length], ["New", result.newCount], ["Changed", result.changedCount], ["Archive", result.archiveCount]].forEach(function (item) {
      const box = document.createElement("div");
      box.style.cssText = "border:1px solid hsl(var(--border));border-radius:9px;padding:8px;background:hsl(var(--background));font-size:11px";
      const strong = document.createElement("strong");
      strong.style.cssText = "display:block;font-size:18px;color:hsl(var(--foreground))";
      strong.textContent = String(item[1]);
      box.appendChild(strong);
      box.appendChild(document.createTextNode(item[0]));
      summary.appendChild(box);
    });
    preview.appendChild(summary);
    const messages = result.validation.errors.concat(result.validation.warnings).slice(0, 10);
    const detail = document.createElement("div");
    detail.style.cssText = "white-space:pre-wrap;font-size:11px;line-height:1.45;color:hsl(var(--muted-foreground))";
    detail.textContent = result.validation.errors.length
      ? result.validation.errors.length + " error(s) prevent synchronization:\n" + messages.join("\n")
      : result.validation.warnings.length
        ? "Ready to synchronize with " + result.validation.warnings.length + " warning(s):\n" + messages.join("\n")
        : "Validation passed. The Signals worksheet matches the website template.";
    preview.appendChild(detail);
    button.disabled = result.validation.errors.length > 0;
  }

  async function prepareWorkbook(file, panel) {
    if (!window.XLSX) throw new Error("The Excel reader did not load. Refresh the page and try again.");
    setStatus(panel, "Reading the Signals worksheet…", "info");
    const bytes = await file.arrayBuffer();
    const workbook = window.XLSX.read(bytes, { type: "array", cellDates: true });
    if (!workbook.SheetNames.includes("Signals")) throw new Error('The workbook must contain a sheet named "Signals".');
    const sheet = workbook.Sheets.Signals;
    const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
    if (!rows.length) throw new Error("The Signals worksheet is empty.");
    const headers = Object.keys(rows[0]);
    const signals = rows.map(normalize).filter(function (signal) { return signal.signalId || signal.title; });
    const validation = validate(signals, headers);
    const existing = await currentSignals();
    const currentById = new Map(existing.map(function (signal) { return [text(signal.signalId), signal]; }));
    const workbookIds = new Set(signals.map(function (signal) { return signal.signalId; }));
    const newCount = signals.filter(function (signal) { return !currentById.has(signal.signalId); }).length;
    const changedCount = signals.filter(function (signal) {
      return currentById.has(signal.signalId) && signature(signal) !== signature(currentById.get(signal.signalId));
    }).length;
    const archiveCount = existing.filter(function (signal) { return !workbookIds.has(text(signal.signalId)); }).length;
    prepared = { fileName: file.name, signals: signals, validation: validation, newCount: newCount, changedCount: changedCount, archiveCount: archiveCount };
    renderPreview(panel, prepared);
    setStatus(panel, validation.errors.length ? "Fix the workbook errors before synchronizing." : "Workbook ready: " + file.name, validation.errors.length ? "error" : "success");
  }

  async function synchronize(panel) {
    if (!prepared || prepared.validation.errors.length) return;
    const message = "Synchronize the shared signal database from " + prepared.fileName + "?\n\n" +
      prepared.signals.length + " workbook signals will be added or updated.\n" +
      prepared.archiveCount + " current signal(s) missing from Excel will be archived.";
    if (!window.confirm(message)) return;
    const button = panel.querySelector("#excel-sync-button");
    button.disabled = true;
    button.textContent = "Synchronizing…";
    setStatus(panel, "Saving the Excel master to Supabase…", "info");
    try {
      const response = await fetch("/api/signals/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signals: prepared.signals })
      });
      const payload = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(payload.message || "Synchronization failed (" + response.status + ").");
      const summary = payload.summary || {};
      try {
        sessionStorage.setItem("ai-horizon-signal-tracker.importNotice",
          "Excel synchronization complete: " + (summary.workbookCount || prepared.signals.length) + " active signals, " + (summary.archivedCount || 0) + " archived.");
      } catch (error) {}
      setStatus(panel, "Synchronization complete. Refreshing the website…", "success");
      setTimeout(function () { window.location.reload(); }, 500);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Synchronize Excel to Supabase";
      setStatus(panel, error.message || "Synchronization failed.", "error");
    }
  }

  function install() {
    if (!(window.location.hash || "").includes("/update")) return;
    if (document.getElementById("excel-master-sync-panel")) return;
    const jsonCard = document.querySelector('[data-testid="card-import"]');
    if (!jsonCard) return;
    const panel = document.createElement("section");
    panel.id = "excel-master-sync-panel";
    panel.className = "foresight-panel";
    panel.innerHTML = `
      <div class="foresight-kicker">Master database</div>
      <h2 class="foresight-title" style="font-size:22px;margin-top:6px">Synchronize from Excel</h2>
      <p class="foresight-body" style="margin-top:7px">Select the master workbook. Only the <strong>Signals</strong> worksheet is read. Matching Signal IDs are updated, new IDs are added, and signals missing from Excel are archived after confirmation.</p>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px">
        <label class="foresight-button secondary" style="cursor:pointer">Choose Excel file<input id="excel-master-file" type="file" accept=".xlsx,.xls" style="display:none"></label>
        <button id="excel-sync-button" type="button" class="foresight-button" disabled>Synchronize Excel to Supabase</button>
      </div>
      <div id="excel-sync-status" style="display:none;margin-top:12px;padding:9px 11px;border:1px solid hsl(var(--border));border-radius:9px;font-size:12px"></div>
      <div id="excel-sync-preview" style="display:none;margin-top:12px"></div>`;
    jsonCard.parentNode.insertBefore(panel, jsonCard);
    panel.querySelector("#excel-master-file").addEventListener("change", function () {
      prepared = null;
      panel.querySelector("#excel-sync-button").disabled = true;
      if (!this.files || !this.files[0]) return;
      prepareWorkbook(this.files[0], panel).catch(function (error) {
        setStatus(panel, error.message || "Could not read the workbook.", "error");
      });
    });
    panel.querySelector("#excel-sync-button").addEventListener("click", function () { synchronize(panel); });
  }

  function schedule() {
    setTimeout(install, 80);
    setTimeout(install, 500);
  }
  window.addEventListener("hashchange", schedule);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule); else schedule();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
})();
