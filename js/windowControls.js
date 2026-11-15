// The desktop app's window has no Windows title bar (desktop/shell.py makes it frameless), so the page draws its own: a small glass
// pill at the top right with minimise / maximise / close, thin grips on every edge for resizing, and a slim strip along the top to
// drag the window by. In a browser, or in the self-hosted app that keeps its normal frame, none of this appears.
const ICONS = {
  min: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8"/></svg>',
  max: '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1.4"/></svg>',
  restore: '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="3.8" width="6.2" height="6.2" rx="1.2"/><path d="M4 3.8V3a1.2 1.2 0 0 1 1.2-1.2H9A1.2 1.2 0 0 1 10.2 3v3.8A1.2 1.2 0 0 1 9 8.2h-.8"/></svg>',
  close: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>',
};
const EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

function mount(api, frame) {
  const root = document.documentElement;
  root.classList.add("in-app");

  const button = (kind, label, onClick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `wc-btn wc-${kind}`;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.innerHTML = ICONS[kind];
    b.addEventListener("click", onClick);
    return b;
  };
  const apply = (f) => {
    if (!f) return;
    root.classList.toggle("app-max", !!f.maximized);
    root.classList.toggle("app-fs", !!f.fullscreen);
    maxBtn.innerHTML = f.maximized ? ICONS.restore : ICONS.max;
    maxBtn.setAttribute("aria-label", f.maximized ? "Restore" : "Maximise");
    maxBtn.title = f.maximized ? "Restore" : "Maximise";
  };
  const call = (name) => async () => { try { apply(await api[name]()); } catch { /* window closing */ } };

  const maxBtn = button("max", "Maximise", call("toggle_maximize"));
  const pill = document.createElement("div");
  pill.className = "wc-pill";
  pill.append(button("min", "Minimise", call("minimize")), maxBtn, button("close", "Close", () => { try { api.close(); } catch { /* gone */ } }));

  const strip = document.createElement("div");
  strip.className = "wc-drag pywebview-drag-region";   // pywebview moves the window when this is dragged

  const grips = EDGES.map((edge) => {
    const g = document.createElement("div");
    g.className = `wc-grip wc-grip-${edge}`;
    g.addEventListener("pointerdown", (e) => { if (e.button === 0) { e.preventDefault(); api.begin_resize(edge); } });
    return g;
  });

  document.body.append(strip, pill, ...grips);
  document.querySelector(".topbar")?.classList.add("pywebview-drag-region");
  // maximising by double-clicking the strip, like a title bar
  strip.addEventListener("dblclick", call("toggle_maximize"));
  apply(frame);
  window.addEventListener("resize", () => { api.get_frame().then(apply).catch(() => {}); });
}

export function initWindowControls() {
  const start = async () => {
    try {
      const frame = await window.pywebview.api.get_frame();
      if (frame?.custom) mount(window.pywebview.api, frame);
    } catch { /* not the app */ }
  };
  if (window.pywebview?.api?.get_frame) start();
  else window.addEventListener("pywebviewready", start, { once: true });
}

// for testing in a plain browser: mount() with a stand-in window
export function previewWindowControls(api, frame) { mount(api, frame); }
