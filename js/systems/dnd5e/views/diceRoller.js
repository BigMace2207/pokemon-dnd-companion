import { el, field } from "../../../components.js";

// Parses expressions like "2d6+3", "d20", "4d8-1", "1d20+5 + 2d6".
export function rollExpression(text) {
  const clean = String(text).replace(/\s+/g, "").toLowerCase();
  if (!clean || !/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/.test(clean)) return null;
  const terms = clean.match(/[+-]?(\d*d\d+|\d+)/g);
  let total = 0;
  const parts = [];
  for (const term of terms) {
    const sign = term.startsWith("-") ? -1 : 1;
    const body = term.replace(/^[+-]/, "");
    if (body.includes("d")) {
      const [cStr, sStr] = body.split("d");
      const count = cStr === "" ? 1 : Number(cStr), size = Number(sStr);
      if (count < 1 || count > 100 || size < 2 || size > 1000) return null;
      const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * size));
      total += sign * rolls.reduce((a, b) => a + b, 0);
      parts.push(`${sign < 0 ? "−" : ""}${count}d${size} [${rolls.join(", ")}]`);
    } else {
      total += sign * Number(body);
      parts.push(`${sign < 0 ? "−" : "+"}${body}`);
    }
  }
  return { total, detail: parts.join(" ") };
}

export function renderDiceRoller(container) {
  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "Dice Roller"));
  const input = el("input", { type: "text", value: "1d20", placeholder: "e.g. 2d6+3" });
  const btn = el("button", { class: "btn" }, "Roll");
  const out = el("div", { class: "result-banner neutral" }, "—");
  const detail = el("p", { class: "view-sub" }, "");
  const history = el("div", { class: "card" });
  const rows = [];

  function roll() {
    const r = rollExpression(input.value);
    if (!r) { out.textContent = "Not a valid roll — try 2d6+3."; detail.textContent = ""; return; }
    out.textContent = String(r.total);
    detail.textContent = r.detail;
    rows.unshift(`${input.value.trim()} → ${r.total}  (${r.detail})`);
    history.innerHTML = "";
    history.appendChild(el("h4", {}, "Recent rolls"));
    rows.slice(0, 10).forEach((t) => history.appendChild(el("p", {}, t)));
  }
  btn.addEventListener("click", roll);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") roll(); });

  const quick = el("div", { class: "grid-3" }, ["d4", "d6", "d8", "d10", "d12", "d20", "d100"].map((d) => {
    const b = el("button", { class: "btn secondary" }, d);
    b.addEventListener("click", () => { input.value = `1${d}`; roll(); });
    return b;
  }));
  container.appendChild(el("div", { class: "card" }, [field("Dice expression", input), btn, out, detail, quick]));
  container.appendChild(history);
}
