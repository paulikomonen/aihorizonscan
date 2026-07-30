(function () {
  "use strict";

  const config = window.AIHORIZON_CONFIG || {};
  const backend = window.AIHorizonBackend;
  const localKey = "ai-horizon-radar.signal_assessments.v1";
  const selectedKey = "ai-horizon-radar.signal_assessments.last_selected.v1";
  const signalsKey = "ai-horizon-signal-tracker.signals.dynamic_json.v1";
  const url = new URL(window.location.href);
  const workshopSlug = url.searchParams.get("workshop") || config.defaultWorkshopSlug || "prototype";
  const enabled = Boolean(backend && backend.state.configured && config.enableCollaborativeRatings !== false);
  const pollIntervalMs = 4000;
  let workshop = null;
  let aggregates = new Map();
  let syncTimer = null;
  let pollTimer = null;
  let renderTimer = null;
  let lastPayload = "";
  let lastRefreshAt = null;
  let refreshing = false;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char];
    });
  }

  function onRadarPage() {
    return (window.location.hash || "").includes("/radar");
  }

  function selectedId() {
    try { return localStorage.getItem(selectedKey) || ""; } catch (error) { return ""; }
  }

  function localRating(id) {
    try {
      const all = JSON.parse(localStorage.getItem(localKey) || "{}");
      return all[id] || null;
    } catch (error) { return null; }
  }

  function workshopVersionKey() {
    return "ai-horizon-radar.workshop-version." + workshopSlug;
  }

  function applyWorkshopVersion(nextWorkshop) {
    if (!nextWorkshop || nextWorkshop.ratings_version == null) return false;
    try {
      const key = workshopVersionKey();
      const nextVersion = String(Number(nextWorkshop.ratings_version) || 0);
      const previousVersion = localStorage.getItem(key);
      const hasOldAssessments = Boolean(localStorage.getItem(localKey));
      const shouldClear = previousVersion !== null
        ? previousVersion !== nextVersion
        : Number(nextVersion) > 0 && hasOldAssessments;
      localStorage.setItem(key, nextVersion);
      if (!shouldClear) return false;
      localStorage.removeItem(localKey);
      localStorage.removeItem(selectedKey);
      lastPayload = "";
      setTimeout(function () { window.location.reload(); }, 80);
      return true;
    } catch (error) {
      console.error("Could not apply workshop assessment reset", error);
      return false;
    }
  }

  function readSignals() {
    if (Array.isArray(window.__AIHORIZON_LIVE_SIGNALS)) return window.__AIHORIZON_LIVE_SIGNALS;
    try {
      const parsed = JSON.parse(localStorage.getItem(signalsKey) || "null");
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.signals)) return parsed.signals;
    } catch (error) {}
    return Array.isArray(window.__EMBEDDED_SIGNALS) ? window.__EMBEDDED_SIGNALS : [];
  }

  function signalTitles() {
    return new Map(readSignals().map(function (signal) {
      const id = String(signal.signalId || signal.signalID || signal.id || "");
      return [id, String(signal.title || signal.Title || id)];
    }));
  }

  function scoreLabel(value) {
    const rounded = Math.round(Number(value) || 0);
    return ["—", "Low", "Medium", "High"][rounded] || "—";
  }

  function modalResponse(item) {
    return [
      ["Watch", Number(item.watch_count) || 0],
      ["Prepare", Number(item.prepare_count) || 0],
      ["Act", Number(item.act_count) || 0]
    ].sort(function (a, b) { return b[1] - a[1]; })[0][0];
  }

  function aggregateHtml(item) {
    if (!item || !Number(item.rating_count)) {
      return '<div class="sr-collab-empty">No group ratings for this signal yet.</div>';
    }
    return `
      <div class="sr-collab-metrics">
        <div><strong>${esc(item.rating_count)}</strong><span>anonymous ratings</span></div>
        <div><strong>${esc(scoreLabel(item.avg_impact))}</strong><span>mean impact ${Number(item.avg_impact || 0).toFixed(1)}</span></div>
        <div><strong>${esc(scoreLabel(item.avg_uncertainty))}</strong><span>mean uncertainty ${Number(item.avg_uncertainty || 0).toFixed(1)}</span></div>
        <div><strong>${esc(modalResponse(item))}</strong><span>most common response</span></div>
      </div>
      <div class="sr-collab-distribution">Watch ${Number(item.watch_count) || 0} · Prepare ${Number(item.prepare_count) || 0} · Act ${Number(item.act_count) || 0} · Important ${Number(item.important_count) || 0}</div>
    `;
  }

  function groupSummaryHtml() {
    const rows = Array.from(aggregates.values()).filter(function (item) { return Number(item.rating_count) > 0; });
    const ratingCount = rows.reduce(function (total, item) { return total + Number(item.rating_count || 0); }, 0);
    const priorities = rows.filter(function (item) {
      const forwardVotes = Number(item.prepare_count || 0) + Number(item.act_count || 0);
      return Number(item.avg_impact || 0) >= 2.5 && (forwardVotes > Number(item.watch_count || 0) || Number(item.important_count || 0) > 0);
    });
    const scenarioDrivers = rows.filter(function (item) {
      return Number(item.avg_impact || 0) >= 2.5 && Number(item.avg_uncertainty || 0) >= 2.5;
    });
    const titles = signalTitles();
    const priorityList = priorities.slice().sort(function (a, b) {
      return (Number(b.avg_impact || 0) + Number(b.important_count || 0) * 0.1) - (Number(a.avg_impact || 0) + Number(a.important_count || 0) * 0.1);
    }).slice(0, 4).map(function (item) {
      return '<li><strong>' + esc(item.signal_id) + '</strong> · ' + esc(titles.get(item.signal_id) || item.signal_id) + '</li>';
    }).join("");
    const scenarioDriverList = scenarioDrivers.slice().sort(function (a, b) {
      const scoreDifference = (Number(b.avg_impact || 0) + Number(b.avg_uncertainty || 0))
        - (Number(a.avg_impact || 0) + Number(a.avg_uncertainty || 0));
      return scoreDifference || Number(b.rating_count || 0) - Number(a.rating_count || 0);
    }).map(function (item) {
      return '<li><strong>' + esc(item.signal_id) + '</strong> · '
        + esc(titles.get(item.signal_id) || item.signal_id)
        + '<span class="sr-collab-driver-scores">Impact ' + Number(item.avg_impact || 0).toFixed(1)
        + ' · Uncertainty ' + Number(item.avg_uncertainty || 0).toFixed(1)
        + ' · n=' + Number(item.rating_count || 0) + '</span></li>';
    }).join("");

    return `
      <div class="foresight-kicker">Workshop group snapshot</div>
      <div class="foresight-grid foresight-grid-3" style="margin-top:10px;">
        <div class="foresight-card"><div class="foresight-kicker">Group-rated</div><div class="foresight-stat" style="font-size:24px;">${rows.length}</div><div class="foresight-body">signals with ${ratingCount} submitted ratings</div></div>
        <div class="foresight-card"><div class="foresight-kicker">Group priorities</div><div class="foresight-stat" style="font-size:24px;">${priorities.length}</div><div class="foresight-body">high-impact signals leaning Prepare or Act</div></div>
        <div class="foresight-card"><div class="foresight-kicker">Scenario drivers</div><div class="foresight-stat" style="font-size:24px;">${scenarioDrivers.length}</div><div class="foresight-body">high mean impact and uncertainty</div></div>
      </div>
      <div class="sr-collab-driver-key"><span aria-hidden="true"></span>Violet rings mark scenario drivers: mean impact and uncertainty are both at least 2.5 on the 1–3 scale.</div>
      <div class="sr-collab-summary-columns">
        <div>
          <div class="sr-mvp-label">Scenario drivers</div>
          ${scenarioDriverList ? '<ul class="sr-mvp-summary-list sr-collab-driver-list">' + scenarioDriverList + '</ul>' : '<div class="sr-collab-empty">Scenario drivers will appear when a group-rated signal crosses both thresholds.</div>'}
        </div>
        <div>
          <div class="sr-mvp-label">Leading group priorities</div>
          ${priorityList ? '<ul class="sr-mvp-summary-list">' + priorityList + '</ul>' : '<div class="sr-collab-empty">Group priorities will appear after participants submit ratings.</div>'}
        </div>
      </div>
    `;
  }

  function ensureStyles() {
    if (document.getElementById("sr-collab-styles")) return;
    const style = document.createElement("style");
    style.id = "sr-collab-styles";
    style.textContent = `
      .sr-collab-banner{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0 14px;padding:9px 11px;border:1px solid rgba(24,0,97,.14);border-radius:12px;background:rgba(24,0,97,.035);font-size:12px;color:rgba(24,0,97,.72)}
      .sr-collab-live{width:8px;height:8px;border-radius:50%;background:#2a9d62;box-shadow:0 0 0 4px rgba(42,157,98,.12)}
      .sr-collab-snapshot{margin:14px 0;padding:14px;border:1px solid rgba(42,157,98,.22);border-radius:16px;background:rgba(42,157,98,.035)}
      .sr-collab-group{margin-top:14px;padding:13px;border:1px solid rgba(42,157,98,.22);border-radius:14px;background:rgba(42,157,98,.035)}
      .sr-collab-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:8px}
      .sr-collab-metrics div{padding:9px;border:1px solid rgba(24,0,97,.1);border-radius:10px;background:white}
      .sr-collab-metrics strong,.sr-collab-metrics span{display:block}.sr-collab-metrics strong{font-size:16px;color:#180061}.sr-collab-metrics span{font-size:10px;color:rgba(24,0,97,.6);margin-top:2px}
      .sr-collab-distribution,.sr-collab-empty{font-size:11px;color:rgba(24,0,97,.64);margin-top:8px}
      .sr-collab-group-ring{fill:none;stroke:#2a9d62;stroke-width:2.5;stroke-dasharray:3 2;opacity:.9;pointer-events:none}
      [data-testid^="radar-dot-"].sr-collab-group-rated{filter:drop-shadow(0 0 3px rgba(42,157,98,.28))}
      [data-testid^="radar-dot-"].sr-collab-scenario-driver{filter:drop-shadow(0 0 5px rgba(124,58,237,.5))}
      [data-testid^="radar-dot-"].sr-collab-scenario-driver .sr-collab-group-ring{stroke:#7c3aed;stroke-width:4;stroke-dasharray:none;opacity:1}
      .sr-collab-driver-key{display:flex;align-items:center;gap:8px;margin-top:13px;font-size:11px;line-height:1.45;color:rgba(24,0,97,.68)}
      .sr-collab-driver-key span{width:11px;height:11px;flex:0 0 11px;border:3px solid #7c3aed;border-radius:50%;box-shadow:0 0 0 2px rgba(124,58,237,.11)}
      .sr-collab-summary-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:14px}
      .sr-collab-driver-list li:before{color:#7c3aed}
      .sr-collab-driver-scores{display:block;margin-top:2px;font-size:10px;color:rgba(24,0,97,.58)}
      .dark .sr-collab-banner,.dark .sr-collab-snapshot,.dark .sr-collab-group,.dark .sr-collab-metrics div{background:hsl(var(--card)/.88);border-color:hsl(var(--border));color:hsl(var(--foreground))}.dark .sr-collab-metrics strong{color:hsl(var(--foreground))}.dark .sr-collab-metrics span,.dark .sr-collab-distribution,.dark .sr-collab-empty,.dark .sr-collab-driver-key,.dark .sr-collab-driver-scores{color:hsl(var(--muted-foreground))}
      @media(max-width:700px){.sr-collab-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.sr-collab-summary-columns{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function markGroupDots() {
    document.querySelectorAll('[data-testid^="radar-dot-"]').forEach(function (dot) {
      const id = dot.getAttribute("data-testid").replace(/^radar-dot-/, "");
      const item = aggregates.get(id);
      const hasGroupRating = Boolean(item && Number(item.rating_count));
      const isScenarioDriver = Boolean(
        hasGroupRating
        && Number(item.avg_impact || 0) >= 2.5
        && Number(item.avg_uncertainty || 0) >= 2.5
      );
      dot.classList.toggle("sr-collab-group-rated", hasGroupRating);
      dot.classList.toggle("sr-collab-scenario-driver", isScenarioDriver);
      let ring = dot.querySelector(".sr-collab-group-ring");
      if (!hasGroupRating) {
        if (ring) ring.remove();
        return;
      }
      const mainCircle = Array.from(dot.children).find(function (child) {
        return child.tagName && child.tagName.toLowerCase() === "circle" && !child.classList.contains("sr-collab-group-ring");
      });
      if (!mainCircle) return;
      if (!ring) {
        ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        ring.setAttribute("class", "sr-collab-group-ring");
        dot.insertBefore(ring, mainCircle);
      }
      ring.setAttribute("cx", mainCircle.getAttribute("cx"));
      ring.setAttribute("cy", mainCircle.getAttribute("cy"));
      ring.setAttribute("r", String(Number(mainCircle.getAttribute("r") || 8) + 5));
    });
  }

  function render() {
    if (!onRadarPage()) return;
    ensureStyles();
    const panel = document.getElementById("signal-radar-mvp-panel");
    if (!panel) return;

    let banner = panel.querySelector(".sr-collab-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.className = "sr-collab-banner";
      panel.insertBefore(banner, panel.firstChild);
    }
    const refreshed = lastRefreshAt ? " · refreshed " + lastRefreshAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
    const bannerHtml = enabled && workshop
      ? '<span class="sr-collab-live"></span><strong>Live workshop:</strong> ' + esc(workshop.title) + '<span>· anonymous contributions · one editable rating per browser' + esc(refreshed) + '</span>'
      : '<strong>Local prototype mode</strong><span>· configure Supabase to aggregate workshop ratings</span>';
    if (banner.innerHTML !== bannerHtml) banner.innerHTML = bannerHtml;

    let snapshot = panel.querySelector(".sr-collab-snapshot");
    if (!snapshot) {
      snapshot = document.createElement("section");
      snapshot.className = "sr-collab-snapshot";
      const grid = panel.querySelector(".sr-mvp-grid");
      panel.insertBefore(snapshot, grid || null);
    }
    const snapshotHtml = groupSummaryHtml();
    if (snapshot.innerHTML !== snapshotHtml) snapshot.innerHTML = snapshotHtml;

    const id = selectedId();
    let group = panel.querySelector(".sr-collab-group");
    if (!group) {
      group = document.createElement("div");
      group.className = "sr-collab-group";
      panel.appendChild(group);
    }
    const groupHtml = '<div class="sr-mvp-label">Workshop group assessment' + (id ? " · " + esc(id) : "") + "</div>" + aggregateHtml(aggregates.get(id));
    if (group.innerHTML !== groupHtml) group.innerHTML = groupHtml;
    markGroupDots();
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 60);
  }

  async function refreshAggregates() {
    if (!enabled || !workshop || workshop.status !== "open" || refreshing) return;
    refreshing = true;
    try {
      const latestWorkshop = await backend.getWorkshop(workshopSlug);
      if (latestWorkshop) {
        const resetDetected = applyWorkshopVersion(latestWorkshop);
        workshop = latestWorkshop;
        if (resetDetected) return;
      }
      const rows = await backend.getAggregates(workshopSlug);
      aggregates = new Map(rows.map(function (row) { return [row.signal_id, row]; }));
      lastRefreshAt = new Date();
      render();
    } catch (error) {
      console.error("Could not load workshop aggregates", error);
    } finally {
      refreshing = false;
    }
  }

  async function syncSelected() {
    if (!enabled || !workshop || workshop.status !== "open") return;
    const id = selectedId();
    if (!id) return;
    const rating = localRating(id);
    const payload = JSON.stringify([id, rating]);
    if (payload === lastPayload) return;
    lastPayload = payload;
    try {
      const latestWorkshop = await backend.getWorkshop(workshopSlug);
      if (latestWorkshop) {
        const resetDetected = applyWorkshopVersion(latestWorkshop);
        workshop = latestWorkshop;
        if (resetDetected) return;
      }
      if (rating) await backend.saveRating(workshop.id, id, rating, workshop.ratings_version);
      else await backend.deleteRating(workshop.id, id);
      await refreshAggregates();
      const status = document.getElementById("sr-mvp-status");
      if (status) status.textContent = "Saved anonymously to workshop.";
    } catch (error) {
      lastPayload = "";
      const status = document.getElementById("sr-mvp-status");
      if (status) status.textContent = "Workshop sync failed; saved in this browser.";
      console.error("Could not sync workshop rating", error);
    }
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      syncSelected();
      render();
    }, 180);
  }

  function startPolling() {
    clearInterval(pollTimer);
    if (!enabled) return;
    pollTimer = setInterval(function () {
      if (onRadarPage() && document.visibilityState !== "hidden") refreshAggregates();
    }, pollIntervalMs);
  }

  async function initialise() {
    if (enabled) {
      try {
        await backend.ensureAnonymousSession();
        workshop = await backend.getWorkshop(workshopSlug);
        if (applyWorkshopVersion(workshop)) return;
        if (workshop && workshop.status === "open") await refreshAggregates();
      } catch (error) {
        console.error("Workshop collaboration could not initialise", error);
      }
    }
    render();
    startPolling();
  }

  document.addEventListener("click", function (event) {
    if (event.target.closest && (event.target.closest("[data-sr-field]") || event.target.closest("[data-sr-action]") || event.target.closest('[data-testid^="radar-dot-"]'))) scheduleSync();
  }, false);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && onRadarPage()) refreshAggregates();
  });
  window.addEventListener("hashchange", function () {
    scheduleRender();
    if (onRadarPage()) refreshAggregates();
  });
  new MutationObserver(function () { if (onRadarPage()) scheduleRender(); }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialise); else initialise();
})();
