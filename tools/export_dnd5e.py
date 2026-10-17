"""
Builds the rules data the D&D 5e system needs (data/dnd5e/<edition>/*.json).

Source: the community-maintained 5e-database (https://github.com/5e-bits/5e-database),
which republishes the Systems Reference Document 5.1 ("2014" rules) and SRD 5.2
("2024" rules). Both SRDs are released by Wizards of the Coast under the
Creative Commons Attribution 4.0 International licence
(https://creativecommons.org/licenses/by/4.0/); the app credits them on its
D&D overview page and in sprites/README-style credits (see README.md).

The raw database is verbose (every cross-reference carries an API url, option
sets are nested four levels deep). This script flattens it into one small,
consistent shape per file so the browser can lazy-load just the pieces a page
needs, and so the front end never has to know which edition a field came from.

    python tools/export_dnd5e.py            # download (cached) and rebuild
    python tools/export_dnd5e.py --refresh  # ignore the download cache

Needs internet the first time only; raw downloads are cached in
.dnd5e_cache/ (git-ignored). The app itself never contacts the network.
"""
import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "dnd5e"
CACHE = ROOT / ".dnd5e_cache"
URL = "https://raw.githubusercontent.com/5e-bits/5e-database/main/src/{ed}/en/5e-SRD-{name}.json"

DATASETS = {
    "2014": ["Ability-Scores", "Alignments", "Backgrounds", "Classes", "Conditions", "Damage-Types",
             "Equipment-Categories", "Equipment", "Feats", "Features", "Languages", "Levels",
             "Magic-Items", "Magic-Schools", "Monsters", "Proficiencies", "Races", "Rule-Sections",
             "Rules", "Skills", "Spells", "Subclasses", "Subraces", "Traits", "Weapon-Properties"],
    "2024": ["Ability-Scores", "Alignments", "Backgrounds", "Classes", "Conditions", "Damage-Types",
             "Equipment-Categories", "Equipment", "Feats", "Features", "Languages", "Levels",
             "Magic-Items", "Magic-Schools", "Monsters", "Proficiencies", "Skills", "Spells",
             "Subclasses", "Species", "Traits", "Weapon-Properties", "Weapon-Mastery-Properties"],
}

ABIL = {"str": "STR", "dex": "DEX", "con": "CON", "int": "INT", "wis": "WIS", "cha": "CHA"}


# --------------------------------------------------------------------------- helpers

def log(msg):
    print(msg, flush=True)


def fetch(ed, name, refresh=False):
    CACHE.mkdir(exist_ok=True)
    path = CACHE / f"{ed}-{name}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    req = urllib.request.Request(URL.format(ed=ed, name=name), headers={"User-Agent": "pokemon-dnd-companion"})
    data = urllib.request.urlopen(req, timeout=90).read()
    path.write_bytes(data)
    return json.loads(data.decode("utf-8"))


def fix(s):
    """The source data has a few U+FFFD replacement characters where an
    apostrophe/dash was mangled; restore a sensible character."""
    if not isinstance(s, str):
        return s
    s = re.sub(r"(?<=[A-Za-z])�(?=[A-Za-z])", "’", s)
    s = s.replace("�", "’")
    return s.replace("--", "—") if " -- " in s or re.search(r"\w--\w", s) else s


def nm(x):
    """A {index,name,url} reference -> its display name."""
    if isinstance(x, dict):
        return fix(x.get("name") or x.get("index"))
    return fix(x)


def ix(x):
    return x.get("index") if isinstance(x, dict) else x


def names(lst):
    return [nm(i) for i in (lst or [])]


def paras(v):
    """Description text -> list of paragraph strings (markdown-lite)."""
    if v is None:
        return []
    if isinstance(v, str):
        out = [fix(p.strip()) for p in re.split(r"\n+", v)]
        return [p for p in out if p]
    return [fix(p.strip()) for p in v if isinstance(p, str) and p.strip()]


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")


def prune(o):
    """Drop empty values (None, [], {}, "") so files stay small."""
    if isinstance(o, dict):
        out = {k: prune(v) for k, v in o.items()}
        return {k: v for k, v in out.items() if v not in (None, [], {}, "")}
    if isinstance(o, list):
        return [prune(v) for v in o]
    return o


def write(ed, name, data):
    d = OUT / ed
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{name}.json"
    path.write_text(json.dumps(prune(data), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(f"  {ed}/{name}.json  {path.stat().st_size / 1024:7.1f} KB")


# --------------------------------------------------------------------------- spells

def conv_damage(dmg):
    if not dmg:
        return None
    entry = dmg if isinstance(dmg, dict) else (dmg[0] if dmg else None)
    if not entry:
        return None
    return {
        "type": nm(entry.get("damage_type")),
        "bySlot": entry.get("damage_at_slot_level"),
        "byLevel": entry.get("damage_at_character_level"),
    }


def conv_spells(ed, raw):
    out = []
    for s in raw:
        desc = paras(s.get("desc") if ed == "2014" else s.get("description"))
        entry = {
            "id": s["index"], "name": fix(s["name"]), "level": s["level"], "school": nm(s.get("school")),
            "castingTime": fix(s.get("casting_time")), "range": fix(s.get("range")),
            "components": s.get("components") or [], "material": fix(s.get("material")),
            "duration": fix(s.get("duration")), "concentration": bool(s.get("concentration")),
            "ritual": bool(s.get("ritual")), "classes": names(s.get("classes")),
            "desc": desc, "higherLevel": paras(s.get("higher_level")),
            "damage": conv_damage(s.get("damage")),
            "attack": s.get("attack_type"),
        }
        heal = s.get("heal_at_slot_level")
        if heal:
            entry["heal"] = heal
        dc = s.get("dc")
        if dc:
            entry["save"] = {"ability": nm(dc.get("dc_type")), "success": dc.get("dc_success")}
        area = s.get("area_of_effect")
        if area:
            entry["area"] = {"type": area.get("type"), "size": area.get("size")}
        out.append(entry)
    out.sort(key=lambda e: (e["level"], e["name"]))
    return out


# --------------------------------------------------------------------------- monsters

def usage_text(u):
    if not u:
        return None
    t = u.get("type")
    if t == "recharge on roll":
        lo = u.get("min_value", 6)
        return f"Recharge {lo}–6" if lo < 6 else "Recharge 6"
    if t == "per day":
        return f"{u.get('times', 1)}/Day"
    if t == "recharge after rest":
        return "Recharges after " + " or ".join(u.get("rest_types") or ["a rest"]).lower() + " rest"
    if t == "at will":
        return "At Will"
    return None


def conv_action(a):
    out = {"name": fix(a["name"]), "desc": fix(a.get("desc") or "")}
    if a.get("attack_bonus") is not None:
        out["attackBonus"] = a["attack_bonus"]
    dmg = []
    for d in a.get("damage") or []:
        if isinstance(d, dict) and d.get("damage_dice"):
            dmg.append({"dice": d["damage_dice"], "type": nm(d.get("damage_type"))})
        elif isinstance(d, dict) and d.get("choose"):
            pass  # "choose one damage type" (rare); the description text covers it
    if dmg:
        out["damage"] = dmg
    dc = a.get("dc")
    if dc:
        out["dc"] = {"ability": nm(dc.get("dc_type")), "value": dc.get("dc_value"), "success": dc.get("success_type")}
    u = usage_text(a.get("usage"))
    if u:
        out["usage"] = u
    return out


def conv_monsters(ed, raw):
    out = []
    for m in raw:
        saves, skills = {}, {}
        for p in m.get("proficiencies") or []:
            pn = nm(p.get("proficiency")) or ""
            if pn.startswith("Saving Throw:"):
                saves[pn.split(":", 1)[1].strip()] = p["value"]
            elif pn.startswith("Skill:"):
                skills[pn.split(":", 1)[1].strip()] = p["value"]
        ac = [{"value": a.get("value"), "type": a.get("type"), "desc": a.get("desc")} for a in (m.get("armor_class") or [])]
        legendary = [conv_action(a) for a in (m.get("legendary_actions") or [])]
        entry = {
            "id": m.get("index") or slug(m["name"]), "name": fix(m["name"]), "size": m.get("size"),
            "type": m.get("type"), "subtype": m.get("subtype"), "alignment": m.get("alignment"),
            "ac": ac, "hp": m.get("hit_points"), "hitDice": m.get("hit_dice"), "hpRoll": m.get("hit_points_roll"),
            "speed": m.get("speed") or {},
            "abilities": {
                "STR": m.get("strength"), "DEX": m.get("dexterity"), "CON": m.get("constitution"),
                "INT": m.get("intelligence"), "WIS": m.get("wisdom"), "CHA": m.get("charisma"),
            },
            "saves": saves, "skills": skills,
            "vulnerabilities": [fix(x) for x in m.get("damage_vulnerabilities") or []],
            "resistances": [fix(x) for x in m.get("damage_resistances") or []],
            "immunities": [fix(x) for x in m.get("damage_immunities") or []],
            "conditionImmunities": names(m.get("condition_immunities")),
            "senses": m.get("senses") or {}, "languages": fix(m.get("languages")),
            "cr": m.get("challenge_rating"), "pb": m.get("proficiency_bonus"), "xp": m.get("xp"),
            "xpInLair": m.get("xp_in_lair"),
            "traits": [],
            "actions": [conv_action(a) for a in (m.get("actions") or [])],
            "bonusActions": [conv_action(a) for a in (m.get("bonus_actions") or [])],
            "reactions": [conv_action(a) for a in (m.get("reactions") or [])],
            "legendary": legendary,
            "desc": fix(m.get("desc")),
        }
        for t in m.get("special_abilities") or []:
            tr = {"name": fix(t["name"]), "desc": fix(t.get("desc") or "")}
            u = usage_text(t.get("usage"))
            if u:
                tr["usage"] = u
            sc = t.get("spellcasting")
            if sc:
                tr["spellcasting"] = {
                    "ability": nm(sc.get("ability")), "dc": sc.get("dc"), "modifier": sc.get("modifier"),
                    "level": sc.get("level"), "slots": sc.get("slots"),
                    "spells": [{"name": fix(s.get("name")), "level": s.get("level"), "usage": s.get("usage")} for s in sc.get("spells") or []],
                }
            entry["traits"].append(tr)
        out.append(entry)
    out.sort(key=lambda e: e["name"])
    return out


# --------------------------------------------------------------------------- equipment & magic items

def item_ref(x):
    if isinstance(x, dict):
        return {"id": x.get("index"), "name": fix(x.get("name")), "note": x.get("note")}
    return {"name": fix(x)}


def conv_equipment(ed, raw):
    out = []
    for e in raw:
        if ed == "2014":
            cat = nm(e.get("equipment_category"))
            cats = [cat] + [nm(e.get(k)) for k in ("weapon_category", "armor_category", "tool_category", "gear_category", "vehicle_category") if e.get(k)]
            if e.get("category_range"):
                cats.append(e["category_range"])
            cats = [c for c in cats if isinstance(c, str)]
        else:
            cats = names(e.get("equipment_categories"))
        entry = {
            "id": e["index"], "name": fix(e["name"]), "categories": cats,
            "cost": {"q": (e.get("cost") or {}).get("quantity"), "u": (e.get("cost") or {}).get("unit")} if e.get("cost") else None,
            "weight": e.get("weight"),
            "desc": paras(e.get("desc") if ed == "2014" else e.get("description")),
        }
        # kind drives how the app treats the item (attacks, AC, ...)
        low = " ".join(cats).lower()
        if e.get("damage") or "weapon" in low and e.get("range"):
            entry["kind"] = "weapon"
            dmg = e.get("damage") or {}
            two = e.get("two_handed_damage") or {}
            rng = e.get("range") or {}
            props = names(e.get("properties"))
            wcat = e.get("weapon_category")
            wrange = e.get("weapon_range")
            if ed == "2024":
                wcat = "Martial" if "martial" in low else "Simple"
                wrange = "Ranged" if "ranged weapons" in low else "Melee"
            entry["weapon"] = {
                "category": wcat, "range": wrange,
                "damage": {"dice": dmg.get("damage_dice"), "type": nm(dmg.get("damage_type"))} if dmg else None,
                "versatile": two.get("damage_dice"),
                "reach": rng.get("normal"), "long": rng.get("long"),
                "throw": e.get("throw_range"),
                "properties": props,
                "mastery": nm(e.get("mastery")) if e.get("mastery") else None,
            }
        elif e.get("armor_class") is not None:
            entry["kind"] = "armor"
            ac = e["armor_class"]
            if ed == "2014":
                acat = e.get("armor_category")
            else:
                acat = "Shield" if "shields" in low else ("Heavy" if "heavy armor" in low else "Medium" if "medium armor" in low else "Light")
            entry["armor"] = {
                "category": acat, "base": ac.get("base"), "dexBonus": ac.get("dex_bonus"), "maxBonus": ac.get("max_bonus"),
                "strMin": e.get("str_minimum") or None, "stealthDisadvantage": bool(e.get("stealth_disadvantage")),
            }
            if ed == "2014" and acat == "Shield" or (ed == "2024" and acat == "Shield"):
                entry["armor"]["shield"] = True
        elif "tool" in low or "gaming" in low or "musical" in low or "artisan" in low:
            entry["kind"] = "tool"
        elif "pack" in low:
            entry["kind"] = "pack"
        elif "ammunition" in low:
            entry["kind"] = "ammo"
        elif "mount" in low or "vehicle" in low:
            entry["kind"] = "mount"
        else:
            entry["kind"] = "gear"
        if e.get("contents"):
            entry["contents"] = [{"id": ix(c.get("item")), "name": nm(c.get("item")), "qty": c.get("quantity")} for c in e["contents"]]
        if e.get("speed"):
            entry["speed"] = f"{e['speed'].get('quantity')} {e['speed'].get('unit')}"
        if e.get("capacity"):
            entry["capacity"] = fix(e["capacity"])
        if e.get("quantity"):
            entry["quantity"] = e["quantity"]
        out.append(entry)
    out.sort(key=lambda x: x["name"])
    return out


def conv_magic_items(ed, raw):
    out = []
    for m in raw:
        desc = paras(m.get("desc"))
        # 2024 text is one blob with soft line breaks; 2014 is already paragraphs
        if ed == "2024":
            desc = [p for chunk in desc for p in re.split(r"\s{2,}\n?", chunk) if p.strip()]
        head = desc[0] if desc else ""
        attune = None
        mt = re.search(r"requires attunement(?: by ([^)]*))?", head, re.I)
        if mt:
            attune = mt.group(1) or True
        elif ed == "2024" and m.get("attunement"):
            attune = True
        category = nm(m.get("equipment_category"))
        out.append({
            "id": m["index"], "name": fix(m["name"]), "category": category,
            "rarity": nm(m.get("rarity")), "attunement": attune,
            "desc": desc, "variant": bool(m.get("variant")),
        })
    out.sort(key=lambda x: x["name"])
    return out


# --------------------------------------------------------------------------- classes

def conv_choice_skills(choices):
    """class skill choices -> {choose, from:[skill names]}"""
    for c in choices or []:
        opts = (c.get("from") or {}).get("options") or []
        picks = []
        for o in opts:
            item = o.get("item")
            if isinstance(item, dict):
                n = item.get("name", "")
                picks.append(n.split(":", 1)[1].strip() if n.startswith("Skill:") else n)
        if picks:
            return {"choose": c.get("choose"), "from": picks}
    return None


def conv_equip_item(o):
    """one element inside a starting-equipment alternative"""
    t = o.get("option_type")
    if t == "counted_reference":
        of = o.get("of") or {}
        return {"id": of.get("index"), "name": fix(of.get("name")), "qty": o.get("count", 1), "note": of.get("note")}
    if t == "choice":
        ch = o.get("choice") or {}
        frm = ch.get("from") or {}
        cat = frm.get("equipment_category") or {}
        return {"category": cat.get("index"), "name": fix(ch.get("desc") or cat.get("name")), "qty": ch.get("choose", 1), "pick": True}
    if t == "money":
        return {"money": o.get("unit"), "qty": o.get("count")}
    if t == "reference":
        of = o.get("item") or {}
        return {"id": of.get("index"), "name": fix(of.get("name")), "qty": 1}
    return None


def conv_equip_options(opts):
    out = []
    for grp in opts or []:
        alts = []
        frm = grp.get("from") or {}
        if frm.get("option_set_type") == "equipment_category":
            cat = frm.get("equipment_category") or {}
            alts.append([{"category": cat.get("index"), "name": fix(grp.get("desc") or cat.get("name")), "qty": grp.get("choose", 1), "pick": True}])
        else:
            for o in frm.get("options") or []:
                if o.get("option_type") == "multiple":
                    alts.append([x for x in (conv_equip_item(i) for i in o.get("items") or []) if x])
                else:
                    x = conv_equip_item(o)
                    if x:
                        alts.append([x])
        out.append({"desc": fix(grp.get("desc")), "choose": grp.get("choose", 1), "alternatives": alts})
    return out


def conv_equip_fixed(lst):
    return [{"id": ix(e.get("equipment")), "name": nm(e.get("equipment")), "qty": e.get("quantity", 1)} for e in (lst or [])]


def prof_buckets(ed, profs, prof_types):
    """Split a class's proficiency refs into armor / weapons / tools by the
    Proficiencies dataset's own `type` field."""
    armor, weapons, tools = [], [], []
    for p in profs or []:
        n = nm(p)
        t = prof_types.get(ix(p), "")
        if n.startswith("Saving Throw"):
            continue
        if t == "Armor" or n in ("Shields",):
            armor.append(n)
        elif t == "Weapons":
            weapons.append(n)
        else:
            tools.append(n)
    return armor, weapons, tools


def conv_spellcasting_levels(ed, lv):
    sc = lv.get("spellcasting")
    if not sc:
        return None
    slots = [sc.get(f"spell_slots_level_{i}", 0) or 0 for i in range(1, 10)]
    return {
        "cantrips": sc.get("cantrips_known"), "known": sc.get("spells_known"), "prepared": sc.get("prepared_spells"),
        "slots": slots, "pactLevel": sc.get("spell_slots_level") if False else None,
    }


def feat_prereqs(f, spell_names, feat_names):
    """A feature's prerequisites (e.g. an invocation needing a cantrip, pact or level) as short strings."""
    out = []
    for p in f.get("prerequisites") or []:
        t = p.get("type")
        if t == "level":
            out.append(f"Level {p.get('level')}+")
        elif t == "spell":
            sid = str(p.get("spell", "")).rsplit("/", 1)[-1]
            out.append(f"{spell_names.get(sid, sid)} cantrip")
        elif t == "feature":
            fid = str(p.get("feature", "")).rsplit("/", 1)[-1]
            out.append(feat_names.get(fid, fid))
    return out


def conv_classes(ed, raw, levels, features, subclasses, prof_types, spell_names=None):
    spell_names = spell_names or {}
    feat_names = {f["index"]: f["name"] for f in features}
    children = {}
    for f in features:
        par = ix(f.get("parent"))
        if par:
            children.setdefault(par, []).append(f)

    def strip_prefix(name):
        return fix(name.split(": ", 1)[1]) if ": " in name else fix(name)

    def feat_obj(f, level):
        o = {"name": fix(f["name"]), "level": level,
             "desc": paras(f.get("desc") if ed == "2014" else f.get("description"))}
        fs = f.get("feature_specific") or {}
        kids = children.get(f["index"])
        if kids:
            o["options"] = [{"id": c["index"], "name": strip_prefix(c["name"]),
                             "desc": paras(c.get("desc")), "prereq": feat_prereqs(c, spell_names, feat_names)} for c in kids]
            o["choose"] = (fs.get("subfeature_options") or {}).get("choose")
        if fs.get("expertise_options"):
            eo = fs["expertise_options"]
            o["expertise"] = {"choose": eo.get("choose"), "from": [nm(i["item"]).split(":", 1)[-1].strip() for i in (eo.get("from") or {}).get("options", []) if i.get("item")]}
        for key, kind in (("enemy_type_options", "enemy"), ("terrain_type_options", "terrain")):
            if fs.get(key):
                o["pick"] = {"kind": kind, "choose": fs[key].get("choose", 1), "from": [str(x) for x in (fs[key].get("from") or {}).get("options", [])]}
        return o

    lv_by_class = {}
    for lv in levels:
        if lv.get("subclass"):
            continue
        cid = ix(lv.get("class"))
        lv_by_class.setdefault(cid, []).append(lv)
    feat_by_index = {f["index"]: f for f in features}

    out = []
    for c in raw:
        cid = c["index"]
        armor, weapons, tools = prof_buckets(ed, c.get("proficiencies"), prof_types)
        sc = c.get("spellcasting")
        spellcasting = None
        if sc:
            spellcasting = {
                "ability": nm(sc.get("spellcasting_ability")), "level": sc.get("level"),
                "info": [{"name": fix(i["name"]), "desc": paras(i.get("desc"))} for i in sc.get("info") or []],
            }
        mc = c.get("multi_classing") or {}
        reqs = [{"ability": nm(p.get("ability_score")), "min": p.get("minimum_score")} for p in mc.get("prerequisites") or []]
        mc_opts = mc.get("prerequisite_options")
        if mc_opts:  # e.g. "STR 13 or DEX 13"
            alts = [{"ability": nm(o.get("ability_score")), "min": o.get("minimum_score")} for o in ((mc_opts.get("from") or {}).get("options") or [])]
            reqs.append({"anyOf": alts})
        levels_out = []
        class_feats = {}
        for lv in sorted(lv_by_class.get(cid, []), key=lambda x: x["level"]):
            fids = []
            for f in lv.get("features") or []:
                fi = ix(f)
                full = feat_by_index.get(fi)
                fids.append(fi)
                if full and fi not in class_feats:
                    class_feats[fi] = feat_obj(full, lv["level"])
                elif fi not in class_feats:
                    class_feats[fi] = {"name": nm(f), "level": lv["level"], "desc": []}
            levels_out.append({
                "level": lv["level"], "pb": lv.get("prof_bonus"), "asi": lv.get("ability_score_bonuses"),
                "features": fids, "cs": lv.get("class_specific") or {},
                "sc": conv_spellcasting_levels(ed, lv),
            })
        subs = []
        for s in subclasses:
            if ix(s.get("class")) != cid:
                continue
            sfeats = []
            if ed == "2014":
                for f in features:
                    if ix(f.get("subclass")) == s["index"] and not f.get("parent"):
                        sfeats.append(feat_obj(f, f.get("level")))
            else:
                for f in s.get("features") or []:
                    sfeats.append({"name": fix(f["name"]), "level": f.get("level"), "desc": paras(f.get("description"))})
            sfeats.sort(key=lambda x: (x["level"] or 0, x["name"]))
            subs.append({
                "id": s["index"], "name": fix(s["name"]),
                "flavor": fix(s.get("subclass_flavor") or s.get("summary")),
                "desc": paras(s.get("desc") if ed == "2014" else s.get("description")),
                "features": sfeats,
                "spells": [{"level": next((int(re.search(r"(\d+)$", ix(p) or "0").group(1)) for p in sp.get("prerequisites") or [] if p.get("type") == "level"), None), "spell": nm(sp.get("spell"))} for sp in s.get("spells") or []],
            })
        out.append({
            "id": cid, "name": fix(c["name"]), "hitDie": c["hit_die"],
            "primaryAbility": fix((c.get("primary_ability") or {}).get("desc")) if ed == "2024" else None,
            "saves": names(c.get("saving_throws")),
            "armor": armor, "weapons": weapons, "tools": tools,
            "skills": conv_choice_skills(c.get("proficiency_choices")),
            "equipment": {"fixed": conv_equip_fixed(c.get("starting_equipment")), "options": conv_equip_options(c.get("starting_equipment_options"))},
            "spellcasting": spellcasting,
            "multiclass": {"requirements": reqs, "proficiencies": names(mc.get("proficiencies"))},
            "levels": levels_out, "features": class_feats, "subclasses": subs,
        })
    out.sort(key=lambda x: x["name"])
    return out


# --------------------------------------------------------------------------- races / species

def conv_options(opt):
    if not opt:
        return None
    frm = opt.get("from") or {}
    items = []
    for o in frm.get("options") or []:
        if o.get("option_type") == "ability_bonus":
            items.append({"ability": nm(o.get("ability_score")), "bonus": o.get("bonus")})
        elif o.get("item"):
            items.append(nm(o["item"]))
    return {"choose": opt.get("choose"), "from": items}


def conv_races_2014(raw, subraces, traits, prof_types):
    trait_by = {t["index"]: t for t in traits}

    def trait(t):
        full = trait_by.get(ix(t)) or {}
        tr = {"name": fix(nm(t)), "desc": paras(full.get("desc"))}
        ts = full.get("trait_specific") or {}
        if ts.get("subtrait_options"):
            tr["options"] = [nm(o["item"]) for o in ts["subtrait_options"]["from"]["options"]]
            tr["choose"] = ts["subtrait_options"].get("choose", 1)
        if ts.get("spell_options"):
            tr["spellOptions"] = {"choose": ts["spell_options"].get("choose", 1), "from": [nm(o["item"]) for o in ts["spell_options"]["from"]["options"]]}
        if full.get("proficiencies"):
            tr["proficiencies"] = names(full["proficiencies"])
        return tr

    out = []
    for r in raw:
        subs = []
        for s in subraces:
            if ix(s.get("race")) != r["index"]:
                continue
            subs.append({
                "id": s["index"], "name": fix(s["name"]), "desc": fix(s.get("desc")),
                "abilityBonuses": [{"ability": nm(b["ability_score"]), "bonus": b["bonus"]} for b in s.get("ability_bonuses") or []],
                "traits": [trait(t) for t in s.get("racial_traits") or []],
                "proficiencies": names(s.get("starting_proficiencies")),
                "languages": names(s.get("languages")),
                "languageChoices": conv_options(s.get("language_options")),
            })
        # Draconic ancestry sub-traits are listed by the main trait's options,
        # whose own descriptions carry the damage type and breath shape.
        traits_out = []
        for t in r.get("traits") or []:
            tt = trait(t)
            if tt.get("options"):
                tt["optionDetails"] = []
                for on in tt["options"]:
                    tf = next((x for x in traits if x["name"] == on), None)
                    if tf:
                        ts = tf.get("trait_specific") or {}
                        tt["optionDetails"].append({"name": on, "damageType": nm(ts.get("damage_type")) if ts.get("damage_type") else None, "desc": paras(tf.get("desc"))})
            traits_out.append(tt)
        out.append({
            "id": r["index"], "name": fix(r["name"]), "kind": "race", "size": r.get("size"), "speed": r.get("speed"),
            "sizeDesc": fix(r.get("size_description")), "ageDesc": fix(r.get("age")), "alignDesc": fix(r.get("alignment")),
            "abilityBonuses": [{"ability": nm(b["ability_score"]), "bonus": b["bonus"]} for b in r.get("ability_bonuses") or []],
            "abilityChoices": conv_options(r.get("ability_bonus_options")),
            "languages": names(r.get("languages")), "languageDesc": fix(r.get("language_desc")),
            "languageChoices": conv_options(r.get("language_options")),
            "proficiencies": names(r.get("starting_proficiencies")),
            "proficiencyChoices": conv_options(r.get("starting_proficiency_options")),
            "traits": traits_out, "subraces": subs,
        })
    out.sort(key=lambda x: x["name"])
    return out


def conv_species_2024(raw, traits):
    trait_by = {t["index"]: t for t in traits}
    out = []
    for r in raw:
        tr = []
        for t in r.get("traits") or []:
            full = trait_by.get(ix(t)) or {}
            tr.append({"name": fix(nm(t)), "desc": paras(full.get("description"))})
        out.append({
            "id": r["index"], "name": fix(r["name"]), "kind": "species", "type": r.get("type"),
            "size": r.get("size"), "speed": r.get("speed"),
            "abilityBonuses": [], "traits": tr,
            "subraces": [{"id": ix(s), "name": fix(nm(s)), "desc": "", "abilityBonuses": [], "traits": []} for s in r.get("subspecies") or []],
        })
    out.sort(key=lambda x: x["name"])
    return out


# --------------------------------------------------------------------------- backgrounds / feats / misc

def conv_pick_list(opt):
    """background personality/ideal/bond/flaw option sets -> [strings]"""
    if not opt:
        return []
    out = []
    for o in ((opt.get("from") or {}).get("options") or []):
        if o.get("option_type") == "string":
            out.append(fix(o.get("string")))
        elif o.get("option_type") == "ideal":
            out.append(fix(o.get("desc")))
    return out


def conv_backgrounds(ed, raw):
    out = []
    for b in raw:
        if ed == "2014":
            profs = [nm(p).split(":", 1)[-1].strip() for p in b.get("starting_proficiencies") or []]
            out.append({
                "id": b["index"], "name": fix(b["name"]), "skills": [p for p in profs],
                "languageChoices": (b.get("language_options") or {}).get("choose"),
                "equipment": conv_equip_fixed(b.get("starting_equipment")),
                "equipmentOptions": conv_equip_options(b.get("starting_equipment_options")),
                "gold": (b.get("starting_gold") or {}).get("quantity"),
                "feature": {"name": fix((b.get("feature") or {}).get("name")), "desc": paras((b.get("feature") or {}).get("desc"))},
                "personalityTraits": conv_pick_list(b.get("personality_traits")),
                "ideals": conv_pick_list(b.get("ideals")), "bonds": conv_pick_list(b.get("bonds")), "flaws": conv_pick_list(b.get("flaws")),
            })
        else:
            profs = [nm(p) for p in b.get("proficiencies") or []]
            out.append({
                "id": b["index"], "name": fix(b["name"]),
                "skills": [p.split(":", 1)[1].strip() for p in profs if p.startswith("Skill:")],
                "tools": [p.split(":", 1)[1].strip() for p in profs if p.startswith("Tool:")],
                "abilityScores": names(b.get("ability_scores")),
                "feat": {"id": ix(b.get("feat")), "name": nm(b.get("feat")), "note": (b.get("feat") or {}).get("note")} if b.get("feat") else None,
                "equipmentOptions": conv_equip_options(b.get("equipment_options")),
            })
    out.sort(key=lambda x: x["name"])
    return out


def conv_feats(ed, raw):
    out = []
    for f in raw:
        prereq = []
        pr = f.get("prerequisites")
        if isinstance(pr, dict):  # 2024: {"minimum_level": 4}
            if pr.get("minimum_level"):
                prereq.append(f"Level {pr['minimum_level']}+")
        else:
            for p in pr or []:
                prereq.append(f"{nm(p.get('ability_score'))} {p.get('minimum_score')}+")
        opt = f.get("prerequisite_options")
        if isinstance(opt, dict) and opt.get("desc"):
            prereq.append(fix(opt["desc"]))
        out.append({
            "id": f["index"], "name": fix(f["name"]), "type": f.get("type"),
            "prerequisite": ", ".join(prereq) or None,
            "repeatable": fix(f.get("repeatable")) if isinstance(f.get("repeatable"), str) else None,
            "desc": paras(f.get("desc") if ed == "2014" else f.get("description")),
        })
    out.sort(key=lambda x: x["name"])
    return out


def conv_conditions(ed, raw):
    return [{"id": c["index"], "name": fix(c["name"]), "desc": paras(c.get("desc") if ed == "2014" else c.get("description"))} for c in raw]


def conv_skills(ed, raw):
    return [{"id": s["index"], "name": fix(s["name"]), "ability": nm(s.get("ability_score")),
             "desc": paras(s.get("desc") if ed == "2014" else s.get("description"))} for s in raw]


def conv_reference(ed, d):
    ref = {
        "abilityScores": [{"id": a["index"], "abbr": a["name"], "name": fix(a.get("full_name") or a["name"]),
                           "desc": paras(a.get("desc") if ed == "2014" else a.get("description")),
                           "skills": names(a.get("skills"))} for a in d["Ability-Scores"]],
        "alignments": [{"name": fix(a["name"]), "abbr": a.get("abbreviation"), "desc": fix(a.get("desc") or a.get("description"))} for a in d["Alignments"]],
        "damageTypes": [{"name": fix(a["name"]), "desc": paras(a.get("desc") if ed == "2014" else a.get("description"))} for a in d["Damage-Types"]],
        "schools": [{"name": fix(a["name"]), "desc": fix(a.get("desc") or a.get("description"))} for a in d["Magic-Schools"]],
        "weaponProperties": [{"name": fix(a["name"]), "desc": paras(a.get("desc") if ed == "2014" else a.get("description"))} for a in d["Weapon-Properties"]],
        "languages": [{"name": fix(a["name"]), "type": a.get("type"), "script": a.get("script"), "speakers": a.get("typical_speakers")} for a in d["Languages"]],
    }
    if "Weapon-Mastery-Properties" in d:
        ref["masteries"] = [{"name": fix(a["name"]), "desc": paras(a.get("description"))} for a in d["Weapon-Mastery-Properties"]]
    return ref


def conv_categories(raw):
    return {c["index"]: {"name": fix(c["name"]), "items": [ix(i) for i in c.get("equipment") or []]} for c in raw}


def conv_rules(rules, sections):
    sec_by = {s["index"]: s for s in sections}
    cats = []
    used = set()
    for r in rules:
        ids = [s["index"] for s in r.get("subsections") or [] if s["index"] in sec_by]
        used.update(ids)
        cats.append({"id": r["index"], "name": fix(r["name"]), "sections": ids})
    orphan = [i for i in sec_by if i not in used]
    if orphan:
        cats.append({"id": "other", "name": "Other", "sections": orphan})
    return {"categories": cats, "sections": {i: {"name": fix(s["name"]), "md": fix(s.get("desc") or "")} for i, s in sec_by.items()}}


# --------------------------------------------------------------------------- main

def build(ed, refresh):
    log(f"== {ed} rules ==")
    d = {n: fetch(ed, n, refresh) for n in DATASETS[ed]}
    prof_types = {p["index"]: p.get("type") for p in d["Proficiencies"]}

    write(ed, "spells", conv_spells(ed, d["Spells"]))
    write(ed, "monsters", conv_monsters(ed, d["Monsters"]))
    write(ed, "equipment", conv_equipment(ed, d["Equipment"]))
    write(ed, "magicItems", conv_magic_items(ed, d["Magic-Items"]))
    write(ed, "classes", conv_classes(ed, d["Classes"], d["Levels"], d["Features"], d["Subclasses"], prof_types, {x["index"]: x["name"] for x in d["Spells"]}))
    if ed == "2014":
        write(ed, "races", conv_races_2014(d["Races"], d["Subraces"], d["Traits"], prof_types))
        write(ed, "rules", conv_rules(d["Rules"], d["Rule-Sections"]))
    else:
        write(ed, "races", conv_species_2024(d["Species"], d["Traits"]))
    write(ed, "backgrounds", conv_backgrounds(ed, d["Backgrounds"]))
    write(ed, "feats", conv_feats(ed, d["Feats"]))
    write(ed, "conditions", conv_conditions(ed, d["Conditions"]))
    write(ed, "skills", conv_skills(ed, d["Skills"]))
    write(ed, "reference", conv_reference(ed, d))
    write(ed, "categories", conv_categories(d["Equipment-Categories"]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-download instead of using .dnd5e_cache/")
    ap.add_argument("--edition", choices=["2014", "2024"], help="only rebuild one edition")
    args = ap.parse_args()
    for ed in ([args.edition] if args.edition else ["2014", "2024"]):
        build(ed, args.refresh)
    log("Done.")


if __name__ == "__main__":
    sys.exit(main())
