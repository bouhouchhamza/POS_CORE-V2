import { useCallback, useEffect, useState } from "react";
import { getTodayReport, getWorkers, type WorkerInfo } from "../api/reports";
import ErrorMessage from "../components/ErrorMessage";
import Loading from "../components/Loading";
import ReportPrint from "../components/ReportPrint";
import type { SalesReport } from "../types";
import { formatCurrency, getApiErrorMessage } from "../utils/format";

export default function CaissePage() {
  const [todayReport, setTodayReport] = useState<SalesReport | null>(null);
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>("");
  const [isReportLoading, setIsReportLoading] = useState(true);
  const [shouldPrintDailyReport, setShouldPrintDailyReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // Load workers list on mount
  useEffect(() => {
    async function loadWorkers() {
      try {
        const data = await getWorkers();
        setWorkers(data);
      } catch {
        // Workers list is optional — patron can still see all workers report
      }
    }
    loadWorkers();
  }, []);

  const loadTodayReport = useCallback(async (workerId?: number | null) => {
    try {
      setReportError(null);
      setIsReportLoading(true);
      setTodayReport(await getTodayReport(workerId));
    } catch (err) {
      setReportError(getApiErrorMessage(err));
    } finally {
      setIsReportLoading(false);
    }
  }, []);

  // Load report on mount and when worker selection changes
  useEffect(() => {
    const workerId = selectedWorkerId ? Number(selectedWorkerId) : null;
    loadTodayReport(workerId);
  }, [loadTodayReport, selectedWorkerId]);

  useEffect(() => {
    if (!shouldPrintDailyReport) return;

    const handleAfterPrint = () => setShouldPrintDailyReport(false);
    const timeout = window.setTimeout(() => window.print(), 50);

    window.addEventListener("afterprint", handleAfterPrint);

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("afterprint", handleAfterPrint);
    };
  }, [shouldPrintDailyReport]);

  const selectedWorkerName = todayReport?.period?.worker_name ?? null;
  const reportSubtitle = selectedWorkerName
    ? `Rapport dyal ${selectedWorkerName}`
    : "Rapport dyal sells dyal nhar.";

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>Sales</h2>
          <p>{reportSubtitle}</p>
        </div>

        <div className="page-title-actions no-print">
          <label className="worker-picker">
            Worker
            <select
              value={selectedWorkerId}
              onChange={(e) => setSelectedWorkerId(e.target.value)}
            >
              <option value="">Tous les workers</option>
              {workers.map((w) => (
                <option key={w.id} value={String(w.id)}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>

          <button
            className="button secondary"
            disabled={!todayReport || isReportLoading}
            onClick={() => setShouldPrintDailyReport(true)}
            type="button"
          >
            Imprimer
          </button>
        </div>
      </div>

      {isReportLoading ? <Loading label="Chargement rapport..." /> : null}

      <ErrorMessage message={reportError} />

      {!isReportLoading && todayReport ? (
        <section className="daily-report panel">
          <div className="panel-title">
            <div>
              <h3>Rapport dyal lyom</h3>
              <span>
                {todayReport.period.date ?? "Aujourd hui"}
                {selectedWorkerName ? ` — ${selectedWorkerName}` : ""}
              </span>
            </div>
          </div>

          <div className="report-stats">
            <article>
              <span>Total ventes dyal lyom</span>
              <strong>{formatCurrency(todayReport.total_sales)}</strong>
            </article>

            <article>
              <span>Nombre commandes dyal lyom</span>
              <strong>{todayReport.total_orders}</strong>
            </article>

            <article>
              <span>Produits vendus lyom</span>
              <strong>{todayReport.total_products_sold}</strong>
            </article>
          </div>

          <div className="best-products">
            <h4>Best products dyal lyom</h4>

            {todayReport.best_products && Array.isArray(todayReport.best_products) && todayReport.best_products.length ? (
              <div className="mini-list">
                {todayReport.best_products.map((product) => (
                  <div key={product.product_id}>
                    <span>{product.name}</span>
                    <strong>
                      {product.quantity} - {formatCurrency(product.total)}
                    </strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">Ma kaynach ventes lyom.</div>
            )}
          </div>
        </section>
      ) : null}

      {!isReportLoading && !todayReport && !reportError ? (
        <div className="empty-state">Ma kayn ta rapport lyom.</div>
      ) : null}

      {shouldPrintDailyReport && todayReport ? (
        <ReportPrint
          className="daily-report-print"
          periodLabel={
            (todayReport.period.date ?? "Aujourd hui") +
            (selectedWorkerName ? ` — ${selectedWorkerName}` : "")
          }
          report={todayReport}
          title="Rapport journalier"
        />
      ) : null}
    </section>
  );
}
