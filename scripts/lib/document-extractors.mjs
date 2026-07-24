import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_PAGES = 500;
const MAX_EXTRACTED_CHARS = 2_000_000;

export class DocumentExtractionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DocumentExtractionError";
    this.code = code;
  }
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtml(value) {
  const entities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
      if (entity[0] === "#") {
        const base = entity[1]?.toLowerCase() === "x" ? 16 : 10;
        const digits = base === 16 ? entity.slice(2) : entity.slice(1);
        const point = Number.parseInt(digits, base);
        return Number.isFinite(point) ? String.fromCodePoint(point) : match;
      }
      return entities[entity.toLowerCase()] ?? match;
    });
}

function enforceExtractedLimit(segments) {
  const total = segments.reduce((sum, segment) => sum + segment.text.length, 0);
  if (total > MAX_EXTRACTED_CHARS) {
    throw new DocumentExtractionError(
      "document_text_too_large",
      "Le texte extrait dépasse la limite locale de 2 millions de caractères."
    );
  }
  if (segments.length === 0) {
    throw new DocumentExtractionError(
      "document_no_text",
      "Le document ne contient aucun texte exploitable."
    );
  }
  return segments;
}

export async function extractPdf(bytes) {
  let document;
  try {
    const loadingTask = getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0
    });
    document = await loadingTask.promise;
    if (document.numPages > MAX_PAGES) {
      throw new DocumentExtractionError(
        "pdf_page_limit_exceeded",
        `Le PDF dépasse la limite locale de ${MAX_PAGES} pages.`
      );
    }
    const segments = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str;
        text += item.hasEOL ? "\n" : " ";
      }
      text = cleanText(text);
      if (text) {
        segments.push({
          title: `Page ${pageNumber}`,
          text,
          locator: { kind: "pdf_page", page: pageNumber }
        });
      }
      page.cleanup();
    }
    return { segments: enforceExtractedLimit(segments), warnings: [] };
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error;
    const encrypted = error?.name === "PasswordException";
    throw new DocumentExtractionError(
      encrypted ? "pdf_encrypted" : "pdf_malformed",
      encrypted
        ? "Le PDF est protégé par mot de passe et ne peut pas être lu."
        : "Le PDF est invalide ou illisible."
    );
  } finally {
    if (document) await document.destroy();
  }
}

export async function extractDocx(bytes) {
  let result;
  try {
    result = await mammoth.convertToHtml(
      { buffer: Buffer.from(bytes) },
      {
        externalFileAccess: false,
        includeDefaultStyleMap: true,
        styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Subtitle'] => h2:fresh"
        ]
      }
    );
  } catch {
    throw new DocumentExtractionError("docx_malformed", "Le document DOCX est invalide ou illisible.");
  }

  const sections = [];
  let heading = "Introduction";
  let buffer = [];
  let section = 0;
  const flush = () => {
    const text = cleanText(buffer.join("\n\n"));
    buffer = [];
    if (!text) return;
    section += 1;
    sections.push({
      title: heading,
      text,
      locator: { kind: "docx_section", section, heading }
    });
  };
  const tokens = result.value.match(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>|<p[^>]*>[\s\S]*?<\/p>|<li[^>]*>[\s\S]*?<\/li>/gi) ?? [];
  for (const token of tokens) {
    const headingMatch = /^<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>$/i.exec(token);
    if (headingMatch) {
      flush();
      heading = cleanText(decodeHtml(headingMatch[1])) || heading;
      continue;
    }
    const value = cleanText(decodeHtml(token));
    if (value) buffer.push(value);
  }
  flush();

  const warnings = (result.messages ?? []).map((message) => ({
    code: `docx_${message.type || "warning"}`,
    message: cleanText(message.message) || "Avertissement DOCX sans détail."
  }));
  return { segments: enforceExtractedLimit(sections), warnings };
}

export async function extractBinaryDocument(extension, bytes) {
  if (extension === ".pdf") return extractPdf(bytes);
  if (extension === ".docx") return extractDocx(bytes);
  throw new DocumentExtractionError("binary_format_unsupported", "Ce format binaire n’est pas pris en charge.");
}
