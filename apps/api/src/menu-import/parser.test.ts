import assert from "node:assert/strict";
import test from "node:test";
import type { ExtractedPdf, PdfTextItem } from "./pdf.js";
import { normalizeMatchName, parseMenuLayout, parseMoroccanPrice } from "./parser.js";

const item=(text:string,x:number,y:number,page=1,font_size=10):PdfTextItem=>({page,text,x,y,width:text.length*5,height:font_size,font_size});
const doc=(items:PdfTextItem[],pageCount=Math.max(...items.map((value)=>value.page))):ExtractedPdf=>({
  pageCount,pages:Array.from({length:pageCount},(_,index)=>({page:index+1,width:600,height:840})),items,
});

test("pairs French and Arabic products with Moroccan prices and groups by visual heading",()=>{
  const parsed=parseMenuLayout(doc([
    item("BOISSONS CHAUDES",50,700,1,14),item("Café crème",50,680),item("10 DH",500,680),
    item("أتاي",50,660),item("10,00 د.م",490,660),item("JUS",50,620,1,14),
    item("Orange",50,600),item("12,50 MAD",480,600),
  ]));
  assert.deepEqual(parsed.categories.map(category=>[category.name,category.products.map(product=>[product.name,product.sale_price])]),[
    ["BOISSONS CHAUDES",[["Café crème","10.00"],["أتاي","10.00"]]],["JUS",[["Orange","12.50"]]],
  ]);
  assert.equal(parsed.categories.flatMap(category=>category.products).every(product=>product.confidence==="high"&&!product.track_stock),true);
});

test("supports bare prices only as short isolated visual price cells",()=>{
  const parsed=parseMenuLayout(doc([item("CAFÉS",50,700,1,14),item("Espresso",50,680),item("10",500,680)]));
  assert.equal(parsed.categories[0]?.products[0]?.sale_price,"10.00");
  assert.equal(parseMoroccanPrice("2026",true),null);
  assert.equal(parseMoroccanPrice("10%",true),null);
  assert.equal(parseMoroccanPrice("06 12 34 56 78",true),null);
});

test("does not turn title, contact, location, headings, descriptions or missing prices into products",()=>{
  const parsed=parseMenuLayout(doc([
    item("CAFÉ BIMIK",100,780,1,28),item("MENU PROPOSÉ • AGADIR",100,750),
    item("BOISSONS",50,700,1,14),item("Espresso",50,680),item("10 DH",500,680),
    item("Préparé avec soin",50,665),item("Latte sans tarif",50,645),item("Tél. 06 12 34 56 78",50,50),
  ]));
  assert.deepEqual(parsed.categories.flatMap(category=>category.products).map(product=>product.name),["Espresso"]);
  assert.deepEqual(new Set(parsed.ignored_items.map(value=>value.text)),new Set(["CAFÉ BIMIK","MENU PROPOSÉ • AGADIR","Préparé avec soin","Latte sans tarif","Tél. 06 12 34 56 78"]));
});

test("pairs independent products in a two-column row",()=>{
  const parsed=parseMenuLayout(doc([
    item("CHAUD",40,700,1,14),item("Espresso",40,680),item("10",240,680),
    item("FRAIS",310,700,1,14),item("Orange",310,680),item("16 DH",530,680),
  ]));
  assert.deepEqual(parsed.categories.flatMap(category=>category.products).map(product=>product.name),["Espresso","Orange"]);
});

test("associates a price on the immediately adjacent visual line",()=>{
  const parsed=parseMenuLayout(doc([item("CAFÉS",50,700,1,14),item("Café filtre",50,680),item("12 DH",500,665)]));
  assert.deepEqual(parsed.categories[0]?.products.map(product=>[product.name,product.sale_price]),[["Café filtre","12.00"]]);
});

test("marks repeated headers and footers as diagnostics, never products",()=>{
  const parsed=parseMenuLayout(doc([
    item("CAFÉ BIMIK",100,780,1,28),item("BOISSONS",50,700,1,14),item("Eau",50,680),item("7 DH",500,680),
    item("Mentions légales",150,20),item("CAFÉ BIMIK",100,780,2,28),item("DOUCEURS",50,700,2,14),
    item("Croissant",50,680,2),item("8 DH",500,680,2),item("Mentions légales",150,20,2),
  ],2));
  assert.equal(parsed.categories.flatMap(category=>category.products).length,2);
  assert.equal(parsed.ignored_items.filter(value=>value.reason==="En-tête ou pied de page répété").length,4);
});

test("configurable ignored words suppress otherwise valid branded rows",()=>{
  const parsed=parseMenuLayout(doc([item("OFFRES",50,700,1,14),item("Produit sponsorisé",50,680),item("10 DH",500,680)]),{ignoredWords:["sponsorisé"]});
  assert.equal(parsed.categories.length,0);
});

test("matching normalization trims, collapses spaces, handles case and Unicode",()=>{
  assert.equal(normalizeMatchName("  CAFÉ   Crème "),normalizeMatchName("café crème"));
  assert.equal(parseMoroccanPrice("Café NaN DH"),null);
});
