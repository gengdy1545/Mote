function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  ) {
    return 2;
  }
  return 1;
}

/** Wrap a single paragraph. A short prefix such as "v." stays with the following text. */
function wrapParagraph(text: string, columns: number): string[] {
  const limit = Math.max(1, columns);
  if (text.length === 0) return [""];

  const lines: string[] = [];
  let current = "";
  let width = 0;
  const chars = [...text];

  const flush = () => {
    lines.push(current.replace(/ $/, ""));
    current = "";
    width = 0;
  };

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index] ?? "";
    if (char === " ") {
      let nextWidth = 0;
      for (let cursor = index + 1; cursor < chars.length && chars[cursor] !== " "; cursor += 1) {
        nextWidth += charWidth(chars[cursor] ?? "");
      }
      const room = limit - width - 1;
      if (width > 0 && nextWidth > room && room < 4) {
        flush();
        continue;
      }
      if (width + 1 > limit) {
        flush();
        continue;
      }
      current += " ";
      width += 1;
      continue;
    }

    const size = charWidth(char);
    if (width + size > limit && current.length > 0) flush();
    current += char;
    width += size;
  }

  if (current.length > 0 || lines.length === 0) lines.push(current.replace(/ $/, ""));
  return lines;
}

export function wrapText(text: string, columns: number): string {
  return text
    .split("\n")
    .flatMap((paragraph) => wrapParagraph(paragraph, columns))
    .join("\n");
}
