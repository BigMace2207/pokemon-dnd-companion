// The portfolio's content. Regions ("countries") are the planet's categories; each project is a marker on its region.
// To add work: add a project to a region, or add a region (the planet lays regions out evenly around its equator and
// the shader draws one landmass per region). `img` is optional (a URL under /assets): without one, an artwork is
// generated from the project's id. `link` is optional. Everything here is public.
export type Project = {
  id: string; title: string; year: string; kicker: string; desc: string; tags: string[];
  link?: string; img?: string;
  /** unit vector on the planet, filled in below */
  at: [number, number, number];
};
export type Country = {
  id: string; name: string; blurb: string;
  /** accent colour, 0..1 rgb */
  color: [number, number, number];
  /** latitude of the landmass, radians */
  lat: number;
  projects: Project[];
  center: [number, number, number];
};

type RawProject = Omit<Project, "at">;
type RawCountry = Omit<Country, "center" | "projects"> & { projects: RawProject[] };

const RAW: RawCountry[] = [
  {
    id: "web", name: "Web & Apps", blurb: "Full-stack tools", color: [0.36, 0.9, 1.0], lat: 0.18,
    projects: [
      { id: "companion", title: "Pokémon D&D Companion", year: "2025–now", kicker: "Live at fluxdev.org",
        desc: "A tabletop companion web app: Pokédex, calculators, trainer sheets and live multi-campaign multiplayer with a DM Control Centre. It also carries a full D&D 5e system, an e-reader library and a lava theme. Built with a Python standard-library server and a no-build vanilla JavaScript front end.",
        tags: ["Python", "Vanilla JS", "Realtime", "Self-hosted"], link: "/" },
      { id: "portfolio", title: "This Portfolio", year: "2026", kicker: "React · Three.js",
        desc: "The planet you are flying around. A custom shader draws one landmass per category, springs carry the camera between orbit and surface, and the interface uses Amicro's open-source micro-interactions.",
        tags: ["React", "Three.js", "GLSL", "Motion"] },
      { id: "brain", title: "Second Brain", year: "2026", kicker: "Personal knowledge base",
        desc: "A private library of articles, videos, PDFs and notes stored as an original plus an AI summary, with a search command, weekly upkeep scripts and an encrypted vault for secrets.",
        tags: ["Python", "Markdown", "Git", "Encryption"] },
    ],
  },
  {
    id: "roblox", name: "Roblox", blurb: "Live games", color: [1.0, 0.37, 0.82], lat: -0.22,
    projects: [
      { id: "slime", title: "Mega Slime Factory", year: "2026", kicker: "Live on Roblox · 7 Nov 2026",
        desc: "A tycoon where you build machines that make slime. Launched on 7 November 2026 with game passes, developer products and Premium Payouts wired in, plus saved progress, a gift system and a lucky wheel. Now in its first live-ops cycle.",
        tags: ["Luau", "Monetisation", "Live ops", "UI"] },
      { id: "uikit", title: "UI Kit & Lucky Wheel", year: "2026", kicker: "Reusable Roblox modules",
        desc: "The interface kit and spin-the-wheel module built for Mega Slime Factory, written to drop into any other experience: data saving, gifts and a configurable prize wheel.",
        tags: ["Luau", "UI", "Modules"] },
    ],
  },
  {
    id: "godot", name: "Godot", blurb: "Small games", color: [0.42, 1.0, 0.69], lat: 0.12,
    projects: [
      { id: "wandering", title: "Wandering", year: "2026", kicker: "Godot 4 · pixel art",
        desc: "An exploration game with hand-drawn Aseprite pixel art and GDScript, developed over spring 2026 and kept on GitHub.",
        tags: ["Godot 4", "GDScript", "Aseprite"], link: "https://github.com/BigMace2207/Wandering" },
      { id: "chat", title: "Chat Tycoon", year: "2026", kicker: "Messaging tycoon",
        desc: "A management game about running a messaging service, with about twenty GDScript files driving its economy and interface.",
        tags: ["Godot 4", "GDScript", "Systems"] },
      { id: "pong", title: "Pong", year: "2026", kicker: "Classic, rebuilt",
        desc: "A clean rebuild of Pong in Godot, used to practise scenes, signals and game feel.",
        tags: ["Godot 4", "GDScript"], link: "https://github.com/BigMace2207/pong" },
    ],
  },
  {
    id: "unity", name: "Unity & XR", blurb: "3D & simulation", color: [0.61, 0.48, 1.0], lat: -0.15,
    projects: [
      { id: "xr", title: "XR Medical Training Assets", year: "2025–26", kicker: "Final-year project · Gener8",
        desc: "A library of performance-optimised 3D models and interface elements for an extended-reality medical training simulation. Modelled in Blender, tested in Unity and tuned to hold 60+ FPS with low polygon counts, using normal maps and human-centred design.",
        tags: ["Unity", "Blender", "XR", "Optimisation"] },
      { id: "fry", title: "Fry Me to the Moon", year: "2025", kicker: "Group game · Professional Practice II",
        desc: "A team game proposal and working artefact demo built in Unity with TrenchBroom-authored levels, presented as a pitch and a playable slice.",
        tags: ["Unity", "TrenchBroom", "Teamwork"] },
      { id: "quake", title: "Quake-style Prototype", year: "2025", kicker: "Tremble / QuakeLike",
        desc: "Fast first-person movement and combat experiments in Unity, importing Quake-style maps made in TrenchBroom.",
        tags: ["Unity", "C#", "Level design"] },
      { id: "chars", title: "Characters & Scene", year: "2026", kicker: "Digital Design & Production",
        desc: "Modelled and animated characters in Blender, composed into a lit Unity scene with sound effects.",
        tags: ["Blender", "Unity", "Animation"] },
    ],
  },
  {
    id: "gfx", name: "Graphics & Art", blurb: "Rendering & pixels", color: [1.0, 0.78, 0.34], lat: 0.25,
    projects: [
      { id: "opengl", title: "PyGame & PyOpenGL", year: "2025", kicker: "Computer Graphics portfolio",
        desc: "A series of Python graphics programs written for a computer graphics module, from 2D PyGame experiments to PyOpenGL scenes with transforms and lighting.",
        tags: ["Python", "OpenGL", "Maths"] },
      { id: "unreal", title: "Unreal Practice Tasks", year: "2024", kicker: "C++ and Blueprints",
        desc: "A set of Unreal Engine exercises: a character controller, a game UI and a dice game feature written in C++.",
        tags: ["Unreal", "C++", "UI"] },
      { id: "blender", title: "Blender Library", year: "2023–now", kicker: "47 models and counting",
        desc: "A growing folder of Blender models, levels and props made for games, exported to Unity and Godot, with Aseprite pixel art alongside.",
        tags: ["Blender", "Aseprite", "Assets"] },
    ],
  },
];

export const N = RAW.length;
/** longitude between neighbouring regions */
export const STEP = (Math.PI * 2) / N;
/** how far from a region's centre its markers sit, radians */
const MARKER_RING = 0.15;

export const COUNTRIES: Country[] = RAW.map((c, i) => {
  const lon = i * STEP, lat = c.lat;
  const center: [number, number, number] = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
  const east = [Math.cos(lon), 0, -Math.sin(lon)];
  const north = [-Math.sin(lat) * Math.sin(lon), Math.cos(lat), -Math.sin(lat) * Math.cos(lon)];
  const n = c.projects.length;
  const projects = c.projects.map((p, k): Project => {
    const r = n === 1 ? 0 : Math.tan(MARKER_RING);
    const a = (k / n) * Math.PI * 2 + 0.6 + i * 0.9;
    const v = [0, 1, 2].map((j) => center[j] + r * (Math.cos(a) * east[j] + Math.sin(a) * north[j]));
    const len = Math.hypot(v[0], v[1], v[2]);
    return { ...p, at: [v[0] / len, v[1] / len, v[2] / len] };
  });
  return { ...c, projects, center };
});

export const mod = (n: number, m: number) => ((n % m) + m) % m;
export const css = (c: [number, number, number], a = 1) =>
  `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)} / ${a})`;
