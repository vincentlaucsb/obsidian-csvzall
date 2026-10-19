import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pageUrl = "https://community.obsidian.md/plugins/csvzall";
const docsRepo = "obsidianmd/obsidian-developer-docs";
const guidance = [
  "en/Community directory/Developer policies.md",
  "en/Community directory/Submission requirements for plugins.md",
  "en/Plugins/Releasing/Plugin guidelines.md",
  "en/Plugins/Releasing/Submit your plugin.md",
  "en/Plugins/Guides/Migrate to declarative settings.md",
];

// Decode inert JSON records from server-rendered React data; never evaluate page scripts.
export function parseScorecard(html) {
  const stream = [...html.matchAll(/self\.__next_f\.push\((\[.*?\])\)<\/script>/gs)]
    .map(match => JSON.parse(match[1])).filter(chunk => chunk[0] === 1).map(chunk => chunk[1]).join("");
  const records = new Map();
  for (const line of stream.split("\n")) {
    const colon = line.indexOf(":");
    try { records.set(line.slice(0, colon), JSON.parse(line.slice(colon + 1))); }
    catch { /* Flight includes non-JSON records unrelated to the scorecard. */ }
  }
  const deref = value => typeof value === "string" && /^\$L[\da-f]+$/.test(value) ? records.get(value.slice(2)) : value;
  function render(value) {
    const resolved = deref(value);
    if (resolved !== value) {
      if (resolved === undefined) throw new Error(`Unresolved scorecard record: ${value}`);
      return render(resolved);
    }
    if (typeof value === "string") return value.startsWith("$") ? "" : value;
    if (typeof value === "number") return String(value);
    if (!Array.isArray(value)) return "";
    if (value[0] !== "$") return value.map(render).join("");
    const props = value[3] ?? {};
    const text = render(props.children);
    return props.href ? `[${text.trim()}](${props.href})` : text + (/^(div|p|h[1-6]|li|tr|section|summary)$/.test(value[1]) ? "\n" : "");
  }
  const scorecard = [...records.values()].find(value => Array.isArray(value) && value[3]?.id === "scorecard");
  if (!scorecard) throw new Error("Scorecard data missing. Inspect the Scorecard tab manually; do not assume zero warnings.");
  const findings = [];
  function visit(value) {
    value = deref(value);
    if (!Array.isArray(value)) return;
    if (value[0] === "$") {
      const key = value[2];
      if (typeof key === "string" && /^(?:pass|info|low|medium|high|critical):\d+:/.test(key)) {
        const [, severity, , message] = /^(\w+):(\d+):([\s\S]*)$/.exec(key);
        const summary = value[3]?.children?.find?.(child => Array.isArray(child) && child[1] === "summary");
        const badge = summary?.[3]?.children?.find?.(child => Array.isArray(child)
          && /\btabular-nums\b/.test(child[3]?.className ?? "") && typeof child[3]?.children === "number");
        const count = badge?.[3]?.children ?? 1;
        if (!Number.isSafeInteger(count) || count < 1) throw new Error("Invalid scorecard finding count.");
        findings.push({ severity, message, count, details: render(value).trim() });
      }
      visit(value[3]?.children);
    } else for (const child of value) visit(child);
  }
  visit(scorecard);
  if (!findings.length) throw new Error("Scorecard findings could not be decoded. Inspect the page manually.");
  const text = render(scorecard).replace(/\n{3,}/g, "\n\n").trim();
  const warningCount = /Warnings\s*(\d+)/.exec(text);
  if (warningCount && Number(warningCount[1]) !== findings.filter(item => !["pass", "info"].includes(item.severity))
    .reduce((total, item) => total + item.count, 0)) {
    throw new Error("Scorecard warning count changed or could not be fully decoded. Inspect the page manually.");
  }
  return { text, findings };
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "csvzall-obsidian-review" } });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return await response.text();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === "--warnings")) {
    throw new Error("Usage: npm run review:obsidian [-- --warnings path/to/feedback.txt]");
  }
  const output = resolve(root, ".test-build/obsidian-review");
  mkdirSync(output, { recursive: true });
  rmSync(resolve(output, "complete.json"), { force: true });
  rmSync(resolve(output, "findings.json"), { force: true });
  const evidence = { retrievedAt: new Date().toISOString(), sources: [] };
  function save(name, content, url) {
    const bytes = content.replace(/\r\n?/g, "\n");
    writeFileSync(resolve(output, name), bytes);
    evidence.sources.push({ file: name, url, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  if (args.length) {
    const input = resolve(args[1]);
    const feedback = readFileSync(input, "utf8");
    if (!feedback.trim()) throw new Error("Provided warning information is empty.");
    save("warnings.md", feedback, input);
  } else {
    const html = await download(pageUrl);
    save("community.html", html, pageUrl);
    const scorecard = parseScorecard(html);
    save("warnings.md", scorecard.text + "\n", pageUrl + "#scorecard");
    save("findings.json", JSON.stringify(scorecard.findings, null, 2) + "\n", pageUrl + "#scorecard");
    const warnings = scorecard.findings.filter(item => !["pass", "info"].includes(item.severity));
    console.log(`Retrieved ${warnings.reduce((total, item) => total + item.count, 0)} warnings in ${warnings.length} groups. Inspect warnings.md for details and locations.`);
  }
  const commit = JSON.parse(await download(`https://api.github.com/repos/${docsRepo}/commits/main`)).sha;
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Could not resolve the current official guidance revision.");
  evidence.guidanceCommit = commit;
  for (const path of guidance) {
    const url = `https://raw.githubusercontent.com/${docsRepo}/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const content = await download(url);
    if (content.length < 200 || /^\s*</.test(content)) throw new Error(`Unexpected guidance content: ${url}`);
    save(path.split("/").at(-1), content, url);
  }
  // Written last so interrupted/failed downloads cannot claim a complete refresh.
  writeFileSync(resolve(output, "complete.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(`Downloaded official guidance at ${commit}. Review evidence: ${output}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
