import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  closeCashRegister,
  getCashRegisterSessions,
  getCurrentCashRegister,
  openCashRegister,
} from '../api/cash-register'
import {
  getCashRegisterReport,
  getWorkers,
  type WorkerInfo,
} from '../api/reports'
import { getSettings } from '../api/settings'
import { useAuth } from '../auth/useAuth'
import ErrorMessage from '../components/ErrorMessage'
import Loading from '../components/Loading'
import { useI18n } from '../i18n'
import type {
  CashRegisterSession,
  SalesReport,
} from '../types'
import {
  formatCurrency,
  getApiErrorMessage,
} from '../utils/format'
import {
  isTauriRuntime,
  nativePrintCashRegisterReport,
} from '../utils/nativePrint'
import { CorePosPrintError, printErrorMessage } from '../utils/printerErrors'

const cafeTime = (value: string, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Africa/Casablanca',
  }).format(new Date(value))

const registerManagers = new Set([
  'patron',
  'owner',
  'admin',
  'manager',
  'worker',
  'cashier',
])

export default function CaissePage() {
  const navigate = useNavigate()
  const { language, t } = useI18n()
  const locale =
    language === 'ar'
      ? 'ar-MA'
      : language === 'en'
        ? 'en-GB'
        : 'fr-MA'

  const paymentLabel = (method: string) => {
    const normalized = method.trim().toLowerCase()

    return normalized === 'cash' ||
      normalized === 'card' ||
      normalized === 'other'
      ? t(`payment.${normalized}`)
      : method
  }

  const { user } = useAuth()
  const canManageRegister = registerManagers.has(user?.role ?? '')

  const [current, setCurrent] =
    useState<CashRegisterSession | null>(null)
  const [history, setHistory] =
    useState<CashRegisterSession[]>([])
  const [report, setReport] =
    useState<SalesReport | null>(null)
  const [workerId, setWorkerId] = useState('')
  const [workers, setWorkers] =
    useState<WorkerInfo[]>([])
  const [openingCash, setOpeningCash] =
    useState('0.00')
  const [openingNote, setOpeningNote] =
    useState('')
  const [actualCash, setActualCash] =
    useState('')
  const [closingNote, setClosingNote] =
    useState('')
  const [loading, setLoading] = useState(true)
  const [reportLoading, setReportLoading] =
    useState(false)
  const [busy, setBusy] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [error, setError] =
    useState<string | null>(null)
  const [renderedAt] = useState(() => Date.now())

  const loadRegister = useCallback(async () => {
    try {
      setError(null)

      const currentSession =
        await getCurrentCashRegister()

      setCurrent(currentSession)

      if (canManageRegister) {
        const [sessions, workerData] =
          await Promise.all([
            getCashRegisterSessions(),
            getWorkers(),
          ])

        setHistory(sessions)
        setWorkers(workerData)
      } else {
        setHistory([])
        setWorkers([])
      }
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [canManageRegister])

  useEffect(() => {
    void loadRegister()
  }, [loadRegister])

  const loadReport = useCallback(
    async (sessionId: number | null) => {
      if (!canManageRegister || !sessionId) {
        setReport(null)
        return
      }

      try {
        setReportLoading(true)

        const data =
          await getCashRegisterReport(
            sessionId,
            workerId ? Number(workerId) : null,
          )

        setReport(data)
      } catch (err) {
        setError(getApiErrorMessage(err))
      } finally {
        setReportLoading(false)
      }
    },
    [canManageRegister, workerId],
  )

  useEffect(() => {
    void loadReport(current?.id ?? null)
  }, [current?.id, loadReport])

  async function open() {
    setBusy(true)

    try {
      setError(null)

      await openCashRegister(
        openingCash,
        openingNote.trim() || null,
      )

      setOpeningNote('')

      window.dispatchEvent(
        new Event('cash-register-changed'),
      )

      await loadRegister()
      navigate('/pos', { replace: true })
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function close() {
    setBusy(true)

    try {
      setError(null)

      await closeCashRegister(
        actualCash,
        closingNote.trim() || null,
      )

      setActualCash('')
      setClosingNote('')

      window.dispatchEvent(
        new Event('cash-register-changed'),
      )

      await loadRegister()
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function printReport() {
    if (!report || !current) return

    try {
      setPrinting(true)
      setError(null)

      if (!isTauriRuntime()) {
        if (typeof window.print !== 'function') {
          throw new CorePosPrintError('PRINT_BRIDGE_UNAVAILABLE')
        }
        window.print()
        return
      }

      const settings = await getSettings()

      await nativePrintCashRegisterReport(
        report,
        current,
        settings,
      )
    } catch (err) {
      setError(printErrorMessage(err, t))
    } finally {
      setPrinting(false)
    }
  }

  if (loading) {
    return <Loading label={t('cash.loading')} />
  }

  const salesTotal =
    report?.total_sales ?? current?.sales_total ?? 0
  const orderCount =
    report?.total_orders ?? current?.total_orders ?? 0

  return (
    <section className="cash-page">
      <div className="page-title cash-page-title">
        <div>
          <h2>{t('cash.title')}</h2>
          <p>{t('cash.subtitle')}</p>
        </div>

        {current ? (
          <div className="page-title-actions">
            <button
              className="button"
              onClick={() => navigate('/pos')}
              type="button"
            >
              {t('cash.goToPos')}
            </button>
          </div>
        ) : null}
      </div>

      <ErrorMessage message={error} />

      {!current ? (
        <section className="cash-opening-card">
          <div className="cash-opening-copy">
            <span className="cash-state-chip closed">
              {t('header.registerClosed')}
            </span>
            <h3>{t('cash.openingPanel')}</h3>
            <p>
              {canManageRegister
                ? t('cash.openHelp')
                : t('cash.closedStaffHelp')}
            </p>
          </div>

          {canManageRegister ? (
            <div className="cash-opening-form">
              <label>
                <span>{t('cash.openingCash')}</span>
                <input
                  min="0"
                  step="0.01"
                  type="number"
                  value={openingCash}
                  onChange={(event) =>
                    setOpeningCash(event.target.value)
                  }
                />
              </label>

              <label className="cash-note-field">
                <span>{t('cash.optionalNote')}</span>
                <input
                  maxLength={500}
                  value={openingNote}
                  onChange={(event) =>
                    setOpeningNote(event.target.value)
                  }
                />
              </label>

              <button
                className="button cash-open-button"
                disabled={busy || openingCash === ''}
                onClick={() => void open()}
                type="button"
              >
                {busy ? t('common.loading') : t('cash.open')}
              </button>
            </div>
          ) : null}
        </section>
      ) : (
        <>
          <section className="cash-operation-card">
            <div className="cash-operation-head">
              <div>
                <span className="cash-state-chip open">
                  {t('header.registerOpen')}
                </span>
                <h3>{t('cash.currentSession')}</h3>
                <p>
                  {t('cash.businessDay', {
                    date: current.business_date,
                  })}
                </p>
              </div>

              <button
                className="button cash-sale-cta"
                onClick={() => navigate('/pos')}
                type="button"
              >
                {t('cash.goToPos')}
              </button>
            </div>

            <div className="cash-kpi-grid">
              <article>
                <span>{t('cash.openingCash')}</span>
                <strong>
                  {formatCurrency(current.opening_cash)}
                </strong>
              </article>

              <article>
                <span>{t('cash.sales')}</span>
                <strong>
                  {formatCurrency(salesTotal)}
                </strong>
              </article>

              <article>
                <span>{t('cash.cashSales')}</span>
                <strong>
                  {formatCurrency(
                    current.cash_sales_total,
                  )}
                </strong>
              </article>

              <article>
                <span>{t('cash.expected')}</span>
                <strong>
                  {formatCurrency(
                    current.expected_cash,
                  )}
                </strong>
              </article>

              <article>
                <span>{t('cash.orders')}</span>
                <strong>{orderCount}</strong>
              </article>
            </div>

            <div className="cash-session-meta">
              <span>
                {t('cash.opening')} ·{' '}
                <strong>
                  {cafeTime(current.opened_at, locale)}
                </strong>
              </span>
              <span>
                {t('cash.openedBy')} ·{' '}
                <strong>
                  {current.opened_by?.name ??
                    t('common.notAvailable')}
                </strong>
              </span>
            </div>

            {renderedAt -
              new Date(current.opened_at).getTime() >
            18 * 60 * 60 * 1000 ? (
              <div className="badge warning">
                {t('cash.openTooLong')}
              </div>
            ) : null}
          </section>

          {canManageRegister ? (
            <section className="cash-close-card">
              <div>
                <span className="cash-section-kicker">
                  {t('cash.closePanel')}
                </span>
                <h3>{t('cash.close')}</h3>
                <p>{t('cash.closeHelp')}</p>
              </div>

              <div className="cash-close-form">
                <label>
                  <span>{t('cash.actualAmount')}</span>
                  <input
                    min="0"
                    step="0.01"
                    type="number"
                    value={actualCash}
                    onChange={(event) =>
                      setActualCash(event.target.value)
                    }
                  />
                </label>

                <label>
                  <span>{t('cash.closingNote')}</span>
                  <input
                    maxLength={500}
                    value={closingNote}
                    onChange={(event) =>
                      setClosingNote(event.target.value)
                    }
                  />
                </label>

                <button
                  className="button danger"
                  disabled={busy || actualCash === ''}
                  onClick={() => void close()}
                  type="button"
                >
                  {t('cash.close')}
                </button>
              </div>
            </section>
          ) : null}

          {canManageRegister ? (
            <details className="cash-admin-details">
              <summary>
                <span>
                  <strong>{t('cash.adminDetails')}</strong>
                  <small>{t('cash.adminDetailsHelp')}</small>
                </span>
                <span className="cash-details-action">
                  {t('cash.detailsAction')}
                </span>
              </summary>

              <div className="cash-admin-content">
                <div className="cash-report-toolbar no-print">
                  <label className="worker-picker">
                    <span>{t('cash.employee')}</span>
                    <select
                      value={workerId}
                      onChange={(event) =>
                        setWorkerId(event.target.value)
                      }
                    >
                      <option value="">
                        {t('reports.team')}
                      </option>

                      {workers.map((worker) => (
                        <option
                          key={worker.id}
                          value={worker.id}
                        >
                          {worker.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    className="button secondary"
                    disabled={
                      !report ||
                      reportLoading ||
                      printing
                    }
                    onClick={() => void printReport()}
                    type="button"
                  >
                    {printing
                      ? t('cash.printing')
                      : t('common.print')}
                  </button>
                </div>

                {reportLoading ? (
                  <Loading label={t('cash.reportLoading')} />
                ) : null}

                {report && !reportLoading ? (
                  <div className="cash-report-grid">
                    <section className="panel">
                      <div className="panel-title">
                        <h3>{t('cash.bestProducts')}</h3>
                      </div>

                      {report.best_products.length ? (
                        <div className="mini-list">
                          {report.best_products.map(
                            (product) => (
                              <div
                                key={product.product_id}
                              >
                                <span>{product.name}</span>
                                <strong>
                                  {product.quantity} -{' '}
                                  {formatCurrency(
                                    product.total,
                                  )}
                                </strong>
                              </div>
                            ),
                          )}
                        </div>
                      ) : (
                        <div className="empty-state">
                          {t('cash.noProducts')}
                        </div>
                      )}
                    </section>

                    <section className="panel cash-orders-panel">
                      <div className="panel-title">
                        <h3>
                          {t('cash.registerOrders')}
                        </h3>
                        <span>
                          {report.commandes.length}
                        </span>
                      </div>

                      {report.commandes.length ? (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>{t('cash.order')}</th>
                                <th>{t('cash.employee')}</th>
                                <th>{t('cash.time')}</th>
                                <th>
                                  {t('cash.paymentHeader')}
                                </th>
                                <th>{t('cash.total')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {report.commandes.map(
                                (sale) => (
                                  <tr key={sale.id}>
                                    <td>#{sale.id}</td>
                                    <td>
                                      {sale.user?.name ??
                                        t(
                                          'common.notAvailable',
                                        )}
                                    </td>
                                    <td>
                                      {cafeTime(
                                        sale.created_at,
                                        locale,
                                      )}
                                    </td>
                                    <td>
                                      {paymentLabel(
                                        sale.payment_method,
                                      )}
                                    </td>
                                    <td>
                                      {formatCurrency(
                                        sale.total,
                                      )}
                                    </td>
                                  </tr>
                                ),
                              )}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="empty-state">
                          {t('cash.noOrders')}
                        </div>
                      )}
                    </section>
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}
        </>
      )}

      {canManageRegister && history.length ? (
        <details className="cash-admin-details cash-history-details">
          <summary>
            <span>
              <strong>{t('cash.history')}</strong>
              <small>{t('cash.historyHelp')}</small>
            </span>
            <span className="cash-details-action">
              {t('cash.detailsAction')}
            </span>
          </summary>

          <div className="cash-admin-content">
            <div className="mini-list">
              {history.map((item) => (
                <div key={item.id}>
                  <span>
                    #{item.id} - {item.business_date} -{' '}
                    {item.status === 'open'
                      ? t('cash.openStatus')
                      : t('cash.closedStatus')}
                  </span>

                  <strong>
                    {formatCurrency(item.sales_total)}
                    {item.difference !== null
                      ? ` - ${t('cash.historyDifference', {
                          amount: formatCurrency(
                            item.difference,
                          ),
                        })}`
                      : ''}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        </details>
      ) : null}
    </section>
  )
}
