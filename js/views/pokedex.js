import { el, typePill, statBars } from "../components.js";
import { METHOD_LABELS, GAME_LABELS, DEFAULT_GAME } from "../data.js";
import { spriteImg } from "../sprites.js";
import { goToMove, consumePendingPokemon } from "../navState.js";
import { getViewState, setViewState } from "../viewState.js";
import { attachInfoTooltip, tooltipTitle, tooltipRow } from "../infoTooltip.js";

export function renderPokedex(container, state) {
  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "Pokédex"));
  container.appendChild(el("p", { class: "view-sub" }, `${state.pokemon.length} Pokémon (incl. regional forms & special forms).`));

  const searchInput = el("input", { type: "text", placeholder: "Search by name…" });
  searchInput.value = getViewState("pokedex:search", "");
  const typeSelect = el("select", {}, [
    el("option", { value: "" }, "All types"),
    ...Object.keys(state.typeChart.rows).sort().map((t) => el("option", { value: t }, t)),
  ]);
  typeSelect.value = getViewState("pokedex:type", "");
  const controls = el("div", { class: "card" }, [
    el("div", { class: "grid-2" }, [searchInput, typeSelect]),
  ]);
  container.appendChild(controls);

  const listWrap = el("div", { class: "table-wrap" });
  const detailWrap = el("div");
  container.appendChild(el("div", { class: "grid-2" }, [
    el("div", {}, [listWrap]),
    detailWrap,
  ]));

  function renderList() {
    const q = searchInput.value.trim().toLowerCase();
    const t = typeSelect.value;
    const rows = state.pokemon.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (t && p.type1 !== t && p.type2 !== t) return false;
      return true;
    }).slice(0, 400);

    const table = el("table", { class: "data-table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", { class: "hide-mobile" }, "#"), el("th", {}, ""), el("th", {}, "Name"), el("th", {}, "Type"), el("th", {}, "BST"),
      ])),
      el("tbody", {}, rows.map((p) => {
        const tr = el("tr", { onclick: () => renderDetail(p, true) }, [
          el("td", { class: "hide-mobile" }, String(p.dex)),
          el("td", {}, spriteImg(p.dex, { back: false, alt: p.name, className: "dex-row-sprite" })),
          el("td", {}, p.name),
          el("td", {}, [typePill(p.type1), p.type2 ? typePill(p.type2) : null].filter(Boolean)),
          el("td", {}, String(p.total)),
        ]);
        attachInfoTooltip(tr, () => [
          tooltipTitle(p.name),
          el("div", {}, [typePill(p.type1), p.type2 ? typePill(p.type2) : null].filter(Boolean)),
          tooltipRow(`Base Stat Total: ${p.total}`),
          tooltipRow(p.ability1 ? `Ability: ${p.ability1}${p.ability2 ? ` / ${p.ability2}` : ""}` : ""),
        ].filter((n) => n.textContent !== ""));
        return tr;
      })),
    ]);
    listWrap.innerHTML = "";
    listWrap.appendChild(table);
    if (rows.length === 400) {
      listWrap.appendChild(el("div", { class: "formula-note" }, "Showing first 400 matches — narrow your search for more."));
    }
  }

  let currentGame = getViewState("pokedex:game", DEFAULT_GAME);
  let showAllGames = getViewState("pokedex:showAllGames", true);

  function renderDetail(p, fromTap) {
    setViewState("pokedex:selectedDex", p.dex);
    detailWrap.innerHTML = "";
    const card = el("div", { class: "card" });
    card.appendChild(el("div", { class: "detail-header" }, [
      spriteImg(p.dex, { back: false, alt: p.name, className: "dex-sprite" }),
      el("span", { class: "dex" }, `#${p.dex}`),
      el("span", { class: "name" }, p.name),
      typePill(p.type1), p.type2 ? typePill(p.type2) : null,
    ].filter(Boolean)));
    card.appendChild(el("p", { class: "view-sub" }, `Gen ${p.gen ?? "?"} · Catch Rate ${p.catchRate} · Base Stat Total ${p.total}`));
    card.appendChild(statBars(p));

    // Evolution family -- see data/evolutions.json's own note on coverage
    // (hand-authored, not exported from the spreadsheet, so it's strongest
    // for Gen 1-3 plus the full Eevee family; a species with no entry there
    // just shows neither section, same as it not evolving at all).
    function evoNode(species, method, isCurrent) {
      const node = el("div", { class: "evo-node" + (isCurrent ? " current" : "") }, [
        spriteImg(species.dex, { back: false, alt: species.name }),
        el("div", { class: "evo-name" }, species.name),
        method ? el("div", { class: "evo-method" }, method) : null,
      ].filter(Boolean));
      if (!isCurrent) node.addEventListener("click", () => renderDetail(species, true));
      return node;
    }
    const evoFrom = (state.evolvesFrom.get(p.name) || []).map((e) => ({ ...e, species: state.pokemonByName.get(e.name) })).filter((e) => e.species);
    const evoTo = (state.evolvesTo.get(p.name) || []).map((e) => ({ ...e, species: state.pokemonByName.get(e.name) })).filter((e) => e.species);
    if (evoFrom.length || evoTo.length) {
      card.appendChild(el("h4", {}, "Evolution"));
      const chain = el("div", { class: "evo-chain" });
      evoFrom.forEach((e) => {
        chain.appendChild(evoNode(e.species, e.method, false));
        chain.appendChild(el("span", { class: "evo-arrow" }, "→"));
      });
      chain.appendChild(evoNode(p, null, true));
      if (evoTo.length) {
        chain.appendChild(el("span", { class: "evo-arrow" }, "→"));
        evoTo.forEach((e) => chain.appendChild(evoNode(e.species, e.method, false)));
      }
      card.appendChild(chain);
    }

    const abilityRows = [];
    if (p.ability1) abilityRows.push([p.ability1, p.ability1Effect]);
    if (p.ability2) abilityRows.push([p.ability2, p.ability2Effect]);
    if (p.hiddenAbility) abilityRows.push([`${p.hiddenAbility} (Hidden)`, p.hiddenAbilityEffect]);
    card.appendChild(el("h4", {}, "Abilities"));
    card.appendChild(el("table", { class: "kv-table" }, abilityRows.map(([n, eff]) =>
      el("tr", {}, [el("td", {}, n), el("td", {}, eff || "")]))));

    // moveset
    const gameSelect = el("select", {}, [
      ...Object.entries(GAME_LABELS).map(([code, label]) =>
        el("option", { value: code, selected: Number(code) === currentGame ? "" : null }, label)),
    ]);
    gameSelect.value = String(currentGame);
    gameSelect.addEventListener("change", () => { currentGame = Number(gameSelect.value); setViewState("pokedex:game", currentGame); renderMoveset(); });
    const allGamesBtn = el("button", { class: "btn secondary" }, showAllGames ? "Showing: all games" : "Showing: one game");
    allGamesBtn.addEventListener("click", () => { showAllGames = !showAllGames; setViewState("pokedex:showAllGames", showAllGames); allGamesBtn.textContent = showAllGames ? "Showing: all games" : "Showing: one game"; renderMoveset(); });

    const movesetHeader = el("div", { class: "grid-2" }, [gameSelect, allGamesBtn]);
    card.appendChild(el("h4", {}, "Moves Known"));
    card.appendChild(movesetHeader);
    const movesetBody = el("div");
    card.appendChild(movesetBody);

    function renderMoveset() {
      movesetBody.innerHTML = "";
      const raw = state.movesetsByDex.get(p.dex) || [];
      const rows = showAllGames ? raw : raw.filter((r) => r.game === currentGame);
      const byMethod = { L: [], T: [], E: [], U: [] };
      for (const r of rows) {
        if (byMethod[r.method]) byMethod[r.method].push(r);
      }
      byMethod.L.sort((a, b) => (a.level ?? 0) - (b.level ?? 0));

      const order = ["L", "T", "E", "U"];
      let any = false;
      order.forEach((code) => {
        const list = byMethod[code];
        if (!list.length) return;
        any = true;
        // dedupe by move (across games when showAllGames)
        const seen = new Map();
        list.forEach((r) => {
          const key = r.moveIdx;
          if (!seen.has(key)) seen.set(key, r);
        });
        movesetBody.appendChild(el("div", { class: "moveset-group" }, [
          el("h4", {}, METHOD_LABELS[code]),
          el("div", {}, [...seen.values()].map((r) => {
            const move = state.moves[r.moveIdx];
            const chip = el("span", { class: "moveset-chip clickable" + (move.stub ? " stub" : "") }, [
              code === "L" ? el("span", { class: "lvl" }, `Lv.${r.level}`) : null,
              move.name,
            ].filter(Boolean));
            chip.addEventListener("click", () => goToMove(move.name));
            return chip;
          })),
        ]));
      });
      if (!any) movesetBody.appendChild(el("p", { class: "view-sub" }, "No moveset data for this game."));
    }
    renderMoveset();

    detailWrap.innerHTML = "";
    detailWrap.appendChild(card);

    // On phone-width screens the list and detail stack vertically — jump
    // down to the detail panel after tapping a row instead of leaving the
    // user to scroll past the list manually.
    if (fromTap && window.innerWidth <= 900) {
      detailWrap.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  searchInput.addEventListener("input", () => { setViewState("pokedex:search", searchInput.value); renderList(); });
  typeSelect.addEventListener("change", () => { setViewState("pokedex:type", typeSelect.value); renderList(); });
  renderList();

  // Arrived here via a Pokémon chip click on the Move Dex page — open that
  // Pokémon's detail directly instead of whatever was previously selected.
  const pendingName = consumePendingPokemon();
  const pending = pendingName ? state.pokemonByName.get(pendingName) : null;
  const rememberedDex = getViewState("pokedex:selectedDex", null);
  const remembered = rememberedDex !== null ? state.pokemon.find((p) => p.dex === rememberedDex) : null;
  if (pending) {
    searchInput.value = pendingName;
    setViewState("pokedex:search", pendingName);
    renderList();
    renderDetail(pending, true);
  } else if (remembered) {
    renderDetail(remembered);
  } else if (state.pokemon.length) {
    renderDetail(state.pokemon[0]);
  }
}
