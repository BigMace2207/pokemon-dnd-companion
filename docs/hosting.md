# Hosting

The server is one Python file with no third-party packages (Python 3.10+).

```bash
python server.py [port]        # default 8850
```

For a public server, bind to loopback and put an HTTPS proxy (Caddy, nginx) in front.

| Variable | Purpose |
| --- | --- |
| `PKDND_BIND` | Listen address. Use `127.0.0.1` behind a proxy. |
| `PKDND_TRUST_PROXY=1` | Trust `X-Forwarded-For`. Only safe when bound to loopback behind a proxy. |
| `PKDND_BACKUP_DIR` | Backup folder. Keep it outside the app directory so a redeploy can't touch it. |
| `PKDND_BACKUP_INTERVAL` | Seconds between backups (default one hour). |
| `PKDND_GOOGLE_CLIENT_ID` | Enables Google sign-in (a free OAuth Web client ID; add your site under Authorized JavaScript origins). |
| `PKDND_APPLE_CLIENT_ID` | Enables Apple sign-in (a Services ID; needs a paid Apple Developer account). |
| `PKDND_DATA_DIR` | Folder for the save file and default backups (default: next to `server.py`). Used by `tools/test_server.py`. |
| `PKDND_LEGACY_DM_PASSWORD` | Migration aid for campaigns created before DM passwords were per-campaign. |

The Google and Apple buttons only appear when the matching variable is set.

## Saves

All campaigns, player saves and accounts live in one file, `.server_state.dat`, autosaved and flushed on shutdown. It is lightly obfuscated, not encrypted, and is never served over HTTP.

## Automatic backups

- A snapshot is taken every hour and the newest 6 are kept.
- A snapshot is skipped when nothing changed, so a quiet server keeps its older history. An empty state never rotates good backups out.
- Files are `backup-YYYYMMDD-HHMMSS.dat` (UTC). Only those are rotated; other files in the folder are left alone.
- If the save can't be read at startup, the server keeps a copy as `unreadable-*.dat` and recovers from the newest readable backup.
- Restore: stop the server, copy the backup over `.server_state.dat`, start it again.
- Backups live on the same machine, so copy the folder elsewhere now and then.

## Deploying updates

Static files (`css/`, `js/`, `index.html`) can simply be copied over. Changes to `server.py` or `auth.py` need a restart. Copy the save file before anything risky.

## Accounts

Email and password, or Google/Apple where configured. Passwords are salted PBKDF2-SHA256 (600k iterations); sessions last 30 days. There is no password-reset email. Signing in on a new device adopts the account's identity; any trainer already on that device is kept as a named save, and nothing is deleted or overwritten.
