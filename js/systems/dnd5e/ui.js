// Small UI helpers shared by every D&D view.

import { el, field } from "../../components.js";
import { getViewState, setViewState } from "../../viewState.js";

export { el, field };

export const clear = (node) => { node.replaceChildren(); return node; };

export function debounce(fn, ms = 250) {
  let t = null;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  wrapped.flush = (...a) => { clearTimeout(t); fn(...a); };
  return wrapped;
}

export function section(title, body, { cls = "", actions = null } = {}) {
  const head = (title || actions) ? el("div", { class: "dnd-section-head" }, [title ? el("h4", {}, title) : el("span"), actions]) : null;
  return el("div", { class: `card dnd-section ${cls}` }, [head, ...[].concat(body)].filter(Boolean));
}

export function chip(text, cls = "") {
  return el("span", { class: `dnd-chip ${cls}` }, text);
}

export function btn(label, onClick, cls = "btn secondary", attrs = {}) {
  const b = el("button", { class: cls, type: "button", ...attrs }, label);
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

export function pill(label, active, onClick) {
  const b = el("button", { class: `pill-btn${active ? " active" : ""}`, type: "button" }, label);
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

// Tabs whose active tab is remembered across navigation.
export function tabs(defs, { stateKey, initial } = {}) {
  const bar = el("div", { class: "settings-tabs dnd-tabs", role: "tablist" });
  const panel = el("div", { class: "dnd-tab-panel", role: "tabpanel" });
  let current = (stateKey && getViewState(stateKey, null)) || initial || defs[0].id;
  if (!defs.some((d) => d.id === current)) current = defs[0].id;
  function draw() {
    bar.replaceChildren(...defs.map((d) => {
      const b = el("button", { class: `pill-btn${d.id === current ? " active" : ""}`, role: "tab", type: "button", "aria-selected": String(d.id === current) }, d.label);
      b.addEventListener("click", () => show(d.id));
      return b;
    }));
  }
  function show(id) {
    current = id;
    if (stateKey) setViewState(stateKey, id);
    draw();
    panel.replaceChildren();
    defs.find((d) => d.id === id).render(panel);
  }
  show(current);
  return { bar, panel, show, current: () => current };
}

export function numInput(value, onChange, { min, max, step = 1, cls = "", ariaLabel = "" } = {}) {
  const input = el("input", { type: "number", value: value ?? "", inputmode: "numeric", class: `dnd-num ${cls}`, "aria-label": ariaLabel || null, ...(min != null ? { min } : {}), ...(max != null ? { max } : {}), step });
  input.addEventListener("change", () => {
    let v = input.value === "" ? null : Number(input.value);
    if (v != null) { if (min != null) v = Math.max(min, v); if (max != null) v = Math.min(max, v); input.value = v; }
    onChange(v);
  });
  return input;
}

export function textInput(value, onInput, { placeholder = "", multiline = false, rows = 3, cls = "", ariaLabel = "" } = {}) {
  const input = multiline
    ? el("textarea", { rows, placeholder, class: `dnd-text ${cls}`, "aria-label": ariaLabel || null })
    : el("input", { type: "text", placeholder, class: cls, "aria-label": ariaLabel || null, autocomplete: "off" });
  input.value = value ?? "";
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

// options: ["a","b"] or [[value,label], ...]
export function selectEl(options, value, onChange, { cls = "" } = {}) {
  const s = el("select", { class: cls }, options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return el("option", { value: v }, l);
  }));
  s.value = value ?? "";
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

export function checkbox(label, checked, onChange) {
  const input = el("input", { type: "checkbox" });
  input.checked = !!checked;
  input.addEventListener("change", () => onChange(input.checked));
  return el("label", { class: "dnd-check" }, [input, el("span", {}, label)]);
}

// ---------------------------------------------------------------- modals

export function modal({ title, body, actions = [], wide = false, onClose } = {}) {
  const overlay = el("div", { class: "modal-overlay", role: "dialog", "aria-modal": "true" });
  const box = el("div", { class: `modal-box dnd-modal${wide ? " wide" : ""}` });
  const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); onClose?.(); };
  function onKey(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  const head = el("div", { class: "dnd-modal-head" }, [el("h4", {}, title || ""), btn("✕", close, "quick-console-close", { "aria-label": "Close" })]);
  const foot = actions.length ? el("div", { class: "dnd-modal-actions" }, actions.map((a) => btn(a.label, () => { if (a.onClick?.() !== false && a.close !== false) close(); }, a.cls || "btn secondary"))) : null;
  box.append(head, el("div", { class: "dnd-modal-body" }, body), ...(foot ? [foot] : []));
  overlay.append(box);
  document.body.appendChild(overlay);
  const first = box.querySelector("input,select,textarea,button.btn");
  first?.focus();
  return { close, box, overlay };
}

export function confirmDialog(message, { ok = "OK", cancel = "Cancel", danger = false, title = "Please confirm" } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    modal({
      title, body: el("p", {}, message), onClose: () => done(false),
      actions: [
        { label: cancel, onClick: () => { done(false); } },
        { label: ok, cls: danger ? "btn danger" : "btn", onClick: () => { done(true); } },
      ],
    });
  });
}

export function promptDialog(title, label, initial = "", { multiline = false, ok = "Save" } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const input = multiline ? el("textarea", { rows: 6, class: "dnd-text" }) : el("input", { type: "text", autocomplete: "off" });
    input.value = initial;
    const m = modal({
      title, body: field(label, input), onClose: () => done(null),
      actions: [{ label: "Cancel", onClick: () => { done(null); } }, { label: ok, cls: "btn", onClick: () => { done(input.value); } }],
    });
    if (!multiline) input.addEventListener("keydown", (e) => { if (e.key === "Enter") { done(input.value); m.close(); } });
    setTimeout(() => input.focus(), 30);
  });
}

// ---------------------------------------------------------------- toast

let toastEl = null, toastTimer = null;
export function toast(message, kind = "") {
  if (!toastEl) {
    toastEl = el("div", { class: "dnd-toast", role: "status", "aria-live": "polite" });
    document.body.appendChild(toastEl);
  }
  clearTimeout(toastTimer);
  toastEl.className = `dnd-toast show ${kind}`;
  toastEl.textContent = message;
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

// ---------------------------------------------------------------- files

export function download(filename, text, mime = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept = ".json") {
  return new Promise((resolve) => {
    const input = el("input", { type: "file", accept, style: "display:none" });
    input.addEventListener("change", () => { resolve(input.files[0] || null); input.remove(); });
    input.addEventListener("cancel", () => { resolve(null); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

export const readText = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsText(file);
});

// ---------------------------------------------------------------- misc

export function loadingCard(text = "Loading rules data…") {
  return el("div", { class: "card" }, el("p", { class: "view-sub" }, text));
}

export function errorCard(err) {
  return el("div", { class: "card" }, [el("strong", {}, "Something went wrong."), el("p", { class: "view-sub" }, String(err?.message || err))]);
}

// Wraps an async view body: shows a loading card, then the content (or an error).
export async function asyncView(container, build) {
  container.replaceChildren(loadingCard());
  try {
    const content = await build();
    container.replaceChildren(...[].concat(content).filter(Boolean));
  } catch (e) {
    console.error(e);
    container.replaceChildren(errorCard(e));
  }
}

export const titleCase = (s) => String(s ?? "").replace(/\b\w/g, (m) => m.toUpperCase());
export const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const uniq = (arr) => [...new Set(arr)];
export function by(key, dir = 1) { return (a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir; }
