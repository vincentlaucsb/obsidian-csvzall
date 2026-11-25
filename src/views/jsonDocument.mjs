function validJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

// The input has already passed strict JSON validation. Copy each token verbatim,
// including number spellings, duplicate keys, and escapes inside strings.
function layout(text, pretty) {
  const parts = [];
  let depth = 0;
  let previous = "";
  let position = 0;
  while (position < text.length) {
    const start = position;
    const first = text.charAt(position++);
    if (" \t\r\n".includes(first)) continue;
    if (first === '"') {
      while (position < text.length) {
        const char = text.charAt(position++);
        if (char === '"') break;
        if (char === "\\") position++;
      }
    } else if (!"{}[],:".includes(first)) {
      while (position < text.length && !" \t\r\n{}[],:".includes(text.charAt(position))) position++;
    }
    const token = text.slice(start, position);
    if (pretty) {
      const close = token === "}" || token === "]";
      const afterOpen = previous === "{" || previous === "[";
      if (close) depth--;
      if ((afterOpen && !close) || previous === "," || (close && !afterOpen)) {
        parts.push("\n", "  ".repeat(Math.min(depth, 32)));
      } else if (previous === ":") {
        parts.push(" ");
      }
      if (token === "{" || token === "[") depth++;
    }
    parts.push(token);
    previous = token;
  }
  return parts.join("");
}

export class JsonDocument {

  constructor(source) {
    this.source = source;
    this.bom = source.startsWith("\uFEFF") ? "\uFEFF" : "";
    const body = source.slice(this.bom.length);
    this.eol = /\r\n|[\r\n]/.exec(body)?.[0] ?? "\n";
    let end = body.length;
    while (end > 0 && /[ \t\r\n]/.test(body.charAt(end - 1))) end--;
    this.suffix = body.slice(end);
    const content = body.slice(0, end);
    this.compact = !/[\r\n]/.test(content) && validJson(content);
    this.display = this.compact ? layout(content, true) : body.replace(/\r\n?/g, "\n");
    this.indent = /\n( +|\t+)\S/.exec(this.display)?.[1] ?? "  ";
  }

  serialize(display) {
    if (display === this.display) return this.source;
    if (this.compact && validJson(display)) return this.bom + layout(display, false) + this.suffix;
    return this.bom + display.replace(/\n/g, this.eol);
  }
}
