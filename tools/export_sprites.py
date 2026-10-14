"""
Downloads a front and back battle sprite for every Pokémon in data/pokemon.json
into app/sprites/front/{dex}.png and app/sprites/back/{dex}.png, so the app's
Battle view can show real sprite art without needing internet access once
it's been run (same "export once, run offline" pattern as export_data.py and
export_items.py).

Why this works with a flat {dex}.png request: the "dex" field in
pokemon.json is not just the National Dex number for base species — for
Mega Evolutions, regional forms, and Gigantamax forms it's the exact
PokeAPI resource id for that specific form (e.g. 10034 = Mega Charizard X),
carried over from whenever the spreadsheet's Base Stats sheet was originally
built from PokeAPI. PokeAPI's own sprite repo is keyed by that same id, so
a single {dex}.png lookup — no name-to-slug guessing — covers base species
and every alternate form already in the dex.

Run this again any time pokemon.json changes (new dex entries added):
    python export_sprites.py

Safe to re-run: already-downloaded files are skipped, so an interrupted run
just picks up where it left off.
"""
import json
import sys
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POKEMON_JSON = ROOT / "data" / "pokemon.json"
FRONT_DIR = ROOT / "sprites" / "front"
BACK_DIR = ROOT / "sprites" / "back"
BASE_URL = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon"
WORKERS = 12


def log(msg):
    print(msg, flush=True)


def fetch(url, dest):
    if dest.exists():
        return "skip"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "pokemon-dnd-app/1.0"})
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
    if not POKEMON_JSON.exists():
        log(f"{POKEMON_JSON} not found — run export_data.py first.")
        sys.exit(1)

    FRONT_DIR.mkdir(parents=True, exist_ok=True)
    BACK_DIR.mkdir(parents=True, exist_ok=True)

    pokemon = json.loads(POKEMON_JSON.read_text(encoding="utf-8"))
    dexes = sorted({p["dex"] for p in pokemon if p.get("dex") is not None})
    log(f"Fetching sprites for {len(dexes)} dex entries with {WORKERS} workers...")

    jobs = []
    for dex in dexes:
        jobs.append((f"{BASE_URL}/{dex}.png", FRONT_DIR / f"{dex}.png"))
        jobs.append((f"{BASE_URL}/back/{dex}.png", BACK_DIR / f"{dex}.png"))

    counts = {"ok": 0, "skip": 0, "missing": 0, "error": 0}
    missing_dexes = []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        future_to_job = {pool.submit(fetch, url, dest): (url, dest) for url, dest in jobs}
        done = 0
        for future in as_completed(future_to_job):
            url, dest = future_to_job[future]
            result = future.result()
            done += 1
            if result == "ok":
                counts["ok"] += 1
            elif result == "skip":
                counts["skip"] += 1
            elif result == "missing":
                counts["missing"] += 1
                missing_dexes.append(dest.stem + ("+back" if "back" in str(dest.parent) else ""))
            else:
                counts["error"] += 1
                log(f"  {result} ({url})")
            if done % 200 == 0:
                log(f"  ...{done}/{len(jobs)}")

    log(f"Done. Downloaded {counts['ok']}, already had {counts['skip']}, "
        f"no sprite available for {counts['missing']}, {counts['error']} errors.")
    if missing_dexes:
        log(f"Entries with no sprite (front and/or back missing on PokeAPI): {len(missing_dexes)} "
            f"— the app falls back to a placeholder icon for these.")


if __name__ == "__main__":
    main()
