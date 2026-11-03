"""
A showcase table for demos: the D&D campaign "The Sundered Crown" run long and stopped halfway. One DM and eight
players, each with a 7th-level character (multiclass, warlock pact magic, magic items, journals, homebrew attacks), 12 of 24
sessions played on the DM's planner, the DM's homebrew monsters / items / spells and saved encounters, a fight in progress
published to the players, a shared party map with revealed and hidden places, battle-log rolls and messages to the DM.

    python tools/seed_showcase.py                       # the local test server (tools/test_server.py, port 8860)
    python tools/seed_showcase.py --base https://fluxdev.org --live

Everything goes through the normal API as the accounts themselves, so it is additive: it creates the accounts and the
campaign if they are missing and otherwise refreshes the showcase data in them (never touching anyone else's). The shared
password is generated on the first run and kept outside the repo in ~/.pkdnd-showcase/<host>.txt. Afterwards
`node tools/keep_table_online.mjs --showcase [base]` keeps the eight players showing as online.
"""
import hashlib
import argparse
import base64
import json
import math
import random
import secrets
import struct
import subprocess
import sys
import zlib
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from seed_test_campaign import call  # noqa: E402

CAMPAIGN = "The Sundered Crown"
DOMAIN = "showcase.example.com"
DM = ("Mara (DM)", "dm")
PLAYERS = [("Aldric", "aldric"), ("Bea", "bea"), ("Cal", "cal"), ("Dani", "dani"), ("Eli", "eli"), ("Fern", "fern"), ("Gus", "gus"), ("Hana", "hana")]


def node(*args):
    out = subprocess.run(["node", *[str(a) for a in args]], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8")
    return json.loads(out.stdout)


def accounts_file(base):
    return Path.home() / ".pkdnd-showcase" / f"{urlparse(base).hostname}.txt"


def device_key(pw, nid):
    """The same made-up device every run, so once sign-in codes are on (server.py "Trusted devices") these
    scripted sign-ins never wait for an email: the device an account was registered from is trusted."""
    return "seed-device-" + hashlib.sha256(f"{pw}:{nid}".encode()).hexdigest()[:32]


def password(base):
    f = accounts_file(base)
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            if line.startswith("password:"):
                return line.split(":", 1)[1].strip()
    pw = secrets.token_urlsafe(12)
    f.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"Showcase accounts on {base} (all share this password).", f"password: {pw}"]
    lines += [f"{label}: {key}@{DOMAIN}" for label, key in [DM, *PLAYERS]]
    f.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return pw


def sign_in(base, key, pw):
    email, nid = f"{key}@{DOMAIN}", f"showcase-{key}"
    status, out = call(base, "POST", "/api/auth/login", {"email": email, "password": pw, "networkId": nid, "deviceKey": device_key(pw, nid)})
    if status == 401:   # first run: the account doesn't exist yet
        status, out = call(base, "POST", "/api/auth/register", {"email": email, "password": pw, "networkId": nid, "deviceKey": device_key(pw, nid)})
    if status != 200:
        sys.exit(f"sign-in failed for {key}: {status} {out}")
    return out["token"], out["account"]["networkId"]


# ---- a hand-drawn-looking region map, drawn pixel by pixel (no image libraries in this project) --------------------------
def png(w, h, rows):
    raw = b"".join(b"\x00" + bytes(r) for r in rows)
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def region_map(w=960, h=640):
    rnd = random.Random(7)
    forests = [(rnd.uniform(0.05, 0.45) * w, rnd.uniform(0.15, 0.9) * h, rnd.uniform(14, 34)) for _ in range(40)]
    peaks = [(0.62 + i * 0.045, 0.16 + (i % 2) * 0.05) for i in range(8)]
    rows = []
    for y in range(h):
        row = bytearray()
        river_x = w * (0.52 + 0.08 * math.sin(y / h * 6.0))
        for x in range(w):
            r, g, b = 226, 205, 160   # parchment
            if ((x * 7 + y * 13) % 29) < 2:
                r, g, b = r - 6, g - 6, b - 6
            if math.hypot(x - 0.2 * w, y - 0.78 * h) < 55:   # the Whispering Fen
                r, g, b = 150, 170, 120
            for fx, fy, fr in forests:
                if (x - fx) ** 2 + (y - fy) ** 2 < fr * fr:
                    r, g, b = 96, 132, 80
                    break
            for px, py in peaks:   # the Grey Teeth
                dx, dy = x - px * w, y - py * h
                if 0 < dy < 60 and abs(dx) < dy * 0.7:
                    r, g, b = (120, 110, 100) if dx < 0 else (150, 140, 128)
            if abs(x - river_x) < 6 + 3 * math.sin(y / 30):   # the river Vael
                r, g, b = 90, 140, 180
            if abs(y - (0.5 * h + 0.18 * (x - 0.5 * w))) < 2 and (x // 6) % 2 == 0:   # the Old King's Road
                r, g, b = 120, 84, 52
            if x < 6 or y < 6 or x >= w - 6 or y >= h - 6:
                r, g, b = 92, 64, 40
            row += bytes((max(0, r), max(0, g), max(0, b)))
        rows.append(row)
    return "data:image/png;base64," + base64.b64encode(png(w, h, rows)).decode()


PLACES = [  # label, x, y, revealed, note
    ("Brindlemoor", 0.36, 0.44, True, "Market town on the Vael. The Gilded Boar, Lantern Square."),
    ("Harrowgate", 0.60, 0.56, True, "The Duke's city. The cathedral sits over the Crypt Court."),
    ("The Whispering Fen", 0.20, 0.78, True, "Hags, eels and fog. Old Marrow's hut."),
    ("The Sunken Archive", 0.27, 0.66, True, "Flooded library of the cult."),
    ("Ironvale", 0.72, 0.20, True, "Dwarven hold under the Grey Teeth."),
    ("Fort Lancer", 0.47, 0.35, True, "Where the Ninth Lancers fell."),
    ("The Dreaming Spire", 0.86, 0.42, True, "Ashvane's tower, awake again."),
    ("Ashfang camp", 0.12, 0.30, True, "Korg's clan, wintering in the hills."),
    ("The Barrowlands", 0.80, 0.80, False, "DM ONLY: three shards lie in the barrows. The Barrow of Kings is at the centre."),
    ("The Last Lantern", 0.70, 0.70, False, "DM ONLY: the Ember Duke's inn; the landlord is an imp."),
]
COLOURS = ["#e8a33a", "#9b7be0", "#e05a5a", "#5aa8f0", "#7bc96f", "#f07ab8", "#e0c05a", "#f08a5a"]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="http://127.0.0.1:8860")
    ap.add_argument("--live", action="store_true", help="allow a non-local server (creates real accounts there)")
    args = ap.parse_args()
    base = args.base.rstrip("/")
    if urlparse(base).hostname not in ("127.0.0.1", "localhost", "::1") and not args.live:
        sys.exit("That is not a local server. Add --live if you really mean to create the showcase accounts there.")

    pw = password(base)
    world = node(HERE / "seed_characters.mjs", "--showcase", "--prefix=showcase")
    plans = node(HERE / "seed_plan.mjs", "--showcase")
    party, dm_tools, public_combat = world["party"], world["dmTools"], world["publicCombat"]
    sessions = {key: sign_in(base, key, pw) for _, key in [DM, *PLAYERS]}

    dm_token, dm_nid = sessions[DM[1]]
    _, listing = call(base, "GET", f"/api/campaigns?networkId={dm_nid}", token=dm_token)
    camp = next((c for c in listing.get("campaigns", []) if c["name"] == CAMPAIGN), None)
    if not camp:
        status, camp = call(base, "POST", "/api/campaigns", {"name": CAMPAIGN, "networkId": dm_nid, "system": "dnd5e", "edition": "2014"}, dm_token)
        if status != 200:
            sys.exit(f"could not create the campaign: {status} {camp}")
    cid = camp["id"]
    _, info = call(base, "GET", f"/api/campaign/{cid}?networkId={dm_nid}", token=dm_token)
    settings = {"edition": "2014", "shareRolls": True, "rollMode": "normal", "diceSounds": False}

    for (label, key), char in zip(PLAYERS, party):
        token, nid = sessions[key]
        status, out = call(base, "POST", "/api/campaigns/join", {"code": info["inviteCode"], "networkId": nid}, token)
        if status != 200:
            sys.exit(f"{label} could not join: {status} {out}")
        mine = plans["players"][key]
        save = {
            "version": 1, "networkId": nid,
            "trainer": {"name": label, "sprite": ""}, "party": [], "pc": [], "bag": {}, "itemIcons": {},
            "initiative": {"combatants": [], "currentIndex": 0, "round": 1, "synced": False},
            "systemData": {"dnd5e": {"characters": [char], "activeId": char["id"], "settings": settings}},
            "planner": {cid: {**mine, "displayName": label}},
        }
        call(base, "POST", "/api/playersave", {"id": nid, "save": save, "campaignId": cid}, token)
        call(base, "POST", "/api/trainer", {"id": nid, "name": label, "team": {}, "sprite": "", "campaignId": cid}, token)
        call(base, "POST", "/api/plan", {"id": nid, "name": label, "plan": {k: mine[k] for k in ("notes", "lists", "boards", "updated")}, "campaignId": cid}, token)
        print(f"  {label:6} {char['name']} (level {len(char['levelLog'])})")

    # the DM: private planner and D&D tools in their own save
    dm_save = {
        "version": 1, "networkId": dm_nid, "trainer": {"name": DM[0], "sprite": ""}, "party": [], "pc": [], "bag": {}, "itemIcons": {},
        "initiative": {"combatants": [], "currentIndex": 0, "round": 1, "synced": False},
        "systemData": {"dnd5e": {"characters": [], "activeId": None, "settings": settings, "dm": dm_tools}},
        "planner": {cid: plans["dm"]},
    }
    status, _ = call(base, "POST", "/api/playersave", {"id": dm_nid, "save": dm_save, "campaignId": cid}, dm_token)
    print(f"  DM save: {status == 200}")

    # what the table shares: the fight in progress, the party map, the battle log and a couple of notes to the DM
    status, dl = call(base, "POST", "/api/dm/login", {"password": info["dmPassword"], "campaignId": cid}, dm_token)
    tok = dl.get("token") if status == 200 else None
    if not tok:
        sys.exit(f"DM login failed: {status} {dl}")
    status, _ = call(base, "POST", "/api/dm/action", {"token": tok, "action": "fullTurnSave", "campaignId": cid, **public_combat}, dm_token)
    print(f"  combat published: {status == 200}")
    pins = [{"id": f"p{i}", "x": x, "y": y, "label": label, "note": note, "icon": "●", "color": "#ff4a22" if revealed else "#888888", "revealed": revealed}
            for i, (label, x, y, revealed, note) in enumerate(PLACES)]
    tokens = [{"id": f"t{i}", "name": c["name"].split(" ")[0], "x": 0.58 + 0.015 * (i % 4), "y": 0.6 + 0.03 * (i // 4), "color": COLOURS[i]} for i, c in enumerate(party)]
    status, out = call(base, "POST", "/api/partymap", {"token": tok, "campaignId": cid, "map": {"name": "The Vael Valley", "image": region_map(), "w": 960, "h": 640, "pins": pins, "tokens": tokens}}, dm_token)
    print(f"  party map shared: {status == 200} {'' if status == 200 else out}")
    _, log = call(base, "GET", f"/api/battlelog?campaignId={cid}", token=dm_token)
    if not log.get("entries"):
        for key, text in [("bea", "Rapier attack: 24 (d20 17 + 7) — CRITICAL!"), ("dani", "Web, Dexterity save DC 15: Hollow Guard 1 fails (9)"),
                          ("gus", "Dawnbreaker: 18 radiant + slashing"), ("fern", "Death save: 14 (success)"), ("aldric", "Healing Word: 9 HP to Lyra"),
                          ("hana", "Eldritch Blast: 2 hits, 19 force"), ("eli", "Greataxe (reckless): 21"), ("cal", "Second Wind: 11")]:
            t, _ = sessions[key]
            name = dict((k, n) for n, k in PLAYERS)[key]
            call(base, "POST", "/api/battlelog", {"fromName": name, "text": text, "campaignId": cid}, t)
        for key, text in [("dani", "Can Elowen copy the scroll from the Archive into her book during the short rest?"), ("hana", "Mirelle is hiding something about the contract. Please let me tell the party myself!")]:
            t, _ = sessions[key]
            call(base, "POST", "/api/dmnote", {"fromName": dict((k, n) for n, k in PLAYERS)[key], "text": text, "campaignId": cid}, t)
        print("  battle log and messages added")

    print(f"\n{CAMPAIGN}: campaign id {cid} on {base}")
    print(f"Sign-ins (DM: dm@{DOMAIN}) and the shared password are in {accounts_file(base)}")
    print("The DM password for the Control Centre / planner is on Settings > Campaign (owner view).")


if __name__ == "__main__":
    main()
