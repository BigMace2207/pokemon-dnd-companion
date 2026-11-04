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
