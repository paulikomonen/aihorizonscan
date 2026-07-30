(function () {
  "use strict";

  const unlockKey = "__aihorizon_admin_unlocked_v1";
  const config = window.AIHORIZON_CONFIG || {};

  function projectRef() {
    try {
      return new URL(config.supabaseUrl).hostname.split(".")[0] || "";
    } catch (error) {
      return "";
    }
  }

  function persistedSession() {
    const ref = projectRef();
    if (!ref) return null;
    try {
      const stored = JSON.parse(localStorage.getItem("sb-" + ref + "-auth-token") || "null");
      if (!stored) return null;
      if (stored.user) return stored;
      if (stored.currentSession && stored.currentSession.user) return stored.currentSession;
      return null;
    } catch (error) {
      return null;
    }
  }

  const session = persistedSession();
  const user = session && session.user;
  if (user && !user.is_anonymous && user.email && session.refresh_token) {
    try {
      // This marker only controls the initial UI. Supabase RLS and the
      // server-side editor check remain authoritative for every write.
      sessionStorage.setItem(unlockKey, "unlocked");
      window.__aihorizon_persisted_editor_session = true;
    } catch (error) {}
  }
})();
