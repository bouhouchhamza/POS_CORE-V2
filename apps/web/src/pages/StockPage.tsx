import { useEffect, useMemo, useState } from 'react'
import { getProducts } from '../api/products'
import {
  correctStock,
  decreaseStock,
  getStockMovements,
  increaseStock,
} from '../api/stock'
import ErrorMessage from '../components/ErrorMessage'
import Loading from '../components/Loading'
import type { Product, StockMovement } from '../types'
import { formatDate, getApiErrorMessage } from '../utils/format'
import { useI18n } from '../i18n'
import {confirmInventoryCount,createInventoryCount,getInventoryCount,type InventoryCount} from '../api/inventory-counts'

type StockAction = 'increase' | 'decrease' | 'correction'

type StockForm = {
  action: StockAction
  quantity: string
  stock: string
  note: string
}

const defaultStockForm: StockForm = {
  action: 'increase',
  quantity: '1',
  stock: '0',
  note: '',
}

export default function StockPage() {
  const { t } = useI18n()
  const [products, setProducts] = useState<Product[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [forms, setForms] = useState<Record<number, StockForm>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [busyProductId, setBusyProductId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [inventory,setInventory]=useState<InventoryCount|null>(null)
  const [inventoryValues,setInventoryValues]=useState<Record<number,string>>({})

  async function loadData() {
    try {
      setError(null)
      const [productsData, movementsData] = await Promise.all([
        getProducts(),
        getStockMovements(),
      ])
      setProducts(productsData)
      setMovements(movementsData)
      setForms((current) => {
        const next = { ...current }
        const safeProducts = Array.isArray(productsData) ? productsData : []
        safeProducts.forEach((product) => {
          if (!next[product.id]) {
            next[product.id] = {
              ...defaultStockForm,
              stock: String(product.stock),
            }
          }
        })
        return next
      })
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const recentMovements = useMemo(() => movements.slice(0, 20), [movements])

  function updateForm(productId: number, changes: Partial<StockForm>) {
    setForms((current) => ({
      ...current,
      [productId]: {
        ...(current[productId] ?? defaultStockForm),
        ...changes,
      },
    }))
  }

  async function applyStockAction(product: Product) {
    const form = forms[product.id] ?? defaultStockForm
    setError(null)
    setSuccess(null)
    setBusyProductId(product.id)

    try {
      if (form.action === 'increase') {
        await increaseStock(product.id, {
          quantity: Number(form.quantity || 0),
          note: form.note.trim() || null,
        })
      }

      if (form.action === 'decrease') {
        await decreaseStock(product.id, {
          quantity: Number(form.quantity || 0),
          note: form.note.trim() || null,
        })
      }

      if (form.action === 'correction') {
        await correctStock(product.id, {
          stock: Number(form.stock || 0),
          note: form.note.trim() || null,
        })
      }

      setSuccess(t('stock.saved'))
      await loadData()
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      setBusyProductId(null)
    }
  }

  async function startInventory(){try{const created=await createInventoryCount(t('stock.inventoryPhysical'));const detail=await getInventoryCount(created.id);setInventory(detail);setInventoryValues(Object.fromEntries((detail.items??[]).map(item=>[item.product_id,String(item.expected_stock)])))}catch(err){setError(getApiErrorMessage(err))}}
  async function finishInventory(){if(!inventory)return;try{const {saveInventoryCount}=await import('../api/inventory-counts');await saveInventoryCount(inventory.id,Object.entries(inventoryValues).map(([product_id,counted_stock])=>({product_id:Number(product_id),counted_stock:Number(counted_stock)})));await confirmInventoryCount(inventory.id);setInventory(null);setSuccess(t('stock.inventorySuccess'));await loadData()}catch(err){setError(getApiErrorMessage(err))}}

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>{t('stock.title')}</h2>
          <p>{t('stock.subtitle')}</p>
        </div>
        <button className="button" onClick={()=>void startInventory()} type="button">{t('stock.newInventory')}</button>
      </div>

      {isLoading ? <Loading label={t('stock.loading')} /> : null}
      <ErrorMessage message={error} />
      {success ? <div className="success-message">{success}</div> : null}

      {!isLoading ? (
        <>
          {products.length ? (
            <div className="stock-grid">
              {products.map((product) => {
                const form = forms[product.id] ?? {
                  ...defaultStockForm,
                  stock: String(product.stock),
                }
                const isLowStock = product.track_stock && product.stock <= product.min_stock

                return (
                  <article
                    className={`stock-card ${isLowStock ? 'low-stock' : ''}`}
                    key={product.id}
                  >
                    <div>
                      <h3>{product.name}</h3>
                      <p>{product.category?.name ?? t('products.noCategory')}</p>
                    </div>
                    <div className={`stock-number ${isLowStock ? 'warning' : ''}`}>
                      <span>{t('products.stock')}</span>
                      <strong>{product.track_stock ? product.stock : '—'}</strong>
                    </div>

                    {product.track_stock ? <div className="stock-form">
                      <select
                        value={form.action}
                        onChange={(event) =>
                          updateForm(product.id, {
                            action: event.target.value as StockAction,
                          })
                        }
                      >
                        <option value="increase">{t('stock.increase')}</option>
                        <option value="decrease">{t('stock.decrease')}</option>
                        <option value="correction">{t('stock.correction')}</option>
                      </select>

                      {form.action === 'correction' ? (
                        <input
                          min="0"
                          type="number"
                          value={form.stock}
                          onChange={(event) =>
                            updateForm(product.id, { stock: event.target.value })
                          }
                        />
                      ) : (
                        <input
                          min="1"
                          type="number"
                          value={form.quantity}
                          onChange={(event) =>
                            updateForm(product.id, { quantity: event.target.value })
                          }
                        />
                      )}

                      <input
                        placeholder={t('stock.note')}
                        value={form.note}
                        onChange={(event) =>
                          updateForm(product.id, { note: event.target.value })
                        }
                      />

                      <button
                        className="button"
                        disabled={busyProductId === product.id}
                        onClick={() => applyStockAction(product)}
                        type="button"
                      >
                        {t('stock.apply')}
                      </button>
                    </div> : <div className="badge muted">{t('products.stockUntracked')}</div>}
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="empty-state">{t('stock.noProducts')}</div>
          )}

          <section className="panel stock-history">
            <div className="panel-title">
              <h3>{t('stock.recent')}</h3>
              <span>{recentMovements.length}</span>
            </div>

            {recentMovements.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('reports.product')}</th>
                      <th>{t('stock.type')}</th>
                      <th>{t('stock.quantity')}</th>
                      <th>{t('stock.before')}</th>
                      <th>{t('stock.after')}</th>
                      <th>{t('stock.note')}</th>
                      <th>{t('stock.date')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentMovements.map((movement) => (
                      <tr key={movement.id}>
                        <td>{movement.product?.name ?? `${t('reports.product')} #${movement.product_id}`}</td>
                        <td>
                          <span className="badge">{t(`stock.${movement.type}`)}</span>
                        </td>
                        <td>{movement.quantity}</td>
                        <td>{movement.before_stock}</td>
                        <td>{movement.after_stock}</td>
                        <td>{movement.note ?? '-'}</td>
                        <td>{formatDate(movement.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">{t('stock.noMovements')}</div>
            )}
          </section>
        </>
      ) : null}
      {inventory?<div className="modal-backdrop" role="dialog" aria-modal="true"><div className="modal large-modal"><div className="panel-title"><div><h3>{t('stock.inventoryTitle',{id:inventory.id})}</h3><span>{t('stock.inventoryHelp')}</span></div><button className="button secondary" onClick={()=>setInventory(null)} type="button">{t('common.close')}</button></div><div className="table-wrap"><table><thead><tr><th>{t('common.product')}</th><th>{t('stock.expected')}</th><th>{t('stock.counted')}</th><th>{t('stock.difference')}</th></tr></thead><tbody>{inventory.items?.map(item=>{const counted=Number(inventoryValues[item.product_id]??item.expected_stock);return <tr key={item.id}><td>{item.name}<small>{item.unit}</small></td><td>{item.expected_stock}</td><td><input min="0" onChange={event=>setInventoryValues(current=>({...current,[item.product_id]:event.target.value}))} step="0.001" type="number" value={inventoryValues[item.product_id]??''}/></td><td>{counted-Number(item.expected_stock)}</td></tr>})}</tbody></table></div><div className="modal-actions"><button className="button" onClick={()=>void finishInventory()} type="button">{t('stock.confirmAdjustments')}</button></div></div></div>:null}
    </section>
  )
}
