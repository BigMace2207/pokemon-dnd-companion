"""
Tests for the emailed sign-in codes, the admin console and permissions,
uploaded maps and cloud Library books, and the Pokémon hub's shared board.
Same throwaway-folder setup as test_server.py.
"""
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_server as ts  # noqa: E402
from test_server import call, server  # noqa: E402

PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000" "1f15c4890000000d49444154789c6360f8cf000000020001e221bc330000000049454e44ae426082")
DEV_A, DEV_B = "device-key-aaaaaaaaaaaaaaaa", "device-key-bbbbbbbbbbbbbbbb"


def upload(base, token, body, **qs):
    q = "&".join(f"{k}={urllib.request.quote(str(v))}" for k, v in qs.items())
    req = urllib.request.Request(f"{base}/api/files/upload?{q}", method="POST", data=body)
    req.add_header("Content-Type", "application/octet-stream")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def fetch(base, path, token, etag=None):
    req = urllib.request.Request(base + path)
    req.add_header("Authorization", f"Bearer {token}")
    if etag:
        req.add_header("If-None-Match", etag)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read(), r.headers.get("ETag")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), None


class Base(ts.ServerCase):
    def register(self, email, nid, device=DEV_A):
        return call(self.base, "POST", "/api/auth/register", {"email": email, "password": "password-123", "networkId": nid, "deviceKey": device})[1]["token"]

    def login(self, email, nid, device):
        return call(self.base, "POST", "/api/auth/login", {"email": email, "password": "password-123", "networkId": nid, "deviceKey": device})

    def use_outbox(self):
        server.mailer.PROVIDER, server.mailer.OUTBOX = "outbox", str(Path(self.tmp.name) / "outbox")
        server.mailer.SENT.clear()

    def last_code(self, email):
        return re.search(r"\b(\d{4})\b", server.mailer.SENT[email]["text"]).group(1)


class SignInCodes(Base):
    def test_a_new_device_needs_the_emailed_code_and_is_then_remembered(self):
        self.use_outbox()
        self.register("ann@example.com", "id-ann")
        status, out = self.login("ann@example.com", "id-ann", DEV_A)
        self.assertEqual(status, 200, "the device the account was made on is trusted")
        self.assertIn("token", out)

        status, out = self.login("ann@example.com", "id-ann-2", DEV_B)
        self.assertEqual(status, 200)
        self.assertTrue(out.get("needCode"))
        self.assertNotIn("token", out)
        self.assertEqual(out["sentTo"], "an•@example.com")
        code = self.last_code("ann@example.com")
        wrong = "0000" if code != "0000" else "1111"
        status, bad = call(self.base, "POST", "/api/auth/verify", {"challenge": out["challenge"], "code": wrong})
        self.assertEqual(status, 401)
        self.assertIn("4 tries left", bad["error"])
        status, ok = call(self.base, "POST", "/api/auth/verify", {"challenge": out["challenge"], "code": code})
        self.assertEqual(status, 200)
        self.assertTrue(ok["token"])
        self.assertTrue(ok["account"]["emailVerified"])
        self.assertEqual(call(self.base, "POST", "/api/auth/verify", {"challenge": out["challenge"], "code": code})[0], 410, "a code works once")
        self.assertIn("token", self.login("ann@example.com", "id-ann-2", DEV_B)[1], "device B is now remembered")

    def test_five_wrong_codes_end_the_attempt(self):
        self.use_outbox()
        self.register("bo@example.com", "id-bo")
        challenge = self.login("bo@example.com", "id-bo", DEV_B)[1]["challenge"]
        code = self.last_code("bo@example.com")
        wrong = "0000" if code != "0000" else "1111"
        for _ in range(4):
            self.assertEqual(call(self.base, "POST", "/api/auth/verify", {"challenge": challenge, "code": wrong})[0], 401)
        self.assertEqual(call(self.base, "POST", "/api/auth/verify", {"challenge": challenge, "code": wrong})[0], 410)
        self.assertEqual(call(self.base, "POST", "/api/auth/verify", {"challenge": challenge, "code": code})[0], 410)

    def test_without_email_set_up_sign_in_works_as_before(self):
        self.register("cy@example.com", "id-cy")
        self.assertIn("token", self.login("cy@example.com", "id-cy", DEV_B)[1])

    def test_devices_already_signed_in_are_remembered(self):
        tok = self.register("di@example.com", "id-di")
        self.use_outbox()
        call(self.base, "GET", "/api/auth/me", token=tok, headers={"X-Device-Key": DEV_B})
        self.assertIn("token", self.login("di@example.com", "id-di", DEV_B)[1])


class AdminAndPermissions(Base):
    def setUp(self):
        super().setUp()
        server.ADMIN_EMAILS = {"boss@example.com"}
        self.use_outbox()
        self.boss = self.register("boss@example.com", "id-boss")
        self.pal = self.register("pal@example.com", "id-pal")

    def tearDown(self):
        server.ADMIN_EMAILS = set()
        super().tearDown()

    def confirm_email(self, token, email):
        out = call(self.base, "POST", "/api/auth/verify-email", {}, token=token)[1]
        return call(self.base, "POST", "/api/auth/verify", {"challenge": out["challenge"], "code": self.last_code(email)})

    def test_the_admin_address_only_counts_once_it_is_confirmed(self):
        self.assertEqual(call(self.base, "GET", "/api/admin/overview", token=self.boss)[0], 404)
        status, out = self.confirm_email(self.boss, "boss@example.com")
        self.assertEqual(status, 200)
        self.assertTrue(out["account"]["perms"]["admin"])
        status, out = call(self.base, "GET", "/api/admin/overview", token=self.boss)
        self.assertEqual(status, 200)
        self.assertEqual({a["email"] for a in out["accounts"]}, {"boss@example.com", "pal@example.com"})
        self.assertEqual(call(self.base, "GET", "/api/admin/overview", token=self.pal)[0], 404, "nobody else even sees it")

    def test_grant_and_revoke_from_the_command_line(self):
        self.confirm_email(self.boss, "boss@example.com")
        out = call(self.base, "POST", "/api/admin/command", {"text": "grant pal@example.com cloudLibrary"}, token=self.boss)[1]
        self.assertIn("now has cloudLibrary", out["output"])
        me = call(self.base, "GET", "/api/auth/me", token=self.pal)[1]["account"]
        self.assertTrue(me["perms"]["cloudLibrary"])
        self.assertEqual(me["limits"]["bookBytes"], server.BOOK_BYTES_CLOUD)
        out = call(self.base, "POST", "/api/admin/command", {"text": "revoke pal@example.com cloudLibrary"}, token=self.boss)[1]
        self.assertIn("no longer has", out["output"])
        self.assertIn("I don't know", call(self.base, "POST", "/api/admin/command", {"text": "explode"}, token=self.boss)[1]["output"])
        self.assertEqual(call(self.base, "POST", "/api/admin/command", {"text": "grant pal@example.com admin"}, token=self.pal)[0], 404)

    def test_the_server_admin_cannot_be_demoted_from_the_console(self):
        self.confirm_email(self.boss, "boss@example.com")
        boss_id = next(a["id"] for a in server.ACCOUNTS.values() if a["email"] == "boss@example.com")
        out = call(self.base, "POST", "/api/admin/perm", {"accountId": boss_id, "perm": "admin", "value": False}, token=self.boss)[1]
        self.assertIn("can't", out["message"])


class DeletingCampaigns(Base):
    def setUp(self):
        super().setUp()
        server.ADMIN_EMAILS = {"boss@example.com"}
        self.boss = self.register("boss@example.com", "id-boss")
        next(a for a in server.ACCOUNTS.values() if a["email"] == "boss@example.com")["emailVerified"] = True
        self.owner = self.register("o@example.com", "id-owner")
        self.cid, self.entry = self.make_campaign("id-owner", "Doomed table")
        self.entry["state"]["plans"]["id-owner"] = {"name": "O", "updated": 1, "plan": {"notes": ["keep me"]}}

    def tearDown(self):
        server.ADMIN_EMAILS = set()
        super().tearDown()

    def act(self, token, action):
        return call(self.base, "POST", "/api/admin/campaign", {"id": self.cid, "action": action}, token=token)

    def test_deleting_hides_the_campaign_and_restoring_brings_it_back_whole(self):
        self.assertEqual(self.act(self.owner, "archive")[0], 404, "only an admin")
        status, out = self.act(self.boss, "archive")
        self.assertEqual(status, 200)
        self.assertEqual([c["id"] for c in out["overview"]["archived"]], [self.cid])
        self.assertNotIn(self.cid, [c["id"] for c in out["overview"]["campaigns"]])
        self.assertEqual(call(self.base, "GET", "/api/campaigns?networkId=id-owner", token=self.owner)[1]["campaigns"], [])
        self.assertEqual(call(self.base, "GET", f"/api/campaign/{self.cid}?networkId=id-owner", token=self.owner)[0], 404)
        self.assertEqual(self.act(self.boss, "restore")[0], 200)
        self.assertEqual(server.CAMPAIGNS[self.cid]["state"]["plans"]["id-owner"]["plan"]["notes"], ["keep me"], "nothing was lost")
        self.assertNotIn("archivedAt", server.CAMPAIGNS[self.cid])

    def test_a_deleted_campaign_survives_a_save_and_reload(self):
        self.act(self.boss, "archive")
        server.save_state_to_disk()
        server.CAMPAIGNS, server.ARCHIVED = {}, {}
        server.load_state_from_disk()
        self.assertIn(self.cid, server.ARCHIVED)
        self.assertNotIn(self.cid, server.CAMPAIGNS)


class Uploads(Base):
    def setUp(self):
        super().setUp()
        self.owner, self.member, self.outsider = self.register("o@example.com", "id-owner"), self.register("m@example.com", "id-member"), self.register("x@example.com", "id-out")
        self.cid, self.entry = self.make_campaign("id-owner", "Table")
        self.entry["meta"]["memberIds"].append("id-member")

    def up_map(self, token, body=PNG, name="map.png"):
        return upload(self.base, token, body, kind="map", campaignId=self.cid, name=name)

    def test_a_map_upload_is_private_until_the_dm_shares_it(self):
        status, out = self.up_map(self.owner)
        self.assertEqual(status, 200)
        fid = out["file"]["id"]
        status, body, etag = fetch(self.base, f"/api/files/{fid}", self.owner)
        self.assertEqual((status, body), (200, PNG))
        self.assertEqual(fetch(self.base, f"/api/files/{fid}", self.owner, etag)[0], 304, "an unchanged map isn't sent again")
        self.assertEqual(fetch(self.base, f"/api/files/{fid}", self.member)[0], 404)
        dm = call(self.base, "POST", "/api/dm/login", {"campaignId": self.cid, "password": self.entry["meta"]["dmPassword"]}, token=self.owner)[1]["token"]
        status, _ = call(self.base, "POST", "/api/partymap", {"campaignId": self.cid, "token": dm, "map": {"name": "World", "fileId": fid, "w": 1, "h": 1}}, token=self.owner)
        self.assertEqual(status, 200)
        self.assertEqual(call(self.base, "GET", f"/api/partymap?campaignId={self.cid}", token=self.member)[1]["map"]["fileId"], fid)
        self.assertEqual(fetch(self.base, f"/api/files/{fid}", self.member)[0], 200, "members can now read the shared map")
        self.assertEqual(fetch(self.base, f"/api/files/{fid}", self.outsider)[0], 404)
        # someone else's upload can't be published as the party map
        other = self.up_map(self.member)[1]["file"]["id"]
        self.assertEqual(call(self.base, "POST", "/api/partymap", {"campaignId": self.cid, "token": dm, "map": {"fileId": other}}, token=self.owner)[0], 400)

    def test_standard_accounts_keep_ten_maps_and_files_are_checked(self):
        for i in range(10):
            self.assertEqual(self.up_map(self.member, name=f"m{i}.png")[0], 200)
        status, out = self.up_map(self.member)
        self.assertEqual(status, 409)
        self.assertIn("10 maps", out["error"])
        self.assertEqual(self.up_map(self.owner, b"<svg onload=alert(1)>")[0], 415, "only real images")
        self.assertEqual(upload(self.base, self.outsider, PNG, kind="map", campaignId=self.cid, name="a.png")[0], 403)
        old = server.LIMITS_STANDARD["mapBytes"]
        server.LIMITS_STANDARD["mapBytes"] = 10
        try:
            self.assertEqual(self.up_map(self.owner)[0], 413)
        finally:
            server.LIMITS_STANDARD["mapBytes"] = old
        # deleting one makes room, and the bytes are set aside, not served
        fid = call(self.base, "GET", f"/api/files?kind=map&campaignId={self.cid}", token=self.member)[1]["files"][0]["id"]
        self.assertEqual(call(self.base, "POST", f"/api/files/{fid}/delete", {}, token=self.member)[0], 200)
        self.assertEqual(fetch(self.base, f"/api/files/{fid}", self.member)[0], 404)
        self.assertTrue(any((server.UPLOAD_DIR / "_deleted").rglob(f"{fid}.bin")))
        self.assertEqual(self.up_map(self.member)[0], 200)

    def test_books_need_the_cloud_library_permission(self):
        pdf = b"%PDF-1.4\n%fake\n"
        self.assertEqual(upload(self.base, self.member, pdf, kind="book", name="rules.pdf")[0], 403)
        acc = next(a for a in server.ACCOUNTS.values() if a["email"] == "m@example.com")
        acc["perms"] = {"cloudLibrary": True}
        self.assertEqual(upload(self.base, self.member, b"not a pdf", kind="book", name="rules.pdf")[0], 415)
        status, out = upload(self.base, self.member, pdf, kind="book", name="rules.pdf")
        self.assertEqual(status, 200)
        fid = out["file"]["id"]
        self.assertEqual(call(self.base, "POST", f"/api/files/{fid}/meta", {"meta": {"title": "Rules", "author": "Me"}}, token=self.member)[0], 200)
        listed = call(self.base, "GET", "/api/files?kind=book", token=self.member)[1]["files"]
        self.assertEqual(listed[0]["meta"]["title"], "Rules")
        self.assertEqual(fetch(self.base, f"/api/files/{fid}", self.owner)[0], 404, "books are only ever their owner's")
        self.assertEqual(call(self.base, "GET", "/api/files?kind=book", token=self.owner)[1]["files"], [])


class Hub(Base):
    def setUp(self):
        super().setUp()
        self.owner, self.member = self.register("o@example.com", "id-owner"), self.register("m@example.com", "id-member")
        self.cid, self.entry = self.make_campaign("id-owner", "Table")
        self.entry["meta"]["memberIds"].append("id-member")
        self.dm = call(self.base, "POST", "/api/dm/login", {"campaignId": self.cid, "password": self.entry["meta"]["dmPassword"]}, token=self.owner)[1]["token"]
        self.entry["state"]["npcTrainers"]["n1"] = {"name": "Brock", "team": {"party": [{"name": "Onix", "level": 14}, {"name": "Geodude", "level": 12}]}, "sprite": ""}

    def op(self, session, nid, **body):
        return call(self.base, "POST", "/api/hub/op", {"campaignId": self.cid, "id": nid, **body}, token=session)

    def sync(self, token, nid, **body):
        return call(self.base, "POST", "/api/hub/sync", {"campaignId": self.cid, "id": nid, **body}, token=token)

    def test_everyone_sees_each_others_cursors_but_not_their_own(self):
        self.sync(self.member, "id-member", cursor={"x": 10, "y": 20, "name": "Mia", "color": "#ff0000"})
        out = self.sync(self.owner, "id-owner", cursor={"x": 1, "y": 2, "name": "DM", "color": "#00ff00"})[1]
        self.assertEqual([(c["name"], c["x"], c["color"]) for c in out["cursors"]], [("Mia", 10, "#ff0000")])
        self.assertEqual(self.sync(self.member, "id-owner")[0], 403, "you can only move your own cursor")

    def test_only_the_dm_places_encounter_buttons_and_hover_shows_the_lead_level(self):
        button = {"type": "button", "x": 0, "y": 0, "label": "Gym", "reveal": "hidden", "source": {"kind": "npc", "id": "n1"}}
        self.assertEqual(self.op(self.member, "id-member", op="put", item=button)[0], 400)
        self.assertEqual(self.op(self.owner, "id-owner", op="put", item=button, token=self.dm)[0], 200)
        items = self.sync(self.member, "id-member", since=-1)[1]["items"]
        self.assertEqual(items[0]["preview"], {"level": 14, "name": None, "count": 2, "portrait": ""}, "hidden: the level shows, the Pokémon doesn't")
        bid = items[0]["id"]
        self.op(self.owner, "id-owner", op="put", item={**button, "id": bid, "reveal": "sprite"}, token=self.dm)
        out = self.sync(self.member, "id-member", since=-1)[1]
        self.assertEqual(out["items"][0]["preview"]["name"], "Onix")
        self.assertEqual(self.op(self.member, "id-member", op="delete", itemId=bid)[0], 403)
        self.assertEqual(self.op(self.member, "id-member", op="activate", itemId=bid)[0], 403)
        self.op(self.owner, "id-owner", op="activate", itemId=bid, token=self.dm)
        self.assertEqual(self.sync(self.member, "id-member", since=out["rev"])[1]["activeButton"], bid)

    def test_a_players_trainer_and_each_pokemon_are_on_the_board_only_once(self):
        mon = {"type": "mon", "name": "Eevee", "dex": 133, "x": 0, "y": 0, "hp": [20, 30], "link": "mon:abc123"}
        self.assertEqual(self.op(self.member, "id-member", op="put", item={**mon, "id": "c1"})[0], 200)
        self.assertEqual(self.op(self.member, "id-member", op="put", item={**mon, "id": "c2", "x": 50, "hp": [12, 30]})[0], 200)
        cards = [it for it in self.sync(self.member, "id-member", since=-1)[1]["items"] if it["type"] == "mon"]
        self.assertEqual([(c["id"], c["hp"]) for c in cards], [("c2", [12, 30])], "a second copy replaces the first")
        trainer = {"type": "trainer", "name": "Mia", "x": 0, "y": 0, "link": "trainer"}
        self.op(self.member, "id-member", op="put", item={**trainer, "id": "t1"})
        self.op(self.member, "id-member", op="put", item={**trainer, "id": "t2"})
        self.op(self.owner, "id-owner", op="put", item={**trainer, "name": "DM", "id": "t3"})
        names = sorted(it["id"] for it in self.sync(self.member, "id-member", since=-1)[1]["items"] if it["type"] == "trainer")
        self.assertEqual(names, ["t2", "t3"], "one trainer card per player, and someone else's link never removes yours")
        self.op(self.member, "id-member", op="put", item={**mon, "id": "c3", "link": "mon:../../x"})
        bad = next(it for it in self.sync(self.member, "id-member", since=-1)[1]["items"] if it["id"] == "c3")
        self.assertNotIn("link", bad, "a malformed link is dropped")

    def test_the_dm_sets_a_map_behind_the_hub_and_members_can_see_it(self):
        from test_features import upload, fetch, PNG
        fid = upload(self.base, self.owner, PNG, kind="map", campaignId=self.cid, name="world.png")[1]["file"]["id"]
        mine = upload(self.base, self.member, PNG, kind="map", campaignId=self.cid, name="mine.png")[1]["file"]["id"]
        self.assertEqual(fetch(self.base, f"/api/files/{fid}", self.member)[0], 404, "private until it's the backdrop")
        self.assertEqual(self.op(self.member, "id-member", op="backdrop", fileId=fid)[0], 403)
        self.assertEqual(self.op(self.owner, "id-owner", op="backdrop", fileId=mine, token=self.dm)[0], 400, "only the DM's own uploads")
        self.assertEqual(self.op(self.owner, "id-owner", op="backdrop", fileId=fid, blur=99, dim=30, token=self.dm)[0], 200)
        bd = self.sync(self.member, "id-member")[1]["backdrop"]
        self.assertEqual((bd["fileId"], bd["blur"], bd["dim"]), (fid, 40, 30))
        self.assertEqual(fetch(self.base, f"/api/files/{fid}", self.member)[0], 200)
        call(self.base, "POST", f"/api/files/{fid}/delete", {}, token=self.owner)
        self.assertIsNone(self.sync(self.member, "id-member")[1]["backdrop"], "deleting the map takes it off the hub")

    def test_pokedex_and_move_cards_and_pings_on_them(self):
        self.assertEqual(self.op(self.member, "id-member", op="put", item={"type": "mon", "id": "c1", "x": 3, "y": 4, "name": "Pikachu", "dex": 25})[0], 200)
        self.assertEqual(self.op(self.member, "id-member", op="put", item={"type": "move", "id": "c2", "name": "Thunderbolt", "open": True})[0], 200)
        self.assertEqual(self.op(self.member, "id-member", op="put", item={"type": "mon", "id": "c3", "name": ""})[0], 400)
        items = {i["id"]: i for i in self.sync(self.owner, "id-owner", since=-1)[1]["items"]}
        self.assertEqual((items["c1"]["name"], items["c1"]["dex"]), ("Pikachu", 25))
        self.assertTrue(items["c2"]["open"])
        self.sync(self.member, "id-member", cursor={"x": 0, "y": 0, "name": "Mia", "color": "#ff0000"}, ping={"x": 3, "y": 4, "item": "c1"})
        self.assertEqual(self.sync(self.owner, "id-owner")[1]["pings"][0]["item"], "c1")

    def test_shapes_and_props(self):
        ok = self.op(self.member, "id-member", op="put", item={"type": "shape", "id": "s1", "shape": "arrow", "x": 0, "y": 0, "x2": 120, "y2": -40, "color": "#ff0000", "width": 6})
        self.assertEqual(ok[0], 200)
        self.assertEqual(self.op(self.member, "id-member", op="put", item={"type": "shape", "id": "s2", "shape": "star"})[0], 400)
        self.assertEqual(self.op(self.member, "id-member", op="put", item={"type": "prop", "id": "p1", "prop": "tree", "x": 5, "y": 5, "size": 90})[0], 200)
        items = {i["id"]: i for i in self.sync(self.owner, "id-owner", since=-1)[1]["items"]}
        self.assertEqual((items["s1"]["shape"], items["s1"]["x2"], items["s1"]["y2"]), ("arrow", 120, -40))
        self.assertEqual((items["p1"]["prop"], items["p1"]["size"]), ("tree", 90))

    def test_pings_reach_everyone_and_fade(self):
        self.sync(self.member, "id-member", cursor={"x": 1, "y": 1, "name": "Mia", "color": "#ff0000"}, ping={"x": 40, "y": -20})
        out = self.sync(self.owner, "id-owner")[1]
        self.assertEqual([(p["x"], p["y"], p["name"]) for p in out["pings"]], [(40, -20, "Mia")])
        for _ in range(5):
            self.sync(self.member, "id-member", ping={"x": 0, "y": 0})
        self.assertLessEqual(len(self.sync(self.owner, "id-owner")[1]["pings"]), 3, "no ping spam")
        server.HUB_PINGS[self.cid] = [{**p, "t": 0} for p in server.HUB_PINGS[self.cid]]
        self.assertEqual(self.sync(self.owner, "id-owner")[1]["pings"], [])

    def test_notes_belong_to_whoever_wrote_them(self):
        rev = self.op(self.member, "id-member", op="put", item={"type": "note", "id": "n-1", "x": 5, "y": 5, "text": "Hi"})[1]["rev"]
        self.assertEqual(self.op(self.owner, "id-owner", op="put", item={"type": "note", "id": "n-1", "text": "mine now"})[0], 403)
        self.assertEqual(self.op(self.owner, "id-owner", op="delete", itemId="n-1", token=self.dm)[0], 200, "the DM can tidy up")
        out = self.sync(self.member, "id-member", since=rev)[1]
        self.assertEqual(out["items"], [])
        self.assertNotIn("items", self.sync(self.member, "id-member", since=out["rev"])[1], "an unchanged board isn't resent")


    def test_dm_only_notes_never_reach_players(self):
        note = {"type": "note", "id": "secret", "x": 0, "y": 0, "text": "The gym leader is a fraud", "dmOnly": True}
        self.assertEqual(self.op(self.member, "id-member", op="put", item=note)[0], 400, "players can't make DM notes")
        self.assertEqual(self.op(self.owner, "id-owner", op="put", item=note, token=self.dm)[0], 200)
        self.assertNotIn("fraud", json.dumps(self.sync(self.member, "id-member", since=-1)[1]))
        self.assertNotIn("fraud", json.dumps(self.sync(self.owner, "id-owner", since=-1)[1]), "not even the DM's own id without the DM token")
        items = call(self.base, "POST", "/api/hub/sync", {"campaignId": self.cid, "id": "id-owner", "since": -1, "token": self.dm}, token=self.owner)[1]["items"]
        self.assertTrue(next(i for i in items if i["id"] == "secret")["dmOnly"])
        self.assertEqual(self.op(self.member, "id-member", op="delete", itemId="secret")[0], 403)

    def test_team_item_and_trainer_cards(self):
        mon = {"type": "mon", "id": "t1", "name": "Pikachu", "dex": 25, "level": 12, "hp": [20, 31], "moves": ["Thunder Shock", "Growl", "", "x" * 80], "nickname": "Sparky", "held": "Oran Berry"}
        self.assertEqual(self.op(self.member, "id-member", op="put", item=mon)[0], 200)
        self.assertEqual(self.op(self.member, "id-member", op="put", item={"type": "item", "id": "i1", "name": "Potion"})[0], 200)
        self.assertEqual(self.op(self.member, "id-member", op="put", item={"type": "item", "id": "i2", "name": ""})[0], 400)
        card = {"type": "trainer", "id": "tr1", "name": "Mia", "sprite": "lass.png", "fields": [["Money", "£500"], ["Badges", "2"], ["bad"]]}
        self.assertEqual(self.op(self.member, "id-member", op="put", item=card)[0], 200)
        items = {i["id"]: i for i in self.sync(self.owner, "id-owner", since=-1)[1]["items"]}
        self.assertEqual((items["t1"]["hp"], items["t1"]["nickname"], items["t1"]["held"]), ([20, 31], "Sparky", "Oran Berry"))
        self.assertEqual(items["t1"]["moves"], ["Thunder Shock", "Growl", "x" * 40], "blank moves dropped, long ones cut")
        self.assertEqual(items["i1"]["name"], "Potion")
        self.assertEqual(items["tr1"]["fields"], [["Money", "£500"], ["Badges", "2"]])

    def test_a_stroke_being_drawn_travels_with_the_cursor(self):
        self.sync(self.member, "id-member", cursor={"x": 1, "y": 1, "name": "Mia", "color": "#ff0000", "draft": {"pts": [[0, 0], [5, 5], [9, 2]], "color": "#00ff00", "width": 6}})
        cur = self.sync(self.owner, "id-owner")[1]["cursors"][0]
        self.assertEqual(cur["draft"], {"pts": [[0, 0], [5, 5], [9, 2]], "color": "#00ff00", "width": 6})
        self.sync(self.member, "id-member", cursor={"x": 1, "y": 1, "name": "Mia", "color": "#ff0000"})
        self.assertIsNone(self.sync(self.owner, "id-owner")[1]["cursors"][0]["draft"])


class Roster(Base):
    def setUp(self):
        super().setUp()
        self.owner, self.member = self.register("o@example.com", "id-owner"), self.register("m@example.com", "id-member")
        self.cid, self.entry = self.make_campaign("id-owner", "Table")
        self.entry["meta"]["memberIds"].append("id-member")
        self.dm = call(self.base, "POST", "/api/dm/login", {"campaignId": self.cid, "password": self.entry["meta"]["dmPassword"]}, token=self.owner)[1]["token"]
        # Mia has a saved game but isn't online
        self.entry["state"]["playerSaves"]["id-member"] = {"current": {"trainer": {"name": "Mia", "cash": 750, "sprite": "lass.png"}, "party": [{"name": "Eevee", "level": 9}], "bag": {"Potion": 3}}, "named": {}}

    def test_offline_players_are_listed_and_only_the_dm_sees_their_things(self):
        rows = call(self.base, "GET", f"/api/roster?campaignId={self.cid}", token=self.owner)[1]["trainers"]
        mia = next(r for r in rows if r["id"] == "id-member")
        self.assertEqual((mia["name"], mia["online"], mia["sprite"]), ("Mia", False, "lass.png"))
        self.assertNotIn("bag", mia, "players only see names")
        rows = call(self.base, "GET", f"/api/roster?campaignId={self.cid}&token={self.dm}", token=self.owner)[1]["trainers"]
        mia = next(r for r in rows if r["id"] == "id-member")
        self.assertEqual((mia["cash"], mia["bag"], mia["party"][0]["name"]), (750, {"Potion": 3}, "Eevee"))

    def test_items_and_money_can_be_sent(self):
        send = {"campaignId": self.cid, "fromId": "id-member", "toId": "id-owner", "fromName": "Mia"}
        self.assertEqual(call(self.base, "POST", "/api/send", {**send, "type": "item", "payload": {"name": "Potion", "count": 2}}, token=self.member)[0], 200)
        self.assertEqual(call(self.base, "POST", "/api/send", {**send, "type": "item", "payload": {"name": ""}}, token=self.member)[0], 400)
        self.assertEqual(call(self.base, "POST", "/api/send", {**send, "type": "cash", "payload": {"amount": "120"}}, token=self.member)[0], 200)
        inbox = call(self.base, "GET", f"/api/inbox/id-owner?campaignId={self.cid}", token=self.owner)[1]
        msgs = inbox.get("messages") or inbox.get("entries") or []
        self.assertEqual([(m["type"], m["payload"]) for m in msgs], [("item", {"name": "Potion", "count": 2}), ("cash", {"amount": 120})])


class MapFog(Base):
    def setUp(self):
        super().setUp()
        self.owner, self.mia, self.leo = self.register("o@example.com", "id-owner"), self.register("m@example.com", "id-mia"), self.register("l@example.com", "id-leo")
        self.cid, self.entry = self.make_campaign("id-owner", "Table")
        self.entry["meta"]["memberIds"] += ["id-mia", "id-leo"]
        self.dm = call(self.base, "POST", "/api/dm/login", {"campaignId": self.cid, "password": self.entry["meta"]["dmPassword"]}, token=self.owner)[1]["token"]
        fid = upload(self.base, self.owner, PNG, kind="map", campaignId=self.cid, name="world.png")[1]["file"]["id"]
        self.map = {"name": "World", "fileId": fid, "w": 1000, "h": 500, "pins": [{"id": "p1", "x": .5, "y": .5, "label": "Town", "revealed": True}],
                    "tokens": [{"id": "id-mia", "name": "Mia", "x": .1, "y": .1}, {"id": "id-leo", "name": "Leo", "x": .9, "y": .9}, {"id": "wolf", "name": "Wolf", "x": .12, "y": .1}]}
        self.post("/api/partymap", {"token": self.dm, "map": self.map}, self.owner)

    def post(self, path, body, tok):
        return call(self.base, "POST", path, {"campaignId": self.cid, **body}, token=tok)

    def view(self, tok, nid):
        return call(self.base, "GET", f"/api/partymap?campaignId={self.cid}&id={nid}", token=tok)[1]["map"]

    def test_a_new_hub_map_starts_hidden_in_fog(self):
        self.assertTrue(self.view(self.mia, "id-mia")["fog"]["enabled"], "players mustn't glimpse a new map before the DM is ready")
        self.post("/api/partymap/fog", {"token": self.dm, "fog": {"enabled": False}}, self.owner)
        self.post("/api/partymap", {"token": self.dm, "map": self.map}, self.owner)
        self.assertFalse(self.view(self.mia, "id-mia")["fog"]["enabled"], "republishing the same map keeps the DM's fog choice")

    def test_players_move_only_themselves_and_the_mist_clears_where_they_go(self):
        self.assertEqual(self.post("/api/partymap/fog", {"fog": {"enabled": True, "shared": False}}, self.mia)[0], 403)
        self.assertEqual(self.post("/api/partymap/fog", {"token": self.dm, "fog": {"enabled": True, "shared": False, "radius": .1}}, self.owner)[0], 200)
        self.assertEqual(self.post("/api/partymap/move", {"id": "id-mia", "tokenId": "id-leo", "x": .5, "y": .5}, self.mia)[0], 403, "not someone else's token")
        self.assertEqual(self.post("/api/partymap/move", {"id": "id-mia", "x": .3, "y": .3}, self.mia)[0], 200)
        self.post("/api/partymap/move", {"id": "id-leo", "x": .8, "y": .8}, self.leo)
        mia = self.view(self.mia, "id-mia")
        self.assertEqual(mia["reveals"], [[.3, .3]], "private fog: only what Mia uncovered")
        self.assertEqual([t["id"] for t in mia["tokens"]], ["id-mia"], "and only her own token (the wolf isn't where she's been)")
        self.assertEqual(self.view(self.leo, "id-mia")["reveals"], [], "you can't read someone else's fog by claiming their id")
        self.post("/api/partymap/fog", {"token": self.dm, "fog": {"shared": True}}, self.owner)
        shared = self.view(self.mia, "id-mia")
        self.assertEqual(sorted(shared["reveals"]), [[.3, .3], [.8, .8]])
        self.assertEqual({t["id"] for t in shared["tokens"]}, {"id-mia", "id-leo", "wolf"})

    def test_the_dm_brushes_and_resets_the_fog_and_republishing_keeps_positions(self):
        self.post("/api/partymap/fog", {"token": self.dm, "fog": {"enabled": True}, "op": "reveal", "pts": [[.5, .5], [.51, .5]]}, self.owner)
        self.assertEqual(self.view(self.mia, "id-mia")["reveals"], [[.5, .5]], "a spot already clear isn't stored twice")
        self.post("/api/partymap/move", {"id": "id-mia", "x": .2, "y": .2}, self.mia)
        self.post("/api/partymap", {"token": self.dm, "map": self.map}, self.owner)   # the DM's copy still has Mia at .1
        out = self.view(self.mia, "id-mia")
        self.assertEqual(next(t for t in out["tokens"] if t["id"] == "id-mia")["x"], .2, "the player's own move isn't undone")
        self.assertTrue(out["fog"]["enabled"])
        self.post("/api/partymap/fog", {"token": self.dm, "op": "reset"}, self.owner)
        self.assertNotIn([.5, .5], self.view(self.mia, "id-mia")["reveals"], "reset covers the DM's brushing again")


class DmAccess(Base):
    def setUp(self):
        super().setUp()
        self.owner, self.mia = self.register("o@example.com", "id-owner"), self.register("m@example.com", "id-mia")
        self.cid, self.entry = self.make_campaign("id-owner", "Table")
        self.entry["meta"]["memberIds"].append("id-mia")

    def login(self, tok):
        return call(self.base, "POST", "/api/dm/login", {"campaignId": self.cid}, token=tok)

    def set_dm(self, tok, dm):
        return call(self.base, "POST", f"/api/campaigns/{self.cid}/set-dm", {"memberId": "id-mia", "dm": dm}, token=tok)

    def test_the_owner_gives_and_takes_away_dm_access(self):
        self.assertEqual(self.login(self.owner)[0], 200, "the owner is always a DM, no password")
        self.assertEqual(self.login(self.mia)[0], 403)
        self.assertEqual(self.set_dm(self.mia, True)[0], 403, "only the owner decides")
        self.assertEqual(self.set_dm(self.owner, True)[1]["dmIds"], ["id-owner", "id-mia"])
        status, out = self.login(self.mia)
        self.assertEqual(status, 200)
        tok = out["token"]
        act = lambda: call(self.base, "POST", "/api/dm/action", {"campaignId": self.cid, "token": tok, "action": "listEggs"}, token=self.mia)
        self.assertEqual(act()[0], 200)
        sync = lambda: call(self.base, "POST", "/api/hub/sync", {"campaignId": self.cid, "id": "id-mia", "since": -1}, token=self.mia)[1]["isDm"]
        self.assertTrue(sync())
        self.set_dm(self.owner, False)
        self.assertEqual(act()[0], 403, "the token stops working the moment access is taken away")
        self.assertEqual(self.login(self.mia)[0], 403)
        self.assertFalse(sync(), "the hub tells Mia, so her DM tools close")
        self.assertEqual(call(self.base, "POST", f"/api/campaigns/{self.cid}/set-dm", {"memberId": "id-owner", "dm": False}, token=self.owner)[0], 400)

    def test_eggs_keep_their_secret_until_they_hatch(self):
        dm = self.login(self.owner)[1]["token"]
        out = call(self.base, "POST", "/api/dm/action", {"campaignId": self.cid, "token": dm, "action": "giveEgg", "targetId": "id-mia", "species": "Dratini"}, token=self.owner)[1]
        egg = out["eggId"]
        directives = call(self.base, "GET", f"/api/directives/id-mia?campaignId={self.cid}", token=self.mia)[1]
        self.assertNotIn("Dratini", json.dumps(directives), "the player is told about the egg, not what's inside")
        self.assertIn(egg, json.dumps(directives))
        self.assertEqual(call(self.base, "POST", "/api/egg/hatch", {"campaignId": self.cid, "id": "id-owner", "eggId": egg}, token=self.owner)[0], 404, "not their egg")
        status, out = call(self.base, "POST", "/api/egg/hatch", {"campaignId": self.cid, "id": "id-mia", "eggId": egg}, token=self.mia)
        self.assertEqual((status, out["species"]), (200, "Dratini"))
        self.assertEqual(call(self.base, "POST", "/api/egg/hatch", {"campaignId": self.cid, "id": "id-mia", "eggId": egg}, token=self.mia)[0], 409, "an egg hatches once")


class BattleTurns(Base):
    """A player's choice (a move, an item, running, switching or something else) locks their turn; only the DM moves
    the turn on. The DM's console names whose turn it is, so the speed-sorted order can't disagree with the server."""

    def setUp(self):
        super().setUp()
        self.owner, self.member = self.register("o@example.com", "id-owner"), self.register("m@example.com", "id-member")
        self.cid, self.entry = self.make_campaign("id-owner", "Table")
        self.entry["meta"]["memberIds"].append("id-member")
        self.dm = call(self.base, "POST", "/api/dm/login", {"campaignId": self.cid, "password": self.entry["meta"]["dmPassword"]}, token=self.owner)[1]["token"]
        self.entry["state"]["playerSaves"]["id-member"] = {"current": {"networkId": "id-member", "party": [
            {"id": "p1", "name": "Pikachu", "level": 10, "currentHp": 30}, {"id": "p2", "name": "Squirtle", "level": 9, "currentHp": 25}]}, "named": {}}
        self.combatants = [
            {"id": "c-wild", "sourceKind": "wild", "sourceId": "w1", "side": "B", "mon": {"id": "w1", "name": "Rattata", "currentHp": 20}},
            {"id": "c-mia", "sourceKind": "player", "sourceId": "id-member", "sourceLabel": "Mia", "side": "A", "mon": {"id": "p1", "name": "Pikachu", "currentHp": 30}},
        ]
        self.entry["state"]["wildPokemon"]["w1"] = {"id": "w1", "name": "Rattata", "currentHp": 20}
        self.save_turn(turn_id="c-mia", index=0)

    def save_turn(self, turn_id, index, rnd=1, combatants=None):
        return call(self.base, "POST", "/api/dm/action", {"campaignId": self.cid, "token": self.dm, "action": "fullTurnSave",
                    "combatants": combatants or self.combatants, "currentIndex": index, "round": rnd, "turnId": turn_id, "phase": "live"}, token=self.owner)

    def ft(self):
        return call(self.base, "GET", f"/api/fullturn?campaignId={self.cid}", token=self.member)[1]

    def move(self, hp):
        hit = [{**c, "mon": {**c["mon"], "currentHp": hp}} if c["id"] == "c-wild" else c for c in self.ft()["combatants"]]
        return call(self.base, "POST", "/api/fullturn/playermove", {"campaignId": self.cid, "networkId": "id-member", "combatants": hit, "logTexts": ["Pikachu used Thunder Shock for 8 damage!"]}, token=self.member)[1]

    def act(self, kind, **extra):
        return call(self.base, "POST", "/api/fullturn/playeraction", {"campaignId": self.cid, "networkId": "id-member", "kind": kind, **extra}, token=self.member)[1]

    def test_a_move_applies_its_damage_then_locks_the_turn_until_the_dm_moves_on(self):
        # the server follows the DM's turnId, even though the player isn't first in the stored list
        self.assertEqual(self.move(12), {"ok": True})
        ft = self.ft()
        self.assertEqual(next(c for c in ft["combatants"] if c["id"] == "c-wild")["mon"]["currentHp"], 12)
        self.assertEqual(self.entry["state"]["wildPokemon"]["w1"]["currentHp"], 12, "damage reaches the Wild Library too")
        self.assertEqual((ft["currentIndex"], ft["turnId"]), (0, "c-mia"), "a move no longer moves the turn on")
        self.assertEqual(ft["acted"]["kind"], "move")
        self.assertIn("already chosen", self.move(5)["error"])
        self.assertIn("already chosen", self.act("run")["error"])
        # the DM editing the same turn keeps the choice; the next turn clears it
        self.save_turn(turn_id="c-mia", index=0)
        self.assertIsNotNone(self.ft()["acted"])
        self.save_turn(turn_id="c-wild", index=1)
        self.assertIsNone(self.ft()["acted"])
        self.assertIn("not your turn", self.act("run")["error"])

    def test_items_running_switching_and_other_choices(self):
        self.assertEqual(self.act("switch", monId="p2", text="Mia sends out Squirtle!"), {"ok": True})
        mine = next(c for c in self.ft()["combatants"] if c["id"] == "c-mia")
        self.assertEqual(mine["mon"]["name"], "Squirtle", "switching swaps in a Pokémon from the player's own party")
        self.assertIn("Battle: Mia sends out Squirtle!", [m["text"] for m in self.entry["state"]["dmInbox"]])
        self.save_turn(turn_id="c-mia", index=0, rnd=2)
        self.assertIn("isn't in your party", self.act("switch", monId="not-mine")["error"])
        self.assertEqual(self.act("other", text="Mia climbs a tree")["ok"], True)
        self.assertEqual(self.ft()["acted"]["text"], "Mia climbs a tree")
        self.save_turn(turn_id="c-mia", index=0, rnd=3)
        self.assertEqual(self.act("item", text="Mia uses a Potion")["ok"], True)
        self.save_turn(turn_id="c-mia", index=0, rnd=4)
        self.assertEqual(self.act("explode").get("error"), "bad action")


class SecondAccountOnOneDevice(Base):
    def test_a_device_already_linked_to_an_account_can_still_make_another(self):
        self.register("first@example.com", "id-device")
        status, out = call(self.base, "POST", "/api/auth/register", {"email": "second@example.com", "password": "password-123", "networkId": "id-device", "deviceKey": DEV_A})
        self.assertEqual(status, 200, out)
        self.assertNotEqual(out["account"]["networkId"], "id-device", "the new account gets its own trainer id")
        first = next(a for a in server.ACCOUNTS.values() if a["email"] == "first@example.com")
        self.assertIn("id-device", first["linkedIds"], "the device's id stays with the account it belongs to")
        # and signing back in to the first account on that device still works
        self.assertIn("token", self.login("first@example.com", "id-device", DEV_A)[1])
