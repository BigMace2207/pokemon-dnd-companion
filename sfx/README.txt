Sound effects are private to a single campaign and are not part of the repo.

Put .mp3 files in sfx/<campaign id>/ on the server. Only that campaign's
signed-in members can list or play them (through /api/sfx); the folder is
never served as static files. Set PKDND_SFX_DIR to keep them somewhere else.
The campaign id is shown by the server's campaign list (it is the hex
folder-style id in the save file).
