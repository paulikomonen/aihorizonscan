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
  let openDriverId = "";

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

  function findSignal(signalId) {
    const wanted = String(signalId || "");
    return readSignals().find(function (signal) {
      return String(signal.signalId || signal.signalID || signal.id || "") === wanted;
    }) || null;
  }

  function signalValue(signal, keys, fallback) {
    for (let index = 0; index < keys.length; index += 1) {
      const value = signal && signal[keys[index]];
      if (value != null && String(value).trim()) return String(value).trim();
    }
    return fallback || "";
  }

  function safeSourceUrl(value) {
    try {
      const parsed = new URL(String(value || ""));
      return /^https?:$/.test(parsed.protocol) ? parsed.href : "";
    } catch (error) { return ""; }
  }

  function strategicNotes(item) {
    if (!item || item.strategic_notes == null) return [];
    let notes = item.strategic_notes;
    if (typeof notes === "string") {
      try {
        const parsed = JSON.parse(notes);
        notes = Array.isArray(parsed) ? parsed : [notes];
      } catch (error) { notes = [notes]; }
    }
    return (Array.isArray(notes) ? notes : []).map(function (note) {
      return String(note == null ? "" : note).trim();
    }).filter(Boolean);
  }

  function noteListHtml(item) {
    const notes = strategicNotes(item);
    if (!notes.length) return '<div class="sr-collab-empty">No shared strategic notes for this signal yet.</div>';
    return '<ol class="sr-collab-note-list">' + notes.map(function (note) {
      return '<li><span class="sr-collab-note-author">Anonymous participant</span>' + esc(note) + '</li>';
    }).join("") + "</ol>";
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
      <div class="sr-collab-selected-notes">
        <div class="sr-mvp-label">Shared strategic notes · ${strategicNotes(item).length}</div>
        ${noteListHtml(item)}
      </div>
    `;
  }

  function driverDetailHtml(signalId) {
    if (!signalId) return "";
    const signal = findSignal(signalId);
    if (!signal) return "";
    const title = signalValue(signal, ["title", "Title"], signalId);
    const description = signalValue(signal, ["description", "Description"], "No description is available for this signal.");
    const pestec = signalValue(signal, ["pestecClass", "PESTEC class"], "Unspecified");
    const response = signalValue(signal, ["responseStage", "Organisational response stage"], "Unspecified");
    const direction = signalValue(signal, ["direction", "Direction"], "Mixed");
    const source = safeSourceUrl(signalValue(signal, ["source", "Source"], ""));
    return `
      <div class="sr-collab-driver-detail" id="sr-collab-driver-detail" tabindex="-1">
        <div class="sr-collab-driver-detail-heading"><strong>${esc(signalId)}</strong><span>${esc(title)}</span></div>
        <p>${esc(description)}</p>
        <div class="sr-collab-driver-meta"><span>${esc(pestec)}</span><span>${esc(response)}</span><span>${esc(direction)}</span></div>
        ${source ? '<a href="' + esc(source) + '" target="_blank" rel="noreferrer">Open source ↗</a>' : ""}
      </div>`;
  }

  function sharedNotesHtml(rows, titles) {
    const withNotes = rows.map(function (item) {
      return { item: item, notes: strategicNotes(item) };
    }).filter(function (entry) { return entry.notes.length > 0; });
    const noteCount = withNotes.reduce(function (total, entry) { return total + entry.notes.length; }, 0);
    if (!withNotes.length) {
      return `
        <div class="sr-collab-notes-board">
          <div class="sr-mvp-label">Shared strategic notes</div>
          <div class="sr-collab-empty">Saved workshop notes will appear here anonymously.</div>
        </div>`;
    }
    return `
      <div class="sr-collab-notes-board">
        <div class="sr-mvp-label">Shared strategic notes · ${noteCount}</div>
        <div class="sr-collab-notes-help">Notes are grouped by signal and shown without participant identifiers.</div>
        <div class="sr-collab-note-groups">
          ${withNotes.map(function (entry) {
            const id = String(entry.item.signal_id || "");
            return '<details class="sr-collab-note-group"' + (id === selectedId() ? " open" : "") + '><summary><span><strong>'
              + esc(id) + '</strong> · ' + esc(titles.get(id) || id) + '</span><small>'
              + entry.notes.length + ' note' + (entry.notes.length === 1 ? "" : "s") + '</small></summary>'
              + noteListHtml(entry.item) + '</details>';
          }).join("")}
        </div>
      </div>`;
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
    if (openDriverId && !scenarioDrivers.some(function (item) { return item.signal_id === openDriverId; })) openDriverId = "";
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
      const expanded = openDriverId === item.signal_id;
      return '<li><button type="button" class="sr-collab-driver-button" data-collab-driver="' + esc(item.signal_id)
        + '" aria-expanded="' + (expanded ? "true" : "false") + '" aria-controls="sr-collab-driver-detail"><strong>'
        + esc(item.signal_id) + '</strong> · ' + esc(titles.get(item.signal_id) || item.signal_id)
        + '<span class="sr-collab-driver-scores">Impact ' + Number(item.avg_impact || 0).toFixed(1)
        + ' · Uncertainty ' + Number(item.avg_uncertainty || 0).toFixed(1)
        + ' · n=' + Number(item.rating_count || 0) + '</span><span class="sr-collab-driver-open">'
        + (expanded ? "Hide description" : "View description") + '</span></button></li>';
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
          ${driverDetailHtml(openDriverId)}
        </div>
        <div>
          <div class="sr-mvp-label">Leading group priorities</div>
          ${priorityList ? '<ul class="sr-mvp-summary-list">' + priorityList + '</ul>' : '<div class="sr-collab-empty">Group priorities will appear after participants submit ratings.</div>'}
        </div>
      </div>
      ${sharedNotesHtml(rows, titles)}
    `;
  }

  function ensureStyles() {
    if (document.getElementById("sr-collab-styles")) return;
    const style = document.createElement("style");
    style.id = "sr-collab-styles";
    style.textContent = `
      .sr-collab-banner{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0 14px;padding:9px 11px;border:1px solid rgba(24,0,97,.14);border-radius:12px;background:rgba(24,0,97,.035);font-size:12px;color:rgba(24,0,97,.72)}
      .sr-collab-live{width:8px;height:8px;border-radius:50%;background:#2a9d62;box-shadow:0 0 0 4px rgba(42,157,98,.12)}
      .sr-collab-panel{width:100%;box-sizing:border-box}
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
      .sr-collab-driver-button{display:block;width:100%;padding:0;border:0;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}
      .sr-collab-driver-button:hover strong,.sr-collab-driver-button:focus-visible strong{color:#7c3aed;text-decoration:underline;text-underline-offset:3px}
      .sr-collab-driver-button:focus-visible{outline:2px solid #7c3aed;outline-offset:4px;border-radius:5px}
      .sr-collab-driver-open{display:inline-block;margin-top:4px;font-size:10px;font-weight:700;color:#6d28d9}
      .sr-collab-driver-detail{margin-top:10px;padding:12px;border:1px solid rgba(124,58,237,.24);border-radius:12px;background:rgba(124,58,237,.055)}
      .sr-collab-driver-detail-heading{display:grid;gap:2px;font-size:13px;color:#180061}.sr-collab-driver-detail-heading span{font-weight:700}
      .sr-collab-driver-detail p{margin-top:8px;font-size:12px;line-height:1.52;color:rgba(24,0,97,.76)}
      .sr-collab-driver-detail>a{display:inline-block;margin-top:9px;font-size:11px;font-weight:700;color:#6d28d9;text-decoration:underline;text-underline-offset:3px}
      .sr-collab-driver-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}.sr-collab-driver-meta span{padding:3px 7px;border:1px solid rgba(124,58,237,.18);border-radius:999px;font-size:10px;color:rgba(24,0,97,.7);background:white}
      .sr-collab-selected-notes{margin-top:13px;padding-top:12px;border-top:1px solid rgba(42,157,98,.18)}
      .sr-collab-notes-board{margin-top:18px;padding-top:15px;border-top:1px solid rgba(24,0,97,.11)}
      .sr-collab-notes-help{margin-top:4px;font-size:11px;color:rgba(24,0,97,.62)}
      .sr-collab-note-groups{display:grid;gap:8px;margin-top:10px}
      .sr-collab-note-group{border:1px solid rgba(24,0,97,.11);border-radius:11px;background:white;overflow:hidden}
      .sr-collab-note-group summary{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:9px 11px;cursor:pointer;font-size:12px;color:rgba(24,0,97,.78)}
      .sr-collab-note-group summary small{white-space:nowrap;color:rgba(24,0,97,.55)}
      .sr-collab-note-list{display:grid;gap:7px;margin:8px 0 0;padding:0;list-style:none}
      .sr-collab-note-group .sr-collab-note-list{margin:0;padding:0 11px 11px}
      .sr-collab-note-list li{padding:8px 10px;border-left:3px solid #2a9d62;border-radius:0 8px 8px 0;background:rgba(42,157,98,.055);font-size:12px;line-height:1.48;color:rgba(24,0,97,.78)}
      .sr-collab-note-author{display:block;margin-bottom:2px;font-size:9px;font-weight:750;letter-spacing:.08em;text-transform:uppercase;color:rgba(24,0,97,.48)}
      .dark .sr-collab-banner,.dark .sr-collab-snapshot,.dark .sr-collab-group,.dark .sr-collab-metrics div,.dark .sr-collab-note-group,.dark .sr-collab-driver-meta span{background:hsl(var(--card)/.88);border-color:hsl(var(--border));color:hsl(var(--foreground))}.dark .sr-collab-metrics strong,.dark .sr-collab-driver-detail-heading{color:hsl(var(--foreground))}.dark .sr-collab-metrics span,.dark .sr-collab-distribution,.dark .sr-collab-empty,.dark .sr-collab-driver-key,.dark .sr-collab-driver-scores,.dark .sr-collab-notes-help,.dark .sr-collab-note-group summary,.dark .sr-collab-note-group summary small,.dark .sr-collab-note-list li,.dark .sr-collab-driver-detail p,.dark .sr-collab-driver-meta span{color:hsl(var(--muted-foreground))}.dark .sr-collab-note-list li,.dark .sr-collab-driver-detail{background:hsl(var(--muted)/.3)}
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
    const assessmentPanel = document.getElementById("signal-radar-mvp-panel");
    if (!assessmentPanel) return;
    let panel = document.getElementById("signal-radar-collaboration-panel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "signal-radar-collaboration-panel";
      panel.className = "foresight-panel sr-collab-panel";
      panel.setAttribute("aria-label", "Workshop group results");
      assessmentPanel.insertAdjacentElement("afterend", panel);
    } else if (panel.previousElementSibling !== assessmentPanel) {
      // Keep the individual assessment workspace first so participants can
      // move efficiently from one signal to the next during a workshop.
      assessmentPanel.insertAdjacentElement("afterend", panel);
    }

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
      panel.appendChild(snapshot);
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
    const driverButton = event.target.closest && event.target.closest("[data-collab-driver]");
    if (driverButton) {
      event.preventDefault();
      const signalId = driverButton.getAttribute("data-collab-driver") || "";
      openDriverId = openDriverId === signalId ? "" : signalId;
      render();
      if (openDriverId) setTimeout(function () {
        const detail = document.getElementById("sr-collab-driver-detail");
        if (detail) { detail.focus({ preventScroll: true }); detail.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
      }, 0);
      return;
    }
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
