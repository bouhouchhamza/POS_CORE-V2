import { useEffect, useRef, useState, type DragEvent } from 'react'
import { confirmMenu, previewMenu } from '../api/menu-import'
import { getCategories } from '../api/categories'
import { getProducts } from '../api/products'
import ErrorMessage from '../components/ErrorMessage'
import type { Category, ExtractedMenu, MenuImportResult, Product } from '../types'
import { getApiErrorMessage } from '../utils/format'
import { selectMenuPdf, tryBeginUpload } from '../menu-upload'
import { useI18n } from '../i18n'

export default function MenuImportPage() {
  const { t } = useI18n()
  const [file,setFile]=useState<File|null>(null), [menu,setMenu]=useState<ExtractedMenu|null>(null)
  const [result,setResult]=useState<MenuImportResult|null>(null), [error,setError]=useState<string|null>(null), [busy,setBusy]=useState(false)
  const [categories,setCategories]=useState<Category[]>([]),[products,setProducts]=useState<Product[]>([])
  const uploadLock=useRef(false)
  useEffect(()=>{Promise.all([getCategories(),getProducts()]).then(([categoryRows,productRows])=>{setCategories(categoryRows);setProducts(productRows)}).catch(e=>setError(getApiErrorMessage(e)))},[])
  function choose(candidate: File|null) { const selection=selectMenuPdf(candidate);setFile(selection.file);setError(selection.error);setMenu(null);setResult(null) }
  async function analyze() { if(!file||!tryBeginUpload(uploadLock))return;setBusy(true);setError(null);try{setMenu(await previewMenu(file));setError(null)}catch(e){setError(getApiErrorMessage(e))}finally{uploadLock.current=false;setBusy(false)} }
  function categoryChange(index:number, patch:Partial<ExtractedMenu['categories'][number]>) { setMenu(current=>current ? {...current,categories:current.categories.map((c,i)=>i===index?{...c,...patch}:c)}:current) }
  function productChange(ci:number,pi:number,patch:Partial<ExtractedMenu['categories'][number]['products'][number]>) { setMenu(current=>current?{...current,categories:current.categories.map((c,i)=>i===ci?{...c,products:c.products.map((p,j)=>j===pi?{...p,...patch}:p)}:c)}:current) }
  function recoverIgnored(clientId:string) { setMenu(current=>{
    if(!current)return current
    const ignored=current.ignored_items.find(item=>item.client_id===clientId)
    if(!ignored)return current
    const recovered={client_id:crypto.randomUUID(),name:ignored.text,sale_price:null,description:null,variant:null,currency:'MAD' as const,
      requires_review:true,confidence:'low' as const,review_reasons:[ignored.reason],decision:'skip' as const,existing_product_id:null,
      duplicate_kind:'none' as const,track_stock:false}
    const reviewCategory=t('menu.review')
    const categoryIndex=current.categories.findIndex(category=>category.name===reviewCategory)
    const categories=categoryIndex>=0?current.categories.map((category,index)=>index===categoryIndex?{...category,products:[...category.products,recovered]}:category):
      [...current.categories,{client_id:crypto.randomUUID(),name:reviewCategory,decision:'create' as const,existing_category_id:null,duplicate_kind:'none' as const,products:[recovered]}]
    return {...current,categories,ignored_items:current.ignored_items.filter(item=>item.client_id!==clientId)}
  }) }
  async function confirm(){if(!menu)return;setBusy(true);setError(null);try{setResult(await confirmMenu(menu))}catch(e){setError(getApiErrorMessage(e))}finally{setBusy(false)}}
  function drop(event:DragEvent<HTMLDivElement>){event.preventDefault();choose(event.dataTransfer.files[0]??null)}
  function categoryDecision(value:string) { return value==='create'||value==='use_existing'||value==='skip' ? value : 'skip' }
  function productDecision(value:string) { return value==='create'||value==='update_existing'||value==='skip' ? value : 'skip' }
  return <section><div className="page-title"><div><h2>{t('menu.title')}</h2><p>{t('menu.subtitle')}</p></div></div>
    <ErrorMessage message={error}/>
    <section className="panel form-panel"><div className="panel-title"><h3>{t('menu.select')}</h3></div>
      <div className="empty-state" onDragOver={e=>e.preventDefault()} onDrop={drop}><input accept="application/pdf,.pdf" type="file" onChange={e=>choose(e.target.files?.[0]??null)}/><p>{file?.name??t('menu.drop')}</p></div>
      <button className="button" disabled={!file||busy} onClick={analyze} type="button">{t(busy?'menu.analyzing':'menu.analyze')}</button>
    </section>
    {menu?<section className="panel"><div className="panel-title"><h3>{t('menu.preview')}</h3><span>{t('menu.pages',{count:menu.page_count})}</span></div>
      {menu.warnings.map((warning,i)=><div className="badge warning" key={i}>{warning}</div>)}
      {menu.ignored_items.length?<details className="panel"><summary>{t('menu.ignoredSummary',{count:menu.ignored_items.length})}</summary>
        <p>{t('menu.ignoredHelp')}</p>
        {menu.ignored_items.map(item=><div className="form-grid" key={item.client_id}><span>{t('menu.page',{page:item.page,text:item.text})}</span><span className="badge warning">{item.reason}</span>
          <button className="button secondary" type="button" onClick={()=>recoverIgnored(item.client_id)}>{t('menu.recover')}</button></div>)}
      </details>:null}
      {menu.categories.map((category,ci)=><article className="panel" key={category.client_id}><div className="form-grid">
        <label>{t('menu.category')}<input value={category.name} onChange={e=>categoryChange(ci,{name:e.target.value})}/></label>
        <label>{t('menu.decision')}<select value={category.decision} onChange={e=>categoryChange(ci,{decision:categoryDecision(e.target.value)})}><option value="create">{t('menu.create')}</option><option value="use_existing">{t('menu.useExisting')}</option><option value="skip">{t('menu.skip')}</option></select></label>
        {category.decision==='use_existing'?<label>{t('menu.existingCategory')}<select required value={category.existing_category_id??''} onChange={e=>categoryChange(ci,{existing_category_id:e.target.value?Number(e.target.value):null})}><option value="">{t('menu.choose')}</option>{categories.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>:null}
        {category.duplicate_kind!=='none'?<span className="badge warning">{t('menu.duplicate',{kind:category.duplicate_kind})}</span>:null}</div>
        {category.products.map((product,pi)=><div className="form-grid" key={product.client_id}>
          <label>{t('menu.product')}<input value={product.name} onChange={e=>productChange(ci,pi,{name:e.target.value})}/></label>
          <label>{t('menu.variant')}<input value={product.variant??''} onChange={e=>productChange(ci,pi,{variant:e.target.value||null})}/></label>
          <label>{t('menu.priceMad')}<input min="0" step="0.01" type="number" value={product.sale_price??''} onChange={e=>productChange(ci,pi,{sale_price:e.target.value||null,requires_review:!e.target.value})}/></label>
          <label className="checkbox-label"><input checked={product.track_stock} type="checkbox" onChange={e=>productChange(ci,pi,{track_stock:e.target.checked})}/>{t('products.trackStock')}</label>
          <label>{t('menu.decision')}<select value={product.decision} onChange={e=>productChange(ci,pi,{decision:productDecision(e.target.value)})}><option value="create">{t('menu.import')}</option><option value="update_existing">{t('menu.updateExisting')}</option><option value="skip">{t('menu.skip')}</option></select></label>
          {product.decision==='update_existing'?<label>{t('menu.existingProduct')}<select required value={product.existing_product_id??''} onChange={e=>productChange(ci,pi,{existing_product_id:e.target.value?Number(e.target.value):null})}><option value="">{t('menu.choose')}</option>{products.filter(item=>!category.existing_category_id||item.category_id===category.existing_category_id).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>:null}
          {product.track_stock?<label>{t('menu.initialStock')}<input min="0" type="number" value={product.initial_stock??''} onChange={e=>productChange(ci,pi,{initial_stock:e.target.value===''?undefined:Number(e.target.value)})}/></label>:null}
          {product.requires_review||product.duplicate_kind!=='none'?<span className="badge warning">{product.requires_review?t('menu.review'):t('menu.duplicate',{kind:product.duplicate_kind})}</span>:null}
          {product.review_reasons.map(reason=><small key={reason}>{reason}</small>)}
        </div>)}</article>)}
      <button className="button" disabled={busy} onClick={confirm} type="button">{t('menu.confirm')}</button>
    </section>:null}
    {result?<div className="success-message">{t('menu.result',{categoriesCreated:result.categories.created,categoriesReused:result.categories.reused,categoriesIgnored:result.categories.ignored,productsCreated:result.products.created,productsUpdated:result.products.updated,productsIgnored:result.products.ignored,productsFailed:result.products.failed})}</div>:null}
  </section>
}
