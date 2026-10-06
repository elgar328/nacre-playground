// Deploys the built site (web/site, from `npm run site`) to the gh-pages branch as a single
// orphan commit, replacing whatever was there. GitHub Pages serves that branch.
//
//   npm run deploy               # build first: npm run site
//   npm run deploy -- --dry-run  # assemble the commit, show it, push nothing
//
// DEPLOY_REMOTE overrides the push URL (CI passes one carrying its token);
// GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL override the commit's author.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const web = join(__dirname, "..");
const site = join(web, "site");
const dry = process.argv.includes("--dry-run");
const git = (args: string[], cwd = web) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

if (!existsSync(join(site, "index.html")) || !existsSync(join(site, "gallery", "index.html"))) {
  console.error("Missing web/site (run 'npm run site' first)");
  process.exit(1);
}

const remote = process.env.DEPLOY_REMOTE ?? git(["remote", "get-url", "origin"]);
const source = git(["rev-parse", "--short", "HEAD"]);
const name = process.env.GIT_AUTHOR_NAME ?? git(["config", "user.name"]);
const email = process.env.GIT_AUTHOR_EMAIL ?? git(["config", "user.email"]);

const dir = mkdtempSync(join(tmpdir(), "nacre-pages-"));
try {
  git(["init", "-q", "-b", "gh-pages"], dir);
  cpSync(site, dir, { recursive: true });
  writeFileSync(join(dir, ".nojekyll"), ""); // serve files as they are; no Jekyll processing
  // Umami analytics goes into the hosted copy only: the source and a local build stay
  // analytics-free. It follows the `<title>`, which both pages have; the gallery leaves its
  // `<head>` tags out, so there is no `</head>` to place it before.
  const snippet = readFileSync(join(__dirname, "analytics.html"), "utf8");
  for (const page of ["index.html", join("gallery", "index.html")]) {
    const file = join(dir, page);
    const html = readFileSync(file, "utf8");
    if (!html.includes("</title>")) throw new Error(`no </title> to inject after in ${page}`);
    writeFileSync(file, html.replace("</title>", "</title>\n" + snippet));
  }
  git(["add", "-A"], dir);
  git(["-c", `user.name=${name}`, "-c", `user.email=${email}`, "commit", "-q", "-m", `Deploy site from ${source}`], dir);
  if (dry) {
    console.log(git(["show", "--stat", "--oneline", "HEAD"], dir));
    console.log("(dry run: nothing pushed)");
  } else {
    git(["push", "-q", "-f", remote, "gh-pages"], dir);
    console.log(`Deployed site from ${source} to gh-pages`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
