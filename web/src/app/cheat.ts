// The cheat sheet panel — what it says. The frame it says it in is `./overlay.ts`.

import { CHEAT, CHEAT_FOOTER } from "./cheatsheet";
import { makeOverlay } from "./overlay";
import type { OverlayHooks } from "./overlay";

export interface CheatPanel {
  toggle(): void;
  close(): void;
  isOpen(): boolean;
}

export type CheatHooks = OverlayHooks;

/** Build the panel inside `host` (the viewport) and wire its ways out. `onChange` is
 * told whenever it opens or closes — the app uses it to rest the render loop and, on
 * a phone, to lower the sheet so there is something to read into. */
export function makeCheatPanel(
  host: HTMLElement,
  button: HTMLElement,
  hooks: CheatHooks,
): CheatPanel {
  const panel = makeOverlay(host, "cheat", button, { onChange: hooks.onChange });
  const body = panel.body;

  // Built with textContent, never innerHTML: the examples carry `<` and `>`
  // (`f => f.center.z`), and escaping by hand is the kind of thing one forgets.
  for (const group of CHEAT) {
    const h = document.createElement("h2");
    h.textContent = group.title;
    body.appendChild(h);
    const list = document.createElement("dl");
    for (const row of group.rows) {
      const dt = document.createElement("dt");
      if (row.code) {
        const code = document.createElement("code");
        code.textContent = row.code;
        dt.appendChild(code);
      }
      const dd = document.createElement("dd");
      dd.textContent = row.note;
      list.append(dt, dd);
    }
    body.appendChild(list);
  }
  const footer = document.createElement("p");
  footer.className = "foot";
  footer.textContent = CHEAT_FOOTER;
  body.appendChild(footer);

  return panel;
}
