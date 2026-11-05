"""
A fully laid-out Pokémon D&D campaign on the local TEST server: "The Aurora Circuit". A DM and eight players, three
sessions in. Built by tools/seed_pokemon_world.mjs and sent through the app's normal API as each account, so it uses
the app the way people do:

  - eight players join with the invite code; each has a full trainer sheet and portrait, six Pokémon in the party,
    more in the PC, a stocked bag, a named backup save, and their own planner (motive, goals, notes) shared with the DM;
  - the DM's NPC Library (rival, Team Eclipse, the Professor, the Champion) and Wild Library (the legendary included);
  - the DM's private planner: a ten-session Whiteboard (every gym leader, trainers, wild encounters, routes, hooks,
    treasure, notes, stickies, checklists, the players' arcs, library cards, connections), a scenario per session,
    NPC / quest / location / session records and prep lists;
  - the hub: encounter buttons from the Whiteboard and both libraries, the drawn road with props and labels, shapes,
    notes (one for the DM only), Pokédex / Move Dex / item cards, and each player's own trainer card and lead Pokémon;
  - the shared region map with towns, every player's token and fog cleared along the road;
  - a live battle (the rival rematch: players send out one each, the rival two, the rest benched), Battle Log lines,
    messages to the DM, eggs (one hatched), gifts from the DM, a player-to-player gift, and DM access for one player.

    python tools/test_server.py            # in one terminal (or the pokemon-test launch config)
    python tools/seed_pokemon_campaign.py  # in another   [--base http://127.0.0.1:8860]

Safe to run twice: it reuses the accounts and the campaign by name, and refreshes their data. The shared password is
generated on the first run and kept in <test data folder>/aurora-accounts.txt, never in the repo. Refuses to run
against anything but a local address.
"""
import argparse
import hashlib
import json
import random
import secrets
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from seed_test_campaign import call  # noqa: E402
from seed_showcase import region_map  # noqa: E402

DATA_DIR = Path.home() / ".pkdnd-test" / ROOT.name
CAMPAIGN = "The Aurora Circuit"
DOMAIN = "aurora.example.com"
DM = ("Professor Lark (DM)", "dm")
COLOURS = ["#e8a33a", "#5aa8f0", "#9b7be0", "#f07ab8", "#7bc96f", "#e0c05a", "#e05a5a", "#17a5a5"]
TOWNS = [  # label, x, y, revealed, note
    ("Port Aster", 0.12, 0.62, True, "Professor Oakley's lab. Pebble Gym (Garnet, Rock)."),
    ("Shimmer Reef", 0.20, 0.82, True, "Tide Gym (Marisol, Water). The Lapras song."),
    ("Spark City", 0.30, 0.55, True, "Spark Gym (Volta, Electric). The blackout."),
    ("Greenmantle Forest", 0.42, 0.40, True, "Leaf Gym (Fern, Grass). Smoke at dawn."),
    ("Veilwood Shrine", 0.52, 0.22, False, "Shade Gym (Morticia, Ghost). Ezra's dream."),
    ("Duskhollow", 0.60, 0.60, False, "DM ONLY: Morrow's lab under the old mine."),
    ("Bloomvale", 0.70, 0.75, False, "DM ONLY: the Aurora Wellness 'daycare'."),
    ("Frostpeak", 0.78, 0.30, False, "Frost Gym (Frost, Ice)."),
    ("Skyreach", 0.88, 0.12, False, "DM ONLY: Lumarix sleeps here. The aurora."),
    ("Draco City", 0.90, 0.55, False, "Scale Gym (Draco, Dragon) and the League."),
]


def accounts_file():
    return DATA_DIR / "aurora-accounts.txt"


def device_key(pw, nid):
    return "seed-device-" + hashlib.sha256(f"{pw}:{nid}".encode()).hexdigest()[:32]


def password(people):
    f = accounts_file()
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            if line.startswith("password:"):
                return line.split(":", 1)[1].strip()
    pw = secrets.token_urlsafe(12)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    lines = ["The Aurora Circuit: test accounts on the local test server only (all share this password).", f"password: {pw}"]
    lines += [f"{label}: {key}@{DOMAIN}" for label, key in people]
    f.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return pw


def sign_in(base, key, pw):
    email, nid = f"{key}@{DOMAIN}", f"aurora-{key}"
    status, out = call(base, "POST", "/api/auth/login", {"email": email, "password": pw, "networkId": nid, "deviceKey": device_key(pw, nid)})
    if status == 401:   # first run: the account doesn't exist yet
        status, out = call(base, "POST", "/api/auth/register", {"email": email, "password": pw, "networkId": nid, "deviceKey": device_key(pw, nid)})
    if status != 200:
        sys.exit(f"sign-in failed for {key}: {status} {out}")
    return out["token"], out["account"]["networkId"]


def must(label, status, out):
    if status != 200 or (isinstance(out, dict) and out.get("error")):
        sys.exit(f"{label} failed: {status} {out}")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="http://127.0.0.1:8860")
    base = ap.parse_args().base.rstrip("/")
    if urlparse(base).hostname not in ("127.0.0.1", "localhost", "::1"):
        sys.exit("This only seeds a local test server.")

    world = json.loads(subprocess.run(["node", str(HERE / "seed_pokemon_world.mjs")], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8").stdout)
    players = world["players"]
    people = [DM] + [(p["name"], p["key"]) for p in players]
    pw = password(people)
    sessions = {key: sign_in(base, key, pw) for _, key in people}
    dm_token, dm_nid = sessions["dm"]
    nid_of = {p["key"]: sessions[p["key"]][1] for p in players}

    # ---- the campaign
    _, listing = call(base, "GET", f"/api/campaigns?networkId={dm_nid}", token=dm_token)
    camp = next((c for c in listing.get("campaigns", []) if c["name"] == CAMPAIGN), None)
    if not camp:
        camp = must("create campaign", *call(base, "POST", "/api/campaigns", {"name": CAMPAIGN, "networkId": dm_nid, "system": "pokemon-dnd"}, dm_token))
    cid = camp["id"]
    info = must("campaign info", *call(base, "GET", f"/api/campaign/{cid}?networkId={dm_nid}", token=dm_token))
    print(f"{CAMPAIGN}: campaign {cid}")

    # ---- the players
    for p in players:
        token, nid = sessions[p["key"]]
        must(f"{p['name']} join", *call(base, "POST", "/api/campaigns/join", {"code": info["inviteCode"], "networkId": nid}, token))
        save = {"version": 1, "networkId": nid, "trainer": p["trainer"], "party": p["party"], "pc": p["pc"], "bag": p["bag"], "itemIcons": {},
                "initiative": {"combatants": [], "currentIndex": 0, "round": 1, "synced": False}, "systemData": {},
                "planner": {cid: {**world["playerPlans"][p["key"]], "scenarios": [], "maps": [], "displayName": p["name"]}}}
        must(f"{p['name']} save", *call(base, "POST", "/api/playersave", {"id": nid, "save": save, "campaignId": cid}, token))
        backup = {**save, "party": save["party"][:3]}
        call(base, "POST", "/api/playersave/named", {"id": nid, "name": "Before the Pebble Gym", "save": backup, "campaignId": cid}, token)
        must(f"{p['name']} presence", *call(base, "POST", "/api/trainer", {"id": nid, "name": p["name"], "sprite": p["sprite"], "campaignId": cid,
                                                                            "team": {"party": p["party"], "pc": p["pc"], "bag": p["bag"], "cash": p["trainer"]["cash"]}}, token))
        call(base, "POST", "/api/plan", {"id": nid, "name": p["name"], "plan": {k: world["playerPlans"][p["key"]][k] for k in ("notes", "lists", "boards", "updated")}, "campaignId": cid}, token)
        print(f"  {p['name']:13} {len(p['party'])} in the party, {len(p['pc'])} in the PC, {sum(p['bag'].values())} bag items")

    # ---- the DM: libraries, planner, tools
    dl = must("DM login", *call(base, "POST", "/api/dm/login", {"campaignId": cid}, dm_token))
    tok = dl["token"]
    dm = lambda action, **kw: call(base, "POST", "/api/dm/action", {"token": tok, "action": action, "campaignId": cid, **kw}, dm_token)
    for n in world["npcs"]:
        must(f"NPC {n['name']}", *dm("npcSave", npcId=n["id"], name=n["name"], sprite=n["sprite"], team=n["team"]))
    for w in world["wild"]:
        must(f"wild {w['mon']['name']}", *dm("wildSave", wildId=w["wildId"], mon=w["mon"]))
    print(f"  NPC Library: {len(world['npcs'])} trainers; Wild Library: {len(world['wild'])} Pokémon")
    dm_save = {"version": 1, "networkId": dm_nid, "trainer": {"name": DM[0], "sprite": "rowan.png", "cash": 0}, "party": [], "pc": [], "bag": {}, "itemIcons": {},
               "initiative": {"combatants": [], "currentIndex": 0, "round": 1, "synced": False}, "systemData": {}, "planner": {cid: world["dmPlan"]}}
    must("DM save", *call(base, "POST", "/api/playersave", {"id": dm_nid, "save": dm_save, "campaignId": cid}, dm_token))
    call(base, "POST", "/api/trainer", {"id": dm_nid, "name": DM[0], "sprite": "rowan.png", "team": {}, "campaignId": cid}, dm_token)
    board = world["dmPlan"]["boards"][0]
    print(f"  DM planner: {len(board['nodes'])} Whiteboard nodes in {len(board['sessions'])} sessions, {len(board['links'])} connections, {len(world['dmPlan']['scenarios'])} scenarios")

    # ---- the hub: start clean, then the DM's layout and each player's own cards
    hub_now = call(base, "POST", "/api/hub/sync", {"id": dm_nid, "campaignId": cid, "since": -1, "token": tok}, dm_token)[1]
    for it in hub_now.get("items", []):
        call(base, "POST", "/api/hub/op", {"id": dm_nid, "campaignId": cid, "token": tok, "op": "delete", "itemId": it["id"]}, dm_token)
    for it in world["hubItems"]:
        must(f"hub {it['type']}", *call(base, "POST", "/api/hub/op", {"id": dm_nid, "campaignId": cid, "token": tok, "op": "put", "item": it}, dm_token))
    for i, p in enumerate(players):
        token, nid = sessions[p["key"]]
        t = p["trainer"]
        fields = [["Occupation", t["occupation"]], ["From", t["originRegion"]], ["Age", t["age"]], ["Badges", str(t["badges"])], ["Money", f"£{t['cash']}"]]
        card = {"id": f"tc-{p['key']}", "type": "trainer", "link": "trainer", "name": p["name"], "sprite": p["sprite"], "fields": fields, "backstory": t["backstory"],
                "party": [{"name": m["name"], "dex": m["dex"], "level": m["level"]} for m in p["party"]], "x": -200 + (i % 4) * 300, "y": -1560 + (i // 4) * 400}
        call(base, "POST", "/api/hub/op", {"id": nid, "campaignId": cid, "op": "put", "item": card}, token)
        lead = p["party"][0]
        top = world["hpMax"].get(lead["id"], 40)
        mon = {"id": f"mc-{p['key']}", "type": "mon", "link": f"mon:{lead['id']}", "name": lead["name"], "dex": lead["dex"], "level": lead["level"],
               "hp": [lead["currentHp"] if lead["currentHp"] is not None else top, top], "moves": [m for m in lead["moves"] if m], "nickname": lead["nickname"],
               "held": lead["item"], "ability": lead["ability"], "status": lead["status"], "x": 1100 + (i % 4) * 280, "y": -1560 + (i // 4) * 380}
        call(base, "POST", "/api/hub/op", {"id": nid, "campaignId": cid, "op": "put", "item": mon}, token)
    call(base, "POST", "/api/hub/op", {"id": nid_of["isla"], "campaignId": cid, "op": "put", "item": {"id": "ic-isla", "type": "item", "name": "Fresh Water", "x": 2300, "y": 260, "open": True}}, sessions["isla"][0])
    hub_after = call(base, "POST", "/api/hub/sync", {"id": dm_nid, "campaignId": cid, "since": -1, "token": tok}, dm_token)[1]
    print(f"  hub: {len(hub_after.get('items', []))} items")

    # ---- the shared map: towns, everyone's token at Greenmantle, fog cleared along the road travelled
    pins = [{"id": f"town{i}", "x": x, "y": y, "label": label, "note": note, "icon": "●", "color": "#ff4a22" if rev else "#888888", "revealed": rev} for i, (label, x, y, rev, note) in enumerate(TOWNS)]
    tokens = [{"id": nid_of[p["key"]], "name": p["name"].split(" ")[0], "x": 0.40 + 0.015 * (i % 4), "y": 0.43 + 0.03 * (i // 4), "color": COLOURS[i]} for i, p in enumerate(players)]
    must("party map", *call(base, "POST", "/api/partymap", {"token": tok, "campaignId": cid, "map": {"name": "The Veyra Region", "image": region_map(), "w": 960, "h": 640, "pins": pins, "tokens": tokens, "fog": {"enabled": True, "shared": True, "radius": 0.07}}}, dm_token))
    road = [(TOWNS[i][1] + (TOWNS[i + 1][1] - TOWNS[i][1]) * t / 6, TOWNS[i][2] + (TOWNS[i + 1][2] - TOWNS[i][2]) * t / 6) for i in range(3) for t in range(7)]
    call(base, "POST", "/api/partymap/fog", {"token": tok, "campaignId": cid, "op": "reveal", "pts": [[round(x, 4), round(y, 4)] for x, y in road]}, dm_token)
    print("  region map shared, fog cleared along the road")

    # ---- the live battle: the Vex rematch in Greenmantle (players send out one each, the rival two)
    rng = random.Random(5)
    def combatant(kind, sid, label, mon, side, benched=False, hurt=0.0):
        m = json.loads(json.dumps(mon))
        if hurt:
            m["currentHp"] = max(1, int(world["hpMax"].get(m["id"], 40) * (1 - hurt)))
        return {"id": f"c-{sid}-{m['id']}", "sourceKind": kind, "sourceId": sid, "sourceLabel": label, "mon": m, "priority": False,
                "tiebreak": None, "megaEvolved": False, "megaFrom": None, "side": side, "benched": benched}
    fighters = []
    for key in ("rowan", "isla", "sol"):
        p = next(x for x in players if x["key"] == key)
        fighters.append(combatant("player", nid_of[key], p["name"], p["party"][0], "A", hurt=rng.choice([0, 0.2, 0.35])))
        fighters += [combatant("player", nid_of[key], p["name"], m, "A", benched=True) for m in p["party"][1:3]]
    vex = world["npcs"][0]
    fighters += [combatant("npc", vex["id"], vex["name"], m, "B", benched=i >= 2, hurt=0.25 if i == 0 else 0) for i, m in enumerate(vex["team"]["party"])]
    must("battle", *dm("fullTurnSave", combatants=fighters, currentIndex=0, round=2, turnId=fighters[0]["id"], phase="live", background="TALL GRASS.png", spreadHitsAllies=False))
    print(f"  live battle: {sum(not c['benched'] for c in fighters)} on the field, {sum(c['benched'] for c in fighters)} on the bench")

    # ---- the table's history: the Battle Log, messages to the DM, gifts, eggs, a co-DM
    _, log = call(base, "GET", f"/api/battlelog?campaignId={cid}", token=dm_token)
    if not log.get("entries"):
        for key, text in [("rowan", "Rowan Hale's Ember used Flame Wheel on Rival Vex Calder's Prinplup for 9 damage! (40 → 31 HP)"),
                          ("isla", "Isla Marin's Shellby used Water Pulse on Rival Vex Calder's Monferno for 14 damage! (44 → 30 HP)"),
                          ("sol", "Sol Rivera: Sol shouts for the forest Pokémon to get clear of the smoke"),
                          ("juno", "Juno Bright throws a Great Ball!")]:
            t, _ = sessions[key]
            call(base, "POST", "/api/battlelog", {"fromName": next(p["name"] for p in players if p["key"] == key), "text": text, "campaignId": cid}, t)
        dm("battleLogEntry", text="Gym Leader Volta handed over the Spark Badge and a warning: 'Morrow is in Duskhollow.'")
        for key, text in [("kai", "I need to tell the party about Morrow before session 6. Can we talk after the game?"),
                          ("mina", "Can my egg hatch at the Bloomvale daycare? It would mean a lot to Mina."),
                          ("ezra", "Ezra dreamed a date: the night of the next aurora. Is that session 9?")]:
            t, _ = sessions[key]
            call(base, "POST", "/api/dmnote", {"fromName": next(p["name"] for p in players if p["key"] == key), "text": text, "campaignId": cid}, t)
        print("  Battle Log and messages to the DM added")
    eggs = must("eggs", *dm("listEggs"))["eggs"]
    if not any(e["to"] == nid_of["mina"] for e in eggs):
        egg1 = must("egg", *dm("giveEgg", targetId=nid_of["mina"], species="Togepi", trainerName="Mina Sol"))["eggId"]
        must("egg", *dm("giveEgg", targetId=nid_of["mina"], species="Eevee", trainerName="Mina Sol"))
        must("egg", *dm("giveEgg", targetId=nid_of["ezra"], species="Larvitar", trainerName="Ezra Quill"))
        call(base, "POST", "/api/egg/hatch", {"id": nid_of["mina"], "eggId": egg1, "campaignId": cid}, sessions["mina"][0])
        dm("giveItem", targetId=nid_of["theo"], name="Escape Rope", qty=2, trainerName="Theo Granger")
        dm("giveItem", targetId=nid_of["juno"], name="Rare Candy", qty=1, trainerName="Juno Bright")
        dm("personalNote", targetId=nid_of["kai"], text="A Murkrow drops a note at your feet: 'We know where you are. M.'")
        call(base, "POST", "/api/send", {"fromId": nid_of["isla"], "fromName": "Isla Marin", "toId": nid_of["theo"], "type": "item", "payload": {"name": "Potion", "count": 2}, "campaignId": cid}, sessions["isla"][0])
        print("  eggs (Mina hatched one), DM gifts, a note for Kai, and a gift from Isla to Theo")
    status, out = call(base, "POST", f"/api/campaigns/{cid}/set-dm", {"memberId": nid_of["theo"], "dm": True}, dm_token)
    print(f"  Theo has DM access (co-DM): {status == 200}")

    print(f"\nDone. Sign in as the DM ({DM[1]}@{DOMAIN}) or any player (<name>@{DOMAIN}, e.g. rowan@{DOMAIN}).")
    print(f"The shared password is in {accounts_file()}")


if __name__ == "__main__":
    main()
