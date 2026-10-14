import { el, typePill } from "../components.js";
import { GAME_LABELS, DEFAULT_GAME } from "../data.js";
import { consumePendingMove, goToPokemon } from "../navState.js";
import { getViewState, setViewState } from "../viewState.js";
import { attachInfoTooltip, tooltipTitle, tooltipRow } from "../infoTooltip.js";

export function renderMoves(container, state) {
  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "Move Dex"));
  container.appendChild(el("p", { class: "view-sub" }, `${state.moves.length} moves (${state.moves.filter(m=>m.stub).length} shown as name-only — no Move List battle data, from newer games).`));

  const searchInput = el("input", { type: "text", placeholder: "Search by move name…" });
  searchInput.value = getViewState("moves:search", "");
  const typeSelect = el("select", {}, [el("option", { value: "" }, "All types"), ...Object.keys(state.typeChart.rows).sort().map((t) => el("option", { value: t }, t))]);
  typeSelect.value = getViewState("moves:type", "");
  const catSelect = el("select", {}, [el("option", { value: "" }, "All categories"), ...["Physical", "Special", "Status"].map((c) => el("option", { value: c }, c))]);
  catSelect.value = getViewState("moves:category", "");
  const tierSelect = el("select", {}, [el("option", { value: "" }, "All tiers"), ...["Status", "Basic", "Light", "Moderate", "Strong", "Heavy", "Signature/Ultimate"].map((t) => el("option", { value: t }, t))]);
  tierSelect.value = getViewState("moves:tier", "");

  container.appendChild(el("div", { class: "card" }, [
    el("div", { class: "grid-3" }, [searchInput, typeSelect, catSelect]),
    el("div", { style: "margin-top:10px;max-width:240px" }, [tierSelect]),
  ]));

  const listWrap = el("div", { class: "table-wrap" });
  const detailWrap = el("div");
  container.appendChild(el("div", { class: "grid-2" }, [el("div", {}, [listWrap]), detailWrap]));

  function renderList() {
    const q = searchInput.value.trim().toLowerCase();
    const rows = state.moves
      .map((m, i) => [m, i])
      .filter(([m]) => {
        if (q && !m.name.toLowerCase().includes(q)) return false;
        if (typeSelect.value && m.type !== typeSelect.value) return false;
        if (catSelect.value && m.category !== catSelect.value) return false;
        if (tierSelect.value && m.tier !== tierSelect.value) return false;
        return true;
      })
      .slice(0, 400);

    const table = el("table", { class: "data-table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Move"), el("th", {}, "Type"), el("th", {}, "Cat."),
        el("th", { class: "hide-mobile" }, "Pow"), el("th", { class: "hide-mobile" }, "Acc"), el("th", {}, "Tier"),
      ])),
      el("tbody", {}, rows.map(([m, idx]) => {
        const tr = el("tr", { onclick: () => renderDetail(m, idx, true) }, [
          el("td", {}, m.name),
          el("td", {}, m.type ? typePill(m.type) : "—"),
          el("td", {}, m.category || "—"),
          el("td", { class: "hide-mobile" }, m.power ?? "—"),
          el("td", { class: "hide-mobile" }, m.accuracy ?? "—"),
          el("td", {}, m.tier || "—"),
        ]);
        if (!m.stub) {
          attachInfoTooltip(tr, () => [
            tooltipTitle(m.name),
            tooltipRow(`${m.category || "—"}${m.type ? ` · ${m.type}` : ""} · Power ${m.power ?? "—"} · Accuracy ${m.accuracy ?? "—"}`),
            tooltipRow(m.effect || ""),
          ].filter((n) => n.textContent !== ""));
        }
        return tr;
      })),
    ]);
    listWrap.innerHTML = "";
    listWrap.appendChild(table);
  }

  function renderDetail(m, idx, fromTap) {
    setViewState("moves:selectedIdx", idx);
    detailWrap.innerHTML = "";
    const card = el("div", { class: "card" });
    card.appendChild(el("div", { class: "detail-header" }, [
      el("span", { class: "name" }, m.name),
      m.type ? typePill(m.type) : null,
    ].filter(Boolean)));
    if (m.stub) {
      card.appendChild(el("p", { class: "formula-note" }, "This move isn't in the Move List sheet (no Power/Accuracy/Tier data), so it can't be used in the Damage/Hit Chance calculators — same as in the spreadsheet. Shown here only so the Pokédex moveset list is complete."));
    } else {
      card.appendChild(el("table", { class: "kv-table" }, [
        ["Category", m.category], ["Power", m.power ?? "—"], ["Accuracy", m.accuracy],
        ["PP", m.pp], ["Tier", m.tier], ["Dice", m.diceCount ? `${m.diceCount}d${m.dieSize}` : "—"],
      ].map(([k, v]) => el("tr", {}, [el("td", {}, k), el("td", {}, String(v))]))));
    }
    card.appendChild(el("p", {}, m.effect || ""));

    card.appendChild(el("h4", {}, "Learned by"));
    const learners = state.movesetsByMoveIdx.get(idx) || [];
    const filtered = learners.filter((r) => r.game === DEFAULT_GAME);
    const useList = filtered.length ? filtered : learners;
    const seen = new Set();
    const names = [];
    for (const r of useList) {
      if (seen.has(r.dex)) continue;
      seen.add(r.dex);
      const p = state.pokemonByDex.get(r.dex);
      if (p) names.push(p.name);
    }
    card.appendChild(el("p", { class: "view-sub" }, filtered.length ? `In ${GAME_LABELS[DEFAULT_GAME]}:` : "Across all games:"));
    card.appendChild(el("div", {}, names.slice(0, 150).map((n) => {
      const chip = el("span", { class: "moveset-chip clickable" }, n);
      chip.addEventListener("click", () => goToPokemon(n));
      return chip;
    })));
    if (names.length > 150) card.appendChild(el("p", { class: "view-sub" }, `+ ${names.length - 150} more`));

    detailWrap.appendChild(card);

    if (fromTap && window.innerWidth <= 900) {
      detailWrap.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  searchInput.addEventListener("input", () => { setViewState("moves:search", searchInput.value); renderList(); });
  typeSelect.addEventListener("input", () => { setViewState("moves:type", typeSelect.value); renderList(); });
  catSelect.addEventListener("input", () => { setViewState("moves:category", catSelect.value); renderList(); });
  tierSelect.addEventListener("input", () => { setViewState("moves:tier", tierSelect.value); renderList(); });
  renderList();

  // Arrived here via a moveset chip click on the Pokédex page — open that
  // move's detail directly instead of whatever was previously selected.
  const pendingMoveName = consumePendingMove();
  const pendingIdx = pendingMoveName ? state.moveByName.get(pendingMoveName) : undefined;
  if (pendingMoveName && pendingIdx !== undefined) {
    searchInput.value = pendingMoveName;
    setViewState("moves:search", pendingMoveName);
    renderList();
    renderDetail(state.moves[pendingIdx], pendingIdx, true);
  } else {
    const rememberedIdx = getViewState("moves:selectedIdx", null);
    if (rememberedIdx !== null && state.moves[rememberedIdx]) {
      renderDetail(state.moves[rememberedIdx], rememberedIdx);
    }
  }
}
