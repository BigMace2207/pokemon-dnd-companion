// The title screen at fluxdev.org: "D&D Companion", PLAY, and the maker's credit with a way to the portfolio.
// Shown once per browser session (so reloading mid-game goes straight back in) before js/app.js's init() runs.
// Resolves when PLAY is pressed (or at once if it was already shown this session).

import { el } from "./components.js";

const SEEN_KEY = "pkdnd.intro.seen";

function alreadySeen() {
  try { return sessionStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
}
function markSeen() {
  try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* private mode: it just shows again next time */ }
}

export function showIntro() {
  if (alreadySeen()) return Promise.resolve();
  return new Promise((resolve) => {
    const play = el("button", { class: "intro-play", type: "button" }, "PLAY");
    const page = el("div", { class: "intro", role: "dialog", "aria-modal": "true", "aria-label": "D&D Companion" }, [
      el("div", { class: "start-bg intro-bg", "aria-hidden": "true" }, [el("i", { class: "start-stars" }), el("i", { class: "start-nebula" })]),
      el("main", { class: "intro-main" }, [
        el("h1", { class: "intro-title" }, "D&D Companion"),
        play,
      ]),
      el("p", { class: "intro-credit" }, [
        el("span", {}, "Created by Mason Allen"),
        el("a", { class: "intro-more", href: "/portfolio" }, "More from Me"),
      ]),
    ]);
    document.body.append(page);
    play.focus({ preventScroll: true });

    let done = false;
    play.addEventListener("click", () => {
      if (done) return;
      done = true;
      markSeen();
      resolve();   // the app starts loading underneath while the screen fades
      const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (calm || !page.animate) { page.remove(); return; }
      page.style.pointerEvents = "none";
      page.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "cubic-bezier(.23, 1, .32, 1)", fill: "forwards" })
        .finished.then(() => page.remove(), () => page.remove());
    });
  });
}
