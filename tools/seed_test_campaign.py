"""
Fill a running TEST server (tools/test_server.py) with a D&D table that is three sessions in:
a DM plus seven players, each with a 3rd-level character and a personal motive, and the DM's planner holding twelve
sessions (three played, nine prepared) tied together with connections. Safe to run twice: it reuses accounts and the campaign by name.

    python tools/test_server.py            # in one terminal
    python tools/seed_test_campaign.py     # in another   [--base http://127.0.0.1:8860]

The accounts' shared password is generated on the first run and kept in <test data folder>/seed-accounts.txt,
never in the repo. Refuses to run against anything but a local address.
"""
import argparse
import json
import secrets
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA_DIR = Path.home() / ".pkdnd-test" / ROOT.name
CAMPAIGN = "The Sundered Crown"
DM = ("Mara (DM)", "dm")
PLAYERS = [("Aldric", "aldric"), ("Bea", "bea"), ("Cal", "cal"), ("Dani", "dani"), ("Eli", "eli"), ("Fern", "fern"), ("Gus", "gus")]


def call(base, method, path, body=None, token=None):
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def node(script):
    out = subprocess.run(["node", str(HERE / script)], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8")
    return json.loads(out.stdout)


def password():
    f = DATA_DIR / "seed-accounts.txt"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            if line.startswith("password:"):
                return line.split(":", 1)[1].strip()
    pw = secrets.token_urlsafe(12)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    lines = ["Test accounts on the local test server only (all share this password).", f"password: {pw}"]
    lines += [f"{label}: {key}@seed.example.com" for label, key in [DM, *PLAYERS]]
    f.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return pw


def sign_in(base, key, pw):
    email, nid = f"{key}@seed.example.com", f"seed-{key}"
    status, out = call(base, "POST", "/api/auth/login", {"email": email, "password": pw, "networkId": nid})
    if status == 401:   # first run: the account doesn't exist yet
        status, out = call(base, "POST", "/api/auth/register", {"email": email, "password": pw, "networkId": nid})
    if status != 200:
        sys.exit(f"sign-in failed for {key}: {status} {out}")
    return out["token"], out["account"]["networkId"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8860")
    base = ap.parse_args().base.rstrip("/")
    if urlparse(base).hostname not in ("127.0.0.1", "localhost", "::1"):
        sys.exit("This only seeds a local test server.")

    pw = password()
    party = node("seed_characters.mjs")
    plans = node("seed_plan.mjs")
    people = [(DM[0], DM[1])] + [(n, k) for n, k in PLAYERS]
    sessions = {key: sign_in(base, key, pw) for _, key in people}

    # the DM creates (or finds) the campaign
    dm_token, dm_nid = sessions[DM[1]]
    _, listing = call(base, "GET", f"/api/campaigns?networkId={dm_nid}", token=dm_token)
    camp = next((c for c in listing.get("campaigns", []) if c["name"] == CAMPAIGN), None)
    if not camp:
        status, camp = call(base, "POST", "/api/campaigns", {"name": CAMPAIGN, "networkId": dm_nid, "system": "dnd5e", "edition": "2014"}, dm_token)
        if status != 200:
            sys.exit(f"could not create the campaign: {status} {camp}")
    cid = camp["id"]

    for (label, key), char in zip(PLAYERS, party):
        token, nid = sessions[key]
        status, out = call(base, "POST", "/api/campaigns/join", {"code": camp["inviteCode"], "networkId": nid}, token)
        if status != 200:
            sys.exit(f"{label} could not join: {status} {out}")
        save = {
            "version": 1, "networkId": nid,
            "trainer": {"name": label, "sprite": ""}, "party": [], "pc": [], "bag": {}, "itemIcons": {},
            "initiative": {"combatants": [], "currentIndex": 0, "round": 1, "synced": False},
            "systemData": {"dnd5e": {"characters": [char], "activeId": char["id"], "settings": {"edition": "2014", "shareRolls": True, "rollMode": "normal", "diceSounds": False}}},
            "planner": {cid: {**plans["players"][key], "displayName": label}},
        }
        call(base, "POST", "/api/playersave", {"id": nid, "save": save, "campaignId": cid}, token)
        call(base, "POST", "/api/trainer", {"id": nid, "name": label, "team": {}, "sprite": "", "campaignId": cid}, token)
        status, out = call(base, "POST", "/api/plan", {"id": nid, "name": label, "plan": {k: plans["players"][key][k] for k in ("notes", "lists", "boards", "updated")}, "campaignId": cid}, token)
        print(f"  {label:7} joined, {char['name']} ({char['race']['name']} {char['levelLog'][0]['c']} 3), plan shared: {status == 200}")

    # the DM's own save holds the private planner
    dm_save = {
        "version": 1, "networkId": dm_nid, "trainer": {"name": DM[0], "sprite": ""}, "party": [], "pc": [], "bag": {}, "itemIcons": {},
        "initiative": {"combatants": [], "currentIndex": 0, "round": 1, "synced": False},
        "systemData": {"dnd5e": {"characters": [], "activeId": None, "settings": {"edition": "2014", "shareRolls": True, "rollMode": "normal", "diceSounds": False}}},
        "planner": {cid: plans["dm"]},
    }
    status, out = call(base, "POST", "/api/playersave", {"id": dm_nid, "save": dm_save, "campaignId": cid}, dm_token)
    print(f"  DM planner saved: {status == 200} ({len(plans['dm']['boards'][0]['sessions'])} sessions on the board, {len(plans['dm']['scenarios'])} scenarios)")
    print(f"\n{CAMPAIGN}: campaign id {cid}\nSign-ins are listed in {DATA_DIR / 'seed-accounts.txt'}")
    print("The DM password for the Control Centre is on the campaign page (owner view).")


if __name__ == "__main__":
    main()
