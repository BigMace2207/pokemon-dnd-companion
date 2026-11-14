import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SIZE_PARTS, SIZE_RANGE, TEXT_RANGE, GLASS_RANGE, clampPct, cleanUi, cssVars } from "../../js/uiPrefs.js";

test("sizes are rounded to the step and kept inside the range; junk is 100", () => {
  assert.equal(clampPct(100, SIZE_RANGE), 100);
  assert.equal(clampPct(103, SIZE_RANGE), 105);
  assert.equal(clampPct(10, SIZE_RANGE), SIZE_RANGE.min);
  assert.equal(clampPct(900, SIZE_RANGE), SIZE_RANGE.max);
  assert.equal(clampPct("120", SIZE_RANGE), 120);
  for (const junk of [NaN, undefined, "big", {}, Infinity]) assert.equal(clampPct(junk, SIZE_RANGE), 100, String(junk));
  assert.equal(clampPct(70, TEXT_RANGE), TEXT_RANGE.min);
});

test("stored preferences are cleaned: unknown parts dropped, defaults left out, flags only when exactly on", () => {
  assert.deepEqual(cleanUi(null), { sizes: {}, text: 100, glass: 100, dots: true, motion: "system", contrast: false, focus: false });
  assert.deepEqual(cleanUi({ sizes: { minimap: 130, toolbar: 100, nonsense: 50, tabs: 9999 }, text: 115, motion: "on", contrast: true, focus: "yes" }),
    { sizes: { minimap: 130, tabs: SIZE_RANGE.max }, text: 115, glass: 100, dots: true, motion: "on", contrast: true, focus: false });
  assert.equal(cleanUi({ glass: 5 }).glass, GLASS_RANGE.min, "never fully invisible");
  assert.equal(cleanUi({ glass: 60 }).glass, 60);
  assert.equal(cleanUi({ dots: false }).dots, false);
  assert.equal(cleanUi({ dots: "no" }).dots, true, "only an exact false switches the dots off");
  assert.equal(cleanUi({ motion: "off" }).motion, "system");
  assert.deepEqual(cleanUi({ sizes: "wide" }).sizes, {});
});

test("what is applied: one custom property per changed part, and the text size, nothing for the defaults", () => {
  assert.deepEqual(cssVars(cleanUi({})), {});
  assert.deepEqual(cssVars(cleanUi({ sizes: { minimap: 80, zoom: 125 }, text: 110 })), { "--ui-minimap": "0.8", "--ui-zoom": "1.25", "--ui-text": "1.1" });
  assert.deepEqual(cssVars(cleanUi({ glass: 55 })), { "--ui-glass": "0.55" });
  assert.deepEqual(cssVars(cleanUi({ glass: 100, dots: false })), {}, "the dots are an attribute, not a variable");
});

test("every part has an id the stylesheet knows, a label and a hint, and ids are unique", () => {
  const css = readFileSync(new URL("../../css/ui-prefs.css", import.meta.url), "utf8");
  assert.equal(new Set(SIZE_PARTS.map((p) => p.id)).size, SIZE_PARTS.length);
  for (const p of SIZE_PARTS) {
    assert.match(p.id, /^[a-z]+$/, "ids are plain lower-case words (they become a css variable name)");
    assert.ok(p.label && p.hint, p.id);
    assert.ok(css.includes(`var(--ui-${p.id}`), `${p.id} is used by css/ui-prefs.css`);
  }
});

test("the text size multiplies the app's scale everywhere it is set, and the early script reads the same key and ranges", () => {
  for (const f of ["css/style.css", "css/vvd.css"]) {
    const css = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
    const decls = css.match(/--s:\s*[^;]+;/g) || [];
    assert.ok(decls.length >= 3, f);
    for (const d of decls) assert.match(d, /var\(--ui-text, 1\)/, `${f}: ${d}`);
  }
  const init = readFileSync(new URL("../../js/layout-init.js", import.meta.url), "utf8");
  assert.ok(init.includes('"pkdnd-ui"'));
  assert.ok(init.includes(`>= ${SIZE_RANGE.min} && v <= ${SIZE_RANGE.max}`), "the same size range");
  assert.ok(init.includes(`>= ${TEXT_RANGE.min} && t <= ${TEXT_RANGE.max}`), "the same text range");
  assert.ok(init.includes(`g >= ${GLASS_RANGE.min} && g < 100`), "the same transparency range");
  const css = readFileSync(new URL("../../css/ui-prefs.css", import.meta.url), "utf8");
  assert.ok(css.includes("var(--ui-glass") && css.includes('data-hub-dots="off"'), "the stylesheet uses both");
});
