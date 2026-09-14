import { useEffect, useState, type FormEvent } from "react";
import { createSupplier, getSuppliers } from "../api/core-v2";
import type { Supplier } from "../types";
import { formatCurrency, formatDate } from "../utils/format";
import { useI18n } from "../i18n";
export default function SuppliersPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Supplier[]>([]),
    [name, setName] = useState(""),
    [phone, setPhone] = useState("");
  const load = () => getSuppliers().then(setRows);
  useEffect(() => {
    void load();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    await createSupplier({ name, phone, active: true });
    setName("");
    setPhone("");
    await load();
  }
  return (
    <section>
      <div className="page-title">
        <div>
          <h2>{t('suppliers.title')}</h2>
          <p>{t('suppliers.subtitle')}</p>
        </div>
      </div>
      <form className="settings-card form-grid settings-grid" onSubmit={submit}>
        <label>
          {t('common.name')}
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          {t('common.phone')}
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <button className="button" type="submit">
          {t('common.add')}
        </button>
      </form>
      {rows.length ? (
        <div className="users-list">
          {rows.map((s) => {
            const h = s as Supplier & {
              purchase_count?: number;
              received_count?: number;
              received_total?: number;
              returned_total?: number;
              last_purchase_at?: string;
            };
            return (
              <article className="user-row" key={s.id}>
                <span>
                  <strong>{s.name}</strong>
                  <small>{s.phone || s.email || t('suppliers.noContact')}</small>
                </span>
                <span>
                  <strong>
                    {t('suppliers.purchasesReceived', { purchases: h.purchase_count ?? 0, received: h.received_count ?? 0 })}
                  </strong>
                  <small>
                    {t('suppliers.receivedAmount', { amount: formatCurrency(Number(h.received_total ?? 0)) })} ·
                    {t('suppliers.returnsAmount', { amount: formatCurrency(Number(h.returned_total ?? 0)) })}
                    {h.last_purchase_at
                      ? ` · ${t('suppliers.last', { date: formatDate(h.last_purchase_at) })}`
                      : ""}
                  </small>
                </span>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">{t('suppliers.empty')}</div>
      )}
    </section>
  );
}
