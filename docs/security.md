# Security model

Everything the browser can see is public: `index.html`, `manifest.json` and the folders `css js data sprites sfx assets`. Nothing else is served (not the save file, backups, source or dotfiles). The server decides everything from the signed-in session, never from an id the client claims, because every campaign member can see every other member's id.

- **Campaign data** needs a signed-in session whose account is a member. Outsiders get the same 404 whether or not the campaign exists.
- **Acting as a player** (save, inbox, directives, presence, messages, moves) only works for ids linked to your own account. The DM token also allows moving on a player's behalf.
- **Owner actions, the invite code and the DM password** need your account to own the campaign. The DM Control Centre additionally needs the DM password.
- Request bodies are capped (4 MB); names, text and inboxes are length-capped; directory listings and the Python version are not exposed.
- Responses carry a strict Content-Security-Policy (no inline scripts; only Google/Apple for sign-in), `nosniff`, no framing, and HSTS behind the proxy.
- Logins, sign-ups, invite codes and DM passwords are rate-limited.
- Passwords are salted PBKDF2-SHA256; Google/Apple ID tokens are verified in standard-library code.

**Not covered:** what a member may see by design (teammates' teams, the NPC and wild libraries) and anyone you give your password to. Rotate a campaign's DM password and invite code from Settings → Campaign if they may have leaked.

New endpoints must follow these rules and ship with a test (`CampaignAuthorization` in `tests/test_server.py`).
