/**
 * auth.js — Authentication via Appwrite Account API
 *
 * Uses Appwrite for register / login / logout / session.
 * Falls back to localStorage only for per-user data keys (liked, queue, etc.)
 * so existing user data is preserved after migration.
 */

const Auth = (() => {
  const SESSION_KEY = "openmusic_session";

  // ── Helpers ─────────────────────────────────────────────────────────────

  function getAccount() {
    if (!window.AppwriteAccount) {
      throw new Error("Appwrite SDK not initialised yet.");
    }
    return window.AppwriteAccount;
  }

  function displayName(user) {
    return user.name || user.email?.split("@")[0] || "listener";
  }

  /** Cache session locally so sync calls (requireAuth, getSession) work. */
  function cacheSession(user) {
    const session = {
      id:       user.$id,
      nickname: user.name || displayName(user),
      email:    user.email,
      at:       Date.now(),
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function clearCache() {
    localStorage.removeItem(SESSION_KEY);
  }

  // ── Public async API ─────────────────────────────────────────────────────

  async function register({ nickname, email, password }) {
    try {
      const account = getAccount();
      // Create Appwrite account (name = nickname)
      const user = await account.create("unique()", email, password, nickname || email.split("@")[0]);
      // Auto login after register
      await account.createEmailPasswordSession(email, password);
      const me = await account.get();
      return { ok: true, session: cacheSession(me) };
    } catch (e) {
      return { ok: false, error: e.message || "Registration failed." };
    }
  }

  async function login({ email, password }) {
    try {
      const account = getAccount();
      await account.createEmailPasswordSession(email, password);
      const me = await account.get();
      return { ok: true, session: cacheSession(me) };
    } catch (e) {
      return { ok: false, error: "Invalid email or password." };
    }
  }

  async function logout() {
    try {
      const account = getAccount();
      await account.deleteSession("current");
    } catch (_) {
      // already logged out or network error — continue anyway
    }
    clearCache();
    window.location.href = "index.html";
  }

  /** Check Appwrite for a live session; update local cache if found. */
  async function refreshSession() {
    try {
      const account = getAccount();
      const me = await account.get();
      return cacheSession(me);
    } catch (_) {
      // Don't clear cache or logout here — the local session cache is still valid.
      // Appwrite session cookies may not persist across hard reloads in some
      // browser/CORS configurations. We keep the user logged in via localStorage.
      return getSession();
    }
  }

  // ── Sync helpers (use cached data) ───────────────────────────────────────

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      // compat: old key used "name" not "nickname"
      if (s.name && !s.nickname) s.nickname = s.name;
      return s;
    } catch {
      return null;
    }
  }

  function requireAuth() {
    const session = getSession();
    if (!session) {
      window.location.href = "index.html";
      return null;
    }
    return session;
  }

  function userDataKey(suffix) {
    const session = getSession();
    if (!session) return null;
    return `openmusic_${session.id}_${suffix}`;
  }

  // ── Update account details ───────────────────────────────────────────────

  async function updateName(name) {
    try {
      const account = getAccount();
      const me = await account.updateName(name);
      return { ok: true, session: cacheSession(me) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function updateEmail(email, password) {
    try {
      const account = getAccount();
      const me = await account.updateEmail(email, password);
      return { ok: true, session: cacheSession(me) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function updatePassword(newPassword, oldPassword) {
    try {
      const account = getAccount();
      await account.updatePassword(newPassword, oldPassword);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function deleteAccount() {
    try {
      // Appwrite doesn't expose a client-side delete — delete session instead
      // and wipe local data
      await logout();
    } catch (_) {
      clearCache();
      window.location.href = "index.html";
    }
  }

  // ── Login page init ───────────────────────────────────────────────────────

  function initLoginPage() {
    // If locally cached session exists, try Appwrite — redirect if valid.
    // If Appwrite fails but local cache exists, still redirect (offline-tolerant).
    const local = getSession();
    if (local) {
      refreshSession().then(s => {
        if (s) window.location.href = "dashboard.html";
        // If refreshSession returned null (no local either), stay on login page
      });
      return;
    }

    const loginForm    = document.getElementById("login-form");
    const registerForm = document.getElementById("register-form");
    const tabs         = document.querySelectorAll(".auth-tab");
    const authError    = document.getElementById("auth-error");
    const registerError = document.getElementById("register-error");

    // Tab switching
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => {
          t.classList.toggle("active", t === tab);
          t.setAttribute("aria-selected", t === tab ? "true" : "false");
        });
        const isLogin = tab.dataset.tab === "login";
        loginForm.classList.toggle("hidden", !isLogin);
        registerForm.classList.toggle("hidden", isLogin);
        authError.hidden = true;
        registerError.hidden = true;
      });
    });

    // Sign in
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      authError.hidden = true;
      setFormLoading(loginForm, true);
      const fd = new FormData(loginForm);
      const result = await login({ email: fd.get("email"), password: fd.get("password") });
      setFormLoading(loginForm, false);
      if (!result.ok) {
        authError.textContent = result.error;
        authError.hidden = false;
        return;
      }
      window.location.href = "dashboard.html";
    });

    // Register
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      registerError.hidden = true;
      setFormLoading(registerForm, true);
      const fd = new FormData(registerForm);
      const result = await register({
        nickname: fd.get("nickname"),
        email:    fd.get("email"),
        password: fd.get("password"),
      });
      setFormLoading(registerForm, false);
      if (!result.ok) {
        registerError.textContent = result.error;
        registerError.hidden = false;
        return;
      }
      window.location.href = "dashboard.html";
    });
  }

  function setFormLoading(form, loading) {
    const btn = form.querySelector("button[type=submit]");
    if (!btn) return;
    btn.disabled = loading;
    btn.style.opacity = loading ? "0.6" : "";
    btn.style.cursor  = loading ? "wait" : "";
  }

  // ── Exports ──────────────────────────────────────────────────────────────

  return {
    initLoginPage,
    requireAuth,
    getSession,
    refreshSession,
    logout,
    userDataKey,
    updateName,
    updateEmail,
    updatePassword,
    deleteAccount,
  };
})();
