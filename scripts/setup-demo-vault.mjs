import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--binary")) {
  throw new Error("Usage: node scripts/setup-demo-vault.mjs [--binary <csvzall executable>]");
}
const binary = args.length ? resolve(args[1]) : null;
if (binary && (!existsSync(binary) || !lstatSync(binary).isFile())) {
  throw new Error(`The csvzall executable does not exist: ${binary}`);
}
const vault = join(root, "demo-vault");
const config = join(vault, ".obsidian");
const plugin = join(config, "plugins", "csvzall");
const files = ["main.js", "manifest.json", "styles.css"];
// Never follow an existing plugin/vault junction into another vault's settings.
for (const path of [vault, config, join(config, "plugins"), plugin]) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) {
    throw new Error(`Expected an ordinary directory; refusing to replace or follow: ${path}`);
  }
}
for (const file of files) {
  const source = join(root, file);
  if (!existsSync(source)) throw new Error(`Missing ${file}; run npm run build first.`);
  const target = join(plugin, file);
  const stat = lstatSync(target, { throwIfNoEntry: false });
  if (stat && (!stat.isSymbolicLink() || !existsSync(target) || realpathSync(target) !== realpathSync(source))) {
    throw new Error(`Refusing to replace an existing unrelated plugin file: ${target}`);
  }
}
for (const path of [join(config, "community-plugins.json"), join(plugin, "data.json")]) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) {
    throw new Error(`Expected an ordinary settings file; refusing to follow: ${path}`);
  }
}
mkdirSync(plugin, { recursive: true });
for (const file of files) {
  const target = join(plugin, file);
  if (!existsSync(target)) {
    try {
      symlinkSync(join(root, file), target, "file");
    } catch (error) {
      throw new Error("Could not link the development build. On Windows enable Developer Mode or run this setup from an elevated terminal.", { cause: error });
    }
  }
}
const enabledPath = join(config, "community-plugins.json");
const enabled = existsSync(enabledPath) ? JSON.parse(readFileSync(enabledPath, "utf8")) : [];
if (!Array.isArray(enabled)) throw new Error("community-plugins.json must contain an array.");
if (!enabled.includes("csvzall")) {
  writeFileSync(enabledPath, JSON.stringify([...enabled, "csvzall"], null, 2) + "\n");
}
if (binary) {
  const settingsPath = join(plugin, "data.json");
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
  if (!settings || Array.isArray(settings) || typeof settings !== "object") {
    throw new Error("Plugin data.json must contain an object.");
  }
  writeFileSync(settingsPath, JSON.stringify({ ...settings, csvzallPath: binary }, null, 2) + "\n");
}
console.log(`Demo vault ready: ${vault}`);
console.log("Open this folder as an Obsidian vault and enable community plugins. Reload Obsidian after rebuilding; reopen CSV panes to restart the viewer.");
console.log(binary ? `Using csvzall: ${binary}` : "Existing plugin settings are preserved. Select your local csvzall executable in the plugin settings if needed.");
