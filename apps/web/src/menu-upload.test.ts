import assert from 'node:assert/strict'
import test from 'node:test'
import { File } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import { createMenuPdfFormData, selectMenuPdf, tryBeginUpload } from './menu-upload.ts'
import { publicMenuUrl } from './public-menu-url.ts'
test('real File uses canonical pdf field and original name',()=>{const file=new File([Buffer.from('%PDF-1.7')],'menu-test.pdf',{type:'application/pdf'});const data=createMenuPdfFormData(file as unknown as globalThis.File);assert.equal(data.get('pdf') instanceof Blob,true);assert.equal((data.get('pdf') as File).name,'menu-test.pdf');assert.deepEqual([...data.keys()],['pdf'])})
test('FormData is binary and defines no manual Content-Type header',()=>{const file=new File(['pdf'],'fixture.pdf',{type:'application/pdf'});const data=createMenuPdfFormData(file as unknown as globalThis.File);assert.equal(data instanceof FormData,true);assert.equal('headers' in data,false);assert.notEqual(data.get('pdf'),JSON.stringify(file))})
test('selecting or removing a file clears stale errors',()=>{const valid=new File(['pdf'],'fixture.pdf',{type:'application/pdf'});assert.deepEqual(selectMenuPdf(valid as unknown as globalThis.File),{file:valid,error:null});assert.deepEqual(selectMenuPdf(null),{file:null,error:null})})
test('invalid files are rejected and lock prevents double submission',()=>{const invalid=new File(['x'],'fixture.txt',{type:'text/plain'});assert.match(selectMenuPdf(invalid as unknown as globalThis.File).error??'',/PDF valide/);const lock={current:false};assert.equal(tryBeginUpload(lock),true);assert.equal(tryBeginUpload(lock),false)})
test('QR URL uses the public origin and only the opaque table token',()=>{const token='A'.repeat(43),url=publicMenuUrl(token,'https://pos.example.test/','https://tauri.localhost');assert.equal(url,`https://pos.example.test/m/${token}`);assert.equal(url.includes('workspace'),false);assert.equal(url.includes('tenant'),false)})
test('QR URL never falls back to localhost or the Tauri origin',()=>{const token='A'.repeat(43);assert.throws(()=>publicMenuUrl(token,undefined,'http://127.0.0.1:5173'));assert.throws(()=>publicMenuUrl(token,undefined,'https://tauri.localhost'))})
test('normal login source has no workspace selector or tenant input',()=>{const source=fs.readFileSync(path.join(import.meta.dirname,'pages','LoginPage.tsx'),'utf8');assert.doesNotMatch(source,/workspaceInput|chooseWorkspace|setWorkspaceSlug|getWorkspaceSlug/);assert.doesNotMatch(source,/login\.workspace(?:['"]|Continue|Placeholder|Checking|Invalid|NotFound)/)})
