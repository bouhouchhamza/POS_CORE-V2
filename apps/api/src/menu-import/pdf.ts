import { MENU_PDF_MAX_PAGES } from "./parser.js";

export type PdfTextItem = { page:number; text:string; x:number; y:number; width:number; height:number; font_size:number };
export type ExtractedPdf = { pageCount:number; pages:Array<{page:number;width:number;height:number}>; items:PdfTextItem[] };

export class MenuPdfError extends Error {
  constructor(public code: "INVALID_PDF"|"TOO_MANY_PAGES"|"SCANNED_PDF", message: string) { super(message); }
}

export function hasPdfSignature(bytes: Buffer) {
  return bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
}

export async function extractPdfText(bytes: Buffer): Promise<ExtractedPdf> {
  if (!hasPdfSignature(bytes)) throw new MenuPdfError("INVALID_PDF", "Le fichier ne contient pas un PDF valide.");
  let document;
  let loadingTask;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");

    (
      globalThis as typeof globalThis & {
        pdfjsWorker?: typeof pdfjsWorker;
      }
    ).pdfjsWorker = pdfjsWorker;

    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      useSystemFonts: false,
    });
    document = await loadingTask.promise;
  } catch (error) {
    console.error("[BIMIK PDF IMPORT ERROR]", error);
    throw new MenuPdfError(
      "INVALID_PDF",
      "Le PDF est endommagé ou illisible.",
    );
  }
  try {
    if (document.numPages > MENU_PDF_MAX_PAGES) throw new MenuPdfError("TOO_MANY_PAGES", `Le PDF ne doit pas dÃ©passer ${MENU_PDF_MAX_PAGES} pages.`);
    const pages: ExtractedPdf["pages"] = [];
    const items: PdfTextItem[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({ page: pageNumber, width: viewport.width, height: viewport.height });
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const text = item.str.trim().replace(/\s+/gu, " ");
        if (!text) continue;
        const [, , c = 0, d = 0, x = 0, y = 0] = item.transform;
        items.push({ page:pageNumber, text, x, y, width:item.width, height:item.height,
          font_size:Math.max(Math.hypot(c, d), item.height, 1) });
      }
      page.cleanup();
    }
    if (items.map((item) => item.text).join("").replace(/\s/gu, "").length < 3) {
      throw new MenuPdfError("SCANNED_PDF", "Ce PDF semble Ãªtre scannÃ©. Utilisez un PDF contenant du texte ou configurez un service OCR local.");
    }
    return { items, pages, pageCount: document.numPages };
  } finally {
    await loadingTask?.destroy();
  }
}
