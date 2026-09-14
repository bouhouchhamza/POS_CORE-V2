import { useEffect, useState } from 'react'
import { getDashboardSummary, type DashboardSummary } from '../api/dashboard'
import ErrorMessage from '../components/ErrorMessage'
import Loading from '../components/Loading'
import { formatCurrency, getApiErrorMessage } from '../utils/format'

/* ── Inline SVG icons (no external dependency) ── */

function IconWallet({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  )
}

function IconReceipt({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
      <path d="M12 17.5v-11" />
    </svg>
  )
}

function IconAlert({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  )
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  )
}

const emptySummary: DashboardSummary = {
  today_sales: 0,
  today_tickets: 0,
  low_stock_count: 0,
  low_stock_products: [],
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function loadDashboard() {
      try {
        setError(null)
        const data = await getDashboardSummary()
        if (mounted) setSummary({ ...emptySummary, ...data })
      } catch (err) {
        if (mounted) setError(getApiErrorMessage(err))
      } finally {
        if (mounted) setIsLoading(false)
      }
    }

    loadDashboard()

    return () => {
      mounted = false
    }
  }, [])

  const hasLowStock = summary.low_stock_count > 0

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>Dashboard</h2>
          <p>Vue rapide dyal lyoum</p>
        </div>
      </div>

      {isLoading ? <Loading label="Chargement du dashboard..." /> : null}
      <ErrorMessage message={error} />

      {!isLoading && !error ? (
        <>
          {/* ── Summary Cards ── */}
          <div className="dash-grid">
            {/* Today Sales */}
            <article className="dash-card">
              <div className="dash-card-icon dash-icon-sales">
                <IconWallet />
              </div>
              <div className="dash-card-body">
                <span className="dash-card-label">Today Sales</span>
                <strong className="dash-card-value">{formatCurrency(summary.today_sales)}</strong>
                <span className="dash-card-helper">Total ventes dyal lyoum</span>
              </div>
            </article>

            {/* Today Tickets */}
            <article className="dash-card">
              <div className="dash-card-icon dash-icon-tickets">
                <IconReceipt />
              </div>
              <div className="dash-card-body">
                <span className="dash-card-label">Today Tickets</span>
                <strong className="dash-card-value">{summary.today_tickets}</strong>
                <span className="dash-card-helper">Tickets / commandes dyal lyoum</span>
              </div>
            </article>

            {/* Low Stock */}
            <article className={`dash-card ${hasLowStock ? 'dash-card-warn' : 'dash-card-ok'}`}>
              <div className={`dash-card-icon ${hasLowStock ? 'dash-icon-warn' : 'dash-icon-ok'}`}>
                {hasLowStock ? <IconAlert /> : <IconCheck />}
              </div>
              <div className="dash-card-body">
                <span className="dash-card-label">Low Stock</span>
                <strong className="dash-card-value">
                  {hasLowStock ? `${summary.low_stock_count} produit${summary.low_stock_count > 1 ? 's' : ''}` : '0'}
                </strong>
                <span className="dash-card-helper">
                  {hasLowStock ? 'Produits khas stock' : 'Stock mzyan'}
                </span>
              </div>
            </article>
          </div>

          {/* ── Stock Alert Panel ── */}
          <section className={`stock-alert ${hasLowStock ? 'stock-alert-warn' : 'stock-alert-ok'}`}>
            <div className="stock-alert-head">
              <h3 className="stock-alert-title">
                {hasLowStock ? <IconAlert className="stock-alert-icon" /> : <IconCheck className="stock-alert-icon" />}
                Alerte Stock
              </h3>
              {hasLowStock ? (
                <span className="stock-status-badge warn">
                  {summary.low_stock_count} produit{summary.low_stock_count > 1 ? 's' : ''} à surveiller
                </span>
              ) : (
                <span className="stock-status-badge ok">Tout est bon</span>
              )}
            </div>

            {hasLowStock ? (
              <>
                <p className="stock-alert-msg">Kayna chi produits stock dyalhom na9es.</p>
                <div className="stock-alert-list">
                  {summary.low_stock_products && Array.isArray(summary.low_stock_products) ? (
                    summary.low_stock_products.map((product) => (
                      <div className="stock-alert-row" key={product.id}>
                        <div className="stock-alert-product">
                          <strong>{product.name}</strong>
                          {product.category_name ? (
                            <span className="stock-alert-cat">{product.category_name}</span>
                          ) : null}
                        </div>
                        <div className="stock-alert-meta">
                          <span className="stock-qty">{product.stock_quantity} en stock</span>
                          <span className="stock-badge-warn">Stock faible</span>
                        </div>
                      </div>
                    ))
                  ) : null}
                </div>
              </>
            ) : (
              <div className="stock-alert-empty">
                <p>Aucun produit en stock faible</p>
                <span>Stock mzyan daba.</span>
              </div>
            )}
          </section>
        </>
      ) : null}
    </section>
  )
}
