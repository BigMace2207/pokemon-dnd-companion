# Pokémon D&D Companion

A tabletop companion web app (Pokédex, calculators, trainer sheets, live
multi-campaign multiplayer with a DM Control Centre). Python standard-library
server (`server.py`, `auth.py`) + a no-build vanilla-JS front end (ES modules,
no bundler, no npm). Live at https://fluxdev.org. Read
`docs/architecture.md` for the shell / game-system split and `README.md` for
feature docs.

## Run and test

```
python server.py [port]                    # default 8850; serves the app + /api
python -m unittest discover -s tests -v    # ~55s, 88 tests, run before every commit
python tools/test_server.py --admin you@example.com   # throwaway local copy on :8860; code emails go to an outbox folder
node --test tests/js/*.test.mjs            # D&D rules engine, <1s (use the glob, not the folder)
```

Checks worth running after JS changes: `node --input-type=module --check < file.js`.
There is no linter configured. Tests use throwaway temp folders; they never
touch real save data.

Server environment variables: `PKDND_BIND` (listen address; `127.0.0.1` on a
public server), `PKDND_TRUST_PROXY=1` (only safe when bound to loopback behind
a proxy), `PKDND_BACKUP_DIR`, `PKDND_BACKUP_INTERVAL`, `PKDND_GOOGLE_CLIENT_ID`,
`PKDND_APPLE_CLIENT_ID`, `PKDND_LEGACY_DM_PASSWORD`, `PKDND_UPLOAD_DIR` (map and book files),
`PKDND_ADMIN_EMAILS` (the site owner's address), `PKDND_MAIL_PROVIDER` / `PKDND_MAIL_API_KEY` /
`PKDND_MAIL_FROM` (sign-in code emails; `mailer.py`). Keys and addresses go in the systemd drop-in, never the repo.

## Where things are

- `server.py` all API routes, campaigns, accounts/sessions, device codes, admin console, uploaded files, the hub,
  autosave, hourly backups. `mailer.py` sends the sign-in codes.
- `auth.py` password hashing and Google/Apple ID-token verification (stdlib RSA).
- `js/app.js` router + login/campaign gates; `js/network.js` API client;
  `js/storage.js` local save mirrored to the server; `js/views/*` pages;
  `js/systems/*` per-game manifests (add a game there, see docs/architecture.md).
- `css/style.css` base stylesheet; `dnd5e.css`, `library.css`, `lava.css` (+ generated `lava-bricks.css`)
  sit beside it. `data/` rules JSON. `sprites/` images.
- `js/systems/dnd5e/` the D&D 5e system (engine is DOM-free, tested in `tests/js`); `js/library/` the
  e-reader; `js/lavaTheme.js` the lava theme's ambient layer. See docs/architecture.md.
- `js/views/hub.js` the Pokémon hub (shared board, live cursors, the DM's encounter buttons; the only way into Battle);
  `js/views/admin.js` the admin console (admins only).
- `js/views/planner.js` + `js/planner/` the Campaign Planner (players share notes/checklists with the DM via `/api/plan`;
  only the DM token reads `/api/plans`).
- `tests/test_server.py` the server test suite (static-file lockdown, backups,
  accounts, authorization, tokens).

## Rules that matter (learned the hard way)

**Security model: never decide anything from an id the client claims.** Every
campaign member can see every other member's id (the online list), so ids are
not secrets. The session (`Authorization: Bearer`) decides who you are:
campaign data needs a signed-in *member*; acting as a player needs an id linked
to your account; owner actions and the DM password/invite code need your
account to *own* the campaign. See `Handler._member_account` / `_owns_campaign`
and `CampaignAuthorization` in the tests. New endpoints must follow this, with a
test, and every client `fetch` must send the session (use `network.js`; raw
fetches in `storage.js` add it by hand).

**Static files are an allowlist** (`static_path_allowed`): only `index.html`,
`manifest.json` and `css js data sprites sfx assets`. The save file
(`.server_state.dat`) and the `uploads/` folder must never be reachable: uploaded
files are only served by `/api/files/<id>` after the ownership check. Big things
(maps, books) never go in the save file: it is rewritten whole every few seconds. There are no inline scripts and
the CSP forbids them: put scripts in files.

**Never delete or overwrite save data.** Anything that touches accounts or
identities must be additive (see `merge_account_identities`). Back up before
risky changes; verify production by comparing the state file before/after, not
through the API (the API now needs a login).

**UI sizing:** every font-size / padding / margin / gap in `style.css` is
`calc(Npx * var(--s))` (`--s` = .82 desktop, .96 ultrawide, 1 phone). Write new
sizes that way, with a 12px minimum for text. Layouts must work at 1920x1080,
3440x1440 and iPhone widths (390px). Animations: opacity/transform only, under
0.25s, never on background re-renders, respect `prefers-reduced-motion`.

**Lava theme / reader motion:** the lava ambient effects intentionally break the "<0.25s" rule (the user asked
for them), so keep them on the non-re-rendering `#lavaFx` layer, opacity/transform only, and off for
`prefers-reduced-motion` and `data-lava-fx="calm"`. The hub and admin console's entrances (styled after vvd.world, at the
user's request) run up to 0.7s, once when the page opens, never on a sync or refresh. The Library stores books in IndexedDB;
only accounts with the `cloudLibrary` permission also upload them (private to that account). CSP: `img-src` allows `blob:` only so map images fetched with the session can be shown; PDF.js needs `isEvalSupported:false`.

**Quirks:** `css/style.css` has mixed LF/CRLF line endings, so match either when
doing text replacements. Polling views re-render often; do not animate or reset
scroll in a re-render. The page scrolls inside `<main>`, not the window.

## Deployment (production is one Oracle VM)

Static files (`css/ js/ index.html`) are just copied over; no restart. `server.py`,
`auth.py` or `mailer.py` changes need the service restarted. Never overwrite or delete
the server's `uploads/` folder when deploying. The VM runs Python 3.10
(systemd unit `pokemon-dnd`, Caddy for HTTPS (`fluxdev.org`; `www.` and `pokemon.` redirect to it; the old
`pokemon-dnd.duckdns.org` redirects there too, and remains the SSH host name), app bound to 127.0.0.1:8850,
backups in `~/pokemon-dnd-backups`). The routine that has worked every time:
take a copy of the save file first, upload to a staging folder, `py_compile` and
run the test suite on the VM, install, restart, then verify. Deploying needs
the owner's SSH key, which lives only on their PC: **a cloud/web Claude session
can write code, run tests and push to GitHub, but cannot deploy.** Keep
`master` equal to what is deployed.

Do not put secrets, passwords, ids or keys in the repo or in this file. Sprite art is
committed (credited in sprites/README.md and on the campaign page); sound files
are never committed: they are private per campaign, in `sfx/<campaign id>/` on the server, served
only to that campaign's members.

## Git

Commit messages explain the why, in a short summary line plus a body. Work on a
branch, run the tests, then fast-forward `master`.
