// A software renderer for gallery thumbnails: the app's drawables, rasterised on the CPU so
// a thumbnail needs no browser and no GPU. It is styled for a thumbnail rather than copied
// from the viewport: the camera keeps the script's direction, projection and field of view
// but frames the model tightly; faces are shaded per pixel under a sky/ground light, a key
// light with a highlight and a rim light, tone-mapped; the model stands on a soft contact
// shadow over a light gradient backdrop. Colours and edge styles a script sets are honoured.

import type { Drawable } from "../src/app/viewport";
import { DEFAULT_COLORS } from "../src/app/viewport";
import type { ViewSpec } from "../src/api/view";
import { directionFor } from "../src/api/view";
import { fitDistance } from "../src/app/frame";

type V3 = [number, number, number];

/** The thumbnail's look: a light backdrop, soft contact shadow, dark hairline edges. */
const LOOK = {
  /** Backdrop gradient, top to bottom. */
  top: "#f7f8fa",
  bottom: "#d9dde3",
  /** How dark the contact shadow gets at its centre, 0–1. */
  shadow: 0.5,
  /** Default edge colour and opacity, when the script says nothing. */
  edge: "#1f2329",
  edgeOpacity: 0.85,
  /** Exposure before tone mapping. */
  exposure: 0.95,
};

const LINE_WIDTH = 1.25;
const MARGIN = 0.14;

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff",
  yellow: "#ffff00", orange: "#ffa500", purple: "#800080", gray: "#808080", grey: "#808080",
  cyan: "#00ffff", magenta: "#ff00ff", pink: "#ffc0cb", brown: "#a52a2a", gold: "#ffd700",
  silver: "#c0c0c0", navy: "#000080", teal: "#008080", olive: "#808000", maroon: "#800000",
  lime: "#00ff00", coral: "#ff7f50", salmon: "#fa8072", steelblue: "#4682b4",
};
function linear(css: string): V3 {
  const hex = css.startsWith("#") ? css : (NAMED[css.toLowerCase()] ?? "#ff00ff");
  const h = hex.length === 4 ? hex.replace(/^#(.)(.)(.)$/, "#$1$1$2$2$3$3") : hex;
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return c.map((s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4)) as V3;
}
/** ACES filmic (Narkowicz): the model's lighting only, so the backdrop keeps its colours. */
function aces(l: number): number {
  const x = Math.max(0, l * LOOK.exposure);
  return Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
}
function encode(l: number): number {
  const s = Math.min(1, Math.max(0, l));
  return Math.round(255 * (s <= 0.0031308 ? s * 12.92 : 1.055 * s ** (1 / 2.4) - 0.055));
}

// Lights, in world space (z up).
const KEY = norm([0.35, -0.55, 1.0]);
const RIM = norm([-0.6, 0.7, 0.35]);
const SKY: V3 = [0.62, 0.66, 0.72];
const GROUND: V3 = [0.2, 0.19, 0.18];

/** Linear radiance of a face point with colour `c`, normal `n`, seen from direction `v`. */
function shade(c: V3, n: V3, v: V3): V3 {
  if (dot(n, v) < 0) n = scale(n, -1); // double-sided
  const hemi = 0.5 + 0.5 * n[2];
  const amb: V3 = [0, 1, 2].map((k) => GROUND[k] + (SKY[k] - GROUND[k]) * hemi) as V3;
  const key = Math.max(0, dot(n, KEY));
  const rim = Math.max(0, dot(n, RIM));
  const h = norm(add(KEY, v));
  const spec = 0.18 * Math.max(0, dot(n, h)) ** 48 * (key > 0 ? 1 : 0);
  const fresnel = 0.06 * (1 - Math.max(0, dot(n, v))) ** 4;
  return [0, 1, 2].map((k) => aces(c[k] * (amb[k] * 0.45 + 1.25 * key + 0.25 * rim) + spec + fresnel)) as V3;
}

interface Screen {
  x: number;
  y: number;
  /** Affine in screen space, smaller is nearer: z (ortho) or −1/z (perspective). */
  d: number;
}

interface Camera {
  eye: V3;
  forward: V3;
  ortho: boolean;
  project(p: V3): Screen | null;
  /** The world ray through a pixel: origin and direction. */
  ray(x: number, y: number): { o: V3; dir: V3 };
  bias: number;
}

/** The script's direction, projection and field of view, framed tightly around `points`. */
function camera(points: V3[], view: ViewSpec, w: number, h: number): Camera {
  const aspect = w / h;
  const f = scale(norm(directionFor(view.from) as V3), -1);
  const up: V3 = Math.abs(f[2]) > 0.999 ? [0, 1, 0] : [0, 0, 1];
  const r = norm(cross(f, up));
  const u = cross(r, f);
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points)
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], p[i]);
      hi[i] = Math.max(hi[i], p[i]);
    }
  let target: V3 = scale(add(lo, hi), 0.5);
  const radius = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 || 1;
  const ortho = view.projection === "ortho";
  const t = Math.tan((view.fov * Math.PI) / 360);
  let dist = ortho ? radius * 4 : fitDistance(radius, view.fov, aspect);
  let half = radius;

  const build = (): Camera => {
    const eye = sub(target, scale(f, dist));
    const near = dist * 1e-3;
    return {
      eye,
      forward: f,
      ortho,
      bias: ortho ? 2e-3 * radius : (2e-3 * radius) / (dist * dist),
      project(p) {
        const v = sub(p, eye);
        const x = dot(v, r);
        const y = dot(v, u);
        const z = dot(v, f);
        if (!ortho && z < near) return null;
        const sx = ortho ? x / (half * aspect) : x / (z * t * aspect);
        const sy = ortho ? y / half : y / (z * t);
        return { x: (sx * 0.5 + 0.5) * w, y: (0.5 - sy * 0.5) * h, d: ortho ? z : -1 / z };
      },
      ray(px, py) {
        const sx = (px / w) * 2 - 1;
        const sy = 1 - (py / h) * 2;
        if (ortho) {
          const o = add(eye, add(scale(r, sx * half * aspect), scale(u, sy * half)));
          return { o, dir: f };
        }
        return { o: eye, dir: norm(add(f, add(scale(r, sx * t * aspect), scale(u, sy * t)))) };
      },
    };
  };

  // Fit: recentre on the projected extent and scale it to fill the frame, a few times
  // over (perspective makes the extent depend on the distance).
  for (let it = 0; it < 8; it++) {
    const cam = build();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of points) {
      const s = cam.project(p);
      if (!s) continue;
      const sx = (s.x / w) * 2 - 1;
      const sy = 1 - (s.y / h) * 2;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx);
      y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const ext = Math.max((x1 - x0) / 2, (y1 - y0) / 2) / (1 - MARGIN);
    const unitX = ortho ? half * aspect : dist * t * aspect;
    const unitY = ortho ? half : dist * t;
    target = add(target, add(scale(r, mx * unitX), scale(u, my * unitY)));
    if (ortho) half *= ext;
    else dist *= ext;
  }
  return build();
}

interface Target {
  w: number;
  h: number;
  rgb: Float32Array;
  depth: Float32Array;
}

function triangle(
  t: Target,
  a: Screen,
  b: Screen,
  c: Screen,
  each: (i: number, d: number, wa: number, wb: number, wc: number) => void,
) {
  const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(area) < 1e-12) return;
  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const x1 = Math.min(t.w - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const y1 = Math.min(t.h - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const wa = ((b.x - px) * (c.y - py) - (b.y - py) * (c.x - px)) / area;
      const wb = ((c.x - px) * (a.y - py) - (c.y - py) * (a.x - px)) / area;
      const wc = 1 - wa - wb;
      if (wa < 0 || wb < 0 || wc < 0) continue;
      each(y * t.w + x, wa * a.d + wb * b.d + wc * c.d, wa, wb, wc);
    }
  }
}

function line(t: Target, a: Screen, b: Screen, width: number, color: V3, alpha: number, bias: number) {
  const hw = width / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - hw));
  const x1 = Math.min(t.w - 1, Math.ceil(Math.max(a.x, b.x) + hw));
  const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - hw));
  const y1 = Math.min(t.h - 1, Math.ceil(Math.max(a.y, b.y) + hw));
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      let s = len2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
      s = Math.max(0, Math.min(1, s));
      const ex = a.x + s * dx - px;
      const ey = a.y + s * dy - py;
      if (ex * ex + ey * ey > hw * hw) continue;
      const i = y * t.w + x;
      if (a.d + s * (b.d - a.d) - bias > t.depth[i]) continue;
      for (let k = 0; k < 3; k++) t.rgb[3 * i + k] = color[k] * alpha + t.rgb[3 * i + k] * (1 - alpha);
    }
  }
}

/** A soft contact shadow: the model's footprint seen from straight above, blurred, laid on
 * the plane under its lowest point. Returns the shadow's darkness at a world (x, y). */
function contactShadow(tris: { p: V3[]; alpha: number }[], lo: V3, hi: V3): (x: number, y: number) => number {
  const N = 256;
  const pad = 0.35 * Math.max(hi[0] - lo[0], hi[1] - lo[1]) + 1e-9;
  const x0 = lo[0] - pad, y0 = lo[1] - pad;
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1]) + 2 * pad;
  const cell = size / N;
  const mask = new Float32Array(N * N);
  const height = hi[2] - lo[2] || 1;
  for (const { p, alpha } of tris) {
    const s = p.map((q) => ({ x: (q[0] - x0) / cell, y: (q[1] - y0) / cell, d: q[2] }));
    const area = (s[1].x - s[0].x) * (s[2].y - s[0].y) - (s[1].y - s[0].y) * (s[2].x - s[0].x);
    if (Math.abs(area) < 1e-12) continue;
    const bx0 = Math.max(0, Math.floor(Math.min(s[0].x, s[1].x, s[2].x)));
    const bx1 = Math.min(N - 1, Math.ceil(Math.max(s[0].x, s[1].x, s[2].x)));
    const by0 = Math.max(0, Math.floor(Math.min(s[0].y, s[1].y, s[2].y)));
    const by1 = Math.min(N - 1, Math.ceil(Math.max(s[0].y, s[1].y, s[2].y)));
    for (let y = by0; y <= by1; y++)
      for (let x = bx0; x <= bx1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const wa = ((s[1].x - px) * (s[2].y - py) - (s[1].y - py) * (s[2].x - px)) / area;
        const wb = ((s[2].x - px) * (s[0].y - py) - (s[2].y - py) * (s[0].x - px)) / area;
        const wc = 1 - wa - wb;
        if (wa < 0 || wb < 0 || wc < 0) continue;
        // Material close to the floor casts a darker shadow than material far above it.
        const z = wa * s[0].d + wb * s[1].d + wc * s[2].d;
        const near = 1 - 0.6 * Math.min(1, (z - lo[2]) / height);
        mask[y * N + x] = Math.max(mask[y * N + x], near * Math.min(1, alpha * 1.4));
      }
  }
  // Two box blurs ≈ a gaussian.
  const blur = (src: Float32Array, rad: number) => {
    const tmp = new Float32Array(N * N);
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        let s = 0, n = 0;
        for (let k = -rad; k <= rad; k++) {
          const xx = x + k;
          if (xx >= 0 && xx < N) { s += src[y * N + xx]; n++; }
        }
        tmp[y * N + x] = s / n;
      }
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        let s = 0, n = 0;
        for (let k = -rad; k <= rad; k++) {
          const yy = y + k;
          if (yy >= 0 && yy < N) { s += tmp[yy * N + x]; n++; }
        }
        out[y * N + x] = s / n;
      }
    return out;
  };
  const soft = blur(blur(mask, 10), 10);
  return (x, y) => {
    const gx = Math.floor((x - x0) / cell);
    const gy = Math.floor((y - y0) / cell);
    if (gx < 0 || gy < 0 || gx >= N || gy >= N) return 0;
    return soft[gy * N + gx];
  };
}

/** Render `drawables` into an 8-bit RGBA buffer of `width × height`, supersampled
 * `ss × ss` per pixel. */
export function render(
  drawables: Drawable[],
  view: ViewSpec,
  width: number,
  height: number,
  ss = 3,
): Uint8Array {
  const W = width * ss;
  const H = height * ss;
  const t: Target = { w: W, h: H, rgb: new Float32Array(W * H * 3), depth: new Float32Array(W * H).fill(Infinity) };
  const at = (arr: ArrayLike<number>, i: number): V3 => [arr[i], arr[i + 1], arr[i + 2]];

  const points: V3[] = [];
  for (const d of drawables)
    for (const arr of [d.data?.positions, d.edges, d.lines])
      if (arr) for (let i = 0; i < arr.length; i += 3) points.push(at(arr, i));
  const top = linear(LOOK.top);
  const bottom = linear(LOOK.bottom);
  if (points.length === 0) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        for (let k = 0; k < 3; k++) t.rgb[3 * (y * W + x) + k] = top[k] + (bottom[k] - top[k]) * (y / H);
    return downsample(t, width, height, ss);
  }
  const cam = camera(points, view, W, H);

  type Face = { p: V3[]; n: V3[]; color: V3; alpha: number };
  const solids: Face[][] = [];
  for (const d of drawables) {
    if (!d.data) continue;
    const color = linear(d.style?.color ?? DEFAULT_COLORS.face);
    const alpha = d.style?.opacity ?? 1;
    const faces: Face[] = [];
    const { positions, normals } = d.data;
    for (let i = 0; i < positions.length; i += 9)
      faces.push({
        p: [at(positions, i), at(positions, i + 3), at(positions, i + 6)],
        n: [at(normals, i), at(normals, i + 3), at(normals, i + 6)],
        color,
        alpha,
      });
    solids.push(faces);
  }

  // Backdrop: the gradient, with the contact shadow on the floor under the model.
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points)
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], p[i]);
      hi[i] = Math.max(hi[i], p[i]);
    }
  const shadowAt = contactShadow(solids.flat(), lo, hi);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const g = y / H;
      let c: V3 = [0, 1, 2].map((k) => top[k] + (bottom[k] - top[k]) * g) as V3;
      const { o, dir } = cam.ray(x + 0.5, y + 0.5);
      if (Math.abs(dir[2]) > 1e-9) {
        const s = (lo[2] - o[2]) / dir[2];
        if (s > 0) {
          const q = add(o, scale(dir, s));
          c = scale(c, 1 - LOOK.shadow * shadowAt(q[0], q[1]));
        }
      }
      t.rgb.set(c, 3 * (y * W + x));
    }

  const drawFace = (f: Face, put: (i: number, d: number, c: V3) => void) => {
    const s = f.p.map((p) => cam.project(p));
    if (s.some((q) => q === null)) return;
    const [a, b, c] = s as Screen[];
    const flat = norm(cross(sub(f.p[1], f.p[0]), sub(f.p[2], f.p[0])));
    triangle(t, a, b, c, (i, d, wa, wb, wc) => {
      const n = norm([0, 1, 2].map((k) => wa * f.n[0][k] + wb * f.n[1][k] + wc * f.n[2][k]) as V3);
      const p: V3 = [0, 1, 2].map((k) => wa * f.p[0][k] + wb * f.p[1][k] + wc * f.p[2][k]) as V3;
      const v = cam.ortho ? scale(cam.forward, -1) : norm(sub(cam.eye, p));
      put(i, d, shade(f.color, dot(n, n) > 0.5 ? n : flat, v));
    });
  };

  // Opaque faces, then lines, then transparent faces (as the viewport orders them).
  for (const faces of solids)
    if ((faces[0]?.alpha ?? 1) >= 1)
      for (const f of faces)
        drawFace(f, (i, d, c) => {
          if (d >= t.depth[i]) return;
          t.depth[i] = d;
          t.rgb.set(c, 3 * i);
        });

  for (const d of drawables) {
    const segs = d.lines ?? (d.style?.edges === false ? undefined : d.edges);
    if (!segs) continue;
    const spec = d.lines ? d.style : d.style?.edges === false ? undefined : d.style?.edges;
    const color = linear(spec?.color ?? (d.lines ? DEFAULT_COLORS.sketch : LOOK.edge));
    const alpha = spec?.opacity ?? (d.lines || spec?.color ? 1 : LOOK.edgeOpacity);
    const w = (spec?.width ?? LINE_WIDTH) * ss;
    for (let i = 0; i < segs.length; i += 6) {
      const a = cam.project(at(segs, i));
      const b = cam.project(at(segs, i + 3));
      if (a && b) line(t, a, b, w, color, alpha, cam.bias);
    }
  }

  for (const faces of solids) {
    const alpha = faces[0]?.alpha ?? 1;
    if (alpha >= 1) continue;
    for (const side of ["back", "front"] as const) {
      const near = new Float32Array(W * H).fill(Infinity);
      const col = new Float32Array(W * H * 3);
      for (const f of faces) {
        const n = norm(cross(sub(f.p[1], f.p[0]), sub(f.p[2], f.p[0])));
        const toEye = cam.ortho ? scale(cam.forward, -1) : sub(cam.eye, f.p[0]);
        if ((dot(n, toEye) > 0 ? "front" : "back") !== side) continue;
        drawFace(f, (i, d, c) => {
          if (d >= t.depth[i] || d >= near[i]) return;
          near[i] = d;
          col.set(c, 3 * i);
        });
      }
      for (let i = 0; i < W * H; i++) {
        if (near[i] === Infinity) continue;
        t.depth[i] = near[i];
        for (let k = 0; k < 3; k++) t.rgb[3 * i + k] = col[3 * i + k] * alpha + t.rgb[3 * i + k] * (1 - alpha);
      }
    }
  }
  return downsample(t, width, height, ss);
}

function downsample(t: Target, width: number, height: number, ss: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const acc = [0, 0, 0];
      for (let j = 0; j < ss; j++)
        for (let i = 0; i < ss; i++) {
          const k = 3 * ((y * ss + j) * t.w + (x * ss + i));
          for (let c = 0; c < 3; c++) acc[c] += encode(t.rgb[k + c]);
        }
      const o = 4 * (y * width + x);
      for (let c = 0; c < 3; c++) out[o + c] = Math.round(acc[c] / (ss * ss));
      out[o + 3] = 255;
    }
  return out;
}
