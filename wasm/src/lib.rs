//! The wasm boundary: run a step log, then ask about it.
//!
//! **Contract: the queries answer about the last successful `run`.** The TS runtime is
//! the only caller and is single-threaded, so it guarantees the run→query order. The
//! session cache is memoization — the kit's builds are deterministic (same steps,
//! same model, bit for bit), so caching changes nothing observable except time — with one
//! exception: [`export_step`] pays the kernel's export door, which may raise a cache from a
//! construction figure to the nearest `f64` of the same truth, and the queries after it read the
//! raised value. The mesh, once built, is kept; it is for viewing.
//!
//! The model never crosses the boundary. What crosses: a light summary per run
//! (rendered set, copies, reports), report-grade query rows (`vertices_of`/`faces_of`
//! — f64 to *choose* by, model indices to *state* with), and
//! a triangle soup per rendered value (`mesh_of`), each corner carrying its **surface's**
//! normal rather than its facet's.

use std::cell::RefCell;

use nacre::store::Handle;
use nacre::tess::{TessConfig, Tessellation, tessellate};
use nacre::topo::Solid;
use nacre_kit::{BuildOutput, KitError, Step, ValueId, build};
use serde::Serialize;
use wasm_bindgen::prelude::*;

struct Session {
    /// The identity of the steps this session built — the kit's own serde encoding,
    /// so equality means "the same program".
    key: String,
    out: BuildOutput,
    /// Lazily built on the first `mesh_of`, once per session (the tessellation covers
    /// the whole reachable model; per-value meshes are walks over it).
    tess: Option<Tessellation>,
}

thread_local! {
    static SESSION: RefCell<Option<Session>> = const { RefCell::new(None) };
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunSummary {
    ok: bool,
    rendered: Vec<u32>,
    auto_copies: Vec<usize>,
    /// Per step: `null`, or the boolean report the step aggregated.
    reports: Vec<Option<Report>>,
    /// Per step: `null`, or "solid" | "sketch" | "plane".
    values: Vec<Option<&'static str>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    merges: usize,
    coincidences: usize,
    closest_calls: Vec<String>,
}

/// **Which two script values the kernel would not combine.** The kit knows this
/// exactly (`KitError::Kernel { blame }`) and it travels here as data, not inside the
/// message text, where nothing could act on it. The app draws these two.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BlameJs {
    a: u32,
    b: u32,
    /// Which piece of each — `body k`, or `intermediate k` for a piece a fold made.
    detail: String,
}

/// **Where the kernel was looking when it refused** — the kit's `Mark`, flattened for JS:
/// `kind` is `"point"` or `"segment"`, `coords` holds one or two world points. The app draws
/// a marker there. (Not named `where`: main.ts already binds `where` for the step's name.)
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkJs {
    kind: &'static str,
    coords: Vec<[f64; 3]>,
}

impl MarkJs {
    fn of(m: nacre_kit::Mark) -> Self {
        match m {
            nacre_kit::Mark::Point(p) => MarkJs {
                kind: "point",
                coords: vec![p],
            },
            nacre_kit::Mark::Segment([a, b]) => MarkJs {
                kind: "segment",
                coords: vec![a, b],
            },
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunError {
    ok: bool,
    /// The failing step index — absent for a malformed steps payload.
    step: Option<usize>,
    message: String,
    /// Present only for a kernel rejection of a *pair*; a malformed program blames no
    /// two values, and the app falls back to drawing the prefix's own leaves.
    blame: Option<BlameJs>,
    /// The kernel's witness location, when the rejection carries one.
    mark: Option<MarkJs>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VertexRow {
    vertex: u32,
    at: [f64; 3],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FaceRow {
    face: u32,
    normal: Option<[f64; 3]>,
    center: [f64; 3],
    area: f64,
}

fn to_js<T: Serialize>(v: &T) -> JsValue {
    serde_wasm_bindgen::to_value(v).expect("serialization of plain data cannot fail")
}

fn err_js(step: Option<usize>, message: String, blame: Option<BlameJs>) -> JsValue {
    err_js_marked(step, message, blame, None)
}

fn err_js_marked(
    step: Option<usize>,
    message: String,
    blame: Option<BlameJs>,
    mark: Option<MarkJs>,
) -> JsValue {
    to_js(&RunError {
        ok: false,
        step,
        message,
        blame,
        mark,
    })
}

/// Read the step log **one step at a time**, so a malformed one is named by its index.
///
/// **Why not `from_value::<Vec<Step>>` in one call.** Its error has no index to give —
/// so a value of the wrong shape would reach the author as serde's sentence and nothing
/// else: no step, and therefore no line. Everything else that can go wrong here
/// (`KitError`) carries a step, and the app turns a step into the line the author wrote
/// (`app/summary.ts`). This makes the wire's failures answerable the same way. Measured:
/// `translate(a, ["1",0,0])` is an ordinary typo.
///
/// The index travels in the error's own field, never in the sentence — the same rule the
/// kit's `KitError` keeps. The app turns it into the line the author wrote, and a message
/// that also said it would make the panel state one fact twice.
///
/// Anything that is not an array has no index to name, so it keeps serde's sentence.
fn parse_steps(steps: JsValue) -> Result<Vec<Step>, JsValue> {
    let Some(arr) = steps.dyn_ref::<js_sys::Array>() else {
        return serde_wasm_bindgen::from_value(steps)
            .map_err(|e| err_js(None, format!("malformed steps: {e}"), None));
    };
    let mut out = Vec::with_capacity(arr.length() as usize);
    for (i, v) in arr.iter().enumerate() {
        match serde_wasm_bindgen::from_value::<Step>(v) {
            Ok(step) => out.push(step),
            Err(e) => return Err(err_js(Some(i), format!("malformed step: {e}"), None)),
        }
    }
    Ok(out)
}

/// Build the first `upto` steps (all when absent). Re-running the same program is a
/// cache hit; a failed run leaves the previous session in place (the queries keep
/// answering about the last *successful* run).
#[wasm_bindgen]
pub fn run(steps: JsValue, upto: Option<usize>) -> JsValue {
    let steps: Vec<Step> = match parse_steps(steps) {
        Ok(s) => s,
        Err(e) => return e,
    };
    let key = match serde_json::to_string(&(&steps, upto)) {
        Ok(k) => k,
        Err(e) => return err_js(None, format!("unencodable steps: {e}"), None),
    };
    let hit = SESSION.with(|s| {
        s.borrow()
            .as_ref()
            .is_some_and(|session| session.key == key)
    });
    if !hit {
        let out = match build(&steps, upto) {
            Ok(out) => out,
            Err(e) => {
                let step = Some(e.step());
                let blame = match &e {
                    KitError::Kernel { blame: Some(b), .. } => Some(BlameJs {
                        a: b.a.0,
                        b: b.b.0,
                        detail: b.detail.clone(),
                    }),
                    _ => None,
                };
                let mark = match &e {
                    KitError::Kernel { mark: Some(m), .. } => Some(MarkJs::of(*m)),
                    _ => None,
                };
                return err_js_marked(step, e.to_string(), blame, mark);
            }
        };
        SESSION.with(|s| {
            *s.borrow_mut() = Some(Session {
                key,
                out,
                tess: None,
            });
        });
    }
    SESSION.with(|s| {
        let s = s.borrow();
        let session = s.as_ref().expect("just stored or hit");
        let out = &session.out;
        to_js(&RunSummary {
            ok: true,
            rendered: out.rendered.iter().map(|v| v.0).collect(),
            auto_copies: out.auto_copies.clone(),
            reports: out
                .reports
                .iter()
                .map(|r| {
                    r.as_ref().map(|r| Report {
                        merges: r.merges,
                        coincidences: r.coincidences,
                        closest_calls: r.closest_calls.clone(),
                    })
                })
                .collect(),
            values: out
                .values
                .iter()
                .map(|v| {
                    v.as_ref().map(|v| {
                        if v.as_solid().is_some() {
                            "solid"
                        } else if v.as_sketch().is_some() {
                            "sketch"
                        } else {
                            "plane"
                        }
                    })
                })
                .collect(),
        })
    })
}

/// The vertices of a solid value of the last run — `null` when there is no session,
/// no such value, or it is not a solid.
#[wasm_bindgen]
pub fn vertices_of(id: u32) -> JsValue {
    SESSION.with(|s| {
        let s = s.borrow();
        match s.as_ref().and_then(|se| se.out.vertices_of(ValueId(id))) {
            Some(vs) => to_js(
                &vs.iter()
                    .map(|v| VertexRow {
                        vertex: v.vertex,
                        at: v.at,
                    })
                    .collect::<Vec<_>>(),
            ),
            None => JsValue::NULL,
        }
    })
}

/// **One vertex's coordinate, realized to `places` decimal places** — `null` as for
/// [`vertices_of`], and also when the kernel declines to realize that vertex.
///
/// Unlike every other query here this does not read the report cache: the kernel realizes from the
/// vertex's definition and rounds once, so the digits mean something past f64's seventeen. It is a
/// diagnostic — the script picks the vertex the usual way, by appearance.
#[wasm_bindgen]
pub fn vertex_decimal(id: u32, vertex: u32, places: usize) -> JsValue {
    SESSION.with(|s| {
        let s = s.borrow();
        match s
            .as_ref()
            .and_then(|se| se.out.vertex_decimal(ValueId(id), vertex, places))
        {
            Some(d) => to_js(&d),
            None => JsValue::NULL,
        }
    })
}

/// **How many bodies a solid value has** — `null` as for [`vertices_of`].
///
/// A boolean can answer with several solids, and a script needs the count before it can
/// point at one of them. Counting builds nothing: the value is already holding the list.
#[wasm_bindgen]
pub fn bodies_of(id: u32) -> JsValue {
    SESSION.with(|s| {
        let s = s.borrow();
        match s.as_ref().and_then(|se| se.out.body_count_of(ValueId(id))) {
            Some(n) => to_js(&n),
            None => JsValue::NULL,
        }
    })
}

/// The faces of a solid value of the last run — `null` as for [`vertices_of`].
#[wasm_bindgen]
pub fn faces_of(id: u32) -> JsValue {
    SESSION.with(|s| {
        let s = s.borrow();
        match s.as_ref().and_then(|se| se.out.faces_of(ValueId(id))) {
            Some(fs) => to_js(
                &fs.iter()
                    .map(|f| FaceRow {
                        face: f.face,
                        normal: f.normal,
                        center: f.center,
                        area: f.area,
                    })
                    .collect::<Vec<_>>(),
            ),
            None => JsValue::NULL,
        }
    })
}

/// The session's mesh, built on first use — once per session, over the whole reachable model
/// (per-value meshes and files are walks over it) — with the build it was made from. The error is
/// the `{ ok: false, message }` a query hands back when the tessellation refuses.
fn session_mesh(session: &mut Session) -> Result<(&BuildOutput, &Tessellation), JsValue> {
    if session.tess.is_none() {
        match tessellate(&session.out.model, &TessConfig::default()) {
            Ok(t) => session.tess = Some(t),
            Err(e) => return Err(err_js(None, format!("tessellation refused: {e:?}"), None)),
        }
    }
    let session: &Session = session;
    Ok((&session.out, session.tess.as_ref().expect("just built")))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileOk {
    ok: bool,
    text: String,
    /// Caches the export door left at their construction figure (undecided or unrealized) — `0`
    /// for every model the corpus builds; the app says so when it is not.
    left: usize,
}

/// **The shown solids of the last run as a STEP file** — `{ ok: true, text, left }`, or
/// `{ ok: false, message }` when the writer refuses; `null` with no session. "STEP" is the file
/// format here, never a script step.
///
/// `timestamp` goes into the header verbatim: the kernel reads no clock (this target has none —
/// asking the system for the time panics here), so the app passes its own.
///
/// The kit's export pays the kernel's export door first, which can raise the session model's
/// caches (a construction figure to the nearest `f64` of the same truth); later queries read the
/// raised values. The mesh is not rebuilt — it is for viewing.
#[wasm_bindgen]
pub fn export_step(timestamp: String) -> JsValue {
    SESSION.with(|s| {
        let mut s = s.borrow_mut();
        let Some(session) = s.as_mut() else {
            return JsValue::NULL;
        };
        match session.out.export_step(&timestamp) {
            Ok(file) => {
                let r = file.refine;
                let left = r.vertices.left_undecided
                    + r.vertices.left_unrealized
                    + r.surfaces.left_undecided
                    + r.surfaces.left_unrealized
                    + r.edges.left_undecided
                    + r.edges.left_unrealized;
                to_js(&FileOk {
                    ok: true,
                    text: file.text,
                    left,
                })
            }
            Err(e) => err_js(None, format!("STEP export refused: {e:?}"), None),
        }
    })
}

/// **The shown solids of the last run as an OBJ file** — the same triangles the viewport draws
/// (the session's mesh), each corner with its face's normal. `{ ok: true, text, left: 0 }`, or
/// `{ ok: false, message }` when the tessellation refuses; `null` with no session.
#[wasm_bindgen]
pub fn export_obj() -> JsValue {
    SESSION.with(|s| {
        let mut s = s.borrow_mut();
        let Some(session) = s.as_mut() else {
            return JsValue::NULL;
        };
        let (out, tess) = match session_mesh(session) {
            Ok(m) => m,
            Err(e) => return e,
        };
        to_js(&FileOk {
            ok: true,
            text: tess.to_obj_solids(&out.model, &out.rendered_bodies()),
            left: 0,
        })
    })
}

/// A triangle soup of a solid value of the last run: unindexed positions and per-**corner**
/// normals as `Float32Array`s (the viewer draws it double-sided, so the winding carries no
/// burden).
///
/// The normals come from the *surface*, not from the triangle: a facet normal is an
/// approximation of a curved face, and the kernel knows the exact one
/// (`props::face_normal_at`). A cylinder is therefore lit as round without a single extra
/// triangle, while a planar face — whose normal does not vary — is unchanged. `null` when the value is missing or not a solid;
/// `{ ok: false, message }` when the tessellation itself refuses.
#[wasm_bindgen]
pub fn mesh_of(id: u32) -> JsValue {
    SESSION.with(|s| {
        let mut s = s.borrow_mut();
        let Some(session) = s.as_mut() else {
            return JsValue::NULL;
        };
        let Some(bodies) = session
            .out
            .values
            .get(id as usize)
            .and_then(|v| v.as_ref())
            .and_then(|v| v.as_solid())
            .map(|sv| sv.bodies.clone())
        else {
            return JsValue::NULL;
        };
        let (out, tess) = match session_mesh(session) {
            Ok(m) => m,
            Err(e) => return e,
        };
        let (positions, normals) = soup(&out.model, tess, &bodies);
        let obj = js_sys::Object::new();
        let set = |k: &str, v: &[f32]| {
            js_sys::Reflect::set(
                &obj,
                &JsValue::from_str(k),
                &js_sys::Float32Array::from(v).into(),
            )
            .expect("plain object set cannot fail");
        };
        set("positions", &positions);
        set("normals", &normals);
        js_sys::Reflect::set(&obj, &JsValue::from_str("ok"), &JsValue::TRUE)
            .expect("plain object set cannot fail");
        obj.into()
    })
}

/// A sketch's segments, in world coordinates on the plane it was drawn on.
///
/// `null` for a value that is not a sketch, and for a sketch whose plane cannot be
/// realized — a viewer that cannot place a thing should draw nothing rather than draw
/// it somewhere wrong.
#[wasm_bindgen]
pub fn sketch_of(id: u32) -> JsValue {
    SESSION.with(|s| {
        let s = s.borrow();
        let Some(lines) = s.as_ref().and_then(|se| se.out.sketch_lines(ValueId(id))) else {
            return JsValue::NULL;
        };
        let mut positions: Vec<f32> = Vec::with_capacity(lines.len() * 6);
        for [a, b] in &lines {
            for p in [a, b] {
                positions.extend(p.iter().map(|&x| x as f32));
            }
        }
        let obj = js_sys::Object::new();
        js_sys::Reflect::set(
            &obj,
            &JsValue::from_str("positions"),
            &js_sys::Float32Array::from(&positions[..]).into(),
        )
        .expect("plain object set cannot fail");
        js_sys::Reflect::set(&obj, &JsValue::from_str("ok"), &JsValue::TRUE)
            .expect("plain object set cannot fail");
        obj.into()
    })
}

/// The model's own edges for a value: every edge its faces use, as line segments.
///
/// `null` when the value is missing or not a solid; `{ ok: false, message }` when the
/// tessellation refuses.
#[wasm_bindgen]
pub fn edges_of(id: u32) -> JsValue {
    SESSION.with(|s| {
        let mut s = s.borrow_mut();
        let Some(session) = s.as_mut() else {
            return JsValue::NULL;
        };
        let Some(bodies) = session
            .out
            .values
            .get(id as usize)
            .and_then(|v| v.as_ref())
            .and_then(|v| v.as_solid())
            .map(|sv| sv.bodies.clone())
        else {
            return JsValue::NULL;
        };
        let (out, tess) = match session_mesh(session) {
            Ok(m) => m,
            Err(e) => return e,
        };
        let positions = edge_segments(&out.model, tess, &bodies);
        let obj = js_sys::Object::new();
        js_sys::Reflect::set(
            &obj,
            &JsValue::from_str("positions"),
            &js_sys::Float32Array::from(&positions[..]).into(),
        )
        .expect("plain object set cannot fail");
        js_sys::Reflect::set(&obj, &JsValue::from_str("ok"), &JsValue::TRUE)
            .expect("plain object set cannot fail");
        obj.into()
    })
}

/// Every edge of the value's bodies, sampled, as pairs of points. Every edge is drawn: an edge
/// separates two faces' surfaces, and the kernel builds none that separates a surface from
/// itself (a cylinder's side is bounded by its two rims, with no seam edge).
fn edge_segments(
    model: &nacre::topo::Model,
    tess: &Tessellation,
    bodies: &[Handle<Solid>],
) -> Vec<f32> {
    let mut seen: std::collections::HashSet<u32> = std::collections::HashSet::new();
    let mut out: Vec<f32> = Vec::new();
    for &body in bodies {
        let solid = model.solid(body);
        for sh in std::iter::once(solid.outer).chain(solid.cavities.iter().copied()) {
            for &fh in &model.shell(sh).faces {
                let face = model.face(fh);
                for lp in std::iter::once(&face.outer).chain(face.inner.iter()) {
                    for he in &lp.half_edges {
                        if !seen.insert(he.edge.index()) {
                            continue; // two faces share every edge
                        }
                        let edge = model.edge(he.edge);
                        let Some(polyline) = tess.by_edge.get(&he.edge) else {
                            continue;
                        };
                        let mut segment = |a, b| {
                            for vh in [a, b] {
                                let p = tess.vertices.get(vh).pos.as_array();
                                out.extend(p.iter().map(|&x| x as f32));
                            }
                        };
                        for pair in polyline.windows(2) {
                            segment(pair[0], pair[1]);
                        }
                        // **A closed edge's polyline does not repeat its first point, so
                        // `windows(2)` leaves exactly one segment undrawn** — the gap a plain
                        // cylinder's rim showed. The kernel's rings are closed *implicitly*
                        // (`nacre_tess::sample_edge`'s full-rim arm samples `0 .. (n−1)τ/n` and
                        // stops; `boundary_ring` drops the wrap-around duplicate for the same
                        // reason), and `edge.vertices[0] == edge.vertices[1]` is the kernel's own
                        // spelling for "this edge closes" — the very test that arm branches on.
                        //
                        // Only an **uncut** rim is affected: a rim a boolean split arrives as
                        // arcs whose endpoints differ, and consecutive arcs share endpoints, so
                        // the ring closes itself. Measured before the fix: a plain cylinder drew
                        // 358 segments over 360 points with four degree-1 ends; a box drew 12 over
                        // 8 with every corner at degree 3, unchanged.
                        if edge.vertices[0] == edge.vertices[1] && polyline.len() > 2 {
                            segment(polyline[polyline.len() - 1], polyline[0]);
                        }
                    }
                }
            }
        }
    }
    out
}

/// Flat-shaded soup for one value's bodies: walk its shells' faces, collect their
/// triangles from the shared tessellation, and give every corner its triangle's
/// cross-product normal.
fn soup(
    model: &nacre::topo::Model,
    tess: &Tessellation,
    bodies: &[Handle<Solid>],
) -> (Vec<f32>, Vec<f32>) {
    let mut positions: Vec<f32> = Vec::new();
    let mut normals: Vec<f32> = Vec::new();
    for &body in bodies {
        let solid = model.solid(body);
        for sh in std::iter::once(solid.outer).chain(solid.cavities.iter().copied()) {
            for &fh in &model.shell(sh).faces {
                let Some(tris) = tess.by_face.get(&fh) else {
                    continue;
                };
                for &th in tris {
                    let tri = tess.triangles.get(th);
                    let p: Vec<nacre::math::Point3> = tri
                        .vertices
                        .iter()
                        .map(|&vh| tess.vertices.get(vh).pos)
                        .collect();
                    // **The surface's own normal at each corner, not the triangle's.**
                    // A flat facet normal is an *approximation* of a curved face; the kernel
                    // knows the exact one (a cylinder's is radial), and it costs no extra
                    // triangles to send it — 180 facets stop reading as 180 facets. The face's
                    // orientation is applied inside `face_normal_at`, so a bore's wall comes
                    // back facing its axis, which is what it does.
                    let fallback = || {
                        // Only for a corner with no direction to name (a point on a cylinder's
                        // axis, which the mesh does not produce). The triangle's own plane.
                        let (a, b, c) = (p[0].as_array(), p[1].as_array(), p[2].as_array());
                        let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
                        let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
                        let cross = [
                            u[1] * v[2] - u[2] * v[1],
                            u[2] * v[0] - u[0] * v[2],
                            u[0] * v[1] - u[1] * v[0],
                        ];
                        let len = (cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2])
                            .sqrt();
                        if len > f64::EPSILON {
                            [cross[0] / len, cross[1] / len, cross[2] / len]
                        } else {
                            [0.0, 0.0, 1.0]
                        }
                    };
                    for corner in &p {
                        let n = nacre::props::face_normal_at(model, fh, *corner)
                            .map(|v| v.as_array())
                            .unwrap_or_else(fallback);
                        positions.extend(corner.as_array().iter().map(|&x| x as f32));
                        normals.extend(n.iter().map(|&x| x as f32));
                    }
                }
            }
        }
    }
    (positions, normals)
}
