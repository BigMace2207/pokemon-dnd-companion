// The "Account" card shown on the campaign-select screen and in Settings:
// sign in / create an account with email + password, optionally Google or
// Apple (those buttons only appear once the server has them configured --
// see server.py's PKDND_GOOGLE_CLIENT_ID / PKDND_APPLE_CLIENT_ID).
//
// Entirely optional: the app works exactly as before without an account.

import { el, field } from "./components.js";
import {
  getAuthConfig, fetchMe, register, login, signInWithProvider, logout, setPassword,
  mountGoogleButton, appleSignInToken,
} from "./account.js";

const PROVIDER_LABEL = { google: "Google", apple: "Apple" };

// onAuthenticated: called after a successful sign-in/up that didn't need a
// page reload (the login gate uses it to move on to the campaign list).
export function renderAccountCard({ onAuthenticated } = {}) {
  const card = el("div", { class: "card" });
  let mode = "signin"; // "signin" | "register"

  async function render() {
    card.innerHTML = "";
    card.appendChild(el("h4", {}, "Account"));
    card.appendChild(el("p", { class: "view-sub" }, "Loading…"));
    const [account, config] = await Promise.all([fetchMe(), getAuthConfig()]);
    card.innerHTML = "";
    card.appendChild(el("h4", {}, "Account"));
    if (account) renderSignedIn(account, config);
    else renderSignedOut(config);
  }

  // A successful sign-in that moved this device onto the account's identity
  // restarts the app under it; otherwise just refresh this card.
  function afterAuth(result, msg) {
    if (result.error) { msg.textContent = result.error; return false; }
    if (result.switched) location.reload();
    else if (onAuthenticated) onAuthenticated(result.account);
    else render();
    return true;
  }

  function providerButtons(config, msg, linkMode, account) {
    const wrap = el("div", { class: "auth-providers" });
    if (config.google && !(linkMode && account.providers.includes("google"))) {
      const slot = el("div", { class: "auth-google-slot" });
      wrap.appendChild(slot);
      mountGoogleButton(slot, config.google, async (credential) => {
        msg.textContent = "";
        afterAuth(await signInWithProvider("google", credential), msg);
      }).catch(() => { slot.remove(); });
    }
    if (config.apple && !(linkMode && account.providers.includes("apple"))) {
      const btn = el("button", { class: "btn secondary auth-apple" }, "Continue with Apple");
      btn.addEventListener("click", async () => {
        msg.textContent = "";
        btn.disabled = true;
        try {
          afterAuth(await signInWithProvider("apple", await appleSignInToken(config.apple)), msg);
        } catch {
          msg.textContent = "Apple sign-in was cancelled or couldn't start.";
        }
        btn.disabled = false;
      });
      wrap.appendChild(btn);
    }
    return wrap.children.length ? wrap : null;
  }

  function renderSignedOut(config) {
    const msg = el("p", { class: "view-sub auth-msg" }, "");
    const email = el("input", { type: "email", autocomplete: "email", placeholder: "you@example.com" });
    const password = el("input", { type: "password", autocomplete: mode === "register" ? "new-password" : "current-password", placeholder: mode === "register" ? "At least 8 characters" : "Password" });
    const submit = el("button", { class: "btn" }, mode === "register" ? "Create Account" : "Sign In");
    const toggle = el("button", { class: "btn secondary" }, mode === "register" ? "I already have an account" : "Create an account");

    async function go() {
      if (!email.value.trim() || !password.value) { msg.textContent = "Enter your email and password."; return; }
      submit.disabled = true;
      msg.textContent = "";
      const result = await (mode === "register" ? register : login)(email.value, password.value);
      submit.disabled = false;
      afterAuth(result, msg);
    }
    submit.addEventListener("click", go);
    password.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    email.addEventListener("keydown", (e) => { if (e.key === "Enter") password.focus(); });
    toggle.addEventListener("click", () => { mode = mode === "register" ? "signin" : "register"; render(); });

    card.appendChild(el("div", { class: "grid-2" }, [field("Email", email), field("Password", password)]));
    card.appendChild(el("div", { class: "grid-2" }, [submit, toggle]));
    const providers = providerButtons(config, msg, false);
    if (providers) {
      card.appendChild(el("div", { class: "auth-or" }, "or"));
      card.appendChild(providers);
    }
    card.appendChild(msg);
  }

  function renderSignedIn(account, config) {
    const how = account.email || `${account.providers.map((p) => PROVIDER_LABEL[p]).join(" / ")} account`;
    card.appendChild(el("p", { class: "view-sub" }, `Signed in as ${how}.`));
    const msg = el("p", { class: "view-sub auth-msg" }, "");
    const signOut = el("button", { class: "btn secondary" }, "Sign Out");
    // Reload so the app drops back to the login screen (campaigns are only
    // shown while signed in).
    signOut.addEventListener("click", async () => { await logout(); location.reload(); });
    card.appendChild(signOut);
    if (!account.hasPassword && account.email) {
      const pw = el("input", { type: "password", autocomplete: "new-password", placeholder: "At least 8 characters" });
      const addBtn = el("button", { class: "btn" }, "Add Password");
      async function addPassword() {
        addBtn.disabled = true;
        msg.textContent = "";
        const result = await setPassword(pw.value);
        addBtn.disabled = false;
        if (result.error) msg.textContent = result.error;
        else render();
      }
      addBtn.addEventListener("click", addPassword);
      pw.addEventListener("keydown", (e) => { if (e.key === "Enter") addPassword(); });
      card.appendChild(el("p", { class: "view-sub", style: "margin-top:14px" }, `Sign in with ${account.email} and a password too (needed for the desktop app):`));
      card.appendChild(el("div", { class: "grid-2" }, [field("Password", pw), addBtn]));
    }
    const providers = providerButtons(config, msg, true, account);
    if (providers) {
      card.appendChild(el("p", { class: "view-sub", style: "margin-top:14px" }, "Add another way to sign in:"));
      card.appendChild(providers);
    }
    card.appendChild(msg);
  }

  render();
  return card;
}
