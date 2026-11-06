"""
Serves the Pokedex/Calculator app over your local network so you can open it
from a phone or tablet as well as this computer.

This is also the sync hub for the multiplayer features (Trainers Online,
the shared battle, the DM Control Centre, and the two log pages) —
every device connects to THIS server, so it doubles as the meeting point.

Everything used to live in one shared global STATE dict -- one campaign per
server, full stop. It's now CAMPAIGNS: {campaignId -> {meta, state}}, so one
running server can host any number of independent campaigns, each with its
own trainers/battle/NPCs/etc., an owner (whoever created it), and an invite
code other people use to join. See js/views/campaignSelect.js for the
"choose your campaign" screen this backs, and the "Campaign" section of
each view's own Settings-adjacent chrome for owner management (rename,
regenerate the invite code, remove a member, delete the whole campaign).

Security model: nothing is decided by an id the client merely claims (every
member can see every other member's id). Everything in a campaign needs a
signed-in session whose account belongs to it; acting as a player (their
save, inbox, presence, messages, moves) needs that id to be one of the
session account's own; owner actions and the invite code / DM password need
the session account to own the campaign; the DM Control Centre additionally
needs the campaign's DM password. See the Handler's _member_account /
_owns_campaign helpers and tests/test_server.py's CampaignAuthorization.

State lives in memory, but is also autosaved to a file next to this script
(see STATE_FILE below) every few seconds whenever something has changed,
and reloaded on startup -- so a server restart no longer wipes out
Trainers Online / the battle / the DM's music board. A server file saved
before campaigns existed (a single flat STATE dict) is migrated on load
into one campaign automatically -- see load_state_from_disk() -- so
upgrading never loses an existing game.

Run:
    python server.py [port]

Then open the printed "On your network" URL on any device connected to the
same Wi-Fi / router as this computer.
"""
import copy
import hashlib
import http.server
import json
import mimetypes
import os
import re
import secrets
import shutil
import signal
import socket
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

import auth
import mailer

# Not every OS's mimetypes registry has this by default; register it
# explicitly so .mp3 files in sfx/ are served with a type browsers will
# actually play instead of a generic/wrong one.
mimetypes.add_type("audio/mpeg", ".mp3")

ROOT = Path(__file__).resolve().parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8850


def _data_dir():
    """Where the autosave file lives. Running from source (plain `python
    server.py`), that's right next to this script, same as always. Running
    as a packaged desktop app (see desktop.py / build_desktop.py), it's
    instead a proper per-user data folder outside the app bundle -- a
    PyInstaller build's "next to this script" can be a temp extraction
    directory that's wiped on every launch, which would silently erase a
    DM's whole campaign save each time they reopened the app."""
    override = os.environ.get("PKDND_DATA_DIR")  # lets a test copy keep its saves apart from real ones
    if override:
        d = Path(override).expanduser()
        d.mkdir(parents=True, exist_ok=True)
        return d
    if not getattr(sys, "frozen", False):
        return ROOT
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    elif sys.platform == "win32":
        base = Path(os.environ.get("APPDATA") or Path.home())
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share"))
    d = base / "Pokemon D&D Companion"
    d.mkdir(parents=True, exist_ok=True)
    return d


DATA_DIR = _data_dir()

# Sound effects are private to a campaign: .mp3 files go in sfx/<campaign id>/
# (never in the repo, never served as static files). Only that campaign's
# members can list or stream them, via /api/sfx. Override with PKDND_SFX_DIR.
SFX_DIR = Path(os.environ.get("PKDND_SFX_DIR") or (ROOT / "sfx"))
SFX_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9 _.()'-]{0,100}\.mp3", re.IGNORECASE)

# Battle backgrounds the DM can swap between live (see /api/backgrounds).
BACKGROUNDS_DIR = ROOT / "sprites" / "backgrounds"

# Trainer portraits (see export_trainer_sprites.py) selectable on a
# trainer's own character sheet or for a DM's NPC Library entry.
TRAINER_SPRITES_DIR = ROOT / "sprites" / "trainers"

# Item icons (legacy Bulbapedia-style set, already bundled with the repo) —
# one subfolder per category (ball, medicine, hold-item, tm, ...), each full
# of plain <slug>.png files. See js/itemIcons.js for how a bag entry's name
# gets matched to one of these. Shared across every campaign -- these are
# static asset folders on disk, not per-campaign game state.
ICONS_DIR = ROOT / "sprites" / "icons"

# How long a trainer is considered "online" without a fresh ping.
TRAINER_TIMEOUT = 30

# Only needed to migrate a save file from before campaigns existed (see
# load_state_from_disk). No password lives in the source any more: set the
# PKDND_LEGACY_DM_PASSWORD environment variable to the old one if you still
# have such a file, otherwise a random one is generated and printed once.
# New campaigns always get their own random password, shown to the owner.
LEGACY_DM_PASSWORD = os.environ.get("PKDND_LEGACY_DM_PASSWORD") or None

# Game systems this server knows how to host. The server itself is
# system-agnostic (trainers/characters, battle log, DM notes and
# directives are generic); the system id is just stored on the campaign so
# every client loads the matching rules module (see js/systems/).
KNOWN_SYSTEMS = ("pokemon-dnd", "dnd5e")
KNOWN_EDITIONS = ("2014", "2024")   # D&D rules version, chosen by the campaign owner
DEFAULT_SYSTEM = "pokemon-dnd"

# Invite codes and DM passwords: ambiguity-free lowercase alphabet, 10
# characters (~49 bits). Old 8-hex codes already in a save file keep working.
_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


def new_code(length=10):
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(length))


# Failed-attempt limiter (invite codes, DM passwords): max N failures per
# window per client, plus a looser cap per campaign.
RATE_WINDOW = 300  # seconds
RATE_LIMIT_CLIENT = 10
RATE_LIMIT_CAMPAIGN = 40
_RATE_FAILS = {}  # key -> [timestamps]
_RATE_LOCK = threading.Lock()
TRUST_PROXY = os.environ.get("PKDND_TRUST_PROXY") == "1"  # set when behind a reverse proxy
# Which address to listen on. 0.0.0.0 (everything, the default) suits playing
# over a home Wi-Fi; on a public server set PKDND_BIND=127.0.0.1 so only the
# reverse proxy on the same machine can reach the app and nobody can bypass it
# by connecting to the port directly. (Only then is PKDND_TRUST_PROXY safe,
# since a direct client could otherwise forge X-Forwarded-For.)
BIND_HOST = os.environ.get("PKDND_BIND") or "0.0.0.0"

DM_TOKEN_TTL = 12 * 3600


def rate_blocked(key, limit):
    now = time.time()
    with _RATE_LOCK:
        hits = [t for t in _RATE_FAILS.get(key, []) if now - t < RATE_WINDOW]
        _RATE_FAILS[key] = hits
        return len(hits) >= limit


def rate_fail(key):
    with _RATE_LOCK:
        _RATE_FAILS.setdefault(key, []).append(time.time())

# Static files the web server may hand out. Everything else under the app
# folder (the save file, backups, *.py, .git, logs, build files...) is
# refused, so hosting this folder publicly doesn't leak it. (Before this
# allowlist existed, /.server_state.dat -- every campaign's DM password,
# invite code and player save -- was downloadable by anyone.)
STATIC_TOP_DIRS = {"css", "js", "data", "sprites", "assets"}
STATIC_TOP_FILES = {"index.html", "manifest.json", "favicon.ico"}
STATIC_BLOCKED_EXT = {".py", ".pyc", ".dat", ".tmp", ".log", ".spec", ".bat", ".command", ".md", ".txt", ".xlsx", ".env", ".key", ".pem"}


def static_path_allowed(url_path):
    rel = unquote(url_path.split("?")[0].split("#")[0])
    if "\\" in rel or "\x00" in rel:
        return False
    rel = rel.lstrip("/")
    if rel == "":
        return True  # "/" -> index.html
    parts = rel.split("/")
    if any(p.startswith(".") for p in parts):
        return False  # dotfiles and ".." anywhere
    if len(parts) == 1:
        return parts[0] in STATIC_TOP_FILES
    return parts[0] in STATIC_TOP_DIRS and Path(parts[-1]).suffix.lower() not in STATIC_BLOCKED_EXT


# --- Persistence -----------------------------------------------------------
STATE_FILE = DATA_DIR / ".server_state.dat"
AUTOSAVE_INTERVAL = 5  # seconds between disk writes, only if something changed

# --- Backups ---------------------------------------------------------------
# A snapshot of the whole save every BACKUP_INTERVAL seconds (when something
# changed since the last one), keeping the newest BACKUP_KEEP. Kept in their
# own folder -- by default next to the save file, but point PKDND_BACKUP_DIR at
# a folder OUTSIDE the app directory on a server so redeploying the app can
# never touch them. Only files named backup-*.dat are ever rotated out; manual
# copies and quarantined unreadable saves are left alone.
BACKUP_DIR = Path(os.environ.get("PKDND_BACKUP_DIR") or (DATA_DIR / "backups"))
BACKUP_INTERVAL = int(os.environ.get("PKDND_BACKUP_INTERVAL") or 3600)
BACKUP_KEEP = 6
# Light obfuscation, not real cryptography (Python's stdlib has no AES/GCM
# without a third-party package, and this project stays dependency-free) —
# a repeated-SHA256 keystream XORed over the JSON bytes. Good enough to stop
# someone casually opening the save file in a text editor; not good enough
# to protect anything actually sensitive. Set ENCRYPT_STATE_FILE = False to
# store it as plain JSON instead. The XOR key is fixed (not per-campaign --
# it's obfuscating the whole file, not gating access to any one campaign).
ENCRYPT_STATE_FILE = True
_MAGIC = b"PDNDv2:"
_FILE_KEY = b"pokemon-dnd-companion-state-file"


def _keystream(key: bytes, length: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < length:
        out.extend(hashlib.sha256(key + counter.to_bytes(4, "big")).digest())
        counter += 1
    return bytes(out[:length])


def _xor(data: bytes, key: bytes) -> bytes:
    ks = _keystream(key, len(data))
    return bytes(a ^ b for a, b in zip(data, ks))


def _default_music_slots():
    labels = [
        "Battle - Wild", "Battle - Trainer", "Battle - Gym Leader", "Battle - Rival",
        "Battle - Legendary", "Battle - Victory",
        "Route 1", "Route 2", "Route 3", "Route 4",
        "Town / City", "Pokémon Center", "Gym", "Pokémon Mart",
        "Cave", "Forest", "Water / Surfing", "Bike",
        "Rain", "Night", "Sad / Fainted", "Level Up",
        "Evolution", "Catch Success", "Rival Appears", "Gym Leader Intro",
        "Elite Four", "Champion", "Credits", "Ambient / Silence",
    ]
    return [{"label": labels[i] if i < len(labels) else f"Slot {i + 1}", "url": ""} for i in range(30)]


def default_campaign_state():
    """Everything one campaign owns -- this exact shape used to be the
    single global STATE; now one of these lives inside each campaign."""
    return {
        "trainers": {},      # id -> {name, team, lastSeen}
        "inbox": {},         # trainerId -> [ {id, from, fromName, type, payload, ts} ]
        "battle": {"combatants": [], "currentIndex": 0, "round": 1, "updatedAt": 0, "updatedBy": None},
        "directives": {},    # trainerId -> [ {id, kind, payload, ts} ] -- DM-issued, auto-applied client-side
        "battleLog": [],     # [ {id, fromName, text, ts} ] -- shared, everyone sees it
        "musicSlots": _default_music_slots(),
        "npcTrainers": {},   # id -> {name, team: {party: [mon, ...]}} -- DM's reusable NPC roster
        "wildPokemon": {},   # id -> mon -- DM's reusable wild-encounter roster
        "dmInbox": [],       # [ {id, fromName, text, ts} ] -- notes from players, DM-only to read
        "eggs": {},          # eggId -> {id, to, species, given, hatched} -- what's inside stays here until the player hatches it
        "fullTurn": {"combatants": [], "currentIndex": 0, "round": 1, "background": "", "spreadHitsAllies": False, "phase": "draft"},
        "playerSaves": {},   # networkId -> {"current": <save object>, "named": {slotName: <save object>}}
        "partyMap": None,    # the one map the DM shares with the table: {name, image, w, h, pins[{..., revealed}], tokens[], updated}
        "plans": {},         # networkId -> {name, updated, plan} -- each player's planning notes and checklists; the DM can read them
        "hub": {"items": [], "rev": 0, "activeButton": None, "backdrop": None},  # the Pokémon hub whiteboard everyone shares (see the Hub section); backdrop: {fileId, blur, dim}
    }


def new_campaign_entry(name, owner_id, system=DEFAULT_SYSTEM, edition=None):
    cid = secrets.token_hex(8)
    entry = {
        "meta": {
            "id": cid,
            "name": (name or "New Campaign").strip()[:60] or "New Campaign",
            "ownerId": owner_id,
            "memberIds": [owner_id] if owner_id else [],
            "inviteCode": new_code(),
            "dmPassword": new_code(),
            "system": system if system in KNOWN_SYSTEMS else DEFAULT_SYSTEM,
            "edition": edition if edition in KNOWN_EDITIONS else "2014",
            "createdAt": time.time(),
        },
        "state": default_campaign_state(),
    }
    return cid, entry


CAMPAIGNS_LOCK = threading.Lock()
CAMPAIGNS = {}  # campaignId -> {"meta": {...}, "state": {...}}
CAMPAIGNS_DIRTY = False
# Optional accounts (see the "Accounts" section below) -- both tables live in
# the same save file as the campaigns, so they're covered by the autosave and
# by the hourly backups, and both are guarded by CAMPAIGNS_LOCK.
ACCOUNTS = {}  # accountId -> {id, email, password, providers, networkId, linkedIds, createdAt}
SESSIONS = {}  # sha256(token) -> {"accountId", "expires"} -- raw tokens are never stored
# Uploaded files (map images, and cloud Library books for accounts allowed to
# keep them on the server). Only this metadata lives in the save file; the
# bytes are separate files in UPLOAD_DIR, so a big upload never slows the
# autosave down. fileId -> {id, owner, kind, campaignId, name, mime, size, sha256, created, meta, deleted}
FILES = {}
# Campaigns the admin deleted. Kept whole (nothing is erased) so a deletion can be undone from the admin console;
# nobody can see or join them while they are here. campaignId -> {"meta", "state", "archivedAt", "archivedBy"}
ARCHIVED = {}
# token -> campaignId. A DM login is scoped to the one campaign it was
# issued for, since each campaign now has its own DM password.
DM_TOKENS = {}


def _unit(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if f != f else min(1.0, max(0.0, f))   # NaN-safe, clamped to the map


def _text(v, n):
    return v.strip()[:n] if isinstance(v, str) else ""


def _colour(v, default):
    return v if isinstance(v, str) and re.match(r"^#[0-9a-fA-F]{6}$", v) else default


def clean_map_pins(raw):
    """The DM's labelled places on the shared map. `revealed` is what players are allowed to see."""
    out = []
    for p in (raw if isinstance(raw, list) else [])[:300]:
        if isinstance(p, dict):
            out.append({"id": _text(p.get("id"), 40) or secrets.token_hex(4), "x": _unit(p.get("x")), "y": _unit(p.get("y")),
                        "label": _text(p.get("label"), 80), "note": _text(p.get("note"), 2000), "icon": _text(p.get("icon"), 2) or "●",
                        "color": _colour(p.get("color"), "#ff4a22"), "revealed": p.get("revealed") is True})
    return out


def clean_map_areas(raw):
    """The DM's named areas on the shared map, in map units (0-1), e.g. a town or a forest: a shape (`pts`, 3 to 60
    corners, drawn by clicking points) with its bounding box (x, y, w, h), or an older plain rectangle (the box alone).
    A player's current area (shown round the hub's minimap) is the smallest one their token stands in."""
    out = []
    for a in (raw if isinstance(raw, list) else [])[:60]:
        if not isinstance(a, dict) or not _text(a.get("name"), 60):
            continue
        area = {"id": _text(a.get("id"), 40) or secrets.token_hex(4), "name": _text(a.get("name"), 60), "color": _colour(a.get("color"), "#9b7be0")}
        pts = [[round(_unit(p[0]), 4), round(_unit(p[1]), 4)] for p in (a.get("pts") if isinstance(a.get("pts"), list) else [])[:60]
               if isinstance(p, list) and len(p) == 2]
        if pts:
            if len(pts) < 3:
                continue
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            x, y, w, h = min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)
            area["pts"] = pts
        else:
            x, y = _unit(a.get("x")), _unit(a.get("y"))
            w, h = min(_unit(a.get("w")), 1 - x), min(_unit(a.get("h")), 1 - y)
        if w < 0.005 or h < 0.005:
            continue
        area.update({"x": round(x, 4), "y": round(y, 4), "w": round(w, 4), "h": round(h, 4)})
        out.append(area)
    return out


def clean_map_tokens(raw):
    """Where the DM has placed each player on the shared map."""
    out = []
    for t in (raw if isinstance(raw, list) else [])[:40]:
        if isinstance(t, dict):
            out.append({"id": _text(t.get("id"), 60) or secrets.token_hex(4), "name": _text(t.get("name"), 40) or "Player",
                        "x": _unit(t.get("x")), "y": _unit(t.get("y")), "color": _colour(t.get("color"), "#5aa8f0")})
    return out


# ---- Fog of war on the shared map ----
# The map starts covered in mist; it clears in a circle round each player's token as they move (and wherever the DM
# brushes it away). "shared": everyone sees every cleared patch and every player; otherwise each player sees only what
# they've uncovered themselves (plus the DM's) and only their own token. Decided here, never by the client.
FOG_DEFAULT = {"enabled": False, "shared": True, "radius": 0.08}
MAX_REVEALS = 1500   # cleared spots kept per player


def map_fog(pm):
    fog = pm.get("fog") if isinstance(pm.get("fog"), dict) else {}
    return {**FOG_DEFAULT, **fog}


def clean_fog(raw, old):
    out = dict(old)
    if isinstance(raw, dict):
        if isinstance(raw.get("enabled"), bool):
            out["enabled"] = raw["enabled"]
        if isinstance(raw.get("shared"), bool):
            out["shared"] = raw["shared"]
        if raw.get("radius") is not None:
            out["radius"] = round(min(0.4, max(0.02, _unit(raw.get("radius")))), 3)
    return out


def map_reveal(pm, who, x, y, spacing=0.35):
    """Clears the mist round (x, y) for `who` (a player id, or "dm"); skips spots already cleared."""
    fog = map_fog(pm)
    r, aspect = fog["radius"], (pm.get("h") or 1) / (pm.get("w") or 1)
    pts = pm.setdefault("reveals", {}).setdefault(who, [])
    if any(((px - x) ** 2 + ((py - y) * aspect) ** 2) ** 0.5 < r * spacing for px, py in pts):
        return False
    pts.append([round(x, 4), round(y, 4)])
    del pts[:-MAX_REVEALS]
    return True


def map_view_for(pm, viewer, is_dm, members=()):
    """The shared map as one person may see it."""
    out = {k: v for k, v in pm.items() if k != "reveals"}
    fog = map_fog(pm)
    out["fog"] = fog
    reveals = pm.get("reveals") or {}
    if is_dm:
        out["reveals"] = [pt for pts in reveals.values() for pt in pts]
        return out
    out["pins"] = [p for p in pm.get("pins", []) if p.get("revealed")]
    if not fog["enabled"]:
        out["reveals"] = []
        return out
    if fog["shared"]:
        out["reveals"] = [pt for pts in reveals.values() for pt in pts]
        return out
    mine = list(reveals.get(viewer, [])) + list(reveals.get("dm", []))
    out["reveals"] = mine
    aspect, r = (pm.get("h") or 1) / (pm.get("w") or 1), fog["radius"]
    seen = lambda t: any(((px - t["x"]) ** 2 + ((py - t["y"]) * aspect) ** 2) ** 0.5 < r for px, py in mine)
    # only your own token, and the DM's other markers where you've already been
    out["tokens"] = [t for t in pm.get("tokens", []) if t["id"] == viewer or (t["id"] not in members and seen(t))]
    return out


def merge_map_tokens(old, new, members):
    """The DM's token list (who's on the map) with the positions players have moved theirs to kept."""
    pos = {t["id"]: t for t in old}
    out = []
    for t in new:
        prev = pos.get(t["id"])
        out.append({**t, "x": prev["x"], "y": prev["y"]} if prev and t["id"] in members else t)
    return out


def mark_dirty():
    global CAMPAIGNS_DIRTY
    CAMPAIGNS_DIRTY = True


def has_dm_access(entry, acc):
    """DM access comes from the campaign, not a password: the owner always has it, and anyone the owner makes a DM
    (meta.dmAccounts, account ids) until they take it away."""
    if not acc or not entry:
        return False
    meta = entry["meta"]
    return meta.get("ownerId") in (acc.get("linkedIds") or []) or acc["id"] in (meta.get("dmAccounts") or [])


def dm_member_ids(entry):
    """The members (trainer ids) whose account has DM access, for the owner's Members list."""
    return [mid for mid in entry["meta"].get("memberIds") or [] if has_dm_access(entry, account_owning_network_id(mid))]


def campaign_summary(cid, entry, is_owner):
    """is_owner must come from the request's signed-in session (see
    Handler._owns_campaign), never from an id the client merely claims: it
    gates the invite code and the member list."""
    meta = entry["meta"]
    out = {
        "id": cid,
        "name": meta["name"],
        "isOwner": is_owner,
        "memberCount": len(meta.get("memberIds") or []),
        "system": meta.get("system", DEFAULT_SYSTEM),
        "edition": meta.get("edition"),   # None on campaigns made before this existed: players then keep their own choice
        "createdAt": meta["createdAt"],
    }
    if is_owner:
        out["inviteCode"] = meta["inviteCode"]
        out["memberIds"] = meta.get("memberIds") or []
        out["dmIds"] = dm_member_ids(entry)
        out["ownerId"] = meta["ownerId"]
    return out


# ---- Shared HP/status/log helpers -----------------------------------------
# Used by both the DM's Control Centre/Full Turn actions and a trainer's own
# "play my move" action (see _handle_player_move) -- online trainers get a
# directive their own client applies; NPCs/wild Pokémon have no client, so
# the caller's action IS the change, written straight into the library entry.
# All take the campaign's own state dict explicitly now instead of reaching
# for one shared global.

def queue_directive(state, tid, kind, payload):
    d = {"id": f"{time.time()}-{id(payload)}-{tid}", "kind": kind, "payload": payload, "ts": time.time()}
    state["directives"].setdefault(tid, []).append(d)


def log_battle(state, from_name, text):
    state["battleLog"].append({"id": f"{time.time()}-{id(text)}", "fromName": from_name, "text": text, "ts": time.time()})
    state["battleLog"] = state["battleLog"][-500:]


def find_npc_mon(state, npc_id, mon_id):
    npc = state["npcTrainers"].get(npc_id)
    if not npc:
        return None
    return next((m for m in npc["team"].get("party", []) if m.get("id") == mon_id), None)


def apply_hp(state, kind, tid, mon_id, delta, absolute):
    if kind == "npc":
        mon = find_npc_mon(state, tid, mon_id)
        if mon:
            before = mon.get("currentHp") or 0
            mon["currentHp"] = max(0, absolute) if absolute is not None else max(0, before + (delta or 0))
    elif kind == "wild":
        mon = state["wildPokemon"].get(tid)
        if mon:
            before = mon.get("currentHp") or 0
            mon["currentHp"] = max(0, absolute) if absolute is not None else max(0, before + (delta or 0))
    else:
        queue_directive(state, tid, "setHp", {"monId": mon_id, "delta": delta, "absolute": absolute})


def apply_status(state, kind, tid, mon_id, status):
    if kind == "npc":
        mon = find_npc_mon(state, tid, mon_id)
        if mon:
            mon["status"] = status
    elif kind == "wild":
        mon = state["wildPokemon"].get(tid)
        if mon:
            mon["status"] = status
    else:
        queue_directive(state, tid, "setStatus", {"monId": mon_id, "status": status})


def _read_state_file(path):
    """Parses one save or backup file into its dict; raises if unreadable."""
    raw = path.read_bytes()
    if raw.startswith(_MAGIC):
        return json.loads(_xor(raw[len(_MAGIC):], _FILE_KEY).decode("utf-8"))
    if raw.startswith(b"PDNDv1:"):
        # Pre-campaign file, encrypted with the old scheme (XOR key was
        # the single global DM password). Decrypt with that, then fall
        # through to the flat-shape migration in _install_loaded.
        if not LEGACY_DM_PASSWORD:
            raise ValueError("this is an old-format save; set PKDND_LEGACY_DM_PASSWORD to the old DM password to migrate it")
        return json.loads(_xor(raw[len(b"PDNDv1:"):], LEGACY_DM_PASSWORD.encode("utf-8")).decode("utf-8"))
    return json.loads(raw.decode("utf-8"))


def _serialize_state():
    """The exact bytes written to the save file and to every backup. Caller
    holds CAMPAIGNS_LOCK."""
    body = json.dumps({"campaigns": CAMPAIGNS, "accounts": ACCOUNTS, "sessions": SESSIONS, "files": FILES, "archived": ARCHIVED}).encode("utf-8")
    return _MAGIC + _xor(body, _FILE_KEY) if ENCRYPT_STATE_FILE else body


def list_backups():
    """Automatic backups, newest first (their names sort chronologically)."""
    if not BACKUP_DIR.is_dir():
        return []
    return sorted(BACKUP_DIR.glob("backup-*.dat"), reverse=True)


def take_backup():
    """Writes one snapshot and trims to the newest BACKUP_KEEP. Returns the
    path written, or None when skipped: nothing changed since the last
    backup (so an idle server doesn't rotate good history out for identical
    copies), or the live state is empty while backups exist (so a wiped
    state can never push the last good backups out the door)."""
    with CAMPAIGNS_LOCK:
        body = _serialize_state()
        empty = not CAMPAIGNS and not ACCOUNTS
    existing = list_backups()
    if existing and existing[0].read_bytes() == body:
        return None
    if empty and existing:
        print("WARNING: server state is empty but backups exist -- skipping this backup so they aren't rotated out.")
        return None
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(BACKUP_DIR, 0o700)
    except OSError:
        pass
    path = BACKUP_DIR / f"backup-{time.strftime('%Y%m%d-%H%M%S', time.gmtime())}.dat"
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(body)
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    tmp.replace(path)
    for old in list_backups()[BACKUP_KEEP:]:
        old.unlink()
    return path


def backup_loop():
    # Restart-safe: the first wait is whatever remains of the interval since
    # the newest backup, so restarting the server (a deploy, a reboot) never
    # fires an extra backup or resets the hourly cadence.
    existing = list_backups()
    wait = 60 if not existing else max(30, BACKUP_INTERVAL - (time.time() - existing[0].stat().st_mtime))
    while True:
        time.sleep(wait)
        wait = BACKUP_INTERVAL
        try:
            path = take_backup()
            if path:
                print(f"Backup written: {path.name} ({len(list_backups())}/{BACKUP_KEEP} kept)")
        except Exception as e:
            print(f"WARNING: backup failed: {e}")


def _quarantine_unreadable_state():
    """Keeps a copy of a save file we couldn't parse, so starting over (or
    recovering from a backup) can never overwrite the only copy of it."""
    try:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        dest = BACKUP_DIR / f"unreadable-{time.strftime('%Y%m%d-%H%M%S', time.gmtime())}.dat"
        shutil.copy2(STATE_FILE, dest)
        print(f"Kept a copy of the unreadable save at {dest}")
    except Exception as e:
        print(f"WARNING: couldn't keep a copy of the unreadable save: {e}")


def load_state_from_disk():
    global CAMPAIGNS, ACCOUNTS, SESSIONS, FILES, ARCHIVED
    if not STATE_FILE.exists():
        return
    try:
        _install_loaded(_read_state_file(STATE_FILE), STATE_FILE.name)
        return
    except Exception as e:
        print(f"WARNING: couldn't read {STATE_FILE.name} ({e}).")
    _quarantine_unreadable_state()
    for backup in list_backups():
        try:
            _install_loaded(_read_state_file(backup), backup.name)
            mark_dirty()  # rewrite STATE_FILE from the recovered data
            print(f"RECOVERED from backup {backup.name}. Check it's the data you expect.")
            return
        except Exception as e:
            print(f"WARNING: backup {backup.name} is unreadable too ({e}).")
    CAMPAIGNS, ACCOUNTS, SESSIONS, FILES, ARCHIVED = {}, {}, {}, {}, {}
    print("No usable backup found -- starting fresh (the unreadable file was kept, see above).")


def _install_loaded(loaded, source_name):
    """Replaces the in-memory state with a parsed save. Raises (leaving the
    caller to fall back) if the data isn't shaped like a save."""
    global CAMPAIGNS, ACCOUNTS, SESSIONS, FILES, ARCHIVED
    if "campaigns" in loaded:
        campaigns = loaded["campaigns"]
        # Backfill any fields added to campaign meta after some campaigns
        # were already saved, so an older save file doesn't crash on a
        # missing key.
        for entry in campaigns.values():
            meta = entry.setdefault("meta", {})
            meta.setdefault("memberIds", [meta["ownerId"]] if meta.get("ownerId") else [])
            meta.setdefault("dmPassword", secrets.token_hex(4))
            base = default_campaign_state()
            base.update({k: v for k, v in entry.get("state", {}).items() if k in base})
            entry["state"] = base
    else:
        # Pre-campaign flat STATE dict -- wrap it into one campaign so
        # upgrading this server never loses an existing game. Best guess at
        # an owner: whoever's currently in the trainers presence list
        # (likely the one device that's been running this server); ownerless
        # if that list happens to be empty.
        trainers = loaded.get("trainers") or {}
        owner_id = next(iter(trainers), None)
        cid, entry = new_campaign_entry("My Campaign", owner_id)
        if LEGACY_DM_PASSWORD:
            entry["meta"]["dmPassword"] = LEGACY_DM_PASSWORD  # keep the old password working
        else:
            print(f"NOTE: migrated campaign got a new DM password: {entry['meta']['dmPassword']} (shown once; the owner can see it in Settings)")
        base = default_campaign_state()
        base.update({k: v for k, v in loaded.items() if k in base})
        entry["state"] = base
        campaigns = {cid: entry}
        print(f"Migrated a pre-campaign save into one campaign: \"{entry['meta']['name']}\" "
              f"(id {cid}).")
    CAMPAIGNS = campaigns
    ACCOUNTS = loaded.get("accounts") or {}   # absent in saves from before accounts existed
    SESSIONS = loaded.get("sessions") or {}
    FILES = loaded.get("files") or {}
    ARCHIVED = loaded.get("archived") or {}
    total_trainers = sum(len(e["state"]["trainers"]) for e in CAMPAIGNS.values())
    print(f"Loaded {len(CAMPAIGNS)} campaign(s), {len(ACCOUNTS)} account(s) from {source_name} ({total_trainers} trainer(s) remembered).")


def save_state_to_disk():
    try:
        body = _serialize_state()
        tmp = STATE_FILE.with_suffix(".tmp")
        tmp.write_bytes(body)
        tmp.replace(STATE_FILE)  # atomic-ish swap so a crash mid-write can't corrupt the real file
    except Exception as e:
        print(f"WARNING: failed to save state: {e}")


def autosave_loop():
    global CAMPAIGNS_DIRTY
    while True:
        time.sleep(AUTOSAVE_INTERVAL)
        with CAMPAIGNS_LOCK:
            if not CAMPAIGNS_DIRTY:
                continue
            CAMPAIGNS_DIRTY = False
            save_state_to_disk()


# --- Accounts --------------------------------------------------------------
# OPTIONAL sign-in (email + password, plus Google / Apple when configured).
# An account does one job: it carries a player's identity -- their networkId,
# which is what campaign membership and the durable server-side player save
# are keyed on -- across devices and across a change of site address, which
# used to orphan a device's identity (every new browser/origin minted a fresh
# random networkId). Nothing here deletes or overwrites game data: signing in
# only ever ADDS memberships/saves under the account's primary id (see
# merge_account_identities), and playing without an account works exactly as
# before. Honest limit: campaign actions still trust the networkId a client
# sends, same as before accounts existed -- accounts make that id portable and
# recoverable, they don't (yet) make it unforgeable.
SESSION_TTL = 30 * 24 * 3600
GOOGLE_CLIENT_ID = os.environ.get("PKDND_GOOGLE_CLIENT_ID") or None
APPLE_CLIENT_ID = os.environ.get("PKDND_APPLE_CLIENT_ID") or None  # the "Services ID"
AUTH_WINDOW = 900  # seconds
AUTH_LIMIT_IP = 20
AUTH_LIMIT_EMAIL = 8
AUTH_LIMIT_REGISTER = 10
_AUTH_FAILS = {}
_AUTH_LOCK = threading.Lock()


def auth_blocked(key, limit):
    now = time.time()
    with _AUTH_LOCK:
        hits = [t for t in _AUTH_FAILS.get(key, []) if now - t < AUTH_WINDOW]
        _AUTH_FAILS[key] = hits
        return len(hits) >= limit


def auth_note(key):
    with _AUTH_LOCK:
        _AUTH_FAILS.setdefault(key, []).append(time.time())


def _hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_session(account_id):
    """Caller holds CAMPAIGNS_LOCK. Returns the raw token (shown to the
    client once); only its hash is stored."""
    now = time.time()
    for k in [k for k, s in SESSIONS.items() if s["expires"] < now]:
        del SESSIONS[k]
    token = secrets.token_urlsafe(32)
    SESSIONS[_hash_token(token)] = {"accountId": account_id, "expires": now + SESSION_TTL}
    return token


def account_from_token(token):
    """Caller holds CAMPAIGNS_LOCK."""
    if not token:
        return None
    s = SESSIONS.get(_hash_token(token))
    if not s or s["expires"] < time.time():
        return None
    return ACCOUNTS.get(s["accountId"])


# ---- Admins and per-account permissions ----
# The site owner's address goes in PKDND_ADMIN_EMAILS (comma separated) on the
# server, never in the repo. An account only counts as that admin once it has
# proved it owns the address (a code sent there, or Google saying so), so
# registering someone else's address gets nothing. Admins can grant the
# permissions below to anyone from the admin console.
ADMIN_EMAILS = {e.strip().lower() for e in (os.environ.get("PKDND_ADMIN_EMAILS") or "").split(",") if e.strip()}
PERMS = {
    "admin": "Admin console, and everything below",
    "cloudLibrary": "Keep Library books (PDFs) on the server, on every device",
    "unlimitedMaps": "No 10-map limit per campaign, and much bigger map files",
}
MB = 1024 * 1024
LIMITS_STANDARD = {"mapsPerCampaign": 10, "mapBytes": 15 * MB, "bookBytes": 0}
LIMITS_ELEVATED_MAPS = {"mapsPerCampaign": None, "mapBytes": 100 * MB}
BOOK_BYTES_CLOUD = 300 * MB
MIN_FREE_DISK = 2 * 1024 * MB   # refuse uploads before the server's disk gets this full


def env_admin(acc):
    return bool(acc) and bool(acc.get("emailVerified")) and (acc.get("email") or "").lower() in ADMIN_EMAILS


def effective_perms(acc):
    granted = (acc or {}).get("perms") or {}
    admin = env_admin(acc) or granted.get("admin") is True
    return {k: admin or granted.get(k) is True for k in PERMS}


def account_limits(acc):
    perms = effective_perms(acc)
    out = dict(LIMITS_STANDARD)
    if perms["unlimitedMaps"]:
        out.update(LIMITS_ELEVATED_MAPS)
    if perms["cloudLibrary"]:
        out["bookBytes"] = BOOK_BYTES_CLOUD
    return out


def public_account(acc):
    return {
        "email": acc.get("email"),
        "hasPassword": bool(acc.get("password")),
        "providers": sorted(acc.get("providers") or {}),
        "networkId": acc["networkId"],
        "emailVerified": bool(acc.get("emailVerified")),
        "perms": effective_perms(acc),
        "limits": account_limits(acc),
    }


# ---- Trusted devices and emailed sign-in codes ----
# Each browser keeps a random device key. Signing in with a password from a
# device the account hasn't seen before needs a 4-digit code emailed to the
# account's address. Only hashes of device keys and codes are kept, and the
# pending codes live in memory only (a restart just means asking again).
MAX_DEVICES = 40
CODE_TTL = 600
CODE_TRIES = 5
CHALLENGES = {}   # challengeId -> {accountId, codeHash, expires, tries, purpose, networkId, deviceHash, sentAt}


def _device_hash(device_key):
    if not isinstance(device_key, str) or not (16 <= len(device_key) <= 200):
        return None
    return hashlib.sha256(("device:" + device_key).encode("utf-8")).hexdigest()


def device_trusted(acc, device_hash):
    return bool(device_hash) and any(d.get("h") == device_hash for d in acc.get("devices") or [])


def trust_device(acc, device_hash, label=""):
    """Caller holds CAMPAIGNS_LOCK. Remembers (or refreshes) this device."""
    if not device_hash:
        return
    devices = acc.setdefault("devices", [])
    now = time.time()
    for d in devices:
        if d.get("h") == device_hash:
            d["seen"] = now
            return
    devices.append({"h": device_hash, "added": now, "seen": now, "label": (label or "")[:60]})
    devices.sort(key=lambda d: d.get("seen", 0), reverse=True)
    del devices[MAX_DEVICES:]
    mark_dirty()


def _code_hash(challenge_id, code):
    return hashlib.sha256(f"{challenge_id}:{code}".encode("utf-8")).hexdigest()


def new_challenge(acc, purpose, network_id=None, device_hash=None):
    """Caller holds CAMPAIGNS_LOCK. Returns (challengeId, code); the caller
    emails the code (outside the lock)."""
    now = time.time()
    for k in [k for k, c in CHALLENGES.items() if c["expires"] < now]:
        del CHALLENGES[k]
    cid = secrets.token_urlsafe(18)
    code = f"{secrets.randbelow(10000):04d}"
    CHALLENGES[cid] = {"accountId": acc["id"], "codeHash": _code_hash(cid, code), "expires": now + CODE_TTL, "tries": 0,
                       "purpose": purpose, "networkId": network_id, "deviceHash": device_hash, "sentAt": now}
    return cid, code


def masked_email(email):
    if not email or "@" not in email:
        return ""
    name, domain = email.split("@", 1)
    return (name[:2] + "•" * max(1, len(name) - 2)) + "@" + domain


def find_password_account(email):
    return next((a for a in ACCOUNTS.values() if a.get("password") and a.get("email") == email), None)


def find_provider_account(provider, sub):
    return next((a for a in ACCOUNTS.values() if (a.get("providers") or {}).get(provider) == sub), None)


def account_owning_network_id(network_id):
    return next((a for a in ACCOUNTS.values() if network_id in (a.get("linkedIds") or [])), None)


def _retarget_save(save_obj, network_id):
    # A save embeds the networkId it belongs to, and the client trusts that
    # field when it pulls a save down -- so a copy stored under a different
    # id must carry that id, or the device would flip back to the old one.
    if isinstance(save_obj, dict):
        save_obj["networkId"] = network_id


def merge_account_identities(acc):
    """Makes every id linked to this account behave as one person under the
    account's primary id. Strictly additive: adds the primary id to the
    campaigns any linked id belongs to, takes over ownership of campaigns a
    linked id owned (the old id stays a member), and copies player saves
    across when the primary has none -- nothing is deleted or overwritten.
    Caller holds CAMPAIGNS_LOCK. Returns True if anything changed."""
    primary, linked = acc["networkId"], set(acc.get("linkedIds") or [])
    changed = False
    for entry in CAMPAIGNS.values():
        meta = entry["meta"]
        members = meta.setdefault("memberIds", [])
        if linked & set(members) and primary not in members:
            members.append(primary)
            changed = True
        if meta.get("ownerId") in linked and meta["ownerId"] != primary:
            meta["ownerId"] = primary
            changed = True
        saves = entry["state"]["playerSaves"]
        for other in linked - {primary}:
            donor = saves.get(other)
            if not donor:
                continue
            mine = saves.get(primary)
            if not mine or not mine.get("current"):
                copied = copy.deepcopy(donor)
                if mine and mine.get("named"):
                    copied["named"] = {**copied.get("named", {}), **mine["named"]}
                saves[primary] = mine = copied
                changed = True
            for slug, named in (donor.get("named") or {}).items():
                if slug not in mine.setdefault("named", {}):
                    mine["named"][slug] = copy.deepcopy(named)
                    changed = True
            _retarget_save(mine.get("current"), primary)
            for named in mine.get("named", {}).values():
                _retarget_save(named, primary)
    return changed


# ---- Uploaded files ----
UPLOAD_DIR = Path(os.environ.get("PKDND_UPLOAD_DIR") or (DATA_DIR / "uploads"))
FILE_KINDS = ("map", "book")
IMAGE_MIMES = {b"\x89PNG\r\n\x1a\n": "image/png", b"\xff\xd8\xff": "image/jpeg", b"GIF87a": "image/gif", b"GIF89a": "image/gif"}
BOOK_EXTS = {"pdf": "application/pdf", "epub": "application/epub+zip", "txt": "text/plain", "md": "text/markdown",
             "html": "text/html", "htm": "text/html", "cbz": "application/vnd.comicbook+zip", "zip": "application/zip",
             "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
FILE_ID_RE = re.compile(r"f[0-9a-f]{20}")


def sniff_image(head):
    for magic, mime in IMAGE_MIMES.items():
        if head.startswith(magic):
            return mime
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


def file_path(rec):
    return UPLOAD_DIR / rec["owner"] / f"{rec['id']}.bin"


def live_files(owner=None, kind=None, campaign_id=None):
    """Caller holds CAMPAIGNS_LOCK."""
    return [f for f in FILES.values() if not f.get("deleted") and (owner is None or f["owner"] == owner)
            and (kind is None or f["kind"] == kind) and (campaign_id is None or f.get("campaignId") == campaign_id)]


def public_file(rec):
    return {k: rec.get(k) for k in ("id", "kind", "campaignId", "name", "mime", "size", "sha256", "created", "meta")}


def disk_free():
    try:
        return shutil.disk_usage(UPLOAD_DIR if UPLOAD_DIR.exists() else DATA_DIR).free
    except OSError:
        return 0


def clean_meta(raw, limit=60_000):
    """Small JSON metadata stored beside a file (a book's title/author/cover, a map's size)."""
    if not isinstance(raw, dict):
        return {}
    try:
        return raw if len(json.dumps(raw)) <= limit else {}
    except (TypeError, ValueError):
        return {}


# ---- The Pokémon hub ----
# One shared whiteboard per campaign. Items are notes, drawings and text from
# anyone, and the DM's encounter buttons. Cursors are only kept in memory for
# a few seconds: they change many times a second and never need saving.
HUB_MAX_ITEMS = 600
HUB_CURSOR_TTL = 6
HUB_CURSORS = {}   # campaignId -> {networkId: {name, color, x, y, t, down}}
HUB_PING_TTL = 4
HUB_PINGS = {}     # campaignId -> [{id, x, y, color, name, t}] -- "look here" ripples, gone after a few seconds
HUB_TYPES = ("note", "stroke", "text", "button", "mon", "move", "shape", "prop", "item", "trainer")   # mon / move: a Pokédex or Move Dex card; shape: a drawn rectangle, ellipse, line or arrow; prop: a picture from the prop library; item: a card for something from a bag; trainer: a player's character card
HUB_SHAPES = ("rect", "ellipse", "line", "arrow")
HUB_SOURCES = ("npc", "wild", "plan")


def _num(v, lo=-200000, hi=200000):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0
    return 0 if f != f else round(min(hi, max(lo, f)), 1)


def _hub_link(raw, kind):
    """Which of its owner's things a card shows: "trainer" (their character) or "mon:<id>" (one of their Pokémon).
    A player has at most one card per link on the hub (see the hub's "put")."""
    if kind == "trainer":
        return "trainer" if raw == "trainer" else None
    if isinstance(raw, str) and raw.startswith("mon:") and 4 < len(raw) <= 60 and all(c.isalnum() or c in "-_:" for c in raw):
        return raw
    return None


def clean_hub_item(raw, owner, is_dm):
    """A validated copy of one hub item, or None. Only the DM makes buttons."""
    if not isinstance(raw, dict) or raw.get("type") not in HUB_TYPES:
        return None
    kind = raw["type"]
    if kind == "button" and not is_dm:
        return None
    item = {"id": _text(raw.get("id"), 40) or secrets.token_hex(6), "type": kind, "owner": owner,
            "x": _num(raw.get("x")), "y": _num(raw.get("y")), "color": _colour(raw.get("color"), "#f0b45a"), "updated": time.time()}
    if kind == "note":
        item.update({"text": _text(raw.get("text"), 2000), "w": _num(raw.get("w"), 120, 900) or 220, "h": _num(raw.get("h"), 80, 900) or 160})
        if raw.get("dmOnly") is True:   # a note only the DM sees (never sent to players)
            if not is_dm:
                return None
            item["dmOnly"] = True
    elif kind == "text":
        item.update({"text": _text(raw.get("text"), 400), "size": _num(raw.get("size"), 12, 120) or 28})
    elif kind == "shape":
        if raw.get("shape") not in HUB_SHAPES:
            return None
        # x, y is where the drag started and x2, y2 where it ended (lines and arrows keep their direction)
        item.update({"shape": raw["shape"], "x2": _num(raw.get("x2")), "y2": _num(raw.get("y2")),
                     "width": _num(raw.get("width"), 1, 40) or 4, "fill": raw.get("fill") is True})
    elif kind == "prop":
        item.update({"prop": _text(raw.get("prop"), 24), "size": _num(raw.get("size"), 24, 400) or 64})
        if not item["prop"]:
            return None
    elif kind in ("mon", "move"):
        item["name"] = _text(raw.get("name"), 40)
        if not item["name"]:
            return None
        if kind == "mon":
            item["dex"] = int(_num(raw.get("dex"), 0, 5000))
            if raw.get("level") not in (None, ""):
                item["level"] = int(_num(raw.get("level"), 1, 100) or 1)   # optional: the level asked for when it was dropped
            # dragged in from a player's team: that Pokémon's own health, moves and held item
            hp = raw.get("hp")
            if isinstance(hp, list) and len(hp) == 2:
                item["hp"] = [int(_num(hp[0], 0, 5000)), int(_num(hp[1], 0, 5000))]
            moves = raw.get("moves")
            if isinstance(moves, list):
                item["moves"] = [_text(m, 40) for m in moves[:4] if _text(m, 40)]
            for key, size in (("nickname", 40), ("held", 40), ("ability", 40), ("status", 20)):
                if _text(raw.get(key), size):
                    item[key] = _text(raw.get(key), size)
        item["open"] = raw.get("open") is True   # the card shows its details
        link = _hub_link(raw.get("link"), "mon")
        if link:
            item["link"] = link
    elif kind == "item":
        item["name"] = _text(raw.get("name"), 60)
        if not item["name"]:
            return None
        item["open"] = raw.get("open") is True
    elif kind == "trainer":
        # a player's character card: a snapshot of their sheet, as label / value rows
        item["name"] = _text(raw.get("name"), MAX_NAME) or "Trainer"
        item["sprite"] = _text(raw.get("sprite"), 100)
        rows = raw.get("fields") if isinstance(raw.get("fields"), list) else []
        item["fields"] = [[_text(r[0], 30), _text(r[1], 200)] for r in rows[:20] if isinstance(r, list) and len(r) == 2 and _text(r[0], 30)]
        item["backstory"] = _text(raw.get("backstory"), 1500)
        party = raw.get("party") if isinstance(raw.get("party"), list) else []
        item["party"] = [{"name": _text(m.get("name"), 40), "dex": int(_num(m.get("dex"), 0, 5000)), "level": int(_num(m.get("level"), 0, 100)) or None}
                         for m in party[:6] if isinstance(m, dict) and _text(m.get("name"), 40)]
        item["open"] = raw.get("open") is True
        link = _hub_link(raw.get("link"), "trainer")
        if link:
            item["link"] = link
    elif kind == "stroke":
        pts = raw.get("pts") if isinstance(raw.get("pts"), list) else []
        item.update({"pts": [[_num(p[0]), _num(p[1])] for p in pts[:600] if isinstance(p, list) and len(p) == 2],
                     "width": _num(raw.get("width"), 1, 40) or 4})
        if len(item["pts"]) < 2:
            return None
    else:
        src = raw.get("source") if isinstance(raw.get("source"), dict) else {}
        if src.get("kind") not in HUB_SOURCES:
            return None
        mons = src.get("mons") if isinstance(src.get("mons"), list) else []
        item.update({
            "label": _text(raw.get("label"), 60) or "Encounter",
            "reveal": "sprite" if raw.get("reveal") == "sprite" else "hidden",
            "source": {"kind": src["kind"], "id": _text(src.get("id"), 80), "title": _text(src.get("title"), 120),
                       "trainer": _text(src.get("trainer"), 60), "sprite": _text(src.get("sprite"), 100),   # a trainer portrait file
                       "mons": [{"name": _text(m.get("name"), 40), "level": int(_num(m.get("level"), 1, 100) or 1)}
                                for m in mons[:6] if isinstance(m, dict) and _text(m.get("name"), 40)]},
        })
    return item


def clean_draft(raw):
    """A stroke someone is still drawing (sent with their cursor), or None."""
    if not isinstance(raw, dict) or not isinstance(raw.get("pts"), list):
        return None
    pts = [[_num(p[0]), _num(p[1])] for p in raw["pts"][-400:] if isinstance(p, list) and len(p) == 2]
    if len(pts) < 2:
        return None
    return {"pts": pts, "color": _colour(raw.get("color"), "#5aa8f0"), "width": _num(raw.get("width"), 1, 40) or 4}


def hub_roster(state, meta, with_details, dm_ids=()):
    """Everyone in the campaign, online or not: name, portrait and whether they're here. With details (the DM),
    also each one's party, bag and money, from their live presence or, when they're away, their last saved copy,
    and whether they're a DM (dm_ids), so the Whiteboard can level encounters on the players alone."""
    now = time.time()
    ids = list(dict.fromkeys(list(meta.get("memberIds") or []) + list(state["trainers"].keys())))
    out = []
    for tid in ids:
        live = state["trainers"].get(tid)
        saved = (state["playerSaves"].get(tid) or {}).get("current") or {}
        trainer = saved.get("trainer") if isinstance(saved.get("trainer"), dict) else {}
        name = (live or {}).get("name") or trainer.get("name") or ""
        if not name and not saved and not live:
            continue
        row = {"id": tid, "name": name or "Trainer", "sprite": (live or {}).get("sprite") or trainer.get("sprite") or "",
               "online": bool(live and now - live.get("lastSeen", 0) < TRAINER_TIMEOUT),
               "lastSeen": (live or {}).get("lastSeen") or 0}
        if with_details:
            team = (live or {}).get("team") or {}
            row["party"] = team.get("party") if live and isinstance(team.get("party"), list) else saved.get("party") or []
            row["bag"] = team.get("bag") if live and isinstance(team.get("bag"), dict) else saved.get("bag") or {}
            cash = team.get("cash") if live and "cash" in team else trainer.get("cash")
            row["cash"] = cash if isinstance(cash, (int, float)) else 0
            row["dm"] = tid in dm_ids
        out.append(row)
    return out


def hub_button_preview(state, item):
    """What hovering a button shows: the first Pokémon's level (and name, for
    the sprite when the DM allows it), read fresh from the DM's libraries."""
    src = item.get("source") or {}
    first, count = None, 0
    if src.get("kind") == "npc":
        npc = state["npcTrainers"].get(src.get("id")) or {}
        party = [m for m in ((npc.get("team") or {}).get("party") or []) if isinstance(m, dict) and m.get("name")]
        first, count = (party[0] if party else None), len(party)
    elif src.get("kind") == "wild":
        first, count = state["wildPokemon"].get(src.get("id")), 1
    else:
        mons = src.get("mons") or []
        first, count = (mons[0] if mons else None), len(mons)
    sprite = ((state["npcTrainers"].get(src.get("id")) or {}).get("sprite") if src.get("kind") == "npc" else None) or src.get("sprite") or ""
    if not first:
        return {"level": None, "name": None, "count": count, "missing": src.get("kind") != "plan", "portrait": sprite}
    return {"level": first.get("level"), "name": first.get("name") if item.get("reveal") == "sprite" else None, "count": count, "portrait": sprite}


# Largest request body accepted (a full player save with a big PC box is well
# under 1 MB) and the longest free-text / name fields stored from clients.
MAX_BODY = 4 * 1024 * 1024
MAX_PARTYMAP = 2_600_000  # the DM's shared map image (a data: URL) may be up to this long
MAX_PLAN = 200_000  # largest planner document (notes + checklists) one player may share with the DM, as JSON
MAX_NAME = 60
MAX_TEXT = 1000
MAX_INBOX = 100
BALL_NAMES = ("Poké Ball", "Great Ball", "Ultra Ball", "Master Ball")   # js/calc.js BALL_TYPES

# Only the sign-in providers' own hosts may be scripted/framed/contacted, and
# nothing but this site may frame us. 'unsafe-inline' is for style
# attributes only; there are no inline scripts.
CONTENT_SECURITY_POLICY = "; ".join([
    "default-src 'self'",
    "script-src 'self' https://accounts.google.com https://appleid.cdn-apple.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob:",   # blob: shows map images fetched with the session (never a URL with a token in it)
    # Pokémon cries are streamed from the PokeAPI cries collection, or Showdown's MP3s for browsers without Ogg (js/hubSound.js)
    "media-src 'self' https://raw.githubusercontent.com https://play.pokemonshowdown.com",
    "frame-src https://accounts.google.com https://appleid.apple.com",
    "connect-src 'self' https://accounts.google.com https://appleid.apple.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://appleid.apple.com",
    "frame-ancestors 'none'",
])


class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = "PokemonDnD"  # don't advertise the Python/BaseHTTP version
    sys_version = ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # avoid the browser/phone caching stale JSON while you're iterating
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Content-Security-Policy", CONTENT_SECURITY_POLICY)
        # HSTS only when the (local) reverse proxy says the visitor is on https.
        if self.client_address[0] in ("127.0.0.1", "::1") and self.headers.get("X-Forwarded-Proto") == "https":
            self.send_header("Strict-Transport-Security", "max-age=31536000")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)  # never list folder contents
        return None

    def log_message(self, fmt, *args):
        pass  # keep the console quiet; comment this out if you want request logs

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        """The parsed JSON body, {} if absent or malformed, or None when it
        is larger than MAX_BODY (the caller answers 413 without reading it)."""
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            return {}
        if length <= 0:
            return {}
        if length > MAX_BODY:
            return None
        try:
            parsed = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}

    def _campaign(self, cid):
        """Looks up a campaign by id, or None. Caller sends the 404 itself
        so it can word the error for its own endpoint."""
        return CAMPAIGNS.get(cid) if cid else None

    def _prune_trainers(self, state):
        cutoff = time.time() - TRAINER_TIMEOUT
        stale = [tid for tid, t in state["trainers"].items() if t["lastSeen"] < cutoff]
        for tid in stale:
            del state["trainers"][tid]

    def _dm_ok(self, token, cid):
        rec = DM_TOKENS.get(token) if token else None
        if not rec:
            return False
        if rec["exp"] < time.time():
            DM_TOKENS.pop(token, None)
            return False
        if rec["cid"] != cid:
            return False
        # checked every time, so taking someone's DM access away stops their token at once
        if not has_dm_access(CAMPAIGNS.get(cid), ACCOUNTS.get(rec.get("acc"))):
            DM_TOKENS.pop(token, None)
            return False
        return True

    def _require_dm(self, data, cid):
        return self._dm_ok(data.get("token"), cid)

    def _client_key(self):
        if TRUST_PROXY:
            fwd = self.headers.get("X-Forwarded-For", "")
            if fwd:
                return fwd.split(",")[-1].strip()
        return self.client_address[0]

    # ---------------- API ----------------

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._api_get()
        if not static_path_allowed(self.path):
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        if self.path.startswith("/api/") or not static_path_allowed(self.path):
            return self.send_error(404)
        return super().do_HEAD()

    # ---------------- Accounts API ----------------

    def _client_ip(self):
        peer = self.client_address[0]
        if peer in ("127.0.0.1", "::1"):
            # Only trust X-Forwarded-For when the connection came from the
            # reverse proxy on this same machine (Caddy); a direct client
            # could otherwise spoof it to dodge the login throttle.
            fwd = self.headers.get("X-Forwarded-For", "").split(",")[0].strip()
            if fwd:
                return fwd
        return peer

    def _bearer(self):
        h = self.headers.get("Authorization", "")
        return h[7:].strip() if h[:7].lower() == "bearer " else None

    # ---- Who is asking? (all of these: caller holds CAMPAIGNS_LOCK) ----
    # Identity comes from the signed-in session, never from an id the client
    # merely claims: ids are visible to every campaign member (the online
    # list), so trusting them would let anyone act as anyone.

    def _signed_in_for(self, network_id):
        """The signed-in account for this request, but only if network_id is
        one of that account's own ids."""
        acc = account_from_token(self._bearer())
        return acc if acc and network_id and network_id in (acc.get("linkedIds") or []) else None

    def _member_account(self, entry):
        """The signed-in account if it belongs to this campaign, else None."""
        acc = account_from_token(self._bearer())
        if acc and set(entry["meta"].get("memberIds") or []) & set(acc.get("linkedIds") or []):
            return acc
        return None

    @staticmethod
    def _owns_campaign(acc, entry):
        return bool(acc) and entry["meta"].get("ownerId") in (acc.get("linkedIds") or [])

    def _deny(self):
        """401 when nobody is signed in, 403 when someone is but isn't a member."""
        if account_from_token(self._bearer()) is None:
            return self._send_json({"error": "sign in required"}, 401)
        return self._send_json({"error": "not a member of this campaign"}, 403)

    def _auth_get(self, parts):
        action = parts[2] if len(parts) > 2 else ""
        if action == "config":
            return self._send_json({"google": GOOGLE_CLIENT_ID, "apple": APPLE_CLIENT_ID, "emailCodes": mailer.configured()})
        if action == "me":
            with CAMPAIGNS_LOCK:
                acc = account_from_token(self._bearer())
                if not acc:
                    return self._send_json({"error": "not signed in"}, 401)
                # A device that already holds a valid session is one the person
                # signed in on before codes existed: remember it, so they aren't
                # asked for a code on a device they've been using all along.
                trust_device(acc, _device_hash(self.headers.get("X-Device-Key")), self._device_label())
                return self._send_json({"account": public_account(acc)})
        return self._send_json({"error": "not found"}, 404)

    def _device_label(self):
        ua = self.headers.get("User-Agent", "")
        browser = next(({"Edg": "Edge", "OPR": "Opera"}.get(n, n) for n in ("Edg", "OPR", "Firefox", "Chrome", "Safari") if n in ua), "Browser")
        for key, os_name in (("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android"), ("Windows", "Windows"), ("Mac OS", "Mac"), ("Linux", "Linux")):
            if key in ua:
                return f"{browser} on {os_name}"
        return browser

    def _send_code(self, acc, purpose, network_id=None, device_hash=None):
        """Emails a fresh code and answers with the challenge to quote back."""
        with CAMPAIGNS_LOCK:
            challenge, code = new_challenge(acc, purpose, network_id, device_hash)
            email = acc.get("email")
        if not mailer.send_code(email, code, purpose):
            with CAMPAIGNS_LOCK:
                CHALLENGES.pop(challenge, None)
            return self._send_json({"error": "Couldn't send the code email. Try again in a minute."}, 502)
        return self._send_json({"needCode": True, "challenge": challenge, "sentTo": masked_email(email)})

    def _auth_post(self, parts, data):
        action = parts[2] if len(parts) > 2 else ""
        ip = self._client_ip()
        device_hash = _device_hash(data.get("deviceKey"))
        network_id = data.get("networkId")
        if network_id is not None and (not isinstance(network_id, str) or not network_id or len(network_id) > 100):
            return self._send_json({"error": "bad networkId"}, 400)

        if action == "logout":
            token = self._bearer()
            with CAMPAIGNS_LOCK:
                if token and SESSIONS.pop(_hash_token(token), None):
                    mark_dirty()
            return self._send_json({"ok": True})

        if action == "set-password":
            # For a Google/Apple-created account that has no password yet, so
            # it can also sign in with email + password (the desktop app can't
            # use Google's popup). Only for the signed-in account, only once.
            password = data.get("password")
            problem = auth.password_problem(password)
            if problem:
                return self._send_json({"error": problem}, 400)
            if auth_blocked(f"reg:{ip}", AUTH_LIMIT_REGISTER):
                return self._send_json({"error": "Too many attempts. Try again in a few minutes."}, 429)
            auth_note(f"reg:{ip}")
            record = auth.hash_password(password)  # slow on purpose -- kept outside the lock
            with CAMPAIGNS_LOCK:
                acc = account_from_token(self._bearer())
                if not acc:
                    return self._send_json({"error": "not signed in"}, 401)
                if acc.get("password"):
                    return self._send_json({"error": "This account already has a password."}, 409)
                email = acc.get("email")
                if not email:
                    return self._send_json({"error": "This account has no email address to sign in with."}, 400)
                if find_password_account(email):
                    return self._send_json({"error": "Another account already uses that email."}, 409)
                acc["password"] = record
                mark_dirty()
                return self._send_json({"account": public_account(acc)})

        if action == "register":
            email, password = auth.normalize_email(data.get("email")), data.get("password")
            if not email:
                return self._send_json({"error": "Enter a valid email address."}, 400)
            problem = auth.password_problem(password)
            if problem:
                return self._send_json({"error": problem}, 400)
            if not network_id:
                return self._send_json({"error": "missing networkId"}, 400)
            if auth_blocked(f"reg:{ip}", AUTH_LIMIT_REGISTER):
                return self._send_json({"error": "Too many sign-up attempts. Try again in a few minutes."}, 429)
            auth_note(f"reg:{ip}")
            record = auth.hash_password(password)  # slow on purpose -- kept outside the lock
            with CAMPAIGNS_LOCK:
                if find_password_account(email):
                    return self._send_json({"error": "An account with that email already exists. Try signing in."}, 409)
                # A device already used by another account (someone else's, or your own second one) still gets the
                # new account: it just has its own fresh trainer id instead of taking the device's, which stays with
                # the account it belongs to. The browser switches to the new id (keeping a named copy of its old save).
                if account_owning_network_id(network_id):
                    network_id = "trainer-" + secrets.token_hex(16)
                acc = {
                    "id": secrets.token_hex(8), "email": email, "password": record, "providers": {},
                    "networkId": network_id, "linkedIds": [network_id], "createdAt": time.time(),
                }
                ACCOUNTS[acc["id"]] = acc
                trust_device(acc, device_hash, self._device_label())   # the device an account was made on is trusted
                token = issue_session(acc["id"])
                mark_dirty()
                return self._send_json({"token": token, "account": public_account(acc)})

        if action == "login":
            email, password = auth.normalize_email(data.get("email")), data.get("password")
            if not email or not isinstance(password, str) or len(password) > auth.MAX_PASSWORD_LEN:
                return self._send_json({"error": "Wrong email or password."}, 401)
            if auth_blocked(f"ip:{ip}", AUTH_LIMIT_IP) or auth_blocked(f"email:{email}", AUTH_LIMIT_EMAIL):
                return self._send_json({"error": "Too many attempts. Try again in a few minutes."}, 429)
            with CAMPAIGNS_LOCK:
                acc = find_password_account(email)
                record, acc_id = (acc["password"], acc["id"]) if acc else (None, None)
            if record is None:
                auth.burn_password_check(password)
                ok = False
            else:
                ok = auth.verify_password(password, record)  # slow -- outside the lock
            if not ok:
                auth_note(f"ip:{ip}")
                auth_note(f"email:{email}")
                return self._send_json({"error": "Wrong email or password."}, 401)
            with CAMPAIGNS_LOCK:
                acc = ACCOUNTS.get(acc_id)
                if not acc:
                    return self._send_json({"error": "Wrong email or password."}, 401)
                # A new device needs the emailed code first. Without a mail
                # provider configured nobody could get one, so sign-in then
                # works as it always did instead of locking everyone out.
                need_code = mailer.configured() and acc.get("email") and not device_trusted(acc, device_hash)
                if not need_code:
                    trust_device(acc, device_hash, self._device_label())
                    self._link_device(acc, network_id)
                    token = issue_session(acc["id"])
                    mark_dirty()
                    return self._send_json({"token": token, "account": public_account(acc)})
            if auth_blocked(f"code:{acc_id}", AUTH_LIMIT_EMAIL):
                return self._send_json({"error": "Too many codes sent. Try again in a few minutes."}, 429)
            auth_note(f"code:{acc_id}")
            return self._send_code(acc, "login", network_id, device_hash)

        if action == "verify":
            # The 4-digit code: finishes a new-device sign-in, or confirms the
            # signed-in account's email address.
            challenge, code = data.get("challenge"), data.get("code")
            code = code.strip() if isinstance(code, str) else ""
            if not isinstance(challenge, str):
                return self._send_json({"error": "That code has expired. Ask for a new one."}, 410)
            with CAMPAIGNS_LOCK:
                c = CHALLENGES.get(challenge)
                if not c or c["expires"] < time.time():
                    CHALLENGES.pop(challenge, None)
                    return self._send_json({"error": "That code has expired. Ask for a new one."}, 410)
                if not re.fullmatch(r"[0-9]{4}", code) or not secrets.compare_digest(c["codeHash"], _code_hash(challenge, code)):
                    c["tries"] += 1
                    if c["tries"] >= CODE_TRIES:
                        del CHALLENGES[challenge]
                        return self._send_json({"error": "Too many wrong codes. Start again to get a new one."}, 410)
                    left = CODE_TRIES - c["tries"]
                    return self._send_json({"error": f"That code isn't right. {left} {'try' if left == 1 else 'tries'} left."}, 401)
                del CHALLENGES[challenge]
                acc = ACCOUNTS.get(c["accountId"])
                if not acc:
                    return self._send_json({"error": "That account no longer exists."}, 410)
                acc["emailVerified"] = True   # the code went to that address, so they own it
                mark_dirty()
                if c["purpose"] == "verify":
                    return self._send_json({"account": public_account(acc)})
                trust_device(acc, c["deviceHash"], self._device_label())
                self._link_device(acc, c["networkId"])
                token = issue_session(acc["id"])
                return self._send_json({"token": token, "account": public_account(acc)})

        if action == "resend":
            challenge = data.get("challenge")
            with CAMPAIGNS_LOCK:
                c = CHALLENGES.pop(challenge, None) if isinstance(challenge, str) else None
                acc = ACCOUNTS.get(c["accountId"]) if c else None
            if not acc:
                return self._send_json({"error": "That sign-in has expired. Start again."}, 410)
            if auth_blocked(f"code:{acc['id']}", AUTH_LIMIT_EMAIL):
                return self._send_json({"error": "Too many codes sent. Try again in a few minutes."}, 429)
            auth_note(f"code:{acc['id']}")
            return self._send_code(acc, c["purpose"], c["networkId"], c["deviceHash"])

        if action == "verify-email":
            # Signed in: email a code to the account's own address to confirm it.
            with CAMPAIGNS_LOCK:
                acc = account_from_token(self._bearer())
            if not acc:
                return self._send_json({"error": "not signed in"}, 401)
            if not acc.get("email"):
                return self._send_json({"error": "This account has no email address."}, 400)
            if not mailer.configured():
                return self._send_json({"error": "Email isn't set up on this server yet."}, 503)
            if auth_blocked(f"code:{acc['id']}", AUTH_LIMIT_EMAIL):
                return self._send_json({"error": "Too many codes sent. Try again in a few minutes."}, 429)
            auth_note(f"code:{acc['id']}")
            return self._send_code(acc, "verify")

        if action in ("google", "apple"):
            provider, audience = (auth.GOOGLE, GOOGLE_CLIENT_ID) if action == "google" else (auth.APPLE, APPLE_CLIENT_ID)
            label = action.capitalize()
            if not audience:
                return self._send_json({"error": f"Sign in with {label} isn't set up on this server yet."}, 503)
            if auth_blocked(f"ip:{ip}", AUTH_LIMIT_IP):
                return self._send_json({"error": "Too many attempts. Try again in a few minutes."}, 429)
            try:
                claims = auth.verify_id_token(data.get("credential") or data.get("id_token") or "", provider, audience)
            except ValueError as e:
                auth_note(f"ip:{ip}")
                return self._send_json({"error": f"Couldn't verify that {label} sign-in ({e})."}, 401)
            sub = claims["sub"]
            with CAMPAIGNS_LOCK:
                current = account_from_token(self._bearer())
                existing = find_provider_account(action, sub)
                if current:
                    # Signed in already: this adds the provider to THAT account.
                    if existing and existing is not current:
                        return self._send_json({"error": f"That {label} account is already linked to a different account here."}, 409)
                    current.setdefault("providers", {})[action] = sub
                    acc = current
                elif existing:
                    acc = existing
                else:
                    # Never auto-merged into an email/password account that
                    # merely has the same email address: that email was never
                    # verified, so matching on it would let anyone pre-register
                    # someone else's address and inherit their account.
                    primary = network_id if (network_id and not account_owning_network_id(network_id)) else "trainer-" + secrets.token_hex(16)
                    # Only keep an address the provider says it verified: it
                    # can later become this account's email-login name.
                    verified = claims.get("email_verified") in (True, "true")
                    acc = {
                        "id": secrets.token_hex(8), "email": claims.get("email") if verified else None, "password": None,
                        "providers": {action: sub}, "networkId": primary, "linkedIds": [primary], "createdAt": time.time(),
                    }
                    ACCOUNTS[acc["id"]] = acc
                if acc.get("email") and claims.get("email_verified") in (True, "true") and (claims.get("email") or "").lower() == acc["email"].lower():
                    acc["emailVerified"] = True
                trust_device(acc, device_hash, self._device_label())
                self._link_device(acc, network_id)
                token = issue_session(acc["id"])
                mark_dirty()
                return self._send_json({"token": token, "account": public_account(acc)})

        return self._send_json({"error": "not found"}, 404)

    def _link_device(self, acc, network_id):
        """Caller holds CAMPAIGNS_LOCK. Records this device's own id on the
        account (unless it already belongs to a different account -- never
        take an id away from someone) and folds everything together."""
        if network_id and network_id not in acc["linkedIds"]:
            other = account_owning_network_id(network_id)
            if other is None or other is acc:
                acc["linkedIds"].append(network_id)
        merge_account_identities(acc)

    # ---------------- Uploaded files ----------------

    def _upload(self):
        """POST /api/files/upload?kind=map&campaignId=..&name=.. with the raw file as the body. Streamed to disk
        in pieces (never held in memory), checked against the account's limits before a byte is read."""
        qs = parse_qs(urlparse(self.path).query)
        kind, cid, name = qs.get("kind", [""])[0], qs.get("campaignId", [None])[0], unquote(qs.get("name", [""])[0])
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = 0
        def refuse(msg, status):
            self.close_connection = True   # the unread body must not be taken for the next request
            return self._send_json({"error": msg}, status)
        if kind not in FILE_KINDS or length <= 0:
            return refuse("bad upload", 400)
        if auth_blocked(f"upload:{self._client_ip()}", 120):
            return refuse("Too many uploads. Try again in a few minutes.", 429)
        auth_note(f"upload:{self._client_ip()}")
        with CAMPAIGNS_LOCK:
            acc = account_from_token(self._bearer())
            if not acc:
                return refuse("sign in required", 401)
            limits = account_limits(acc)
            if kind == "map":
                entry = self._campaign(cid)
                if not entry or not self._member_account(entry):
                    return refuse("not a member of this campaign", 403)
                cap = limits["mapsPerCampaign"]
                if cap is not None and len(live_files(acc["id"], "map", cid)) >= cap:
                    return refuse(f"You can keep {cap} maps in a campaign. Delete one to add another.", 409)
                max_bytes = limits["mapBytes"]
            else:
                if not limits["bookBytes"]:
                    return refuse("Your account keeps books on this device only.", 403)
                cid, max_bytes = None, limits["bookBytes"]
            owner = acc["id"]
        if length > max_bytes:
            return refuse(f"That file is over the {max_bytes // MB} MB limit.", 413)
        if disk_free() - length < MIN_FREE_DISK:
            return refuse("The server is running out of space. Ask the admin.", 507)
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if kind == "book" and ext not in BOOK_EXTS:
            return refuse("That isn't a book format the Library reads.", 415)
        fid = "f" + secrets.token_hex(10)
        folder = UPLOAD_DIR / owner
        folder.mkdir(parents=True, exist_ok=True)
        tmp = folder / f"{fid}.part"
        digest, got, head = hashlib.sha256(), 0, b""
        try:
            with open(tmp, "wb") as out:
                while got < length:
                    chunk = self.rfile.read(min(1024 * 1024, length - got))
                    if not chunk:
                        break
                    if len(head) < 16:
                        head += chunk[:16]
                    digest.update(chunk)
                    out.write(chunk)
                    got += len(chunk)
            if got != length:
                raise ValueError("upload cut short")
            mime = sniff_image(head) if kind == "map" else BOOK_EXTS[ext]
            if kind == "map" and not mime:
                raise TypeError("not an image")
            if kind == "book" and ext == "pdf" and not head.startswith(b"%PDF"):
                raise TypeError("not a PDF")
        except TypeError:
            tmp.unlink(missing_ok=True)
            return self._send_json({"error": "Maps must be PNG, JPEG, WebP or GIF images." if kind == "map" else "That file isn't a real PDF."}, 415)
        except Exception:
            tmp.unlink(missing_ok=True)
            self.close_connection = True
            return self._send_json({"error": "The upload didn't finish. Try again."}, 400)
        rec = {"id": fid, "owner": owner, "kind": kind, "campaignId": cid, "name": name.strip()[:120] or kind,
               "mime": mime, "size": got, "sha256": digest.hexdigest(), "created": time.time(), "meta": {}, "deleted": None}
        tmp.replace(file_path(rec))
        with CAMPAIGNS_LOCK:
            FILES[fid] = rec
            mark_dirty()
        return self._send_json({"file": public_file(rec)})

    def _may_read_file(self, acc, rec):
        """Caller holds CAMPAIGNS_LOCK. Your own files, plus the map a campaign's DM shares with that campaign."""
        if rec["owner"] == acc["id"]:
            return True
        if rec["kind"] == "map":
            entry = self._campaign(rec.get("campaignId"))
            if not entry or not self._member_account(entry):
                return False
            pm = entry["state"].get("partyMap")
            bd = (entry["state"].get("hub") or {}).get("backdrop")
            return bool((pm and pm.get("fileId") == rec["id"]) or (bd and bd.get("fileId") == rec["id"]))
        return False

    def _files_get(self, parts, qs):
        with CAMPAIGNS_LOCK:
            acc = account_from_token(self._bearer())
            if not acc:
                return self._send_json({"error": "sign in required"}, 401)
            if len(parts) == 2:
                # GET /api/files?kind=map&campaignId=.. -- your own files, with your limits and usage
                kind, cid = qs.get("kind", [None])[0], qs.get("campaignId", [None])[0]
                rows = live_files(acc["id"], kind if kind in FILE_KINDS else None, cid if kind == "map" else None)
                rows.sort(key=lambda f: f["created"], reverse=True)
                return self._send_json({"files": [public_file(f) for f in rows], "limits": account_limits(acc),
                                        "perms": effective_perms(acc), "used": sum(f["size"] for f in live_files(acc["id"]))})
            rec = FILES.get(parts[2]) if len(parts) == 3 else None
            if not rec or rec.get("deleted") or not self._may_read_file(acc, rec):
                return self._send_json({"error": "not found"}, 404)
            path, etag = file_path(rec), f'"{rec["sha256"]}"'
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.end_headers()
            return
        try:
            size = path.stat().st_size
            src = open(path, "rb")
        except OSError:
            return self._send_json({"error": "the file is missing on the server"}, 410)
        with src:
            self.send_response(200)
            self.send_header("Content-Type", rec["mime"])
            self.send_header("Content-Length", str(size))
            self.send_header("ETag", etag)
            self.send_header("Content-Disposition", "attachment" if rec["kind"] == "book" else "inline")
            self.end_headers()
            shutil.copyfileobj(src, self.wfile, 1024 * 1024)

    def _files_post(self, parts, data):
        # POST /api/files/<id>/meta {name?, meta?}   POST /api/files/<id>/delete
        with CAMPAIGNS_LOCK:
            acc = account_from_token(self._bearer())
            if not acc:
                return self._send_json({"error": "sign in required"}, 401)
            rec = FILES.get(parts[2]) if len(parts) == 4 else None
            if not rec or rec.get("deleted") or rec["owner"] != acc["id"]:
                return self._send_json({"error": "not found"}, 404)
            if parts[3] == "meta":
                if isinstance(data.get("name"), str) and data["name"].strip():
                    rec["name"] = data["name"].strip()[:120]
                if "meta" in data:
                    rec["meta"] = clean_meta(data.get("meta"))
                mark_dirty()
                return self._send_json({"file": public_file(rec)})
            if parts[3] == "delete":
                # Kept aside, not erased: the record is marked and the bytes move to _deleted/ (never served again).
                rec["deleted"] = time.time()
                src = file_path(rec)
                trash = UPLOAD_DIR / "_deleted" / rec["owner"]
                try:
                    trash.mkdir(parents=True, exist_ok=True)
                    if src.exists():
                        src.replace(trash / src.name)
                except OSError:
                    pass
                for entry in CAMPAIGNS.values():
                    pm = entry["state"].get("partyMap")
                    if pm and pm.get("fileId") == rec["id"]:
                        entry["state"]["partyMap"] = None
                    hub = entry["state"].get("hub") or {}
                    if (hub.get("backdrop") or {}).get("fileId") == rec["id"]:
                        hub["backdrop"] = None
                        hub["rev"] = hub.get("rev", 0) + 1
                mark_dirty()
                return self._send_json({"ok": True})
        return self._send_json({"error": "not found"}, 404)

    # ---------------- Admin console ----------------

    def _admin(self):
        """Caller holds CAMPAIGNS_LOCK. The signed-in account if it is an admin."""
        acc = account_from_token(self._bearer())
        return acc if acc and effective_perms(acc)["admin"] else None

    def _admin_overview(self):
        """Caller holds CAMPAIGNS_LOCK."""
        email_of = {}
        for a in ACCOUNTS.values():
            for nid in a.get("linkedIds") or []:
                email_of[nid] = a.get("email") or "(no email)"
        accounts = []
        for a in sorted(ACCOUNTS.values(), key=lambda a: a.get("createdAt") or 0):
            ids = set(a.get("linkedIds") or [])
            files = live_files(a["id"])
            accounts.append({
                "id": a["id"], "email": a.get("email"), "emailVerified": bool(a.get("emailVerified")),
                "createdAt": a.get("createdAt"), "providers": sorted(a.get("providers") or {}), "hasPassword": bool(a.get("password")),
                "perms": effective_perms(a), "granted": {k: (a.get("perms") or {}).get(k) is True for k in PERMS}, "envAdmin": env_admin(a),
                "devices": len(a.get("devices") or []), "lastSeen": max([d.get("seen", 0) for d in a.get("devices") or []] or [0]),
                "campaigns": sum(1 for e in CAMPAIGNS.values() if ids & set(e["meta"].get("memberIds") or [])),
                "files": len(files), "bytes": sum(f["size"] for f in files),
            })
        campaigns = [{
            "id": c, "name": e["meta"].get("name"), "system": e["meta"].get("system"), "members": len(e["meta"].get("memberIds") or []),
            "owner": email_of.get(e["meta"].get("ownerId"), "(no account)"), "createdAt": e["meta"].get("createdAt"),
            "online": sum(1 for t in e["state"]["trainers"].values() if time.time() - t.get("lastSeen", 0) < TRAINER_TIMEOUT),
            "maps": len(live_files(kind="map", campaign_id=c)),
        } for c, e in CAMPAIGNS.items()]
        archived = [{"id": c, "name": e["meta"].get("name"), "system": e["meta"].get("system"), "members": len(e["meta"].get("memberIds") or []),
                     "owner": email_of.get(e["meta"].get("ownerId"), "(no account)"), "archivedAt": e.get("archivedAt"), "archivedBy": e.get("archivedBy")}
                    for c, e in sorted(ARCHIVED.items(), key=lambda kv: kv[1].get("archivedAt") or 0, reverse=True)]
        all_files = live_files()
        try:
            disk = shutil.disk_usage(DATA_DIR)
            disk = {"total": disk.total, "free": disk.free}
        except OSError:
            disk = None
        return {
            "accounts": accounts, "campaigns": campaigns, "archived": archived, "perms": PERMS, "mail": mailer.describe(),
            "storage": {"disk": disk, "files": len(all_files), "fileBytes": sum(f["size"] for f in all_files),
                        "books": sum(1 for f in all_files if f["kind"] == "book"), "maps": sum(1 for f in all_files if f["kind"] == "map"),
                        "stateBytes": STATE_FILE.stat().st_size if STATE_FILE.exists() else 0},
            "limits": {"standard": LIMITS_STANDARD, "elevatedMaps": LIMITS_ELEVATED_MAPS, "cloudBookBytes": BOOK_BYTES_CLOUD},
        }

    def _admin_get(self, parts):
        with CAMPAIGNS_LOCK:
            if not self._admin():
                return self._send_json({"error": "not found"}, 404)   # the console doesn't admit it exists
            if parts[2:] == ["overview"]:
                return self._send_json(self._admin_overview())
        return self._send_json({"error": "not found"}, 404)

    def _set_perm(self, me, target, perm, value):
        """Caller holds CAMPAIGNS_LOCK. Returns a sentence for the console."""
        if perm not in PERMS:
            return f"Unknown permission '{perm}'. Known: {', '.join(PERMS)}."
        if perm == "admin" and env_admin(target) and not value:
            return f"{target.get('email')} is an admin from the server settings; that can't be taken away here."
        if perm == "admin" and target is me and not value:
            return "You can't remove your own admin access."
        target.setdefault("perms", {})[perm] = bool(value)
        mark_dirty()
        state = "now has" if effective_perms(target)[perm] else "no longer has"
        return f"{target.get('email') or target['id']} {state} {perm}."

    def _admin_post(self, parts, data):
        with CAMPAIGNS_LOCK:
            me = self._admin()
            if not me:
                return self._send_json({"error": "not found"}, 404)
            if parts[2:] == ["perm"]:
                target = ACCOUNTS.get(data.get("accountId"))
                if not target:
                    return self._send_json({"error": "no such account"}, 404)
                msg = self._set_perm(me, target, data.get("perm"), data.get("value") is True)
                return self._send_json({"message": msg, "overview": self._admin_overview()})
            if parts[2:] == ["command"]:
                return self._send_json({"output": self._admin_command(me, data.get("text")), "overview": self._admin_overview()})
            if parts[2:] == ["campaign"]:
                msg = self._archive_campaign(me, data.get("id"), data.get("action"))
                return self._send_json({"message": msg, "overview": self._admin_overview()})
        return self._send_json({"error": "not found"}, 404)

    def _archive_campaign(self, me, cid, action):
        """Caller holds CAMPAIGNS_LOCK. "archive" takes a campaign away from everyone (kept whole in ARCHIVED, so it
        can come back); "restore" puts it back exactly as it was."""
        if action == "archive":
            entry = CAMPAIGNS.pop(cid, None) if isinstance(cid, str) else None
            if not entry:
                return "No such campaign."
            ARCHIVED[cid] = {**entry, "archivedAt": time.time(), "archivedBy": me.get("email") or me["id"]}
            HUB_CURSORS.pop(cid, None)
            HUB_PINGS.pop(cid, None)
            for tok in [t for t, rec in DM_TOKENS.items() if rec.get("cid") == cid]:
                del DM_TOKENS[tok]
            mark_dirty()
            return f"Deleted \"{entry['meta'].get('name')}\". It's in Deleted campaigns if you need it back."
        if action == "restore":
            entry = ARCHIVED.pop(cid, None) if isinstance(cid, str) else None
            if not entry:
                return "No such deleted campaign."
            entry.pop("archivedAt", None)
            entry.pop("archivedBy", None)
            CAMPAIGNS[cid] = entry
            mark_dirty()
            return f"Restored \"{entry['meta'].get('name')}\"."
        return "Unknown campaign action."

    def _admin_command(self, me, text):
        """Caller holds CAMPAIGNS_LOCK. A tiny command line for the console:
        grant/revoke <email> <permission>, perms <email>, signout <email>, who, help."""
        words = text.split() if isinstance(text, str) else []
        if not words or words[0] in ("help", "?"):
            return ("Commands:\n  grant <email> <permission>    give someone a permission\n  revoke <email> <permission>   take it away\n"
                    "  perms <email>                 show what someone has\n  signout <email>               end all their sessions (they sign in again)\n"
                    "  who                           every account and its permissions\n"
                    f"Permissions: {', '.join(f'{k} ({v})' for k, v in PERMS.items())}")
        cmd = words[0].lower()

        def find(email):
            email = (email or "").lower()
            return next((a for a in ACCOUNTS.values() if (a.get("email") or "").lower() == email), None)
        if cmd == "who":
            lines = []
            for a in sorted(ACCOUNTS.values(), key=lambda a: (a.get("email") or "")):
                on = [k for k, v in effective_perms(a).items() if v]
                lines.append(f"{a.get('email') or a['id']}: {', '.join(on) or 'standard'}")
            return "\n".join(lines) or "No accounts yet."
        if cmd in ("grant", "revoke") and len(words) == 3:
            target = find(words[1])
            return self._set_perm(me, target, words[2], cmd == "grant") if target else f"No account with the email {words[1]}."
        if cmd == "perms" and len(words) == 2:
            target = find(words[1])
            if not target:
                return f"No account with the email {words[1]}."
            on = [k for k, v in effective_perms(target).items() if v]
            lim = account_limits(target)
            maps = "unlimited" if lim["mapsPerCampaign"] is None else str(lim["mapsPerCampaign"])
            books = f"up to {lim['bookBytes'] // MB} MB each on the server" if lim["bookBytes"] else "on their devices only"
            return (f"{target.get('email')}: {', '.join(on) or 'standard account'}\n  maps: {maps} per campaign, up to {lim['mapBytes'] // MB} MB each\n"
                    f"  books: {books}\n  email confirmed: {'yes' if target.get('emailVerified') else 'no'}")
        if cmd == "signout" and len(words) == 2:
            target = find(words[1])
            if not target:
                return f"No account with the email {words[1]}."
            gone = [k for k, sess in SESSIONS.items() if sess["accountId"] == target["id"]]
            for k in gone:
                del SESSIONS[k]
            target["devices"] = []   # and every device needs a code again
            mark_dirty()
            return f"Signed {target.get('email')} out of {len(gone)} session{'s' if len(gone) != 1 else ''}; every device will need a code."
        return f"I don't know '{text.strip()}'. Type help."

    def do_POST(self):
        if self.path.split("?")[0] == "/api/files/upload":
            return self._upload()   # a raw file body, not JSON
        if self.path.startswith("/api/"):
            return self._api_post()
        self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def _api_get(self):
        parts = self.path.split("?")[0].strip("/").split("/")  # ["api", ...]
        qs = parse_qs(urlparse(self.path).query)
        cid = qs.get("campaignId", [None])[0]

        if len(parts) >= 2 and parts[1] == "auth":
            return self._auth_get(parts)
        if len(parts) >= 2 and parts[1] == "files":
            return self._files_get(parts, qs)
        if len(parts) >= 2 and parts[1] == "admin":
            return self._admin_get(parts)

        # ---- Campaign selection (not scoped to any one campaign) ----
        if parts[1:] == ["campaigns"]:
            network_id = qs.get("networkId", [None])[0]
            with CAMPAIGNS_LOCK:
                acc = self._signed_in_for(network_id)
                if not acc:
                    return self._send_json({"error": "sign in required"}, 401)
                mine = set(acc["linkedIds"])
                out = [
                    campaign_summary(c, e, self._owns_campaign(acc, e))
                    for c, e in CAMPAIGNS.items()
                    if mine & set(e["meta"].get("memberIds") or [])
                ]
            out.sort(key=lambda c: c["createdAt"])
            return self._send_json({"campaigns": out})

        if len(parts) == 3 and parts[1] == "campaign":
            with CAMPAIGNS_LOCK:
                entry = self._campaign(parts[2])
                if not entry or not self._member_account(entry):
                    # One answer for "no such campaign" and "not yours", so
                    # campaign ids can't be probed for existence.
                    return self._send_json({"error": "not found"}, 404)
                out = campaign_summary(parts[2], entry, self._owns_campaign(account_from_token(self._bearer()), entry))
            return self._send_json(out)

        # ---- Everything below needs a real campaign (and a member) ----
        is_asset_listing = parts[1:] in (["backgrounds"], ["trainersprites"], ["icons"])
        with CAMPAIGNS_LOCK:
            entry = self._campaign(cid)
            acc = None
            if not is_asset_listing:
                if not entry:
                    return self._send_json({"error": "no such campaign"}, 404)
                acc = self._member_account(entry)
                if not acc:
                    return self._deny()
            state = entry["state"] if entry else None

            if parts[1:] == ["trainers"]:
                exclude = qs.get("exclude", [None])[0]
                self._prune_trainers(state)
                out = []
                for tid, t in state["trainers"].items():
                    if tid == exclude:
                        continue
                    # A device that's gone briefly quiet (phone locked, wifi
                    # blip, ...) gets pruned from this list after just 30s --
                    # fine for "online now", but the VS screen wants a
                    # portrait even for someone who stepped away, so fall
                    # back to the durable save mirror's sprite rather than
                    # showing nothing / the wrong thing for a sprite this
                    # trainer HAS set, just not freshly pinged.
                    sprite = t.get("sprite", "")
                    if not sprite:
                        saved = state["playerSaves"].get(tid, {}).get("current")
                        if saved:
                            sprite = saved.get("trainer", {}).get("sprite", "")
                    out.append({"id": tid, "name": t["name"], "partyCount": len(t["team"].get("party", [])), "sprite": sprite, "lastSeen": t["lastSeen"]})
                return self._send_json({"trainers": out})

            if parts[1:] == ["roster"]:
                # everyone in the campaign (for Send To and the DM's overview); parties, bags and money only for the DM
                is_dm = self._dm_ok(qs.get("token", [None])[0], cid)
                return self._send_json({"trainers": hub_roster(state, entry["meta"], is_dm, set(dm_member_ids(entry)) if is_dm else ())})

            if len(parts) == 3 and parts[1] == "trainer":
                t = state["trainers"].get(parts[2])
                if not t:
                    return self._send_json({"error": "not found"}, 404)
                return self._send_json({"name": t["name"], "team": t["team"], "sprite": t.get("sprite", "")})

            if parts[1:] == ["playersave"]:
                nid = qs.get("id", [None])[0]
                if not nid:
                    return self._send_json({"error": "missing id"}, 400)
                if nid not in acc["linkedIds"]:
                    return self._send_json({"error": "not your save"}, 403)
                out = state["playerSaves"].get(nid) or {"current": None, "named": {}}
                return self._send_json(out)

            if len(parts) == 3 and parts[1] == "inbox":
                if parts[2] not in acc["linkedIds"]:
                    return self._send_json({"error": "not your inbox"}, 403)
                return self._send_json({"messages": state["inbox"].get(parts[2], [])})

            if parts[1:] == ["fullturn"]:
                ft = dict(state["fullTurn"])
                ft.setdefault("background", "")
                ft.setdefault("spreadHitsAllies", False)
                ft.setdefault("phase", "draft")
                return self._send_json(ft)

            if len(parts) == 3 and parts[1] == "directives":
                if parts[2] not in acc["linkedIds"]:
                    return self._send_json({"error": "not yours"}, 403)
                return self._send_json({"directives": state["directives"].get(parts[2], [])})

            if parts[1:] == ["battlelog"]:
                return self._send_json({"entries": state["battleLog"][-200:]})

            if parts[1:] == ["music"]:
                return self._send_json({"slots": state["musicSlots"]})

            if parts[1:] == ["npcs"]:
                out = [{"id": nid, "name": n["name"], "partyCount": len(n["team"].get("party", [])), "sprite": n.get("sprite", "")} for nid, n in state["npcTrainers"].items()]
                return self._send_json({"npcs": out})

            if len(parts) == 3 and parts[1] == "npcs":
                n = state["npcTrainers"].get(parts[2])
                return self._send_json(n) if n else self._send_json({"error": "not found"}, 404)

            if parts[1:] == ["wild"]:
                out = [{"id": wid, "name": w.get("nickname") or w.get("name"), "level": w.get("level")} for wid, w in state["wildPokemon"].items()]
                return self._send_json({"wild": out})

            if len(parts) == 3 and parts[1] == "wild":
                w = state["wildPokemon"].get(parts[2])
                return self._send_json(w) if w else self._send_json({"error": "not found"}, 404)

            if parts[1:] == ["dm", "check"]:
                token = qs.get("token", [None])[0]
                return self._send_json({"ok": self._dm_ok(token, cid)})

            if parts[1:] == ["dm", "inbox"]:
                token = qs.get("token", [None])[0]
                if not self._dm_ok(token, cid):
                    return self._send_json({"error": "unauthorized"}, 403)
                return self._send_json({"entries": state["dmInbox"][-200:]})

            if parts[1:] == ["plans"]:
                # every player's planner notes and checklists: the DM only (the DM password token, scoped to this campaign)
                token = qs.get("token", [None])[0]
                if not self._dm_ok(token, cid):
                    return self._send_json({"error": "unauthorized"}, 403)
                members = set(entry["meta"].get("memberIds") or [])
                out = [{"id": pid, "name": p.get("name", ""), "updated": p.get("updated", 0), "plan": p.get("plan", {})}
                       for pid, p in state.get("plans", {}).items() if pid in members]
                return self._send_json({"plans": out})

            if parts[1:] == ["partymap"]:
                # the map the DM shares: members get only the pins the DM has revealed (decided here, never by the client);
                # the DM token gets everything so the DM's own view is complete
                pm = state.get("partyMap")
                if not pm:
                    return self._send_json({"map": None})
                viewer = qs.get("id", [None])[0]
                viewer = viewer if viewer in (acc.get("linkedIds") or []) else None
                return self._send_json({"map": map_view_for(pm, viewer, self._dm_ok(qs.get("token", [None])[0], cid), set(entry["meta"].get("memberIds") or []) | set(state["trainers"].keys()))})

            # ---- Shared static asset folders (not campaign-scoped) ----
            if parts[1:] == ["backgrounds"]:
                BACKGROUNDS_DIR.mkdir(parents=True, exist_ok=True)
                return self._send_json({"files": sorted(p.name for p in BACKGROUNDS_DIR.glob("*.png"))})

            if parts[1:] == ["trainersprites"]:
                TRAINER_SPRITES_DIR.mkdir(parents=True, exist_ok=True)
                return self._send_json({"files": sorted(p.name for p in TRAINER_SPRITES_DIR.glob("*.png"))})

            if parts[1:] == ["icons"]:
                out = {}
                if ICONS_DIR.exists():
                    for sub in sorted(p for p in ICONS_DIR.iterdir() if p.is_dir()):
                        files = sorted(f.name for f in sub.glob("*.png"))
                        if files:
                            out[sub.name] = files
                return self._send_json({"categories": out})

            if parts[1] == "sfx" and len(parts) in (2, 3):
                folder = SFX_DIR / cid  # cid is a known campaign id here (hex), so it can't escape SFX_DIR
                if len(parts) == 2:
                    files = sorted(p.name for p in folder.glob("*.mp3")) if folder.is_dir() else []
                    return self._send_json({"files": files})
                name = unquote(parts[2])
                path = folder / name
                if not SFX_NAME_RE.fullmatch(name) or not path.is_file():
                    return self._send_json({"error": "not found"}, 404)
                body = path.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "private, max-age=3600")
                self.end_headers()
                self.wfile.write(body)
                return

            return self._send_json({"error": "not found"}, 404)

    def _api_post(self):
        parts = self.path.split("?")[0].strip("/").split("/")
        data = self._read_json()
        if data is None:
            return self._send_json({"error": "request too large"}, 413)

        if len(parts) >= 2 and parts[1] == "auth":
            return self._auth_post(parts, data)
        if len(parts) >= 2 and parts[1] == "files":
            return self._files_post(parts, data)
        if len(parts) >= 2 and parts[1] == "admin":
            return self._admin_post(parts, data)

        # ---- Campaign management (not scoped to an existing campaign) ----
        if parts[1:] == ["campaigns"]:
            name, network_id = data.get("name"), data.get("networkId")
            if not network_id:
                return self._send_json({"error": "missing networkId"}, 400)
            with CAMPAIGNS_LOCK:
                if not self._signed_in_for(network_id):
                    return self._send_json({"error": "sign in required"}, 401)
                cid, entry = new_campaign_entry(name if isinstance(name, str) else "", network_id, data.get("system") or DEFAULT_SYSTEM, data.get("edition"))
                CAMPAIGNS[cid] = entry
                mark_dirty()
                out = campaign_summary(cid, entry, True)
            return self._send_json(out)

        if parts[1:] == ["campaigns", "join"]:
            code, network_id = (data.get("code") or "").strip().lower(), data.get("networkId")
            if not code or not network_id:
                return self._send_json({"error": "missing code/networkId"}, 400)
            jk = f"join:{self._client_key()}"
            if rate_blocked(jk, RATE_LIMIT_CLIENT):
                return self._send_json({"error": "too many attempts, try again in a few minutes"}, 429)
            with CAMPAIGNS_LOCK:
                acc = self._signed_in_for(network_id)
                if not acc:
                    return self._send_json({"error": "sign in required"}, 401)
                found = next(((c, e) for c, e in CAMPAIGNS.items() if secrets.compare_digest(e["meta"]["inviteCode"].encode("utf-8"), code.encode("utf-8"))), None)
                if not found:
                    rate_fail(jk)
                    return self._send_json({"error": "no campaign with that invite code"}, 404)
                cid, entry = found
                members = entry["meta"].setdefault("memberIds", [])
                if network_id not in members:
                    members.append(network_id)
                    mark_dirty()
                out = campaign_summary(cid, entry, self._owns_campaign(acc, entry))
            return self._send_json(out)

        if len(parts) == 4 and parts[1] == "campaigns":
            cid, action = parts[2], parts[3]
            with CAMPAIGNS_LOCK:
                entry = self._campaign(cid)
                acc = self._member_account(entry) if entry else None
                if not acc:
                    # Same answer whether the campaign is missing or merely not yours.
                    return self._send_json({"error": "no such campaign"}, 404)
                # Owner-only actions are decided by the signed-in session. The
                # owner's id is visible to every member (the online list), so a
                # claimed id proves nothing.
                is_owner = self._owns_campaign(acc, entry)

                if action == "rename":
                    if not is_owner:
                        return self._send_json({"error": "owner only"}, 403)
                    name = data.get("name")
                    entry["meta"]["name"] = (name.strip()[:MAX_NAME] if isinstance(name, str) else "") or entry["meta"]["name"]
                    mark_dirty()
                    return self._send_json(campaign_summary(cid, entry, True))

                if action == "set-edition":
                    if not is_owner:
                        return self._send_json({"error": "owner only"}, 403)
                    edition = data.get("edition")
                    if edition not in KNOWN_EDITIONS:
                        return self._send_json({"error": "edition must be 2014 or 2024"}, 400)
                    entry["meta"]["edition"] = edition
                    mark_dirty()
                    return self._send_json(campaign_summary(cid, entry, True))

                if action == "regenerate-code":
                    if not is_owner:
                        return self._send_json({"error": "owner only"}, 403)
                    entry["meta"]["inviteCode"] = new_code()
                    mark_dirty()
                    return self._send_json(campaign_summary(cid, entry, True))

                if action == "set-dm":
                    # the owner makes a member a DM, or stops them being one (their DM tools close straight away)
                    if not is_owner:
                        return self._send_json({"error": "owner only"}, 403)
                    target = data.get("memberId")
                    if target not in (entry["meta"].get("memberIds") or []):
                        return self._send_json({"error": "not a member"}, 404)
                    target_acc = account_owning_network_id(target)
                    if not target_acc:
                        return self._send_json({"error": "that member hasn't made an account yet"}, 409)
                    if entry["meta"].get("ownerId") in (target_acc.get("linkedIds") or []):
                        return self._send_json({"error": "the owner is always a DM"}, 400)
                    dms = entry["meta"].setdefault("dmAccounts", [])
                    if data.get("dm") is True:
                        if target_acc["id"] not in dms:
                            dms.append(target_acc["id"])
                    else:
                        entry["meta"]["dmAccounts"] = [a for a in dms if a != target_acc["id"]]
                        for tok in [t for t, rec in DM_TOKENS.items() if rec.get("cid") == cid and rec.get("acc") == target_acc["id"]]:
                            del DM_TOKENS[tok]
                    mark_dirty()
                    return self._send_json(campaign_summary(cid, entry, True))

                if action == "remove-member":
                    if not is_owner:
                        return self._send_json({"error": "owner only"}, 403)
                    target = data.get("memberId")
                    if target == entry["meta"]["ownerId"]:
                        return self._send_json({"error": "can't remove the owner"}, 400)
                    entry["meta"]["memberIds"] = [m for m in entry["meta"].get("memberIds") or [] if m != target]
                    entry["state"].get("plans", {}).pop(target, None)
                    mark_dirty()
                    return self._send_json(campaign_summary(cid, entry, True))

                if action == "transfer-owner":
                    # Hands ownership to another existing member -- e.g. the
                    # migration path guesses an owner from whichever trainer
                    # id happened to be in an old pre-campaign save, which
                    # won't necessarily be the person actually running the
                    # table on a new device/origin. The old owner becomes a
                    # regular member rather than being dropped.
                    if not is_owner:
                        return self._send_json({"error": "owner only"}, 403)
                    new_owner = data.get("newOwnerId")
                    members = entry["meta"].setdefault("memberIds", [])
                    if not new_owner or new_owner not in members:
                        return self._send_json({"error": "target must already be a member"}, 400)
                    entry["meta"]["ownerId"] = new_owner
                    mark_dirty()
                    # The caller may have just handed away ownership; answer for them as they now are.
                    return self._send_json(campaign_summary(cid, entry, self._owns_campaign(acc, entry)))

                if action == "delete":
                    if not is_owner:
                        return self._send_json({"error": "owner only"}, 403)
                    del CAMPAIGNS[cid]
                    mark_dirty()
                    return self._send_json({"ok": True})

            return self._send_json({"error": "unknown campaign action"}, 400)

        # ---- Everything below acts on one campaign's game state ----
        cid = data.get("campaignId")
        with CAMPAIGNS_LOCK:
            entry = self._campaign(cid)
            if not entry:
                return self._send_json({"error": "no such campaign"}, 404)
            acc = self._member_account(entry)
            if not acc:
                return self._deny()
            state = entry["state"]
            mine = acc["linkedIds"]  # ids this account may act as

            if parts[1:] == ["trainer"]:
                tid, team = data.get("id"), data.get("team")
                name, sprite = data.get("name"), data.get("sprite")
                if not tid:
                    return self._send_json({"error": "missing id"}, 400)
                if tid not in mine:
                    return self._send_json({"error": "not your identity"}, 403)
                name = name.strip()[:MAX_NAME] if isinstance(name, str) and name.strip() else "Trainer"
                sprite = sprite[:100] if isinstance(sprite, str) else ""
                state["trainers"][tid] = {"name": name, "team": team if isinstance(team, dict) else {}, "sprite": sprite, "lastSeen": time.time()}
                mark_dirty()
                return self._send_json({"ok": True})

            if parts[1:] == ["playersave"]:
                nid, save = data.get("id"), data.get("save")
                if not nid or not isinstance(save, dict):
                    return self._send_json({"error": "missing id/save"}, 400)
                if nid not in mine:
                    return self._send_json({"error": "not your save"}, 403)
                state["playerSaves"].setdefault(nid, {"current": None, "named": {}})["current"] = save
                mark_dirty()
                return self._send_json({"ok": True})

            if parts[1:] == ["plan"]:
                nid, plan, name = data.get("id"), data.get("plan"), data.get("name")
                if not nid or not isinstance(plan, dict):
                    return self._send_json({"error": "missing id/plan"}, 400)
                if nid not in mine or nid not in (entry["meta"].get("memberIds") or []):
                    return self._send_json({"error": "not your identity"}, 403)
                if len(json.dumps(plan)) > MAX_PLAN:
                    return self._send_json({"error": "plan too large"}, 413)
                name = name.strip()[:MAX_NAME] if isinstance(name, str) and name.strip() else "Player"
                state.setdefault("plans", {})[nid] = {"name": name, "updated": time.time(), "plan": plan}
                mark_dirty()
                return self._send_json({"ok": True})

            if parts[1:] == ["partymap", "move"]:
                # a player moves their own token on the shared map (the DM's token moves anyone's); the mist clears there
                pm = state.get("partyMap")
                if not pm:
                    return self._send_json({"error": "no shared map"}, 404)
                is_dm = self._dm_ok(data.get("token"), cid)
                nid, tid = data.get("id"), data.get("tokenId") or data.get("id")
                if not is_dm and (nid not in mine or tid != nid):
                    return self._send_json({"error": "you can only move yourself"}, 403)
                x, y = _unit(data.get("x")), _unit(data.get("y"))
                tokens = pm.setdefault("tokens", [])
                tok = next((t for t in tokens if t["id"] == tid), None)
                if not tok:
                    if not is_dm and len(tokens) >= 40:
                        return self._send_json({"error": "the map is full"}, 409)
                    saved = ((state["playerSaves"].get(tid) or {}).get("current") or {}).get("trainer") or {}
                    name = (state["trainers"].get(tid) or {}).get("name") or saved.get("name") or "Player"
                    tok = {"id": tid, "name": _text(name, 40) or "Player", "x": x, "y": y, "color": _colour(data.get("color"), "#5aa8f0")}
                    tokens.append(tok)
                tok["x"], tok["y"] = x, y
                if map_fog(pm)["enabled"] and tid in (entry["meta"].get("memberIds") or []) + list(state["trainers"].keys()):
                    map_reveal(pm, tid, x, y)
                pm["updated"] = time.time()
                mark_dirty()
                return self._send_json({"ok": True})

            if parts[1:] == ["partymap", "fog"]:
                # DM only: fog settings, brushing the mist away, or covering the map again
                if not self._require_dm(data, cid):
                    return self._send_json({"error": "DM only"}, 403)
                pm = state.get("partyMap")
                if not pm:
                    return self._send_json({"error": "no shared map"}, 404)
                pm["fog"] = clean_fog(data.get("fog"), map_fog(pm))
                op = data.get("op")
                if op == "reveal":
                    for pt in (data.get("pts") if isinstance(data.get("pts"), list) else [])[:400]:
                        if isinstance(pt, list) and len(pt) == 2:
                            map_reveal(pm, "dm", _unit(pt[0]), _unit(pt[1]), spacing=0.25)
                elif op == "reset":
                    pm["reveals"] = {}
                    for t in pm.get("tokens", []):   # players can still see where they're standing
                        if t["id"] in (entry["meta"].get("memberIds") or []):
                            map_reveal(pm, t["id"], t["x"], t["y"])
                pm["updated"] = time.time()
                mark_dirty()
                return self._send_json({"ok": True, "fog": pm["fog"]})

            if parts[1:] in (["partymap"], ["partymap", "live"], ["partymap", "clear"]):
                # DM only (the DM password token for this campaign). "live" updates just the pins and tokens, which is
                # what a drag or a reveal sends; the image only travels when the map is published.
                if not self._require_dm(data, cid):
                    return self._send_json({"error": "DM only"}, 403)
                if parts[-1] == "clear":
                    state["partyMap"] = None
                    mark_dirty()
                    return self._send_json({"ok": True})
                if parts[-1] == "live":
                    pm = state.get("partyMap")
                    if not pm:
                        return self._send_json({"error": "no shared map"}, 404)
                    if "pins" in data:
                        pm["pins"] = clean_map_pins(data.get("pins"))
                    if "areas" in data:
                        pm["areas"] = clean_map_areas(data.get("areas"))
                    members = set(entry["meta"].get("memberIds") or [])
                    before = {t["id"] for t in pm.get("tokens", [])}
                    if "tokens" in data:
                        pm["tokens"] = merge_map_tokens(pm.get("tokens", []), clean_map_tokens(data.get("tokens")), members)
                    if map_fog(pm)["enabled"]:   # someone newly placed sees where they are
                        for t in pm["tokens"]:
                            if t["id"] not in before and t["id"] in members:
                                map_reveal(pm, t["id"], t["x"], t["y"])
                    pm["updated"] = time.time()
                    mark_dirty()
                    return self._send_json({"ok": True})
                raw = data.get("map")
                if not isinstance(raw, dict):
                    return self._send_json({"error": "missing map"}, 400)
                # Normally the image is a map file this account uploaded to this campaign (served once, then
                # cached); an inline data: URL still works for older clients.
                file_id, image = raw.get("fileId"), raw.get("image")
                if file_id is not None:
                    rec = FILES.get(file_id) if isinstance(file_id, str) else None
                    if not rec or rec.get("deleted") or rec["kind"] != "map" or rec.get("campaignId") != cid or rec["owner"] != acc["id"]:
                        return self._send_json({"error": "upload the map first"}, 400)
                    image = None
                elif not isinstance(image, str) or not re.match(r"^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$", image):
                    return self._send_json({"error": "the map image must be a PNG, JPEG, WebP or GIF"}, 400)
                elif len(image) > MAX_PARTYMAP:
                    return self._send_json({"error": "map image too large"}, 413)
                def dim(v):
                    try:
                        return max(1, min(20000, int(v)))
                    except (TypeError, ValueError):
                        return 1
                name = raw.get("name")
                old = state.get("partyMap") or {}
                same = file_id is not None and old.get("fileId") == file_id   # republishing the same map keeps the fog and where people are
                members = set(entry["meta"].get("memberIds") or [])
                state["partyMap"] = {
                    "name": name.strip()[:80] if isinstance(name, str) and name.strip() else "Map",
                    **({"fileId": file_id} if file_id is not None else {"image": image}), "w": dim(raw.get("w")), "h": dim(raw.get("h")),
                    "pins": clean_map_pins(raw.get("pins")),
                    # the DM's areas: sent with the map, or kept from before when the same map is published again
                    "areas": clean_map_areas(raw.get("areas")) if "areas" in raw else (old.get("areas", []) if same else []),
                    "tokens": merge_map_tokens(old.get("tokens", []) if same else [], clean_map_tokens(raw.get("tokens")), members),
                    # a new map goes up hidden in fog, so nobody glimpses it before the DM is ready; the same map keeps its fog
                    "fog": clean_fog(raw.get("fog"), map_fog(old) if same else {**FOG_DEFAULT, "enabled": True}),
                    "reveals": old.get("reveals", {}) if same else {},
                    "updated": time.time(),
                }
                mark_dirty()
                return self._send_json({"ok": True})

            if parts[1:] == ["hub", "sync"]:
                # Called a few times a second while the hub is open: reports where this player's
                # cursor is, and answers with everyone else's, plus the board if it changed.
                nid = data.get("id")
                if nid not in mine:
                    return self._send_json({"error": "not your identity"}, 403)
                now = time.time()
                cursors = HUB_CURSORS.setdefault(cid, {})
                cur = data.get("cursor")
                if isinstance(cur, dict):
                    cursors[nid] = {"name": _text(cur.get("name"), MAX_NAME) or "Player", "color": _colour(cur.get("color"), "#5aa8f0"),
                                    "x": _num(cur.get("x")), "y": _num(cur.get("y")), "t": now, "down": cur.get("down") is True,
                                    "draft": clean_draft(cur.get("draft"))}
                else:
                    cursors.pop(nid, None)
                for k in [k for k, c in cursors.items() if now - c["t"] > HUB_CURSOR_TTL]:
                    del cursors[k]
                pings = [pg for pg in HUB_PINGS.get(cid, []) if now - pg["t"] < HUB_PING_TTL]
                ping = data.get("ping")
                if isinstance(ping, dict) and sum(1 for pg in pings if pg["by"] == nid) < 3:
                    who = cursors.get(nid) or {}
                    pings.append({"id": secrets.token_hex(5), "by": nid, "x": _num(ping.get("x")), "y": _num(ping.get("y")),
                                  "item": _text(ping.get("item"), 40),   # ripples round that thing on the board instead of a spot
                                  "color": who.get("color", "#5aa8f0"), "name": who.get("name", "Player"), "t": now})
                HUB_PINGS[cid] = pings
                hub = state["hub"]
                sees_dm_notes = self._dm_ok(data.get("token"), cid)
                out = {"rev": hub["rev"], "isDm": has_dm_access(entry, acc), "activeButton": hub.get("activeButton"), "backdrop": hub.get("backdrop"),
                       "cursors": [{"id": k, **{f: c.get(f) for f in ("name", "color", "x", "y", "down", "draft")}} for k, c in cursors.items() if k != nid],
                       "pings": [{f: pg.get(f) for f in ("id", "by", "x", "y", "item", "color", "name")} for pg in pings]}
                if data.get("since") != hub["rev"]:
                    out["items"] = [{**it, "preview": hub_button_preview(state, it)} if it["type"] == "button" else it
                                    for it in hub["items"] if sees_dm_notes or not it.get("dmOnly")]
                return self._send_json(out)

            if parts[1:] == ["hub", "op"]:
                nid = data.get("id")
                if nid not in mine:
                    return self._send_json({"error": "not your identity"}, 403)
                is_dm = self._require_dm(data, cid)
                hub = state["hub"]
                op = data.get("op")
                if op == "put":
                    item = clean_hub_item(data.get("item"), nid, is_dm)
                    if not item:
                        return self._send_json({"error": "bad item"}, 400)
                    # who wrote it, from the server's own list (shown on notes; never taken from the client)
                    item["byName"] = (state["trainers"].get(nid) or {}).get("name") or ""
                    existing = next((i for i, it in enumerate(hub["items"]) if it["id"] == item["id"]), None)
                    if existing is not None:
                        old = hub["items"][existing]
                        if old["owner"] not in mine and not is_dm:
                            return self._send_json({"error": "not yours"}, 403)
                        if old["type"] == "button" and not is_dm:
                            return self._send_json({"error": "DM only"}, 403)
                        item["owner"], item["byName"] = old["owner"], old.get("byName", "")
                        hub["items"][existing] = item
                    else:
                        if item.get("link"):
                            # one card per thing: a player's trainer, or one of their Pokémon, is only on the board once
                            hub["items"] = [it for it in hub["items"] if not (it.get("link") == item["link"] and it["owner"] == item["owner"])]
                        if len(hub["items"]) >= HUB_MAX_ITEMS:
                            return self._send_json({"error": "the hub is full; clear some drawings first"}, 409)
                        hub["items"].append(item)
                elif op == "delete":
                    item_id = data.get("itemId")
                    old = next((it for it in hub["items"] if it["id"] == item_id), None)
                    if not old:
                        return self._send_json({"ok": True, "rev": hub["rev"]})
                    if not is_dm and (old["owner"] not in mine or old["type"] == "button"):
                        return self._send_json({"error": "not yours"}, 403)
                    hub["items"] = [it for it in hub["items"] if it["id"] != item_id]
                    if hub.get("activeButton") == item_id:
                        hub["activeButton"] = None
                elif op == "clearDrawings":
                    # Anyone can wipe their own drawings; the DM wipes everyone's.
                    hub["items"] = [it for it in hub["items"] if it["type"] != "stroke" or (not is_dm and it["owner"] not in mine)]
                elif op == "backdrop":
                    # DM only: a map (one of the DM's uploads in this campaign) shown blurred behind the board, or none
                    if not is_dm:
                        return self._send_json({"error": "DM only"}, 403)
                    file_id = data.get("fileId")
                    if file_id is None:
                        hub["backdrop"] = None
                    else:
                        rec = FILES.get(file_id) if isinstance(file_id, str) else None
                        if not rec or rec.get("deleted") or rec["kind"] != "map" or rec.get("campaignId") != cid or rec["owner"] != acc["id"]:
                            return self._send_json({"error": "upload the map first"}, 400)
                        hub["backdrop"] = {"fileId": file_id, "blur": int(_num(data.get("blur"), 0, 40)), "dim": round(_num(data.get("dim"), 0, 90))}
                elif op == "activate":
                    if not is_dm:
                        return self._send_json({"error": "DM only"}, 403)
                    target = data.get("itemId")
                    hub["activeButton"] = target if any(it["id"] == target and it["type"] == "button" for it in hub["items"]) else None
                else:
                    return self._send_json({"error": "unknown op"}, 400)
                hub["rev"] += 1
                mark_dirty()
                return self._send_json({"ok": True, "rev": hub["rev"]})

            if parts[1:] == ["playersave", "named"]:
                nid, name, save = data.get("id"), data.get("name"), data.get("save")
                if not nid or not isinstance(name, str) or not name or not isinstance(save, dict):
                    return self._send_json({"error": "missing id/name/save"}, 400)
                if nid not in mine:
                    return self._send_json({"error": "not your save"}, 403)
                entry_ = state["playerSaves"].setdefault(nid, {"current": None, "named": {}})
                entry_["named"][name[:100]] = save
                mark_dirty()
                return self._send_json({"ok": True})

            if parts[1:] == ["playersave", "named", "delete"]:
                nid, name = data.get("id"), data.get("name")
                if not nid or not isinstance(name, str) or not name:
                    return self._send_json({"error": "missing id/name"}, 400)
                if nid not in mine:
                    return self._send_json({"error": "not your save"}, 403)
                entry_ = state["playerSaves"].get(nid)
                if entry_:
                    entry_["named"].pop(name[:100], None)
                    mark_dirty()
                return self._send_json({"ok": True})

            if parts[1:] == ["send"]:
                to_id, from_id, kind, payload = data.get("toId"), data.get("fromId"), data.get("type") or "note", data.get("payload")
                if not isinstance(to_id, str) or not to_id:
                    return self._send_json({"error": "missing toId"}, 400)
                if from_id not in mine:
                    return self._send_json({"error": "not your identity"}, 403)
                if to_id not in (entry["meta"].get("memberIds") or []):
                    return self._send_json({"error": "recipient isn't in this campaign"}, 404)
                if kind not in ("note", "pokemon", "cash", "item") or not isinstance(payload, dict) or len(json.dumps(payload)) > 100_000:
                    return self._send_json({"error": "bad message"}, 400)
                if kind == "note":
                    payload = {"text": str(payload.get("text") or "")[:MAX_TEXT]}
                elif kind == "item":
                    payload = {"name": _text(payload.get("name"), 60), "count": int(_num(payload.get("count"), 1, 9999) or 1)}
                    if not payload["name"]:
                        return self._send_json({"error": "bad message"}, 400)
                elif kind == "cash":
                    payload = {"amount": int(_num(payload.get("amount"), 0, 10_000_000))}
                from_name = data.get("fromName")
                msg = {
                    "id": secrets.token_hex(8),
                    "from": from_id, "fromName": from_name.strip()[:MAX_NAME] if isinstance(from_name, str) and from_name.strip() else "A trainer",
                    "type": kind, "payload": payload, "ts": time.time(),
                }
                state["inbox"][to_id] = (state["inbox"].get(to_id, []) + [msg])[-MAX_INBOX:]
                mark_dirty()
                return self._send_json({"ok": True})

            if len(parts) == 4 and parts[1] in ("inbox", "directives") and parts[3] == "ack":
                tid, table = parts[2], state[parts[1]]
                if tid not in mine:
                    return self._send_json({"error": "not yours"}, 403)
                raw_ids = data.get("ids")
                ack_ids = {i for i in raw_ids if isinstance(i, str)} if isinstance(raw_ids, list) else set()
                table[tid] = [m for m in table.get(tid, []) if m["id"] not in ack_ids]
                mark_dirty()
                return self._send_json({"ok": True})

            if parts[1:] == ["egg", "hatch"]:
                # only the player the egg was given to can hatch it, and only then do they find out what it was
                nid, egg_id = data.get("id"), data.get("eggId")
                if nid not in mine:
                    return self._send_json({"error": "not your identity"}, 403)
                egg = state.setdefault("eggs", {}).get(egg_id) if isinstance(egg_id, str) else None
                if not egg or egg["to"] != nid:
                    return self._send_json({"error": "no such egg"}, 404)
                if egg["hatched"]:
                    return self._send_json({"error": "it has already hatched", "species": egg["species"]}, 409)
                egg["hatched"] = True
                egg["hatchedAt"] = time.time()
                mark_dirty()
                return self._send_json({"ok": True, "species": egg["species"]})

            if parts[1:] == ["fullturn", "playeraction"]:
                if data.get("networkId") not in mine and not self._dm_ok(data.get("token"), cid):
                    return self._send_json({"error": "not your identity"}, 403)
                result = self._handle_player_action(state, data)
                mark_dirty()
                return self._send_json(result)

            if parts[1:] == ["fullturn", "playermove"]:
                # A player may only move as themselves; the DM's token also
                # allows moving on a player's behalf (the Control Centre mirrors
                # a trainer's screen for an away player).
                if data.get("networkId") not in mine and not self._dm_ok(data.get("token"), cid):
                    return self._send_json({"error": "not your identity"}, 403)
                result = self._handle_player_move(state, data)
                mark_dirty()
                return self._send_json(result)

            if parts[1:] == ["battlelog"]:
                # Open to any campaign member, not just the DM -- it's the
                # table's shared log.
                text, from_name = data.get("text"), data.get("fromName")
                text = text.strip()[:MAX_TEXT] if isinstance(text, str) else ""
                if not text:
                    return self._send_json({"error": "empty"}, 400)
                log_battle(state, from_name.strip()[:MAX_NAME] if isinstance(from_name, str) and from_name.strip() else "Someone", text)
                mark_dirty()
                return self._send_json({"ok": True})

            if parts[1:] == ["dmnote"]:
                text, from_name = data.get("text"), data.get("fromName")
                text = text.strip()[:MAX_TEXT] if isinstance(text, str) else ""
                if not text:
                    return self._send_json({"error": "empty"}, 400)
                state["dmInbox"].append({"id": secrets.token_hex(8), "fromName": from_name.strip()[:MAX_NAME] if isinstance(from_name, str) and from_name.strip() else "A trainer", "text": text, "ts": time.time()})
                state["dmInbox"] = state["dmInbox"][-300:]
                mark_dirty()
                return self._send_json({"ok": True})

            # ---- DM Control Centre ----

            if parts[1:] == ["dm", "login"]:
                ck, cck = f"dm:{self._client_key()}", f"dmc:{cid}"
                if rate_blocked(ck, RATE_LIMIT_CLIENT) or rate_blocked(cck, RATE_LIMIT_CAMPAIGN):
                    return self._send_json({"ok": False, "error": "too many attempts, try again in a few minutes"}, 429)
                if has_dm_access(entry, acc):
                    token = secrets.token_hex(24)
                    DM_TOKENS[token] = {"cid": cid, "exp": time.time() + DM_TOKEN_TTL, "acc": acc["id"]}
                    return self._send_json({"ok": True, "token": token})
                return self._send_json({"ok": False, "error": "You don't have DM access in this campaign. The owner can give it in Settings, Members."}, 403)

            if parts[1:] == ["dm", "action"]:
                if not self._require_dm(data, cid):
                    return self._send_json({"error": "unauthorized"}, 403)
                result = self._handle_dm_action(state, data.get("action"), data.get("targetId"), data)
                mark_dirty()
                if result is None:
                    return self._send_json({"error": "unknown action"}, 400)
                return self._send_json(result)

        return self._send_json({"error": "not found"}, 404)

    def _handle_dm_action(self, state, action, target_id, data):
        """Runs under CAMPAIGNS_LOCK. Returns a dict to send back, or None
        for an unknown action."""
        target_kind = data.get("targetKind") or "online"

        if action == "setHp":
            apply_hp(state, target_kind, target_id, data.get("monId"), data.get("delta"), data.get("absolute"))
            if data.get("inBattle"):
                log_battle(state, "Dungeon Master", data.get("logText") or f"{(data.get('trainerName') or 'A trainer')}'s {(data.get('monName') or 'Pokémon')} HP changed.")
            return {"ok": True}

        if action == "setStatus":
            apply_status(state, target_kind, target_id, data.get("monId"), data.get("status"))
            if data.get("inBattle"):
                log_battle(state, "Dungeon Master", data.get("logText") or f"{(data.get('trainerName') or 'A trainer')}'s {(data.get('monName') or 'Pokémon')} is now {data.get('status') or 'healthy'}.")
            return {"ok": True}

        if action == "forceMove":
            # Damage is computed on the DM's own client (reusing the same
            # calc.js formula as everywhere else); this just delivers the
            # result and logs it.
            apply_hp(state, target_kind, target_id, data.get("monId"), -abs(data.get("damage") or 0), None)
            log_battle(state, "Dungeon Master", data.get("logText") or f"{data.get('attackerName', '?')} used {data.get('moveName', 'a move')} on {data.get('defenderName', '?')} for {data.get('damage', 0)} damage!")
            return {"ok": True}

        if action == "personalNote":
            queue_directive(state, target_id, "note", {"text": data.get("text") or ""})
            return {"ok": True}

        # ---- DM "Give" tools: level a trainer's own Pokemon up, or hand
        # them a Bag item. Auto-applied client-side on next directive poll
        # (like setHp/setStatus above), not a manual-Accept gift the way
        # Trainers Online's "Send" is -- this is the DM handing something
        # out mid-session, it should just land.
        if action == "giveLevel":
            mon_id = data.get("monId")
            level = data.get("level")
            if not mon_id or not isinstance(level, int):
                return {"error": "bad request"}
            level = max(1, min(100, level))
            queue_directive(state, target_id, "setLevel", {"monId": mon_id, "level": level})
            log_battle(state, "Dungeon Master", data.get("logText") or f"{(data.get('trainerName') or 'A trainer')}'s {(data.get('monName') or 'Pokémon')} was granted levels by the DM — now Level {level}.")
            return {"ok": True}

        if action == "giveEgg":
            species = _text(data.get("species"), 40)
            if not species or not isinstance(target_id, str) or not target_id:
                return {"error": "pick a trainer and a Pokémon"}
            egg_id = secrets.token_hex(6)
            state.setdefault("eggs", {})[egg_id] = {"id": egg_id, "to": target_id, "species": species, "given": time.time(), "hatched": False,
                                                    "trainerName": _text(data.get("trainerName"), MAX_NAME)}
            queue_directive(state, target_id, "giveEgg", {"eggId": egg_id})   # the player gets the egg, never what's in it
            return {"ok": True, "eggId": egg_id}

        if action == "listEggs":
            return {"ok": True, "eggs": sorted(state.get("eggs", {}).values(), key=lambda e: -e["given"])}

        if action == "giveItem":
            name = (data.get("name") or "").strip()
            qty = data.get("qty")
            if not name or not isinstance(qty, int) or qty < 1:
                return {"error": "bad request"}
            queue_directive(state, target_id, "giveItem", {"name": name, "qty": qty})
            log_battle(state, "Dungeon Master", f"{(data.get('trainerName') or 'A trainer')} received {qty}× {name} from the DM.")
            return {"ok": True}

        if action == "battleLogEntry":
            log_battle(state, "Dungeon Master", data.get("text") or "")
            return {"ok": True}

        if action == "battleLogClear":
            state["battleLog"] = []
            return {"ok": True}

        if action == "musicSlot":
            idx = data.get("index")
            if isinstance(idx, int) and 0 <= idx < len(state["musicSlots"]):
                state["musicSlots"][idx] = {"label": data.get("label") or state["musicSlots"][idx]["label"], "url": data.get("url") or ""}
                return {"ok": True}
            return {"error": "bad index"}

        if action == "dmInboxClear":
            ack_ids = set(data.get("ids") or [])
            state["dmInbox"] = [m for m in state["dmInbox"] if m["id"] not in ack_ids]
            return {"ok": True}

        # ---- NPC Trainer library ----
        if action == "npcSave":
            npc_id = data.get("npcId") or hashlib.sha256(f"npc-{time.time()}-{id(data)}".encode()).hexdigest()[:16]
            existing = state["npcTrainers"].get(npc_id, {"team": {"party": []}, "sprite": ""})
            state["npcTrainers"][npc_id] = {
                "name": data.get("name") or existing.get("name") or "NPC",
                "team": data.get("team") if data.get("team") is not None else existing["team"],
                "sprite": data.get("sprite", existing.get("sprite", "")),
            }
            return {"ok": True, "npcId": npc_id}

        if action == "npcDelete":
            state["npcTrainers"].pop(data.get("npcId"), None)
            return {"ok": True}

        # ---- Wild Pokémon library ----
        if action == "wildSave":
            wild_id = data.get("wildId") or hashlib.sha256(f"wild-{time.time()}-{id(data)}".encode()).hexdigest()[:16]
            mon = data.get("mon") or {}
            mon["id"] = mon.get("id") or wild_id
            state["wildPokemon"][wild_id] = mon
            return {"ok": True, "wildId": wild_id}

        if action == "wildDelete":
            state["wildPokemon"].pop(data.get("wildId"), None)
            return {"ok": True}

        # ---- Full Turn console roster (whole-blob save, like Music Board) ----
        if action == "fullTurnSave":
            existing = state.get("fullTurn") or {}
            current_index, round_no = data.get("currentIndex") or 0, data.get("round") or 1
            turn_id = data.get("turnId") if isinstance(data.get("turnId"), str) else None
            same_turn = (current_index, round_no, turn_id) == (existing.get("currentIndex"), existing.get("round"), existing.get("turnId"))
            # a switch hands the turn to the Pokémon that came in: it's still the same turn, and the choice stands
            if not same_turn and turn_id and round_no == existing.get("round") and existing.get("turnId"):
                same_turn = any(isinstance(c, dict) and c.get("id") == turn_id and c.get("cameInFor") == existing.get("turnId") for c in data.get("combatants") or [])
            state["fullTurn"] = {
                "combatants": data.get("combatants") or [],
                "currentIndex": current_index,
                "round": round_no,
                "turnId": turn_id,   # the combatant whose turn it is (the DM's console decides the order)
                "acted": existing.get("acted") if same_turn else None,   # a new turn clears the last choice
                "background": data.get("background", existing.get("background", "")),
                "spreadHitsAllies": data.get("spreadHitsAllies", existing.get("spreadHitsAllies", False)),
                "phase": data.get("phase", existing.get("phase", "draft")),
            }
            return {"ok": True}

        return None

    def _handle_player_move(self, state, data):
        """Runs under CAMPAIGNS_LOCK. A trainer resolving their own move on
        their own turn -- no DM token needed, but scoped tightly: the
        caller must already be a player/team combatant in the current
        roster, and the combatant list they submit back must have the
        exact same members (same ids) as what's already there. That lets
        this change HP/status on existing combatants (the move's damage),
        but never add, remove, or otherwise restructure the roster the way a
        DM action can, and never move the turn on: the move is recorded as
        this turn's choice and the DM starts the next turn -- the damage number itself is
        still computed on the trainer's own client (js/battleMath.js),
        same trust model the DM's own forceMove action already uses.
        """
        ft = state.get("fullTurn") or {}
        if ft.get("phase") != "live":
            return {"error": "not live"}
        network_id = data.get("networkId")
        existing = ft.get("combatants") or []
        mover = next((c for c in existing if c.get("sourceKind") in ("player", "team") and c.get("sourceId") == network_id), None)
        if not mover:
            return {"error": "not a combatant"}

        mover = self._player_on_turn(ft, network_id)
        if isinstance(mover, dict) and mover.get("error"):
            return mover

        submitted = data.get("combatants")
        if not isinstance(submitted, list) or {c.get("id") for c in submitted} != {c.get("id") for c in existing}:
            return {"error": "roster mismatch"}

        before_by_id = {c["id"]: c for c in existing}
        for c in submitted:
            prev = before_by_id.get(c.get("id"))
            if not prev:
                continue
            mon, prev_mon = c.get("mon") or {}, prev.get("mon") or {}
            # Identity and allegiance of a combatant can't be rewritten from here.
            for k in ("sourceKind", "sourceId", "side"):
                if c.get(k) != prev.get(k):
                    return {"error": "roster mismatch"}
            if bool(c.get("benched")) != bool(prev.get("benched")):
                return {"error": "roster mismatch"}
            if mon.get("id") != prev_mon.get("id"):
                return {"error": "roster mismatch"}
            new_hp, old_hp = mon.get("currentHp"), prev_mon.get("currentHp")
            if new_hp != old_hp:
                if isinstance(new_hp, bool) or not isinstance(new_hp, int) or new_hp < 0:
                    return {"error": "bad hp"}
                # A move can only hurt the other side; HP can only go up on your own side.
                if prev.get("side") != mover.get("side") and isinstance(old_hp, int) and new_hp > old_hp:
                    return {"error": "bad hp"}
            kind, tid, mon_id = c.get("sourceKind"), c.get("sourceId"), mon.get("id")
            if mon.get("currentHp") != prev_mon.get("currentHp"):
                apply_hp(state, kind, tid, mon_id, None, mon.get("currentHp"))
            if mon.get("status") != prev_mon.get("status"):
                apply_status(state, kind, tid, mon_id, mon.get("status"))

        lines = [_text(x, MAX_TEXT) for x in (data.get("logTexts") or []) if isinstance(x, str)][:6]
        state["fullTurn"] = {
            **ft,
            "combatants": submitted,
            "phase": "live",
            "acted": {"combatantId": mover.get("id"), "kind": "move", "text": lines[0] if lines else "Used a move", "at": time.time()},
        }
        for line in lines:
            log_battle(state, mover.get("sourceLabel") or "A trainer", line)
        return {"ok": True}

    def _player_on_turn(self, ft, network_id):
        """Caller holds CAMPAIGNS_LOCK. The player's own combatant if it's their turn and they haven't chosen yet,
        else {"error": ...}."""
        if ft.get("phase") != "live":
            return {"error": "not live"}
        existing = ft.get("combatants") or []
        if ft.get("turnId"):
            on_turn = next((c for c in existing if c.get("id") == ft["turnId"]), None)
        else:
            idx = ft.get("currentIndex", 0)
            on_turn = existing[idx] if isinstance(idx, int) and 0 <= idx < len(existing) else None
        if not on_turn or on_turn.get("sourceKind") not in ("player", "team") or on_turn.get("sourceId") != network_id:
            return {"error": "not your turn"}
        if ft.get("acted"):
            return {"error": "you've already chosen this turn; the DM starts the next one"}
        return on_turn

    def _handle_lead(self, state, data):
        """Caller holds CAMPAIGNS_LOCK. Before the battle goes live (draft or the VS screen), a player picks which of
        their own Pokémon in the roster goes out first: that one goes on the field and their others wait on the bench.
        Never anyone else's, never once it's live (then it's a switch, which takes your turn)."""
        ft = state.get("fullTurn") or {}
        if ft.get("phase") not in ("draft", "vs"):
            return {"error": "the battle has already started: switch on your turn instead"}
        network_id = data.get("networkId")
        combatants = ft.get("combatants") or []
        own = [c for c in combatants if c.get("sourceKind") in ("player", "team") and c.get("sourceId") == network_id]
        pick = next((c for c in own if c.get("id") == data.get("toCombatantId")), None)
        if not pick:
            return {"error": "that Pokémon isn't yours in this battle"}
        if (pick.get("mon") or {}).get("currentHp") == 0:
            return {"error": "that Pokémon has fainted"}
        own_ids = {c.get("id") for c in own}
        state["fullTurn"] = {**ft, "combatants": [{**c, "benched": c.get("id") != pick.get("id")} if c.get("id") in own_ids else c for c in combatants]}
        return {"ok": True}

    def _handle_replace(self, state, data):
        """Caller holds CAMPAIGNS_LOCK. In a live battle, when one of a player's Pokémon on the field has fainted, they
        send out one of their own benched Pokémon in its place straight away, as in the games: it isn't a turn."""
        ft = state.get("fullTurn") or {}
        if ft.get("phase") != "live":
            return {"error": "not live"}
        network_id = data.get("networkId")
        combatants = ft.get("combatants") or []
        own = lambda c: c.get("sourceKind") in ("player", "team") and c.get("sourceId") == network_id
        down = next((c for c in combatants if c.get("id") == data.get("fromCombatantId") and own(c)), None)
        pick = next((c for c in combatants if c.get("id") == data.get("toCombatantId") and own(c)), None)
        if not down or not pick:
            return {"error": "that Pokémon isn't yours in this battle"}
        if down.get("benched") or (down.get("mon") or {}).get("currentHp") != 0:
            return {"error": "only a fainted Pokémon can be replaced like this"}
        if not pick.get("benched") or (pick.get("mon") or {}).get("currentHp") == 0:
            return {"error": "that Pokémon can't come in"}
        state["fullTurn"] = {**ft, "combatants": [{**c, "benched": True} if c.get("id") == down.get("id")
                                                  else {**c, "benched": False} if c.get("id") == pick.get("id") else c for c in combatants]}
        log_battle(state, down.get("sourceLabel") or "A trainer", f"{down.get('sourceLabel') or 'A trainer'} sent out {(pick.get('mon') or {}).get('nickname') or (pick.get('mon') or {}).get('name') or 'a Pokémon'}!")
        return {"ok": True}

    def _handle_player_action(self, state, data):
        """Runs under CAMPAIGNS_LOCK. Any choice other than a move (an item, running, switching Pokémon, or something
        else): recorded as this turn's choice, told to the DM and the battle log, and locks the player until the DM
        starts the next turn. Switching sends out one of the player's own benched Pokémon from the roster
        (toCombatantId: the one on the field goes to the bench, and the new one takes over its turn), or, when they
        have none there, swaps in a Pokémon from their own saved party. "lead" (before the battle starts) picks who
        goes out first and isn't a turn."""
        if data.get("kind") == "lead":
            return self._handle_lead(state, data)
        if data.get("kind") == "replace":
            return self._handle_replace(state, data)
        ft = state.get("fullTurn") or {}
        network_id = data.get("networkId")
        mover = self._player_on_turn(ft, network_id)
        if isinstance(mover, dict) and mover.get("error"):
            return mover
        kind = data.get("kind")
        if kind not in ("item", "run", "switch", "other"):
            return {"error": "bad action"}
        text = _text(data.get("text"), MAX_TEXT) or {"item": "Used an item", "run": "Tried to run away", "switch": "Switched Pokémon", "other": "Did something else"}[kind]
        combatants = ft.get("combatants") or []
        if kind == "switch" and data.get("toCombatantId"):
            pick = next((c for c in combatants if c.get("id") == data.get("toCombatantId")), None)
            if not pick or pick.get("sourceKind") not in ("player", "team") or pick.get("sourceId") != network_id or pick.get("id") == mover.get("id"):
                return {"error": "that Pokémon isn't yours in this battle"}
            if not pick.get("benched"):
                return {"error": "that Pokémon is already out"}
            if (pick.get("mon") or {}).get("currentHp") == 0:
                return {"error": "that Pokémon has fainted"}
            combatants = [{**c, "benched": True} if c.get("id") == mover.get("id")
                          else {**c, "benched": False, "cameInFor": mover.get("id")} if c.get("id") == pick.get("id") else c
                          for c in combatants]
        elif kind == "switch":
            party = ((state["playerSaves"].get(network_id) or {}).get("current") or {}).get("party") or []
            pick = next((m for m in party if isinstance(m, dict) and m.get("id") == data.get("monId") and m.get("name")), None)
            if not pick:
                return {"error": "that Pokémon isn't in your party"}
            if pick.get("currentHp") == 0:
                return {"error": "that Pokémon has fainted"}
            combatants = [{**c, "mon": copy.deepcopy(pick)} if c.get("id") == mover.get("id") else c for c in combatants]
        name = mover.get("sourceLabel") or "A trainer"
        acted = {"combatantId": mover.get("id"), "kind": kind, "text": text, "at": time.time()}
        # a thrown ball names the ball and the target, so the DM's screen can roll the catch
        if kind == "item" and data.get("ball") in BALL_NAMES and any(c.get("id") == data.get("targetId") for c in combatants):
            acted.update({"ball": data["ball"], "targetId": data["targetId"]})
        state["fullTurn"] = {**ft, "combatants": combatants, "acted": acted}
        log_battle(state, name, text)
        state["dmInbox"].append({"id": secrets.token_hex(8), "fromName": name, "text": f"Battle: {text}", "ts": time.time()})
        return {"ok": True}


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return None
    finally:
        s.close()


def main():
    if not (ROOT / "data" / "pokemon.json").exists():
        print("No exported data found. Run `python tools/export_data.py` first.\n")

    load_state_from_disk()
    threading.Thread(target=autosave_loop, daemon=True).start()
    threading.Thread(target=backup_loop, daemon=True).start()

    # `systemctl stop/restart` (and so every deploy) sends SIGTERM, which by
    # default kills the process instantly and skips the final flush below --
    # up to AUTOSAVE_INTERVAL seconds of changes lost each time. Turn it into
    # the same clean-shutdown path Ctrl+C already takes.
    def _on_sigterm(signum, frame):
        raise KeyboardInterrupt
    try:
        signal.signal(signal.SIGTERM, _on_sigterm)
    except (ValueError, OSError):
        pass  # not the main thread / unsupported on this platform

    httpd = http.server.ThreadingHTTPServer((BIND_HOST, PORT), Handler)
    ip = lan_ip()
    print("=" * 56)
    print(f"  On this computer:  http://localhost:{PORT}")
    if BIND_HOST in ("127.0.0.1", "localhost", "::1"):
        print("  Listening on this computer only (PKDND_BIND): other devices can't connect directly.")
    elif ip:
        print(f"  On your network:   http://{ip}:{PORT}")
        print("  (open that second link on your phone/tablet, same Wi-Fi)")
        print("  Everyone on the same link can see each other in Trainers Online.")
    else:
        print("  Could not detect a LAN IP -- check your network connection.")
    print(f"  Server state autosaves to {STATE_FILE.name} every {AUTOSAVE_INTERVAL}s when it changes"
          f"{' (encrypted)' if ENCRYPT_STATE_FILE else ''}.")
    every = f"{BACKUP_INTERVAL // 60} min" if BACKUP_INTERVAL % 60 == 0 else f"{BACKUP_INTERVAL}s"
    print(f"  Backups: every {every} when changed, newest {BACKUP_KEEP} kept in {BACKUP_DIR}")
    print(f"  Sign in with Google: {'on' if GOOGLE_CLIENT_ID else 'off (set PKDND_GOOGLE_CLIENT_ID)'}"
          f"   Apple: {'on' if APPLE_CLIENT_ID else 'off (set PKDND_APPLE_CLIENT_ID)'}")
    print("=" * 56)
    print("Press Ctrl+C to stop the server.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        with CAMPAIGNS_LOCK:
            save_state_to_disk()  # final flush so nothing from the last few seconds is lost
        print("\nStopped (state saved).")


if __name__ == "__main__":
    main()
