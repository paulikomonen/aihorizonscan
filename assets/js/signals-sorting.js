(function () {
  "use strict";

  const STORAGE_KEY = "ai-horizon-signal-tracker.signals.dynamic_json.v1";
  const SORT_KEY = "ai-horizon-signal-tracker.signals.sort.v1";
  const ROW_PREFIX = "row-signal-";
  let scheduled = false;
  let applying = false;

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function isSignalsPage() {
    return (window.location.hash || "").includes("/signals") && Boolean(document.querySelector('[data-testid="input-search"]'));
  }

  function readSignals() {
    if (Array.isArray(window.__AIHORIZON_LIVE_SIGNALS)) return window.__AIHORIZON_LIVE_SIGNALS;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : null;
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.signals)) return parsed.signals;
    } catch (error) {}
    return Array.isArray(window.__EMBEDDED_SIGNALS) ? window.__EMBEDDED_SIGNALS : [];
  }

  function selectedMode() {
    try { return localStorage.getItem(SORT_KEY) || "date-desc"; } catch (error) { return "date-desc"; }
  }

  function signalId(signal) {
    return text(signal && (signal.signalId || signal.signalID || signal.id || signal["Signal ID"]));
  }

  function addedTimestamp(signal) {
    const value = signal && (signal.createdAt || signal.created_at || signal.date || signal.Date);
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function compareIds(left, right) {
    return signalId(left).localeCompare(signalId(right), undefined, { numeric: true, sensitivity: "base" });
  }

  function comparator(mode) {
    if (mode === "id-asc") return compareIds;
    if (mode === "id-desc") return function (left, right) { return compareIds(right, left); };
    if (mode === "date-asc") {
      return function (left, right) { return addedTimestamp(left) - addedTimestamp(right) || compareIds(left, right); };
    }
    return function (left, right) { return addedTimestamp(right) - addedTimestamp(left) || compareIds(left, right); };
  }

  function formattedAddedDate(signal) {
    const timestamp = addedTimestamp(signal);
    if (!timestamp) return "Date unavailable";
    try {
      return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(new Date(timestamp));
    } catch (error) {
      return new Date(timestamp).toISOString().slice(0, 10);
    }
  }

  function ensureControl() {
    let select = document.getElementById("signals-sort-mode");
    if (select) return select;
    const search = document.querySelector('[data-testid="input-search"]');
    if (!search || !search.parentElement) return null;

    const control = document.createElement("div");
    control.id = "signals-sort-control";
    control.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:8px;";
    control.innerHTML = [
      '<label for="signals-sort-mode" style="font-size:12px;font-weight:600;color:hsl(var(--muted-foreground));">Sort signals by</label>',
      '<select id="signals-sort-mode" data-testid="select-signals-sort" style="height:36px;min-width:250px;border:1px solid hsl(var(--input));border-radius:6px;background:hsl(var(--background));color:hsl(var(--foreground));padding:0 10px;font-size:13px;">',
      '<option value="date-desc">Date added — newest first</option>',
      '<option value="date-asc">Date added — oldest first</option>',
      '<option value="id-asc">Signal ID — lowest first</option>',
      '<option value="id-desc">Signal ID — highest first</option>',
      "</select>"
    ].join("");
    search.parentElement.insertAdjacentElement("afterend", control);
    select = control.querySelector("select");
    select.value = selectedMode();
    select.addEventListener("change", function () {
      try { localStorage.setItem(SORT_KEY, select.value); } catch (error) {}
      sortRows(select.value);
    });
    return select;
  }

  function sortRows(mode) {
    const rows = Array.from(document.querySelectorAll('[data-testid^="' + ROW_PREFIX + '"]'));
    if (rows.length < 1) return;
    const parent = rows[0].parentElement;
    if (!parent || rows.some(function (row) { return row.parentElement !== parent; })) return;

    const signals = readSignals();
    const byId = new Map(signals.map(function (signal) { return [signalId(signal), signal]; }));
    const sorted = rows.slice().sort(function (left, right) {
      const leftId = text(left.getAttribute("data-testid")).slice(ROW_PREFIX.length);
      const rightId = text(right.getAttribute("data-testid")).slice(ROW_PREFIX.length);
      return comparator(mode)(byId.get(leftId) || { signalId: leftId }, byId.get(rightId) || { signalId: rightId });
    });

    rows.forEach(function (row) {
      if (row.querySelector("[data-signal-added-date]")) return;
      const idLabel = Array.from(row.querySelectorAll("span")).find(function (span) {
        return /^AI-/i.test(text(span.textContent));
      });
      const rowId = text(row.getAttribute("data-testid")).slice(ROW_PREFIX.length);
      const signal = byId.get(rowId);
      if (!idLabel || !signal) return;
      const added = document.createElement("span");
      added.setAttribute("data-signal-added-date", "true");
      added.className = "text-[10px] text-muted-foreground";
      added.textContent = "· Added " + formattedAddedDate(signal);
      added.title = signal.createdAt || signal.created_at
        ? "Date added to the signal database"
        : "Signal date (used because the original database entry has no creation timestamp)";
      idLabel.insertAdjacentElement("afterend", added);
    });

    const currentOrder = rows.map(function (row) { return row.getAttribute("data-testid"); }).join("|");
    const nextOrder = sorted.map(function (row) { return row.getAttribute("data-testid"); }).join("|");
    if (currentOrder !== nextOrder) sorted.forEach(function (row) { parent.appendChild(row); });
  }

  function run() {
    scheduled = false;
    if (applying || !isSignalsPage()) return;
    applying = true;
    try {
      const select = ensureControl();
      sortRows(select ? select.value : selectedMode());
    } finally {
      applying = false;
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(run);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule);
  else schedule();
  window.addEventListener("hashchange", schedule);
  window.addEventListener("aihorizon:signals-updated", schedule);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
})();
