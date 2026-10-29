#!/usr/bin/env node
// Checks every https://docs.moderationapi.com/... link in skills/** and
// README.md. Fails when a link does not end in a 200.
//
// Redirects are followed. A link that redirects to a 200 passes with a
// warning that names the new URL, so it can be updated; a link that redirects
// to an error fails. The bare docs root is expected to redirect and gets no
// warning.
//
// No dependencies: Node 20+ (built-in fetch). Run from the repo root:
//   node scripts/check-docs-links.mjs

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ROOTS = ["skills", "README.md"];
// The lookahead skips other hosts such as docs.moderationapi.com.example.
const DOCS_URL =
  /https:\/\/docs\.moderationapi\.com(?![\w-]|\.[\w-])(?:[/?#][^\s<>"'`()[\]{}]*)?/g;
const CONCURRENCY = 4;
const TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 1_000;
const inGitHubActions = process.env.GITHUB_ACTIONS === "true";

async function listFiles(entry) {
  const info = await readdir(entry, { withFileTypes: true, recursive: true }).catch(
    (error) => (error.code === "ENOTDIR" ? null : Promise.reject(error)),
  );
  if (info === null) return [entry];
  return info
    .filter((dirent) => dirent.isFile())
    .map((dirent) => path.join(dirent.parentPath, dirent.name));
}

// Markdown often puts punctuation right after a URL ("see https://.../x.md.").
function cleanUrl(url) {
  return url.replace(/[.,;:!?]+$/, "");
}

async function collectLinks() {
  const links = new Map(); // url -> [{ file, line }]
  for (const root of ROOTS) {
    for (const file of await listFiles(root)) {
      const lines = (await readFile(file, "utf8")).split("\n");
      lines.forEach((text, index) => {
        for (const match of text.matchAll(DOCS_URL)) {
          const url = cleanUrl(match[0]);
          if (!links.has(url)) links.set(url, []);
          links.get(url).push({ file, line: index + 1 });
        }
      });
    }
  }
  return links;
}

function isRoot(url) {
  const { pathname, search, hash } = new URL(url);
  return pathname === "/" && !search && !hash;
}

async function fetchOnce(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "moderation-api-skills-link-check" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await response.body?.cancel();
  return response;
}

// Retry once on network errors and on 429/5xx, which are usually transient.
async function check(url) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchOnce(url);
      const transient = response.status === 429 || response.status >= 500;
      if (!transient || attempt === 2) {
        return {
          ok: response.status === 200,
          status: response.status,
          finalUrl: response.redirected ? response.url : undefined,
        };
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
  const cause = lastError?.cause?.code ?? lastError?.name ?? "error";
  return { ok: false, status: `network error (${cause})` };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function report(level, { file, line }, message) {
  if (inGitHubActions) {
    console.log(`::${level} file=${file},line=${line}::${message}`);
  } else {
    console.log(`${level.toUpperCase()} ${file}:${line} ${message}`);
  }
}

const links = await collectLinks();
const urls = [...links.keys()].sort();
const results = await mapLimit(urls, CONCURRENCY, check);

let broken = 0;
let redirected = 0;
urls.forEach((url, index) => {
  const result = results[index];
  const where = links.get(url);
  if (!result.ok) {
    broken += 1;
    const via = result.finalUrl ? ` after redirect to ${result.finalUrl}` : "";
    for (const location of where) report("error", location, `${url} returned ${result.status}${via}`);
  } else if (result.finalUrl && !isRoot(url)) {
    redirected += 1;
    for (const location of where) report("warning", location, `${url} redirects to ${result.finalUrl}`);
  }
  console.log(`${result.ok ? "ok  " : "FAIL"} ${result.status} ${url}`);
});

console.log(
  `\nChecked ${urls.length} unique docs links (${[...links.values()].flat().length} occurrences): ` +
    `${broken} broken, ${redirected} redirected.`,
);
if (urls.length === 0) {
  console.log("No docs links found. Did the files move?");
  process.exitCode = 1;
}
if (broken > 0) process.exitCode = 1;
