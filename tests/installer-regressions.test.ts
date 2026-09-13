import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { get } from "node:https";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { csvzallInstallTarget, fetchUrlAsBuffer, selectCsvzallReleaseAsset } from "../src/installer.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/settings/settings.js";

test("Windows asset selection excludes Darwin and partial architecture labels", () => {
  const asset = (name: string) => ({ name, browser_download_url: `https://example.com/${name}` });
  const darwin = asset("csvzall-obsidian-darwin-x64.zip");
  const windows = asset("csvzall-windows-x86_64.zip");
  assert.equal(selectCsvzallReleaseAsset({ assets: [darwin, windows] }, csvzallInstallTarget("win32", "x64")).name, windows.name);
  assert.throws(() => selectCsvzallReleaseAsset({ assets: [darwin] }, csvzallInstallTarget("win32", "x64")), /No csvzall release asset/);
});

function transport(run: (response: EventEmitter & { complete: boolean }) => void) {
  const request = new EventEmitter() as EventEmitter & { destroy: (error: Error) => void };
  let destroyed = false;
  request.destroy = (error) => { destroyed = true; request.emit("error", error); };
  const fakeGet = ((_url: string, _options: unknown, callback: (response: unknown) => void) => {
    queueMicrotask(() => {
      const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: {}, complete: false });
      callback(response);
      run(response);
    });
    return request;
  }) as unknown as typeof get;
  return { request: fakeGet, destroyed: () => destroyed };
}

for (const event of ["error", "aborted", "close"]) {
  test(`Downloads reject on response ${event}`, async () => {
    const fake = transport((response) => {
      response.emit("data", Buffer.from("partial"));
      response.emit(event, new Error("stream failed"));
    });
    await assert.rejects(fetchUrlAsBuffer("https://example.com", 5, { request: fake.request, timeoutMs: 100 }), /failed|aborted|closed/);
  });
}

test("Downloads time out and destroy a stalled request", async () => {
  const fake = transport(() => {});
  await assert.rejects(fetchUrlAsBuffer("https://example.com", 5, { request: fake.request, timeoutMs: 10 }), /timed out/);
  assert.equal(fake.destroyed(), true);
});

test("Redirects dispose unused bodies and ignore late errors from the old request", async () => {
  let destroyed = false;
  const redirected = transport((response) => {
    response.emit("data", "redirected");
    response.complete = true;
    response.emit("end");
  });
  const request = new EventEmitter();
  const fakeGet = ((url: string, options: unknown, callback: (response: unknown) => void) => {
    if (url.endsWith("/target")) return (redirected.request as Function)(url, options, callback);
    queueMicrotask(() => {
      const response = Object.assign(new EventEmitter(), { statusCode: 302, headers: { location: "/target" }, destroy: () => {
        destroyed = true;
        queueMicrotask(() => { response.emit("error", new Error("old response")); request.emit("error", new Error("old request")); });
      } });
      callback(response);
    });
    return request;
  }) as unknown as typeof get;
  assert.equal((await fetchUrlAsBuffer("https://example.com/start", 5, { request: fakeGet })).toString(), "redirected");
  assert.equal(destroyed, true);
});

test("HTTP errors dispose unused response bodies", async () => {
  let destroyed = false;
  const fakeGet = ((_url: string, _options: unknown, callback: (response: unknown) => void) => {
    queueMicrotask(() => callback(Object.assign(new EventEmitter(), { statusCode: 500, headers: {}, destroy: () => { destroyed = true; } })));
    return new EventEmitter();
  }) as unknown as typeof get;
  await assert.rejects(fetchUrlAsBuffer("https://example.com", 5, { request: fakeGet }), /HTTP 500/);
  assert.equal(destroyed, true);
});

test("Complete downloads return their bytes and incomplete end rejects", async () => {
  const fake = transport((response) => {
    response.emit("data", Buffer.from("complete"));
    response.complete = true;
    response.emit("end");
    response.emit("close");
  });
  assert.equal((await fetchUrlAsBuffer("https://example.com", 5, { request: fake.request })).toString(), "complete");
  const incomplete = transport((response) => response.emit("end"));
  await assert.rejects(fetchUrlAsBuffer("https://example.com", 5, { request: incomplete.request }), /Incomplete/);
});

test("Persisted settings reject malformed paths, flags, timeouts and log entries", () => {
  const settings = normalizeSettings({ csvzallPath: null, openInObsidian: "false", startupTimeoutMs: Infinity,
    eventLog: [null, {}, { timestamp: "now", level: "info", message: "valid" }, { timestamp: "now", level: "error", message: "bad", detail: 123 }] });
  assert.equal(settings.csvzallPath, DEFAULT_SETTINGS.csvzallPath);
  assert.equal(settings.openInObsidian, true);
  assert.equal(settings.startupTimeoutMs, DEFAULT_SETTINGS.startupTimeoutMs);
  assert.deepEqual(settings.eventLog, [{ timestamp: "now", level: "info", message: "valid" }]);
  assert.equal(normalizeSettings({ csvzallPath: " ", startupTimeoutMs: -1 }).csvzallPath, "csvzall");
  assert.equal(normalizeSettings({ startupTimeoutMs: 2147483648 }).startupTimeoutMs, DEFAULT_SETTINGS.startupTimeoutMs);
});

test("Installer repairs a missing executable even when release metadata is current", async () => {
  const bundle = await build({ entryPoints: ["src/installer/InstallerService.ts"], bundle: true, platform: "node", format: "cjs", write: false,
    external: ["obsidian", "../installer.js"] });
  const realRequire = createRequire(import.meta.url);
  for (const exists of [false, true]) {
    let installs = 0;
    const module = { exports: {} as { InstallerService: new (...args: unknown[]) => { installDesktopCsvzall(): Promise<boolean> } } };
    runInNewContext(bundle.outputFiles![0]!.text, { module, exports: module.exports, console, require: (name: string) => {
      if (name === "obsidian") return { Platform: { isDesktopApp: true }, Notice: class {} };
      if (name === "fs/promises") return { stat: async () => { if (!exists) throw new Error("missing"); return { isFile: () => true }; } };
      if (name === "../installer.js") return {
        getLatestCsvzallReleaseInfo: async () => ({ tagName: "v1", assetName: "asset" }),
        installCsvzallBinary: async () => { installs++; return { executablePath: "repaired", tagName: "v1", assetName: "asset", sha256: "hash" }; },
      };
      return realRequire(name);
    } });
    const settings = { ...DEFAULT_SETTINGS, csvzallPath: "missing", installedCsvzallVersion: "v1", installedCsvzallAssetName: "asset" };
    const service = new module.exports.InstallerService(() => settings, async () => {}, { record: async () => {} }, { getPluginDataDir: () => "plugin" });
    assert.equal(await service.installDesktopCsvzall(), true);
    assert.equal(installs, exists ? 0 : 1);
    assert.equal(settings.csvzallPath, exists ? "missing" : "repaired");
  }
});
