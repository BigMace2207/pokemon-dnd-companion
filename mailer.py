"""Sends the 4-digit sign-in codes. Standard library only, like the rest of
the server: the providers are plain HTTPS JSON APIs.

Configured with environment variables (set them in the systemd drop-in on the
server, never in the repo):

  PKDND_MAIL_PROVIDER   brevo | resend | outbox
  PKDND_MAIL_API_KEY    the provider's API key (brevo / resend)
  PKDND_MAIL_FROM       the verified sender, "Name <address>" or just the address
  PKDND_MAIL_OUTBOX     outbox only: a folder each email is written into as a .txt
                        file instead of being sent (local testing)

With no provider set, mail is "not configured" and the server signs people in
without a code rather than locking everyone out (see server.py).
"""

import json
import os
import re
import time
import urllib.request
from pathlib import Path

PROVIDER = (os.environ.get("PKDND_MAIL_PROVIDER") or "").strip().lower()
API_KEY = os.environ.get("PKDND_MAIL_API_KEY") or ""
FROM = os.environ.get("PKDND_MAIL_FROM") or ""
OUTBOX = os.environ.get("PKDND_MAIL_OUTBOX") or ""

# The last email per address, for the test suite (outbox mode only).
SENT = {}


def configured():
    if PROVIDER == "outbox":
        return bool(OUTBOX)
    return PROVIDER in ("brevo", "resend") and bool(API_KEY) and bool(FROM)


def describe():
    """What the admin console shows (never the key)."""
    if not configured():
        return {"configured": False, "provider": PROVIDER or None, "from": None}
    return {"configured": True, "provider": PROVIDER, "from": FROM if PROVIDER != "outbox" else "outbox folder"}


def _split_from(value):
    m = re.match(r"\s*(.*?)\s*<\s*([^>]+)\s*>\s*$", value)
    return (m.group(1) or None, m.group(2)) if m else (None, value.strip())


def _post(url, headers, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json", "Accept": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=10) as res:
        return 200 <= res.status < 300


def send(to, subject, text):
    """True when the provider accepted the email. Never raises."""
    try:
        if PROVIDER == "outbox":
            folder = Path(OUTBOX)
            folder.mkdir(parents=True, exist_ok=True)
            safe = re.sub(r"[^a-z0-9@._-]", "_", to.lower())
            (folder / f"{int(time.time() * 1000)}-{safe}.txt").write_text(f"To: {to}\nSubject: {subject}\n\n{text}\n", encoding="utf-8")
            SENT[to] = {"subject": subject, "text": text}
            print(f"[outbox] {to}: {subject}")
            return True
        name, address = _split_from(FROM)
        if PROVIDER == "brevo":
            sender = {"email": address, **({"name": name} if name else {})}
            return _post("https://api.brevo.com/v3/smtp/email", {"api-key": API_KEY},
                         {"sender": sender, "to": [{"email": to}], "subject": subject, "textContent": text})
        if PROVIDER == "resend":
            return _post("https://api.resend.com/emails", {"Authorization": f"Bearer {API_KEY}"},
                         {"from": FROM, "to": [to], "subject": subject, "text": text})
    except Exception as e:  # network trouble, a rejected key, ...
        print(f"WARNING: couldn't send email to the provider: {e}")
    return False


def send_code(to, code, purpose="login"):
    if purpose == "verify":
        subject = f"{code} is your email confirmation code"
        lead = "Use this code to confirm your email address for the Pokémon D&D Companion:"
    else:
        subject = f"{code} is your sign-in code"
        lead = "Someone (hopefully you) is signing in to your Pokémon D&D Companion account on a new device. Your code:"
    text = f"{lead}\n\n    {code}\n\nIt works for 10 minutes. If this wasn't you, ignore this email and change your password."
    return send(to, subject, text)
