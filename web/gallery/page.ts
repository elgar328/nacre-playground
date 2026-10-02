// The gallery page: one card per example, linking to the app opened on it. A failed
// example is a red card with the kernel's or the script's own sentence, so a change that
// breaks an example shows the moment the site is rebuilt.

import { execSync } from "node:child_process";
import { join } from "node:path";

export interface Entry {
  id: number;
  ok: boolean;
  message?: string;
  ms: number;
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The short commit of a sibling checkout, or "?" when it is not a git repository. */
function commit(dir: string): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: dir }).toString().trim();
  } catch {
    return "?";
  }
}

export function galleryPage(entries: Entry[], root: string): string {
  const repos = ["nacre", "nacre-kit", "nacre-playground"].map((r) => {
    const sha = commit(join(root, r));
    const link = sha === "?" ? sha : `<a href="https://github.com/elgar328/${r}/commit/${sha}">${sha}</a>`;
    return `${r} ${link}`;
  });
  const failed = entries.filter((e) => !e.ok).length;
  const cards = [...entries]
    .sort((a, b) => a.id - b.id)
    .map((e) =>
      e.ok
        ? `<a class="card" href="../?example=${e.id}"><img src="${e.id}.png" alt="Example ${e.id}" loading="lazy"><span>Example ${e.id}</span></a>`
        : `<a class="card failed" href="../?example=${e.id}"><div class="error">${escape(e.message ?? "failed")}</div><span>Example ${e.id} · failed</span></a>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>nacre-playground gallery</title>
<style>
  body { margin: 0; font: 15px/1.5 -apple-system, system-ui, sans-serif; color: #1f2328; background: #eef0f3; }
  header { padding: 20px 20px 8px; max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  header p { margin: 0; color: #59636e; font-size: 13px; }
  header a { color: inherit; }
  .status { margin-top: 6px; font-weight: 600; color: ${failed ? "#c62828" : "#2e7d32"}; }
  main { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); padding: 16px 20px 40px; max-width: 1200px; margin: 0 auto; }
  .card { display: block; background: #fff; border-radius: 12px; overflow: hidden; text-decoration: none; color: inherit; box-shadow: 0 1px 3px rgba(0,0,0,.08); transition: box-shadow .15s, transform .15s; }
  .card:hover { box-shadow: 0 4px 14px rgba(0,0,0,.14); transform: translateY(-1px); }
  .card img { display: block; width: 100%; aspect-ratio: 4 / 3; }
  .card span { display: block; padding: 8px 12px; font-size: 14px; }
  .failed { outline: 2px solid #e53935; }
  .failed span { color: #c62828; font-weight: 600; }
  .error { aspect-ratio: 4 / 3; padding: 14px; box-sizing: border-box; overflow: auto; background: #fdecea; color: #8e1c1c; font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
</style>
<header>
  <h1>nacre-playground gallery</h1>
  <p>Every example, built and rendered from ${repos.join(" · ")}. Click one to open it in the <a href="../">playground</a>.</p>
  <p class="status">${failed ? `${failed} of ${entries.length} failed` : `All ${entries.length} build`}</p>
</header>
<main>
${cards}
</main>
</html>
`;
}
