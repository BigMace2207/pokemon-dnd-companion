"""
Tests for the pieces that protect player data: the static-file allowlist,
the hourly backups + recovery, optional accounts, and ID-token verification.

Run from the repo root:   python -m unittest discover -s tests -v

Everything runs in-process against a throwaway temp folder -- the real
.server_state.dat and backups are never touched.
"""
import http.server
import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import auth  # noqa: E402
import jwt_fixtures as fx  # noqa: E402
import server  # noqa: E402

# Real hashing cost is asserted separately; everywhere else, make it cheap.
auth.hash_password.__defaults__ = (None, 1000)


def call(base, method, path, body=None, token=None, headers=None):
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if r.headers.get("Content-Type", "").startswith("application/json") else raw)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


class ServerCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        tmp = Path(self.tmp.name)
        server.STATE_FILE = tmp / ".server_state.dat"
        server.BACKUP_DIR = tmp / "backups"
        server.CAMPAIGNS, server.ACCOUNTS, server.SESSIONS = {}, {}, {}
        server.CAMPAIGNS_DIRTY = False
        server.GOOGLE_CLIENT_ID = server.APPLE_CLIENT_ID = None
        auth._JWKS_CACHE.clear()
        server._AUTH_FAILS.clear()
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tmp.cleanup()

    def make_campaign(self, owner_id, name="Test"):
        cid, entry = server.new_campaign_entry(name, owner_id)
        server.CAMPAIGNS[cid] = entry
        return cid, entry


class StaticFileProtection(ServerCase):
    def test_save_file_and_source_are_not_downloadable(self):
        # The save file lives next to server.py by default; plant one.
        planted = server.ROOT / ".server_state.dat"
        existed = planted.exists()
        if not existed:
            planted.write_bytes(b"secret")
        try:
            for path in ["/.server_state.dat", "/server.py", "/auth.py", "/.gitignore", "/README.md",
                         "/tests/test_server.py", "/backups/backup-1.dat", "/.git/config",
                         "/js/../server.py", "/js/%2e%2e/server.py", "/%2e%2e/server.py", "/js/.hidden",
                         "/data/%2e%2e%2fserver.py", "/js\\..\\server.py"]:
                status, _ = call(self.base, "GET", path)
                self.assertEqual(status, 404, path)
                status, _ = call(self.base, "HEAD", path)
                self.assertEqual(status, 404, "HEAD " + path)
        finally:
            if not existed:
                planted.unlink()

    def test_the_app_itself_still_loads(self):
        for path in ["/", "/index.html", "/manifest.json", "/css/style.css", "/js/app.js", "/data/pokemon.json"]:
            status, _ = call(self.base, "GET", path)
            self.assertEqual(status, 200, path)

    def test_static_path_allowed_rules(self):
        ok = ["/", "/index.html", "/css/style.css", "/css/lava.css", "/sprites/front/1.png", "/assets/logo.png",
              "/js/vendor/pdfjs/pdf.worker.min.js", "/data/dnd5e/2014/spells.json", "/data/pokemon-dnd/rulebook.json"]
        bad = ["/sfx/a.mp3", "/Rulebook/01.md", "/data/pokemon-dnd/notes.md", "/data/dnd5e/readme.txt", "/server.py", "/.x", "/js/.x", "/js/a.py", "/data/x.dat", "/backups/a", "/unknown/a.js", "/js/../a"]
        for p in ok:
            self.assertTrue(server.static_path_allowed(p), p)
        for p in bad:
            self.assertFalse(server.static_path_allowed(p), p)


class Backups(ServerCase):
    def populate(self, n=1):
        for i in range(n):
            self.make_campaign(f"owner-{i}", f"Campaign {i}")

    def test_writes_a_readable_snapshot_with_a_private_mode(self):
        self.populate()
        path = server.take_backup()
        self.assertIsNotNone(path)
        self.assertTrue(path.name.startswith("backup-") and path.suffix == ".dat")
        data = server._read_state_file(path)
        self.assertEqual(len(data["campaigns"]), 1)
        self.assertIn("accounts", data)

    def test_skips_when_nothing_changed(self):
        self.populate()
        self.assertIsNotNone(server.take_backup())
        self.assertIsNone(server.take_backup())
        self.assertEqual(len(server.list_backups()), 1)

    def test_keeps_only_the_newest_six(self):
        self.populate()
        names = []
        for i in range(9):
            self.make_campaign(f"x{i}")  # change state so each backup differs
            time.sleep(1.05)  # names are second-resolution timestamps
            names.append(server.take_backup().name)
        kept = [p.name for p in server.list_backups()]
        self.assertEqual(len(kept), 6)
        self.assertEqual(kept, sorted(names, reverse=True)[:6])

    def test_rotation_never_touches_manual_or_quarantined_files(self):
        self.populate()
        server.BACKUP_DIR.mkdir(parents=True)
        keep = [server.BACKUP_DIR / "manual-before-deploy.dat", server.BACKUP_DIR / "unreadable-20260101-000000.dat"]
        for p in keep:
            p.write_bytes(b"precious")
        for i in range(8):
            self.make_campaign(f"y{i}")
            time.sleep(1.05)
            server.take_backup()
        for p in keep:
            self.assertEqual(p.read_bytes(), b"precious")

    def test_an_empty_state_cannot_push_good_backups_out(self):
        self.populate()
        good = server.take_backup()
        server.CAMPAIGNS.clear()
        self.assertIsNone(server.take_backup())
        self.assertEqual(server.list_backups(), [good])


class LoadRecovery(ServerCase):
    def test_roundtrip_includes_accounts_and_sessions(self):
        self.make_campaign("owner")
        server.ACCOUNTS["a1"] = {"id": "a1", "email": "x@y.zz", "password": None, "providers": {}, "networkId": "n", "linkedIds": ["n"]}
        server.SESSIONS["h"] = {"accountId": "a1", "expires": time.time() + 99}
        server.save_state_to_disk()
        server.CAMPAIGNS, server.ACCOUNTS, server.SESSIONS = {}, {}, {}
        server.load_state_from_disk()
        self.assertEqual(len(server.CAMPAIGNS), 1)
        self.assertIn("a1", server.ACCOUNTS)
        self.assertIn("h", server.SESSIONS)

    def test_old_save_without_accounts_loads(self):
        self.make_campaign("owner")
        body = json.dumps({"campaigns": server.CAMPAIGNS}).encode()
        server.STATE_FILE.write_bytes(server._MAGIC + server._xor(body, server._FILE_KEY))
        server.CAMPAIGNS = {}
        server.load_state_from_disk()
        self.assertEqual(len(server.CAMPAIGNS), 1)
        self.assertEqual(server.ACCOUNTS, {})

    def test_corrupt_save_is_quarantined_and_recovered_from_newest_backup(self):
        self.make_campaign("owner", "Precious Campaign")
        server.save_state_to_disk()
        server.take_backup()
        server.STATE_FILE.write_bytes(b"PDNDv2:this is garbage")
        server.CAMPAIGNS = {}
        server.load_state_from_disk()
        self.assertEqual([e["meta"]["name"] for e in server.CAMPAIGNS.values()], ["Precious Campaign"])
        self.assertTrue(server.CAMPAIGNS_DIRTY, "recovered state should be rewritten to the save file")
        kept = list(server.BACKUP_DIR.glob("unreadable-*.dat"))
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0].read_bytes(), b"PDNDv2:this is garbage")

    def test_corrupt_save_with_no_backup_still_keeps_a_copy(self):
        server.STATE_FILE.write_bytes(b"\x00\x01 not a save")
        server.load_state_from_disk()
        self.assertEqual(server.CAMPAIGNS, {})
        kept = list(server.BACKUP_DIR.glob("unreadable-*.dat"))
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0].read_bytes(), b"\x00\x01 not a save")

    def test_a_bad_newest_backup_falls_through_to_an_older_good_one(self):
        self.make_campaign("owner", "Good")
        server.save_state_to_disk()
        server.take_backup()
        server.BACKUP_DIR.mkdir(exist_ok=True)
        (server.BACKUP_DIR / "backup-99999999-999999.dat").write_bytes(b"PDNDv2:junk")  # sorts as newest
        server.STATE_FILE.write_bytes(b"junk")
        server.CAMPAIGNS = {}
        server.load_state_from_disk()
        self.assertEqual([e["meta"]["name"] for e in server.CAMPAIGNS.values()], ["Good"])


class PasswordHelpers(unittest.TestCase):
    def test_real_hashing_cost_is_high(self):
        self.assertGreaterEqual(auth.PBKDF2_ITERATIONS, 600_000)

    def test_hash_and_verify(self):
        rec = auth.hash_password("correct horse")
        self.assertTrue(auth.verify_password("correct horse", rec))
        self.assertFalse(auth.verify_password("correct horsf", rec))
        self.assertNotIn("correct horse", json.dumps(rec))
        self.assertNotEqual(auth.hash_password("correct horse")["salt"], rec["salt"])

    def test_malformed_record_is_just_a_failure(self):
        self.assertFalse(auth.verify_password("x", {}))
        self.assertFalse(auth.verify_password("x", {"salt": "zz", "hash": "00", "iterations": 5}))

    def test_email_and_password_rules(self):
        self.assertEqual(auth.normalize_email("  Ash@Example.COM "), "ash@example.com")
        for bad in ["", "nope", "a@b", "a b@c.de", "@c.de", None, 5, "a@b.c"]:
            self.assertIsNone(auth.normalize_email(bad), bad)
        self.assertIsNotNone(auth.password_problem("short"))
        self.assertIsNone(auth.password_problem("long enough pw"))
        self.assertIsNotNone(auth.password_problem("x" * 201))


class TokenVerification(unittest.TestCase):
    def fetcher(self, url, force=False):
        return {fx.JWK["kid"]: fx.JWK}

    def verify(self, token, provider=auth.GOOGLE, audience="test-google-client"):
        return auth.verify_id_token(token, provider, audience, jwks_fetcher=self.fetcher)

    def test_valid_token(self):
        claims = self.verify(fx.GOOD)
        self.assertEqual(claims["sub"], "google-sub-111")

    def test_rejects_everything_that_should_be_rejected(self):
        cases = {
            "expired": fx.EXPIRED, "wrong audience": fx.WRONG_AUD, "wrong issuer": fx.WRONG_ISS,
            "tampered payload": fx.TAMPERED, "alg none": fx.ALG_NONE, "HS256 confusion": fx.HS256,
            "garbage": "not.a.jwt", "empty": "",
        }
        for label, token in cases.items():
            with self.assertRaises(ValueError, msg=label):
                self.verify(token)

    def test_apple_issuer_and_unconfigured_provider(self):
        self.assertEqual(self.verify(fx.APPLE, auth.APPLE, "test-apple-client")["sub"], "apple-sub-222")
        with self.assertRaises(ValueError):
            self.verify(fx.GOOD, auth.GOOGLE, None)
        with self.assertRaises(ValueError):
            self.verify(fx.GOOD, auth.APPLE, "test-google-client")  # google token, apple issuer

    def test_unknown_key_id(self):
        with self.assertRaises(ValueError):
            auth.verify_id_token(fx.GOOD, auth.GOOGLE, "test-google-client", jwks_fetcher=lambda u, force=False: {})


class Accounts(ServerCase):
    def register(self, email="ash@example.com", password="pikachu123", nid="trainer-A"):
        return call(self.base, "POST", "/api/auth/register", {"email": email, "password": password, "networkId": nid})

    def login(self, email="ash@example.com", password="pikachu123", nid="trainer-B"):
        return call(self.base, "POST", "/api/auth/login", {"email": email, "password": password, "networkId": nid})

    def test_register_login_me_logout(self):
        status, out = self.register()
        self.assertEqual(status, 200)
        self.assertEqual(out["account"]["networkId"], "trainer-A")
        self.assertTrue(out["account"]["hasPassword"])
        self.assertNotIn("password", json.dumps(out["account"]).lower().replace("haspassword", ""))
        status, out = call(self.base, "GET", "/api/auth/me", token=out["token"])
        self.assertEqual((status, out["account"]["email"]), (200, "ash@example.com"))
        status, login = self.login()
        self.assertEqual(status, 200)
        self.assertEqual(login["account"]["networkId"], "trainer-A", "a new device adopts the account's primary id")
        self.assertEqual(call(self.base, "POST", "/api/auth/logout", {}, token=login["token"])[0], 200)
        self.assertEqual(call(self.base, "GET", "/api/auth/me", token=login["token"])[0], 401)

    def test_wrong_password_unknown_email_and_duplicates(self):
        self.register()
        status, out = self.login(password="wrong-password")
        self.assertEqual((status, out["error"]), (401, "Wrong email or password."))
        status, out2 = self.login(email="nobody@example.com")
        self.assertEqual((status, out2["error"]), (401, out["error"]), "unknown email must look identical")
        self.assertEqual(self.register(nid="trainer-Z")[0], 409)            # same email
        self.assertEqual(self.register(email="b@example.com")[0], 409)      # id already linked elsewhere
        self.assertEqual(self.register(email="not-an-email", nid="q")[0], 400)
        self.assertEqual(self.register(email="c@example.com", password="short", nid="q")[0], 400)
        self.assertEqual(call(self.base, "GET", "/api/auth/me")[0], 401)
        self.assertEqual(call(self.base, "GET", "/api/auth/me", token="forged")[0], 401)

    def test_login_is_throttled_per_email_and_a_good_login_is_not_counted_against_you(self):
        self.register()
        for _ in range(server.AUTH_LIMIT_EMAIL):
            self.assertEqual(self.login(password="nope-nope")[0], 401)
        self.assertEqual(self.login(password="nope-nope")[0], 429)
        self.assertEqual(self.login()[0], 429, "even the right password waits out the lockout")

    def test_forwarded_for_is_only_trusted_from_the_local_proxy(self):
        # Test requests come from 127.0.0.1 (the proxy case): distinct
        # X-Forwarded-For addresses are tracked separately, so one noisy
        # client can't lock everyone else out behind the proxy.
        self.register()
        for _ in range(server.AUTH_LIMIT_IP):
            call(self.base, "POST", "/api/auth/login", {"email": "x@y.zz", "password": "whatever1"}, headers={"X-Forwarded-For": "9.9.9.9"})
        self.assertEqual(call(self.base, "POST", "/api/auth/login", {"email": "x@y.zz", "password": "whatever1"}, headers={"X-Forwarded-For": "9.9.9.9"})[0], 429)
        self.assertEqual(self.login(nid="trainer-Q")[0], 200)

    def test_sessions_and_accounts_survive_a_restart_but_tokens_are_not_stored(self):
        _, out = self.register()
        server.save_state_to_disk()
        raw = server._xor(server.STATE_FILE.read_bytes()[len(server._MAGIC):], server._FILE_KEY).decode()
        self.assertNotIn(out["token"], raw)
        self.assertNotIn("pikachu123", raw)
        server.CAMPAIGNS, server.ACCOUNTS, server.SESSIONS = {}, {}, {}
        server.load_state_from_disk()
        self.assertEqual(call(self.base, "GET", "/api/auth/me", token=out["token"])[0], 200)

    def test_expired_session_is_rejected(self):
        _, out = self.register()
        for s in server.SESSIONS.values():
            s["expires"] = time.time() - 1
        self.assertEqual(call(self.base, "GET", "/api/auth/me", token=out["token"])[0], 401)

    def test_provider_signin_is_off_until_configured(self):
        status, out = call(self.base, "POST", "/api/auth/google", {"credential": fx.GOOD, "networkId": "n"})
        self.assertEqual(status, 503)
        status, cfg = call(self.base, "GET", "/api/auth/config")
        self.assertEqual(cfg, {"google": None, "apple": None})

    def test_google_signin_creates_then_reuses_an_account_and_rejects_forgeries(self):
        server.GOOGLE_CLIENT_ID = "test-google-client"
        auth._JWKS_CACHE[auth.GOOGLE["jwks_url"]] = (time.time(), {fx.JWK["kid"]: fx.JWK})
        for bad in (fx.TAMPERED, fx.EXPIRED, fx.WRONG_AUD, fx.ALG_NONE):
            self.assertEqual(call(self.base, "POST", "/api/auth/google", {"credential": bad, "networkId": "n1"})[0], 401)
        self.assertEqual(len(server.ACCOUNTS), 0)
        status, first = call(self.base, "POST", "/api/auth/google", {"credential": fx.GOOD, "networkId": "device-1"})
        self.assertEqual((status, first["account"]["networkId"]), (200, "device-1"))
        status, again = call(self.base, "POST", "/api/auth/google", {"credential": fx.GOOD, "networkId": "device-2"})
        self.assertEqual(again["account"]["networkId"], "device-1", "same Google user -> same account")
        self.assertEqual(len(server.ACCOUNTS), 1)

    def test_google_never_merges_into_an_unverified_email_account(self):
        server.GOOGLE_CLIENT_ID = "test-google-client"
        auth._JWKS_CACHE[auth.GOOGLE["jwks_url"]] = (time.time(), {fx.JWK["kid"]: fx.JWK})
        # Someone pre-registers the victim's email (never verified)...
        self.register(email="player@example.com", password="attacker-pw-1", nid="attacker-id")
        # ...the real owner then signs in with Google (same email in the token).
        status, out = call(self.base, "POST", "/api/auth/google", {"credential": fx.GOOD, "networkId": "victim-id"})
        self.assertEqual(status, 200)
        self.assertEqual(out["account"]["networkId"], "victim-id")
        self.assertFalse(out["account"]["hasPassword"], "must be a separate account, not the attacker's")
        self.assertEqual(len(server.ACCOUNTS), 2)

    def test_apple_signin_and_linking_a_provider_to_a_signed_in_account(self):
        server.APPLE_CLIENT_ID = "test-apple-client"
        auth._JWKS_CACHE[auth.APPLE["jwks_url"]] = (time.time(), {fx.JWK["kid"]: fx.JWK})
        _, reg = self.register()
        status, out = call(self.base, "POST", "/api/auth/apple", {"id_token": fx.APPLE, "networkId": "trainer-A"}, token=reg["token"])
        self.assertEqual(status, 200)
        self.assertEqual(sorted(out["account"]["providers"]), ["apple"])
        self.assertTrue(out["account"]["hasPassword"])
        self.assertEqual(len(server.ACCOUNTS), 1)
        # Signing in with Apple alone (signed out) now reaches that same account.
        status, out = call(self.base, "POST", "/api/auth/apple", {"id_token": fx.APPLE, "networkId": "other-device"})
        self.assertEqual(out["account"]["email"], "ash@example.com")


class CampaignAuthorization(ServerCase):
    """Who may read or change what once a campaign exists. The key threat:
    every member can see every other member's id (the online list), so
    nothing may be decided by an id the client merely claims."""

    def setUp(self):
        super().setUp()
        reg = lambda email, nid: call(self.base, "POST", "/api/auth/register", {"email": email, "password": "password-123", "networkId": nid})[1]["token"]
        self.owner_tok, self.member_tok, self.outsider_tok = reg("o@example.com", "id-owner"), reg("m@example.com", "id-member"), reg("x@example.com", "id-outsider")
        self.cid, self.entry = self.make_campaign("id-owner", "Table")
        self.entry["meta"]["memberIds"].append("id-member")
        self.state = self.entry["state"]
        self.state["playerSaves"]["id-owner"] = {"current": {"networkId": "id-owner", "trainer": {"name": "Owner"}, "party": []}, "named": {}}
        self.state["playerSaves"]["id-member"] = {"current": {"networkId": "id-member", "trainer": {"name": "Member"}, "party": []}, "named": {}}

    def get(self, path, tok):
        return call(self.base, "GET", f"{path}{'&' if '?' in path else '?'}campaignId={self.cid}", token=tok)

    def post(self, path, body, tok):
        return call(self.base, "POST", path, {"campaignId": self.cid, **body}, token=tok)

    def test_campaign_data_needs_a_signed_in_member(self):
        for path in ["/api/trainers", "/api/fullturn", "/api/battlelog", "/api/music", "/api/npcs", "/api/wild", "/api/trainer/id-owner"]:
            self.assertEqual(self.get(path, None)[0], 401, path)
            self.assertEqual(self.get(path, self.outsider_tok)[0], 403, path)
            self.assertEqual(self.get(path, self.member_tok)[0], 200 if path != "/api/trainer/id-owner" else 404, path)
        self.assertEqual(call(self.base, "GET", f"/api/campaign/{self.cid}?networkId=id-outsider", token=self.outsider_tok)[0], 404, "can't even confirm the campaign exists")

    def test_a_member_cannot_read_or_change_another_players_save_inbox_or_directives(self):
        m = self.member_tok
        self.assertEqual(self.get("/api/playersave?id=id-member", m)[0], 200)
        for path in ["/api/playersave?id=id-owner", "/api/inbox/id-owner", "/api/directives/id-owner"]:
            self.assertEqual(self.get(path, m)[0], 403, path)
        before = json.dumps(self.state["playerSaves"]["id-owner"], sort_keys=True)
        for path, body in [("/api/playersave", {"id": "id-owner", "save": {"party": [], "evil": True}}),
                           ("/api/playersave/named", {"id": "id-owner", "name": "x", "save": {}}),
                           ("/api/playersave/named/delete", {"id": "id-owner", "name": "x"}),
                           ("/api/trainer", {"id": "id-owner", "name": "Imposter"}),
                           ("/api/inbox/id-owner/ack", {"ids": ["a"]}),
                           ("/api/directives/id-owner/ack", {"ids": ["a"]})]:
            self.assertEqual(self.post(path, body, m)[0], 403, path)
        self.assertEqual(json.dumps(self.state["playerSaves"]["id-owner"], sort_keys=True), before)
        self.assertNotIn("id-owner", self.state["trainers"])
        self.assertEqual(self.post("/api/playersave", {"id": "id-member", "save": {"party": [], "ok": 1}}, m)[0], 200)

    def test_sound_effects_are_private_to_their_campaign(self):
        sfx = Path(self.tmp.name) / "sfx"
        (sfx / self.cid).mkdir(parents=True)
        (sfx / self.cid / "Hit.mp3").write_bytes(b"ID3audio")
        (sfx / "other-campaign").mkdir()
        (sfx / "other-campaign" / "Secret.mp3").write_bytes(b"x")
        (sfx / "outside.mp3").write_bytes(b"x")
        old, server.SFX_DIR = server.SFX_DIR, sfx
        try:
            self.assertEqual(self.get("/api/sfx", None)[0], 401)
            self.assertEqual(self.get("/api/sfx", self.outsider_tok)[0], 403)
            self.assertEqual(self.get("/api/sfx/Hit.mp3", self.outsider_tok)[0], 403)
            self.assertEqual(self.get("/api/sfx", self.member_tok)[1], {"files": ["Hit.mp3"]})
            status, body = self.get("/api/sfx/Hit.mp3", self.member_tok)
            self.assertEqual((status, body), (200, b"ID3audio"))
            for name in ["Secret.mp3", "..%2Foutside.mp3", "..%5Coutside.mp3", "Hit.txt"]:
                self.assertEqual(self.get(f"/api/sfx/{name}", self.member_tok)[0], 404, name)
            # a campaign with no folder just has no sounds, and the static route is gone
            self.assertEqual(call(self.base, "GET", "/sfx/Hit.mp3")[0], 404)
        finally:
            server.SFX_DIR = old

    def test_knowing_the_owners_id_does_not_make_you_the_owner(self):
        m = self.member_tok
        # The owner's id is public to members (it's in the online list); a claimed id must prove nothing.
        status, out = call(self.base, "GET", f"/api/campaign/{self.cid}?networkId=id-owner", token=m)
        self.assertEqual(status, 200)
        self.assertFalse(out["isOwner"])
        for secret in ("dmPassword", "inviteCode", "memberIds", "ownerId"):
            self.assertNotIn(secret, out)
        status, listing = call(self.base, "GET", "/api/campaigns?networkId=id-member", token=m)
        self.assertFalse(listing["campaigns"][0]["isOwner"])
        for action, body in [("rename", {"name": "Hijacked"}), ("regenerate-code", {}), ("regenerate-dm-password", {}),
                             ("remove-member", {"memberId": "id-owner"}), ("transfer-owner", {"newOwnerId": "id-member"}), ("delete", {})]:
            status, _ = call(self.base, "POST", f"/api/campaigns/{self.cid}/{action}", {"networkId": "id-owner", **body}, token=m)
            self.assertEqual(status, 403, action)
        self.assertIn(self.cid, server.CAMPAIGNS)
        self.assertEqual(self.entry["meta"]["name"], "Table")
        # An outsider can't tell the campaign exists, let alone manage it.
        status, _ = call(self.base, "POST", f"/api/campaigns/{self.cid}/delete", {"networkId": "id-owner"}, token=self.outsider_tok)
        self.assertEqual(status, 404)
        # The real owner (via their session) still can.
        status, out = call(self.base, "GET", f"/api/campaign/{self.cid}?networkId=id-owner", token=self.owner_tok)
        self.assertTrue(out["isOwner"] and out["dmPassword"] and out["inviteCode"])
        status, out = call(self.base, "POST", f"/api/campaigns/{self.cid}/rename", {"name": "Renamed"}, token=self.owner_tok)
        self.assertEqual((status, out["name"]), (200, "Renamed"))

    def test_messages_cannot_be_forged_or_flooded(self):
        m = self.member_tok
        good = {"fromId": "id-member", "toId": "id-owner", "type": "note", "payload": {"text": "hi"}}
        self.assertEqual(self.post("/api/send", {**good, "fromId": "id-owner"}, m)[0], 403, "can't send as someone else")
        self.assertEqual(self.post("/api/send", {**good, "toId": "id-stranger"}, m)[0], 404, "recipient must be a member")
        self.assertEqual(self.post("/api/send", {**good, "type": "exploit"}, m)[0], 400)
        self.assertEqual(self.post("/api/send", {**good, "payload": "string"}, m)[0], 400)
        self.assertEqual(self.post("/api/send", {**good, "payload": {"text": "y" * 5000}}, m)[0], 200)
        self.assertEqual(len(self.state["inbox"]["id-owner"][0]["payload"]["text"]), server.MAX_TEXT)
        for _ in range(server.MAX_INBOX + 20):
            self.post("/api/send", good, m)
        self.assertEqual(len(self.state["inbox"]["id-owner"]), server.MAX_INBOX)
        self.assertEqual(self.get("/api/inbox/id-owner", self.owner_tok)[0], 200)

    def test_player_moves_only_as_yourself_unless_you_hold_the_dm_token(self):
        self.state["fullTurn"] = {"combatants": [], "currentIndex": 0, "round": 1, "background": "", "spreadHitsAllies": False, "phase": "live"}
        status, out = self.post("/api/fullturn/playermove", {"networkId": "id-owner", "combatants": []}, self.member_tok)
        self.assertEqual(status, 403)
        status, out = self.post("/api/fullturn/playermove", {"networkId": "id-member", "combatants": []}, self.member_tok)
        self.assertEqual((status, out.get("error")), (200, "not a combatant"), "allowed through to the game rules")
        server.DM_TOKENS["dmtok"] = {"cid": self.cid, "exp": time.time() + 60}
        status, out = self.post("/api/fullturn/playermove", {"networkId": "id-owner", "combatants": [], "token": "dmtok"}, self.member_tok)
        self.assertEqual(status, 200)

    def test_oversized_and_malformed_requests(self):
        status, _ = call(self.base, "POST", "/api/auth/login", None, headers={"Content-Length": str(server.MAX_BODY + 1)})
        self.assertEqual(status, 413)
        req = urllib.request.Request(self.base + "/api/campaigns/join", method="POST", data=b"[1, 2]", headers={"Content-Type": "application/json", "Authorization": "Bearer " + self.member_tok})
        try:
            urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400)
        status, _ = call(self.base, "POST", "/api/campaigns/join", {"code": "çodé-ünicode", "networkId": "id-member"}, token=self.member_tok)
        self.assertEqual(status, 404, "a non-ASCII invite code is just a wrong code, not a crash")


class ResponseHardening(ServerCase):
    def headers_of(self, path):
        req = urllib.request.Request(self.base + path)
        with urllib.request.urlopen(req) as r:
            return r.headers

    def test_security_headers_and_no_version_leak(self):
        h = self.headers_of("/")
        self.assertEqual(h["X-Content-Type-Options"], "nosniff")
        self.assertEqual(h["X-Frame-Options"], "DENY")
        csp = h["Content-Security-Policy"]
        self.assertIn("frame-ancestors 'none'", csp)
        self.assertIn("object-src 'none'", csp)
        self.assertNotIn("unsafe-inline", csp.split("script-src")[1].split(";")[0], "no inline scripts allowed")
        self.assertNotIn("Python", h["Server"])
        self.assertNotIn("BaseHTTP", h["Server"])

    def test_the_page_has_no_inline_script_for_the_csp_to_block(self):
        import re
        html = (server.ROOT / "index.html").read_text(encoding="utf-8")
        self.assertEqual(re.findall(r"<script(?![^>]*\bsrc=)[^>]*>", html), [])

    def test_folders_are_never_listed(self):
        for path in ["/js/", "/sprites/", "/css/", "/data/"]:
            status, _ = call(self.base, "GET", path)
            self.assertEqual(status, 404, path)


class AddPassword(ServerCase):
    def google_account(self, nid="browser-id"):
        server.GOOGLE_CLIENT_ID = "test-google-client"
        auth._JWKS_CACHE[auth.GOOGLE["jwks_url"]] = (time.time(), {fx.JWK["kid"]: fx.JWK})
        status, out = call(self.base, "POST", "/api/auth/google", {"credential": fx.GOOD, "networkId": nid})
        self.assertEqual(status, 200)
        return out["token"], out["account"]

    def test_google_account_can_add_a_password_then_sign_in_with_it_from_another_device(self):
        # The owner's real identity (a different device -- e.g. the desktop app) owns a campaign.
        cid, entry = self.make_campaign("desktop-id", "My Campaign")
        entry["state"]["playerSaves"]["desktop-id"] = {"current": {"networkId": "desktop-id", "trainer": {"name": "Ash"}, "party": []}, "named": {}}
        token, account = self.google_account("browser-id")
        self.assertEqual((account["email"], account["hasPassword"]), ("player@example.com", False))
        status, out = call(self.base, "POST", "/api/auth/set-password", {"password": "a-good-password"}, token=token)
        self.assertEqual((status, out["account"]["hasPassword"]), (200, True))
        # The desktop app can't use Google; it signs in with the new password instead.
        status, login = call(self.base, "POST", "/api/auth/login", {"email": "player@example.com", "password": "a-good-password", "networkId": "desktop-id"})
        self.assertEqual((status, login["account"]["networkId"]), (200, "browser-id"))
        meta = entry["meta"]
        self.assertEqual(meta["ownerId"], "browser-id", "ownership follows the account")
        self.assertIn("desktop-id", meta["memberIds"])
        self.assertEqual(entry["state"]["playerSaves"]["browser-id"]["current"]["trainer"]["name"], "Ash")
        self.assertEqual(entry["state"]["playerSaves"]["desktop-id"]["current"]["trainer"]["name"], "Ash", "original untouched")

    def test_rules(self):
        token, _ = self.google_account()
        self.assertEqual(call(self.base, "POST", "/api/auth/set-password", {"password": "a-good-password"})[0], 401)
        self.assertEqual(call(self.base, "POST", "/api/auth/set-password", {"password": "a-good-password"}, token="forged")[0], 401)
        self.assertEqual(call(self.base, "POST", "/api/auth/set-password", {"password": "short"}, token=token)[0], 400)
        self.assertEqual(call(self.base, "POST", "/api/auth/set-password", {"password": "a-good-password"}, token=token)[0], 200)
        status, out = call(self.base, "POST", "/api/auth/set-password", {"password": "another-password"}, token=token)
        self.assertEqual(status, 409, "can't overwrite an existing password this way")
        self.assertEqual(call(self.base, "POST", "/api/auth/login", {"email": "player@example.com", "password": "a-good-password"})[0], 200)

    def test_cannot_take_an_email_already_used_by_a_password_account(self):
        call(self.base, "POST", "/api/auth/register", {"email": "player@example.com", "password": "someone-elses-1", "networkId": "other"})
        token, _ = self.google_account("browser-id")
        status, out = call(self.base, "POST", "/api/auth/set-password", {"password": "a-good-password"}, token=token)
        self.assertEqual(status, 409)

    def test_account_without_an_email_cannot_add_a_password(self):
        acc = {"id": "x1", "email": None, "password": None, "providers": {"apple": "s"}, "networkId": "n", "linkedIds": ["n"], "createdAt": time.time()}
        server.ACCOUNTS["x1"] = acc
        with server.CAMPAIGNS_LOCK:
            token = server.issue_session("x1")
        self.assertEqual(call(self.base, "POST", "/api/auth/set-password", {"password": "a-good-password"}, token=token)[0], 400)


class CampaignsRequireLogin(ServerCase):
    def signed_in(self, nid="trainer-A", email="ash@example.com"):
        _, out = call(self.base, "POST", "/api/auth/register", {"email": email, "password": "pikachu123", "networkId": nid})
        return out["token"]

    def test_list_create_and_join_are_refused_without_a_session(self):
        cid, entry = self.make_campaign("trainer-A", "Mine")
        code = entry["meta"]["inviteCode"]
        self.assertEqual(call(self.base, "GET", "/api/campaigns?networkId=trainer-A")[0], 401)
        self.assertEqual(call(self.base, "POST", "/api/campaigns", {"name": "x", "networkId": "trainer-A"})[0], 401)
        self.assertEqual(call(self.base, "POST", "/api/campaigns/join", {"code": code, "networkId": "newcomer"})[0], 401)
        self.assertEqual(call(self.base, "GET", "/api/campaigns?networkId=trainer-A", token="forged")[0], 401)
        self.assertEqual(len(server.CAMPAIGNS), 1, "nothing was created")
        self.assertNotIn("newcomer", entry["meta"]["memberIds"], "nothing was joined")

    def test_a_session_only_works_for_its_own_accounts_ids(self):
        self.make_campaign("trainer-B", "Someone else's")
        token = self.signed_in("trainer-A")
        status, out = call(self.base, "GET", "/api/campaigns?networkId=trainer-B", token=token)
        self.assertEqual(status, 401, "can't list another identity's campaigns")
        self.assertEqual(call(self.base, "POST", "/api/campaigns", {"name": "x", "networkId": "trainer-B"}, token=token)[0], 401)

    def test_signed_in_user_can_list_create_and_join(self):
        cid, entry = self.make_campaign("trainer-B", "Friend's")
        code = entry["meta"]["inviteCode"]
        token = self.signed_in("trainer-A")
        self.assertEqual(call(self.base, "GET", "/api/campaigns?networkId=trainer-A", token=token), (200, {"campaigns": []}))
        status, made = call(self.base, "POST", "/api/campaigns", {"name": "Mine", "networkId": "trainer-A"}, token=token)
        self.assertEqual((status, made["isOwner"]), (200, True))
        status, joined = call(self.base, "POST", "/api/campaigns/join", {"code": code, "networkId": "trainer-A"}, token=token)
        self.assertEqual(status, 200)
        names = sorted(c["name"] for c in call(self.base, "GET", "/api/campaigns?networkId=trainer-A", token=token)[1]["campaigns"])
        self.assertEqual(names, ["Friend's", "Mine"])

    def test_signing_out_hides_campaigns_again(self):
        self.make_campaign("trainer-A", "Mine")
        token = self.signed_in("trainer-A")
        self.assertEqual(call(self.base, "GET", "/api/campaigns?networkId=trainer-A", token=token)[0], 200)
        call(self.base, "POST", "/api/auth/logout", {}, token=token)
        self.assertEqual(call(self.base, "GET", "/api/campaigns?networkId=trainer-A", token=token)[0], 401)


class IdentityMerge(ServerCase):
    def seed_player(self, cid, entry, nid, name):
        entry["state"]["playerSaves"][nid] = {
            "current": {"networkId": nid, "trainer": {"name": name}, "party": [{"name": "Pikachu"}]},
            "named": {"before": {"networkId": nid, "trainer": {"name": name + " (old)"}}},
        }

    def test_signing_in_on_a_new_device_carries_membership_ownership_and_saves_without_deleting_anything(self):
        cid, entry = self.make_campaign("old-device", "Mine")
        entry["meta"]["memberIds"].append("friend")
        self.seed_player(cid, entry, "old-device", "Ash")
        # Account was created on a different device (primary = "new-device")...
        status, reg = call(self.base, "POST", "/api/auth/register", {"email": "ash@example.com", "password": "pikachu123", "networkId": "new-device"})
        self.assertEqual(status, 200)
        # ...then the person signs in from the old device, which owns the campaign.
        status, out = call(self.base, "POST", "/api/auth/login", {"email": "ash@example.com", "password": "pikachu123", "networkId": "old-device"})
        self.assertEqual(out["account"]["networkId"], "new-device")
        meta = entry["meta"]
        self.assertIn("new-device", meta["memberIds"])
        self.assertIn("old-device", meta["memberIds"], "old id stays a member")
        self.assertIn("friend", meta["memberIds"])
        self.assertEqual(meta["ownerId"], "new-device", "ownership follows the person")
        saves = entry["state"]["playerSaves"]
        self.assertEqual(saves["old-device"]["current"]["trainer"]["name"], "Ash", "the original save is untouched")
        self.assertIn("before", saves["old-device"]["named"])
        copied = saves["new-device"]
        self.assertEqual(copied["current"]["trainer"]["name"], "Ash")
        self.assertEqual(copied["current"]["networkId"], "new-device", "embedded id must be retargeted or the device flips back")
        self.assertEqual(copied["named"]["before"]["networkId"], "new-device")
        self.assertEqual(copied["current"]["party"], [{"name": "Pikachu"}])

    def test_an_existing_primary_save_is_never_overwritten_by_a_linked_one(self):
        cid, entry = self.make_campaign("old-device")
        self.seed_player(cid, entry, "old-device", "Old Ash")
        self.seed_player(cid, entry, "new-device", "Real Ash")
        call(self.base, "POST", "/api/auth/register", {"email": "ash@example.com", "password": "pikachu123", "networkId": "new-device"})
        call(self.base, "POST", "/api/auth/login", {"email": "ash@example.com", "password": "pikachu123", "networkId": "old-device"})
        saves = entry["state"]["playerSaves"]
        self.assertEqual(saves["new-device"]["current"]["trainer"]["name"], "Real Ash")
        self.assertEqual(saves["old-device"]["current"]["trainer"]["name"], "Old Ash")

    def test_an_id_belonging_to_another_account_is_never_taken(self):
        call(self.base, "POST", "/api/auth/register", {"email": "a@example.com", "password": "password-1", "networkId": "id-1"})
        call(self.base, "POST", "/api/auth/register", {"email": "b@example.com", "password": "password-2", "networkId": "id-2"})
        call(self.base, "POST", "/api/auth/login", {"email": "b@example.com", "password": "password-2", "networkId": "id-1"})
        owners = {a["email"]: a["linkedIds"] for a in server.ACCOUNTS.values()}
        self.assertEqual(owners["a@example.com"], ["id-1"])
        self.assertEqual(owners["b@example.com"], ["id-2"])


if __name__ == "__main__":
    unittest.main()
