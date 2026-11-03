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
        self.assertEqual(items[0]["preview"], {"level": 14, "name": None, "count": 2}, "hidden: the level shows, the Pokémon doesn't")
        bid = items[0]["id"]
        self.op(self.owner, "id-owner", op="put", item={**button, "id": bid, "reveal": "sprite"}, token=self.dm)
        out = self.sync(self.member, "id-member", since=-1)[1]
        self.assertEqual(out["items"][0]["preview"]["name"], "Onix")
        self.assertEqual(self.op(self.member, "id-member", op="delete", itemId=bid)[0], 403)
        self.assertEqual(self.op(self.member, "id-member", op="activate", itemId=bid)[0], 403)
        self.op(self.owner, "id-owner", op="activate", itemId=bid, token=self.dm)
        self.assertEqual(self.sync(self.member, "id-member", since=out["rev"])[1]["activeButton"], bid)

    def test_notes_belong_to_whoever_wrote_them(self):
        rev = self.op(self.member, "id-member", op="put", item={"type": "note", "id": "n-1", "x": 5, "y": 5, "text": "Hi"})[1]["rev"]
        self.assertEqual(self.op(self.owner, "id-owner", op="put", item={"type": "note", "id": "n-1", "text": "mine now"})[0], 403)
        self.assertEqual(self.op(self.owner, "id-owner", op="delete", itemId="n-1", token=self.dm)[0], 200, "the DM can tidy up")
        out = self.sync(self.member, "id-member", since=rev)[1]
        self.assertEqual(out["items"], [])
        self.assertNotIn("items", self.sync(self.member, "id-member", since=out["rev"])[1], "an unchanged board isn't resent")
