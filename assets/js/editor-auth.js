(function () {
  "use strict";
  const backend = window.AIHorizonBackend;
  if (!backend || !backend.state.configured || !backend.client) return;
  const client = backend.client;
  let processing = false;

  async function permanentSession() {
    const result = await client.auth.getSession();
    const user = result.data && result.data.session && result.data.session.user;
    if (!user || user.is_anonymous) return null;
    const access = await client.rpc("is_editor");
    if (access.error || access.data !== true) return null;
    return result.data.session;
  }

  async function unlockIfEditor() {
    const session = await permanentSession();
    if (!session) return false;
    try { sessionStorage.setItem("__aihorizon_admin_unlocked_v1", "unlocked"); } catch (error) {}
    return true;
  }

  async function renderEditorLogin() {
    if (!(window.location.hash || "").includes("/update") || processing) return;
    if (await unlockIfEditor()) {
      if (document.querySelector('[data-testid="input-admin-password"]')) window.location.reload();
      return;
    }
    const legacyInput = document.querySelector('[data-testid="input-admin-password"]');
    if (!legacyInput) return;
    const card = legacyInput.closest(".w-full.max-w-md") || legacyInput.parentElement;
    if (!card || card.dataset.editorAuth === "ready") return;
    card.dataset.editorAuth = "ready";
    card.innerHTML = `
      <div style="padding:24px" class="space-y-4">
        <div>
          <div class="text-xs uppercase tracking-wider text-muted-foreground">Secure editor access</div>
          <h2 class="text-xl font-semibold" style="margin-top:6px">Sign in to update signals</h2>
          <p class="text-sm text-muted-foreground" style="margin-top:7px">Enter an allow-listed editor email address. Supabase will send a passwordless sign-in link.</p>
        </div>
        <form id="aih-editor-form" class="space-y-3">
          <input id="aih-editor-email" type="email" required autocomplete="email" placeholder="name@organisation.fi" class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          <button type="submit" class="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Send sign-in link</button>
        </form>
        <div id="aih-editor-message" class="text-xs text-muted-foreground"></div>
        <p class="text-xs text-muted-foreground">Workshop participants do not need an editor account.</p>
      </div>`;
    card.querySelector("#aih-editor-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      const email = card.querySelector("#aih-editor-email").value.trim();
      const message = card.querySelector("#aih-editor-message");
      processing = true;
      message.textContent = "Sending sign-in link…";
      try {
        const current = await client.auth.getSession();
        if (current.data.session && current.data.session.user && current.data.session.user.is_anonymous) await client.auth.signOut();
        // Supabase may place authentication tokens in the URL fragment. The
        // application also uses that fragment for routing, so returning
        // directly to #/update can make the router interpret auth parameters
        // as an unknown page. Complete authentication on a dedicated static
        // callback page first, then continue to the Update tracker.
        const redirect = new URL("./auth-callback.html", window.location.href).href;
        const result = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
        if (result.error) throw result.error;
        message.textContent = "Check your email and open the sign-in link in this browser. Access is granted only to allow-listed editors.";
      } catch (error) {
        message.textContent = error.message || "The sign-in link could not be sent.";
      } finally {
        processing = false;
      }
    });
  }

  client.auth.onAuthStateChange(function (_event, session) {
    if (session && session.user && !session.user.is_anonymous) unlockIfEditor().then(function (allowed) {
      if (allowed && (window.location.hash || "").includes("/update")) setTimeout(function () { window.location.reload(); }, 50);
    });
  });
  window.addEventListener("hashchange", function () { setTimeout(renderEditorLogin, 100); });
  new MutationObserver(function () { setTimeout(renderEditorLogin, 80); }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderEditorLogin); else renderEditorLogin();
})();
