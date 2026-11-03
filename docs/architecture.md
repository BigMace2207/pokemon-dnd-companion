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
  gatedViews: [],                // pages not in the sidebar that only open from inside the app (see "The Pokémon hub")
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

## Keywords, hover cards and unfinished characters

`systems/dnd5e/glossary.js` turns every Rules-page entry (conditions, skills, damage types, rules sections, racial extras like
Draconic Ancestry) into a keyword. `markdown.js` calls a registered linker on every rendered rules text, so a keyword anywhere
becomes a link that opens its Rules entry (`openRules`), with a hover card; on the Rules page every mention is also coloured and
bold. `js/tooltip.js` is the one hover card for the whole app (`data-tip`, and native `title`s are upgraded to it). The character
builder keeps its draft in localStorage (`pokemon-dnd-dnd-builder-draft`) on every change and when you leave, and the Characters page
offers Continue / Discard. The dragonborn ancestry table is `engine/dragons.js`.

## D&D rules version

2014 vs 2024 is a **campaign** setting, not a player one: `meta.edition` on the campaign (chosen when it is created, changed by the
owner in Settings > Campaign via `POST /api/campaigns/<id>/set-edition`, owner only). On entering a campaign `app.js` calls the system's
`applyCampaign`, and the D&D system copies the edition into the player's settings and locks the edition switches (`getCampaignEdition`).
Campaigns that predate this have no edition and keep the old per-player switch until the owner sets one.

## Library and reader

Books are stored in the browser (IndexedDB). Accounts with the `cloudLibrary` permission (admins have it) also upload
each book to the server as a private file (`/api/files`, kind `book`), so it appears on every device and downloads the
first time it is opened there. `js/library/formats.js` turns
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

## Campaign Planner

One full-screen page (`js/views/planner.js`, `js/planner/boardView.js`; `html.planner-full` hides the tower and removes <main>'s
padding). The whiteboard is the whole interface: an endless pan/zoom board in world coordinates. A left rail adds nodes (notes,
checklists, stickies, dungeons, every generator for the game; drag or click), and Maps, Scenarios and Party plans (DM) open as
drawers over the board. `bounds` (the drawn paper) grows by 900 whenever a node comes within 260 of an edge (`board.js`).
Backgrounds are CSS gradients (`planner-board.css`) or an upload kept in IndexedDB only (`bg-<board id>`). A dungeon node expands
to every room card with a note box per room (`dungeonMap`/`roomCard` in `dnd5e/views/dungeonGen.js`). "Sessions" are drawn round
nodes (box or freehand), numbered, coloured and labelled "Session N"; a node keeps a list of session ids, so it can be in several.
Each kind of node has its own look (`kinds.js`, `[data-kind]` in `whiteboard.css`): a shop has an awning, an NPC an avatar, loot a dashed gold ring, a room a stone grid, a hook a parchment scrap. Membership of a session follows geometry (`syncSessions`: a node belongs to every session shape holding its centre), so nodes dropped or dragged into one join it. The paper always covers the screen (`coverBounds` grows it as you pan, zoom or resize). The Connect tool links two nodes with a labelled arrow: a relationship from a list (works at, found in, guards...) or your own words, suggested from the two kinds (`suggestRelation`), and for a dungeon either end can name one room ("Loot is found in Room 9"). Links live in `board.links` and are shared with the board.
The generators live only here: there is no separate Generators page any more.

Data lives in `save.planner[campaignId]` (so it is mirrored and follows the player). A player's boards, notes and checklists are
also pushed to the server (`POST /api/plan`, one document per member, capped at `MAX_PLAN`); only the DM token can read them
(`GET /api/plans`), shown read-only in Party plans. Because boards also arrive from other players, `normalizeBoard` rebuilds every
field from a known type. A DM's scenarios and boards are never pushed. Map images are device-local (`mapStore.js`); "Export pack"
moves a whole map. Generators: `pokeGenerators.js` is built on the Pokémon data and `dndText.js` wraps the D&D ones; both are
Node-tested (`tests/js`), as is the board geometry (`board.test.mjs`). The server tests cover who may write and read plans
(`PlannerPlans`). The desktop sidebar folds away (`html.nav-collapsed`, remembered per device).

## Planner slots (Pokémon)

Trainer, gym leader and wild encounter nodes (`gen` nodes of kind `trainer`, `gym`, `wildmon`) carry `mons` (up to six,
`board.js cleanMon`) and, for trainers and gym leaders, `identity` ({name, npcId, sprite}). The Libraries flyout adds
`libtrainer` and `libmon` cards from the DM's NPC and Wild Libraries. Dragging a card by its title bar over a slot
(`slotAt`) or dropping a library entry or a team row onto one (`acceptDrops`, HTML5 drag) snaps it in; the card leaves the
board. Team rows drag to reorder, to another node, or out onto the board (`takeFromTeam` + a new `libmon` card). The hub's
"From your planner" encounters read `mons` and `identity`, so a battle uses the team in the order set here.

## Shared screens

The shared sign-in and campaign screens say "D&D Companion" and show nothing Pokémon; the Pokémon artwork credit is in
Settings > Appearance inside the Pokémon area.

## Uploaded files

Map images and cloud Library books are files on the server, not part of the save file: `POST /api/files/upload?kind=..`
streams the raw body to `UPLOAD_DIR/<account id>/<file id>.bin` (`PKDND_UPLOAD_DIR`, default `uploads/` next to the save),
and only a small record (owner, campaign, name, type, size, SHA-256) goes in the save. Limits come from the account's
permissions (`account_limits`): 10 maps of 15 MB per campaign for everyone; `unlimitedMaps` lifts the count to none and
the size to 100 MB; `cloudLibrary` allows books up to 300 MB. Uploads are refused when the disk would drop under 2 GB
free. Images must really be PNG, JPEG, WebP or GIF (checked from the bytes); PDFs must start with `%PDF`.
`GET /api/files/<id>` answers with an `ETag` (the file's hash), so an unchanged map is never sent twice; the client shows
images through `blob:` URLs (`img-src` allows `blob:` for this), since the request needs the session header. You can read
your own files, and campaign members can read the file the DM shares as the party map. Deleting moves the bytes to
`_deleted/` instead of erasing them.

## Accounts: sign-in codes and admins

Each browser keeps a random device key (`account.js`). A password sign-in from a device the account hasn't used before
answers `needCode` and emails a 4-digit code (`mailer.py`; `PKDND_MAIL_PROVIDER` brevo, resend or outbox for testing);
`POST /api/auth/verify` finishes it and remembers the device. Codes expire after 10 minutes and five wrong tries. A device
that already holds a valid session is remembered the first time it asks `/api/auth/me`, so nobody is asked for a code on
a device they were already using. Without a mail provider configured, sign-in works as before (no codes). Google and
Apple sign-ins don't need a code.

The admin is whoever's confirmed address is in `PKDND_ADMIN_EMAILS` on the server (an address is confirmed by a code
sent to it, or by Google). Admins see the Admin page (`js/views/admin.js`, `/api/admin/*`, which answers 404 to anyone
else) and can grant `admin`, `cloudLibrary` and `unlimitedMaps` to any account. Deleting a campaign from the console
(`POST /api/admin/campaign`, action `archive`) moves it whole into `ARCHIVED` (saved as `archived` in the save file),
where nobody can reach it; `restore` puts it back unchanged.

## The Pokémon hub

`js/views/hub.js` is the Pokémon system's default page: one shared board per campaign (`state.hub`, server.py "The
Pokémon hub"). The page calls `POST /api/hub/sync` a few times a second while open with its own cursor and gets back
everyone else's (kept in memory only, gone after 6 seconds) and the board when its revision changed. Pings ride on the same
call (`ping`, in memory for 4 seconds, at most 3 per player at once), and a cursor's `down` flag shows a click ripple.
The DM's backdrop (`op: "backdrop"`, `hub.backdrop = {fileId, blur, dim}`) must be one of the DM's own map uploads in the
campaign; campaign members may then read that file, like the shared party map. It sits under the dot grid (`.hub-dots`)
and fades in; with none, the hub is "cosmic": four repeating star patterns (`.hub-starfield`) under the dots that pan and zoom with the board and fade in and out on their own rhythms. The board has an edge (`clampView`, `updateBounds`): you can pan
and zoom out only as far as `EDGE_PAD` board units round everything on it (at least `BASE_AREA`), so the edge moves out as
content is placed near it; bumping into it lights a glow on that side. A system's `onHub` list (Pokémon: settings,
planner, library) keeps those pages routable but out of the sidebar, as buttons on the hub, and `hiddenViews` are routable pages that aren't in the sidebar (Pokémon: the
Pokédex and Move Dex, which are pull-outs on the hub, `js/hubDex.js`). Hub items `mon` and `move` are cards that store
only a name (and dex number); `hubDex.js fillCard` draws them from the rules data. A ping may carry `item`, the id of the
thing it points at, and is drawn as frames round that item. Other players' cursors are inside `.hub-world` (board
coordinates), so they stay on the same spot of the board while you zoom or pan; `--ik` (1/zoom) keeps their arrow and
name at screen size.

A system's `theme` (Pokémon: "cosmic", `css/cosmic.css`) is forced while its campaign is open
(`deviceSettings.js setForcedTheme`, remembered for the next load by `theme-init.js`); the device's own choice still
applies to other systems. Cosmic redefines the colour and font variables in `style.css` and restyles cards, buttons,
fields, tables and the battle screen, so new pages pick it up without extra work.

A system with `noSidebar: true` (Pokémon) has no sidebar at all: `html.no-sidebar` hides it, the top bar's menu button
becomes a home button, and the system's own home page provides the way to every page (the hub's LEFT_PAGES and
RIGHT_PAGES). `nav` still lists every page so the router knows them.

Pull tabs (`js/logDrawer.js`): LOG is always on the right edge; a system adds more with `pullTabs: [{ id, label, title,
render, wide }]` (Pokémon: RULES and TYPES). A tab's page is rendered once, the first time it opens, and kept. `POST /api/hub/op`
puts, deletes or clears items: notes, text and drawings belong to whoever made them; encounter buttons need the DM token.
A button's hover card is computed by the server from the DM's NPC and Wild libraries (`hub_button_preview`), so it
shows the lead Pokémon's level and only names it when the DM allowed the sprite. The Battle screen is a gated view
(`gatedViews` in the system manifest): the router only opens it when the hub asks (`app-open-view` event), and a typed
`#battleview` lands on the hub.

## The party map

The DM can share one map with the table: `POST /api/partymap` (DM token) stores the uploaded map file's id (older clients send the image inline), the labelled places
and the players' tokens; `GET /api/partymap` returns it to any member with **only the places the DM has revealed** (the server
filters; hidden places and their notes are never sent to players). Dragging a token or revealing a place uses `/partymap/live`,
which carries just pins and tokens. Whiteboard nodes can be linked to a place on a map (`node.mapLink`, `planner/mapLink.js`).

## Fonts

Loaded from Google Fonts (the only font host the CSP allows), set as variables in `css/style.css`. The hub and
the admin console use Space Grotesk with Fraunces headings (--font-head) (`css/hub.css`, `css/admin.css`). The rest:
`--font-title` and `--font-display` Cinzel (page titles, menus, buttons, headings),
`--font-body` Alegreya Sans (UI text), `--font-lore` Alegreya (rules, spells, notes, the e-reader's serif).
Inter was dropped as too generic. If you add a family, add it to the `<link>` in `index.html` too.

## Pokémon rulebook

`tools/export_rulebook.py` converts the vault's `Rulebook/*.md` to `data/pokemon-dnd/rulebook.json`
(the static server blocks `.md`). `js/views/rulebook.js` renders it. Re-run the exporter after editing the vault.
