// Optional account sign-in (see server.py's "Accounts" section). An account
// carries a player's identity -- their networkId, which campaign membership
// and the server-side player save are keyed on -- to a new device or a new
// site address. Playing without an account still works exactly as before.
//
// The session token lives in localStorage; it's sent only to /api/auth/*.

import { loadSave, switchNetworkId } from "./storage.js";
import { getSessionToken as readToken, setSessionToken as writeToken } from "./session.js";

async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = readToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON error page */ }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Couldn't reach the server — check your connection." } };
  }
}

export async function getAuthConfig() {
  const { ok, data } = await api("GET", "/api/auth/config");
  return ok ? data : { google: null, apple: null };
}

// Gate check at startup: { signedIn: true, account }, { signedIn: false }
// (no session, or one the server rejected -- cleared here), or
// { offline: true } when the server couldn't be reached at all, so a brief
// outage doesn't look like being signed out.
export async function checkSession() {
  if (!readToken()) return { signedIn: false };
  const { ok, status, data } = await api("GET", "/api/auth/me");
  if (ok) return { signedIn: true, account: data.account };
  if (status === 401) { writeToken(null); return { signedIn: false }; }
  return { offline: true };
}

// The signed-in account, or null (also clears a token the server no longer
// recognises, e.g. an expired session).
export async function fetchMe() {
  if (!readToken()) return null;
  const { ok, status, data } = await api("GET", "/api/auth/me");
  if (ok) return data.account;
  if (status === 401) writeToken(null);
  return null;
}

// Every sign-in/up call resolves to { account } or { error }. On success the
// token is stored and, if the account's identity differs from this device's,
// the device is switched onto it (safely -- see storage.js's
// switchNetworkId) and `switched` is true: the caller should reload the page
// so the whole app restarts under the new identity.
async function finish(result) {
  if (!result.ok) return { error: result.data?.error || "Something went wrong — try again." };
  writeToken(result.data.token);
  const switched = switchNetworkId(result.data.account.networkId);
  return { account: result.data.account, switched };
}

const device = () => ({ networkId: loadSave().networkId });

export async function register(email, password) {
  return finish(await api("POST", "/api/auth/register", { email, password, ...device() }));
}

export async function login(email, password) {
  return finish(await api("POST", "/api/auth/login", { email, password, ...device() }));
}

// provider: "google" | "apple"; credential: the provider's ID token. While
// signed in this links the provider to the current account instead.
export async function signInWithProvider(provider, credential) {
  return finish(await api("POST", `/api/auth/${provider}`, { credential, ...device() }));
}

// For a Google/Apple-created account with no password yet: lets it sign in
// with email + password too (e.g. in the desktop app, where Google's popup
// doesn't work). Resolves to { account } or { error }.
export async function setPassword(password) {
  const { ok, data } = await api("POST", "/api/auth/set-password", { password });
  return ok ? { account: data.account } : { error: data?.error || "Something went wrong — try again." };
}

export async function logout() {
  await api("POST", "/api/auth/logout", {});
  writeToken(null);
}

// ---- Provider SDKs (loaded only when the server has them configured) ----

const loaded = {};
function loadScript(src) {
  loaded[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("couldn't load " + src));
    document.head.appendChild(s);
  });
  return loaded[src];
}

// Renders Google's own button into `container`; onCredential(idToken) fires
// after the person picks an account.
export async function mountGoogleButton(container, clientId, onCredential) {
  await loadScript("https://accounts.google.com/gsi/client");
  window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => onCredential(r.credential) });
  window.google.accounts.id.renderButton(container, { theme: "filled_black", size: "large", text: "continue_with", shape: "rectangular" });
}

// Returns an Apple ID token via Apple's popup flow. Needs a Services ID whose
// registered return URL matches this site's address.
export async function appleSignInToken(clientId) {
  await loadScript("https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js");
  window.AppleID.auth.init({ clientId, scope: "name email", redirectURI: location.origin + "/", usePopup: true });
  const result = await window.AppleID.auth.signIn();
  return result.authorization.id_token;
}
