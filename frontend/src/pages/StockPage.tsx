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
  const [products, setProducts] = useState<Product[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [forms, setForms] = useState<Record<number, StockForm>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [busyProductId, setBusyProductId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

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

      setSuccess('Mouvement de stock enregistré.')
      await loadData()
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      setBusyProductId(null)
    }
  }

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>Stock</h2>
          <p>Entrées, sorties, corrections et historique des mouvements.</p>
        </div>
      </div>

      {isLoading ? <Loading label="Chargement du stock..." /> : null}
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
                const isLowStock = product.stock <= product.min_stock

                return (
                  <article
                    className={`stock-card ${isLowStock ? 'low-stock' : ''}`}
                    key={product.id}
                  >
                    <div>
                      <h3>{product.name}</h3>
                      <p>{product.category?.name ?? 'Sans catégorie'}</p>
                    </div>
                    <div className={`stock-number ${isLowStock ? 'warning' : ''}`}>
                      <span>Stock</span>
                      <strong>{product.stock}</strong>
                    </div>

                    <div className="stock-form">
                      <select
                        value={form.action}
                        onChange={(event) =>
                          updateForm(product.id, {
                            action: event.target.value as StockAction,
                          })
                        }
                      >
                        <option value="increase">increase</option>
                        <option value="decrease">decrease</option>
                        <option value="correction">correction</option>
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
                        placeholder="Note"
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
                        Apply
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="empty-state">Aucun produit.</div>
          )}

          <section className="panel stock-history">
            <div className="panel-title">
              <h3>Recent stock movements</h3>
              <span>{recentMovements.length}</span>
            </div>

            {recentMovements.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Type</th>
                      <th>Qty</th>
                      <th>Before</th>
                      <th>After</th>
                      <th>Note</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentMovements.map((movement) => (
                      <tr key={movement.id}>
                        <td>{movement.product?.name ?? `Produit #${movement.product_id}`}</td>
                        <td>
                          <span className="badge">{movement.type}</span>
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
              <div className="empty-state">Aucun mouvement de stock.</div>
            )}
          </section>
        </>
      ) : null}
    </section>
  )
}
