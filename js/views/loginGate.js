// Shown before anything else (campaigns included) until someone is signed in
// -- see init() in js/app.js. Rendered into the main container with the
// sidebar hidden, same as the campaign-select screen that follows it.

import { el } from "../components.js";
import { renderAccountCard } from "../accountCard.js";
import { rayquazaConstellation } from "../constellation.js";

// The sign-in page is in the cosmic theme whatever this device's theme is: deep space, Rayquaza's constellation above a
// glass card. It's only shown on the page (never saved), so the device's own theme comes back once a campaign opens.
export function renderLoginGate(container, onSignedIn) {
  container.innerHTML = "";
  document.documentElement.setAttribute("data-theme", "cosmic");
  const page = el("div", { class: "login-page" }, [
    rayquazaConstellation("login-constellation"),
    el("p", { class: "login-eyebrow" }, "Pokémon D&D Companion"),
    el("h1", { class: "login-title" }, "Sign in"),
    el("p", { class: "login-sub" }, "Your trainers, teams and campaigns, on every device you sign in on."),
    renderAccountCard({ onAuthenticated: onSignedIn }),
  ]);
  container.appendChild(page);
}

// The server couldn't be reached to check the session -- don't pretend the
// person is signed out; offer a retry instead.
export function renderServerUnreachable(container, retry) {
  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "Can't Reach the Server"));
  const btn = el("button", { class: "btn" }, "Try Again");
  btn.addEventListener("click", retry);
  container.appendChild(el("div", { class: "card" }, [
    el("p", { class: "view-sub" }, "Check your connection, then try again."),
    btn,
  ]));
}
