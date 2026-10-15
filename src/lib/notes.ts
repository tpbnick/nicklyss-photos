export type NotePart = { kind: "text"; text: string } | { kind: "link"; label: string; href: string };

function safeHref(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.startsWith("//")) return null;
  if (value.startsWith("/") || value.startsWith("#") || value.startsWith("./") || value.startsWith("../")) {
    return value;
  }
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") return url.href;
  } catch {
    return null;
  }
  return null;
}

function readLink(source: string, start: number): { label: string; href: string; end: number } | null {
  if (source[start] !== "[") return null;
  const labelEnd = source.indexOf("]", start + 1);
  if (labelEnd <= start + 1) return null;
  const label = source.slice(start + 1, labelEnd);
  if (!label.trim() || label.includes("\n") || source[labelEnd + 1] !== "(") return null;

  let index = labelEnd + 2;
  let href = "";
  if (source[index] === "<") {
    const close = source.indexOf(">", index + 1);
    if (close === -1 || source.slice(index, close).includes("\n")) return null;
    href = source.slice(index + 1, close);
    index = close + 1;
  } else {
    const destinationStart = index;
    let depth = 0;
    while (index < source.length && source[index] !== "\n") {
      const character = source[index];
      if (character === "\\" && index + 1 < source.length) {
        index += 2;
        continue;
      }
      if (character === "(") depth += 1;
      else if (character === ")") {
        if (depth === 0) break;
        depth -= 1;
      } else if (/\s/.test(character) && depth === 0) break;
      index += 1;
    }
    href = source.slice(destinationStart, index).replace(/\\([()])/g, "$1");
  }

  if (source[index] === " " || source[index] === "\t") {
    while (source[index] === " " || source[index] === "\t") index += 1;
    const quote = source[index];
    if (quote === '"' || quote === "'") {
      const titleEnd = source.indexOf(quote, index + 1);
      if (titleEnd === -1 || source.slice(index, titleEnd).includes("\n")) return null;
      index = titleEnd + 1;
    }
  }
  if (source[index] !== ")") return null;

  const safe = safeHref(href);
  if (!safe) return null;
  return { label, href: safe, end: index + 1 };
}

/** Split notes into text and markdown links. Anything that is not a safe link stays text. */
export function noteParts(source: string): NotePart[] {
  const parts: NotePart[] = [];
  let index = 0;
  let textStart = 0;

  while (index < source.length) {
    if (source[index] === "\\" && source[index + 1] === "[") {
      if (index > textStart) parts.push({ kind: "text", text: source.slice(textStart, index) });
      textStart = index + 1;
      index += 2;
      continue;
    }
    if (source[index] !== "[") {
      index += 1;
      continue;
    }
    const link = readLink(source, index);
    if (!link) {
      index += 1;
      continue;
    }
    if (index > textStart) parts.push({ kind: "text", text: source.slice(textStart, index) });
    parts.push({ kind: "link", label: link.label, href: link.href });
    index = link.end;
    textStart = index;
  }

  if (textStart < source.length) parts.push({ kind: "text", text: source.slice(textStart) });
  return parts;
}
