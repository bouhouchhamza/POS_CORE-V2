import type { AppSettings } from "../api/settings";
import type { CashRegisterSession, Sale, SalesReport } from "../types";

type PrintLanguage = "fr" | "en" | "ar";
type RasterAlign = "left" | "center" | "right";
type RasterLine =
  | { kind: "text"; text: string; align?: RasterAlign; bold?: boolean; size?: "body" | "title" }
  | { kind: "rule" }
  | { kind: "space"; height?: number };

const POS_TIME_ZONE = "Africa/Casablanca";

const labels = {
  fr: {
    cash: "Espèces",
    card: "Carte",
    other: "Autre",
    ticket: "Ticket N°",
    date: "Le",
    server: "Serveur",
    item: "Désignation",
    quantity: "Qté",
    unitPrice: "PU",
    total: "Total",
    totalToPay: "Total à payer",
    paymentMethod: "Mode de règlement",
    product: "Produit",
    reportTitle: "RAPPORT DE CAISSE",
    desktopOnly: "Impression thermique disponible uniquement dans Bimik POS Desktop.",
    nativeMissing: "Client desktop natif non détecté.",
    invalidCopies: "Nombre de copies invalide.",
  },
  en: {
    cash: "Cash",
    card: "Card",
    other: "Other",
    ticket: "Ticket #",
    date: "Date",
    server: "Server",
    item: "Item",
    quantity: "Qty",
    unitPrice: "Unit",
    total: "Total",
    totalToPay: "Total to pay",
    paymentMethod: "Payment method",
    product: "Product",
    reportTitle: "CASH REGISTER REPORT",
    desktopOnly: "Thermal printing is available only in Bimik POS Desktop.",
    nativeMissing: "Native desktop client not detected.",
    invalidCopies: "Invalid number of copies.",
  },
  ar: {
    cash: "نقداً",
    card: "بطاقة",
    other: "أخرى",
    ticket: "رقم التذكرة",
    date: "التاريخ",
    server: "الموظف",
    item: "المنتج",
    quantity: "الكمية",
    unitPrice: "سعر الوحدة",
    total: "المجموع",
    totalToPay: "المبلغ الواجب أداؤه",
    paymentMethod: "طريقة الدفع",
    product: "منتج",
    reportTitle: "تقرير الصندوق",
    desktopOnly: "الطباعة الحرارية متاحة فقط في تطبيق Bimik POS Desktop.",
    nativeMissing: "تطبيق سطح المكتب غير متاح.",
    invalidCopies: "عدد النسخ غير صالح.",
  },
} as const;

const money = (value: number) => Number(value ?? 0).toFixed(2);

const currentPrintLanguage = (): PrintLanguage => {
  const value = (
    (typeof document !== "undefined" ? document.documentElement.lang : "") ||
    (typeof navigator !== "undefined" ? navigator.language : "") ||
    "fr"
  ).toLowerCase();

  if (value.startsWith("ar")) return "ar";
  if (value.startsWith("en")) return "en";
  return "fr";
};

const localeFor = (language: PrintLanguage) =>
  language === "ar" ? "ar-MA" : language === "en" ? "en-GB" : "fr-FR";

const paymentName = (method: string | undefined, language = currentPrintLanguage()) => {
  const copy = labels[language];
  const value = method?.trim().toLowerCase();
  if (!value || value === "cash") return copy.cash;
  if (value === "card") return copy.card;
  if (value === "other") return copy.other;
  return method ?? "";
};

const clip = (value: string, width: number) => Array.from(value).slice(0, width).join("");
const padRight = (value: string, width: number) => clip(value, width).padEnd(width);
const padLeft = (value: string, width: number) => clip(value, width).padStart(width);
const center = (value: string, width: number) => {
  const text = clip(value, width);
  return `${" ".repeat(Math.max(0, Math.floor((width - Array.from(text).length) / 2)))}${text}`;
};

const wrap = (value: string, width: number) => {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    if (Array.from(word).length > width) {
      if (line) lines.push(line);
      let remaining = word;
      while (Array.from(remaining).length > width) {
        const part = Array.from(remaining).slice(0, width).join("");
        lines.push(part);
        remaining = Array.from(remaining).slice(width).join("");
      }
      line = remaining;
    } else if (!line || Array.from(`${line} ${word}`).length <= width) {
      line = line ? `${line} ${word}` : word;
    } else {
      lines.push(line);
      line = word;
    }
  }

  if (line) lines.push(line);
  return lines.length ? lines : [""];
};

const casablancaDateTime = (value: string | Date, language = currentPrintLanguage()) =>
  new Intl.DateTimeFormat(localeFor(language), {
    timeZone: POS_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const emphasizedHeader = (value: string, width: number) =>
  `\x1b\x61\x01\x1d\x21\x11${clip(value, Math.floor(width / 2))}\x1d\x21\x00\x1b\x61\x00`;

export const isTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type NativePrinter = {
  name: string;
  driver_name: string;
  port: string;
  is_default: boolean;
};

export async function listNativePrinters() {
  if (!isTauriRuntime()) return [] as NativePrinter[];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<NativePrinter[]>("list_printers");
}

export async function resolveNativePrinter(configuredPrinter = "") {
  if (!isTauriRuntime()) {
    throw new Error(labels[currentPrintLanguage()].desktopOnly);
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<NativePrinter>("resolve_thermal_printer", {
    configuredPrinter: configuredPrinter.trim() || null,
  });
}

async function printRaw(receiptTextValue: string, settings: AppSettings, copies: number) {
  const printer = await resolveNativePrinter(settings.thermal_printer_name);
  const { invoke } = await import("@tauri-apps/api/core");

  await invoke("print_receipt", {
    printerName: printer.name,
    receiptText: receiptTextValue,
    copies,
  });

  return printer;
}

const ensureCopies = (copies: number, language = currentPrintLanguage()) => {
  if (!Number.isInteger(copies) || copies < 1 || copies > 2) {
    throw new Error(labels[language].invalidCopies);
  }
};

export function receiptText(
  sale: Sale,
  settings: AppSettings,
  language = currentPrintLanguage(),
) {
  const copy = labels[language];
  const width = settings.ticket_width === 58 ? 32 : 48;
  const separator = "-".repeat(width);
  const nameWidth = settings.ticket_width === 58 ? 15 : 25;
  const quantityWidth = 4;
  const priceWidth = settings.ticket_width === 58 ? 6 : 8;
  const totalWidth = width - nameWidth - quantityWidth - priceWidth - 3;
  const halfWidth = Math.floor(width / 2);
  const lines = [
    emphasizedHeader(settings.ticket_header || settings.cafe_name, width),
    settings.cafe_subtitle ? center(settings.cafe_subtitle, width) : "",
    separator,
    `${padRight(`${copy.ticket}: ${sale.id ?? "-"}`, halfWidth)}${padLeft(`${copy.date}: ${casablancaDateTime(sale.created_at, language)}`, width - halfWidth)}`,
    `${copy.server}: ${sale.user?.name || "N/D"}`,
    separator,
    `${padRight(copy.item, nameWidth)} ${padLeft(copy.quantity, quantityWidth)} ${padLeft(copy.unitPrice, priceWidth)} ${padLeft(copy.total, totalWidth)}`,
  ];

  for (const item of sale.items ?? []) {
    const product = item.product?.name || `${copy.product} #${item.product_id}`;
    const names = wrap(product, nameWidth);
    lines.push(
      `${padRight(names[0], nameWidth)} ${padLeft(String(item.quantity), quantityWidth)} ${padLeft(money(item.unit_price), priceWidth)} ${padLeft(money(item.total), totalWidth)}`,
    );
    for (const continuation of names.slice(1)) lines.push(padRight(continuation, nameWidth));
  }

  lines.push(
    separator,
    `${padLeft(copy.totalToPay, width - 10)} ${padLeft(money(sale.total), 9)}`,
    `${copy.paymentMethod}: ${paymentName(sale.payment_method, language)}`,
  );

  if (settings.show_address_on_ticket && settings.cafe_address) {
    lines.push(center(settings.cafe_address, width));
  }
  if (settings.ticket_note) lines.push(...wrap(settings.ticket_note, width));
  lines.push(separator);
  if (settings.ticket_footer) {
    lines.push(...wrap(settings.ticket_footer, width).map((line) => center(line, width)));
  }
  lines.push("", "", "");

  return lines.filter((line, index) => line !== "" || index >= lines.length - 3).join("\n");
}

function aggregateReportRows(report: SalesReport, language = currentPrintLanguage()) {
  const copy = labels[language];
  const rows = new Map<string, { name: string; quantity: number; unitPrice: number; total: number }>();

  for (const sale of report.commandes ?? []) {
    for (const item of sale.items ?? []) {
      const unitPrice = Number(item.unit_price);
      const key = `${item.product_id}:${Math.round(unitPrice * 100)}`;
      const current = rows.get(key) ?? {
        name: item.product?.name || `${copy.product} #${item.product_id}`,
        quantity: 0,
        unitPrice,
        total: 0,
      };
      current.quantity += Number(item.quantity);
      current.total = Math.round((current.total + Number(item.total)) * 100) / 100;
      rows.set(key, current);
    }
  }

  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, localeFor(language)));
}

function compactReportText(
  report: SalesReport,
  settings: AppSettings,
  title: string,
  dateLabel: string,
  server?: string | null,
  language = currentPrintLanguage(),
) {
  const copy = labels[language];
  const width = settings.ticket_width === 58 ? 32 : 48;
  const separator = "-".repeat(width);
  const nameWidth = settings.ticket_width === 58 ? 15 : 25;
  const quantityWidth = 4;
  const priceWidth = settings.ticket_width === 58 ? 6 : 8;
  const totalWidth = width - nameWidth - quantityWidth - priceWidth - 3;
  const lines = [
    emphasizedHeader(settings.ticket_header || settings.cafe_name, width),
    settings.cafe_subtitle ? center(settings.cafe_subtitle, width) : "",
    center(title, width),
    padLeft(`${copy.date}: ${dateLabel}`, width),
  ];

  if (server?.trim()) lines.push(`${copy.server}: ${server.trim()}`);

  lines.push(
    separator,
    `${padRight(copy.item, nameWidth)} ${padLeft(copy.quantity, quantityWidth)} ${padLeft(copy.unitPrice, priceWidth)} ${padLeft(copy.total, totalWidth)}`,
  );

  for (const row of aggregateReportRows(report, language)) {
    const names = wrap(row.name, nameWidth);
    lines.push(
      `${padRight(names[0], nameWidth)} ${padLeft(String(row.quantity), quantityWidth)} ${padLeft(money(row.unitPrice), priceWidth)} ${padLeft(money(row.total), totalWidth)}`,
    );
    for (const continuation of names.slice(1)) lines.push(padRight(continuation, nameWidth));
  }

  lines.push(
    separator,
    `${padLeft(copy.total, width - 10)} ${padLeft(money(report.total_sales), 9)}`,
    "",
    "",
    "",
  );

  return lines.join("\n");
}

export function cashReportText(
  report: SalesReport,
  settings: AppSettings,
  title: string = labels[currentPrintLanguage()].reportTitle,
) {
  const language = currentPrintLanguage();
  const period = report.period as { date?: string; month?: string; worker_name?: string | null };
  const dateLabel = period.date || period.month || casablancaDateTime(new Date(), language);
  return compactReportText(report, settings, title, dateLabel, period.worker_name, language);
}

export function cashRegisterReportText(
  report: SalesReport,
  _session: CashRegisterSession,
  settings: AppSettings,
) {
  const language = currentPrintLanguage();
  return compactReportText(
    report,
    settings,
    labels[language].reportTitle,
    casablancaDateTime(new Date(), language),
    report.period.worker_name,
    language,
  );
}

const arabicSaleLines = (sale: Sale, settings: AppSettings): RasterLine[] => {
  const copy = labels.ar;
  const lines: RasterLine[] = [
    { kind: "text", text: settings.ticket_header || settings.cafe_name, align: "center", bold: true, size: "title" },
  ];

  if (settings.cafe_subtitle) {
    lines.push({ kind: "text", text: settings.cafe_subtitle, align: "center" });
  }

  lines.push(
    { kind: "rule" },
    { kind: "text", text: `${copy.ticket}: ${sale.id ?? "-"}` },
    { kind: "text", text: `${copy.date}: ${casablancaDateTime(sale.created_at, "ar")}` },
    { kind: "text", text: `${copy.server}: ${sale.user?.name || "—"}` },
    { kind: "rule" },
  );

  for (const item of sale.items ?? []) {
    const product = item.product?.name || `${copy.product} #${item.product_id}`;
    lines.push(
      { kind: "text", text: product, bold: true },
      { kind: "text", text: `${copy.quantity}: ${item.quantity}    ${copy.unitPrice}: ${money(item.unit_price)} MAD` },
      { kind: "text", text: `${copy.total}: ${money(item.total)} MAD` },
      { kind: "space", height: 5 },
    );
  }

  lines.push(
    { kind: "rule" },
    { kind: "text", text: `${copy.totalToPay}: ${money(sale.total)} MAD`, bold: true, size: "title" },
    { kind: "text", text: `${copy.paymentMethod}: ${paymentName(sale.payment_method, "ar")}` },
  );

  if (settings.show_address_on_ticket && settings.cafe_address) {
    lines.push({ kind: "text", text: settings.cafe_address, align: "center" });
  }
  if (settings.ticket_note) {
    lines.push({ kind: "text", text: settings.ticket_note, align: "center" });
  }

  lines.push({ kind: "rule" });

  if (settings.ticket_footer) {
    lines.push({ kind: "text", text: settings.ticket_footer, align: "center" });
  }

  lines.push({ kind: "space", height: 24 });
  return lines;
};

const arabicReportLines = (
  report: SalesReport,
  settings: AppSettings,
  title: string = labels.ar.reportTitle,
): RasterLine[] => {
  const copy = labels.ar;
  const period = report.period as { date?: string; month?: string; worker_name?: string | null };
  const dateLabel = period.date || period.month || casablancaDateTime(new Date(), "ar");
  const lines: RasterLine[] = [
    { kind: "text", text: settings.ticket_header || settings.cafe_name, align: "center", bold: true, size: "title" },
  ];

  if (settings.cafe_subtitle) {
    lines.push({ kind: "text", text: settings.cafe_subtitle, align: "center" });
  }

  lines.push(
    { kind: "text", text: title, align: "center", bold: true, size: "title" },
    { kind: "text", text: `${copy.date}: ${dateLabel}` },
  );

  if (period.worker_name?.trim()) {
    lines.push({ kind: "text", text: `${copy.server}: ${period.worker_name.trim()}` });
  }

  lines.push({ kind: "rule" });

  for (const row of aggregateReportRows(report, "ar")) {
    lines.push(
      { kind: "text", text: row.name, bold: true },
      { kind: "text", text: `${copy.quantity}: ${row.quantity}    ${copy.unitPrice}: ${money(row.unitPrice)} MAD` },
      { kind: "text", text: `${copy.total}: ${money(row.total)} MAD` },
      { kind: "space", height: 5 },
    );
  }

  lines.push(
    { kind: "rule" },
    { kind: "text", text: `${copy.total}: ${money(report.total_sales)} MAD`, bold: true, size: "title" },
    { kind: "space", height: 24 },
  );

  return lines;
};

const splitMeasuredText = (
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
) => {
  const text = value.trim();
  if (!text) return [""];

  const words = text.split(/\s+/).filter(Boolean);
  const result: string[] = [];
  let current = "";

  const pushLongToken = (token: string) => {
    let part = "";
    for (const character of Array.from(token)) {
      const candidate = `${part}${character}`;
      if (part && context.measureText(candidate).width > maxWidth) {
        result.push(part);
        part = character;
      } else {
        part = candidate;
      }
    }
    if (part) current = part;
  };

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      result.push(current);
      current = "";
    }

    if (context.measureText(word).width <= maxWidth) {
      current = word;
    } else {
      pushLongToken(word);
    }
  }

  if (current) result.push(current);
  return result.length ? result : [""];
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  }

  return btoa(binary);
};

const renderArabicRaster = (lines: RasterLine[], settings: AppSettings) => {
  if (typeof document === "undefined") {
    throw new Error(labels.ar.nativeMissing);
  }

  const width = settings.ticket_width === 58 ? 384 : 576;
  const padding = settings.ticket_width === 58 ? 16 : 22;
  const bodySize = settings.ticket_width === 58 ? 24 : 28;
  const titleSize = settings.ticket_width === 58 ? 30 : 34;
  const lineGap = settings.ticket_width === 58 ? 9 : 11;
  const maxTextWidth = width - padding * 2;

  const measuringCanvas = document.createElement("canvas");
  measuringCanvas.width = width;
  measuringCanvas.height = 32;
  const measuringContext = measuringCanvas.getContext("2d", { willReadFrequently: true });
  if (!measuringContext) throw new Error(labels.ar.nativeMissing);

  type PreparedLine =
    | { kind: "text"; text: string; align: RasterAlign; bold: boolean; fontSize: number; height: number }
    | { kind: "rule"; height: number }
    | { kind: "space"; height: number };

  const prepared: PreparedLine[] = [];

  for (const line of lines) {
    if (line.kind === "rule") {
      prepared.push({ kind: "rule", height: 18 });
      continue;
    }
    if (line.kind === "space") {
      prepared.push({ kind: "space", height: line.height ?? 10 });
      continue;
    }

    const fontSize = line.size === "title" ? titleSize : bodySize;
    measuringContext.font = `${line.bold ? "700" : "400"} ${fontSize}px Arial, "Segoe UI", sans-serif`;
    measuringContext.direction = "rtl";

    const wrapped = splitMeasuredText(measuringContext, line.text, maxTextWidth);
    for (const text of wrapped) {
      prepared.push({
        kind: "text",
        text,
        align: line.align ?? "right",
        bold: Boolean(line.bold),
        fontSize,
        height: Math.ceil(fontSize * 1.45) + lineGap,
      });
    }
  }

  const contentHeight = prepared.reduce((sum, line) => sum + line.height, 0);
  const height = Math.max(64, padding * 2 + contentHeight);

  if (height > 16000) {
    throw new Error("Arabic thermal receipt is too long.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error(labels.ar.nativeMissing);

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#000000";
  context.strokeStyle = "#000000";
  context.lineWidth = 2;
  context.textBaseline = "top";
  context.direction = "rtl";

  let y = padding;

  for (const line of prepared) {
    if (line.kind === "space") {
      y += line.height;
      continue;
    }

    if (line.kind === "rule") {
      const ruleY = y + Math.floor(line.height / 2);
      context.beginPath();
      context.moveTo(padding, ruleY);
      context.lineTo(width - padding, ruleY);
      context.stroke();
      y += line.height;
      continue;
    }

    context.font = `${line.bold ? "700" : "400"} ${line.fontSize}px Arial, "Segoe UI", sans-serif`;

    if (line.align === "center") {
      context.textAlign = "center";
      context.fillText(line.text, width / 2, y, maxTextWidth);
    } else if (line.align === "left") {
      context.textAlign = "left";
      context.fillText(line.text, padding, y, maxTextWidth);
    } else {
      context.textAlign = "right";
      context.fillText(line.text, width - padding, y, maxTextWidth);
    }

    y += line.height;
  }

  const image = context.getImageData(0, 0, width, height);
  const widthBytes = Math.ceil(width / 8);
  const headerSize = 10;
  const payload = new Uint8Array(headerSize + widthBytes * height);

  payload.set([
    0x1b,
    0x40,
    0x1d,
    0x76,
    0x30,
    0x00,
    widthBytes & 0xff,
    (widthBytes >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff,
  ]);

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const pixel = (row * width + column) * 4;
      const alpha = image.data[pixel + 3];
      const luminance =
        image.data[pixel] * 0.299 +
        image.data[pixel + 1] * 0.587 +
        image.data[pixel + 2] * 0.114;

      if (alpha > 16 && luminance < 190) {
        const byteIndex = headerSize + row * widthBytes + Math.floor(column / 8);
        payload[byteIndex] |= 0x80 >> (column % 8);
      }
    }
  }

  return bytesToBase64(payload);
};

async function printArabicRaster(lines: RasterLine[], settings: AppSettings, copies: number) {
  const printer = await resolveNativePrinter(settings.thermal_printer_name);
  const rasterBase64 = renderArabicRaster(lines, settings);
  const { invoke } = await import("@tauri-apps/api/core");

  await invoke("print_receipt_raster", {
    printerName: printer.name,
    rasterBase64,
    copies,
  });

  return printer;
}

export async function nativePrintSale(
  sale: Sale,
  settings: AppSettings,
  copies = 2,
) {
  const language = currentPrintLanguage();

  if (!isTauriRuntime()) {
    throw new Error(labels[language].nativeMissing);
  }

  ensureCopies(copies, language);

  if (language === "ar") {
    await printArabicRaster(arabicSaleLines(sale, settings), settings, copies);
    return;
  }

  await printRaw(receiptText(sale, settings, language), settings, copies);
}

export async function nativePrintCashReport(
  report: SalesReport,
  settings: AppSettings,
  title: string = labels[currentPrintLanguage()].reportTitle,
) {
  const language = currentPrintLanguage();

  if (!isTauriRuntime()) {
    throw new Error(labels[language].desktopOnly);
  }

  if (language === "ar") {
    await printArabicRaster(arabicReportLines(report, settings, title), settings, 2);
    return;
  }

  const period = report.period as { date?: string; month?: string; worker_name?: string | null };
  const dateLabel = period.date || period.month || casablancaDateTime(new Date(), language);

  await printRaw(
    compactReportText(report, settings, title, dateLabel, period.worker_name, language),
    settings,
    2,
  );
}

export async function nativePrintCashRegisterReport(
  report: SalesReport,
  _session: CashRegisterSession,
  settings: AppSettings,
) {
  const language = currentPrintLanguage();

  if (!isTauriRuntime()) {
    throw new Error(labels[language].desktopOnly);
  }

  if (language === "ar") {
    await printArabicRaster(arabicReportLines(report, settings), settings, 2);
    return;
  }

  await printRaw(
    compactReportText(
      report,
      settings,
      labels[language].reportTitle,
      casablancaDateTime(new Date(), language),
      report.period.worker_name,
      language,
    ),
    settings,
    2,
  );
}
