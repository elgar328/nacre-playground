// The frame a panel that covers the 3D view is built in — the part that has nothing to
// do with what the panel says.
//
// That placement is the whole design: on a desktop the code stays visible beside it
// (reading while typing is the point), and on a phone it fills the area above the sheet.
// `#viewport` is a positioned ancestor in both layouts, so one absolutely positioned
// child lands correctly in both — no media query.
//
// The cheat sheet and the output panel share it, because the second panel would
// otherwise be a copy: the same aside, the same close button in the same place
// for the same hard-won reason, the same Escape handling. A copy is two places to fix
// the next time the frame is wrong, and the reasoning below would only survive in one
// of them.

export interface Overlay {
  /** The scrolling region the caller fills. */
  body: HTMLElement;
  toggle(): void;
  close(): void;
  isOpen(): boolean;
}

export interface OverlayHooks {
  /** Told whenever the panel opens or closes. */
  onChange: (open: boolean) => void;
}

/** Build a covering panel inside `host` (the viewport). `id` names it and its parts —
 * `#cheat`, `#cheat-close`, `#cheat-body` — so the stylesheet addresses each panel by
 * its own name. */
export function makeOverlay(
  host: HTMLElement,
  id: string,
  button: HTMLElement,
  hooks: OverlayHooks,
): Overlay {
  const panel = document.createElement("aside");
  panel.id = id;
  panel.hidden = true;

  // The close button sits in the frame, not in the scrolling body: an absolutely
  // positioned child of a scroll container is placed against the *content*, so it
  // would slide into the middle of the page as soon as a wide line is scrolled sideways.
  const close = document.createElement("button");
  close.className = "btn ghost";
  close.id = `${id}-close`;
  close.textContent = "×";
  close.title = "close (Esc)";
  panel.appendChild(close);

  const body = document.createElement("div");
  body.id = `${id}-body`;
  panel.appendChild(body);
  host.appendChild(panel);

  // The button that opens a panel says whether that panel is **open** — a real state,
  // not a hover. Without it the only thing lighting the button would be `:hover`, so on
  // a desktop a click that leaves the pointer where it was would look exactly the same
  // whether the panel had just opened or just closed.
  button.setAttribute("aria-pressed", "false");

  const set = (open: boolean) => {
    panel.hidden = !open;
    button.setAttribute("aria-pressed", String(open));
    if (open) body.scrollTo(0, 0);
    hooks.onChange(open);
  };

  close.addEventListener("click", () => set(false));
  // Escape is CodeMirror's key too (closing completions and the like), so this only
  // acts — and only consumes the event — while the panel is actually open.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) {
      e.preventDefault();
      set(false);
    }
  });

  return {
    body,
    toggle: () => set(panel.hidden),
    close: () => {
      if (!panel.hidden) set(false);
    },
    isOpen: () => !panel.hidden,
  };
}
