import { useEffect, useState } from "react";
import {
  getMonthlyReport,
  getTodayReport,
  getWorkers,
  type WorkerInfo,
} from "../api/reports";
import { getSettings } from "../api/settings";
import ErrorMessage from "../components/ErrorMessage";
import Loading from "../components/Loading";
import type { SalesReport } from "../types";
import {
  formatCurrency,
  formatDate,
  getApiErrorMessage,
} from "../utils/format";
import { isTauriRuntime, nativePrintCashReport } from "../utils/nativePrint";
import { CorePosPrintError, printErrorMessage } from "../utils/printerErrors";
import { useI18n } from "../i18n";

function currentMonthValue() {
  const now = new Date();

  return `${now.getFullYear()}-${String(
    now.getMonth() + 1,
  ).padStart(2, "0")}`;
}

export default function RapportPage() {
  const { t } = useI18n();
  const [workerId, setWorkerId] = useState("");
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);

  const [todayReport, setTodayReport] =
    useState<SalesReport | null>(null);

  const [todayLoading, setTodayLoading] =
    useState(true);

  const [month, setMonth] =
    useState(currentMonthValue);

  const [monthlyReport, setMonthlyReport] =
    useState<SalesReport | null>(null);

  const [monthlyLoading, setMonthlyLoading] =
    useState(true);

  const [printing, setPrinting] =
    useState<"day" | "month" | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadWorkers() {
      try {
        const data = await getWorkers();

        if (active) {
          setWorkers(data);
        }
      } catch (err) {
        if (active) {
          setError(getApiErrorMessage(err));
        }
      }
    }

    void loadWorkers();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadToday() {
      try {
        setTodayLoading(true);
        setError(null);

        const data = await getTodayReport(
          workerId ? Number(workerId) : null,
        );

        if (active) {
          setTodayReport(data);
        }
      } catch (err) {
        if (active) {
          setError(getApiErrorMessage(err));
        }
      } finally {
        if (active) {
          setTodayLoading(false);
        }
      }
    }

    void loadToday();

    return () => {
      active = false;
    };
  }, [workerId]);

  useEffect(() => {
    let active = true;

    async function loadMonthly() {
      try {
        setMonthlyLoading(true);
        setError(null);

        const data = await getMonthlyReport(month);

        if (active) {
          setMonthlyReport(data);
        }
      } catch (err) {
        if (active) {
          setError(getApiErrorMessage(err));
        }
      } finally {
        if (active) {
          setMonthlyLoading(false);
        }
      }
    }

    void loadMonthly();

    return () => {
      active = false;
    };
  }, [month]);

  async function printReport(
    report: SalesReport,
    title: string,
    kind: "day" | "month",
  ) {
    try {
      setPrinting(kind);
      setError(null);

      if (!isTauriRuntime()) {
        if (typeof window.print !== "function") {
          throw new CorePosPrintError("PRINT_BRIDGE_UNAVAILABLE");
        }
        window.print();
        return;
      }

      const settings = await getSettings();

      await nativePrintCashReport(
        report,
        settings,
        title,
      );
    } catch (err) {
      setError(printErrorMessage(err, t));
    } finally {
      setPrinting(null);
    }
  }

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>{t('reports.title')}</h2>
          <p>{t('reports.subtitle')}</p>
        </div>
      </div>

      <ErrorMessage message={error} />

      <section className="panel">
        <div className="panel-title">
          <div>
            <h3>{t('reports.today')}</h3>
            <span>
              {todayReport?.period.date ?? t('reports.todayFallback')}
            </span>
          </div>

          <div className="page-title-actions no-print">
            <label className="worker-picker">
              {t('reports.employee')}

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
              type="button"
              disabled={
                !todayReport ||
                todayLoading ||
                printing !== null
              }
              onClick={() => {
                if (todayReport) {
                  void printReport(
                    todayReport,
                    t('reports.today'),
                    "day",
                  );
                }
              }}
            >
              {printing === "day"
                ? t('reports.printing')
                : t('common.print')}
            </button>
          </div>
        </div>

        {todayLoading ? (
          <Loading label={t('reports.loadingToday')} />
        ) : null}

        {todayReport && !todayLoading ? (
          <>
            {todayReport.period.worker_name ? (
              <div className="badge">
                {t('reports.employeeFilter', { name: todayReport.period.worker_name })}
              </div>
            ) : null}

            <div className="report-stats">
              <article>
                <span>{t('cash.sales')}</span>
                <strong>
                  {formatCurrency(todayReport.total_sales)}
                </strong>
              </article>

              <article>
                <span>{t('cash.orders')}</span>
                <strong>{todayReport.total_orders}</strong>
              </article>

              <article>
                <span>{t('reports.productsSold')}</span>
                <strong>
                  {todayReport.total_products_sold}
                </strong>
              </article>
            </div>

            <div className="best-products">
              <h4>{t('reports.best')}</h4>

              {todayReport.best_products.length ? (
                <div className="mini-list">
                  {todayReport.best_products.map(
                    (product) => (
                      <div key={product.product_id}>
                        <span>{product.name}</span>

                        <strong>
                          {product.quantity} -{" "}
                          {formatCurrency(product.total)}
                        </strong>
                      </div>
                    ),
                  )}
                </div>
              ) : (
                <div className="empty-state">
                  {t('reports.noSalesToday')}
                </div>
              )}
            </div>

            <div className="panel-title">
              <h3>{t('reports.todayOrders')}</h3>
              <span>{todayReport.commandes.length}</span>
            </div>

            {todayReport.commandes.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('cash.order')}</th>
                      <th>{t('reports.employee')}</th>
                      <th>{t('cash.total')}</th>
                      <th>{t('cash.paymentHeader')}</th>
                      <th>{t('stock.date')}</th>
                      <th>{t('cash.products')}</th>
                    </tr>
                  </thead>

                  <tbody>
                    {todayReport.commandes.map((sale) => (
                      <tr key={sale.id}>
                        <td>#{sale.id}</td>

                        <td>
                          {sale.user?.name ?? t('common.notAvailable')}
                        </td>

                        <td>
                          {formatCurrency(sale.total)}
                        </td>

                        <td>
                          {sale.payment_method === "cash"
                            ? t('payment.cash')
                            : sale.payment_method}
                        </td>

                        <td>
                          {formatDate(sale.created_at)}
                        </td>

                        <td>
                          {sale.items?.length
                            ? sale.items
                                .map(
                                  (item) =>
                                    `${
                                      item.product?.name ??
                                      `${t('reports.product')} #${item.product_id}`
                                    } x ${item.quantity}`,
                                )
                                .join(", ")
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                {t('reports.noOrdersToday')}
              </div>
            )}
          </>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <h3>{t('reports.monthly')}</h3>
            <span>
              {monthlyReport?.period.month ?? month}
            </span>
          </div>

          <div className="page-title-actions no-print">
            <label className="month-picker">
              {t('reports.month')}

              <input
                type="month"
                value={month}
                onChange={(event) =>
                  setMonth(event.target.value)
                }
              />
            </label>

            <button
              className="button secondary"
              type="button"
              disabled={
                !monthlyReport ||
                monthlyLoading ||
                printing !== null
              }
              onClick={() => {
                if (monthlyReport) {
                  void printReport(
                    monthlyReport,
                    t('reports.monthly'),
                    "month",
                  );
                }
              }}
            >
              {printing === "month"
                ? t('reports.printing')
                : t('common.print')}
            </button>
          </div>
        </div>

        {monthlyLoading ? (
          <Loading label={t('reports.loadingMonthly')} />
        ) : null}

        {monthlyReport && !monthlyLoading ? (
          <>
            <div className="report-stats">
              <article>
                <span>{t('reports.monthSales')}</span>
                <strong>
                  {formatCurrency(
                    monthlyReport.total_sales,
                  )}
                </strong>
              </article>

              <article>
                <span>{t('cash.orders')}</span>
                <strong>
                  {monthlyReport.total_orders}
                </strong>
              </article>

              <article>
                <span>{t('reports.productsSold')}</span>
                <strong>
                  {monthlyReport.total_products_sold}
                </strong>
              </article>
            </div>

            <div className="best-products">
              <h4>
                {t('reports.monthBest')}
              </h4>

              {monthlyReport.best_products.length ? (
                <div className="mini-list">
                  {monthlyReport.best_products.map(
                    (product) => (
                      <div key={product.product_id}>
                        <span>{product.name}</span>

                        <strong>
                          {product.quantity} -{" "}
                          {formatCurrency(product.total)}
                        </strong>
                      </div>
                    ),
                  )}
                </div>
              ) : (
                <div className="empty-state">
                  {t('reports.noSalesMonth')}
                </div>
              )}
            </div>
          </>
        ) : null}
      </section>
    </section>
  );
}
