(function () {
  "use strict";

  const config = window.AIHORIZON_CONFIG || {};
  const backend = window.AIHorizonBackend;
  const localKey = "ai-horizon-radar.signal_assessments.v1";
  const selectedKey = "ai-horizon-radar.signal_assessments.last_selected.v1";
  const url = new URL(window.location.href);
  const workshopSlug = url.searchParams.get("workshop") || config.defaultWorkshopSlug || "prototype";
  const enabled = Boolean(backend && backend.state.configured && config.enableCollaborativeRatings !== false);
  let workshop = null;
  let aggregates = new Map();
  let syncTimer = null;
  let lastPayload = "";

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char];
    });
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

  function scoreLabel(value) {
    const rounded = Math.round(Number(value) || 0);
    return ["—", "Low", "Medium", "High"][rounded] || "—";
  }

  function aggregateHtml(item) {
    if (!item || !Number(item.rating_count)) {
      return '<div class="sr-collab-empty">No group ratings for this signal yet.</div>';
    }
    const responses = [
      ["Watch", item.watch_count],
      ["Prepare", item.prepare_count],
      ["Act", item.act_count]
    ].sort(function (a, b) { return Number(b[1]) - Number(a[1]); });
    return `
      <div class="sr-collab-metrics">
        <div><strong>${esc(item.rating_count)}</strong><span>ratings</span></div>
        <div><strong>${esc(scoreLabel(item.avg_impact))}</strong><span>mean impact ${Number(item.avg_impact || 0).toFixed(1)}</span></div>
        <div><strong>${esc(scoreLabel(item.avg_uncertainty))}</strong><span>mean uncertainty ${Number(item.avg_uncertainty || 0).toFixed(1)}</span></div>
        <div><strong>${esc(responses[0][0])}</strong><span>modal response</span></div>
      </div>
      <div class="sr-collab-distribution">Watch ${Number(item.watch_count) || 0} · Prepare ${Number(item.prepare_count) || 0} · Act ${Number(item.act_count) || 0} · Important ${Number(item.important_count) || 0}</div>
    `;
  }

  function ensureStyles() {
    if (document.getElementById("sr-collab-styles")) return;
    const style = document.createElement("style");
    style.id = "sr-collab-styles";
    style.textContent = `
      .sr-collab-banner{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0 2px;padding:9px 11px;border:1px solid rgba(24,0,97,.14);border-radius:12px;background:rgba(24,0,97,.035);font-size:12px;color:rgba(24,0,97,.72)}
      .sr-collab-live{width:8px;height:8px;border-radius:50%;background:#2a9d62;box-shadow:0 0 0 4px rgba(42,157,98,.12)}
      .sr-collab-group{margin-top:12px;padding:13px;border:1px solid rgba(24,0,97,.14);border-radius:14px;background:rgba(255,255,255,.72)}
      .sr-collab-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:8px}
      .sr-collab-metrics div{padding:9px;border:1px solid rgba(24,0,97,.1);border-radius:10px;background:white}
      .sr-collab-metrics strong,.sr-collab-metrics span{display:block}.sr-collab-metrics strong{font-size:16px;color:#180061}.sr-collab-metrics span{font-size:10px;color:rgba(24,0,97,.6);margin-top:2px}
      .sr-collab-distribution,.sr-collab-empty{font-size:11px;color:rgba(24,0,97,.64);margin-top:8px}
      .dark .sr-collab-banner,.dark .sr-collab-group,.dark .sr-collab-metrics div{background:hsl(var(--card)/.88);border-color:hsl(var(--border));color:hsl(var(--foreground))}.dark .sr-collab-metrics strong{color:hsl(var(--foreground))}.dark .sr-collab-metrics span,.dark .sr-collab-distribution,.dark .sr-collab-empty{color:hsl(var(--muted-foreground))}
      @media(max-width:700px){.sr-collab-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `;
    document.head.appendChild(style);
  }

  function render() {
    if (!(window.location.hash || "").includes("/radar")) return;
    ensureStyles();
    const panel = document.getElementById("signal-radar-mvp-panel");
    if (!panel) return;
    let banner = panel.querySelector(".sr-collab-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.className = "sr-collab-banner";
      panel.insertBefore(banner, panel.firstChild);
    }
    const bannerHtml = enabled && workshop
      ? '<span class="sr-collab-live"></span><strong>Live workshop:</strong> ' + esc(workshop.title) + ' <span>· anonymous contributions · one editable rating per browser</span>'
      : '<strong>Local prototype mode</strong><span>· configure Supabase to aggregate workshop ratings</span>';
    if (banner.innerHTML !== bannerHtml) banner.innerHTML = bannerHtml;

    const id = selectedId();
    let group = panel.querySelector(".sr-collab-group");
    if (!group) {
      group = document.createElement("div");
      group.className = "sr-collab-group";
      panel.appendChild(group);
    }
    const groupHtml = '<div class="sr-mvp-label">Group assessment' + (id ? " · " + esc(id) : "") + '</div>' + aggregateHtml(aggregates.get(id));
    if (group.innerHTML !== groupHtml) group.innerHTML = groupHtml;
  }

  async function refreshAggregates() {
    if (!enabled || !workshop) return;
    try {
      const rows = await backend.getAggregates(workshopSlug);
      aggregates = new Map(rows.map(function (row) { return [row.signal_id, row]; }));
      render();
    } catch (error) {
      console.error("Could not load workshop aggregates", error);
    }
  }

  async function syncSelected() {
    if (!enabled || !workshop) return;
    const id = selectedId();
    if (!id) return;
    const rating = localRating(id);
    const payload = JSON.stringify([id, rating]);
    if (payload === lastPayload) return;
    lastPayload = payload;
    try {
      if (rating) await backend.saveRating(workshop.id, id, rating);
      else await backend.deleteRating(workshop.id, id);
      await refreshAggregates();
      const status = document.getElementById("sr-mvp-status");
      if (status) status.textContent = "Saved to workshop.";
    } catch (error) {
      lastPayload = "";
      const status = document.getElementById("sr-mvp-status");
      if (status) status.textContent = "Workshop sync failed; saved locally.";
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

  async function initialise() {
    if (enabled) {
      try {
        await backend.ensureAnonymousSession();
        workshop = await backend.getWorkshop(workshopSlug);
        if (workshop && workshop.status === "open") await refreshAggregates();
      } catch (error) {
        console.error("Workshop collaboration could not initialise", error);
      }
    }
    render();
  }

  document.addEventListener("click", function (event) {
    if (event.target.closest && (event.target.closest("[data-sr-field]") || event.target.closest("[data-sr-action]") || event.target.closest('[data-testid^="radar-dot-"]'))) scheduleSync();
  }, false);
  window.addEventListener("hashchange", function () { setTimeout(render, 300); });
  new MutationObserver(function () { if ((window.location.hash || "").includes("/radar")) setTimeout(render, 50); }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialise); else initialise();
})();
