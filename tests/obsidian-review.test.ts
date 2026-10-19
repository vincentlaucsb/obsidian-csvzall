import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const script = pathToFileURL(resolve("scripts/prepare-obsidian-review.mjs")).href;
const element = (tag: string, key: string | null, children: unknown, props = {}) => ["$", tag, key, { ...props, children }];
const flight = (records: string[]) => records.map(record => `<script>self.__next_f.push(${JSON.stringify([1, record])})</script>`).join("");
function parse(html: string): { findings: Array<{ severity: string; message: string; count: number; details: string }> } {
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e",
    "const {parseScorecard} = await import(process.argv[1]); console.log(JSON.stringify(parseScorecard(process.argv[2])));",
    script, html,
  ], { encoding: "utf8", stdio: "pipe" }));
}

test("scorecard extraction retains warnings and locations across streamed JSON records without executing page scripts", () => {
  const card = element("div", null, [element("h3", null, ["Warnings", 1]), "$L2"], { id: "scorecard" });
  const finding = element("details", "medium:0:Use an instanceof check", ["Use an instanceof check", "$L3"]);
  const link = element("a", null, "src/test.ts:12", { href: "https://github.com/example/repo/blob/abc/src/test.ts#L12" });
  const data = `1:${JSON.stringify(card)}\n2:${JSON.stringify(finding)}\n3:${JSON.stringify(link)}\n`;
  const html = `<script>throw new Error('Never evaluate page scripts');</script>` + flight([data.slice(0, 75), data.slice(75)]);
  const result = parse(html);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]!.severity, "medium");
  assert.equal(result.findings[0]!.message, "Use an instanceof check");
  assert.match(result.findings[0]!.details, /src\/test.ts:12.*#L12/);
});

test("missing or incomplete scorecard data cannot be mistaken for zero warnings", () => {
  assert.throws(() => parse("<html>No scorecard</html>"), /Scorecard data missing/);
  const card = element("div", null, [element("h3", null, ["Warnings", 2]),
    element("div", "medium:0:Only one decoded", "Only one decoded")], { id: "scorecard" });
  assert.throws(() => parse(flight([`1:${JSON.stringify(card)}\n`])), /warning count/);
  const incomplete = element("div", null, "$L9", { id: "scorecard" });
  assert.throws(() => parse(flight([`1:${JSON.stringify(incomplete)}\n`])), /could not be decoded|Unresolved/);
});

test("grouped occurrences count toward warnings while disclosures remain separate", () => {
  const grouped = element("details", "medium:0:Unbound method", [
    element("summary", null, ["Unbound method", element("span", null, 2, { className: "tabular-nums" })]),
    element("div", null, "src/one.ts:1 src/two.ts:2"),
  ]);
  const card = element("div", null, [element("h3", null, ["Warnings", 3]), grouped,
    element("div", "medium:1:Capability", "Capability"),
    element("div", "info:0:Disclosure", "Disclosure")], { id: "scorecard" });
  const result = parse(flight([`1:${JSON.stringify(card)}\n`]));
  assert.deepEqual(result.findings.map(item => item.count), [2, 1, 1]);
  assert.match(result.findings[0]!.details, /src\/one.ts:1 src\/two.ts:2/);
  const incomplete = element("div", null, [element("h3", null, ["Warnings", 4]), grouped,
    element("div", "medium:1:Capability", "Capability")], { id: "scorecard" });
  assert.throws(() => parse(flight([`1:${JSON.stringify(incomplete)}\n`])), /warning count/);
});
