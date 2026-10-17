// Packaging only. The shared upstream shell owns all appearance and behavior.
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireHostIntegration } from "./wasm-viewer-contract.mjs";

const viewerDir = "wasm-viewer";
const assetsDir = join(viewerDir, "assets");
const indexPath = join(viewerDir, "index.html");
const assets = readdirSync(assetsDir);
const bundleName = assets.find(name => /^index-.*\.js$/.test(name));
const stylesheetName = assets.find(name => /^index-.*\.css$/.test(name));
if (!bundleName) throw new Error("Missing WASM viewer JavaScript bundle");
requireHostIntegration(readFileSync(join(assetsDir, bundleName), "utf8"));
let html = readFileSync(indexPath, "utf8").replace(/\r\n?/g, "\n");
const attr = "data-csvzall-inline-viewer-style";
if (stylesheetName) {
  const css = readFileSync(join(assetsDir, stylesheetName), "utf8");
  const escaped = stylesheetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const link = new RegExp(`<link[^>]+href=["']\\./assets/${escaped}["'][^>]*>`);
  if (!link.test(html)) throw new Error("Missing viewer stylesheet link");
  html = html.replace(link, `<style ${attr}>\n${css}\n</style>`);
  writeFileSync(indexPath, html);
  rmSync(join(assetsDir, stylesheetName));
} else if (!html.includes(`<style ${attr}>`)) {
  throw new Error("Missing packaged viewer stylesheet");
}
console.log("Inlined shared viewer styles; JavaScript and CSS bytes left unchanged.");
