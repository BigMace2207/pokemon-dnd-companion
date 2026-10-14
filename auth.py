"""
Account helpers for server.py: password hashing, email checks, and
verification of Google / Apple "ID tokens" (signed JWTs). Standard library
only, same as the rest of the server -- RSA signature checking is a single
modular exponentiation, so no third-party crypto package is needed.

Nothing here touches server state; server.py owns the account/session
tables and calls into these pure functions.
"""
import base64
import hashlib
import hmac
import json
import re
import secrets
import time
import urllib.request

# ---- Passwords --------------------------------------------------------------
# PBKDF2-HMAC-SHA256 with a per-account random salt. 600k iterations is the
# current OWASP guidance for this construction; it costs a few tenths of a
# second per attempt, which is fine for logins and painful for guessing.
PBKDF2_ITERATIONS = 600_000
MIN_PASSWORD_LEN = 8
MAX_PASSWORD_LEN = 200


def hash_password(password, salt=None, iterations=PBKDF2_ITERATIONS):
    salt = salt if salt is not None else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return {"algo": "pbkdf2-sha256", "iterations": iterations, "salt": salt.hex(), "hash": digest.hex()}


def verify_password(password, record):
    try:
        salt = bytes.fromhex(record["salt"])
        expected = bytes.fromhex(record["hash"])
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(record["iterations"]))
    except (KeyError, ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, expected)


_DUMMY = None


def burn_password_check(password):
    """Spend the same time a real check would, for a login against an
    account that doesn't exist -- so response timing doesn't reveal which
    emails are registered."""
    global _DUMMY
    if _DUMMY is None:
        _DUMMY = hash_password("not-a-real-password")
    verify_password(password, _DUMMY)


def password_problem(password):
    if not isinstance(password, str):
        return "Password is required."
    if len(password) < MIN_PASSWORD_LEN:
        return f"Password must be at least {MIN_PASSWORD_LEN} characters."
    if len(password) > MAX_PASSWORD_LEN:
        return f"Password must be at most {MAX_PASSWORD_LEN} characters."
    return None


_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s.]{2,}$")


def normalize_email(email):
    """Lower-cased, trimmed email, or None if it doesn't look like one."""
    if not isinstance(email, str):
        return None
    e = email.strip().lower()
    return e if len(e) <= 254 and _EMAIL_RE.match(e) else None


# ---- ID tokens (Google / Apple sign-in) -----------------------------------
GOOGLE = {
    "jwks_url": "https://www.googleapis.com/oauth2/v3/certs",
    "issuers": ("https://accounts.google.com", "accounts.google.com"),
}
APPLE = {
    "jwks_url": "https://appleid.apple.com/auth/keys",
    "issuers": ("https://appleid.apple.com",),
}

# DER prefix of a SHA-256 DigestInfo (RFC 8017, section 9.2).
_SHA256_DIGEST_INFO = bytes.fromhex("3031300d060960864801650304020105000420")


def _b64url_decode(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def rsa_verify_pkcs1_sha256(n, e, message, signature):
    """RSASSA-PKCS1-v1_5 / SHA-256 verification, done by comparing against
    the expected padded encoding (not by parsing the decrypted block), which
    is the construction that avoids the classic lenient-parser forgeries."""
    k = (n.bit_length() + 7) // 8
    if len(signature) != k:
        return False
    recovered = pow(int.from_bytes(signature, "big"), e, n).to_bytes(k, "big")
    t = _SHA256_DIGEST_INFO + hashlib.sha256(message).digest()
    pad = k - len(t) - 3
    if pad < 8:
        return False
    expected = b"\x00\x01" + b"\xff" * pad + b"\x00" + t
    return hmac.compare_digest(recovered, expected)


_JWKS_CACHE = {}  # url -> (fetched_at, {kid: jwk})
JWKS_TTL = 3600


def fetch_jwks(url, force=False):
    cached = _JWKS_CACHE.get(url)
    if cached and not force and time.time() - cached[0] < JWKS_TTL:
        return cached[1]
    with urllib.request.urlopen(url, timeout=10) as resp:
        keys = json.loads(resp.read().decode("utf-8")).get("keys", [])
    table = {k["kid"]: k for k in keys if k.get("kty") == "RSA" and "kid" in k}
    _JWKS_CACHE[url] = (time.time(), table)
    return table


def verify_id_token(token, provider, audience, jwks_fetcher=fetch_jwks, now=None):
    """Checks a provider-issued JWT and returns its claims, or raises
    ValueError with a short reason. Verifies: RS256 signature against the
    provider's published keys, issuer, audience (our client id), expiry."""
    if not audience:
        raise ValueError("provider not configured")
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
        header = json.loads(_b64url_decode(header_b64))
        claims = json.loads(_b64url_decode(payload_b64))
        signature = _b64url_decode(sig_b64)
    except Exception:
        raise ValueError("malformed token")
    if header.get("alg") != "RS256":
        raise ValueError("unsupported token algorithm")  # also rules out alg=none / HS256 confusion
    kid = header.get("kid")
    try:
        keys = jwks_fetcher(provider["jwks_url"])
        if kid not in keys:
            keys = jwks_fetcher(provider["jwks_url"], force=True)  # keys rotate
    except Exception:
        raise ValueError("couldn't fetch the provider's signing keys")
    jwk = keys.get(kid)
    if not jwk:
        raise ValueError("unknown signing key")
    n = int.from_bytes(_b64url_decode(jwk["n"]), "big")
    e = int.from_bytes(_b64url_decode(jwk["e"]), "big")
    if not rsa_verify_pkcs1_sha256(n, e, f"{header_b64}.{payload_b64}".encode("ascii"), signature):
        raise ValueError("bad signature")
    if claims.get("iss") not in provider["issuers"]:
        raise ValueError("wrong issuer")
    aud = claims.get("aud")
    if audience not in (aud if isinstance(aud, list) else [aud]):
        raise ValueError("token was issued for a different app")
    now = now if now is not None else time.time()
    if not isinstance(claims.get("exp"), (int, float)) or claims["exp"] < now - 60:
        raise ValueError("token expired")
    if not claims.get("sub"):
        raise ValueError("token has no subject")
    return claims
