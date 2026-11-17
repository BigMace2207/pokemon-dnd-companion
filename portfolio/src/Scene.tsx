import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useMemo, useRef } from "react";
import { COUNTRIES, N, STEP, mod } from "./data";

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
};

const FOV = 35;
const TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
/** in orbit the selected region sits this far right of, and above, the planet's centre (radians) */
const ASIDE = 0.55, TILT = 0.5;
/** the free spin, as on the old Lava Tower: each click adds this much (rad/s) up to a cap, and friction coasts it down */
const FLICK = 5, FLICK_MAX = 30, FRICTION = 0.7, SPIN_REST = 0.7;
const TAU = Math.PI * 2;

// The page's two inks (--ink and --accent in index.css) for the shader.
const INK = [0.925, 0.906, 0.863] as const, ACCENT = [0.949, 0.329, 0.176] as const;

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

// A chart, not a render: a matte globe with a graticule, and one landmass per region drawn as a coastline with
// hatching. The selected region is inked in the accent; the others in the page's ink.
const PLANET_FRAG = /* glsl */ `
#define N ${N}
uniform vec3 uCen[N]; uniform vec3 uInk; uniform vec3 uAccent;
uniform float uSel, uFocus, uPulseT; uniform vec3 uPulsePos;
varying vec3 vObj; varying vec3 vN; varying vec3 vView;
${NOISE}
float gridLine(float u, float du){ return 1.0 - clamp(abs(fract(u - 0.5) - 0.5) / max(du, 1e-5), 0.0, 1.0); }
void main(){
  vec3 o = normalize(vObj);
  float lat = asin(clamp(o.y, -1.0, 1.0)), lon = atan(o.x, o.z);
  const float CELL = 0.2617994;                      // 15 degrees
  float u = lon / CELL, v = lat / CELL;
  float du = min(fwidth(u), fwidth(fract(lon / 6.2831853 + 0.5) * 6.2831853 / CELL));   // (no seam where atan wraps)
  float grid = max(gridLine(v, fwidth(v) * 1.1), gridLine(u, du * 1.1) * smoothstep(1.45, 1.2, abs(lat)));
  float hatch = gridLine(v * 6.0, fwidth(v) * 6.0);  // fine parallels: the fill of a landmass

  vec3 N_ = normalize(vN), V = normalize(-vView);
  float lit = 0.62 + 0.38 * max(dot(N_, normalize(vec3(-0.45, 0.55, 0.7))), 0.0);
  vec3 col = vec3(0.066, 0.075, 0.088) * lit + uInk * grid * 0.05;

  for (int i = 0; i < N; i++) {
    float sel = 1.0 - step(0.5, abs(float(i) - uSel));
    float d = acos(clamp(dot(o, uCen[i]), -1.0, 1.0));
    float e = d + (fbm(o * 5.0 + float(i) * 7.3) - 0.5) * 0.26 - 0.3;      // < 0 inside the landmass
    float aa = fwidth(e) + 1e-4;
    float land = 1.0 - smoothstep(-aa, aa, e);
    float coast = 1.0 - smoothstep(aa * 0.6, aa * 2.0 + 0.002, abs(e));
    vec3 ink = mix(uInk, uAccent, sel);
    float strength = mix(mix(0.55, 0.22, uFocus), 1.0, sel);
    col = mix(col, vec3(0.098, 0.11, 0.128) * lit, land);
    col = mix(col, ink, clamp(coast * strength + land * hatch * (0.1 + 0.26 * sel), 0.0, 1.0));
  }

  float rim = smoothstep(0.8, 1.0, 1.0 - max(dot(N_, V), 0.0));           // a thin limb line, not a glow
  col = mix(col, uInk, rim * 0.16);

  if (uPulseT > 0.0) {                                // a ring racing outward from the chosen marker
    float dp = acos(clamp(dot(o, uPulsePos), -1.0, 1.0));
    float ring = 1.0 - smoothstep(0.0, 0.012 + 0.03 * uPulseT, abs(dp - uPulseT * 1.5));
    col = mix(col, uAccent, ring * (1.0 - uPulseT));
  }
  gl_FragColor = vec4(col, 1.0);
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
  }).current;

  const planetMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG,
    uniforms: {
      uCen: { value: COUNTRIES.map((c) => new THREE.Vector3(...c.center)) },
      uInk: { value: new THREE.Vector3(...INK) }, uAccent: { value: new THREE.Vector3(...ACCENT) },
      uSel: { value: 0 }, uFocus: { value: 0 }, uPulseT: { value: 0 }, uPulsePos: { value: new THREE.Vector3(0, 0, 1) },
    },
  }), []);
  const starGeo = useMemo(() => {
    const n = 900, a = new Float32Array(n * 3);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      const z = rnd() * 2 - 1, t = rnd() * TAU, r = 30 + rnd() * 20, q = Math.sqrt(1 - z * z);
      a.set([q * Math.cos(t) * r, z * r, q * Math.sin(t) * r], i * 3);
    }
    return new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(a, 3));
  }, []);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const { pos, mode, drag, activeId, pulseKey, spinKey, reduced, onFrame } = live.current;
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

    // The free spin. Letting go hands the planet back to its spring, which carries it on round to the region.
    const release = () => {
      s.spinning = false;
      s.yaw.x -= TAU * Math.ceil((s.yaw.x - s.yaw.t) / TAU);
      s.yaw.v = s.spinVel; s.spinVel = 0;
    };
    if (spinKey !== s.spinKey) {
      s.spinKey = spinKey;
      if (!reduced && !focus) { s.spinVel = Math.min(FLICK_MAX, (s.spinning ? s.spinVel : 0) + FLICK); s.spinning = true; }
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
    if (!s.ready || reduced) { springs.forEach((x) => x.snap()); s.ready = true; }
    else springs.forEach((x) => { if (!(s.spinning && x === s.yaw)) x.step(dt); });

    group.current.rotation.set(s.pitch.x, s.yaw.x, 0);
    group.current.scale.setScalar(1 + s.bump.x);
    group.current.updateMatrixWorld();
    camera.position.set(s.camX.x, s.camY.x, s.dist.x);
    camera.updateMatrixWorld();
    stars.current.rotation.set(s.pitch.x * 0.1, s.yaw.x * 0.1, 0);

    const un = planetMat.uniforms;
    un.uSel.value = i; un.uFocus.value = s.focus.x; un.uPulseT.value = s.pulseT < 1 ? s.pulseT : 0;

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
        <pointsMaterial size={1.4} sizeAttenuation={false} color="#ece7dc" transparent opacity={0.5} depthWrite={false} />
      </points>
      <group ref={group}>
        <mesh material={planetMat}><sphereGeometry args={[1, 128, 96]} /></mesh>
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
