// The 3D viewport: flat-shaded soups in, orbitable scene out. The soups arrive
// unindexed with per-triangle normals; materials are double-sided so triangle winding
// carries no burden (the wasm side documents the same contract).

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ViewHelper } from "three/addons/helpers/ViewHelper.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { DEFAULT_VIEW, cameraShouldMove, directionFor } from "../api/view";
import type { ViewFrame, ViewSpec } from "../api/view";
import { fitDistance, fitHalfHeight, viewSpan } from "./frame";
import { makeInfiniteGrid } from "./grid";
import { LAYER, layeredLine, layeredMesh } from "./layers";

/** Which lens is in front of the scene. Orthographic is the CAD reading — parallel
 * edges stay parallel, so alignment and size can be judged by eye; perspective is the
 * photographic one. Position and target are shared; only the projection differs. */
export type Lens = "ortho" | "perspective";

/** Where the camera opens, when nothing has said otherwise. */
const DEFAULT_DIR = new THREE.Vector3(...directionFor(DEFAULT_VIEW.from));

/** A model edge, when the scene has not said otherwise: dark enough to read as a line
 * on any face colour a part is likely to be given. */
/** What the app draws with when a script says nothing.
 *
 * Named and exported so the API's own colour door can be pointed at them: with these
 * checked, **every colour the renderer receives is either one of these or one a script
 * wrote and the recorder read**. Three loose literals could not be asked that. */
export const DEFAULT_COLORS = {
  face: "#7fb2c8",
  sketch: "#e0b060",
  edge: "#222222",
} as const;

/** The six directions a gizmo handle can send the camera. */
const AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
}

export interface DisplayStyle {
  color?: string;
  opacity?: number;
  /** A sketch's own line width, in screen pixels. */
  width?: number;
  edges?: false | { color?: string; opacity?: number; width?: number };
}

/** One thing to draw: a solid (a mesh, and the model edges that bound it), or a
 * sketch (lines and nothing else — it has no faces to shade). `kind: "marker"` is the
 * app pointing at a place (a failure location): same lines path, but on the top layer
 * and ignoring the depth buffer, so it reads through the body it is on. */
export interface Drawable {
  data?: MeshData;
  edges?: Float32Array;
  lines?: Float32Array;
  style?: DisplayStyle;
  kind?: "marker";
}

/** An identity for the extent being framed. Compared, never read — its only job is to
 * tell "the model changed size" from "the script's colours changed". */
function boundsKey(b: THREE.Box3): string {
  return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z]
    .map((n) => n.toPrecision(9))
    .join(",");
}

export class Viewport {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private lens: Lens = DEFAULT_VIEW.projection;
  private fovDeg = DEFAULT_VIEW.fov;
  /** What the last run asked for, and what it was framing — the two halves of "is
   * there a reason to move?". Kept because a resize has to re-frame with the same
   * `at` and `zoom` the script asked for. */
  private last: ViewFrame | null = null;
  /** The radius of what is being framed — the orthographic far plane needs it, since
   * the model's depth does not shrink when you zoom in but the view's span does. */
  private modelRadius = 1;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private solids = new THREE.Group();
  private container: HTMLElement;
  /** Set while the cheat sheet covers the view: nothing to look at, nothing to draw. */
  private paused = false;
  /** What the camera is framing — kept so a resize can re-frame it. */
  private bounds: THREE.Box3 | null = null;
  private grid = makeInfiniteGrid();
  /** Fat lines are drawn in screen space, so their material has to be told how big
   * the canvas is — every resize, or the width drifts with the window. */
  private resolution = new THREE.Vector2(1, 1);
  private gizmo: ViewHelper;
  private clock = new THREE.Clock();
  /** A flight to an axis view, if one is running — in the orbit's own angles. */
  private fly: {
    from: { theta: number; phi: number };
    to: { theta: number; phi: number };
    radius: number;
    t: number;
  } | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.camera = this.makeCamera(this.lens, 1);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    // The frame is cleared once, by us. `ViewHelper.render` calls the renderer a
    // second time for its corner, and an automatic clear is not limited to the
    // viewport it is drawn in — with the default on, the gizmo wipes the scene we have
    // just drawn and leaves itself alone on a blank canvas.
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    // The gizmo lives in the canvas's bottom-right corner, where OrbitControls is
    // also listening — so this runs in the capture phase and keeps the event to
    // itself when the pointer is on the gizmo, or the view would orbit as you click.
    this.renderer.domElement.addEventListener(
      "pointerdown",
      (e) => {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const onGizmo =
          e.clientX >= rect.right - 128 && e.clientY >= rect.bottom - 128;
        if (!onGizmo) return;
        e.stopPropagation();
        const axis = this.pickGizmoAxis(e);
        if (axis) this.flyTo(axis);
      },
      { capture: true },
    );

    this.scene.background = new THREE.Color(0x16181d);
    this.scene.add(this.grid.mesh);
    // Orientation is the gizmo's job; "where is the origin" is the grid's, which
    // draws the two axis lines itself. An AxesHelper would try to be both.
    this.gizmo = new ViewHelper(this.camera, this.renderer.domElement);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(3, 2, 5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-4, -3, 2);
    this.scene.add(fill);
    this.scene.add(this.solids);

    const resize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      if (this.camera instanceof THREE.OrthographicCamera) {
        // Only the width follows the canvas here; `refit` below settles the height.
        this.camera.left = -this.camera.top * (w / h);
        this.camera.right = this.camera.top * (w / h);
      } else {
        this.camera.aspect = w / h;
      }
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      // Capped: a 3x phone screen drawing a full-page canvas at 3x is pure fill
      // rate — heat and frame time for a difference nobody sees.
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      // The shape of the canvas decides how far the camera must stand, so every
      // resize re-frames — which is also what makes "raise the sheet and the model
      // moves into what is left" true.
      this.resolution.set(w, h);
      this.solids.traverse((o) => {
        const m = (o as Partial<THREE.Mesh>).material;
        if (m && !Array.isArray(m) && m instanceof LineMaterial) {
          m.resolution.copy(this.resolution);
        }
      });
      this.refit();
    };
    new ResizeObserver(resize).observe(container);
    resize();
    this.camera.position.copy(DEFAULT_DIR).multiplyScalar(20);
    this.camera.lookAt(0, 0, 0);

    const tick = () => {
      requestAnimationFrame(tick);
      const delta = this.clock.getDelta();
      // While the gizmo flies the camera it writes position and orientation itself;
      // a damped OrbitControls pulling towards its own idea of where the camera goes
      // would fight it every frame. It picks the state back up afterwards, since it
      // re-reads position and target on each update.
      if (this.fly) this.advanceFlight(delta);
      else this.controls.update();
      this.tightenDepthRange();
      this.grid.update(this.camera.position, this.span());
      // Nothing worth a frame: a sliver of viewport (the sheet raised for typing),
      // or a cheat sheet covering it entirely. The gizmo rests under the same
      // condition — drawing it over a frozen frame would be worse than not at all.
      if (!this.paused && this.container.clientHeight >= 40) {
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
        // **Drawn at every size**, a phone's canvas included, though 128px is a third
        // of a narrow picture. A phone is where it earns that: there is no second view to
        // compare against and no key to press, so which way is up has only this to say
        // it. three's `ViewHelper` hard-codes the 128, so the choice is to show it or
        // not; the corner it takes is the same trade a desktop already makes.
        this.gizmo.render(this.renderer);
      }
    };
    tick();
  }

  private makeCamera(lens: Lens, aspect: number) {
    const camera =
      lens === "ortho"
        ? new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0, 10_000)
        : new THREE.PerspectiveCamera(this.fovDeg, aspect, 0.01, 10_000);
    // Never anything but +Z. OrbitControls freezes its orbit frame from `up` in its
    // constructor, so a camera turned on its side to make a top view read the right
    // way up would take every later drag with it. Screen-up at the poles is settled by
    // the azimuth instead — see `flyTo`.
    camera.up.set(0, 0, 1); // CAD convention: z is up
    return camera;
  }

  /** How much world the view spans where it is looking — the one quantity the grid and
   * the depth range need, and the one that means the same thing under either lens. */
  private span(): number {
    const ortho = this.camera instanceof THREE.OrthographicCamera;
    return viewSpan({
      ortho,
      distance: this.camera.position.distanceTo(this.controls.target),
      fovDeg: this.fovDeg,
      halfHeight: ortho ? (this.camera as THREE.OrthographicCamera).top : 1,
      zoom: this.camera.zoom,
    });
  }

  /** Change the lens (or, for a perspective one, its field of view). */
  setLens(lens: Lens, fovDeg = this.fovDeg): void {
    const fovChanged = fovDeg !== this.fovDeg;
    this.fovDeg = fovDeg;
    if (lens === this.lens) {
      if (fovChanged && this.camera instanceof THREE.PerspectiveCamera) {
        this.camera.fov = fovDeg;
        this.camera.updateProjectionMatrix();
        this.refit(); // the field of view is half of what "far enough back" means
      }
      return;
    }
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const target = this.controls.target.clone();
    const next = this.makeCamera(lens, w / h);
    next.position.copy(this.camera.position);
    this.lens = lens;
    this.camera = next;
    // Both of these captured the old camera — OrbitControls even took a copy of its
    // orbit frame — so they are rebuilt rather than re-pointed, and disposed rather
    // than dropped (listeners on one side, textures on the other).
    this.controls.dispose();
    this.gizmo.dispose();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.copy(target);
    this.gizmo = new ViewHelper(this.camera, this.renderer.domElement);
    this.fly = null; // a flight belongs to the camera that began it
    this.refit();
  }

  /** Replace what is displayed, and move the camera **if this run gave a reason to**
   * — the rule is `cameraShouldMove`, and the point of it is that pressing Run after
   * orbiting somewhere should not throw the angle away. */
  show(meshes: Drawable[], view: ViewSpec): void {
    // Give the last run's buffers back: `clear()` only unparents them, and this app
    // re-runs on every keystroke's worth of thought.
    this.solids.traverse((o) => {
      const m = o as Partial<THREE.Mesh>;
      m.geometry?.dispose();
      const material = m.material;
      if (Array.isArray(material)) material.forEach((x) => x.dispose());
      else material?.dispose();
    });
    this.solids.clear();
    const bounds = new THREE.Box3();
    for (const { data, edges, lines, style, kind } of meshes) {
      if (lines && lines.length > 0) {
        // A sketch contributes to the framing like anything else. It is easy to
        // grow bounds from meshes alone — and then a script that is only a sketch,
        // which is exactly what this feature is for, would frame nothing at all.
        const sketchGeometry = new LineSegmentsGeometry();
        sketchGeometry.setPositions(Array.from(lines));
        const sketchMaterial = layeredLine(
          kind === "marker" ? LAYER.marker : LAYER.sketch,
          {
            color: new THREE.Color(style?.color ?? DEFAULT_COLORS.sketch).getHex(),
            linewidth: style?.width ?? 1.5,
            opacity: style?.opacity ?? 1,
            transparent: (style?.opacity ?? 1) < 1,
            worldUnits: false,
            dashed: false,
          },
        );
        // A marker must stay visible where it matters most — inside or behind the very
        // body it is pointing into.
        if (kind === "marker") sketchMaterial.depthTest = false;
        sketchMaterial.resolution.copy(this.resolution);
        this.solids.add(new LineSegments2(sketchGeometry, sketchMaterial));
        for (let i = 0; i + 2 < lines.length; i += 3) {
          bounds.expandByPoint(
            new THREE.Vector3(lines[i], lines[i + 1], lines[i + 2]),
          );
        }
        continue;
      }
      if (!data) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
      const faceColor = new THREE.Color(style?.color ?? DEFAULT_COLORS.face);
      const material = layeredMesh(LAYER.faces, {
        color: faceColor,
        opacity: style?.opacity ?? 1,
        transparent: (style?.opacity ?? 1) < 1,
        side: THREE.DoubleSide,
        metalness: 0.05,
        roughness: 0.65,
      });
      const mesh = new THREE.Mesh(geometry, material);
      this.solids.add(mesh);

      if (edges && edges.length > 0 && style?.edges !== false) {
        const spec = style?.edges ?? {};
        const lineGeometry = new LineSegmentsGeometry();
        lineGeometry.setPositions(Array.from(edges));
        // Not a darkened face colour, though the theory for it is that a fixed dark
        // line would vanish against a near-black background wherever an edge is a
        // silhouette. Looked at, that reads too weakly: at 35% of a light blue face the
        // line is only a shade off it, and a silhouette does not vanish anyway — it
        // still has the face on one side of it. A flat near-black reads as a drawn
        // line on every face colour a part is likely to be given.
        const lineColor = new THREE.Color(spec.color ?? DEFAULT_COLORS.edge);
        const lineMaterial = layeredLine(LAYER.edges, {
          color: lineColor.getHex(),
          linewidth: spec.width ?? 1.5, // in screen pixels — hence `resolution`
          opacity: spec.opacity ?? 1,
          transparent: (spec.opacity ?? 1) < 1,
          worldUnits: false,
          dashed: false,
        });
        lineMaterial.resolution.copy(this.resolution);
        this.solids.add(new LineSegments2(lineGeometry, lineMaterial));
      }
      geometry.computeBoundingBox();
      if (geometry.boundingBox) bounds.union(geometry.boundingBox);
    }
    // Nothing to frame — a script whose every value was consumed. Leave the camera and
    // the extent it was framing exactly as they were; there is nothing to move towards.
    if (bounds.isEmpty()) return;
    const frame: ViewFrame = { spec: view, bounds: boundsKey(bounds) };
    const { move, useSpecDirection } = cameraShouldMove(this.last, frame);
    this.bounds = bounds;
    this.last = frame;
    this.setLens(view.projection, view.fov); // a no-op unless the script changed it
    if (move) this.fit(bounds, !useSpecDirection);
  }

  /** Which axis handle the pointer is on, in world terms — or nothing.
   *
   * The gizmo is drawn by an orthographic camera whose frustum is ±2, with the six
   * handles at unit distance along the world axes and the helper turned by the
   * camera's inverse rotation. So the handle a click lands on is found by turning each
   * axis the same way and comparing where it lands on that little screen. Where +Z and
   * −Z project to the same spot, the one facing the viewer wins.
   */
  private pickGizmoAxis(e: PointerEvent): THREE.Vector3 | null {
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const dim = 128;
    const originX = rect.left + (canvas.offsetWidth - dim);
    const originY = rect.top + (canvas.offsetHeight - dim);
    const gx = (((e.clientX - originX) / (rect.right - originX)) * 2 - 1) * 2;
    const gy = (-((e.clientY - originY) / (rect.bottom - originY)) * 2 + 1) * 2;

    const inverse = this.camera.quaternion.clone().invert();
    let best: THREE.Vector3 | null = null;
    let bestScore = Infinity;
    for (const axis of AXES) {
      const p = axis.clone().applyQuaternion(inverse);
      const away = Math.hypot(p.x - gx, p.y - gy);
      if (away > 0.6) continue;
      // Depth breaks the tie between an axis and its opposite: they land together.
      const score = away - p.z * 0.001;
      if (score < bestScore) {
        bestScore = score;
        best = axis;
      }
    }
    return best;
  }

  /** Swing the camera to look down `axis` at the same distance — clicking the axis
   * it is already on turns the part around and shows the other side.
   *
   * The flight is flown in **the orbit's own angles**, azimuth and elevation, and
   * the camera's roll is never written by us at all: `OrbitControls.update()` derives
   * it from the world up every frame, exactly as it does while dragging. That is what
   * keeps the flight from jumping. Interpolating the view *direction* and calling
   * `lookAt` ourselves looks equivalent, but at the poles that construction is degenerate
   * — three nudges it, the roll it picks there is unrelated to the one just either
   * side, and the view span-flips 180° on entering or leaving a top view.
   * Angles have no such seam: a top view is simply elevation ≈ 0 at whatever azimuth
   * the camera already had, so nothing spins on the way in.
   */
  private flyTo(axis: THREE.Vector3): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const radius = offset.length() || 1;
    const from = {
      theta: Math.atan2(offset.y, offset.x),
      phi: Math.acos(THREE.MathUtils.clamp(offset.z / radius, -1, 1)),
    };

    // Already there? Then this is the "show me the other side" click.
    const dir = offset.clone().normalize();
    const target = dir.dot(axis) > 0.99 ? axis.clone().negate() : axis.clone();

    const EPS = 1e-3; // never exactly at the pole, where azimuth stops meaning anything
    let to: { theta: number; phi: number };
    if (Math.abs(target.z) > 0.5) {
      // Straight down or straight up: keep the azimuth we have, so the view rises to
      // the top without spinning about itself on the way.
      to = { theta: from.theta, phi: target.z > 0 ? EPS : Math.PI - EPS };
    } else {
      to = { theta: Math.atan2(target.y, target.x), phi: Math.PI / 2 };
    }
    // Take the short way round.
    let turn = (to.theta - from.theta) % (Math.PI * 2);
    if (turn > Math.PI) turn -= Math.PI * 2;
    if (turn < -Math.PI) turn += Math.PI * 2;
    to.theta = from.theta + turn;

    this.fly = { from, to, radius, t: 0 };
  }

  private advanceFlight(delta: number): void {
    const fly = this.fly;
    if (!fly) return;
    fly.t = Math.min(1, fly.t + delta / 0.45);
    const e = fly.t * fly.t * (3 - 2 * fly.t); // ease in and out
    const theta = fly.from.theta + (fly.to.theta - fly.from.theta) * e;
    const phi = fly.from.phi + (fly.to.phi - fly.from.phi) * e;
    const sin = Math.sin(phi);
    this.camera.position.set(
      Math.cos(theta) * sin,
      Math.sin(theta) * sin,
      Math.cos(phi),
    );
    this.camera.position.multiplyScalar(fly.radius).add(this.controls.target);
    // The orbit does the looking — same function, every frame, so there is no seam
    // between flying and dragging.
    this.controls.update();
    if (fly.t >= 1) this.fly = null;
  }

  /** Keep the depth range close around what is being looked at.
   *
   * A near plane of 0.01 against a far plane of 10,000 spends almost all of the
   * depth buffer's precision on space nobody is in, and what is left cannot separate
   * two coplanar surfaces — which is why a polygon offset alone does not stop the grid
   * fighting the box's base: the offset is smaller than one step of a badly
   * stretched buffer. Tying the range to the viewing distance (a ten-thousandth of it
   * to a hundred times it) restores the precision the offset needs. */
  private tightenDepthRange(): void {
    const d = Math.max(this.camera.position.distanceTo(this.controls.target), 1e-3);
    if (this.camera instanceof THREE.OrthographicCamera) {
      // An orthographic buffer is linear, so the precision argument above does not
      // apply — but a near plane in front of the camera does something perspective
      // hides. Everything in the viewing column is on screen whatever its depth, so
      // the ground between the camera and the near plane is *cut*, and the grid ends
      // in a straight line across the view. Hence zero.
      //
      // The far plane clears two different things: the model, whose depth does not
      // change when you zoom, and the grid quad, which is sized from the span and does.
      const far = d + 3 * this.modelRadius + 12 * this.span();
      if (Math.abs(Math.log(far / this.camera.far)) < 0.35) return;
      this.camera.near = 0;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
      return;
    }
    const near = d * 0.01;
    // Only when it has really moved: rewriting the projection every frame buys
    // nothing and costs a matrix.
    if (Math.abs(Math.log(near / this.camera.near)) < 0.35) return;
    this.camera.near = near;
    this.camera.far = d * 100;
    this.camera.updateProjectionMatrix();
  }

  /** Stop drawing while something covers the view (the phone's battery notices). */
  setPaused(on: boolean): void {
    this.paused = on;
  }

  /** Re-frame what is already shown — after the canvas changed shape. */
  refit(): void {
    if (this.bounds) this.fit(this.bounds, true);
  }

  /** Point the camera at `bounds` from far enough that it fits the canvas as it is
   * now. `keepDirection` preserves whatever angle the user has orbited to — a resize
   * that snapped the view back to the opening angle would be its own bug. */
  private fit(bounds: THREE.Box3, keepDirection: boolean): void {
    const spec = this.last?.spec ?? DEFAULT_VIEW;
    // `at` moves the centre only; how much is in view still comes from the model's
    // size (and `zoom`), so naming a corner does not zoom into it by itself.
    const center = spec.at
      ? new THREE.Vector3(...spec.at)
      : bounds.getCenter(new THREE.Vector3());
    const radius = bounds.getSize(new THREE.Vector3()).length() / 2 || 1;
    this.modelRadius = radius;
    const dir = keepDirection
      ? this.camera.position.clone().sub(this.controls.target).normalize()
      : new THREE.Vector3(...directionFor(spec.from));
    if (dir.lengthSq() < 1e-12) dir.copy(DEFAULT_DIR);
    const aspect =
      (this.container.clientWidth || 1) / (this.container.clientHeight || 1);
    if (this.camera instanceof THREE.OrthographicCamera) {
      // Nothing to solve for here: the lens decides how big the model looks, so the
      // camera only has to stand clear of it — far enough to be outside, close enough
      // to keep the depth range short.
      // `zoom` divides the frame rather than setting `camera.zoom`, so the wheel — which
      // is what `camera.zoom` is for — still starts from 1 and stays the user's.
      const half = fitHalfHeight(radius, aspect) / spec.zoom;
      this.camera.top = half;
      this.camera.bottom = -half;
      this.camera.left = -half * aspect;
      this.camera.right = half * aspect;
      this.camera.zoom = 1;
      this.camera.position.copy(center).addScaledVector(dir, radius * 4);
      this.camera.updateProjectionMatrix();
    } else {
      const d = fitDistance(radius, this.fovDeg, aspect) / spec.zoom;
      this.camera.position.copy(center).addScaledVector(dir, d);
    }
    this.controls.target.copy(center);
    this.controls.update();
  }
}
