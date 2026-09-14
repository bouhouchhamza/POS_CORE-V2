import crypto from "node:crypto";
import type { ExtractedPdf, PdfTextItem } from "./pdf.js";

export const MENU_PDF_MAX_BYTES = 5 * 1024 * 1024;
export const MENU_PDF_MAX_PAGES = 30;

export type ParserConfidence = "high"|"medium"|"low";
export type ParsedMenuProduct = {
  client_id:string; name:string; sale_price:string|null; description:string|null; variant:string|null; currency:"MAD";
  requires_review:boolean; review_reasons:string[]; confidence:ParserConfidence; track_stock:false;
};
export type ParsedMenuCategory = { client_id:string; name:string; products:ParsedMenuProduct[] };
export type IgnoredMenuItem = { client_id:string; page:number; text:string; reason:string; confidence:"low" };

export function normalizeMatchName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("fr-MA");
}

const currency = String.raw`(?:dh|dhs|mad|د\s*[.،]?\s*م)`;
const priceAtEnd = new RegExp(String.raw`(?:^|\s)(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:${currency})\s*$`, "iu");
const barePrice = /^\d{1,4}(?:[.,]\d{1,2})?$/u;

function money(value:string) {
  const numeric = value.replace(",", ".");
  const [whole, fraction = ""] = numeric.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 1_000_000) return null;
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function parseMoroccanPrice(line:string, allowBare = false) {
  const normalized = line.normalize("NFKC").trim();
  const match = normalized.match(priceAtEnd);
  if (match) {
    const amount = money(match[1]!);
    return amount === null ? null : { amount, name:normalized.slice(0, match.index).trim() };
  }
  if (allowBare && barePrice.test(normalized)) {
    if (/^(?:19|20)\d{2}$/u.test(normalized)) return null;
    const amount = money(normalized);
    return amount === null ? null : { amount, name:"" };
  }
  return null;
}

function splitVariant(name:string) {
  const match = name.match(/^(.*?)\s*[-–—]\s*(petit|grand|moyen|small|large|\d+\s*(?:cl|ml|l))$/iu);
  return match ? { name:match[1]!.trim(), variant:match[2]!.trim() } : { name, variant:null };
}

function median(values:number[]) {
  const sorted = [...values].sort((a,b)=>a-b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 10;
}

function noiseReason(text:string, configured:string[]) {
  const value = normalizeMatchName(text);
  if (configured.some((word)=>value.includes(normalizeMatchName(word)))) return "Mot ignoré configuré";
  if (/^(?:page\s*)?\d+\s*[/|]\s*\d+$/iu.test(value) || /^page\b/iu.test(value)) return "Numéro de page";
  if (/@|https?:|www\.|\b(?:t[eé]l|telephone|téléphone|whatsapp|instagram|facebook)\b/iu.test(value)) return "Coordonnées";
  if (/\b(?:rue|avenue|boulevard|quartier|adresse|agadir|maroc)\b/iu.test(value)) return "Adresse ou localisation";
  if (/\b(?:ouvert|horaire|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b|\d{1,2}\s*h\s*\d{0,2}/iu.test(value)) return "Horaires";
  if (/\b(?:menu|carte)\b.*\b(?:propos|indicatif|inspir)/iu.test(value)) return "Titre ou mention du menu";
  if (/^\+?[\d\s().-]{8,}$/u.test(value) || /^\d{4}$/u.test(value) || /%/u.test(value)) return "Nombre non tarifaire";
  if (new RegExp(`^${currency}$`, "iu").test(value)) return "Devise isolée";
  return null;
}

type Row = { page:number; y:number; items:PdfTextItem[] };
function visualRows(items:PdfTextItem[]) {
  const rows:Row[] = [];
  for (const item of [...items].sort((a,b)=>a.page-b.page || b.y-a.y || a.x-b.x)) {
    const row = rows.find((candidate)=>candidate.page===item.page && Math.abs(candidate.y-item.y)<=Math.max(2, Math.min(candidate.items[0]!.font_size,item.font_size)*0.35));
    if (row) { row.items.push(item); row.y=(row.y*(row.items.length-1)+item.y)/row.items.length; }
    else rows.push({ page:item.page, y:item.y, items:[item] });
  }
  for (const row of rows) row.items.sort((a,b)=>a.x-b.x);
  return rows;
}

function rowProducts(row:Row) {
  const results:Array<{name:string;amount:string;used:PdfTextItem[]}> = [];
  const items = row.items;
  for (let index=0; index<items.length; index+=1) {
    const item=items[index]!;
    const combined=parseMoroccanPrice(item.text);
    if (combined?.name) { results.push({name:combined.name,amount:combined.amount,used:[item]}); continue; }
    const price=parseMoroccanPrice(item.text,true);
    if (!price || price.name) continue;
    const previousPriceX = [...items.slice(0,index)].reverse().find((candidate)=>parseMoroccanPrice(candidate.text,true))?.x ?? -Infinity;
    const candidates=items.slice(0,index).filter((candidate)=>candidate.x>previousPriceX && !parseMoroccanPrice(candidate.text,true));
    if (!candidates.length) continue;
    const name=candidates.map((candidate)=>candidate.text).join(" ").trim();
    if (name) results.push({name,amount:price.amount,used:[...candidates,item]});
  }
  return results;
}

export function parseMenuLayout(document:ExtractedPdf, options:{ignoredWords?:string[]}={}) {
  const rows=visualRows(document.items);
  const normalFont=median(document.items.map((item)=>item.font_size).filter((size)=>size>0));
  const repeated=new Map<string,Set<number>>();
  for (const item of document.items) {
    const key=normalizeMatchName(item.text).replace(/\d+/gu,"#");
    const pages=repeated.get(key)??new Set<number>(); pages.add(item.page); repeated.set(key,pages);
  }
  const used=new Set<PdfTextItem>();
  const products:Array<{row:Row;name:string;amount:string}>=[];
  for (const row of rows) {
    let matches=rowProducts(row);
    if (!matches.length && row.items.length===1) {
      const price=parseMoroccanPrice(row.items[0]!.text,true);
      const nameRow=price ? rows.filter((candidate)=>candidate.page===row.page && candidate.y>row.y &&
        candidate.y-row.y<=normalFont*1.8 && candidate.items.every((item)=>!parseMoroccanPrice(item.text,true)))
        .sort((a,b)=>a.y-b.y)[0] : undefined;
      if (price && nameRow && nameRow.items.every((item)=>item.font_size<normalFont*1.18)) {
        const name=nameRow.items.map((item)=>item.text).join(" ").trim();
        if (name && !noiseReason(name,options.ignoredWords??[])) matches=[{name,amount:price.amount,used:[...nameRow.items,row.items[0]!]}];
      }
    }
    for (const product of matches) {
      product.used.forEach((item)=>used.add(item));
      products.push({row,name:product.name,amount:product.amount});
    }
  }
  const headings=document.items.filter((item)=>{
    if (used.has(item) || parseMoroccanPrice(item.text,true) || noiseReason(item.text,options.ignoredWords??[])) return false;
    return item.font_size>=normalFont*1.18;
  });
  const categoryMap=new Map<PdfTextItem|undefined,ParsedMenuCategory>();
  for (const product of products) {
    const heading=headings.filter((item)=>item.page===product.row.page && item.y>product.row.y && item.x<=product.row.items[0]!.x+100)
      .sort((a,b)=>a.y-b.y)[0];
    if (heading) used.add(heading);
    let category=categoryMap.get(heading);
    if (!category) {
      category={client_id:crypto.randomUUID(),name:heading?.text.replace(/:$/u,"").trim()??"Sans catégorie",products:[]};
      categoryMap.set(heading,category);
    }
    const split=splitVariant(product.name);
    const reason=noiseReason(split.name,options.ignoredWords??[]);
    if (reason) continue;
    category.products.push({client_id:crypto.randomUUID(),name:split.name,sale_price:product.amount,description:null,variant:split.variant,
      currency:"MAD",requires_review:false,review_reasons:[],confidence:"high",track_stock:false});
  }
  const ignored_items:IgnoredMenuItem[]=document.items.filter((item)=>!used.has(item)).map((item)=>{
    const key=normalizeMatchName(item.text).replace(/\d+/gu,"#");
    const reason=noiseReason(item.text,options.ignoredWords??[]) ?? ((repeated.get(key)?.size??0)>1 ? "En-tête ou pied de page répété" : "Aucun prix associé avec certitude");
    return {client_id:crypto.randomUUID(),page:item.page,text:item.text,reason,confidence:"low"};
  });
  const categories=[...categoryMap.values()].filter((category)=>category.products.length>0);
  const warnings=ignored_items.length ? [`${ignored_items.length} élément(s) non reconnu(s) ou ignoré(s) sont disponibles pour vérification.`] : [];
  return { categories, ignored_items, warnings };
}

/** Test/backward-compatible adapter. Production PDF parsing uses positioned items. */
export function parseMenuText(text:string) {
  const lines=text.split(/\r?\n/u).map((line)=>line.trim().replace(/\s+/gu," ")).filter(Boolean);
  const items:PdfTextItem[]=lines.map((line,index)=>({page:1,text:line,x:50,y:800-index*20,width:Math.max(20,line.length*5),height:10,
    font_size:parseMoroccanPrice(line)?10:(line.endsWith(":")||line===line.toLocaleUpperCase("fr-MA")?13:10)}));
  return parseMenuLayout({pageCount:1,pages:[{page:1,width:600,height:840}],items});
}
