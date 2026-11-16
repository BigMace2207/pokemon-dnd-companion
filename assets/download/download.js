// fluxdev.org/download: asks the server which builds exist (/api/downloads), then shows a big button for the visitor's own system
// with its version and release date, and smaller buttons for the other systems. The server hands a file out only by its exact name.
(function () {
  var NAMES = { windows: "Windows", macos: "Mac (Apple Silicon)", "macos-intel": "Mac (Intel)", linux: "Linux" };
  var ORDER = ["windows", "macos", "macos-intel", "linux"];
  var ua = navigator.userAgent;
  var mine = /Android|iPhone|iPad|iPod/.test(ua) ? "" : /Windows/.test(ua) ? "windows" : /Mac OS X|Macintosh/.test(ua) ? "macos" : /Linux|X11/.test(ua) ? "linux" : "";
  var main = mine || "windows";

  function link(f) { return "/download/files/" + encodeURIComponent(f.name); }
  function date(f) { return new Date(f.updated * 1000).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }); }

  fetch("/api/downloads")
    .then(function (r) { return r.ok ? r.json() : { files: [] }; })
    .catch(function () { return { files: [] }; })
    .then(function (res) {
      var by = {};
      (res.files || []).forEach(function (f) { by[f.platform] = f; });

      document.getElementById("title").textContent = mine ? "Download for " + (mine === "macos" ? "Mac" : NAMES[mine]) : "Download the app";
      var btn = document.getElementById("main");
      var meta = document.getElementById("meta");
      var f = by[main];
      if (f) {
        btn.href = link(f);
        btn.removeAttribute("aria-disabled");
        btn.textContent = "Download for " + NAMES[main];
        meta.textContent = "Version " + f.version + " · Released " + date(f);
      } else {
        btn.textContent = "Coming soon";
        meta.textContent = "";
      }

      var box = document.getElementById("otherBtns");
      ORDER.filter(function (p) { return p !== main; }).forEach(function (p) {
        var a = document.createElement("a");
        a.className = "dl-btn";
        if (by[p]) {
          a.href = link(by[p]);
          a.textContent = "Download for " + NAMES[p];
        } else {
          a.setAttribute("aria-disabled", "true");
          a.textContent = NAMES[p] + " · coming soon";
        }
        box.appendChild(a);
      });
      document.getElementById("others").hidden = false;
    });
})();
