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
js/views/library.js   SHELL: the Library (own books + e-reader), in every system's "App" group
js/library/           IndexedDB store, ZIP/EPUB/DOCX parsers, flow + PDF readers
js/lavaTheme.js       SHELL: builds the Lava Tower ambient layer (css/lava.css styles the theme)
js/markdown.js        SHELL: safe Markdown renderer (rules text, notes, the rulebook)
js/views/campaignSelect.js  SHELL: choose / create / join a campaign
js/console.js, logDrawer.js, diceWidget.js, trainerPresence.js ... shared widgets
js/systems/
  registry.js         registerSystem / getSystem / setActiveSystem
  index.js            the list of installed systems  <-- add yours here
  pokemon-dnd/index.js   manifest for Pokémon D&D (views, data, hooks)
  dnd5e/              Dungeons & Dragons 5e (see "The D&D 5e system" below)
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


## The D&D 5e system

`js/systems/dnd5e/` is a full system. Its rules engine (`engine/`) is plain ES modules with no DOM,
so `node --test tests/js/*.test.mjs` runs it directly. The views (`views/`, `components/`) build
DOM with `el()` and load lazily.

- **Data**: `data/dnd5e/<2014|2024>/*.json`, written by `tools/export_dnd5e.py` from the community
  5e-database (SRD 5.1 and 5.2, CC-BY-4.0). Both editions are normalised to one schema.
- **Characters** live in `save.systemData.dnd5e` (`store.js`). `levelLog` is the source of truth for
  levels; `engine/character.js` `derive()` computes everything else.
- **Multiplayer uses the existing transports, so the server is unchanged**: presence (`team.dnd`) feeds
  the party view; the DM tracker publishes its public view through the `/api/fullturn` slot; HP and
  condition changes reach a player's sheet as DM directives; rolls go to the Battle Log.
- DM pages sit behind the campaign's DM password (`dmAccess.js`).

## Library and reader

Books are stored only in the browser (IndexedDB), never on the server. `js/library/formats.js` turns
EPUB, DOCX, text, Markdown, HTML, images and CBZ into one chapter model; `sanitize.js` rebuilds untrusted
markup from an allow-list (the CSP forbids anything else anyway). PDFs use the vendored PDF.js with
`isEvalSupported:false` and `disableFontFace:true` to stay inside the CSP. PDF.js renders with
`requestAnimationFrame`, so a hidden tab will not finish rendering a page.

## Themes

`data-theme` on `<html>` is `light`, `dark`, `lava` or absent (system). `lava` is styled by `css/lava.css`;
the brick textures are SVG data URIs generated by `tools/make_brick_tiles.py` into `css/lava-bricks.css`.
`js/lavaTheme.js` adds a fixed `#lavaFx` layer behind `#app` (cracks, embers, falling masonry) that only
animates opacity/transform. The tower has arched windows built in the shader (a recessed opening whose inner wall and ceiling show with perspective, a bevelled surround, keystone, projecting sill and cast shadows) that turn with it. The menu slab and the top bar are plain, static elements. With WebGL, `js/lavaTower.js` draws the background as a real rotating cylinder (a fragment shader maps
procedurally painted bricks and an emissive crack map onto it; scrolling spins it, and it idles round slowly);
scrolling also shakes the tower (a shader offset plus a small transform on `#lavaFx`) and shakes far more brick loose from
`js/lavaDebris.js`, a 2D canvas of falling chunks, dust and embers that crumble from anywhere on the tower face; without WebGL the flat parallax layers in `css/lava.css` are used. Scrolling `<main>` "descends the tower": the wall, cracks and tower face slide
at different speeds (parallax, eased in a rAF loop) and the fire at the foot grows with depth. It is disabled by `prefers-reduced-motion` and by Settings → "Calm".

Every page is a floor of the tower, in menu order (`data-floor` on each nav item; `app.js` `setView` calls
`goToFloor`). The first page is the roof: a red tiled cone with an eave, finial and waving flag. Each floor below
has its own room (great hall, balcony, portcullis gate, forge, rose window, library, gargoyle ledge, banner room,
repeating), at its own angle and height in the shader. Choosing a page eases the camera down (or up) to that
floor and spins the tower round to face its room (about 0.95s, with a rumble and falling stone); the tower then
keeps turning slowly on its own, and scrolling a page descends further. Choosing the same floor as the last click unlocks the rotation like a free-spinning scroll wheel: each click flicks
the tower faster (stacking, capped), and it coasts to a stop under friction without settling on a window; the camera
only hurries slightly. Choosing a different floor locks it and snaps to that room again.

## Fonts

Loaded from Google Fonts (the only font host the CSP allows), set as variables in `css/style.css`:
`--font-title` and `--font-display` Cinzel (page titles, menus, buttons, headings),
`--font-body` Alegreya Sans (UI text), `--font-lore` Alegreya (rules, spells, notes, the e-reader's serif).
Inter was dropped as too generic. If you add a family, add it to the `<link>` in `index.html` too.

## Pokémon rulebook

`tools/export_rulebook.py` converts the vault's `Rulebook/*.md` to `data/pokemon-dnd/rulebook.json`
(the static server blocks `.md`). `js/views/rulebook.js` renders it. Re-run the exporter after editing the vault.
