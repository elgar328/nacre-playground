// The mobile bottom sheet: the viewport is the page, the editor slides up over it.
//
// **The sheet's state is a stop *name*, never a pixel height.** Heights are derived
// from the space actually available (`visualViewport` — which shrinks when the on-screen
// keyboard opens, while `dvh` does not). Fixing a height in `dvh` and merely lifting the
// sheet above the keyboard would push its top off-screen; recomputing the stops instead
// makes "half" simply become a smaller half while the keyboard is up.
//
// The sheet is driven by `height` rather than `transform: translateY`: on iOS a fixed
// element inside a transformed ancestor misplaces the text caret, and CodeMirror is
// exactly that victim. The stops are heights anyway, so this is also the plainer road.

export type StopName = "peek" | "half" | "full";
export interface Stop {
  name: StopName;
  height: number;
}

/** The sheet's resting height.
 *
 * It is the grip's height **plus the sheet's own chrome** — the safe-area padding and
 * the borders. Leaving the chrome out makes the sheet eat itself: `border-box` takes
 * the padding out of the height, squeezing the grip, whose ResizeObserver then measures
 * smaller, and around it goes until nothing is left to grab. The floor is the
 * second line of defence: a mismeasurement must never lock the user out of the app.
 */
export function peekHeight(gripHeight: number, chrome: number, floor = 56): number {
  return Math.max(gripHeight + chrome, floor);
}

/** The three stops for the space at hand.
 *
 * `full` is all of it, not most of it: the stop exists for typing, and a strip of
 * viewport peeking above the editor is worth less than the two lines of code it costs
 * (on a phone with the keyboard up, `avail` is already halved). */
export function stopsFor(avail: number, gripHeight: number): Stop[] {
  const peek = Math.min(gripHeight, avail);
  return [
    { name: "peek", height: peek },
    { name: "half", height: Math.max(peek, avail * 0.55) },
    { name: "full", height: avail },
  ];
}

/** Where a released drag lands: the nearest stop, or — when the gesture was a flick —
 * the next stop in the flick's direction. `velocity` is px/ms, positive when the sheet
 * is growing (the finger moving up). */
export function snapTarget(height: number, velocity: number, stops: Stop[]): Stop {
  const FLICK = 0.4; // px/ms — above this the gesture states a direction
  const sorted = [...stops].sort((a, b) => a.height - b.height);
  const h = clampHeight(height, stops);
  let nearest = sorted[0];
  for (const s of sorted) {
    if (Math.abs(s.height - h) < Math.abs(nearest.height - h)) nearest = s;
  }
  if (Math.abs(velocity) < FLICK) return nearest;
  const i = sorted.indexOf(nearest);
  if (velocity > 0) {
    // Growing: if the nearest stop is at or below the finger, aim one higher.
    return sorted[Math.min(i + (sorted[i].height <= h ? 1 : 0), sorted.length - 1)];
  }
  return sorted[Math.max(i - (sorted[i].height >= h ? 1 : 0), 0)];
}

/** A drag never leaves the stop range. */
export function clampHeight(height: number, stops: Stop[]): number {
  const hs = stops.map((s) => s.height);
  return Math.min(Math.max(height, Math.min(...hs)), Math.max(...hs));
}

export interface SheetElements {
  sheet: HTMLElement;
  grip: HTMLElement;
  /** The element whose height defines `peek` (the grip's own block). */
  header: HTMLElement;
}

/** The width below which the editor becomes a sheet. The same question is asked in
 * CSS; asking it in one place here keeps the two answers from drifting. */
export const MOBILE = "(max-width: 820px)";

/** Wire the sheet up: measure, drag, snap, and follow the keyboard.
 *
 * On a desktop this object is **inert** — the pane is pure CSS there, and an inline
 * height written by this class would collapse the desktop pane to a two-line box (the
 * grip is measured, and a hidden grip measures zero). */
export class Sheet {
  private state: StopName = "half";
  private stops: Stop[] = [];
  private dragging = false;
  private readonly mq = window.matchMedia(MOBILE);

  /** Called whenever the sheet settles at a stop — CodeMirror needs to re-measure
   * after its container's height has moved (a container that passed through zero
   * leaves it rendering nothing). */
  constructor(
    private readonly el: SheetElements,
    private readonly onSettle: () => void = () => {},
  ) {
    new ResizeObserver(() => this.remeasure()).observe(el.header);
    window.visualViewport?.addEventListener("resize", () => this.remeasure());
    window.visualViewport?.addEventListener("scroll", () => this.remeasure());
    window.addEventListener("resize", () => this.remeasure());
    this.mq.addEventListener("change", () => this.remeasure());
    this.bindDrag();
    this.remeasure();
  }

  /** Put the sheet at a named stop (the app calls this after a run, and when the
   * editor takes focus). A no-op on the desktop. */
  goTo(name: StopName): void {
    if (!this.mq.matches) return;
    this.state = name;
    this.apply(true);
  }

  /** The height the sheet may divide up. There is nothing to subtract: the app has no
   * title bar — the toolbar lives inside the sheet itself, and it is measured as the
   * `peek` stop. */
  private available(): number {
    const vv = window.visualViewport;
    return Math.max(120, vv ? vv.height : window.innerHeight);
  }

  private remeasure(): void {
    if (!this.mq.matches) {
      // Hand the pane back to the stylesheet, completely.
      this.el.sheet.style.height = "";
      this.el.sheet.style.top = "";
      this.el.sheet.style.transition = "";
      document.documentElement.style.setProperty("--sheet-top", "0px");
      return;
    }
    const style = getComputedStyle(this.el.sheet);
    const chrome =
      parseFloat(style.paddingBottom || "0") +
      parseFloat(style.borderTopWidth || "0") +
      parseFloat(style.borderBottomWidth || "0");
    const grip = this.el.header.getBoundingClientRect().height;
    this.stops = stopsFor(this.available(), peekHeight(grip, chrome));
    if (!this.dragging) this.apply(false);
  }

  /** The bottom of what the reader can actually see, in the coordinates a fixed
   * element is placed in.
   *
   * `window.innerHeight` is **not** that number on iOS with `viewport-fit=cover`:
   * it counts the strip behind the browser's bottom bar, so anchoring the sheet with
   * `bottom: innerHeight − visualViewport.height` under-measured the keyboard by the
   * height of that bar — the sheet sat too low and left a band of viewport above it.
   * The visual viewport alone answers the question, so nothing else is asked. */
  private visibleBottom(): number {
    const vv = window.visualViewport;
    return vv ? vv.offsetTop + vv.height : window.innerHeight;
  }

  private apply(animate: boolean): void {
    const stop = this.stops.find((s) => s.name === this.state) ?? this.stops[0];
    const top = this.visibleBottom() - stop.height;
    this.el.sheet.style.transition = animate ? "height 220ms ease, top 220ms ease" : "none";
    this.el.sheet.style.height = `${stop.height}px`;
    this.el.sheet.style.top = `${top}px`;
    document.documentElement.style.setProperty("--sheet-top", `${top}px`);
    // What the sheet takes, the viewport gives up — and the viewport's own
    // ResizeObserver refits the camera into whatever is left. Written on settle
    // only: resizing the canvas every drag frame would cost more than it shows.
    document.documentElement.style.setProperty("--sheet", `${stop.height}px`);
    this.onSettle();
  }

  private bindDrag(): void {
    let startY = 0;
    let startH = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;

    this.el.grip.addEventListener("pointerdown", (e) => {
      // Buttons inside the grip keep their taps; the desktop grip is a toolbar.
      if (!this.mq.matches) return;
      if ((e.target as HTMLElement).closest("button")) return;
      this.dragging = true;
      startY = lastY = e.clientY;
      startH = this.el.sheet.getBoundingClientRect().height;
      lastT = e.timeStamp;
      velocity = 0;
      this.el.sheet.style.transition = "none";
      this.el.grip.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    this.el.grip.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dt = e.timeStamp - lastT;
      if (dt > 0) velocity = (lastY - e.clientY) / dt; // up (growing) is positive
      lastY = e.clientY;
      lastT = e.timeStamp;
      const h = clampHeight(startH + (startY - e.clientY), this.stops);
      this.el.sheet.style.height = `${h}px`;
      this.el.sheet.style.top = `${this.visibleBottom() - h}px`;
    });

    const release = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      // A tap (no real movement) toggles between peek and half. The sheet must be
      // operable even if a drag gesture is swallowed by the platform — being unable
      // to reach the editor at all is the failure this guards against.
      if (Math.abs(e.clientY - startY) < 6) {
        this.state = this.state === "peek" ? "half" : "peek";
        this.apply(true);
        if (this.el.grip.hasPointerCapture(e.pointerId))
          this.el.grip.releasePointerCapture(e.pointerId);
        return;
      }
      const h = this.el.sheet.getBoundingClientRect().height;
      this.state = snapTarget(h, velocity, this.stops).name;
      this.apply(true);
      if (this.el.grip.hasPointerCapture(e.pointerId))
        this.el.grip.releasePointerCapture(e.pointerId);
    };
    this.el.grip.addEventListener("pointerup", release);
    this.el.grip.addEventListener("pointercancel", release);
  }
}
