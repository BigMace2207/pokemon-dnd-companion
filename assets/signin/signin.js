// fluxdev.org/app-signin?code=...: the browser half of signing in to the desktop app with Google (see server.py's APP_LINKS).
// Sign in here as on the website (Google works in a real browser), then tell the server the app's code belongs to this account;
// the app, waiting in its own window, collects it.
import { checkSession, getAuthConfig, mountGoogleButton, signInWithProvider } from "/js/account.js";
import { getSessionToken } from "/js/session.js";

const code = new URLSearchParams(location.search).get("code") || "";
const $ = (id) => document.getElementById(id);
const say = (text, bad = false) => { $("msg").textContent = text; $("msg").classList.toggle("bad", bad); };

async function complete() {
  say("Connecting the app…");
  const res = await fetch("/api/auth/app-link-complete", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getSessionToken()}` },
    body: JSON.stringify({ code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return say(data.error || "Couldn't connect the app. Start again from the app.", true);
  $("box").replaceChildren();
  $("go").hidden = true;
  $("title").textContent = "You're signed in";
  say("You can close this tab and go back to the app.");
}

async function main() {
  if (!code) return say("This page opens from the app's Continue with Google button.", true);
  const account = await checkSession();
  if (account) {
    $("title").textContent = "Continue as " + (account.email || "your account");
    $("go").hidden = false;
    $("go").addEventListener("click", complete);
    $("go").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); complete(); } });
    return;
  }
  const config = await getAuthConfig();
  if (!config?.google) return say("Google sign-in isn't available right now.", true);
  await mountGoogleButton($("box"), config.google, async (credential) => {
    const result = await signInWithProvider("google", credential);
    if (result.error) return say(result.error, true);
    if (result.needCode) return say("This account needs an emailed code: sign in on the website once, then try again.", true);
    complete();
  });
}
main().catch(() => say("Something went wrong. Try again.", true));
