import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const assetsDir = join("wasm-viewer", "assets");
const bundleName = readdirSync(assetsDir).find((name) => /^index-.*\.js$/.test(name));
const stylesheetName = readdirSync(assetsDir).find((name) => /^index-.*\.css$/.test(name));

if (!bundleName) {
  throw new Error("WASM viewer bridge patch failed: missing index JavaScript bundle");
}
if (!stylesheetName) {
  throw new Error("WASM viewer bridge patch failed: missing index stylesheet bundle");
}

const bundlePath = join(assetsDir, bundleName);
const stylesheetPath = join(assetsDir, stylesheetName);
let text = readFileSync(bundlePath, "utf8");
const compactStyleId = "csvzall-obsidian-host-compact-v1";
const mobileBehaviorId = "csvzall-obsidian-mobile-behavior-v1";
const viewportResizeId = "csvzall-obsidian-viewport-resize-v2";
const keyboardFocusId = "csvzall-obsidian-keyboard-focus-v1";
const keyboardLifecycleId = "csvzall-obsidian-keyboard-lifecycle-v2";
const compactStyle = `
.csvzall-obsidian-host .topbar,
body[data-host-mode] .topbar {
  align-items: stretch;
  gap: .35rem;
  padding: .35rem .5rem;
}
.csvzall-obsidian-host .topbar h1,
body[data-host-mode] .topbar h1 {
  display: none;
}
.csvzall-obsidian-host .topbar p,
body[data-host-mode] .topbar p {
  display: none;
  margin: 0;
  overflow: hidden;
  font-size: .78rem;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csvzall-obsidian-host .actions,
body[data-host-mode] .actions {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: .35rem;
}
.csvzall-obsidian-host button,
.csvzall-obsidian-host .file-picker span,
body[data-host-mode] button,
body[data-host-mode] .file-picker span {
  min-height: 32px;
  padding: .3rem .45rem;
  font-size: .8rem;
}
.csvzall-obsidian-host footer,
body[data-host-mode] footer {
  min-height: 1rem;
  padding: .2rem .5rem;
  font-size: .75rem;
}
html.csvzall-obsidian-host,
html.csvzall-obsidian-host body {
  height: 100%;
  min-height: 100%;
  overflow: hidden;
}
body[data-host-mode] {
  height: 100vh;
  min-height: 100vh;
  overflow: hidden;
}
body[data-host-mode] main {
  min-height: 0;
}
body[data-host-mode] #grid {
  height: 100%;
}
`.replace(/\s+/g, " ").trim();
const hostModeHelpers = `const csvzallObsidianHostStyleId="${compactStyleId}";let csvzallKeyboardInsetInstalled=!1;function csvzallInstallKeyboardInsets(){if(csvzallKeyboardInsetInstalled)return;csvzallKeyboardInsetInstalled=!0;const e=window.visualViewport,t=()=>{const i=e?e.height:window.innerHeight;document.documentElement.style.setProperty("--csvzall-visual-height",Math.max(240,Math.floor(i))+"px")};e&&(e.addEventListener("resize",t),e.addEventListener("scroll",t)),window.addEventListener("resize",t),t()}function csvzallEnableObsidianHostMode(){document.documentElement.classList.add("csvzall-obsidian-host");csvzallInstallKeyboardInsets();if(!document.getElementById(csvzallObsidianHostStyleId)){const e=document.createElement("style");e.id=csvzallObsidianHostStyleId,e.textContent=${JSON.stringify(compactStyle)},document.head.append(e)}}`;

function patchCompactStylesheet() {
  let css = readFileSync(stylesheetPath, "utf8");
  if (css.includes(compactStyleId)) {
    css = css.replace(/\/\* csvzall-obsidian-host-compact-v1 \*\/[\s\S]*$/u, `/* ${compactStyleId} */\n${compactStyle}\n`);
    writeFileSync(stylesheetPath, css);
    return true;
  }
  css = `${css}\n/* ${compactStyleId} */\n${compactStyle}\n`;
  writeFileSync(stylesheetPath, css);
  return true;
}

function patchMobileBundleBehavior() {
  let changed = false;
  const legacyResizeHelper = `const csvzallObsidianViewportResizeId="csvzall-obsidian-viewport-resize-v1";function csvzallRefreshGridForViewport(){setTimeout(()=>{window.dispatchEvent(new Event("resize"));try{const e=J.getFocusedCell?J.getFocusedCell():null;e&&(Number.isInteger(e.rowIndex)&&J.ensureIndexVisible&&J.ensureIndexVisible(e.rowIndex,"middle"),e.column&&J.ensureColumnVisible&&J.ensureColumnVisible(e.column))}catch{}},60)}window.addEventListener("message",e=>{const t=e.data??{};t.source==="obsidian-csvzall"&&t.type==="viewport-resized"&&csvzallRefreshGridForViewport()});`;
  if (text.includes(legacyResizeHelper)) {
    text = text.replace(legacyResizeHelper, "");
    changed = true;
  }

  const focusShimNeedle = `const csvzallObsidianKeyboardFocusId="${keyboardFocusId}";function csvzallIsEditableTarget(e){return!!(e&&e instanceof Element&&(e.matches("input, textarea, [contenteditable=true]")||e.closest(".ag-cell-inline-editing")))}function csvzallSetKeyboardOpen(e){document.body.toggleAttribute("data-keyboard-open",e),csvzallRefreshGridForViewport()}document.addEventListener("focusin",e=>{csvzallIsEditableTarget(e.target)&&setTimeout(()=>csvzallSetKeyboardOpen(!0),40)},!0);document.addEventListener("focusout",()=>{setTimeout(()=>{csvzallIsEditableTarget(document.activeElement)||csvzallSetKeyboardOpen(!1)},220)},!0);`;
  if (text.includes(focusShimNeedle)) {
    text = text.replace(focusShimNeedle, "");
    changed = true;
  }
  const hostModeViewportNeedle = "function tS(e){e&&csvzallInstallKeyboardInsets(),document.body.toggleAttribute";
  if (text.includes(hostModeViewportNeedle)) {
    text = text.replace(hostModeViewportNeedle, "function tS(e){document.body.toggleAttribute");
    changed = true;
  }

  const rowSelectionNeedle = 'rowSelection:{mode:"singleRow"}';
  const rowSelectionPatch = 'rowSelection:{mode:"singleRow",checkboxes:!1,headerCheckbox:!1,enableClickSelection:!0}';
  if (text.includes(rowSelectionNeedle)) {
    text = text.replace(rowSelectionNeedle, rowSelectionPatch);
    changed = true;
  }

  if (!text.includes(mobileBehaviorId)) {
    const keyboardHelper = `const csvzallObsidianMobileBehaviorId="${mobileBehaviorId}";let csvzallKeyboardInsetInstalled=!1;function csvzallInstallKeyboardInsets(){if(csvzallKeyboardInsetInstalled)return;csvzallKeyboardInsetInstalled=!0;const e=window.visualViewport,t=()=>{const i=e?e.height:window.innerHeight;document.documentElement.style.setProperty("--csvzall-visual-height",Math.max(240,Math.floor(i))+"px")};e&&(e.addEventListener("resize",t),e.addEventListener("scroll",t)),window.addEventListener("resize",t),t()}`;
    const hostModeNeedle = 'function tS(e){document.body.toggleAttribute("data-host-mode",e),';
    const hostModePatch = `${keyboardHelper}function tS(e){e&&csvzallInstallKeyboardInsets(),document.body.toggleAttribute("data-host-mode",e),`;
    if (text.includes(hostModeNeedle)) {
      text = text.replace(hostModeNeedle, hostModePatch);
      changed = true;
    }
  }

  if (!text.includes(viewportResizeId)) {
    const resizeHelper = `const csvzallObsidianViewportResizeId="${viewportResizeId}";function csvzallRefreshGridForViewport(){const e=()=>{window.dispatchEvent(new Event("resize"));try{const t=typeof csvzallActiveEditCell!="undefined"&&csvzallActiveEditCell?csvzallActiveEditCell:J.getFocusedCell?J.getFocusedCell():null;t&&(Number.isInteger(t.rowIndex)&&J.ensureIndexVisible&&J.ensureIndexVisible(t.rowIndex,"middle"),t.column&&J.ensureColumnVisible&&J.ensureColumnVisible(t.column))}catch{}};setTimeout(e,60)}window.addEventListener("message",e=>{const t=e.data??{};t.source==="obsidian-csvzall"&&t.type==="viewport-resized"&&csvzallRefreshGridForViewport()});`;
    const startNeedles = [
      "we.start();Vt.disabled=!0;Uo();B(\"Loading CSV engine...\");fS();",
      "Vt.disabled=!0;Uo();B(\"Loading CSV engine...\");fS();",
      "zi.disabled=!0;zo();_(\"Loading CSV engine...\");rS();",
      "mi.disabled=!0;ee(\"Loading CSV engine...\");Zm();",
    ];
    const startNeedle = startNeedles.find((needle) => text.includes(needle));
    if (startNeedle) {
      text = text.replace(startNeedle, `${resizeHelper}${startNeedle}`);
      changed = true;
    }
  }

  const legacyLifecycleHelper = `const csvzallObsidianKeyboardLifecycleId="csvzall-obsidian-keyboard-lifecycle-v1";function csvzallApplyKeyboardOpen(e){document.body.toggleAttribute("data-keyboard-open",e);try{typeof csvzallRefreshGridForViewport=="function"?csvzallRefreshGridForViewport():window.dispatchEvent(new Event("resize"))}catch{}}`;
  if (text.includes(legacyLifecycleHelper)) {
    text = text.replace(legacyLifecycleHelper, "");
    changed = true;
  }
  const legacyEditHook = 'onCellEditingStarted(){csvzallApplyKeyboardOpen(!0)},onCellEditingStopped(){setTimeout(()=>csvzallApplyKeyboardOpen(!1),180)},onCellValueChanged(e){!xe||!e.colDef.field||e.colDef.field==="_csvzallRowId"||sS(e)}}';
  const valueChangedHook = 'onCellValueChanged(e){!xe||!e.colDef.field||e.colDef.field==="_csvzallRowId"||sS(e)}}';
  if (text.includes(legacyEditHook)) {
    text = text.replace(legacyEditHook, valueChangedHook);
    changed = true;
  }

  if (!text.includes(keyboardLifecycleId)) {
    const lifecycleHelper = `const csvzallObsidianKeyboardLifecycleId="${keyboardLifecycleId}";let csvzallActiveEditCell=null;function csvzallRefreshGridAfterKeyboard(){try{typeof csvzallRefreshGridForViewport=="function"?csvzallRefreshGridForViewport():window.dispatchEvent(new Event("resize"))}catch{}}function csvzallBeginCellEdit(e){csvzallActiveEditCell=e&&Number.isInteger(e.rowIndex)?{rowIndex:e.rowIndex,column:e.column}:null;[40,140,320,650].forEach(t=>setTimeout(csvzallRefreshGridAfterKeyboard,t))}function csvzallEndCellEdit(){setTimeout(()=>{csvzallActiveEditCell=null,csvzallRefreshGridAfterKeyboard()},180)}`;
    const gridOptionsNeedle = "const Ko={";
    if (text.includes(gridOptionsNeedle)) {
      text = text.replace(gridOptionsNeedle, `${lifecycleHelper}${gridOptionsNeedle}`);
      changed = true;
    }

    const editHookNeedle = valueChangedHook;
    const editHookPatch = 'onCellEditingStarted(e){csvzallBeginCellEdit(e)},onCellEditingStopped(){csvzallEndCellEdit()},onCellValueChanged(e){!xe||!e.colDef.field||e.colDef.field==="_csvzallRowId"||sS(e)}}';
    if (text.includes(editHookNeedle)) {
      text = text.replace(editHookNeedle, editHookPatch);
      changed = true;
    }
  }

  return changed;
}

if (text.includes("obsidian-csvzall")) {
  const behaviorPatched = patchMobileBundleBehavior();
  if (!text.includes(compactStyleId) && text.includes("csvzallOpenObsidianFile")) {
    const migrations = [
      [
        'let csvzallObsidianHostMode=!1;async function csvzallOpenObsidianFile(e,t){csvzallObsidianHostMode=!0,',
        `${hostModeHelpers}let csvzallObsidianHostMode=!1;async function csvzallOpenObsidianFile(e,t){csvzallObsidianHostMode=!0,csvzallEnableObsidianHostMode(),`,
      ],
    ];
    const migration = migrations.find(([needle]) => text.includes(needle));
    if (!migration) {
      throw new Error(`WASM viewer bridge patch failed: existing bridge in ${bundleName} could not be upgraded to compact host mode`);
    }
    text = text.replace(migration[0], migration[1]);
    writeFileSync(bundlePath, text);
    console.log(`Upgraded WASM viewer bridge compact host mode in ${bundleName}.`);
  }
  if (behaviorPatched) {
    writeFileSync(bundlePath, text);
  }
  const compactPatched = patchCompactStylesheet();
  console.log(`WASM viewer bridge already present in ${bundleName}.`);
  if (compactPatched) {
    console.log(`Patched compact Obsidian host styles into ${stylesheetName}.`);
  }
  process.exit(0);
}

const variants = {
  current: {
    setDirtyNeedle: "function pi(e){Xs=e,zo()}",
    setDirtyPatch: "function pi(e){Xs=e,zo(),window.parent&&window.parent!==window&&window.parent.postMessage({source:\"csvzall-wasm-viewer\",type:\"dirty-state\",dirty:Xs},\"*\")}",
    saveNeedle: "$w(ct,t),pi(!1),Qe(),_(`Downloaded ${ct}.`)",
    savePatch: "csvzallObsidianHostMode?window.parent.postMessage({source:\"csvzall-wasm-viewer\",type:\"save-file\",name:ct,buffer:t.buffer,byteOffset:t.byteOffset,byteLength:t.byteLength},\"*\",[t.buffer]):$w(ct,t),pi(!1),Qe(),_(`${csvzallObsidianHostMode?\"Saved\":\"Downloaded\"} ${ct}.`)",
    readyNeedle: "await we(\"init\"),_(\"Open a local CSV file to begin.\"),zi.disabled=!1",
    readyPatch: "await we(\"init\"),_(\"Open a local CSV file to begin.\"),zi.disabled=!1,window.parent&&window.parent!==window&&window.parent.postMessage({source:\"csvzall-wasm-viewer\",type:\"ready\"},\"*\")",
    endNeedle: "zi.disabled=!0;zo();_(\"Loading CSV engine...\");rS();",
    bridgeCode: `${hostModeHelpers}let csvzallObsidianHostMode=!1;async function csvzallOpenObsidianFile(e,t){csvzallObsidianHostMode=!0,csvzallEnableObsidianHostMode(),zi.closest("label")&&(zi.closest("label").style.display="none"),$l.textContent="Save",Ie=!1,pi(!1),os("Opening CSV",\`\${e} is being indexed from Obsidian.\`),_(\`Opening \${e}...\`);try{const i=await we("open",{name:e,buffer:t},[t]);Yw(i,e)}catch(i){_(i instanceof Error?i.message:"Open failed")}finally{gi()}}window.addEventListener("message",e=>{const t=e.data??{};t.source==="obsidian-csvzall"&&t.type==="open-file"&&t.buffer instanceof ArrayBuffer&&csvzallOpenObsidianFile(t.name||"input.csv",t.buffer)});`,
  },
  previous: {
    setDirtyNeedle: "function $t(e){$i=e,An.disabled=!Ze||!$i,Tn.disabled=!Ze||!$i}",
    setDirtyPatch: "function $t(e){$i=e,An.disabled=!Ze||!$i,Tn.disabled=!Ze||!$i,window.parent&&window.parent!==window&&window.parent.postMessage({source:\"csvzall-wasm-viewer\",type:\"dirty-state\",dirty:$i},\"*\")}",
    saveNeedle: "qm(Ye,t),$t(!1),Ln(),ee(`Downloaded ${Ye}.`)",
    savePatch: "csvzallObsidianHostMode?window.parent.postMessage({source:\"csvzall-wasm-viewer\",type:\"save-file\",name:Ye,buffer:t.buffer,byteOffset:t.byteOffset,byteLength:t.byteLength},\"*\",[t.buffer]):qm(Ye,t),$t(!1),Ln(),ee(`${csvzallObsidianHostMode?\"Saved\":\"Downloaded\"} ${Ye}.`)",
    readyNeedle: "await Rt(\"init\"),ee(\"Open a local CSV file to begin.\"),mi.disabled=!1",
    readyPatch: "await Rt(\"init\"),ee(\"Open a local CSV file to begin.\"),mi.disabled=!1,window.parent&&window.parent!==window&&window.parent.postMessage({source:\"csvzall-wasm-viewer\",type:\"ready\"},\"*\")",
    endNeedle: "mi.disabled=!0;ee(\"Loading CSV engine...\");Zm();",
    bridgeCode: `${hostModeHelpers}let csvzallObsidianHostMode=!1;async function csvzallOpenObsidianFile(e,t){csvzallObsidianHostMode=!0,csvzallEnableObsidianHostMode(),mi.closest("label")&&(mi.closest("label").style.display="none"),An.textContent="Save",Ze=!1,$t(!1),Ei("Opening CSV",\`\${e} is being indexed from Obsidian.\`),ee(\`Opening \${e}...\`);try{const i=await Rt("open",{name:e,buffer:t},[t]);Xm(i,e)}catch(i){ee(i instanceof Error?i.message:"Open failed")}finally{Kt()}}window.addEventListener("message",e=>{const t=e.data??{};t.source==="obsidian-csvzall"&&t.type==="open-file"&&t.buffer instanceof ArrayBuffer&&csvzallOpenObsidianFile(t.name||"input.csv",t.buffer)});`,
  },
};

function applyVariant(name, variant) {
  const patches = [
    [variant.setDirtyNeedle, variant.setDirtyPatch],
    [variant.saveNeedle, variant.savePatch],
    [variant.readyNeedle, variant.readyPatch],
    [variant.endNeedle, `${variant.bridgeCode}${variant.endNeedle}`],
  ];

  if (!patches.every(([needle]) => text.includes(needle))) {
    return false;
  }

  for (const [needle, patch] of patches) {
    text = text.replace(needle, patch);
  }
  console.log(`Applied ${name} WASM viewer bridge patch to ${bundleName}.`);
  return true;
}

let patched = false;
for (const [name, variant] of Object.entries(variants)) {
  if (applyVariant(name, variant)) {
    patched = true;
    break;
  }
}

if (!patched) {
  const knownNeedles = Object.values(variants)
    .flatMap((variant) => [
      variant.setDirtyNeedle,
      variant.saveNeedle,
      variant.readyNeedle,
      variant.endNeedle,
    ])
    .filter((needle) => !text.includes(needle));
  throw new Error(
    `WASM viewer bridge patch failed: no known bundle shape matched ${bundleName}. Missing fragments included: ${knownNeedles
      .slice(0, 4)
      .join(" | ")}`,
  );
}

writeFileSync(bundlePath, text);
patchMobileBundleBehavior();
writeFileSync(bundlePath, text);
patchCompactStylesheet();
console.log(`Patched WASM viewer bridge into ${bundleName}.`);
