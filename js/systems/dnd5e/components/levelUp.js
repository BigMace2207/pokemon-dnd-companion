// Level-up dialog: pick the class to advance, take average or rolled HP, then resolve
// whatever the new level asks for (ability score improvement / feat, subclass, choices).

import { el, modal, field, selectEl, numInput, btn, toast, section } from "../ui.js";
import { addLevel, asiPending, subclassPending, pendingChoices, classLevel, totalLevel, classIds, derive } from "../engine/character.js";
import { ABILITIES, averageHp } from "../engine/rules.js";
import { roll } from "../engine/dice.js";
import { loadSet } from "../data.js";
import { pickOne } from "./choiceUi.js";
import { renderDesc } from "../../../markdown.js";
import { openFeatureChoice } from "./featureChoice.js";

export function openLevelUp(S) {
  const { char, ctx } = S;
  if (totalLevel(char) >= 20) { toast("Already level 20.", "bad"); return; }
  const own = classIds(char);
  const all = [...ctx.classes.values()];
  const options = [...own.map((id) => [id, `${className(S, id)} (level ${classLevel(char, id)} → ${classLevel(char, id) + 1})`]),
    ...all.filter((c) => !own.includes(c.id)).map((c) => [c.id, `${c.name} (multiclass, new)`])];
  if (!options.length) { toast("Create a class first.", "bad"); return; }
  let classId = options[0][0];
  let method = "average";
  let manual = null;
  const info = el("p", { class: "dnd-small dnd-muted" });
  const manualIn = numInput(null, (v) => { manual = v; }, { min: 1, max: 20, ariaLabel: "HP rolled" });
  manualIn.hidden = true;
  const sel = selectEl(options, classId, (v) => { classId = v; drawInfo(); });
  const meth = selectEl([["average", "Take the average"], ["roll", "Roll the hit die"], ["manual", "Enter a value"]], method, (v) => { method = v; manualIn.hidden = v !== "manual"; drawInfo(); });
  const die = () => ctx.classes.get(classId)?.hitDie || char.customClasses?.[classId]?.hitDie || 8;
  function drawInfo() {
    const lvl = classLevel(char, classId) + 1;
    const first = totalLevel(char) === 0;
    info.textContent = `Hit die d${die()}. ${first ? "First level always takes the maximum." : method === "average" ? `Average gain: ${averageHp(die())} + CON modifier.` : ""} New ${className(S, classId)} level: ${lvl}.${lvl >= 2 && !own.includes(classId) ? " Multiclassing needs 13 in the class's ability — check your book." : ""}`;
  }
  drawInfo();
  modal({
    title: `Level up to ${totalLevel(char) + 1}`,
    body: [field("Advance in", sel), field("Hit points", meth), manualIn, info],
    actions: [{ label: "Cancel" }, {
      label: "Level up", cls: "btn", onClick: () => {
        let hp = null;
        if (method === "roll") hp = roll(`1d${die()}`).total;
        else if (method === "manual") { if (!manual) { toast("Enter the HP you rolled.", "bad"); return false; } hp = Math.max(1, Math.min(die(), manual)); }
        addLevel(char, classId, hp);
        const before = S.d.hpMax;
        // the HP gained is added to current HP too, so levelling up doesn't leave you hurt
        if (char.hp.current != null) char.hp.current += Math.max(0, derive(char, ctx).hpMax - before);
        S.commit();
        toast(`Level ${totalLevel(char)}! +${S.d.hpMax - before} max HP.`, "good");
        setTimeout(() => openPending(S), 60);
      },
    }],
  });
}

function className(S, id) {
  return S.ctx.classes.get(id)?.name || S.char.customClasses?.[id]?.name || id;
}

// The to-do list after levelling: ASI/feat, subclass, and feature choices.
export function openPending(S) {
  const { char, ctx } = S;
  if (subclassPending(char, ctx).length) return openSubclass(S, subclassPending(char, ctx)[0]);
  if (asiPending(char)) return openAsi(S);
  const pend = pendingChoices(char, ctx);
  if (pend.length) return openFeatureChoice(S, pend[0].feature, () => setTimeout(() => openPending(S), 60));
  toast("Nothing left to resolve.", "good");
  return null;
}

function openSubclass(S, classId) {
  const { char, ctx } = S;
  const cls = ctx.classes.get(classId);
  const subs = cls?.subclasses || [];
  if (!subs.length) { toast("No SRD subclass for that class — add yours on the Features tab.", ""); return; }
  let pick = subs[0].id;
  const detail = el("div", { class: "dnd-pick-detail-box" });
  const show = (id) => { const s = subs.find((x) => x.id === id); detail.replaceChildren(el("h4", {}, s.name), el("p", { class: "dnd-small dnd-muted" }, s.flavor || ""), renderDesc(s.desc || [])); };
  show(pick);
  const list = pickOne(subs.map((s) => ({ value: s.id, label: s.name, sub: s.flavor })), pick, (v) => { pick = v; show(v); });
  modal({
    title: `Choose your ${cls.name} subclass`, wide: true,
    body: [list, detail],
    actions: [{ label: "Later" }, {
      label: "Choose", cls: "btn", onClick: () => { char.subclasses[classId] = pick; S.commit(); setTimeout(() => openPending(S), 60); },
    }],
  });
}

async function openAsi(S) {
  const { char } = S;
  const picks = { mode: "asi", a: "STR", b: "", feat: "" };
  const { list: feats } = await loadSet(char.edition, "feats");
  const host = el("div", { class: "dnd-stack" });
  const scoreOf = (k) => S.d.scores[k]?.score ?? 10;
  function draw() {
    const mode = el("div", { class: "dnd-segment", role: "group", "aria-label": "Improvement type" }, [["asi", "Ability scores"], ["feat", "Feat"]].map(([m, l]) => {
      const b = el("button", { type: "button", class: picks.mode === m ? "on" : "" }, l);
      b.addEventListener("click", () => { picks.mode = m; draw(); });
      return b;
    }));
    const abOpts = (cur) => ABILITIES.map((a) => [a.key, `${a.name} (${scoreOf(a.key)})`]);
    const body = picks.mode === "asi"
      ? [
        el("p", { class: "dnd-small dnd-muted" }, "Add 2 to one score, or 1 to two different scores. Scores cap at 20."),
        field("First", selectEl(abOpts(), picks.a, (v) => { picks.a = v; })),
        field("Second (optional — leave as “Same” for +2)", selectEl([["", "Same (+2)"], ...abOpts()], picks.b, (v) => { picks.b = v; })),
      ]
      : [
        field("Feat", selectEl([["", "— pick a feat —"], ...feats.map((f) => [f.id, f.name])], picks.feat, (v) => { picks.feat = v; showFeat(); })),
        featBox,
        el("p", { class: "dnd-small dnd-muted" }, "Only a few feats are in the SRD. Add others by name on the Features tab and use “Ability scores” here instead."),
      ];
    host.replaceChildren(mode, ...body);
  }
  const featBox = el("div", { class: "dnd-pick-detail-box" });
  function showFeat() {
    const f = feats.find((x) => x.id === picks.feat);
    featBox.replaceChildren(...(f ? [el("h4", {}, f.name), f.prerequisite ? el("p", { class: "dnd-small dnd-muted" }, `Prerequisite: ${f.prerequisite}`) : null, renderDesc(f.desc || [])].filter(Boolean) : []));
  }
  draw();
  const lvl = totalLevel(char);
  modal({
    title: "Ability Score Improvement", wide: true,
    body: host,
    actions: [{ label: "Later" }, {
      label: "Apply", cls: "btn", onClick: () => {
        if (picks.mode === "feat") {
          const f = feats.find((x) => x.id === picks.feat);
          if (!f) { toast("Pick a feat.", "bad"); return false; }
          char.feats.push({ id: f.id, name: f.name, src: "Feat" });
          char.asiLog.push({ level: lvl, classId: char.levelLog[char.levelLog.length - 1]?.c, kind: "feat", detail: f.name });
        } else {
          const second = picks.b || picks.a;
          const same = second === picks.a;
          const add = (ab, n) => {
            const room = Math.max(0, 20 - scoreOf(ab));
            const give = Math.min(n, room);
            if (give > 0) char.bonuses.push({ src: "Ability Score Improvement", ab, n: give });
          };
          if (same) add(picks.a, 2); else { add(picks.a, 1); add(second, 1); }
          char.asiLog.push({ level: lvl, classId: char.levelLog[char.levelLog.length - 1]?.c, kind: "asi", detail: same ? `${picks.a} +2` : `${picks.a} +1, ${second} +1` });
        }
        S.commit();
        setTimeout(() => openPending(S), 60);
      },
    }],
  });
}

export { section, btn };
