// Applies the saved theme before first paint, so there is no flash of the
// wrong theme while js/app.js's module chain is still loading. Kept as a
// separate file (not inline) so the site's Content-Security-Policy can
// forbid inline scripts. Keep the key in sync with deviceSettings.js's THEME_KEY.
(function () {
  try {
    var t = localStorage.getItem("pokemon-dnd-theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
