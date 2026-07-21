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
      innovationStages: asArray(row.innovation_stages),
      innovationImpact: row.innovation_impact,
      source: row.source,
      evidenceType: row.evidence_type,
      origin: row.origin || "database"
    };
  }

  function fromSignal(signal) {
    const stages = Array.isArray(signal.innovationStages)
      ? signal.innovationStages
      : String(signal.innovationStages || "")
          .split(/[;,]/)
          .map(function (item) { return item.trim(); })
          .filter(Boolean);
    return {
      signal_id: String(signal.signalId || ""),
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
      origin: signal.origin || "database"
    };
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
    async getWorkshop(slug) {
      if (!state.client) return null;
      const result = await state.client
        .from("workshops")
        .select("id, slug, title, status, opens_at, closes_at")
        .eq("slug", slug)
        .maybeSingle();
      if (result.error) throw result.error;
      return result.data;
    },
    async saveRating(workshopId, signalId, rating) {
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
        const result = await state.client
          .from("signals")
          .select("*")
          .eq("is_archived", false)
          .order("signal_date", { ascending: false });
        if (result.error) throw result.error;
        if (!result.data || result.data.length === 0) return fallbackFetch(input, options);
        return jsonResponse({ signals: result.data.map(toSignal) });
      }

      let body = {};
      if (options.body) body = JSON.parse(options.body);
      if (method === "POST" && pathname === "/api/signals") {
        const result = await state.client.from("signals").insert(fromSignal(body)).select().single();
        if (result.error) throw result.error;
        return jsonResponse({ signal: toSignal(result.data) }, 201);
      }
      if (method === "POST" && pathname === "/api/signals/bulk") {
        const incoming = Array.isArray(body) ? body : body.signals;
        const result = await state.client.from("signals").upsert(asArray(incoming).map(fromSignal), { onConflict: "signal_id" }).select();
        if (result.error) throw result.error;
        return jsonResponse({ signals: result.data.map(toSignal) }, 201);
      }
      const match = pathname.match(/^\/api\/signals\/([^/]+)$/);
      if (method === "DELETE" && match) {
        const signalId = decodeURIComponent(match[1]);
        const result = await state.client
          .from("signals")
          .update({ is_archived: true, updated_at: new Date().toISOString() })
          .eq("signal_id", signalId)
          .select()
          .single();
        if (result.error) throw result.error;
        return jsonResponse({ signal: toSignal(result.data) });
      }
      return fallbackFetch(input, options);
    } catch (error) {
      state.lastError = error;
      console.error("Dynamic database request failed", error);
      return jsonResponse({ message: error.message || "Database request failed" }, 503);
    }
  };
})();
