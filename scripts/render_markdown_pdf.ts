import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type Block =
  | { type: "h1"; text: string }
  | { type: "h2"; text: string }
  | { type: "p"; text: string }
  | { type: "li"; text: string }
  | { type: "code"; lines: string[] };

type LineLayout = {
  font: "F1" | "F2" | "F3";
  fontSize: number;
  x: number;
  y: number;
  text: string;
};

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_LEFT = 54;
const MARGIN_RIGHT = 54;
const MARGIN_TOP = 56;
const MARGIN_BOTTOM = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const FOOTER_Y = 28;

function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let bullets: string[] = [];
  let codeLines: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }

    blocks.push({
      type: "p",
      text: paragraph.join(" ").replace(/\s+/g, " ").trim(),
    });
    paragraph = [];
  };

  const flushBullets = () => {
    if (bullets.length === 0) {
      return;
    }

    for (const bullet of bullets) {
      blocks.push({ type: "li", text: bullet });
    }
    bullets = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (codeLines) {
      if (trimmed.startsWith("```")) {
        blocks.push({ type: "code", lines: codeLines });
        codeLines = null;
        continue;
      }

      codeLines.push(line.replace(/\t/g, "    "));
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushBullets();
      continue;
    }

    if (trimmed.startsWith("# ")) {
      flushParagraph();
      flushBullets();
      blocks.push({ type: "h1", text: trimmed.slice(2).trim() });
      continue;
    }

    if (trimmed.startsWith("## ")) {
      flushParagraph();
      flushBullets();
      blocks.push({ type: "h2", text: trimmed.slice(3).trim() });
      continue;
    }

    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushBullets();
      codeLines = [];
      continue;
    }

    if (trimmed.startsWith("- ")) {
      flushParagraph();
      bullets.push(trimmed.slice(2).trim());
      continue;
    }

    flushBullets();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushBullets();
  if (codeLines) {
    blocks.push({ type: "code", lines: codeLines });
  }
  return blocks;
}

function measureTextWidth(text: string, fontSize: number) {
  return text.length * fontSize * 0.52;
}

function measureMonospaceWidth(text: string, fontSize: number) {
  return text.length * fontSize * 0.6;
}

function breakLongWord(word: string, fontSize: number, maxWidth: number) {
  const pieces: string[] = [];
  let remaining = word;
  const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * 0.52)));

  while (measureTextWidth(remaining, fontSize) > maxWidth && remaining.length > maxChars) {
    pieces.push(remaining.slice(0, maxChars - 1) + "-");
    remaining = remaining.slice(maxChars - 1);
  }

  if (remaining) {
    pieces.push(remaining);
  }

  return pieces;
}

function wrapText(text: string, fontSize: number, maxWidth: number) {
  const rawWords = text.split(/\s+/).filter(Boolean);
  const words = rawWords.flatMap((word) =>
    measureTextWidth(word, fontSize) <= maxWidth
      ? [word]
      : breakLongWord(word, fontSize, maxWidth),
  );

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measureTextWidth(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
    }
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function escapePdfText(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function renderBlocks(blocks: Block[]) {
  const pages: LineLayout[][] = [];
  let currentPage: LineLayout[] = [];
  let y = PAGE_HEIGHT - MARGIN_TOP;

  const newPage = () => {
    if (currentPage.length > 0) {
      pages.push(currentPage);
    }
    currentPage = [];
    y = PAGE_HEIGHT - MARGIN_TOP;
  };

  const ensureSpace = (requiredHeight: number) => {
    if (y - requiredHeight < MARGIN_BOTTOM) {
      newPage();
    }
  };

  const addLine = (
    text: string,
    font: "F1" | "F2" | "F3",
    fontSize: number,
    x: number,
    leading: number,
  ) => {
    currentPage.push({ font, fontSize, x, y, text });
    y -= leading;
  };

  for (const block of blocks) {
    if (block.type === "h1") {
      y -= 10;
      const fontSize = 24;
      const leading = 30;
      const lines = wrapText(block.text, fontSize, CONTENT_WIDTH);
      ensureSpace(lines.length * leading + 8);
      for (const line of lines) {
        addLine(line, "F2", fontSize, MARGIN_LEFT, leading);
      }
      y -= 4;
      continue;
    }

    if (block.type === "h2") {
      y -= 10;
      const fontSize = 15;
      const leading = 20;
      const lines = wrapText(block.text, fontSize, CONTENT_WIDTH);
      ensureSpace(lines.length * leading + 4);
      for (const line of lines) {
        addLine(line, "F2", fontSize, MARGIN_LEFT, leading);
      }
      y -= 2;
      continue;
    }

    if (block.type === "p") {
      const fontSize = 11;
      const leading = 15;
      const lines = wrapText(block.text, fontSize, CONTENT_WIDTH);
      ensureSpace(lines.length * leading + 4);
      for (const line of lines) {
        addLine(line, "F1", fontSize, MARGIN_LEFT, leading);
      }
      y -= 4;
      continue;
    }

    if (block.type === "li") {
      const bulletFontSize = 11;
      const bulletLeading = 15;
      const bulletIndent = 16;
      const bulletLines = wrapText(
        block.text,
        bulletFontSize,
        CONTENT_WIDTH - bulletIndent,
      );
      ensureSpace(bulletLines.length * bulletLeading + 2);
      for (let index = 0; index < bulletLines.length; index++) {
        const line = bulletLines[index];
        if (!line) {
          continue;
        }

        const prefix = index === 0 ? "- " : "";
        const x = MARGIN_LEFT + (index === 0 ? 0 : bulletIndent);
        addLine(`${prefix}${line}`, "F1", bulletFontSize, x, bulletLeading);
      }
      y -= 2;
      continue;
    }

    const longestLine = block.lines.reduce(
      (max, line) => Math.max(max, line.length),
      1,
    );
    const monoFontSize = Math.max(
      7,
      Math.min(9, CONTENT_WIDTH / Math.max(1, longestLine * 0.6)),
    );
    const monoLeading = monoFontSize + 3;
    const monoIndent = 8;
    ensureSpace(block.lines.length * monoLeading + 8);
    y -= 2;
    for (const line of block.lines) {
      addLine(line, "F3", monoFontSize, MARGIN_LEFT + monoIndent, monoLeading);
    }
    y -= 6;
  }

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  return pages;
}

function buildPdf(pages: LineLayout[][]) {
  const objects: string[] = [];

  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const catalogObject = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesObject = addObject("<< /Type /Pages /Kids [] /Count 0 >>");
  const fontRegularObject = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  );
  const fontBoldObject = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  );
  const fontMonoObject = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  );

  const pageRefs: string[] = [];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const commands: string[] = [];

    for (const line of page) {
      commands.push(
        `BT /${line.font} ${line.fontSize} Tf ${line.x} ${line.y} Td (${escapePdfText(line.text)}) Tj ET`,
      );
    }

    const pageNumberText = `Page ${pageIndex + 1} of ${pages.length}`;
    commands.push(
      `BT /F1 9 Tf ${PAGE_WIDTH - MARGIN_RIGHT - 60} ${FOOTER_Y} Td (${escapePdfText(pageNumberText)}) Tj ET`,
    );

    const stream = commands.join("\n");
    const contentsObject = addObject(
      `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`,
    );
    const pageObject = addObject(
      `<< /Type /Page /Parent ${pagesObject} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontRegularObject} 0 R /F2 ${fontBoldObject} 0 R /F3 ${fontMonoObject} 0 R >> >> /Contents ${contentsObject} 0 R >>`,
    );
    pageRefs.push(`${pageObject} 0 R`);
  }

  objects[pagesObject - 1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageRefs.length} >>`;

  const parts: string[] = ["%PDF-1.4"];
  const offsets: number[] = [0];

  for (let index = 0; index < objects.length; index++) {
    const objectNumber = index + 1;
    offsets.push(Buffer.byteLength(parts.join("\n"), "utf8") + 1);
    parts.push(`${objectNumber} 0 obj\n${objects[index]}\nendobj`);
  }

  const xrefOffset = Buffer.byteLength(parts.join("\n"), "utf8") + 1;
  const xrefLines = ["xref", `0 ${objects.length + 1}`, "0000000000 65535 f "];

  for (let index = 1; index < offsets.length; index++) {
    xrefLines.push(`${String(offsets[index]).padStart(10, "0")} 00000 n `);
  }

  parts.push(xrefLines.join("\n"));
  parts.push(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObject} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  );

  return parts.join("\n");
}

function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    throw new Error(
      "Usage: bun run scripts/render_markdown_pdf.ts <input.md> <output.pdf>",
    );
  }

  const resolvedInput = resolve(inputPath);
  const resolvedOutput = resolve(outputPath);
  const markdown = readFileSync(resolvedInput, "utf8");
  const blocks = parseMarkdown(markdown);
  const pages = renderBlocks(blocks);
  const pdf = buildPdf(pages);

  writeFileSync(resolvedOutput, pdf, "binary");
  console.log(
    `Wrote ${pages.length} page(s) to ${resolvedOutput} from ${dirname(resolvedInput)}`,
  );
}

main();
