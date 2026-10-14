"""
Downloads every trainer sprite from Pokémon Showdown's public sprite
directory (https://play.pokemonshowdown.com/sprites/trainers/) into
app/sprites/trainers/, so trainers can pick a portrait for their character
sheet and the DM can pick one for an NPC — same "export once, run offline"
pattern as export_data.py / export_items.py / export_sprites.py.

Showdown's own directory notice: "Many of these sprites are not from the
games. Credit must be given to the appropriate artist if used elsewhere."
This app is for personal/private table use, not redistribution, but if you
ever do share something built from these, check
https://play.pokemonshowdown.com/sprites/trainers/credits for the artist
credits first.

Run this again any time you want to pick up newly added sprites:
    python export_trainer_sprites.py

Safe to re-run: already-downloaded files are skipped, so an interrupted run
just picks up where it left off.
"""
import re
import sys
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "sprites" / "trainers"
INDEX_URL = "https://play.pokemonshowdown.com/sprites/trainers/?view=dir"
BASE_URL = "https://play.pokemonshowdown.com/sprites/trainers"
WORKERS = 8
HEADERS = {"User-Agent": "pokemon-dnd-app/1.0 (personal tabletop companion, non-commercial)"}


def log(msg):
    print(msg, flush=True)


def list_sprite_files():
    req = urllib.request.Request(INDEX_URL, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as resp:
        html = resp.read().decode("utf-8", errors="replace")
    # The directory listing links each file as href="./name.png" (or just
    # "name.png") — grab the filename part regardless of the "./" prefix.
    names = sorted(set(re.findall(r'href="(?:\./)?([^"/?]+\.png)"', html)))
    return names


def fetch(name, dest):
    if dest.exists():
        return "skip"
    try:
        req = urllib.request.Request(f"{BASE_URL}/{name}", headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
        dest.write_bytes(data)
        return "ok"
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return "missing"
        return f"error: {e}"
    except Exception as e:
        return f"error: {e}"


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    log("Fetching the trainer sprite directory listing...")
    try:
        names = list_sprite_files()
    except Exception as e:
        log(f"Couldn't reach Showdown ({e}) — check your internet connection.")
        sys.exit(1)
    log(f"Found {len(names)} trainer sprites. Downloading with {WORKERS} workers...")

    counts = {"ok": 0, "skip": 0, "missing": 0, "error": 0}
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        future_to_name = {pool.submit(fetch, name, OUT_DIR / name): name for name in names}
        done = 0
        for future in as_completed(future_to_name):
            name = future_to_name[future]
            result = future.result()
            done += 1
            if result in counts:
                counts[result] += 1
            else:
                counts["error"] += 1
                log(f"  {result} ({name})")
            if done % 200 == 0:
                log(f"  ...{done}/{len(names)}")

    log(f"Done. Downloaded {counts['ok']}, already had {counts['skip']}, "
        f"{counts['missing']} missing, {counts['error']} errors.")


if __name__ == "__main__":
    main()
