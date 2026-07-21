(function () {
  "use strict";

  const config = window.AIHORIZON_CONFIG || {};
  const createClient = window.supabase && window.supabase.createClient;
  const configured = Boolean(
    createClient &&
    config.supabaseUrl &&
    config.supabasePublishableKey
  );

  const state = {
    configured,
    client: null,
    mode: configured ? "connecting" : "local",
    lastError: null
  };

  const signalCacheKey = "ai-horizon-signal-tracker.signals.dynamic_json.v1";

  function jsonResponse(data, status) {
    return Promise.resolve(new Response(JSON.stringify(data), {
      status: status || 200,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    }));
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function toSignal(row) {
    return {
      signalId: row.signal_id,
      date: row.signal_date,
      geography: row.geography,
      pestecClass: row.pestec_class,
      aiDomain: row.ai_domain,
      sector: row.sector,
      foresightCharacter: row.foresight_character,
      responseStage: row.response_stage,
      title: row.title,
      description: row.description,
      mainActors: row.main_actors,
      direction: row.direction,
      indicators: row.indicators,
      // Keep the public API compatible with the original static dataset. The
      // bundled dashboard groups stages with String.split().
      innovationStages: asArray(row.innovation_stages).join("; "),
      innovationImpact: row.innovation_impact,
      source: row.source,
      evidenceType: row.evidence_type,
      origin: row.origin || "database"
    };
  }

  function generatedSignalId(signal) {
    const source = [signal.title, signal.source, signal.date]
      .map(function (value) { return String(value || "").trim().toLowerCase(); })
      .join("|");
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return "AI-" + (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
  }

  function fromSignal(signal) {
    const stages = Array.isArray(signal.innovationStages)
      ? signal.innovationStages
      : String(signal.innovationStages || "")
          .split(/[;,]/)
          .map(function (item) { return item.trim(); })
          .filter(Boolean);
    return {
      signal_id: String(signal.signalId || generatedSignalId(signal)),
      signal_date: signal.date || new Date().toISOString().slice(0, 10),
      geography: signal.geography || "Global",
      pestec_class: signal.pestecClass || "Technological",
      ai_domain: signal.aiDomain || "General AI",
      sector: signal.sector || "Cross-sector",
      foresight_character: signal.foresightCharacter || "Weak signal",
      response_stage: signal.responseStage || "Watch",
      title: signal.title || "Untitled signal",
      description: signal.description || "",
      main_actors: signal.mainActors || "Not specified",
      direction: signal.direction || "Mixed",
      indicators: signal.indicators || "",
      innovation_stages: stages,
      innovation_impact: signal.innovationImpact || "",
      source: signal.source || "",
      evidence_type: signal.evidenceType || "Analyst input",
      origin: signal.origin || "database",
      is_archived: false,
      updated_at: new Date().toISOString()
    };
  }

  function publishSignals(signals) {
    const current = asArray(signals);
    window.__AIHORIZON_LIVE_SIGNALS = current;
    try {
      localStorage.setItem(signalCacheKey, JSON.stringify(current));
      localStorage.removeItem(signalCacheKey + ".localEdits");
    } catch (error) {}
    try {
      window.dispatchEvent(new CustomEvent("aihorizon:signals-updated", {
        detail: { count: current.length }
      }));
    } catch (error) {}
    return current;
  }

  async function loadSignals() {
    const result = await state.client
      .from("signals")
      .select("*")
      .eq("is_archived", false)
      .order("signal_date", { ascending: false });
    if (result.error) throw result.error;
    return publishSignals(asArray(result.data).map(toSignal));
  }

  async function ensureAnonymousSession() {
    if (!state.client) return null;
    const current = await state.client.auth.getSession();
    if (current.error) throw current.error;
    if (current.data.session) return current.data.session;
    const signedIn = await state.client.auth.signInAnonymously();
    if (signedIn.error) throw signedIn.error;
    return signedIn.data.session;
  }

  if (configured) {
    state.client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    state.mode = "database";
  }

  const backend = {
    state,
    client: state.client,
    ensureAnonymousSession,
    loadSignals,
    async getWorkshop(slug) {
      if (!state.client) return null;
      let result = await state.client
        .from("workshops")
        .select("id, slug, title, status, opens_at, closes_at, ratings_version")
        .eq("slug", slug)
        .maybeSingle();
      // Keep ratings working while the reset migration is being deployed.
      // The clear control remains unavailable until ratings_version exists.
      if (result.error && /ratings_version/i.test(result.error.message || "")) {
        result = await state.client
          .from("workshops")
          .select("id, slug, title, status, opens_at, closes_at")
          .eq("slug", slug)
          .maybeSingle();
      }
      if (result.error) throw result.error;
      return result.data;
    },
    async saveRating(workshopId, signalId, rating, workshopVersion) {
      const session = await ensureAnonymousSession();
      if (!session || !session.user) throw new Error("Anonymous workshop session could not be created.");
      const payload = {
        workshop_id: workshopId,
        signal_id: signalId,
        participant_id: session.user.id,
        impact: rating.impact || null,
        uncertainty: rating.uncertainty || null,
        recommended_response: rating.response || null,
        important: Boolean(rating.important),
        note: rating.note || null,
        updated_at: new Date().toISOString()
      };
      if (workshopVersion != null) payload.workshop_version = Number(workshopVersion) || 0;
      const result = await state.client
        .from("ratings")
        .upsert(payload, { onConflict: "workshop_id,signal_id,participant_id" })
        .select()
        .single();
      if (result.error) throw result.error;
      return result.data;
    },
    async deleteRating(workshopId, signalId) {
      const session = await ensureAnonymousSession();
      if (!session || !session.user) return;
      const result = await state.client
        .from("ratings")
        .delete()
        .eq("workshop_id", workshopId)
        .eq("signal_id", signalId)
        .eq("participant_id", session.user.id);
      if (result.error) throw result.error;
    },
    async getAggregates(slug) {
      if (!state.client) return [];
      const result = await state.client.rpc("get_workshop_aggregates", {
        p_workshop_slug: slug
      });
      if (result.error) throw result.error;
      return result.data || [];
    },
    async clearWorkshopRatings(slug) {
      if (!state.client) throw new Error("Supabase is not configured.");
      const result = await state.client.rpc("clear_workshop_ratings", {
        p_workshop_slug: slug
      });
      if (result.error) throw result.error;
      return (result.data && result.data[0]) || { deleted_count: 0, ratings_version: null };
    }
  };

  window.AIHorizonBackend = backend;

  if (!configured || config.enableDynamicSignals === false) return;

  const fallbackFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const options = init || {};
    const rawUrl = typeof input === "string" ? input : (input && input.url) || "";
    let pathname = rawUrl;
    try { pathname = new URL(rawUrl, window.location.href).pathname; } catch (error) {}
    if (!pathname.startsWith("/api/signals")) return fallbackFetch(input, options);

    const method = String(options.method || (input && input.method) || "GET").toUpperCase();
    try {
      if (method === "GET" && pathname === "/api/signals") {
        return jsonResponse({ signals: await loadSignals() });
      }

      let body = {};
      if (options.body) body = JSON.parse(options.body);
      if (method === "POST" && pathname === "/api/signals") {
        const result = await state.client.from("signals").insert(fromSignal(body)).select().single();
        if (result.error) throw result.error;
        await loadSignals();
        return jsonResponse({ signal: toSignal(result.data) }, 201);
      }
      if (method === "POST" && pathname === "/api/signals/bulk") {
        const incoming = Array.isArray(body) ? body : body.signals;
        const result = await state.client.from("signals").upsert(asArray(incoming).map(fromSignal), { onConflict: "signal_id" }).select();
        if (result.error) throw result.error;
        await loadSignals();
        return jsonResponse({ signals: result.data.map(toSignal) }, 201);
      }
      if (method === "POST" && pathname === "/api/signals/sync") {
        const access = await state.client.rpc("is_editor");
        if (access.error) throw access.error;
        if (access.data !== true) throw new Error("Editor authentication is required to synchronize signals.");

        const incoming = asArray(Array.isArray(body) ? body : body.signals);
        if (!incoming.length) throw new Error("The Signals worksheet did not contain any records.");
        const rows = incoming.map(fromSignal);
        const incomingIds = new Set(rows.map(function (row) { return row.signal_id; }));
        if (incomingIds.size !== rows.length) throw new Error("The workbook contains duplicate Signal IDs.");

        const before = await state.client
          .from("signals")
          .select("signal_id")
          .eq("is_archived", false);
        if (before.error) throw before.error;
        const activeIds = asArray(before.data).map(function (row) { return row.signal_id; });
        const newCount = rows.filter(function (row) { return !activeIds.includes(row.signal_id); }).length;

        const upserted = await state.client
          .from("signals")
          .upsert(rows, { onConflict: "signal_id" });
        if (upserted.error) throw upserted.error;

        const archivedIds = activeIds.filter(function (signalId) { return !incomingIds.has(signalId); });
        if (archivedIds.length) {
          const archived = await state.client
            .from("signals")
            .update({ is_archived: true, updated_at: new Date().toISOString() })
            .in("signal_id", archivedIds);
          if (archived.error) throw archived.error;
        }

        const signals = await loadSignals();
        return jsonResponse({
          signals: signals,
          summary: {
            workbookCount: rows.length,
            newCount: newCount,
            updatedCount: rows.length - newCount,
            archivedCount: archivedIds.length
          }
        });
      }
      const match = pathname.match(/^\/api\/signals\/([^/]+)$/);
      if (method === "DELETE" && match) {
        const signalId = decodeURIComponent(match[1]);
        const access = await state.client.rpc("is_editor");
        if (access.error) throw access.error;
        if (access.data !== true) throw new Error("Editor authentication is required to delete signals.");
        const result = await state.client
          .from("signals")
          .update({ is_archived: true, updated_at: new Date().toISOString() })
          .eq("signal_id", signalId);
        if (result.error) throw result.error;
        await loadSignals();
        return jsonResponse({ signal: { signalId: signalId }, archived: true });
      }
      return fallbackFetch(input, options);
    } catch (error) {
      state.lastError = error;
      console.error("Dynamic database request failed", error);
      return jsonResponse({ message: error.message || "Database request failed" }, 503);
    }
  };
})();
