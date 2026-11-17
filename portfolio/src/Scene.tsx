import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useMemo, useRef } from "react";
import { COUNTRIES, N, STEP, mod } from "./data";
import { sfx } from "./sfx";

export type Mode = "browse" | "focus";
/** Screen positions (CSS px) the HUD needs each frame. */
export type Frame = {
  w: number; h: number;
  /** planet centre and apparent radius */
  cx: number; cy: number; r: number;
  /** the selected region's centre on the surface, and whether it is on the near side */
  ax: number; ay: number; aOn: boolean;
  /** the selected region's markers, in project order */
  dots: { x: number; y: number; on: boolean }[];
};
type Props = {
  pos: number; mode: Mode; drag: { offset: number }; activeId: string | null; pulseKey: number;
  /** goes up each time the already-selected region is clicked again: each one flicks the planet into a free spin */
  spinKey: number;
  reduced: boolean; onFrame: (f: Frame) => void;
  /** goes up when the visitor skips the opening animation */
  introSkip: number;
  onIntroEnd: () => void;
};

const FOV = 35;
const TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
/** in orbit the selected region sits this far right of, and above, the planet's centre (radians) */
const ASIDE = 0.55, TILT = 0.5;
/** the free spin, as on the old Lava Tower: each click adds this much (rad/s) up to a cap, and friction coasts it down */
const FLICK = 5, FLICK_MAX = 30, FRICTION = 0.7, SPIN_REST = 0.7;
const TAU = Math.PI * 2;
/** the opening: the planet turns once, and each region rises out of it as it comes round to face us */
const INTRO_START = 0.45, INTRO_GAP = 0.62, INTRO_OMEGA = STEP / INTRO_GAP, INTRO_TAIL = 0.5;
/** regions pop in the order the turn brings them round: 0, then N-1, N-2 ... */
const popOrder = (k: number) => mod(-k, N);
const BURST = 44;

/** A damped spring that can be retargeted mid-flight (it keeps its velocity). zeta 1 = no overshoot. */
class Spring {
  x = 0; v = 0; t = 0;
  constructor(private k: number, private zeta = 1) {}
  step(dt: number) {
    const c = 2 * Math.sqrt(this.k) * this.zeta;
    this.v += (-this.k * (this.x - this.t) - c * this.v) * dt;
    this.x += this.v * dt;
  }
  snap() { this.x = this.t; this.v = 0; }
}

const NOISE = /* glsl */ `
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ return 0.5 * noise(p) + 0.3 * noise(p * 2.1) + 0.2 * noise(p * 4.3); }
`;

const PLANET_VERT = /* glsl */ `
varying vec3 vObj; varying vec3 vN; varying vec3 vView;
void main(){
  vObj = position;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

// One landmass per region: a noisy disc around the region's centre, drawn as a glowing outline over a lat/long grid.
const PLANET_FRAG = /* glsl */ `
#define N ${N}
uniform vec3 uCen[N]; uniform vec3 uCol[N];
uniform float uSel, uFocus, uPulseT; uniform vec3 uPulsePos;
uniform float uReveal[N]; uniform float uPopT[N];
varying vec3 vObj; varying vec3 vN; varying vec3 vView;
${NOISE}
float gridLine(float u, float du){ return 1.0 - clamp(abs(fract(u - 0.5) - 0.5) / max(du, 1e-5), 0.0, 1.0); }
void main(){
  vec3 o = normalize(vObj);
  float lat = asin(clamp(o.y, -1.0, 1.0)), lon = atan(o.x, o.z);
  const float CELL = 0.2617994;                      // 15 degrees
  float u = lon / CELL, v = lat / CELL;
  float du = min(fwidth(u), fwidth(fract(lon / 6.2831853 + 0.5) * 6.2831853 / CELL));   // (no seam where atan wraps)
  float grid = max(gridLine(v, fwidth(v) * 1.2), gridLine(u, du * 1.2) * smoothstep(1.45, 1.2, abs(lat)));
  float fine = max(gridLine(v * 5.0, fwidth(v) * 6.0), gridLine(u * 5.0, du * 6.0));

  vec3 N_ = normalize(vN), V = normalize(-vView);
  float diff = 0.3 + 0.7 * max(dot(N_, normalize(vec3(-0.45, 0.55, 0.7))), 0.0);
  vec3 col = (vec3(0.012, 0.02, 0.046) + vec3(0.22, 0.45, 0.8) * grid * 0.09) * diff;

  vec3 accent = vec3(0.4, 0.8, 1.0);
  for (int i = 0; i < N; i++) {
    float sel = 1.0 - step(0.5, abs(float(i) - uSel));
    float d = acos(clamp(dot(o, uCen[i]), -1.0, 1.0));
    float rv = uReveal[i];
    if (rv < 0.004) continue;                                               // not risen yet
    float e = d + (fbm(o * 5.0 + float(i) * 7.3) - 0.5) * 0.26 * min(rv, 1.0) - 0.3 * rv;      // < 0 inside the landmass
    float aa = fwidth(e) + 1e-4;
    float land = 1.0 - smoothstep(-aa, aa, e);
    float edge = 1.0 - smoothstep(0.0, aa * 1.5 + 0.004, abs(e));
    float halo = exp(-max(e, 0.0) * 26.0) * (1.0 - land);
    float b = mix(mix(0.42, 0.14, uFocus), 1.0, sel);
    col = mix(col, uCol[i] * (0.05 + 0.09 * b) * diff, land);
    col += uCol[i] * b * (edge * 0.95 + halo * 0.22 + land * (fine * 0.16 + grid * 0.3));
    accent = mix(accent, uCol[i], sel);
    float pt = uPopT[i];
    if (pt >= 0.0 && pt < 1.0) {                       // the moment it rises: a shock ring and a flash on the new land
      float ring = 1.0 - smoothstep(0.0, 0.02 + 0.05 * pt, abs(d - pt * 1.1));
      col += uCol[i] * (ring * (1.0 - pt) * 1.8 + land * (1.0 - pt) * (1.0 - pt) * 1.1 + edge * (1.0 - pt) * 1.2);
    }
  }

  float fres = pow(1.0 - max(dot(N_, V), 0.0), 3.0);
  col += mix(vec3(0.25, 0.5, 1.0), accent, 0.35) * fres * 0.75;

  if (uPulseT > 0.0) {                                // a ring racing outward from the chosen marker
    float dp = acos(clamp(dot(o, uPulsePos), -1.0, 1.0));
    float ring = 1.0 - smoothstep(0.0, 0.015 + 0.05 * uPulseT, abs(dp - uPulseT * 1.5));
    col += accent * ring * (1.0 - uPulseT) * 1.3;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const GLOW_VERT = /* glsl */ `
varying vec3 vN;
void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const GLOW_FRAG = /* glsl */ `
uniform vec3 uTint; varying vec3 vN;
void main(){
  float t = clamp(-normalize(vN).z / 0.5, 0.0, 1.0);   // 0 at the halo's outer edge, 1 where it meets the planet
  gl_FragColor = vec4(uTint, pow(t, 2.2) * 0.7);       // additive: alpha is the glow's strength, so the page shows through
}`;

function Rig(p: Props) {
  const live = useRef(p);
  live.current = p;
  const group = useRef<THREE.Group>(null!);
  const stars = useRef<THREE.Points>(null!);
  const { camera, size } = useThree();

  const s = useRef({
    yaw: new Spring(34), pitch: new Spring(34), dist: new Spring(26), camX: new Spring(26), camY: new Spring(26),
    focus: new Spring(26), bump: new Spring(190, 0.42), ready: false, pulseKey: p.pulseKey, pulseT: 1,
    spinKey: p.spinKey, spinning: false, spinVel: 0, where: "",
    intro: { on: !matchMedia("(prefers-reduced-motion: reduce)").matches, t: 0, next: 0, last: 0, ended: false, skip: p.introSkip, whooshed: false, chimed: false },
    reveal: COUNTRIES.map(() => new Spring(115, 0.42)), popT: COUNTRIES.map(() => -1),
  }).current;

  const planetMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG,
    uniforms: {
      uCen: { value: COUNTRIES.map((c) => new THREE.Vector3(...c.center)) },
      uCol: { value: COUNTRIES.map((c) => new THREE.Vector3(...c.color)) },
      uSel: { value: 0 }, uFocus: { value: 0 }, uPulseT: { value: 0 }, uPulsePos: { value: new THREE.Vector3(0, 0, 1) },
      uReveal: { value: COUNTRIES.map(() => 1) }, uPopT: { value: COUNTRIES.map(() => -1) },
    },
  }), []);
  const glowMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms: { uTint: { value: new THREE.Vector3(0.3, 0.55, 1) } },
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }), []);
  const starGeo = useMemo(() => {
    const n = 1600, a = new Float32Array(n * 3);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      const z = rnd() * 2 - 1, t = rnd() * TAU, r = 30 + rnd() * 20, q = Math.sqrt(1 - z * z);
      a.set([q * Math.cos(t) * r, z * r, q * Math.sin(t) * r], i * 3);
    }
    return new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(a, 3));
  }, []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  // sparks thrown off the planet when a region rises (they turn with the planet, and fade as they fly)
  const sparks = useMemo(() => {
    const total = COUNTRIES.length * BURST;
    const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    return { geo, pos, col, vel: new Float32Array(total * 3), life: new Float32Array(total), max: new Float32Array(total).fill(1), tint: new Float32Array(total * 3) };
  }, []);
  const burst = (region: number) => {
    const c = COUNTRIES[region], base = region * BURST;
    for (let j = 0; j < BURST; j++) {
      const k = base + j;
      const r = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const cen = new THREE.Vector3(...c.center);
      const tang = r.sub(cen.clone().multiplyScalar(r.dot(cen))).multiplyScalar(0.25 + Math.random() * 0.55);
      const n = cen.clone().add(tang).normalize(), up = 0.5 + Math.random() * 1.1;
      sparks.pos.set([n.x * 1.005, n.y * 1.005, n.z * 1.005], k * 3);
      sparks.vel.set([n.x * up + tang.x * 0.5, n.y * up + tang.y * 0.5, n.z * up + tang.z * 0.5], k * 3);
      sparks.tint.set(c.color, k * 3);
      sparks.life[k] = sparks.max[k] = 0.7 + Math.random() * 0.8;
    }
  };

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const { pos, mode, drag, activeId, pulseKey, spinKey, reduced, onFrame, introSkip, onIntroEnd } = live.current;
    const i = mod(pos, N), c = COUNTRIES[i], focus = mode === "focus";
    const aspect = size.width / size.height, wide = size.width >= 900;

    // Where everything is heading. Orbit: the region sits up and to the right. Landed: it faces the screen, close up.
    const orbit = 1 / Math.sin(Math.atan(Math.min(0.56, 0.72 * aspect) * TAN));
    const near = Math.max(2.8, 1 + 0.5 / (aspect * TAN));
    s.yaw.t = focus ? -pos * STEP : ASIDE - (pos + drag.offset) * STEP;
    s.pitch.t = focus ? c.lat : c.lat - TILT;
    s.dist.t = focus ? near : orbit;
    s.camX.t = focus && wide ? 0.3 * aspect * (near - 1) * TAN : 0;
    s.camY.t = focus ? (wide ? 0 : -0.3 * (near - 1) * TAN) : 0.1 * orbit * TAN;
    s.focus.t = focus ? 1 : 0;
    s.bump.t = 0;

    // The opening. The planet sits far back, turns once at a steady rate, and each region rises as it comes round.
    const intro = s.intro;
    if (spinKey !== s.spinKey && intro.on) s.spinKey = spinKey;   // nothing to flick yet
    const finishIntro = (snap: boolean) => {
      intro.on = false; intro.ended = true;
      s.reveal.forEach((r) => { r.t = 1; if (snap) r.snap(); });
      s.yaw.v = snap ? 0 : INTRO_OMEGA * 0.6; s.spinning = false;
      s.yaw.x -= TAU * Math.ceil((s.yaw.x - s.yaw.t) / TAU);
      if (snap) { s.yaw.snap(); s.dist.snap(); } else sfx.chime();
      onIntroEnd();
    };
    if (intro.on) {
      if (!s.ready) { s.dist.x = orbit * 1.7; s.pitch.x = c.lat - TILT; s.pitch.v = 0; s.yaw.v = 0; s.ready = true; }
      if (introSkip !== intro.skip) { intro.skip = introSkip; s.dist.x = orbit; s.dist.v = 0; finishIntro(true); }
    }
    if (intro.on) {
      intro.t += dt;
      if (!intro.whooshed) { intro.whooshed = true; sfx.whoosh(); }
      s.yaw.x = ASIDE + INTRO_OMEGA * (intro.t - INTRO_START); s.yaw.v = 0;
      while (intro.next < N && intro.t >= INTRO_START + intro.next * INTRO_GAP) {
        const reg = popOrder(intro.next);
        s.reveal[reg].t = 1; s.reveal[reg].v = 2.4; s.popT[reg] = 0; intro.last = reg;
        s.bump.v = 0.2; burst(reg); sfx.pop(intro.next);
        intro.next++;
      }
      if (intro.next >= N && intro.t >= INTRO_START + (N - 1) * INTRO_GAP + INTRO_TAIL) finishIntro(false);
    }
    for (let k = 0; k < N; k++) if (s.popT[k] >= 0) { s.popT[k] += dt / 1.1; if (s.popT[k] >= 1) s.popT[k] = -1; }

    // The free spin. Letting go hands the planet back to its spring, which carries it on round to the region.
    const release = () => {
      s.spinning = false;
      s.yaw.x -= TAU * Math.ceil((s.yaw.x - s.yaw.t) / TAU);
      s.yaw.v = s.spinVel; s.spinVel = 0;
    };
    if (spinKey !== s.spinKey) {
      s.spinKey = spinKey;
      if (!reduced && !focus && !intro.on) { s.spinVel = Math.min(FLICK_MAX, (s.spinning ? s.spinVel : 0) + FLICK); s.spinning = true; }
    }
    const where = `${pos}|${mode}`;
    if (where !== s.where) { s.where = where; if (s.spinning) release(); }   // choosing a region locks the rotation again
    if (s.spinning) {
      s.yaw.x += s.spinVel * dt;
      s.spinVel *= Math.exp(-dt * FRICTION);
      if (s.spinVel < SPIN_REST || drag.offset !== 0) release();
    }

    if (pulseKey !== s.pulseKey) {
      s.pulseKey = pulseKey; s.pulseT = 0;
      if (!reduced) s.bump.v = 0.55;
      const pr = c.projects.find((x) => x.id === activeId);
      if (pr) planetMat.uniforms.uPulsePos.value.set(...pr.at);
    }
    if (s.pulseT < 1) s.pulseT = Math.min(1, s.pulseT + dt / 0.9);

    const springs = [s.yaw, s.pitch, s.dist, s.camX, s.camY, s.focus, s.bump];
    if (!s.ready || reduced) { springs.forEach((x) => x.snap()); s.reveal.forEach((r) => { r.t = 1; r.snap(); }); s.ready = true; }
    else springs.forEach((x) => { if (!((s.spinning || intro.on) && x === s.yaw)) x.step(dt); });
    s.reveal.forEach((r) => r.step(dt));

    group.current.rotation.set(s.pitch.x, s.yaw.x, 0);
    group.current.scale.setScalar(1 + s.bump.x);
    group.current.updateMatrixWorld();
    camera.position.set(s.camX.x, s.camY.x, s.dist.x);
    camera.updateMatrixWorld();
    stars.current.rotation.set(s.pitch.x * 0.1, s.yaw.x * 0.1, 0);

    for (let k = 0; k < sparks.life.length; k++) {
      if (sparks.life[k] <= 0) { sparks.col[k * 3] = sparks.col[k * 3 + 1] = sparks.col[k * 3 + 2] = 0; continue; }
      sparks.life[k] -= dt;
      const damp = Math.exp(-dt * 1.6), fade = Math.max(0, sparks.life[k] / sparks.max[k]) ** 1.6;
      for (let a = 0; a < 3; a++) {
        sparks.vel[k * 3 + a] *= damp; sparks.pos[k * 3 + a] += sparks.vel[k * 3 + a] * dt;
        sparks.col[k * 3 + a] = Math.min(1, sparks.tint[k * 3 + a] * 1.3 + 0.25) * fade;
      }
    }
    sparks.geo.attributes.position.needsUpdate = true; sparks.geo.attributes.color.needsUpdate = true;

    const un = planetMat.uniforms;
    un.uReveal.value = s.reveal.map((r) => Math.max(0, r.x)); un.uPopT.value = s.popT.slice();
    un.uSel.value = intro.on ? intro.last : i; un.uFocus.value = s.focus.x; un.uPulseT.value = s.pulseT < 1 ? s.pulseT : 0;
    const gc = (intro.on ? COUNTRIES[intro.last] : c).color;
    glowMat.uniforms.uTint.value.set(0.3 + gc[0] * 0.25, 0.5 + gc[1] * 0.15, 0.85 + gc[2] * 0.15);

    const { width: w, height: h } = size;
    const toScreen = (v: readonly [number, number, number]) => {
      tmp.set(v[0], v[1], v[2]).applyMatrix4(group.current.matrixWorld);
      const facing = tmp.dot(camera.position) - tmp.lengthSq();       // > 0 when this side of the limb
      tmp.project(camera);
      return { x: (tmp.x * 0.5 + 0.5) * w, y: (-tmp.y * 0.5 + 0.5) * h, on: facing > 0.12 };
    };
    tmp.set(0, 0, 0).project(camera);
    const cx = (tmp.x * 0.5 + 0.5) * w, cy = (-tmp.y * 0.5 + 0.5) * h;
    const r = (Math.tan(Math.asin(Math.min(0.999, 1 / camera.position.length()))) / TAN) * (h / 2);
    const a = toScreen(c.center);
    onFrame({ w, h, cx, cy, r, ax: a.x, ay: a.y, aOn: a.on, dots: c.projects.map((x) => toScreen(x.at)) });
  });

  return (
    <>
      <points ref={stars} geometry={starGeo}>
        <pointsMaterial size={1.5} sizeAttenuation={false} color="#cfd8ff" transparent opacity={0.8} depthWrite={false} />
      </points>
      <group ref={group}>
        <mesh material={planetMat}><sphereGeometry args={[1, 128, 96]} /></mesh>
        <mesh material={glowMat} scale={1.16}><sphereGeometry args={[1, 64, 48]} /></mesh>
        <points geometry={sparks.geo} frustumCulled={false}>
          <pointsMaterial size={3.2} sizeAttenuation={false} vertexColors transparent blending={THREE.AdditiveBlending} depthWrite={false} />
        </points>
      </group>
    </>
  );
}

export default function Scene(p: Props) {
  return (
    <Canvas dpr={[1, 1.75]} camera={{ fov: FOV, near: 0.1, far: 120, position: [0, 0, 6] }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }} aria-hidden="true">
      <Rig {...p} />
    </Canvas>
  );
}
