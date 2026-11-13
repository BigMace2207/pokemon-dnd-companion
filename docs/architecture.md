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

Shell (shared): campaigns and invites, DM access (owner-granted, `meta.dmAccounts`) and DM tokens, trainers/players
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
- DM pages need DM access, which the owner gives per member; `dmAccess.js` gets a DM token with no password, and the server re-checks access every time a token is used (`_dm_ok`), so revoking works at once. The hub sync returns `isDm` so the DM tools appear or close live.

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

`data-theme` on `<html>` is `light`, `dark`, `lava`, `cosmic` or absent (system). Each system forces its own
(`theme` in the manifest, `setForcedTheme`): Pokémon D&D is `cosmic`, D&D 5e is `lava`. The two share one shape:
css/cosmic.css and css/vvd.css write their rules as `:root:is([data-theme="cosmic"], [data-theme="lava"])` (glass cards
with hairlines, pills, Space Grotesk tools, serif titles), and css/lava.css, loaded after them, warms the colours
(basalt, molten orange buttons, D&D gold, ivory selected pills, Cinzel page titles). Behind every lava page
`js/lavaTheme.js` keeps a fixed `#lavaSky`: the same blurred lava sea and rising embers as the hub (`lavaSky()`, CSS in
css/hub.css "the lava hub"), hidden on full-screen pages that draw their own. It moves by transform/opacity only and is
still for `prefers-reduced-motion`, Low graphics and Settings → Appearance → Lava effects: Calm (`data-lava-fx="calm"`).
The old Lava Tower theme (brick wall, WebGL cylinder, floors) is archived in the second brain, and in git up to f864226.

The D&D side has no sidebar either (`noSidebar`, `onHub: settings, planner, library`): every page opens from the hub
(quick bar, page buttons, the All pages menu) and the top bar's home button goes back. The Compendium page
(`dndCompendium`, views/compendium.js) shows every rules section as a tab (viewState `dnd:compendium:tab`) and renders
that section's own page underneath; the All pages menu and the hub's Compendium pull-out open it on a section.

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

## Control Centre

`controlcentre.js` (DMs only) shows big options in a row: Overview, Battle Control, Players, NPC Library,
Wild Library and DM Tools. The Overview (`dmOverview.js`) reads the same endpoints players and Battle Control use
(`/api/roster` with the DM token: every member, online or not, with party, bag and money from their live presence or
last saved copy; `/api/fullturn`, the DM inbox, `/api/battlelog`) every 4 seconds and redraws only
when something changed. `dmParty.js` is the Players page and the PARTY pull tab, and exports `hpOf` for both.

## Hub gifts (Send To)

Dragging a team Pokémon or a bag item onto the hub's Send To target sends it with `/api/send` (types `pokemon`, `item`,
`cash`) and takes it out of the sender's save once the server accepts it. The receiver's hub polls its inbox every few
seconds and applies gifts straight into the save (ids remembered in localStorage so a lost acknowledgement never adds a
gift twice). `/api/roster` without the DM token gives only names, portraits and who's online.

## Phone layout

A separate copy of the interface for phones, switched by a class on `<html>`: `js/layout-init.js` (a classic script in
`<head>`, before first paint) adds `m` for a coarse pointer on a viewport up to 820px, or as forced in Settings
(`localStorage` key `pkdnd-layout`: auto / phone / desktop). `js/mobileMode.js` keeps it live (rotation, resizing) and
fires `layout-changed`. Everything phone-only is in `css/mobile.css` under `html.m`, so the desktop layout never changes.
On the hub, `js/mobile/wheel.js` mounts a radial wheel (hidden on desktop) whose options hub.js supplies, and turns the
bag, Dex, people list, encounters drawer and menus into drag-to-dismiss bottom sheets (`sheetDrag`). Motion follows
Apple's rules: springs with a damping ratio and response that start from the current value (interruptible), momentum
projection on release, rubber-banding at the ends, and reduced motion swapping springs for jumps.

## The hub map and fog of war

`state.partyMap` is the one map on the hub (published from the Whiteboard's Map editor, `js/planner/mapsTab.js`). It
holds the places (pins, each `revealed` or not), tokens (players by trainer id, plus the DM's markers), `fog`
({enabled, shared, radius}) and `reveals` (cleared spots per player id, and "dm" for the DM's brushing).
`GET /api/partymap?id=<your trainer id>` returns the map as that person may see it (`map_view_for`): hidden places are
never sent; with private fog a player gets only their own cleared spots and token. Players move their own token with
`/api/partymap/move` (the DM's token moves any), which clears the mist there; the DM sets fog and brushes with
`/api/partymap/fog`. The DM's live updates keep the positions players moved to (`merge_map_tokens`). `js/mapView.js`
draws a map (image, fog canvas, places, tokens) for the hub's minimap and full map (`js/hubMap.js`), the Map editor and
the players' Hub map drawer.

## Battle turns

The DM's Battle Control decides whose turn it is (it sorts by speed) and sends that combatant's id as `fullTurn.turnId`
with every save; the server checks player actions against it, and player screens show it. Battle Control embeds the same battle view in DM mode (`renderBattleView(..., { dm })`): it shows the battle as whoever's
turn it is, and on an NPC's or wild Pokémon's turn the DM's move comes back through `dm.submit` (HP via `setHp`, one log
line). A player on turn makes one
choice: a move (`/api/fullturn/playermove`, which applies the damage it rolled) or an item, running, switching or
something else (`/api/fullturn/playeraction`, switching swaps in a Pokémon from their own saved party). Either records
`fullTurn.acted` and refuses a second choice; only the DM's Next Turn moves on (a save with a new turn clears `acted`).
Battle Control polls the battle every few seconds, so its copy never saves over a player's damage.

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

## The D&D hub (lava)

A D&D campaign's default page is the same `js/views/hub.js` (the manifest lists `hub` first and `mapeditor` in
`hiddenViews`). `renderHub` sets `DND` from `state.system` and takes its system-specific pieces from
`js/hubKits/dnd.js`: the quick bar and page buttons, a lava sky (`lavaSky()`: blurred `.lava-blob`s and rising embers
in place of the stars, nebula and constellations; CSS `.hub.lava` in css/hub.css), your character badge and vitals
strip, the Inventory (`drawBag`), the Compendium pull-out (`compendiumPanel`), the board cards `monster`, `spell` and
`item` (`fillCard`, drawn from the SRD data by name; the server keeps just `name` and `open`), the "who's here" detail,
the DM's Encounters drawer (`drawerGroups`: saved encounters, Whiteboard encounter nodes, the Bestiary) and
`startFight`, which resets the DM's combat (`systemData.dnd5e.dm.combat`), adds the monsters and each online player's
character (`team.dnd`), rolls initiative and publishes it with `publishCombat`. Encounter buttons use the server's
`encounter` and `monster` sources. The sidebar is hidden on the hub (`html.hub-full`) and every page is in the "All
pages" menu (`openPagesMenu`, built from the manifest's nav). The roster (`/api/roster?token=`) gives the DM each
online player's character trimmed by `roster_pc` (name, classes, level, HP, AC); the Whiteboard's D&D Random
encounter is sized from it (`currentDndParty` in js/planner/partyLevel.js). js/ambience.js `buildLavaAmbience` is the
D&D soundscape; app.js starts it for dnd5e campaigns.

## The D&D Map editor

A D&D campaign's Map editor (`mapeditor`, js/views/mapEditor.js) is js/planner/mapsTab.js in its D&D layout
(`shared.system === "dnd5e"`): mapsTab still builds the map itself (pan, zoom, labels, tokens, fog, the hub's copy), and
js/planner/mapChrome.js draws everything around it from `api.state()`: a top bar (home, title, the map's name which opens
the Maps drawer, and for the DM whether the map is on the hub), one bottom toolbar like the hub's (Move, Label, Area and
Mist tools on a sliding pill; zoom; label text; the Labels, Players and Fog drawers) and a short bar above it for the
tool in use. The Area tool draws on the editor's own stage: `areaDraft` (mapView.js) holds the corners and their outline,
a tap near the first corner closes the shape, and `saveAreas` sends the list to `/api/partymap/live` like the hub's full
map does. Each part remembers a signature of what it drew, so the poll of the hub's copy (every 4s) redraws nothing
that didn't change. The Pokémon editor and the Whiteboard's Maps drawer keep the classic layout, now sharing the same
actions (`publishMap`, `setFog`, `addToken`...) and a 30-second roster cache instead of asking for the players each time
the panel drew. Phone: the toolbar scrolls sideways above the wheel dot and the drawers are bottom sheets. The editor draws the same
coordinate grid as the hub's full map (`mapGrid`, `colName`: letters above the map's top edge, numbers left of its left
edge, sized by `--inv` so they keep their size as you zoom) and shows the grid square under the pointer. On the hub,
`mountHubMap(..., { playerView: true, openEditor })` (D&D campaigns) loads the map as a player does, never with the DM
token, so hidden places and the DM's fog never show and there are no area tools; pressing the minimap (or the Map button)
sends a DM to the Map editor instead.

## Places

A D&D DM's Whiteboard has a **Place** card (`type: "place"`, js/planner/places.js): name (`title`), type (`placeKind`), a line it
is known for (`known`), a description players read (`body`) and the DM's own notes (`dmNotes`). The Map editor's Places drawer
lists the cards and drags one onto the map (`application/x-map-place`; the Place button does the same on a touch screen),
which makes a map label linked to the card (`pin.placeId`, and `node.mapLink` the other way). A label takes only
`pinFields(node)`: name, type, known-for, description, and the type's icon and colour. `syncPlacePins()` (placeSync.js) copies
a card's edits to its labels and to the hub's copy of the map: it runs when a place card is edited and when the Map editor
opens, and a label whose card was removed stays as a plain label. The server keeps `kind` and `known` on a label
(`clean_map_pins`) and sends players only the labels the DM revealed. **The DM's notes are never part of a label**: they
stay on the card, `sharedPart` strips them from a shared board, and the Map editor shows them to the DM alone.
The area a label is in is not stored in what players get: `hubMap.js drawPlaceCard` works it out from the live map's areas
(`areaAt`) each time, and says "In <area>." only when the label is inside one. The Map editor keeps `pin.area` locally
(`syncPinAreas`) so the Whiteboard card can say the same.

## Widgets, and places on the hub

A D&D hub's **Widgets** pull-out (quick bar, `js/hubKits/dnd.js widgetsPanel`) puts smart widgets and (for the DM) places on the
board by drag or +. They are hub items: `{ type: "widget", widget: "positions" | "vitals" | "weather" | "turn" | "order" | "mine" |
"combatdm" | "battles" | "here" | "online" | "dice" | "purse" | "clock" }` and `{ type: "place", name, kind, known, note, icon, color, pin }`
(`HUB_WIDGETS`, `clean_hub_item`). Do not call a widget's id `w`: the hub measures every item by `w` and `h`. The server limits
who places what (a place, the weather widget and the combat-control widget are the DM's; anyone places the rest) and cleans the
weather widget's `data` (weather, temp, time, day, note: the DM sets it, everyone sees it).

`js/hubKits/widgets.js` holds the widgets: `load()` fetches what one shows from a cache shared by every widget (one request
per source every few seconds), `view()` draws it, and a card redraws only when its model changes. A widget asks the server as
the person looking (the map as a player gets it, or the DM's view for a DM; the combat as published), so putting one on the shared
board never shows anyone more than they could read elsewhere. The combat page's player view became the Whose turn, Initiative
order and My character widgets, and its DM controls the Combat control widget (the full tracker is still its own page); ending a
fight posts how it went to the battle log, which the Recent battles widget shows.

**Travel.** Dropping a player on a place card, by dragging their character card there or a row from the Where everyone is widget
(`application/x-hub-player`), sends `/api/hub/op { op: "travel", itemId, who }`. The server finds the place's label on the shared
map (`place.pin`, hidden labels too), moves that player's token there and clears the mist round it (`move_map_token`, shared with
`/api/partymap/move`). You can only move yourself; the DM moves anyone. Where the label is comes from the map, never the client.
The character then **dissolves** into the place (a card dropped on it is deleted; a row or the badge shows a ghost that shrinks into
it: `dissolveInto` in hub.js). In Where everyone is, a player standing on a label the viewer can see reads "At <place>", and the
name is a link: players get the full map on that label (`hubMap.openPlace`), the DM gets the Map editor there (`mapeditor-open`).

**Sizes, pages and paper.** A widget has a `size`: `1x1`, `1x2` (two wide) or `2x2` (`HUB_WIDGET_SIZES`), set by dragging the corner
grip; `js/hubKits/paper.js` (pure, tested in `tests/js/paper.test.mjs`) holds the sizes in board units, the page geometry and
snapping. A **page** (`{ type: "page", title, pageKind: blank | battle | sheet | log, x, y }`, at most 12) is a sheet of A4 paper
drawn in `pageLayer` under the drawings: ruled lines, a torn edge (`tornPolygon`, seeded by the id), a header that drags the whole
page. Anything whose corner is on a page is *attached* to it: the **server** sets `item.page` on every put (`hub_attach`, never
the client) and shifts attached items when the page moves (`hub_move_page`; drawings and shapes by every point). A page's owner or
the DM moves it; deleting one leaves its contents on the bare board. Text started on a page snaps to its lines (`snapToLine`) and
is drawn in the pen colour; when it is committed `flowText` wraps it onto the next line at the page's edge and routes it round widgets, cards and
earlier writing (one text item per run); a page stays under everything on it (`.hub-pages` is its own layer, no z-index on a lifted page); widgets, places and cards dropped on a page snap to its 2×3 grid of cells (`snapToCell`). The Widgets pull-out's
Pages tab places Blank, Battle tracker, Character sheet and Area log, the last three arriving with widgets in their cells
(`PAGE_TEMPLATES`). A widget is small (160 units for a 1x1) and a page large (900 x 1273, A4), both clean cards in the hub's glass
style; each widget has an accent colour (`w-<id>` in css/hub.css). A widget's `view(model, ctx, getItem, st, size)` draws less at
1x1 (the one number or name that matters), more at 1x2 and the detail at 2x2; changing the size redraws it (`tick()`).

**No overlap.** Widgets and places never cover each other: a drop, a new widget or a widget that grew over its neighbours settles
them beside what they overlapped (`resolveOverlap` in paper.js, in a free cell on a page; `spotFor`, `pushAside` in hub.js). A
character card dropped on a place is exempt: that is travel.

**Saved pages.** Dragging a page's header onto the Pages tab (it slides out while you drag) puts the page away with what is on it
(`packPage`, kept per campaign in this browser's localStorage, up to 20 pages of 80 things). Saved pages are listed under the
templates, with a × to delete them, and are dragged or added back out (`unpackPage`, fresh ids).

**Motion** on pages and widgets follows the Graphics setting (`html[data-gfx]`, css/hub.css "motion, by the Graphics setting"):
Low has none, Medium adds pages rising in, widgets gliding to where they snapped, smooth resizing and a pulse when a widget's
numbers change, High adds a slow shine; reduced motion turns all of it off.

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

## Eggs, move rules and hub sounds

- Eggs: the DM action `giveEgg` stores `state.eggs[id]` (with the species, never sent to the player) and queues a `giveEgg`
  directive; the player's save gets `save.eggs`. `POST /api/egg/hatch` (owner of the egg only) reveals the species once;
  `js/eggs.js` makes the level-1 Pokémon with `startingMoves`.
- Moves: `js/levelUp.js` `canKnowMove` — level-up moves at or below the Pokémon's level, or egg moves. The team page
  refuses other typed moves and marks existing ones (`.move-invalid`).
- Hub sounds: `js/hubSound.js` synthesises everything with Web Audio (no files), pans by screen x, and runs through a
  generated reverb. The AudioContext is made on the first gesture; `pkdnd-hub-sound` = "off" turns it off on a device.
  It also has `itemSound` (a sound per bag section, played on the bag's dragstart), `moveSound` (per type, a launch and
  a hit timed by js/moveFx.js) and `playCry`: the real game cries streamed from the PokeAPI cries collection by sprite id
  (Ogg), or Pokémon Showdown's MP3 by name where Ogg won't play. Those two hosts are the only extra `media-src` in the CSP;
  cries are never stored in the repo or on the server.
  Levels: the game cries are mastered ~40 dB hotter than the hub's sounds, so the Ogg runs through the hub mix
  (crossOrigin; PokeAPI allows it) at CRY_GAIN with a little reverb; Showdown has no CORS, so its MP3 just plays very
  quietly. Item and move sounds use only sine/triangle tones and noise filtered below ~3kHz, and each has a LEVEL trim
  measured with `renderSound` (an OfflineAudioContext render) so they all sit within ~1 dB of a hub click / drop.
- Move animations: `js/moveFx.js` draws on a throw-away `.move-fx` layer inside `.battle-stage` (transform/opacity
  only, Web Animations). battleview.js plays your own move before submitting it (the HP drops on the hit), and on a poll
  plays new "used <move>" Battle Log lines (`parseMoveLine`) on the old scene before drawing the new HP. Slots carry
  `data-cid`. Reduced motion gets a soft glow only; Low graphics halves the particles.
- Hub cards for a player's own Pokémon (`fillTeamMon` in js/hubDex.js, class `team`) show the whole sheet.
- Draw on a phone: the pen's colours sit on a half circle round the wheel dot (`.pen-arc`), with one brush-size button that
  opens into the three sizes; on a computer the same size button is in the bar above the tools.
- The phone wheel (`js/mobile/wheel.js`) is paged by group: a sideways swipe turns exactly one page (flick or a third of
  the way), never more, with dots for the pages.
- The Map editor is its own page for Pokémon campaigns (`js/views/mapEditor.js`, hub button left of the Whiteboard); a
  Whiteboard node's map link opens it through `sessionStorage` "mapeditor-open". D&D 5e keeps it as a Whiteboard drawer.
- Rayquaza's constellation (`js/constellation.js`, one SVG: a faint outline image `sprites/sky/rayquaza-lines.png` plus gold
  four-point stars along the body, star-chart style) is in the cosmic sky (`cosmicParallax.js`), the hub's
  starfield and the sign-in page (`loginGate.js`, always cosmic, not saved as the device theme).
- The nebula (`js/nebula.js`: violet smoke clouds, breathing light flares, drifting shards; CSS animations on
  transform/opacity only) sits behind the stars in the cosmic sky and the hub. The star layers also rise slowly forever.
- The hub sky zooms with the board about the same point (stars grow and shrink in place), and pans with parallax.
- The Map editor page uses `renderMapsTab(..., { hubLayout: true })`: the map fills the page over the sky, sections
  (Your maps, Labels, Hub map) open as glass panels from a hub-style bar (`mountHubLayout`).
- A newly published hub map starts with fog on; republishing the same map keeps its fog.
- The app blocks the browser's right-click menu except in text boxes (`app.js`). The Bag's add box uses `makeCombo`,
  its list moved onto the page so it isn't clipped.
- Wheel input on the boards (hub, Whiteboard, Map editor, hub map) goes through `js/wheelIntent.js`: a touchpad's two-finger
  scroll pans, a pinch (ctrlKey) or a mouse wheel notch zooms; a gesture keeps its meaning until the wheel goes quiet.
- The hub's constellation only scales about its centre when zooming (it drifts a fifth of a pan).
- Opening or reloading a campaign always starts on the system's `defaultView` (the hub for Pokémon), not the page in the URL.
- Performance: the stars (hub and cosmic sky) are one screen-sized canvas, `js/starCanvas.js` (the old CSS star tiles were
  many screens of animated texture: hundreds of MB of graphics memory on a phone). The graphics setting `js/gfx.js`
  (`<html data-gfx>`, set before paint in layout-init.js; Settings -> Appearance -> Graphics, default medium) gates the rest:
  medium/low drop backdrop-filter blur (re-blurring a moving sky every frame), nebula drift and most shards; low also
  stills the stars and drops comets, trails and the constellation twinkle. The edge mist only animates on a visible side.
- A player's trainer and each of their Pokémon can be on the hub once: cards carry a `link` ("trainer" / "mon:<id>"), the
  server's hub "put" drops any other card with the same owner and link, and dropping one that's already there moves it.
  `syncLinkedCards` (hub.js) rewrites your linked cards when your sheet changes (details, HP, moves, held item).
- Hub panning is transform-only: `applyView` moves the dot grid and star layers with `transform`/`translate` (wrapped by a
  tile) and only touches CSS variables when the zoom changes, on those layers, never on `.hub` (that restyled every card).

## Encounter levels on the Whiteboard

`js/planner/partyLevel.js` works out the spawn level: the DM's roster (`/api/roster?token=`, which marks DMs with
`dm: true`) gives each player's party; each player counts as their party's average, the party as the average of those,
plus 1.5 per extra player (max +8). Without the DM token it falls back to your own party. The pure helpers
(`encounterLevel`, `partyAverage`, `spreadLevels`) are in pokeGenerators.js (tested in tests/js/partyLevel.test.mjs).
boardView.js passes the level to the wild / trainer / gym generators (gym +2), stores it as the node's `level`, and the
Level box calls `relevelTeam`: new levels spread around it (ace highest), new moves only for generated (`auto`) Pokémon.

## Audio buses and the ambience

js/hubSound.js builds one graph: master (0.32 x the Master slider) -> compressor, a shared echo + reverb, and three
buses (sfx, ambience, pokemon), each a dry gain and a reverb send set from its slider (`pkdnd-audio`, percent, squared
for the gain). `renderSound(play)` renders any sound offline for measuring; its callback gets `{ ctx, ambience }`.
js/ambience.js (`buildAmbience`) is the background: a four-voice pad gliding through four chords, wandering noise, and
far-off bells, all moved by AudioParam LFOs; it starts from app.js for Pokémon campaigns once the context is running
and stops when sound is turned off. The whole context is suspended in a hidden tab.

## Battle bench and switching

A combatant may carry `benched: true`: it's off the field (not drawn, not in the turn order, not a target) but still
counts for a side being wiped out. Battle Control's roster has an Out box; a player's second Pokémon is added benched.
Player actions (`/api/fullturn/playeraction`): `lead` (draft/VS only, own Pokémon, not a turn), `switch` with
`toCombatantId` (own benched Pokémon; the old one is benched, the new one gets `cameInFor` and holds the turn; it's the
turn's choice), `replace` (live, after one of yours on the field faints; free). A player's move may not change
`benched`. fullTurnSave treats a turnId handed to the `cameInFor` Pokémon as the same turn, so the choice stands; Next
Turn clears `cameInFor`. In DM mode the battle screen also plays combatants whose sourceId is the DM's own trainer id.

## Map areas, the minimap ring, touch dragging

The shared map (`partyMap`) has `areas`: [{id, name, pts?, x, y, w, h, color}] in map units, cleaned by `clean_map_areas` (`pts`: a shape of 3-60 corners, with x/y/w/h its bounding box; an area without `pts` is a plain rectangle).
The DM changes them with `/api/partymap/live` sending only `areas` (live now updates pins, tokens and areas each only
when sent); publishing the same map again keeps them. `js/mapView.js` draws the grid (`mapGrid`, `gridRef`) and the
areas under the fog; `areaAt` finds the smallest area holding a point, which `js/hubMap.js` writes round the minimap's
ring. `js/mobile/touchDrag.js` turns a press-and-hold on any `[draggable=true]` into synthetic dragstart / dragover /
drop / dragend events (with a stand-in DataTransfer) on the phone layout, so existing drop targets work with touch.

