// Shown before anything else (campaigns included) until someone is signed in
// -- see init() in js/app.js. Rendered into the main container with the
// sidebar hidden, same as the campaign-select screen that follows it.

import { el } from "../components.js";
import { renderAccountCard } from "../accountCard.js";

export function renderLoginGate(container, onSignedIn) {
  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "Sign In"));
  container.appendChild(renderAccountCard({ onAuthenticated: onSignedIn }));
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
