type ViewerAsset = { path: string; encoding: "text" | "base64"; content: string };

function assetBytes(asset: ViewerAsset): ArrayBuffer {
  if (asset.encoding === "text") return new TextEncoder().encode(asset.content).buffer;
  const binary = atob(asset.content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

// Executable assets come from the installed plugin bundle, not vault resource
// URLs (which desktop Obsidian deliberately does not serve as JavaScript).
export function createEmbeddedViewerDocument(assets: readonly ViewerAsset[]): { url: string; dispose: () => void } {
  const index = assets.find(asset => asset.path === "wasm-viewer/index.html");
  if (!index) throw new Error("The bundled viewer is missing index.html.");
  let html = new TextDecoder().decode(assetBytes(index));
  if (!html.includes('name="csvzall-embedded-assets"')) {
    throw new Error("The bundled viewer requires an embedded build with an inline worker and WASM engine.");
  }
  const urls: string[] = [];
  const dispose = (): void => { for (const url of urls) URL.revokeObjectURL(url); urls.length = 0; };
  try {
    html = html.replace(/\b(src|href)=(["'])\.\/([^"']+)\2/g, (_match, attribute: string, quote: string, path: string) => {
      const asset = assets.find(candidate => candidate.path === `wasm-viewer/${path}`);
      if (!asset) throw new Error(`Missing bundled viewer asset: ${path}`);
      const type = path.endsWith(".js") ? "text/javascript" : path.endsWith(".png") ? "image/png" : "application/manifest+json";
      const url = URL.createObjectURL(new Blob([assetBytes(asset)], { type }));
      urls.push(url);
      return `${attribute}=${quote}${url}${quote}`;
    });
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    urls.push(url);
    return { url, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
