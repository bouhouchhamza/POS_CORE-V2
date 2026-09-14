import assert from "node:assert/strict";
import test from "node:test";
import PDFDocument from "pdfkit";
import { extractPdfText, hasPdfSignature, MenuPdfError } from "./pdf.js";

function pdfBuffer() {
  return new Promise<Buffer>((resolve,reject)=>{
    const chunks:Buffer[]=[];
    const pdf=new PDFDocument({margin:50});
    pdf.on("data",(chunk:Buffer)=>chunks.push(chunk));pdf.on("error",reject);pdf.on("end",()=>resolve(Buffer.concat(chunks)));
    pdf.fontSize(14).text("BOISSONS",50,100);pdf.fontSize(10).text("Espresso",50,125).text("10 DH",500,125);pdf.end();
  });
}

test("validates PDF signature rather than trusting an extension",()=>{
  assert.equal(hasPdfSignature(Buffer.from("%PDF-1.7")),true);
  assert.equal(hasPdfSignature(Buffer.from("not a pdf")),false);
});
test("fake PDF data is rejected",async()=>assert.rejects(()=>extractPdfText(Buffer.from("fake.pdf")),error=>error instanceof MenuPdfError&&error.code==="INVALID_PDF"));
test("native extraction preserves page and layout metadata",async()=>{
  const extracted=await extractPdfText(await pdfBuffer());
  assert.equal(extracted.pageCount,1);assert.equal(extracted.pages[0]?.width>0,true);
  const product=extracted.items.find(item=>item.text==="Espresso");
  assert.equal(product?.page,1);assert.equal(typeof product?.x,"number");assert.equal(typeof product?.y,"number");
  assert.equal((product?.font_size??0)>0,true);
});
