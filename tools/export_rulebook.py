"""Exports the Pokemon D&D rulebook from the Obsidian vault to data/pokemon-dnd/rulebook.json.

The site only serves css/js/data/sprites/assets and blocks .md/.txt files, so the rulebook ships as JSON
(the Markdown text of each page plus a little metadata), rendered in the browser by js/markdown.js.

    python tools/export_rulebook.py                       # vault at ../Pokemon DND Vault
    python tools/export_rulebook.py "D:/path/to/vault"    # or point at it

Re-run whenever the rulebook changes, then redeploy data/pokemon-dnd/rulebook.json.
"""
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "pokemon-dnd" / "rulebook.json"
DEFAULT_VAULT = ROOT.parent / "Pokemon DND Vault"


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def split_front_matter(text):
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?", text, re.S)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip().strip("[]")
    return meta, text[m.end():]


def main():
    vault = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_VAULT
    folder = vault / "Rulebook"
    if not folder.is_dir():
        sys.exit(f"Can't find {folder}. Pass the vault path as the first argument.")
    pages = []
    for i, path in enumerate(sorted(folder.glob("*.md"))):
        raw = path.read_text(encoding="utf-8")
        meta, body = split_front_matter(raw)
        # the contents page is a dataview query in Obsidian; the app builds that list itself
        body = re.sub(r"```dataview.*?```", "::contents::", body, flags=re.S)
        title_match = re.search(r"^#\s+(.+)$", body, re.M)
        heading = title_match.group(1).strip() if title_match else path.stem
        # split a leading emoji off the title so it can be used as an icon
        em = re.match(r"^([^\w\s]+)\s*(.*)$", heading)
        icon, title = (em.group(1), em.group(2)) if em else ("", heading)
        name = path.stem
        pages.append({
            "id": slug(re.sub(r"^\d+\s*", "", name)) or f"page-{i}",
            "file": name,
            "order": i,
            "title": title,
            "icon": icon,
            "tags": [t.strip() for t in meta.get("tags", "").split(",") if t.strip()],
            "md": body.strip() + "\n",
        })
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"title": "Pokémon D&D Rulebook", "exported": time.strftime("%Y-%m-%d"), "pages": pages}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {OUT} ({len(pages)} pages, {OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
