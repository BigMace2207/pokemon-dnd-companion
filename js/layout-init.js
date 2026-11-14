// Picks the phone layout before first paint (no flash of the desktop layout on an iPhone). The phone layout is a
// separate copy of the interface (css/mobile.css, js/mobile/): it turns on for a touch screen that's phone-sized, by
// what the device can do (a coarse pointer and a narrow viewport), never by sniffing the browser name. Settings ->
// Appearance can force it on or off. Keep the key in sync with js/mobileMode.js.
(function () {
  var pref = "auto";
  try { pref = localStorage.getItem("pkdnd-layout") || "auto"; } catch (e) { /* storage blocked */ }
  var auto = window.matchMedia && window.matchMedia("(pointer: coarse) and (max-width: 820px)").matches;
  var phone = pref === "phone" || (pref !== "desktop" && auto);
  document.documentElement.classList.toggle("m", phone);
})();

// The graphics setting (js/gfx.js), also before first paint so the heavy effects never start on Low or Medium.
// Keep the key and default in sync with js/gfx.js.
(function () {
  var g = "medium";
  try { var v = localStorage.getItem("pkdnd-gfx"); if (v === "low" || v === "medium" || v === "high") g = v; } catch (e) { /* storage blocked */ }
  document.documentElement.setAttribute("data-gfx", g);
})();

// The interface preferences (js/uiPrefs.js: Settings -> Interface and Accessibility), applied before first paint too.
// Keep the key, the ranges and the names in step with js/uiPrefs.js.
(function () {
  var ui = {};
  try { ui = JSON.parse(localStorage.getItem("pkdnd-ui") || "{}") || {}; } catch (e) { ui = {}; }
  var root = document.documentElement, sizes = ui.sizes || {};
  Object.keys(sizes).forEach(function (id) {
    var v = Number(sizes[id]);
    if (/^[a-z]+$/.test(id) && v >= 60 && v <= 160) root.style.setProperty("--ui-" + id, String(v / 100));
  });
  var t = Number(ui.text);
  if (t >= 85 && t <= 150) root.style.setProperty("--ui-text", String(t / 100));
  var g = Number(ui.glass);
  if (g >= 20 && g < 100) { root.style.setProperty("--ui-glass", String(g / 100)); root.setAttribute("data-glass", "on"); }
  if (ui.dots === false) root.setAttribute("data-hub-dots", "off");
  if (ui.motion === "on") root.setAttribute("data-reduce-motion", "on");
  if (ui.contrast === true) root.setAttribute("data-contrast", "high");
  if (ui.focus === true) root.setAttribute("data-focus", "strong");
  // Scripts that ask "does this person want less motion?" ask matchMedia: with Reduce motion on, the answer is yes.
  var real = window.matchMedia && window.matchMedia.bind(window);
  if (real) {
    window.matchMedia = function (q) {
      if (/prefers-reduced-motion:\s*reduce/.test(String(q)) && root.getAttribute("data-reduce-motion") === "on") {
        return { matches: true, media: String(q), onchange: null, addEventListener: function () {}, removeEventListener: function () {}, addListener: function () {}, removeListener: function () {}, dispatchEvent: function () { return false; } };
      }
      return real(q);
    };
  }
})();
