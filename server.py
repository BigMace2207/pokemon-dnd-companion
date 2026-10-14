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
        "fullTurn": {"combatants": [], "currentIndex": 0, "round": 1, "background": "", "spreadHitsAllies": False, "phase": "draft"},
        "playerSaves": {},   # networkId -> {"current": <save object>, "named": {slotName: <save object>}}
    }


def new_campaign_entry(name, owner_id, system=DEFAULT_SYSTEM):
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
# token -> campaignId. A DM login is scoped to the one campaign it was
# issued for, since each campaign now has its own DM password.
DM_TOKENS = {}


def mark_dirty():
    global CAMPAIGNS_DIRTY
    CAMPAIGNS_DIRTY = True


def campaign_summary(cid, entry, is_owner):
    """is_owner must come from the request's signed-in session (see
    Handler._owns_campaign), never from an id the client merely claims: it
    gates the invite code and DM password."""
    meta = entry["meta"]
    out = {
        "id": cid,
        "name": meta["name"],
        "isOwner": is_owner,
        "memberCount": len(meta.get("memberIds") or []),
        "system": meta.get("system", DEFAULT_SYSTEM),
        "createdAt": meta["createdAt"],
    }
    if is_owner:
        out["inviteCode"] = meta["inviteCode"]
        out["dmPassword"] = meta["dmPassword"]
        out["memberIds"] = meta.get("memberIds") or []
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
    body = json.dumps({"campaigns": CAMPAIGNS, "accounts": ACCOUNTS, "sessions": SESSIONS}).encode("utf-8")
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
    global CAMPAIGNS, ACCOUNTS, SESSIONS
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
    CAMPAIGNS, ACCOUNTS, SESSIONS = {}, {}, {}
    print("No usable backup found -- starting fresh (the unreadable file was kept, see above).")


def _install_loaded(loaded, source_name):
    """Replaces the in-memory state with a parsed save. Raises (leaving the
    caller to fall back) if the data isn't shaped like a save."""
    global CAMPAIGNS, ACCOUNTS, SESSIONS
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


def public_account(acc):
    return {
        "email": acc.get("email"),
        "hasPassword": bool(acc.get("password")),
        "providers": sorted(acc.get("providers") or {}),
        "networkId": acc["networkId"],
    }


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


# Largest request body accepted (a full player save with a big PC box is well
# under 1 MB) and the longest free-text / name fields stored from clients.
MAX_BODY = 4 * 1024 * 1024
MAX_NAME = 60
MAX_TEXT = 1000
MAX_INBOX = 100

# Only the sign-in providers' own hosts may be scripted/framed/contacted, and
# nothing but this site may frame us. 'unsafe-inline' is for style
# attributes only; there are no inline scripts.
CONTENT_SECURITY_POLICY = "; ".join([
    "default-src 'self'",
    "script-src 'self' https://accounts.google.com https://appleid.cdn-apple.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "media-src 'self'",
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
        return rec["cid"] == cid

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
            return self._send_json({"google": GOOGLE_CLIENT_ID, "apple": APPLE_CLIENT_ID})
        if action == "me":
            with CAMPAIGNS_LOCK:
                acc = account_from_token(self._bearer())
                if not acc:
                    return self._send_json({"error": "not signed in"}, 401)
                return self._send_json({"account": public_account(acc)})
        return self._send_json({"error": "not found"}, 404)

    def _auth_post(self, parts, data):
        action = parts[2] if len(parts) > 2 else ""
        ip = self._client_ip()
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
                if account_owning_network_id(network_id):
                    return self._send_json({"error": "This device's trainer is already linked to another account. Sign in to that one instead."}, 409)
                acc = {
                    "id": secrets.token_hex(8), "email": email, "password": record, "providers": {},
                    "networkId": network_id, "linkedIds": [network_id], "createdAt": time.time(),
                }
                ACCOUNTS[acc["id"]] = acc
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
                self._link_device(acc, network_id)
                token = issue_session(acc["id"])
                mark_dirty()
                return self._send_json({"token": token, "account": public_account(acc)})

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

    def do_POST(self):
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

        # ---- Campaign management (not scoped to an existing campaign) ----
        if parts[1:] == ["campaigns"]:
            name, network_id = data.get("name"), data.get("networkId")
            if not network_id:
                return self._send_json({"error": "missing networkId"}, 400)
            with CAMPAIGNS_LOCK:
                if not self._signed_in_for(network_id):
                    return self._send_json({"error": "sign in required"}, 401)
                cid, entry = new_campaign_entry(name if isinstance(name, str) else "", network_id, data.get("system") or DEFAULT_SYSTEM)
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

                if action == "regenerate-code":
                    if not is_owner:
                        return self._send_json({"error": "owner only"}, 403)
                    entry["meta"]["inviteCode"] = new_code()
                    mark_dirty()
                    return self._send_json(campaign_summary(cid, entry, True))

                if action == "regenerate-dm-password":
                    if not is_owner:
                        return self._send_json({"error": "owner only"}, 403)
                    entry["meta"]["dmPassword"] = new_code()
                    mark_dirty()
                    return self._send_json(campaign_summary(cid, entry, True))

                if action == "remove-member":
                    if not is_owner:
                        return self._send_json({"error": "owner only"}, 403)
                    target = data.get("memberId")
                    if target == entry["meta"]["ownerId"]:
                        return self._send_json({"error": "can't remove the owner"}, 400)
                    entry["meta"]["memberIds"] = [m for m in entry["meta"].get("memberIds") or [] if m != target]
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
                if kind not in ("note", "pokemon", "cash") or not isinstance(payload, dict) or len(json.dumps(payload)) > 100_000:
                    return self._send_json({"error": "bad message"}, 400)
                if kind == "note":
                    payload = {"text": str(payload.get("text") or "")[:MAX_TEXT]}
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
                if secrets.compare_digest(str(data.get("password") or ""), str(entry["meta"]["dmPassword"])):
                    token = secrets.token_hex(24)
                    DM_TOKENS[token] = {"cid": cid, "exp": time.time() + DM_TOKEN_TTL}
                    return self._send_json({"ok": True, "token": token})
                rate_fail(ck)
                rate_fail(cck)
                return self._send_json({"ok": False}, 401)

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
                log_battle(state, "Dungeon Master", data.get("logText") or f"{data.get('trainerName', 'A trainer')}'s {data.get('monName', 'Pokémon')} HP changed.")
            return {"ok": True}

        if action == "setStatus":
            apply_status(state, target_kind, target_id, data.get("monId"), data.get("status"))
            if data.get("inBattle"):
                log_battle(state, "Dungeon Master", data.get("logText") or f"{data.get('trainerName', 'A trainer')}'s {data.get('monName', 'Pokémon')} is now {data.get('status')}.")
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
            log_battle(state, "Dungeon Master", data.get("logText") or f"{data.get('trainerName', 'A trainer')}'s {data.get('monName', 'Pokémon')} was granted levels by the DM — now Level {level}.")
            return {"ok": True}

        if action == "giveItem":
            name = (data.get("name") or "").strip()
            qty = data.get("qty")
            if not name or not isinstance(qty, int) or qty < 1:
                return {"error": "bad request"}
            queue_directive(state, target_id, "giveItem", {"name": name, "qty": qty})
            log_battle(state, "Dungeon Master", f"{data.get('trainerName', 'A trainer')} received {qty}× {name} from the DM.")
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
            state["fullTurn"] = {
                "combatants": data.get("combatants") or [],
                "currentIndex": data.get("currentIndex") or 0,
                "round": data.get("round") or 1,
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
        this change HP/status on existing combatants and advance the turn
        counter, but never add, remove, or otherwise restructure the
        roster the way a DM action can -- the damage number itself is
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

        # Only on their own turn.
        idx = ft.get("currentIndex", 0)
        on_turn = existing[idx] if isinstance(idx, int) and 0 <= idx < len(existing) else None
        if not on_turn or on_turn.get("sourceKind") not in ("player", "team") or on_turn.get("sourceId") != network_id:
            return {"error": "not your turn"}
        mover = on_turn

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

        state["fullTurn"] = {
            "combatants": submitted,
            "currentIndex": data.get("currentIndex", ft.get("currentIndex", 0)),
            "round": data.get("round", ft.get("round", 1)),
            "background": ft.get("background", ""),
            "spreadHitsAllies": ft.get("spreadHitsAllies", False),
            "phase": "live",
        }
        for line in data.get("logTexts") or []:
            log_battle(state, mover.get("sourceLabel") or "A trainer", line)
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
