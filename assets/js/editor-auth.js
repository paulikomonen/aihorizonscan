(function () {
  "use strict";
  const backend = window.AIHorizonBackend;
  if (!backend || !backend.state.configured || !backend.client) return;
  const client = backend.client;
  const unlockKey = "__aihorizon_admin_unlocked_v1";
  let processing = false;
  let verificationRetry = null;
  let missingSessionRetries = 0;

  function onUpdatePage() {
    return (window.location.hash || "").includes("/update");
  }

  function clearLocalEditorAccess() {
    try { sessionStorage.removeItem(unlockKey); } catch (error) {}
  }

  async function permanentSession() {
    let result = await client.auth.getSession();
    if (result.error) throw result.error;
    let session = result.data && result.data.session;
    if (session && session.expires_at && Number(session.expires_at) <= Math.floor(Date.now() / 1000) + 60) {
      result = await client.auth.refreshSession();
      if (result.error) throw result.error;
      session = result.data && result.data.session;
    }
    const user = session && session.user;
    if (!user || user.is_anonymous) return null;
    const access = await client.rpc("is_editor");
    if (access.error) throw access.error;
    if (access.data !== true) return null;
    return session;
  }

  function unlockEditor() {
    try { sessionStorage.setItem(unlockKey, "unlocked"); } catch (error) {}
  }

  function renderEditorStatus(session) {
    if (!onUpdatePage() || !session || document.getElementById("aih-editor-session")) return;
    const heading = Array.from(document.querySelectorAll("h1, h2")).find(function (item) {
      const title = String(item.textContent || "").trim().toLowerCase();
      return title === "editor workspace" || title === "update tracker";
    });
    if (!heading) return;
    const header = heading.closest("header") || heading.parentElement;
    const bar = document.createElement("div");
    bar.id = "aih-editor-session";
    bar.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px;padding:8px 10px;border:1px solid hsl(var(--border));border-radius:10px;background:hsl(var(--card));font-size:12px;color:hsl(var(--muted-foreground))";
    bar.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#2a9d62;box-shadow:0 0 0 4px rgba(42,157,98,.12)"></span><span>Editor signed in as <strong style="color:hsl(var(--foreground))"></strong></span><button type="button" id="aih-editor-signout" style="margin-left:auto;border:1px solid hsl(var(--border));border-radius:8px;padding:5px 8px;background:hsl(var(--background));color:hsl(var(--foreground));font-weight:650;cursor:pointer">Log out</button>';
    bar.querySelector("strong").textContent = session.user.email || "approved editor";
    header.appendChild(bar);
    bar.querySelector("#aih-editor-signout").addEventListener("click", async function () {
      if (processing) return;
      processing = true;
      this.disabled = true;
      this.textContent = "Logging out…";
      clearLocalEditorAccess();
      try {
        const result = await client.auth.signOut();
        if (result && result.error) throw result.error;
        window.location.reload();
      } catch (error) {
        processing = false;
        this.disabled = false;
        this.textContent = "Log out";
        this.title = error.message || "Log out failed. Please try again.";
      }
    });
  }

  async function renderEditorLogin() {
    if (!onUpdatePage() || processing) return;
    let session = null;
    try {
      session = await permanentSession();
      clearTimeout(verificationRetry);
    } catch (error) {
      // A temporary refresh or network failure must not discard an otherwise
      // valid editor session or force the user back through the sign-in form.
      console.warn("Editor session verification will be retried", error);
      clearTimeout(verificationRetry);
      verificationRetry = setTimeout(renderEditorLogin, 1500);
      return;
    }
    const legacyInput = document.querySelector('[data-testid="input-admin-password"]');

    if (session) {
      missingSessionRetries = 0;
      unlockEditor();
      renderEditorStatus(session);
      if (legacyInput) window.location.reload();
      return;
    }

    // A browser-only unlock marker must never outlive the Supabase session.
    let hadUnlock = false;
    try { hadUnlock = sessionStorage.getItem(unlockKey) === "unlocked"; } catch (error) {}
    if (hadUnlock) {
      if (window.__aihorizon_persisted_editor_session && missingSessionRetries < 4) {
        missingSessionRetries += 1;
        clearTimeout(verificationRetry);
        verificationRetry = setTimeout(renderEditorLogin, 750);
        return;
      }
      clearLocalEditorAccess();
      if (!legacyInput) {
        window.location.reload();
        return;
      }
    }

    if (!legacyInput) return;
    const card = legacyInput.closest(".w-full.max-w-md") || legacyInput.parentElement;
    if (!card || card.dataset.editorAuth === "ready") return;
    card.dataset.editorAuth = "ready";
    card.innerHTML = `
      <div style="padding:24px" class="space-y-4">
        <div>
          <div class="text-xs uppercase tracking-wider text-muted-foreground">Secure editor access</div>
          <h2 class="text-xl font-semibold" style="margin-top:6px">Sign in to update signals</h2>
          <p class="text-sm text-muted-foreground" style="margin-top:7px">Use the email address and password configured for your approved Supabase editor account.</p>
        </div>
        <form id="aih-editor-form" class="space-y-3">
          <input id="aih-editor-email" type="email" required autocomplete="username" placeholder="name@organisation.fi" class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          <input id="aih-editor-password" type="password" required autocomplete="current-password" placeholder="Password" class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          <button type="submit" class="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Sign in</button>
        </form>
        <div id="aih-editor-message" class="text-xs text-muted-foreground" aria-live="polite"></div>
        <p class="text-xs text-muted-foreground">Workshop participants do not need an editor account.</p>
      </div>`;

    card.querySelector("#aih-editor-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      const email = card.querySelector("#aih-editor-email").value.trim().toLowerCase();
      const password = card.querySelector("#aih-editor-password").value;
      const message = card.querySelector("#aih-editor-message");
      const button = card.querySelector('button[type="submit"]');
      processing = true;
      button.disabled = true;
      button.textContent = "Signing in…";
      message.textContent = "Checking editor credentials…";
      try {
        const current = await client.auth.getSession();
        if (current.data.session && current.data.session.user && current.data.session.user.is_anonymous) await client.auth.signOut();
        const result = await client.auth.signInWithPassword({ email: email, password: password });
        if (result.error) throw result.error;
        const access = await client.rpc("is_editor");
        if (access.error) throw access.error;
        if (access.data !== true) {
          await client.auth.signOut();
          throw new Error("This account is valid but is not on the editor allow-list.");
        }
        unlockEditor();
        message.textContent = "Editor access confirmed. Opening the Editor workspace…";
        window.location.reload();
      } catch (error) {
        clearLocalEditorAccess();
        message.textContent = error.message || "The email or password was not accepted.";
        processing = false;
        button.disabled = false;
        button.textContent = "Sign in";
      }
    });
  }

  client.auth.onAuthStateChange(function (event, session) {
    if (processing) return;
    if (event === "SIGNED_OUT") {
      clearLocalEditorAccess();
      if (onUpdatePage()) setTimeout(function () { window.location.reload(); }, 50);
      return;
    }
    if (!session) {
      clearLocalEditorAccess();
      return;
    }
    if (session.user && !session.user.is_anonymous) {
      setTimeout(function () {
        permanentSession().then(function (approvedSession) {
          if (!approvedSession) return;
          unlockEditor();
          if (document.querySelector('[data-testid="input-admin-password"]')) window.location.reload();
          else renderEditorStatus(approvedSession);
        }).catch(function (error) {
          console.warn("Editor session verification will be retried", error);
          clearTimeout(verificationRetry);
          verificationRetry = setTimeout(renderEditorLogin, 1500);
        });
      }, 0);
    }
  });
  window.addEventListener("hashchange", function () { setTimeout(renderEditorLogin, 100); });
  new MutationObserver(function () { setTimeout(renderEditorLogin, 80); }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderEditorLogin); else renderEditorLogin();
})();
