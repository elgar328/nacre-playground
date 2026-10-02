// The README's showcase: the chosen examples rendered side by side into one image.
//
//   npm run showcase -- 3 1 4
//   gh release upload assets gallery/out/showcase.png --clobber
//
// The README points at the `assets` release's `showcase.png`, so replacing that file is
// the whole update — the repository holds no image.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sceneOf } from "./run";
import { render } from "./render";
import { encodePng } from "./png";

const EXAMPLES = join(__dirname, "../../examples");
const OUT = join(__dirname, "out");
/** One panel, square; drawn at twice the size a README shows it, for sharp screens. */
const PANEL = 600;

const ids = process.argv.slice(2).map(Number);
if (ids.length === 0 || ids.some((n) => !Number.isInteger(n))) {
  console.error("usage: npm run showcase -- <example number> …");
  process.exit(2);
}
const width = PANEL * ids.length;
const image = new Uint8Array(width * PANEL * 4);
ids.forEach((id, k) => {
  const file = join(EXAMPLES, `${String(id).padStart(3, "0")}.ts`);
  const scene = sceneOf(readFileSync(file, "utf8"));
  if (!scene.ok) throw new Error(`example ${id}: ${scene.message}`);
  const panel = render(scene.meshes, scene.view, PANEL, PANEL);
  for (let y = 0; y < PANEL; y++)
    image.set(panel.subarray(y * PANEL * 4, (y + 1) * PANEL * 4), (y * width + k * PANEL) * 4);
});
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "showcase.png"), encodePng(image, width, PANEL));
console.log(`gallery/out/showcase.png (${width}×${PANEL}): ${ids.join(", ")}`);
