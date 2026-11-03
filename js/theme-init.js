// Applies the saved theme before first paint, so there is no flash of the
// wrong theme while js/app.js's module chain is still loading. Kept as a
// separate file (not inline) so the site's Content-Security-Policy can
// forbid inline scripts. Keep the keys in sync with deviceSettings.js (THEME_KEY, LAVA_FX_KEY).
(function () {
  try {
    var t = localStorage.getItem("pokemon-dnd-forced-theme") || localStorage.getItem("pokemon-dnd-theme");   // a campaign's own theme first
    if (t === "light" || t === "dark" || t === "lava" || t === "cosmic") document.documentElement.setAttribute("data-theme", t);
    if (localStorage.getItem("pokemon-dnd-lava-fx") === "calm") document.documentElement.setAttribute("data-lava-fx", "calm");
  } catch (e) {}
})();
