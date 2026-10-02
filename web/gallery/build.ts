// Run every example in ../examples, render a thumbnail of what it draws, and write the
// images, a manifest and the gallery page to the output directory (default: gallery/out).
//
//   npm run gallery [-- out-dir]
//
// An example is `examples/NNN.ts`: the number is its identity (`?example=N`), so adding one
// is saving the next number. Numbers are never reused, so a link to one stays valid.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { sceneOf } from "./run";
import { render } from "./render";
import { encodePng } from "./png";
import { galleryPage } from "./page";
import type { Entry } from "./page";

const EXAMPLES = join(__dirname, "../../examples");
const OUT = process.argv[2] ?? join(__dirname, "out");
const WIDTH = 640;
const HEIGHT = 480;

mkdirSync(OUT, { recursive: true });
const entries: Entry[] = [];
for (const file of readdirSync(EXAMPLES).filter((f) => /^\d+\.ts$/.test(f)).sort()) {
  const id = Number(basename(file, ".ts"));
  const t0 = performance.now();
  const scene = sceneOf(readFileSync(join(EXAMPLES, file), "utf8"));
  const entry: Entry = { id, ok: scene.ok, ms: 0 };
  if (scene.ok) {
    const rgba = render(scene.meshes, scene.view, WIDTH, HEIGHT);
    writeFileSync(join(OUT, `${id}.png`), encodePng(rgba, WIDTH, HEIGHT));
  } else {
    entry.message = scene.message;
  }
  entry.ms = Math.round(performance.now() - t0);
  entries.push(entry);
  console.log(`${entry.ok ? "ok  " : "FAIL"} ${id} (${entry.ms} ms)${entry.message ? ` — ${entry.message}` : ""}`);
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(entries, null, 2));
writeFileSync(join(OUT, "index.html"), galleryPage(entries, join(__dirname, "../../..")));
// A failed example does not fail the build: the site still deploys, and the failure is a
// red card on the gallery page. The test suite is what refuses a failing example.
const failed = entries.filter((e) => !e.ok).length;
if (failed) console.log(`${failed} of ${entries.length} examples failed`);
