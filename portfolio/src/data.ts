// The portfolio's content. Regions ("countries") are the planet's categories; each project is a marker on its region.
// To add work: add a project to a region, or add a region (the planet lays regions out evenly around its equator and
// the shader draws one landmass per region). `img` is optional (a path under public/img, built to /assets/portfolio/img):
// without one, an artwork is generated from the project's id. `link` is optional. Everything here is public.
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
  /** the "Me" region also carries the music box */
  me?: boolean;
  projects: Project[];
  center: [number, number, number];
};

/** How to reach me. Leave `linkedin` empty to hide that button. */
export const CONTACT = {
  email: "masona.2207@gmail.com",
  github: "https://github.com/BigMace2207",
  linkedin: "https://www.linkedin.com/in/mason-allen-75979b281/",
  subject: "Work with you",
  body: "Hi Mason,\n\nI found your portfolio and I'd like to talk about a project.\n\nWhat I need:\n\nThanks,\n",
};

type RawProject = Omit<Project, "at">;
type RawCountry = Omit<Country, "center" | "projects"> & { projects: RawProject[] };

const IMG = (name: string) => `/assets/portfolio/img/${name}`;

const RAW: RawCountry[] = [
  {
    id: "me", name: "Me", blurb: "About Mason", color: [1.0, 0.55, 0.42], lat: 0.06, me: true,
    projects: [
      { id: "hello", title: "Hello, I'm Mason", year: "2026", kicker: "Computing (Games Programming)",
        desc: "I'm a recently graduating computing student with a passion for games programming, 3D modelling and anything that bridges design and development. I've worked behind a bar since 2023, which has taught me teamwork, how to lead when I have to, and how to stay steady when things get hard.",
        tags: ["Games programming", "3D modelling", "Teamwork"] },
      { id: "toolkit", title: "My toolkit", year: "2021–now", kicker: "Gener8 · Edge Hill University",
        desc: "Blender has been my passion since I started using it in 2021, in my first year of college. Unity was my first engine, but after its terms-of-service change I added Godot too, to keep my options open. I also work in Unreal, Aseprite for pixel art, and Luau for Roblox.",
        tags: ["Blender", "Unity", "Godot", "Unreal", "Aseprite", "Luau"] },
      { id: "heading", title: "Where I'm heading", year: "Next", kicker: "Goals and what I do for fun",
        desc: "I want to make a game that brings smiles, and a few tears, to people all over the world, and I know I'm not there yet. For now I'm sharpening every tool I use by making assets for projects that need them. Outside work I read and play a lot of games, always wondering how they work behind the scenes.",
        tags: ["Goal", "Reading", "Games"] },
    ],
  },
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
      { id: "slime", title: "Mega Slime Factory", year: "2026", kicker: "Live on Roblox · 7 Nov 2026", img: IMG("slime.jpg"),
        desc: "An idle tycoon where you build slime machines, watch the slime ride the conveyor into your tank and collect the cash. Launched on 7 November 2026 with game passes, developer products and Premium Payouts, plus a daily lucky wheel, playtime gifts, rebirths, a rare rainbow slime and a night-time slime-hunting update with a boss.",
        tags: ["Luau", "Monetisation", "Live ops", "UI"] },
      { id: "uikit", title: "UI Kit & Lucky Wheel", year: "2026", kicker: "Reusable Roblox modules",
        desc: "The interface kit and spin-the-wheel module built for Mega Slime Factory, written to drop into any other experience: data saving, gifts and a configurable prize wheel.",
        tags: ["Luau", "UI", "Modules"] },
    ],
  },
  {
    id: "godot", name: "Godot", blurb: "Small games", color: [0.42, 1.0, 0.69], lat: 0.12,
    projects: [
      { id: "wandering", title: "Wandering", year: "2026", kicker: "2D procedural generation · Godot 4", img: IMG("wandering.jpg"),
        desc: "A 2D game whose world is built by a procedural generation algorithm: landscape and biomes, blended tiles, collisions and animated water, with hand-drawn Aseprite pixel art. A group project made to showcase an emerging technology, kept on GitHub.",
        tags: ["Godot 4", "GDScript", "Procedural generation", "Aseprite"], link: "https://github.com/BigMace2207/Wandering" },
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
      { id: "xr", title: "Medical Assets", year: "2025–26", kicker: "Final-year project · Gener8", img: IMG("medical.jpg"),
        desc: "A library of 3D medical assets for an extended-reality training simulation, created in Blender and optimised for export to Unity. Built to hold 60+ FPS with low polygon counts, using normal maps and human-centred design.",
        tags: ["Blender", "Unity", "XR", "Optimisation"] },
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
      { id: "donuts", title: "Donuts", year: "2024", kicker: "Blender", img: IMG("donuts.jpg"),
        desc: "A high-fidelity scene featuring doughnuts, modelled, shaded and lit in Blender and rendered as an animation.",
        tags: ["Blender", "Shading", "Lighting", "Rendering"] },
      { id: "kitchen", title: "Cute Kitchen", year: "2026", kicker: "Recently completed",
        desc: "Render concept art for a Minecraft mod I attempted to develop, featuring pastel colours and smooth edges.",
        tags: ["Blender", "Concept art", "Minecraft"] },
      { id: "canal", title: "Canal Town", year: "2026", kicker: "Recently started",
        desc: "A small work-in-progress town featuring a canal, dense dystopian geometry and a vertical design philosophy, based on my experiences in China.",
        tags: ["Blender", "Environment art", "WIP"] },
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
    const r = n === 1 ? 0 : Math.tan(MARKER_RING * (n > 4 ? 1.12 : 1));
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
