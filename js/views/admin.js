// Admin console: only appears in the sidebar for an admin account, and the server answers its requests only for one
// (server.py "Admin console"). Every account with its permissions as switches, storage and disk use, whether login
// emails are set up, every campaign, and a small command line (grant / revoke / perms / signout / who / help).

import { el } from "../components.js";
import { adminOverview, adminSetPerm, adminCommand, adminCampaign } from "../network.js";

const KB = 1024, MB = KB * 1024, GB = MB * 1024;
const trim = (x) => String(Number(x.toFixed(1)));
const fmtBytes = (n) => (n >= GB ? `${trim(n / GB)} GB` : n >= MB ? `${trim(n / MB)} MB` : n >= KB ? `${Math.round(n / KB)} KB` : `${n || 0} B`);
const ago = (t) => {
  if (!t) return "never";
  const s = Date.now() / 1000 - t;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const PERM_LABEL = { admin: "Admin", cloudLibrary: "Cloud PDFs", unlimitedMaps: "Unlimited maps" };

// Staggered entrance on first draw only (the page never animates on a refresh).
const rise = (node, i) => { node.classList.add("adm-rise"); node.style.setProperty("--i", String(i)); return node; };

export function renderAdmin(container) {
  container.replaceChildren();
  const root = el("div", { class: "adm" });
  container.append(root);
  let data = null, filter = "", first = true;
  const history = [];
  let histAt = 0;

  const head = el("header", { class: "adm-head" }, [
    el("div", {}, [el("p", { class: "adm-eyebrow" }, "Owner tools"), el("h1", { class: "adm-title" }, "Admin console"),
      el("p", { class: "adm-sub" }, "Accounts, permissions and storage for the whole site. Only you can see this page.")]),
  ]);
  const tiles = el("div", { class: "adm-tiles" });
  const accountsCard = el("section", { class: "adm-card" });
  const consoleCard = el("section", { class: "adm-card adm-console-card" });
  const campaignsCard = el("section", { class: "adm-card" });
  const archivedCard = el("section", { class: "adm-card" });
  const dialog = el("div", { class: "adm-dialog", role: "dialog", "aria-modal": "true", hidden: "" });
  root.append(head, tiles, el("div", { class: "adm-split" }, [accountsCard, consoleCard]), campaignsCard, archivedCard, dialog);

  // Deleting a campaign asks you to type its name, so a stray click can't take a table away from its players.
  function confirmDelete(c) {
    const name = (c.name || "Untitled").trim();
    const input = el("input", { class: "adm-search", type: "text", placeholder: name, "aria-label": "Type the campaign's name to confirm" });
    const go = el("button", { type: "button", class: "adm-danger" }, "Delete campaign");
    const cancel = el("button", { type: "button", class: "adm-chip ghost" }, "Cancel");
    go.disabled = true;
    input.addEventListener("input", () => { go.disabled = input.value.trim() !== name; });
    const close = () => { dialog.classList.remove("open"); setTimeout(() => { dialog.hidden = true; }, 200); };
    cancel.addEventListener("click", close);
    dialog.onclick = (e) => { if (e.target === dialog) close(); };
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); if (e.key === "Enter" && !go.disabled) go.click(); });
    go.addEventListener("click", async () => {
      go.disabled = true;
      const res = await adminCampaign(c.id, "archive");
      close();
      if (!res) { print("Couldn't reach the server.", "bad"); return; }
      print(res.message);
      data = res.overview; draw();
    });
    dialog.replaceChildren(el("div", { class: "adm-dialog-card" }, [
      el("h2", {}, `Delete "${name}"?`),
      el("p", { class: "adm-note" }, `Its ${c.members} member${c.members === 1 ? " loses" : "s lose"} access straight away and it leaves everyone's campaign list. Nothing is erased: it moves to Deleted campaigns, where you can restore it exactly as it was.`),
      el("label", { class: "adm-note" }, ["Type the campaign's name to confirm", input]),
      el("div", { class: "adm-quick end" }, [cancel, go]),
    ]));
    dialog.hidden = false;
    requestAnimationFrame(() => dialog.classList.add("open"));
    setTimeout(() => input.focus(), 50);
  }

  // ------------------------------------------------------------ console
  const out = el("pre", { class: "adm-out", "aria-live": "polite" });
  const input = el("input", { class: "adm-input", type: "text", spellcheck: "false", autocomplete: "off", placeholder: "grant someone@example.com cloudLibrary", "aria-label": "Admin command" });
  const print = (text, kind = "") => { out.append(el("span", { class: `adm-line ${kind}` }, text + "\n")); out.scrollTop = out.scrollHeight; };
  async function run(text) {
    if (!text.trim()) return;
    history.push(text); histAt = history.length;
    print(`› ${text}`, "cmd");
    const res = await adminCommand(text);
    if (!res) { print("Couldn't reach the server.", "bad"); return; }
    print(res.output);
    if (res.overview) { data = res.overview; draw(); }
  }
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const t = input.value; input.value = ""; run(t); }
    else if (e.key === "ArrowUp" && history.length) { histAt = Math.max(0, histAt - 1); input.value = history[histAt] || ""; e.preventDefault(); }
    else if (e.key === "ArrowDown" && history.length) { histAt = Math.min(history.length, histAt + 1); input.value = history[histAt] || ""; e.preventDefault(); }
  });
  const quick = el("div", { class: "adm-quick" }, ["help", "who"].map((c) => {
    const b = el("button", { type: "button", class: "adm-chip" }, c);
    b.addEventListener("click", () => run(c));
    return b;
  }));
  consoleCard.append(
    el("div", { class: "adm-card-head" }, [el("h2", {}, "Command line"), quick]),
    out, el("label", { class: "adm-prompt" }, [el("span", { "aria-hidden": "true" }, "›"), input]),
  );
  print("Type help for the commands, or flip the switches beside each account.", "muted");

  // ------------------------------------------------------------ drawing
  function tile(label, value, note) {
    return el("div", { class: "adm-tile" }, [el("span", { class: "adm-tile-label" }, label), el("strong", { class: "adm-tile-value" }, value), note ? el("span", { class: "adm-tile-note" }, note) : null].filter(Boolean));
  }

  function actionButton(label, cls, aria, fn) {
    const b = el("button", { type: "button", class: cls, "aria-label": aria }, label);
    b.addEventListener("click", () => fn(b));
    return b;
  }

  function permSwitch(acc, perm) {
    const on = acc.perms[perm];
    const locked = perm === "admin" && acc.envAdmin;   // from the server settings, not the console
    const inherited = on && !acc.granted[perm] && !locked && acc.perms.admin && perm !== "admin";
    const b = el("button", {
      type: "button", role: "switch", "aria-checked": String(on), class: `adm-switch${on ? " on" : ""}${inherited || locked ? " soft" : ""}`,
      title: locked ? "Admin from the server settings" : inherited ? "Included with admin" : `${on ? "Remove" : "Give"} ${PERM_LABEL[perm]}`,
      "aria-label": `${PERM_LABEL[perm]} for ${acc.email || acc.id}`,
    }, el("span", { class: "adm-knob" }));
    b.disabled = locked || inherited;
    b.addEventListener("click", async () => {
      b.disabled = true;
      const res = await adminSetPerm(acc.id, perm, !on);
      if (!res) { print("Couldn't reach the server.", "bad"); b.disabled = false; return; }
      print(res.message);
      data = res.overview; draw();
    });
    return b;
  }

  function draw() {
    if (!data) return;
    const s = data.storage, online = data.campaigns.reduce((n, c) => n + c.online, 0);
    tiles.replaceChildren(...[
      tile("Accounts", String(data.accounts.length), `${data.accounts.filter((a) => a.emailVerified).length} confirmed emails`),
      tile("Campaigns", String(data.campaigns.length), `${online} player${online === 1 ? "" : "s"} online now`),
      tile("Uploads", fmtBytes(s.fileBytes), `${s.maps} maps · ${s.books} books`),
      tile("Disk free", s.disk ? fmtBytes(s.disk.free) : "?", s.disk ? `of ${fmtBytes(s.disk.total)} · save file ${fmtBytes(s.stateBytes)}` : ""),
      tile("Login emails", data.mail.configured ? "On" : "Off", data.mail.configured ? `${data.mail.provider} · ${data.mail.from}` : "No codes are sent until email is set up"),
    ].map((t, i) => (first ? rise(t, i) : t)));

    const search = el("input", { type: "search", class: "adm-search", placeholder: "Find an email…", value: filter, "aria-label": "Find an account" });
    search.addEventListener("input", () => { filter = search.value; drawRows(); setTimeout(() => { const s2 = accountsCard.querySelector(".adm-search"); s2?.focus(); s2?.setSelectionRange(filter.length, filter.length); }, 0); });
    const table = el("div", { class: "adm-table", role: "table", "aria-label": "Accounts" });
    function drawRows() {
      const rows = data.accounts.filter((a) => !filter || (a.email || "").toLowerCase().includes(filter.toLowerCase()));
      table.replaceChildren(
        el("div", { class: "adm-tr adm-th", role: "row" }, ["Account", "Campaigns", "Storage", "Seen", ...Object.keys(data.perms).map((p) => PERM_LABEL[p] || p)].map((h) => el("span", { role: "columnheader" }, h))),
        ...rows.map((a) => el("div", { class: "adm-tr", role: "row" }, [
          el("span", { class: "adm-acc", role: "cell" }, [
            el("span", { class: `adm-dot${a.emailVerified ? " ok" : ""}`, title: a.emailVerified ? "Email confirmed" : "Email not confirmed yet" }),
            el("span", { class: "adm-email" }, a.email || "(no email)"),
            a.envAdmin ? el("span", { class: "adm-badge" }, "owner") : null,
            a.providers.length ? el("span", { class: "adm-badge soft" }, a.providers.join(" · ")) : null,
          ].filter(Boolean)),
          el("span", { role: "cell" }, String(a.campaigns)),
          el("span", { role: "cell" }, a.files ? `${fmtBytes(a.bytes)} · ${a.files}` : "—"),
          el("span", { role: "cell", title: `${a.devices} device${a.devices === 1 ? "" : "s"}` }, ago(a.lastSeen)),
          ...Object.keys(data.perms).map((p) => el("span", { role: "cell" }, permSwitch(a, p))),
        ])),
      );
    }
    drawRows();
    accountsCard.replaceChildren(
      el("div", { class: "adm-card-head" }, [el("h2", {}, "Accounts"), search]),
      el("p", { class: "adm-note" }, `Everyone: PDFs stay on their devices; up to ${data.limits.standard.mapsPerCampaign} maps per campaign, ${fmtBytes(data.limits.standard.mapBytes)} each. Cloud PDFs: books up to ${fmtBytes(data.limits.cloudBookBytes)} on the server. Unlimited maps: no count limit, ${fmtBytes(data.limits.elevatedMaps.mapBytes)} each.`),
      table,
    );

    campaignsCard.replaceChildren(
      el("div", { class: "adm-card-head" }, [el("h2", {}, "Campaigns")]),
      el("div", { class: "adm-table adm-camps", role: "table", "aria-label": "Campaigns" }, [
        el("div", { class: "adm-tr adm-th", role: "row" }, ["Name", "Game", "Owner", "Members", "Online", "Maps", ""].map((h) => el("span", { role: "columnheader" }, h))),
        ...data.campaigns.map((c) => el("div", { class: "adm-tr", role: "row" }, [
          el("span", { role: "cell", class: "adm-email" }, c.name || "Untitled"),
          el("span", { role: "cell" }, c.system === "dnd5e" ? "D&D 5e" : "Pokémon D&D"),
          el("span", { role: "cell", class: "adm-email" }, c.owner),
          el("span", { role: "cell" }, String(c.members)),
          el("span", { role: "cell" }, c.online ? el("span", { class: "adm-live" }, String(c.online)) : "0"),
          el("span", { role: "cell" }, String(c.maps)),
          el("span", { role: "cell" }, actionButton("Delete", "adm-chip ghost danger", `Delete ${c.name || "Untitled"}`, () => confirmDelete(c))),
        ])),
      ]),
    );
    archivedCard.hidden = !data.archived?.length;
    archivedCard.replaceChildren(
      el("div", { class: "adm-card-head" }, [el("h2", {}, "Deleted campaigns")]),
      el("p", { class: "adm-note" }, "Kept whole, with every save and note, but hidden from everyone. Restore puts one back exactly as it was."),
      el("div", { class: "adm-table adm-camps", role: "table", "aria-label": "Deleted campaigns" }, [
        el("div", { class: "adm-tr adm-th", role: "row" }, ["Name", "Game", "Owner", "Members", "Deleted", "", ""].map((h) => el("span", { role: "columnheader" }, h))),
        ...(data.archived || []).map((c) => el("div", { class: "adm-tr", role: "row" }, [
          el("span", { role: "cell", class: "adm-email" }, c.name || "Untitled"),
          el("span", { role: "cell" }, c.system === "dnd5e" ? "D&D 5e" : "Pokémon D&D"),
          el("span", { role: "cell", class: "adm-email" }, c.owner),
          el("span", { role: "cell" }, String(c.members)),
          el("span", { role: "cell", title: c.archivedBy ? `by ${c.archivedBy}` : "" }, ago(c.archivedAt)),
          el("span", { role: "cell" }),
          el("span", { role: "cell" }, actionButton("Restore", "adm-chip", `Restore ${c.name || "Untitled"}`, async (b) => {
            b.disabled = true;
            const res = await adminCampaign(c.id, "restore");
            if (!res) { print("Couldn't reach the server.", "bad"); b.disabled = false; return; }
            print(res.message);
            data = res.overview; draw();
          })),
        ])),
      ]),
    );
    if (first) { rise(accountsCard, 5); rise(consoleCard, 6); rise(campaignsCard, 7); rise(archivedCard, 8); first = false; }
  }

  (async () => {
    tiles.replaceChildren(el("p", { class: "adm-sub" }, "Loading…"));
    data = await adminOverview();
    if (!data) { tiles.replaceChildren(el("p", { class: "adm-sub" }, "This page is only for admins.")); return; }
    draw();
  })();
}
