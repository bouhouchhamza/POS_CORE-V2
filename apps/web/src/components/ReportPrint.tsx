import type { SalesReport } from '../types'
import { formatCurrency, formatDate } from '../utils/format'
import { useI18n } from '../i18n'

type ReportPrintProps = {
  className: string
  report: SalesReport
  title: string
  periodLabel: string
}

function formatTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export default function ReportPrint({
  className,
  periodLabel,
  report,
  title,
}: ReportPrintProps) {
  const { language, t } = useI18n()
  const locale = language === 'ar' ? 'ar-MA' : language === 'en' ? 'en-GB' : 'fr-MA'
  const paymentLabel = (method: string) => {
    const normalized = method.trim().toLowerCase()
    return normalized === 'cash' || normalized === 'card' || normalized === 'other' ? t(`payment.${normalized}`) : method
  }
  return (
    <section className={`report-print ${className}`}>
      <header className="report-print-header">
        <h1>Bimik POS</h1>
        <h2>{title}</h2>
        <p>{periodLabel}</p>
      </header>

      <div className="report-print-summary">
        <div>
          <span>{t('cash.sales')}</span>
          <strong>{formatCurrency(report.total_sales)}</strong>
        </div>
        <div>
          <span>{t('reports.orderCount')}</span>
          <strong>{report.total_orders}</strong>
        </div>
        <div>
          <span>{t('cash.productsSold')}</span>
          <strong>{report.total_products_sold}</strong>
        </div>
      </div>
      {report.session ? <section className="report-print-section">
        <h3>{t('cash.title')} — {report.session.status === 'open' ? t('reports.provisional') : t('reports.closed')}</h3>
        <p>{t('cash.opening')} : {formatDate(report.session.opened_at)} · {formatTime(report.session.opened_at, locale)} — {report.session.opened_by.name}</p>
        {report.session.closed_at ? <p>{t('cash.closing')} : {formatDate(report.session.closed_at)} · {formatTime(report.session.closed_at, locale)} — {report.session.closed_by?.name ?? t('common.notAvailable')}</p> : null}
        <p>{t('cash.openingCash')} : {formatCurrency(report.session.opening_cash)} · {t('payment.cash')} : {formatCurrency(report.session.cash_sales_total)} · {t('cash.expected')} : {formatCurrency(report.session.expected_cash)}</p>
        {report.session.actual_cash !== null ? <p>{t('cash.declared')} : {formatCurrency(report.session.actual_cash)} · {t('cash.difference')} : {formatCurrency(report.session.difference ?? 0)}</p> : null}
      </section> : null}

      <section className="report-print-section">
        <h3>{t('reports.best')}</h3>
        {report.best_products && Array.isArray(report.best_products) && report.best_products.length ? (
          <table>
            <thead>
              <tr>
                <th>{t('reports.product')}</th>
                <th>{t('reports.quantity')}</th>
                <th>{t('cash.total')}</th>
              </tr>
            </thead>
            <tbody>
              {report.best_products.map((product) => (
                <tr key={product.product_id}>
                  <td>{product.name}</td>
                  <td>{product.quantity}</td>
                  <td>{formatCurrency(product.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>{t('cash.noProducts')}</p>
        )}
      </section>

      <section className="report-print-section">
        <h3>{t('reports.details')}</h3>
        {report.commandes && Array.isArray(report.commandes) && report.commandes.length ? (
          report.commandes.map((sale) => (
            <article className="report-sale" key={sale.id}>
              <div className="report-sale-head">
                <strong>{t('cash.order')} #{sale.id}</strong>
                <span>{formatDate(sale.created_at)}</span>
                <span>{t('cash.time')}: {formatTime(sale.created_at, locale)}</span>
                <span>{t('reports.cashier')}: {sale.user?.name ?? t('common.notAvailable')}</span>
                <span>{t('cash.paymentHeader')}: {paymentLabel(sale.payment_method)}</span>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>{t('reports.product')}</th>
                    <th>{t('reports.quantity')}</th>
                    <th>{t('reports.unitPrice')}</th>
                    <th>{t('reports.lineTotal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sale.items && Array.isArray(sale.items) && sale.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.product?.name ?? `${t('reports.product')} #${item.product_id}`}</td>
                      <td>{item.quantity}</td>
                      <td>{formatCurrency(item.unit_price)}</td>
                      <td>{formatCurrency(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>{t('reports.orderTotal')}</td>
                    <td>{formatCurrency(sale.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </article>
          ))
        ) : (
          <p>{t('reports.noSales')}</p>
        )}
      </section>
    </section>
  )
}
