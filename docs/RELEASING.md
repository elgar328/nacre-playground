# Releasing

How the playground's public pieces are published: the **site** on GitHub Pages (the app and
the example gallery) and the **showcase image** in the README. The playground has no version
releases and is not published to any registry. Every command below runs in `web/`.

## What is published, and from where

| Piece | Address | Built by | Published by |
|---|---|---|---|
| The app | `https://elgar328.github.io/nacre-playground/` | `npm run site` | the `gh-pages` branch |
| The gallery | `https://elgar328.github.io/nacre-playground/gallery/` | `npm run site` | the `gh-pages` branch |
| The README showcase | `https://github.com/elgar328/nacre-playground/releases/download/assets/showcase.png` | `npm run showcase` | the `assets` release |

- GitHub Pages serves the `gh-pages` branch as it is. That branch holds one commit, replaced
  on every deploy, so built files never pile up in history. Never edit it by hand.
- The site is built from the **main branches** of nacre, nacre-kit and this repository, not
  from crates.io releases. The playground depends on the kernel and the kit by path, so the
  three repositories must sit side by side in one folder.

## Examples

An example is a script in `examples/`, named by a number: `001.ts`, `002.ts`, …

- **The number is the example's identity.** It is the gallery's order and the app's link
  (`?example=3` opens `003.ts`; leading zeros do not matter). A number is never reused, so a
  link to an example stays valid. To retire an example, delete the file and leave its number
  unused.
- **Adding one** is saving the next number. Nothing else needs editing: the app bundles every
  file in `examples/`, the gallery renders each one, and the test suite runs, type-checks and
  marks each one (`web/tests/examples.ts`).
- An example is a plain playground script, the same thing you would paste into the editor.
  It may set `style(...)` and `view(...)`. The thumbnail keeps the colours, the edges, and the
  view's direction and projection, but frames the model on its own: `at` and `zoom` do not
  apply to it.

## The site

### Build and preview locally

```sh
npm run gallery        # only the gallery, into web/gallery/out: a quick look after editing an example
npm run site           # the whole site, into web/site
npm run site:preview   # serve web/site at http://localhost:4173
```

`npm run gallery` uses the WebAssembly already built, so run `npm run wasm:test` first if nacre
or nacre-kit changed.

`npm run site` does three things in order: both WebAssembly builds (`npm run wasm:all`), the
app (`vite build` into `site/`), and the gallery (`vite-node gallery/build.ts site/gallery`),
which runs every example and writes `site/gallery/` — one PNG per example, `manifest.json`,
and `index.html`.

The local build uses the nacre and nacre-kit **checked out beside this repository, as they
are**, uncommitted changes included. Use it to see a kernel change in the app and the
gallery before pushing anything.

- To open the preview on another device (a phone on the same tailnet), bind it to that
  address: `npx vite preview --outDir site --host <address>`.
- Asset paths are relative (`base: "./"` in `vite.config.ts`), so the same build works at
  the site root and under `/nacre-playground/`. Keep it that way: an absolute base breaks one
  of the two.

### A failed example

A failed example does **not** stop the build or the deploy. It becomes a red card on the
gallery page with the script's or the kernel's own sentence, and the page header counts the
failures. The CI run's summary lists each example with ✅ or ❌.

It is the test suite that refuses a failing example: `npm test` runs every one ("the
examples" in `tests/selectors.test.ts`). So a change in the playground that breaks an example
fails its tests, and a change in nacre or nacre-kit that breaks one shows up as a red card on
the next deploy.

### Deploy automatically (CI)

`.github/workflows/pages.yml` builds the site and deploys it. It runs:

- on every push to `main` of this repository;
- once a day (03:17 UTC), to pick up changes in nacre and nacre-kit, which cannot trigger it
  themselves;
- by hand: the Actions tab → **Pages** → **Run workflow**, or `gh workflow run pages.yml`.

The job checks out the three repositories side by side, installs Rust with the
`wasm32-unknown-unknown` target, wasm-pack and Node 22, runs `npm ci && npm run site`, and
then `npm run deploy` with a token in `DEPLOY_REMOTE`. After a change in nacre or
nacre-kit that should reach the site now rather than tomorrow, run it by hand.

Check a run with `gh run list --workflow pages.yml -L 3` and `gh run view <id>`.

### Deploy by hand (local)

```sh
npm run site
npm run deploy -- --dry-run   # show what would be deployed, push nothing
npm run deploy
```

This publishes **your local build**, including uncommitted changes in any of the three
repositories. The next CI run replaces it with a build of the main branches.

## The README showcase

The README's image is the `showcase.png` asset of the `assets` release. The repository holds
no image, and the README never changes when the image does.

```sh
npm run showcase -- 3 1 4                                   # web/gallery/out/showcase.png
gh release upload assets gallery/out/showcase.png --clobber
```

The arguments are example numbers, drawn left to right as 600 × 600 panels. GitHub shows the
image at about half that width, so it stays sharp on high-density screens. `--clobber` replaces the
file under the same name. GitHub caches README images for a few minutes, so the new one can
take a moment to appear.

The `assets` release is not a version of the playground; leave it out of anything that lists
versions, and never delete it — the README's link goes with it.

## Where things are

| Path | What it does |
|---|---|
| `examples/NNN.ts` | The example scripts |
| `web/src/app/examples.ts` | Bundles the examples into the app and reads `?example=N` |
| `web/gallery/run.ts` | Runs one example as the app does: script runtime, kit wasm (nodejs build), `collect` |
| `web/gallery/render.ts` | The software renderer; the thumbnail's look (backdrop, shadow, edges, exposure) is `LOOK` |
| `web/gallery/page.ts` | The gallery page's HTML |
| `web/gallery/build.ts` | `npm run gallery`: every example to a PNG, `manifest.json` and `index.html` |
| `web/gallery/showcase.ts` | `npm run showcase`: the README image |
| `web/scripts/deploy.ts` | `npm run deploy`: `web/site` to the `gh-pages` branch |
| `web/vite.config.ts` | Relative asset paths; lets the dev server read `examples/` |
| `.github/workflows/pages.yml` | The CI build and deploy |

The Node-side code (`gallery/`, `scripts/`) is type-checked by `npm run check` through
`web/tsconfig.node.json`.

## Two WebAssembly builds

The browser loads `web/src/wasm/pkg` (web target, `npm run wasm`); the tests and the gallery
load `web/src/wasm/pkg-node` (nodejs target, `npm run wasm:test`). They go stale
independently. After any change in nacre or nacre-kit, rebuild both with
`npm run wasm:all` before trusting `npm test`, the gallery or the dev server. `npm run site`
always rebuilds both.
