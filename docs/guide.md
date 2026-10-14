> **Historical notes.** This is the original long-form README, kept verbatim. Parts of it
> (for example the Initiative Tracker, the desktop app, and the "Honest limit" note under
> Accounts) describe things that have since changed. For current information see the
> [README](../README.md) and [architecture](architecture.md).

---

# Pokémon D&D Dex

A standalone web app version of `pokemon_full_dex.xlsx` — the Pokédex,
Move Dex, calculators (Stat / Damage), plus a
digital take on the character sheet (My Team, Trainer Sheet) built from the
Pokémon D&D rulebook. The server is plain Python with no third-party
packages. You sign in with an account (email + password, or Google) to
reach your campaigns; see "Accounts" and "Security model" below. Works the
same on Windows and Mac.

## Game systems (Pokémon D&D today, regular D&D next)

The app is a shared shell (campaigns, sync, settings, battle log, dice tray)
with pluggable **game systems**. Each campaign picks its system when it is
created. Pokémon D&D is complete; regular D&D is a preview with a dice roller
and ability scores. See **ARCHITECTURE.md** for the layout and how to add a
system.

## Campaigns, hosting and security

- Every campaign has its own state, an **invite code** (10 characters) and a
  random **DM password**. The owner sees both on the Settings page and can
  regenerate them. Nothing is stored in the source code.
- Only `index.html`, `manifest.json` and the `css/ js/ data/ sprites/ sfx/
  assets/` folders are served. `.git`, the save file, Python files, logs and
  build files return 404 even if the whole folder is hosted.
- Wrong invite codes and DM passwords are rate-limited (10 failures per 5
  minutes per client). Behind a reverse proxy (nginx, Caddy...), set the
  environment variable `PKDND_TRUST_PROXY=1` so the real client address is
  used; without it everyone behind the proxy shares one limit.
- DM sessions last 12 hours. A player's move in a live battle is only
  accepted on their own turn, and can only lower the other side's HP.
- Migrating a very old (pre-campaign) save file: set
  `PKDND_LEGACY_DM_PASSWORD` to the old password before starting the server.
  Otherwise a new password is generated and printed once.
- Hosting: run `python server.py [port]` on an always-on machine behind HTTPS
  and point `REMOTE_SERVER_URL` in `desktop.py` at it. The built `.exe` only
  loads that site, so most code changes go live by updating the server's
  copy; rebuild the `.exe` only when `desktop.py` itself changes.

## Move damage rules

Live battle and the Damage Calculator roll the same dice: a move's tier pool
**summed** (for example 4d8 is four d8s added up). Moves the spreadsheet has no
dice for (Seismic Toss, Super Fang, OHKO moves, Z-moves, ...) are described in
`data/special_moves.json`; see ARCHITECTURE.md.

## Running it

**The main way to open this app is the built `.exe`** (Windows) —
`dist\Pokemon D&D Companion\Pokemon D&D Companion.exe` — not the `.bat`
launcher or `python desktop.py` below. There's a **"Pokemon D&D
Companion" shortcut on the Desktop** pointing right at it; use that.
It needs no Python install on whatever machine runs it, starts faster,
and doesn't leave a console window behind it. See **Desktop app:
standalone build** further down for what to do if you ever need to
rebuild it (e.g. after pulling a code update).

Other players join from their own phone/laptop browser at the
`http://192.168.1.x:8850`-style address printed in the window's title bar
(same Wi-Fi/router as this computer). Just closing the window shuts the
whole thing down — nothing else to stop.

Running from source (`Start Pokedex App.bat` / `python desktop.py`) still
works and is what you want while actively editing the app's own code —
but note it saves to a **different** per-user data location than the
built `.exe` does (see the standalone-build section below), so the two
don't automatically share a save. Use **Trainer Sheet → Backup to a
File → Export/Import Save** to carry your character between them.

```bash
python desktop.py      # Windows, from source
python3 desktop.py     # Mac, from source
```

(or `python server.py` / `python3 server.py` for the old plain-browser-tab
version, with no extra package needed at all.)

## Sharing save data between machines (Google Drive, Dropbox, ...)

Everything the app remembers — Trainers Online, the battle, NPC/Wild
libraries, your own team — lives in one file next to `server.py`
(`.server_state.dat`) when you run it this way (from source, via
`desktop.py`/`server.py` directly, not the standalone build below). So to
use the same save on a PC and a Mac: put this whole `app` folder in a
synced Google Drive/Dropbox/OneDrive folder, and run it from there — via
the launcher scripts above, or `python desktop.py` — on whichever computer
you're at. Python (and, the first time, that one small extra package) still
needs to be installed on each machine, but the save data itself is just a
file in that synced folder, so both machines see the same campaign.

**Only run the app on one machine at a time**, and give the sync client a
moment to finish (its "up to date" state) before switching computers —
two machines both writing the same file mid-sync at once is exactly the
kind of thing that produces a Drive/Dropbox "conflicted copy" and can lose
data. This doesn't apply within a single session: any number of players'
own phones/laptops connecting to that one running instance over Wi-Fi
(Trainers Online, the Battle screen, etc.) is the normal, fully-supported
way to play — the caution above is specifically about the app process
itself running on two computers at once.

## Desktop app: standalone build (one machine, no Python needed)

`build_desktop.py` packages `desktop.py` into a real double-clickable
Windows `.exe` or Mac `.app` with [PyInstaller](https://pyinstaller.org/) —
nothing to install on the machine that runs it. This is a **different,
separate thing** from the section above: a build like this saves its data
to that one machine's own per-user folder (`%APPDATA%\Pokemon D&D
Companion` on Windows, `~/Library/Application Support/Pokemon D&D
Companion` on Mac), not next to itself — so a Windows build and a Mac
build never share data with each other, and this route can't give you one
save shared across a PC and a Mac. Use it when you want a no-Python-needed
app for a single computer; use the section above when you want the same
save on more than one computer.

```bash
python -m pip install -r requirements-build.txt
python build_desktop.py
```

That produces `dist/Pokemon D&D Companion/` — a folder with the app's
.exe (Windows) or .app (Mac) plus everything it needs. Hand the whole
folder to whoever's running the game; PyInstaller only builds for the OS
it's run on, so a Mac build has to be built on an actual Mac. The *content*
folders a DM manages by hand (`sfx/`, `sprites/backgrounds/`) still live
next to the built app, same as running from source — only the autosave
file itself is redirected to that per-user folder.

## Updating the data

The app reads from JSON files in `data/`, generated from
`pokemon_full_dex.xlsx`. Whenever you edit the spreadsheet, re-export:

```bash
python export_data.py      # Windows
python3 export_data.py     # Mac
```

then refresh the browser tab (no need to restart the server).

This step needs the `openpyxl` package (`pip install openpyxl` /
`pip3 install openpyxl`) and the actual `pokemon_full_dex.xlsx` file one
folder up — only required if you're re-exporting. Just running the app
(the section above) doesn't need either; the exported `data/*.json` is
enough on its own.

The held-item database (see below) is separate — refresh it with:

```bash
python export_items.py      # Windows
python3 export_items.py     # Mac
```

This one needs the `requests` package (`pip install requests`) and an
internet connection (it pulls from [PokeAPI](https://pokeapi.co)), but
again only to rebuild it — the app just reads `data/items.json`.

Battle sprites (see **Graphical Battle view** below) are a third, separate
export, since they're images rather than JSON and only need refreshing when
new dex entries get added:

```bash
python export_sprites.py      # Windows
python3 export_sprites.py     # Mac
```

Needs an internet connection (pulls from PokeAPI's sprite repo) but only to
rebuild `sprites/`; the app just serves whatever's already there, and the
run is safe to interrupt/re-run since it skips files it already has.

## What's in here

| File/folder | Purpose |
|---|---|
| `export_data.py` | Reads the .xlsx and writes `data/*.json`. Re-run after editing the spreadsheet. |
| `export_items.py` | Pulls the held-item database from PokeAPI into `data/items.json`. |
| `server.py` | Local web server + sync hub (stdlib only, no dependencies) — serves the app on your LAN and answers the `/api/*` multiplayer/DM endpoints. |
| `.server_state.dat` | Autosaved, lightly-obfuscated server state (Trainers Online, Battle Log, NPC/Wild libraries, Music Board, etc.) — generated by `server.py`, safe to delete to reset everything. |
| `sfx/` | Drop `.mp3` files here for the Control Centre's Sound Effects tab. |
| `index.html`, `css/`, `js/` | The app itself — plain HTML/CSS/JS, no build step, no framework. |
| `dist/Pokemon D&D Companion/` | The built app — **the main way to run this now** (Desktop shortcut points here). Rebuild with `python build_desktop.py` after a code update. |
| `Start Pokedex App.bat` | Double-click launcher for Windows, running from source instead. |
| `Start Pokedex App.command` | Double-click launcher for Mac, running from source instead. |
| `assets/logo.png` | The logo shown top-left in the header. |

## Phone/tablet access — firewall

The first time another device connects, your OS will likely ask permission:

- **Windows:** look for a "Windows Defender Firewall has blocked some
  features of Python" popup and click **Allow access**. If it didn't
  prompt, make sure this computer's network is set to **Private**, not
  **Public** (Settings → Network & Internet) — Windows silently blocks
  unsolicited inbound connections on Public networks.
- **Mac:** look for a "Do you want the application 'python3' to accept
  incoming network connections?" popup and click **Allow**. If you don't
  see it, check System Settings → Network → Firewall — either turn it off
  for trusted home networks, or add an allow rule for `python3`.

Either way, your phone/tablet needs to be on the same Wi-Fi network as this
computer (not a guest network — those usually block device-to-device
traffic separately).

## iPhone app (no App Store needed)

There's no App Store listing — this is a page served from whoever's running
the DM's computer, not something published anywhere — but iOS can still
install it as a real home-screen app with its own icon, launching full
screen with no Safari address bar:

1. On the iPhone, open **Safari** specifically (Chrome/other iOS browsers
   can't do this — they're all really Safari under the hood on iOS, but
   only Safari itself exposes the option) and go to the same
   `http://192.168.1.x:8850`-style address other players use (see
   "Phone/tablet access" above).
2. Tap the **Share** button, then **Add to Home Screen**.
3. Give it a name and tap **Add**. The icon now opens straight into the app,
   full screen, no browser chrome.

This only works while the app is actually running on someone's computer and
your phone's on the same Wi-Fi — there's no offline mode, since the whole
point is everyone sharing one live game state. If the DM's computer isn't
running the app (or you're not on that Wi-Fi), the icon just fails to load,
same as any bookmark to a page that isn't there.

Changed the logo? Re-run `python generate_app_icons.py` (needs Pillow:
`pip install pillow`) to regenerate the home-screen icon files.

## Settings page

Per-device preferences (nav → **Settings**, always visible even if you hide
everything else) — none of this is shared with other players, it's all
`localStorage` on that one device/browser:

- **Appearance**: System / Light / Dark.
- **Window** (desktop app only): Windowed / Borderless / Fullscreen.
  Windowed and Fullscreen switch immediately; Borderless (no title bar)
  takes effect next launch, since pywebview can only set that when the
  window's first created.
- **Display** (phone/browser, when supported): a manual Enter Fullscreen
  button. Not shown inside the desktop app itself (the Window section above
  already covers that), and hidden entirely on iOS Safari, which doesn't
  support it — use "Add to Home Screen" instead (see above).
- **Sidebar Pages**: show/hide individual pages in the nav on this device.
  Calculators, Move Tier Guide, and Control Centre start hidden; everything
  else starts visible. A page you show (or hide) stays that way on that
  device from then on, regardless of which trainer name you're using —
  hiding a page only removes it from the sidebar list, it's still reachable
  by URL if you know it.

## Changing the logo

The header logo is just `app/assets/logo.png`, sized by CSS, not baked into
any code. To swap it:

1. Replace `app/assets/logo.png` with your new image, **keeping that exact
   filename** (or edit the `src=` path in `index.html` if you'd rather use a
   different filename/folder).
2. It's shown at a fixed height (`.brand-logo { height: 30px; }` in
   `css/style.css`) with the width scaling automatically — a transparent
   background (PNG) reads best on the dark header bar. Change the `30px` if
   you want it bigger/smaller.
3. Refresh the browser tab — no server restart needed.

Right now it's using the `Logo.png` already sitting in your project's root
folder (`D:\Pokemon D&D\Logo.png`), copied in as `app/assets/logo.png`.

## Notes on accuracy vs. the spreadsheet

- All four calculators (`js/calc.js`) are hand-ported line-for-line from the
  spreadsheet's own formulas — same stat growth formula, same damage
  formula, same catch-rate/accuracy math. If you ever change a formula in the
  spreadsheet, update the matching function in `js/calc.js` too (it won't
  pick up formula edits automatically — only value edits, via `export_data.py`).
- **One deliberate deviation:** the spreadsheet's Hit Chance / Catch Chance
  sheets use a "roll *under* your %" rule (`roll×5 <= chance`), which makes a
  *lower* d20 roll better — counterintuitive if you're used to D&D, where a
  big roll is always good. The app flips this to "roll *over* (100 − chance)"
  (`successThreshold()` in `js/calc.js`), which is the mirror image of the
  same probability — Accuracy/Catch % still means exactly what it says — but
  now a bigger roll always helps you. Both sheets in the .xlsx still use the
  original roll-under rule if you ever compare by hand.
- The Damage/Hit Chance calculators' move picker only offers the 808 moves
  in the *Move List* sheet, exactly like the spreadsheet's own dropdown
  (`AllMoveNames`) does — moves without Power/Accuracy/Tier data can't be
  used there in the original file either.
- ~103 newer-generation moves show up in the *Movesets* data (so a Pokémon
  can learn them) but were never added to *Move List*. The app still lists
  them in a Pokémon's "Moves Known" (greyed out, marked "no battle data")
  so nothing learnable silently disappears — the original spreadsheet's
  Pokédex/Move Lookup helper tabs didn't expose this at all.
- The *Movesets* and *Move Index* sheets are the same data sorted two
  different ways (by Pokémon, by move) — the app only needs one copy and
  builds both lookup directions itself.
- **Level, Ability, and Item on the Damage Calculator are new** — the
  spreadsheet's Damage Calculator always used flat base stats and had no
  concept of ability/item at all. The app scales stats to the level you set
  (same formula as the Stat Calculator), and adds Ability (pulled from that
  Pokémon's own real abilities) and Item (pulled from `data/items.json`,
  built by `export_items.py` from PokeAPI) as autocomplete fields.
- **Item effects are partially automatic.** A curated subset of ~55 items —
  see `js/itemEffects.js` — is folded straight into the damage number:
  Choice Band/Specs (×1.5 to the Attack/Sp. Atk stat), Life Orb (×1.3 all
  damage), Expert Belt (×1.2 on super-effective hits), Muscle Band/Wise
  Glasses (×1.1 Physical/Special), the classic type-boosting items/Incenses/
  Plates (×1.2 for matching-type moves), and type-resist Berries (×0.5
  against a matching-type hit). Every item that shows up in the picker is
  labeled `[auto-applied ✓]` or `[reference only]` in the Combatants panel so
  it's always clear which is which, and the exact modifiers used for a given
  calculation are listed under "Item Modifiers Applied" in Combat Math. The
  other ~85 items (crit chance, priority, weather, low-HP-triggered berries,
  status cures, etc.) aren't modeled — those depend on state this calculator
  doesn't track (turn count, move history) or aren't a single damage
  multiplier at all, so guessing would be worse than leaving them for you to
  apply by hand.
- **Ability effects are partially automatic too**, same idea, ~25 abilities
  — see `js/abilityEffects.js`: Huge Power/Pure Power/Hustle/Gorilla Tactics
  (stat boosts), Adaptability (STAB becomes ×2 instead of ×1.5), Technician
  (×1.5 for power ≤60 moves), Overgrow/Blaze/Torrent/Swarm (×1.5 to
  matching-type moves at ≤1/3 HP), Tinted Lens (×2 on not-very-effective
  hits), Levitate and the *-Absorb/-Drive/-Rod/Flash Fire/Sap Sipper family
  (full immunity to one type), Wonder Guard (blocks anything that isn't
  super effective), Thick Fat/Heatproof/Dry Skin (type-conditional
  resist/weakness), Solid Rock/Filter (×0.75 on super-effective hits), and
  Fur Coat/Ice Scales (stat boosts). The Overgrow-family abilities are why
  the Damage Calculator has an optional "Attacker Current HP" field — leave
  it blank and they simply won't trigger, same as a healthy Pokémon.
  Everything else (crit chance, weather, terrain, contact, turn order,
  "first turn out" checks, etc.) is still reference-only, labeled the same
  `[auto-applied ✓]` / `[reference only]` way as items.
- **Status conditions** (`js/statusEffects.js`) now show up on the Damage
  Calculator too, for both sides. Burn is auto-applied (halves Physical
  damage); Poison/Paralysis/Sleep/Freeze/Confusion aren't (they change
  action economy — skip a turn, hit yourself — not the damage formula), but
  each gets a "Roll \<Status\> Check" button that runs its d-whatever roll
  (e.g. Paralysis's 25% full-paralysis check) so you're not doing it by hand
  either.
- **The Damage Calculator now checks accuracy first** ("Step 1: Accuracy
  Check" → "Step 2: Damage Roll"), folding in what used to be a separate
  trip to the Hit Chance Calculator — matches the rulebook's worked example
  turn (declare → accuracy → damage → apply) in one screen. A miss shows
  "MISS — no damage" and skips straight past the math. The standalone Hit
  Chance Calculator is still there too, for a quick check with no
  attacker/defender setup.

## Graphical Battle view

A "Battle" nav item gives players a classic-Pokémon-game-style screen
instead of forms and tables: your lead Pokémon's back sprite bottom-left,
whatever the Dungeon Master's Full Turn console has going on top-right
(front sprite, name, level, HP bar), and a FIGHT / BAG / POKÉMON / RUN
menu at the bottom, all built from real sprite art (`js/sprites.js`, images
under `sprites/` — see `export_sprites.py` above).

This is a *view* onto the DM's encounter, not a second combat engine
running in parallel:

- It polls the same `/api/fullturn` state the DM's Full Turn console
  already maintains (Control Centre → Full Turn) and the shared Battle Log,
  and sorts combatants into turn order the same way the Initiative Tracker
  does, so "up now" always matches what the DM sees.
- Your own Pokémon in that encounter is found by matching your networkId
  against the Full Turn roster; the "opponent" side shows whoever's turn it
  currently is (or, if that's you, whichever other combatant you pick from
  a small switcher — there can be more than 2 combatants in a Full Turn
  encounter, unlike a real game's strict 1v1).
- Clicking a move, an item, a different party Pokémon, or Run does **not**
  change any HP directly — it sends the Dungeon Master a note (the same
  "Message the DM" channel Trainers Online already has, so no new
  permissions or endpoints were needed) saying what you'd like to do, which
  shows up in DM Tools' "Messages from Players" for them to actually play
  out with their tools. One authority (the DM) still resolves every HP/
  status change, exactly like NPCs and wild Pokémon already work — this
  view just makes *asking* feel like playing.
- Outside of an active encounter it still shows your lead Pokémon's sprite
  and HP so the screen isn't empty between fights.

The Dungeon Master's own screens (DM Tools, Full Turn) deliberately did
**not** get this treatment and stay table/form-based — a DM is juggling
several teams (every online player, the NPC library, the wild library) at
once, not one lead Pokémon in a 1v1 scene, so a dense, information-first UI
serves them better than a big sprite scene would.

Sprite art also shows up in smaller doses elsewhere for the same reason
(easier to recognize a Pokémon by its sprite than by name alone): a
thumbnail next to every Pokédex list row and My Team entry, and a hero
sprite in the Pokédex detail panel. A handful of very obscure dex entries
(16 out of 1301, mostly rare event/cap forms) have no sprite on PokeAPI's
own repo — those fall back to a plain Poké Ball placeholder icon rather
than a broken-image icon.

## Trainer-side features

Four more nav items, built from the pasted character sheet/rulebook, that
add actual *saved state* to the app for the first time — everything above
this is stateless (pick inputs, get an answer, forget it happened); these
persist to this browser's `localStorage`, so they survive closing the tab
and reopening it on this device/browser (and are mirrored to the server
under your own identity so they survive a cleared browser; Trainers Online
is the one place others can see your team, see below).

- **My Team** — up to 6 active Pokémon plus an unlimited PC box. Each entry
  has species, nickname, level, current/max HP (max computed the same way
  as everywhere else in the app), held item, ability (pulled from that
  species' real ability list), status condition, and 4 moves. Move Pokémon
  between party and PC with one click.
- **Trainer Sheet** — the 4 trainer abilities (Strength/Charisma/
  Intelligence/Pokémon) with a "Roll 4d6, drop the lowest" button per the
  rulebook's generation rule (a total under 8 becomes 12), plus all 12
  skills grouped under their ability with a proficiency checkbox and a
  "Roll ⟨Skill⟩" button (d20 + ability modifier + proficiency bonus if
  ticked). Trainer info (name, ID, gender, age, occupation, origin region,
  cash, badges, backstory) is all here too. Proficiency Bonus is
  derived from badges (2 + ⌈badges ÷ 2⌉) and shown read-only.

## Multiplayer — Trainers Online & synced battles

Everyone who opens this same app from the same computer's server (the
"On your network" URL from `server.py`) can now see each other, view each
other's teams, and trade — because `server.py` is no longer just a static
file server, it's also the sync hub every device is already connected to.
No setup beyond what phones/tablets already needed for the calculators.

- **Trainers Online** (new nav item) pings the server with your name and
  team every few seconds and lists everyone else doing the same. Click
  **View Team** for a read-only look at someone's party/PC (you can't edit
  it — only they can, from their own device). **Send…** lets you gift a
  Pokémon from your own party/PC, some cash, or a text note; it lands in
  the recipient's **Inbox** on the same page, where *they* choose to
  Accept (merges it into their save) or Dismiss — nothing is pushed into
  someone else's data without them clicking Accept themselves.
- **How it works, technically**: `server.py` now answers a small `/api/*`
  JSON API (trainer registration/listing, a per-trainer inbox, and one
  shared battle document) backed by a plain in-memory dict — no database,
  no new dependencies, still pure Python stdlib. Clients poll it every
  2.5–4 seconds rather than holding a live connection (`js/network.js`),
  which is simple and dependency-free at the cost of a few seconds of
  latency — fine for a turn-based tabletop game. A trainer who stops
  pinging (closes the tab, walks out of Wi-Fi range) silently drops off
  the Trainers Online list after 30 seconds. See **Saved server state**
  below for what survives a restart.

## Saved server state

Everything in the in-memory dict above (Trainers Online, pending gifts, the
shared battle, the Battle Log, the DM's Music Board) now autosaves to
`.server_state.dat` next to `server.py`, every 5 seconds if anything
changed, and reloads on startup — so restarting the server (or the whole
computer) no longer wipes the table's shared state. Ephemeral things don't
persist on purpose: a DM's login session doesn't survive a restart (just
log back in), and trainers who've timed out don't come back just because
the file reloaded.

The file is lightly obfuscated (XORed with a keystream derived from a
fixed key, using only `hashlib` — no third-party crypto package), not
strongly encrypted — good enough that opening `.server_state.dat` in a text
editor doesn't show anyone's team in plaintext, not good enough to protect
genuinely sensitive data (which nothing here is). Set
`ENCRYPT_STATE_FILE = False` near the top of `server.py` to store it as
plain readable JSON instead.

## Automatic backups

The server snapshots the whole save (every campaign, player save and
account) once an hour and keeps the newest **6**. A snapshot is skipped when
nothing changed since the last one, so a quiet server keeps its older history
instead of rotating it out for six identical copies; an *empty* state never
rotates good backups out either.

- Location: `backups/` next to the save file by default. On a server, set
  `PKDND_BACKUP_DIR` to a folder **outside** the app directory (the live
  server uses `/home/ubuntu/pokemon-dnd-backups`) so redeploying the app can't
  touch it. `PKDND_BACKUP_INTERVAL` (seconds) changes the cadence.
- Files are `backup-YYYYMMDD-HHMMSS.dat` (UTC), same format as the save file.
  Only those are ever rotated; anything else in the folder (manual copies,
  `unreadable-*.dat`) is left alone.
- If the save file can't be read at startup, the server first keeps a copy as
  `unreadable-*.dat`, then recovers from the newest readable backup instead
  of silently starting empty.
- Restore by hand: stop the server, copy the backup you want over
  `.server_state.dat`, start it again.
- A backup is a copy on the same machine, so it protects against bad writes
  and mistakes, not against losing the machine. Periodically copy the backups
  folder somewhere else (`scp` it to your PC).

## Accounts (optional sign-in)

Nobody has to sign in; the app works exactly as before without it. An account
exists to carry **your identity** (the id that campaign membership and your
server-side save are keyed on) to another phone, browser or site address,
which used to strand your data under a fresh random id.

- Sign up / sign in with email + password on the campaign-select screen or in
  **Settings → Account**. Passwords are stored as salted PBKDF2-SHA256 hashes
  (600k iterations); sessions last 30 days; logins are rate-limited. There is
  no "forgot password" email (the server can't send mail): your data is never
  tied to the password, since each device keeps its own identity and save.
- Signing in on a new device adopts the account's identity. If that device
  already had a trainer, it is first kept as a named save ("before sign-in …"
  on the Trainer Sheet), and its campaigns are merged into the account
  (membership added, ownership follows you). Nothing is deleted or
  overwritten; an existing save under the account's id always wins over a copy.
- Honest limit: campaign actions still trust the id a client sends (as before
  accounts). Accounts make that id portable and recoverable, not unforgeable.
- **Google / Apple buttons appear only when the server has credentials**, set
  as environment variables (the server verifies the provider's signed token
  itself, no extra packages):
  - `PKDND_GOOGLE_CLIENT_ID` — a free OAuth *Web* client ID from the Google
    Cloud console, with this site's address under "Authorized JavaScript
    origins".
  - `PKDND_APPLE_CLIENT_ID` — an Apple *Services ID* (needs a paid Apple
    Developer account) whose Return URL is this site's address.
  Provider accounts are deliberately never auto-merged into an email account
  by matching email address (emails aren't verified). Sign-in popups from
  Google/Apple generally don't work inside embedded webviews, so use a normal
  browser for those; email + password works everywhere.

## Security model

Everything the browser can see is public: the files under `css/ js/ data/
sprites/ sfx/ assets/` plus `index.html` and `manifest.json` (nothing else is
served: not the save file, backups, source, or dotfiles) and the responses to
its own requests. So nothing sensitive is in the page, and the server decides
everything from the signed-in session rather than from ids the client sends
(every campaign member can see every other member's id).

- **Campaign data** needs a signed-in session whose account is a member.
  Outsiders get the same 404 whether a campaign exists or not.
- **Acting as a player** (your save, inbox, directives, presence, messages,
  moves) only works for ids that belong to your own account. The DM token also
  allows moving on a player's behalf (the Control Centre mirroring a screen).
- **Owner actions, invite code and DM password** need your account to own the
  campaign; the DM Control Centre additionally needs the DM password.
- Requests are size-limited, names/text are length-capped, messages are
  type-checked, inboxes are capped, and folder listings and the Python
  version are not exposed. Responses carry a strict Content-Security-Policy
  (no inline scripts; only Google/Apple for sign-in), `nosniff`, no framing.
- Rate limits: logins, sign-ups, invite codes and DM passwords.
- Not covered: what a *member* is allowed to see by design (teammates' teams,
  the NPC/wild libraries the calculators load) and anyone you give your
  password to. Rotate a campaign's DM password / invite code from Settings if
  they may have leaked.

## Working on this with Claude

Open it on any device: `CLAUDE.md` gives every Claude session the project's
rules and commands, and `docs/claude-project.md` explains Claude Code on the
web and setting up a claude.ai Project.

## Tests

`python -m unittest discover -s tests -v` — covers the static-file allowlist,
backups/rotation/recovery, accounts, identity merging and token verification,
against a throwaway temp folder.

## Dungeon Master Control Centre

A password-gated section (nav item **Control Centre**) for running battles
and narrating events — each campaign has its own random DM password, shown to
the campaign owner on the Settings page (regenerate it there any time).
Logging in gets you a session token (`js/network.js`
→ `/api/dm/login`) stored in this browser's `localStorage`, checked against
on every DM action server-side — so a player who never enters the password
literally cannot call the DM endpoints, even by poking around in the
browser console. If the server restarts, that stored token stops working —
the app notices (`/api/dm/check`) and asks you to log in again rather than
silently failing every button.

Six tabs:

- **DM Tools** — two "Combatant" panels (A and B), each with a **Source**
  picker: **Online Trainer** (anyone currently connected), **NPC Trainer**
  (from the library below), or **Wild Pokémon** (ditto) — any combination
  works, so you can run a real player against a library NPC, two NPCs
  against each other, whatever the scene needs. From there:
  - **HP / Status**: apply an HP change (+/-) or set a status condition.
    A "this is happening in battle" checkbox controls whether it
    auto-posts to the Battle Log.
  - **Force a Move**: pick a move, click "A attacks B" (or the reverse) —
    runs the same base damage formula as the Damage Calculator (no item/
    ability curation, just a quick clean strike), applies the result, and
    posts what happened to the Battle Log automatically.
  - **Personal Note**: pick any online trainer from a dropdown (not just
    Combatant A) and send a private message straight to their My Log.
  - A direct **Battle Log** post box, for pure narration with no
    mechanical effect ("The cave begins to shake...").
  - **Messages from Players** at the top — notes trainers sent you (see
    below), with a Dismiss button once you've read one.

  An **online trainer's** Pokémon never gets edited directly — changes go
  out as a **directive** (`/api/directives/<id>`) their own browser polls
  for and applies to its own local save (`js/directives.js`), the moment
  it arrives, no matter which page they're on. **NPCs and wild Pokémon
  have no device of their own**, so for those the DM's action *is* the
  change — written straight into the library entry, which is why their
  current HP persists between encounters too.

- **Full Turn** — a single screen for running a whole encounter start to
  finish, rather than one action at a time in DM Tools:
  - **Add Combatant From…** uses the same saved-Pokémon picker as the
    calculators — pull from the NPC Library, the Wild Library, *any*
    currently-online player's team, or your own My Team — so a fight can
    mix real players, NPCs, and wild encounters freely.
  - Combatants sort into turn order the same way as the Initiative Tracker
    (Speed, highest first; tick **Priority** to jump the queue for a turn;
    **Roll tiebreak** breaks an exact Speed tie with a d20), with **Next
    Turn**/round tracking and an **End Encounter** button to clear the
    roster.
  - Whoever's turn it is gets real **move buttons** built from that
    Pokémon's own moveset — click one, pick a **Target**, and it resolves
    with the same hit/damage formula as the Damage Calculator, applies the
    HP loss, and posts to the Battle Log immediately.
  - A **Bag**: Poké Ball buttons run the exact Catch Chance formula against
    the target and, on a catch, remove a Wild Library entry and gift it to
    whoever's turn it was (if they're a real player); healing items (Potion
    through Max Revive) restore HP, with Revives only usable on a fainted
    Pokémon and everything else refusing to touch one.
  - A **Mega Evolve** button appears automatically for a combatant holding
    the right Mega Stone for their species — it swaps in the Mega form for
    the rest of the encounter (with a Revert button to undo it) without
    touching the original library/player entry, since Mega Evolution here
    is meant to be temporary.
  - **Attempt to Run** rolls a flat d20 (11+ escapes) and removes the
    combatant on success — there's no per-trainer Athletics DC wired up
    here, so treat it as a quick GM call rather than a strict skill check.
  - The whole roster is saved server-side (like the Music Board), so it's
    still there if you navigate away and come back — but it's a separate,
    richer roster from the simple shared battle the Initiative Tracker
    syncs, since only the DM needs full mon data per combatant.
- **NPC Library** — reusable NPC trainers (gym leaders, rivals, Team
  Rocket grunts): a name plus a full roster, each Pokémon with species,
  nickname, level, current HP, item, ability, status, and 4 moves. Add/
  remove Pokémon freely, Save, or Delete the whole NPC. Saved server-side,
  so every DM device sees the same library.
- **Wild Library** — the same idea for one-off wild encounters (that
  Route 1 Pidgey you'll reuse all campaign) — same fields, no trainer
  wrapper, since a wild entry *is* the Pokémon.
- **Music Board** — 30 labeled slots (Battle - Wild, Route 1, Pokémon
  Center, etc. — relabel any of them), each holding a YouTube URL, saved
  on the server so they persist. **Play** opens the link in a new tab on
  whichever device clicks it — there's no cross-device audio sync (that
  would need real streaming infrastructure this app doesn't have); it's a
  shared, saved playlist board, not a synced jukebox.
- **Sound Effects** — the same idea for short local clips: drop `.mp3`
  files into the app's `sfx/` folder (see below) and every filename found
  there becomes a Play button automatically, no config needed. Same
  no-cross-device-sync caveat as the Music Board.

## Messaging the DM, and picking a trainer name

- Every trainer now has a **name field right on the Trainers Online page**
  (in addition to the one on the Trainer Sheet — both write to the same
  place), since that's the name everyone else sees them by.
- **Message the Dungeon Master**, also on Trainers Online: any trainer can
  send a note that shows up *only* in the DM's Control Centre inbox — the
  reverse direction of the DM's Personal Note tool. Other trainers never
  see it.

## Sound Effects folder

Drop `.mp3` files into `app/sfx/` (create it if it's not there — a
`README.txt` placeholder marks the spot) and they show up as Play buttons
on the Control Centre's Sound Effects tab the next time that tab loads
(hit 🔄 Refresh List if you added files while it was already open). Served
as plain static files by `server.py` (registered explicitly as
`audio/mpeg` — some OS's default mimetypes table doesn't know `.mp3`),
nothing DM-only about *listening*; only the Control Centre wrapper around
it needs the password.

## Named character saves

Trainer Sheet now has a **Save / Load Character** box: your progress
already autosaves with no name needed (unchanged), but you can *also*
save a named snapshot (`js/storage.js` — `saveAsNamed`/`loadNamed`) and
reload it later — handy for a shared computer, or keeping more than one
character. Loading one overwrites your current active save (with a
confirmation first), so save under a name before switching if you want to
come back to what's there now.

## Two logs, two audiences

- **Battle Log** (nav item, visible to everyone): a shared feed fed
  automatically by the DM's HP/status/Force-Move actions, plus anyone can
  post their own line to it directly from the page — it's the table's
  shared record of what happened in a fight.
- **My Log** (nav item, private to this device): the opposite end —
  personal, out-of-battle history. It's pure `localStorage`
  (`js/log.js`), so it never touches the server or leaves this browser at
  all; it fills in from two sources: local actions in My Team (adding/
  leveling/healing a Pokémon, moving it to/from the PC) and DM directives
  once applied (a personal note, an out-of-battle heal). Nothing you do
  here is visible to anyone else, including the DM.

## Calculators now load saved Pokémon directly

The Damage Calculator (attacker *and* defender independently), Hit Chance,
Stat Calculator and Initiative Tracker all now start with a
**"Load From…"** card (`js/savedMonPicker.js`) offering your own My Team
(Party + PC), **any currently-online player's team**, the DM's NPC Library,
or the DM's Wild Library — pick one and hit **Use This Pokémon** to fill in
species, level, item, ability, status, and current HP in one go, instead of
re-entering all of it by hand every time. It's a read-only pull (never
writes anything back to the saved Pokémon), so loading one for a quick
check doesn't affect your actual team. The Full Turn console (below) uses
this same widget to build its combatant roster.

Loading a saved Pokémon feeds straight into the existing curated systems —
its ability and item get checked against the same auto-applied lists as
manual entry (confirmed by hand: loading a Charmander holding Charcoal,
with Blaze, at ≤⅓ HP, into the Damage Calculator's attacker slot correctly
stacked both the item's and the ability's Fire-type boosts on top of an
Ember, matching the formula exactly). The one gap worth knowing: the Catch
Chance Calculator still uses the spreadsheet's original 3-bucket status
list (None / Paralyzed-Poisoned-Burned / Asleep-Frozen) rather than the
newer 6-condition one used everywhere else — loading a saved Pokémon maps
its status onto the closest bucket automatically (Confusion has no bucket
to map to, so it's treated as None there), rather than the two systems
silently failing to match.

## Trainer name/team sync fix

Your name and team are now pushed to the server continuously in the
background (every 5s, from `app.js`, independent of whichever page is
open) rather than only while the Trainers Online page happened to be the
active view. Previously, changing your name on the Trainer Sheet (or
editing your team) without also revisiting Trainers Online left the
server — and so everyone else, and the DM's Control Centre — seeing your
old name (sometimes literally the placeholder "Trainer") or a stale
roster until you next opened that page. Confirmed fixed: setting a name
from the Trainer Sheet alone now reaches the server within 5 seconds with
no other page visited.

## Why not an Obsidian plugin?

Obsidian is built around notes and files, not a 1,300-row relational
database with live dice-roll calculators — building this as an Obsidian
plugin would mean fighting the Dataview/Templater APIs to reimplement a UI
that plain HTML/CSS/JS just does directly and faster. This app is a normal
website; if you'd rather have it *inside* Obsidian later, the easiest path
is embedding this running app in an `<iframe>` via an Obsidian note (or the
"Web Viewer" core plugin) — the app doesn't need to change for that.
