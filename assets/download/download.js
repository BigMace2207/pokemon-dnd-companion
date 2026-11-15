// fluxdev.org/download: asks the server what builds exist (/api/downloads) and fills in each platform's card: the button, the
// version and size, or "coming soon". The server hands out a file only by its exact name (server.py DOWNLOAD_NAME).
(function () {
  var cards = document.querySelectorAll(".dl-card");
  var ua = navigator.userAgent;
  var mine = /Windows/.test(ua) ? "windows" : /Mac OS X|Macintosh/.test(ua) && !/iPhone|iPad/.test(ua) ? "macos" : "";

  function size(bytes) {
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(bytes >= 104857600 ? 0 : 1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
  }
  function soon(card, why) {
    card.classList.add("soon");
    card.querySelector("[data-meta]").textContent = why;
    var b = card.querySelector("[data-btn]");
    b.removeAttribute("href");
    b.setAttribute("aria-disabled", "true");
    b.textContent = "Coming soon";
  }
  function ready(card, f) {
    card.classList.remove("soon");
    var when = new Date(f.updated * 1000).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
    card.querySelector("[data-meta]").textContent = "Version " + f.version + " · " + size(f.size) + " · " + when;
    var b = card.querySelector("[data-btn]");
    b.href = "/download/files/" + encodeURIComponent(f.name);
    b.setAttribute("download", f.name);
    b.removeAttribute("aria-disabled");
  }

  cards.forEach(function (c) { if (c.dataset.platform === mine) c.classList.add("you"); });
  fetch("/api/downloads")
    .then(function (r) { return r.ok ? r.json() : { files: [] }; })
    .catch(function () { return { files: [] }; })
    .then(function (res) {
      var by = {};
      (res.files || []).forEach(function (f) { by[f.platform] = f; });
      cards.forEach(function (c) {
        var f = by[c.dataset.platform];
        if (f) ready(c, f); else soon(c, c.dataset.platform === "macos" ? "A Mac build is on its way." : "Not available just yet.");
      });
    });
})();
