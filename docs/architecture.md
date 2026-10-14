# Architecture

The app is split into a **shell** that every game shares and **game systems**
that plug into it. Pokémon D&D is the first system; regular D&D has a preview
scaffold, and more can be added without touching the shell.

```
index.html            page skeleton (nav is built at runtime)
js/app.js             SHELL: router, campaign gate, themes, sync polling, brand
js/network.js         SHELL: API client (campaign-scoped)
js/storage.js         SHELL: local + server-mirrored player save
js/deviceSettings.js  SHELL: theme, hidden pages, selected campaign
js/views/settings.js  SHELL: Settings page (shared by every system)
js/views/campaignSelect.js  SHELL: choose / create / join a campaign
js/console.js, logDrawer.js, diceWidget.js, trainerPresence.js ... shared widgets
js/systems/
  registry.js         registerSystem / getSystem / setActiveSystem
  index.js            the list of installed systems  <-- add yours here
  pokemon-dnd/index.js   manifest for Pokémon D&D (views, data, hooks)
  dnd5e/              preview system (dice roller, ability scores)
server.py             system-agnostic server: campaigns, sync, static files
data/                 Pokémon D&D rules data (a new system adds data/<id>/)
```

## What is "shell" and what is "system"

Shell (shared): campaigns and invites, the DM password/token, trainers/players
online, the shared Battle Log, DM notes, directives transport, themes,
settings, dice tray, sprites for the UI chrome.

System (per game): which pages exist, how its data loads, its rules engine,
its character/save shape, and what it shows other players about you.

Pokémon-specific engine files still sit at `js/*.js` and `js/views/*.js`
(`calc.js`, `battleMath.js`, `specialMoves.js`, `moveResolution.js`,
`itemEffects.js`, `abilityEffects.js`, `statusEffects.js`, `levelUp.js`,
`battleview.js`, `fullturn.js`, `controlcentre.js`, ...). They are plugged in
only through `js/systems/pokemon-dnd/index.js`. New systems should keep their
own files under `js/systems/<id>/` instead.

## A system definition

```js
export default {
  id: "my-system",               // stored on campaigns; also add to KNOWN_SYSTEMS in server.py
  name: "My System",
  tagline: "Shown in the campaign picker",
  status: "stable",              // or "preview"
  brand: { title: "My Companion", logo: "assets/logo.png" },
  defaultView: "home",
  nav: [{ label: null, views: [{ id: "home", label: "Home", render: (container, state) => {} }] }],
  directiveViews: [],            // views to re-render when a DM directive lands
  async loadData() { return {}; },        // becomes `state` passed to every view
  mount(state) {},                        // one-time floating tools etc.
  async applyDirectives(state) { return false; },
  presence(save) { return {}; },          // what other players/the DM see about you
};
```

## Adding a game system

1. Create `js/systems/<id>/index.js` with a definition like the one above and
   put its views next to it. Keep its data in `data/<id>/`.
2. Register it in `js/systems/index.js` (one `registerSystem(...)` line).
3. Add the id to `KNOWN_SYSTEMS` in `server.py`.
4. Store per-player data with `getSystemData(save, "<id>")` (js/storage.js) so
   it never collides with another system's fields.

Campaigns choose their system when created (Create Campaign → Game system).
Everyone who joins gets that system's pages automatically.

## Move rules (Pokémon D&D)

- `data/moves.json` is exported from the spreadsheet. Every damaging move
  rolls its tier's dice, **summed** (`rollMoveDice` in `calc.js`), in the
  Damage Calculator, live battle and both DM consoles.
- `data/special_moves.json` holds the moves the sheet has no dice for
  (fixed damage, level damage, % of HP, OHKO, variable-power, Z-moves,
  "DM decides"). Edit it to tune them; `js/specialMoves.js` applies it.
