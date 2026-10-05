// Opening the shown part in step-loupe — the export menu's door to another app.
//
// step-loupe (the STEP viewer built on step-io) lives on this site's origin, so the two pages
// share `localStorage`: the STEP text goes in under a key, and step-loupe opens with `?from=` and
// that key's id. The address carries the id only, so a part of any size fits.
//
// **The contract is step-loupe's**, written once beside its reader in step-loupe's
// `src/index.html` ("optional hand-over from ?from=<id>"): the key's prefix, the value's shape,
// the read-and-remove, the ten-minute sweep. This module only follows it.

/** Where step-loupe is served. The door is offered only on this origin — elsewhere (the dev
 * server, a local preview) the storage is not step-loupe's. */
export const LOUPE_URL = "https://elgar328.github.io/step-loupe/";

/** The prefix step-loupe puts before every `?from=` id. */
const HANDOFF = "step-loupe:";

/** Whether a page at `origin` can hand step-loupe a file. */
export function loupeReachable(origin: string): boolean {
  return origin === new URL(LOUPE_URL).origin;
}

/** The two things the hand-over needs from the browser, given so a test can stand in. */
export interface Browser {
  storage: Pick<Storage, "setItem" | "removeItem">;
  /** Opens a tab and answers it, or `null` when the browser refused. */
  open: (url: string) => unknown;
}

/** **Hand `text` to step-loupe under `id`, and open it there.** Answers why it could not, or
 * `null`.
 *
 * Called inside the click: a browser opens a tab only for a press it has just seen, so nothing
 * here waits. The tab is opened without `noopener` — with it, `window.open` answers `null` every
 * time and a blocked tab could not be told apart. Both pages are this site's own. */
export function handOver(
  browser: Browser,
  id: string,
  name: string,
  text: string,
  now: number,
): string | null {
  const key = HANDOFF + id;
  try {
    browser.storage.setItem(key, JSON.stringify({ name, text, at: now }));
  } catch (e) {
    // A full quota, or a private window that keeps no storage.
    return `the browser would not keep the file for it (${e instanceof Error ? e.name : String(e)})`;
  }
  const url = `${LOUPE_URL}?from=${encodeURIComponent(id)}`;
  if (browser.open(url) === null) {
    browser.storage.removeItem(key);
    return "the browser blocked the new tab";
  }
  return null;
}
