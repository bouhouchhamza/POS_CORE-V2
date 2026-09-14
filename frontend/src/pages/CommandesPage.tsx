import { useEffect, useMemo, useState } from 'react'
import { getCategories } from '../api/categories'
import { getProducts } from '../api/products'
import { createSale, printSaleTicket } from '../api/sales'
import {
  defaultSettings,
  getPublicSettings,
  type AppSettings,
} from '../api/settings'
import { useAuth } from '../auth/useAuth'
import ErrorMessage from '../components/ErrorMessage'
import Loading from '../components/Loading'
import Receipt, { type ReceiptSale } from '../components/Receipt'
import type { Category, Product, Sale } from '../types'
import { formatCurrency, getApiErrorMessage } from '../utils/format'

type OrderItem = {
  product: Product
  quantity: number
}

function getCategoryImage(category: Category) {
  return category.image_url || category.image || ''
}

function getProductImage(product: Product) {
  return product.image_url || product.image || ''
}

function ReceiptCopies({
  sale,
  settings,
}: {
  sale: Sale
  settings: AppSettings
}) {
  const ticketWidth = settings.ticket_width === 58 ? 58 : 80

  return (
    <div className={`ticket-print-copies ticket-${ticketWidth}`}>
      <div className={`ticket-copy ticket-${ticketWidth}`}>
        <Receipt copyLabel="Copie Client" sale={sale} settings={settings} />
      </div>
      <div className={`ticket-copy ticket-${ticketWidth}`}>
        <Receipt copyLabel="Copie Café" sale={sale} settings={settings} />
      </div>
    </div>
  )
}

export default function CommandesPage() {
  const { user } = useAuth()
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [order, setOrder] = useState<OrderItem[]>([])
  const [selectedCategory, setSelectedCategory] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [note, setNote] = useState('commande serveur')
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function loadData() {
    try {
      setError(null)
      const [categoriesData, productsData, settingsData] = await Promise.all([
        getCategories(),
        getProducts(),
        getPublicSettings().catch(() => defaultSettings),
      ])
      setCategories(categoriesData)
      setProducts(productsData)
      setSettings(settingsData)
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const activeProducts = useMemo(
    () => {
      const safeProducts = Array.isArray(products) ? products : []
      return safeProducts.filter((product) => product.is_active)
    },
    [products],
  )

  const visibleProducts = useMemo(() => {
    const safeActive = Array.isArray(activeProducts) ? activeProducts : []
    if (!selectedCategory) return safeActive

    return safeActive.filter(
      (product) => String(product.category_id ?? '') === selectedCategory,
    )
  }, [activeProducts, selectedCategory])

  const orderTotal = (() => {
    const safeOrder = Array.isArray(order) ? order : []
    return safeOrder.reduce(
      (total, item) => total + item.quantity * item.product.sale_price,
      0,
    )
  })()

  const draftSale = useMemo<ReceiptSale>(
    () => ({
      id: 'Brouillon',
      isDraft: true,
      user,
      total: orderTotal,
      payment_method: paymentMethod,
      note: note.trim() || null,
      created_at: new Date().toISOString(),
      items: order.map((item, index) => ({
        id: index + 1,
        product_id: item.product.id,
        product: item.product,
        quantity: item.quantity,
        unit_price: item.product.sale_price,
        total: item.quantity * item.product.sale_price,
      })),
    }),
    [note, order, orderTotal, paymentMethod, user],
  )

  function getOrderQuantity(productId: number) {
    const safeOrder = Array.isArray(order) ? order : []
    return safeOrder.find((item) => item.product.id === productId)?.quantity ?? 0
  }

  function addProduct(product: Product) {
    if (product.stock <= 0) return
    setSuccess(null)

    setOrder((current) => {
      const safeOrder = Array.isArray(current) ? current : []
      const existing = safeOrder.find((item) => item.product.id === product.id)

      if (!existing) return [...safeOrder, { product, quantity: 1 }]
      if (existing.quantity >= product.stock) return safeOrder

      return safeOrder.map((item) =>
        item.product.id === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item,
      )
    })
  }

  function decreaseProduct(productId: number) {
    setSuccess(null)
    setOrder((current) => {
      const safeOrder = Array.isArray(current) ? current : []
      return safeOrder
        .map((item) =>
          item.product.id === productId
            ? { ...item, quantity: item.quantity - 1 }
            : item,
        )
        .filter((item) => item.quantity > 0)
    })
  }

  function removeProduct(productId: number) {
    setSuccess(null)
    setOrder((current) => {
      const safeOrder = Array.isArray(current) ? current : []
      return safeOrder.filter((item) => item.product.id !== productId)
    })
  }

  function openPreview() {
    if (!order.length) {
      setError('Ajoutez au moins un produit à la commande.')
      return
    }

    setError(null)
    setSuccess(null)
    setIsPreviewOpen(true)
  }

  function printFinalReceipt(closeAfterPrint: boolean) {
    let finished = false
    const ticketWidth = settings.ticket_width === 58 ? '58mm' : '80mm'

    document.body.classList.add('ticket-print-mode')
    document.body.style.setProperty('--ticket-page-width', ticketWidth)

    const finish = () => {
      if (finished) return
      finished = true
      window.removeEventListener('afterprint', finish)
      document.body.classList.remove('ticket-print-mode')
      document.body.style.removeProperty('--ticket-page-width')
      if (closeAfterPrint) setReceiptSale(null)
    }

    window.addEventListener('afterprint', finish)
    window.setTimeout(() => {
      window.print()
      window.setTimeout(finish, 1200)
    }, 120)
  }

  async function printSavedSale(sale: Sale, options?: { closeAfterPrint?: boolean }) {
    if (settings.direct_print_enabled) {
      setIsPrinting(true)

      try {
        await printSaleTicket(sale.id, 2)
        setSuccess('Commande validée et ticket imprimé.')
        if (options?.closeAfterPrint) setReceiptSale(null)
      } catch (err) {
        const message = getApiErrorMessage(err)

        if (settings.fallback_browser_print) {
          setError(
            `Commande validée mais impression directe échouée: ${message}. Impression navigateur ouverte en fallback.`,
          )
          printFinalReceipt(Boolean(options?.closeAfterPrint))
        } else {
          setError(`Commande validée mais impression échouée: ${message}`)
        }
      } finally {
        setIsPrinting(false)
      }

      return
    }

    printFinalReceipt(Boolean(options?.closeAfterPrint))
  }

  async function confirmAndPrint() {
    if (!order.length || isSubmitting) return

    setError(null)
    setSuccess(null)
    setIsSubmitting(true)

    try {
      const sale = await createSale({
        payment_method: paymentMethod,
        note: note.trim() || 'commande serveur',
        items: order.map((item) => ({
          product_id: item.product.id,
          quantity: item.quantity,
        })),
      })

      setReceiptSale(sale)
      setIsPreviewOpen(false)
      setOrder([])
      setNote('commande serveur')
      setSuccess('Commande validée et facture imprimée.')
      await loadData()
      await printSavedSale(sale, {
        closeAfterPrint: !settings.open_ticket_after_order,
      })
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="commandes-page">
      <div className="page-title">
        <div>
          <h2>Commandes</h2>
          <p>Interface rapide pour prendre une commande et vérifier la facture.</p>
        </div>
      </div>

      {isLoading ? <Loading label="Chargement des commandes..." /> : null}
      <ErrorMessage message={error} />
      {success ? <div className="success-message">{success}</div> : null}

      {!isLoading ? (
        <div className="command-layout">
          <section className="command-menu">
            <div className="worker-category-grid">
              <button
                className={`worker-category-card ${
                  !selectedCategory ? 'active' : ''
                }`}
                onClick={() => setSelectedCategory('')}
                type="button"
              >
                <span className="worker-category-placeholder">T</span>
                <strong>Tous</strong>
              </button>
              {Array.isArray(categories) && categories.map((category) => (
                <button
                  className={`worker-category-card ${
                    selectedCategory === String(category.id) ? 'active' : ''
                  }`}
                  key={category.id}
                  onClick={() => setSelectedCategory(String(category.id))}
                  type="button"
                >
                  {getCategoryImage(category) ? (
                    <img
                      alt={category.name}
                      className="worker-category-image"
                      src={getCategoryImage(category)}
                    />
                  ) : (
                    <span className="worker-category-placeholder">
                      {category.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <strong>{category.name}</strong>
                </button>
              ))}
            </div>

            {visibleProducts.length ? (
              <div className="worker-products-grid command-products">
                {visibleProducts.map((product) => {
                  const quantityInOrder = getOrderQuantity(product.id)
                  const disabled =
                    product.stock <= 0 || quantityInOrder >= product.stock
                  const image = getProductImage(product)

                  return (
                    <button
                      className="worker-product-card command-product"
                      disabled={disabled}
                      key={product.id}
                      onClick={() => addProduct(product)}
                      type="button"
                    >
                      {image ? (
                        <img
                          alt={product.name}
                          className="worker-product-image"
                          src={image}
                        />
                      ) : (
                        <span className="worker-product-placeholder">
                          {product.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <span className="product-card-name">{product.name}</span>
                      <b>{formatCurrency(product.sale_price)}</b>
                      {product.stock <= 0 ? (
                        <span className="badge warning">Rupture</span>
                      ) : product.stock <= product.min_stock ? (
                        <span className="badge warning">Stock {product.stock}</span>
                      ) : (
                        <span className="badge muted">Stock {product.stock}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="empty-state">Aucun produit actif dans cette catégorie.</div>
            )}
          </section>

          <aside className="command-cart">
            <div className="panel-title">
              <h3>Commande</h3>
              <span>{order.length} lignes</span>
            </div>

            {order.length && Array.isArray(order) ? (
              <div className="cart-list">
                {order.map((item) => (
                  <div className="cart-item" key={item.product.id}>
                    <div className="cart-item-head">
                      <div>
                        <strong>{item.product.name}</strong>
                        <span>{formatCurrency(item.product.sale_price)}</span>
                      </div>
                      <b>{formatCurrency(item.quantity * item.product.sale_price)}</b>
                    </div>
                    <div className="qty-controls">
                      <button
                        className="qty-button"
                        onClick={() => decreaseProduct(item.product.id)}
                        type="button"
                      >
                        -
                      </button>
                      <strong>{item.quantity}</strong>
                      <button
                        className="qty-button"
                        disabled={item.quantity >= item.product.stock}
                        onClick={() => addProduct(item.product)}
                        type="button"
                      >
                        +
                      </button>
                      <button
                        className="qty-button remove"
                        onClick={() => removeProduct(item.product.id)}
                        type="button"
                      >
                        x
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">Commande vide.</div>
            )}

            <label>
              Paiement
              <select
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
              >
                <option value="cash">Espèces</option>
                <option value="card">Carte</option>
                <option value="other">Autre</option>
              </select>
            </label>

            <label>
              Note
              <input value={note} onChange={(event) => setNote(event.target.value)} />
            </label>

            <div className="cart-total">
              <span>Total</span>
              <strong>{formatCurrency(orderTotal)}</strong>
            </div>

            <button
              className="button command-submit"
              disabled={!order.length || isSubmitting}
              onClick={openPreview}
              type="button"
            >
              Vérifier commande
            </button>
          </aside>
        </div>
      ) : null}

      {isPreviewOpen ? (
        <div className="modal-backdrop no-print" role="dialog" aria-modal="true">
          <div className="modal receipt-modal">
            <div className="panel-title no-print">
              <div>
                <h3>Vérifier la facture</h3>
                <span>Vérifiez les produits avant validation.</span>
              </div>
              <button
                className="button secondary no-print"
                disabled={isSubmitting}
                onClick={() => setIsPreviewOpen(false)}
                type="button"
              >
                Modifier
              </button>
            </div>

            <Receipt
              draftLabel="Facture provisoire"
              sale={draftSale}
              settings={settings}
            />

            <div className="modal-actions split-actions no-print">
              <button
                className="button secondary"
                disabled={isSubmitting}
                onClick={() => setIsPreviewOpen(false)}
                type="button"
              >
                Retour
              </button>
              <button
                className="button command-print"
                disabled={isSubmitting || isPrinting}
                onClick={confirmAndPrint}
                type="button"
              >
                {isSubmitting
                  ? 'Validation...'
                  : isPrinting
                    ? 'Impression en cours...'
                    : 'Confirmer et imprimer'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {receiptSale ? (
        <div className="modal-backdrop no-print" role="dialog" aria-modal="true">
          <div className="modal receipt-modal">
            <div className="panel-title">
              <div>
                <h3>Ticket commande #{receiptSale.id}</h3>
                <span>Deux copies prêtes pour impression.</span>
              </div>
              <button
                className="button secondary no-print"
                onClick={() => setReceiptSale(null)}
                type="button"
              >
                Fermer
              </button>
            </div>

            <ReceiptCopies sale={receiptSale} settings={settings} />

            <div className="modal-actions no-print">
              <button
                className="button command-print"
                disabled={isPrinting}
                onClick={() => printSavedSale(receiptSale)}
                type="button"
              >
                {isPrinting ? 'Impression en cours...' : 'Imprimer 2 copies'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {receiptSale ? (
        <div className="ticket-print-host" aria-hidden="true">
          <ReceiptCopies sale={receiptSale} settings={settings} />
        </div>
      ) : null}
    </section>
  )
}
