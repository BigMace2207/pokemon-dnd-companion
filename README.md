<div align="center">

# Pokémon D&D Companion

**A tabletop companion for Pokémon D&D: Pokédex, calculators, trainer sheets and live multiplayer with a DM Control Centre.**

![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![Dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)

<img src="docs/images/pokedex.jpg" alt="Pokédex" width="820">

</div>

## Features

**For players**
- Pokémon campaigns have no sidebar: the Hub is home, every page is a round button on it (trainer pages and calculators
  down the left, the planner, library, Control Centre and admin down the right), the Pokédex and Move Dex slide out,
  the Rulebook, Type Chart and Move Tier Guide are pull tabs beside the log, and the top bar's home button comes back
- The Hub: a shared whiteboard every player lands on, with notes, drawings and everyone's cursor live (in each player's
  own colour, picked in Settings > Appearance, with their name above it). The DM drags encounter buttons onto it, and
  they are the only way into the Battle screen. Pings (P or Alt+click) point something out to everyone, notes can be
  recoloured and resized, the corner buttons zoom and fit the board, clicking a player's avatar jumps to them, and
  Ctrl+Z takes back what you last added. The board has a soft edge a little way past its content, which moves out as
  things are placed near it, so you can't get lost in empty space. Text is typed straight onto the board. The DM can fade in one of their maps,
  blurred, as the hub's backdrop. On the hub the app's top bar becomes round buttons (menu, theme, Settings, account),
  and Settings lives behind the gear there rather than in the Pokémon sidebar. Without a backdrop the hub is "cosmic",
  with twinkling stars. The Pokédex and Move Dex slide out from the hub's left edge, and any Pokémon or move can be
  dragged onto the board as a card. Pinging can target a note, card or button: hover to highlight it, click to ripple
  round it. The Campaign Planner and Library are buttons down the hub's right-hand side, and the planner shares the
  hub's dark glass look (new boards start on the "Cosmic" background)
- Pokédex and Move Dex covering 1301 Pokémon, with forms, evolutions and stats
- Stat and Damage calculators that load your saved Pokémon
- My Team, Bag and Trainer Sheet built from the rulebook, with named saves
- Graphical battle view with synced multiplayer battles

**For the DM**
- Control Centre with directives, NPC and wild libraries, messaging and logs
- Hub encounter buttons: an NPC trainer or wild Pokémon from the libraries, or an encounter rolled in the Campaign
  Planner. Hovering shows the first Pokémon's level, with its sprite or a question mark (the DM chooses); the DM's click
  starts that battle with every online trainer's lead Pokémon and opens Battle Control
- Per-campaign invite code and DM password

**Dungeons & Dragons 5e** (pick it when you create a campaign)
- Character builder and a full sheet: abilities, skills, saves, HP and death saves, spell slots and spellbooks, inventory and encumbrance, features and choices, level-up and rests, multiclassing
- SRD 5.1 (2014) and SRD 5.2 (2024) compendia: spells, monsters, equipment, magic items, classes, races/species, backgrounds, feats and rules text
- Dice roller with macros; live party view; initiative and combat tracker the DM can publish to players
- The DM can share a map with the table, reveal places one by one and place the players on it; whiteboard nodes link to places on maps, and each session can be viewed on its own
- The D&D rules version (2014 or 2024) is chosen by the campaign owner for the whole table (when creating the campaign, or in Settings > Campaign), so players never end up on different books
- Rule keywords anywhere (conditions, skills, damage types, racial traits...) link to their Rules entry with a hover card, and are coloured and bold on the Rules page; the character builder saves your progress so you can continue later
- DM screen, encounter builder with XP budgets, and campaign notes

**Everywhere**
- Campaign Planner (both games): one full-screen whiteboard, no tower behind it. A slim rail on the left adds nodes (notes, checklists, stickies, expandable dungeons with per-room notes, and every generator: Pokémon wild encounters, trainers, gym leaders, routes; D&D NPCs, encounters, taverns, loot...). Drag them around an endless board that grows as you near its edge, change or upload the background, and circle groups of nodes (box or freehand) into colour-coded "Session N" regions; a node can be in several sessions. The Notebook drawer holds searchable Markdown notes that can also be NPCs, quests (with status), locations and session recaps, with an export to Markdown (it replaces the old Campaign Notes page and imports its notes once). Maps, scenarios (DM) and party plans (DM) open as drawers. Players share their boards, notes and checklists with the DM automatically. In Pokémon campaigns, trainer, gym leader and wild encounter nodes have Trainer and Team slots like Scratch blocks: bring the DM's NPC trainers and wild Pokémon in with the Libraries button and drag them in (a trainer gives the node its name, sprite and team; Pokémon join the team, up to six, and can be dragged to reorder or back out). The hub battles those exact teams
- Library: add your own PDF, EPUB, Word, text, Markdown and HTML books and read them in a built-in e-reader (they stay on your device; accounts the admin allows keep them on the server, private, on every device they sign in on)
- Maps are stored on the server, so they follow you to every device: up to 10 per campaign (15 MB each) for everyone, unlimited (100 MB each) for accounts the admin allows
- Cosmic theme: every Pokémon D&D page uses the hub's look (deep space, glass cards, white pill buttons); D&D campaigns keep the device's theme choice
- Lava Tower theme for D&D campaigns (flame button in the top bar, or Settings → Appearance): grey brick tower, lava drips, cracks of light and crumbling stone; "Calm" turns the motion off
- Pokémon D&D Rulebook page, rendered from the Obsidian vault. In Pokémon campaigns the Rulebook and the Type Chart are
  also pull tabs (RULES, TYPES) on the right edge beside LOG, so they open over any page

**Online**
- Accounts with email, Google or Apple sign-in; campaigns appear after login
- Signing in with a password on a new device asks for a 4-digit code sent to the account's email
- Admin console for the site owner: every account and campaign, storage and disk use, permission switches, and a
  command line (`grant`, `revoke`, `perms`, `signout`, `who`); deleting a campaign there moves it to a restorable
  "Deleted campaigns" list instead of erasing it
- Autosave, hourly backups and automatic recovery
- Trainers Online with live presence

**On any device**
- Tuned for 1920×1080, 3440×1440 and iPhone
- `/` focuses search, `Esc` closes floating panels

<p align="center"><img src="docs/images/team.jpg" alt="My Team" width="620"></p>

## Quick start

```bash
python server.py            # then open http://localhost:8850
python -m unittest discover -s tests -v    # server tests
node --test tests/js/*.test.mjs            # D&D rules engine (Node 20+)
```

To try a branch or fork without touching real saves: `python tools/test_server.py [folder]` runs it on port 8860 with its own empty data (`--lan` for your phone, `--reset` to start fresh). `python tools/seed_test_campaign.py` then fills that test server with a DM, seven players with 3rd-level characters and personal motives, and a twelve-session planner (three played), and `node tools/keep_table_online.mjs` keeps the seven players showing as online in Party. For demos, `python tools/seed_showcase.py` builds the same campaign run long: eight 7th-level characters, 12 of 24 sessions played, homebrew, saved encounters, a published fight, a party map, battle-log rolls and messages to the DM (`--base <url> --live` to put it on a real server; `keep_table_online.mjs --showcase` keeps those players online). Seed passwords stay outside the repo, in your home folder.

No packages to install and no build step: the server is standard-library Python and the front end is plain ES modules.

## Hosting

Bind to loopback behind an HTTPS proxy and configure through environment variables such as `PKDND_BIND`, `PKDND_BACKUP_DIR` and `PKDND_GOOGLE_CLIENT_ID`. See [docs/hosting.md](docs/hosting.md).

## Project layout

```
server.py        API, campaigns, accounts, autosave, backups
auth.py          password hashing, Google/Apple token verification
index.html       app shell
js/              router, network client, views, per-game systems
css/             style.css (base), dnd5e.css, library.css, lava.css + generated lava-bricks.css
data/            rules data
tools/           data and sprite download scripts, export_dnd5e.py (SRD data), export_rulebook.py (vault -> JSON), make_brick_tiles.py
desktop/         optional desktop-window build (not used by the live site)
sprites/         Pokémon art (from PokeAPI, see sprites/README.md)
tests/           server test suite (Python) and rules-engine tests (tests/js)
docs/            hosting, security, notes
```

## Security

The server trusts the signed-in session, never an id sent by the browser. Only an allowlist of static folders is served, and the save file is never reachable. See [docs/security.md](docs/security.md).

## Documentation

- [docs/architecture.md](docs/architecture.md): the shell and game-system split
- [docs/hosting.md](docs/hosting.md): running and deploying
- [docs/security.md](docs/security.md): the security model
- [CLAUDE.md](CLAUDE.md) and [docs/claude-project.md](docs/claude-project.md): working on this with Claude
- [docs/guide.md](docs/guide.md): the original long-form notes (historical)

## Third-party material

- D&D rules data: the 5e-database project, from the System Reference Document 5.1 and 5.2 by Wizards of the Coast, licensed CC-BY-4.0 (attribution is shown in the app). Refresh with `python tools/export_dnd5e.py`.
- PDF.js (Mozilla, Apache-2.0) is vendored unmodified in `js/vendor/pdfjs/` for the Library's PDF reader.

## Disclaimer

An unofficial fan project, not affiliated with or endorsed by Nintendo, Game Freak, The Pokémon Company or Wizards of the Coast. Pokémon and its characters are trademarks of their owners. Species data comes from [PokeAPI](https://pokeapi.co). The code and the Pokémon D&D rules are by the author and released under the [MIT license](LICENSE); All Pokémon art is provided by PokeAPI and originates from Nintendo, Game Freak and The Pokémon Company ([details](sprites/README.md)); it stays their property and is not covered by the license.
