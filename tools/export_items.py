"""
Builds data/items.json — the held-item database backing the Item slots in
the Damage Calculator's autofill/autocomplete field — and data/mega_forms.json,
the stone -> Mega Evolution mapping used by the DM's Full Turn console.

Pulls every item tagged "holdable-active" on PokeAPI (things a Pokemon can
hold that actually do something in battle: Berries, Choice items, type
plates, incense, etc. — excludes Poke Balls, key items, evolution stones
and other holdable-but-battle-irrelevant items), plus the 47 real Mega
Stones (matching the "Mega X" entries already in data/pokemon.json — not
PokeAPI's full mega-stones category, which also includes a lot of fan-made
stones for Pokemon that never got an official Mega Evolution). Results are
cached in .pokeapi_item_cache/ one folder up, next to the existing
.pokeapi_cache/ used for per-Pokemon data, so re-runs are instant and don't
re-hit the API.

Run:
    python export_items.py       (Windows)
    python3 export_items.py      (Mac)

Needs the `requests` package (pip install requests) and an internet
connection. Only needed to rebuild/refresh the item list — the app itself
just reads the resulting data/items.json, no network needed at runtime.
"""
import json
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent.parent
OUT = Path(__file__).resolve().parent.parent / "data"
CACHE_DIR = ROOT / ".pokeapi_item_cache"
ATTRIBUTE_URL = "https://pokeapi.co/api/v2/item-attribute/holdable-active"

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "PokemonDnD-ItemsBuilder/1.0"})


def log(msg):
    print(msg, flush=True)


def fetch_json(url, retries=4):
    for attempt in range(retries):
        try:
            resp = SESSION.get(url, timeout=20)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            if attempt == retries - 1:
                log(f"  WARNING: failed to fetch {url}: {e}")
            time.sleep(1.5 * (attempt + 1))
    return None


def get_item(slug):
    CACHE_DIR.mkdir(exist_ok=True)
    cache_path = CACHE_DIR / f"{slug}.json"
    if cache_path.exists():
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError:
            pass
    data = fetch_json(f"https://pokeapi.co/api/v2/item/{slug}")
    if data is not None:
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    return data


def english(entries, key):
    for e in entries:
        if e["language"]["name"] == "en":
            return e.get(key, "")
    return ""


# Mega stone -> (base species, resulting Mega form) exactly matching the
# "Mega X" entries already present in data/pokemon.json (dex 10033+) — kept
# to only these 47 rather than trusting PokeAPI's full "mega-stones"
# category, which also lists a bunch of fan-made stones (e.g.
# "meganiumite", "emboarite") for Pokemon that never got an official Mega
# Evolution and have no matching entry in this dex. Rayquaza's Mega form
# is excluded on purpose: it's triggered by knowing Dragon Ascent, not a
# held stone.
MEGA_STONES = [
    ("venusaurite", "Venusaur", "Mega Venusaur"),
    ("charizardite-x", "Charizard", "Mega Charizard X"),
    ("charizardite-y", "Charizard", "Mega Charizard Y"),
    ("blastoisinite", "Blastoise", "Mega Blastoise"),
    ("beedrillite", "Beedrill", "Mega Beedrill"),
    ("pidgeotite", "Pidgeot", "Mega Pidgeot"),
    ("alakazite", "Alakazam", "Mega Alakazam"),
    ("slowbronite", "Slowbro", "Mega Slowbro"),
    ("gengarite", "Gengar", "Mega Gengar"),
    ("kangaskhanite", "Kangaskhan", "Mega Kangaskhan"),
    ("pinsirite", "Pinsir", "Mega Pinsir"),
    ("gyaradosite", "Gyarados", "Mega Gyarados"),
    ("aerodactylite", "Aerodactyl", "Mega Aerodactyl"),
    ("mewtwonite-x", "Mewtwo", "Mega Mewtwo X"),
    ("mewtwonite-y", "Mewtwo", "Mega Mewtwo Y"),
    ("ampharosite", "Ampharos", "Mega Ampharos"),
    ("steelixite", "Steelix", "Mega Steelix"),
    ("scizorite", "Scizor", "Mega Scizor"),
    ("heracronite", "Heracross", "Mega Heracross"),
    ("houndoominite", "Houndoom", "Mega Houndoom"),
    ("tyranitarite", "Tyranitar", "Mega Tyranitar"),
    ("sceptilite", "Sceptile", "Mega Sceptile"),
    ("blazikenite", "Blaziken", "Mega Blaziken"),
    ("swampertite", "Swampert", "Mega Swampert"),
    ("gardevoirite", "Gardevoir", "Mega Gardevoir"),
    ("sablenite", "Sableye", "Mega Sableye"),
    ("mawilite", "Mawile", "Mega Mawile"),
    ("aggronite", "Aggron", "Mega Aggron"),
    ("medichamite", "Medicham", "Mega Medicham"),
    ("manectite", "Manectric", "Mega Manectric"),
    ("sharpedonite", "Sharpedo", "Mega Sharpedo"),
    ("cameruptite", "Camerupt", "Mega Camerupt"),
    ("altarianite", "Altaria", "Mega Altaria"),
    ("banettite", "Banette", "Mega Banette"),
    ("absolite", "Absol", "Mega Absol"),
    ("glalitite", "Glalie", "Mega Glalie"),
    ("salamencite", "Salamence", "Mega Salamence"),
    ("metagrossite", "Metagross", "Mega Metagross"),
    ("latiasite", "Latias", "Mega Latias"),
    ("latiosite", "Latios", "Mega Latios"),
    ("lopunnite", "Lopunny", "Mega Lopunny"),
    ("garchompite", "Garchomp", "Mega Garchomp"),
    ("lucarionite", "Lucario", "Mega Lucario"),
    ("abomasite", "Abomasnow", "Mega Abomasnow"),
    ("galladite", "Gallade", "Mega Gallade"),
    ("audinite", "Audino", "Mega Audino"),
    ("diancite", "Diancie", "Mega Diancie"),
]


def main():
    log("Fetching held-item list from PokeAPI (holdable-active)...")
    attr = fetch_json(ATTRIBUTE_URL)
    if not attr:
        log("ERROR: couldn't reach PokeAPI. Check your internet connection.")
        sys.exit(1)
    slugs = sorted(i["name"] for i in attr["items"])
    log(f"  {len(slugs)} items")

    items = []
    t0 = time.time()
    for i, slug in enumerate(slugs):
        data = get_item(slug)
        if not data:
            continue
        name = english(data.get("names", []), "name") or slug.replace("-", " ").title()
        effect = english(data.get("effect_entries", []), "short_effect")
        category = (data.get("category") or {}).get("name", "")
        items.append({"name": name, "effect": effect, "category": category})
        if (i + 1) % 40 == 0:
            log(f"  [{i + 1}/{len(slugs)}] {time.time() - t0:.0f}s elapsed")

    log(f"Fetching {len(MEGA_STONES)} Mega Stones...")
    mega_forms = []
    for slug, species, mega_name in MEGA_STONES:
        data = get_item(slug)
        stone_name = english(data.get("names", []), "name") if data else slug.replace("-", " ").title()
        effect = english(data.get("effect_entries", []), "short_effect") if data else f"Allows {species} to Mega Evolve into {mega_name}."
        items.append({"name": stone_name, "effect": effect, "category": "mega-stones"})
        mega_forms.append({"stoneName": stone_name, "speciesName": species, "megaFormName": mega_name})

    items.sort(key=lambda x: x["name"])

    OUT.mkdir(exist_ok=True)
    out_path = OUT / "items.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, separators=(",", ":"))
    log(f"Wrote {out_path} ({len(items)} items, {out_path.stat().st_size / 1024:.0f} KB)")

    mega_path = OUT / "mega_forms.json"
    with open(mega_path, "w", encoding="utf-8") as f:
        json.dump(mega_forms, f, ensure_ascii=False, separators=(",", ":"))
    log(f"Wrote {mega_path} ({len(mega_forms)} Mega Evolutions)")


if __name__ == "__main__":
    main()
