// The desktop pane's width: drag the edge, and the viewport keeps the rest.
//
// The only state is the CSS variable `--pane`. Its limits live in the stylesheet
// (`clamp(280px, var(--pane), 70vw)`), so a narrowing window presses a stored width
// back down on its own — no resize listener, and no second copy of the rule here.

const KEY = "nacre-playground.pane";

/** localStorage throws in private mode; a forgotten width is not a broken app. */
function remember(px: number): void {
  try {
    localStorage.setItem(KEY, String(Math.round(px)));
  } catch {
    /* ignore */
  }
}

function recall(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    const px = raw === null ? NaN : Number(raw);
    return Number.isFinite(px) && px > 0 ? px : null;
  } catch {
    return null;
  }
}

/** Wire the edge. The sheet is never measured here — the pointer's own x is the
 * width, since the pane starts at the left edge of the window. */
export function makeResizer(edge: HTMLElement): void {
  const width = recall();
  if (width !== null) {
    document.documentElement.style.setProperty("--pane", `${width}px`);
  }

  let dragging = false;
  edge.addEventListener("pointerdown", (e) => {
    dragging = true;
    edge.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
    e.preventDefault();
  });
  edge.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    document.documentElement.style.setProperty("--pane", `${e.clientX}px`);
  });
  const release = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("resizing");
    if (edge.hasPointerCapture(e.pointerId)) edge.releasePointerCapture(e.pointerId);
    // Store what the stylesheet actually settled on, not the raw pointer position.
    const settled = (edge.previousElementSibling as HTMLElement | null)?.offsetWidth;
    if (settled) remember(settled);
  };
  edge.addEventListener("pointerup", release);
  edge.addEventListener("pointercancel", release);
}
