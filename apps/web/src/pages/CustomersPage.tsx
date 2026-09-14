import { useEffect, useState, type FormEvent } from "react";
import { createCustomer, getCustomers } from "../api/core-v2";
import type { Customer } from "../types";
import { formatCurrency, formatDate } from "../utils/format";
import { useI18n } from "../i18n";
export default function CustomersPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Customer[]>([]),
    [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [email, setEmail] = useState("");
  const load = () => getCustomers().then(setRows);
  useEffect(() => {
    void load();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    await createCustomer({
      name,
      phone: phone || null,
      email: email || null,
      active: true,
    });
    setName("");
    setPhone("");
    setEmail("");
    await load();
  }
  return (
    <section>
      <div className="page-title">
        <div>
          <h2>{t('customers.title')}</h2>
          <p>{t('customers.subtitle')}</p>
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
        <label>
          {t('common.email')}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button className="button" type="submit">
          {t('common.add')}
        </button>
      </form>
      {rows.length ? (
        <div className="users-list">
          {rows.map((c) => {
            const h = c as Customer & {
              order_count?: number;
              total_spent?: number;
              last_purchase_at?: string;
            };
            return (
              <article className="user-row" key={c.id}>
                <span>
                  <strong>{c.name}</strong>
                  <small>{c.phone || c.email || t('customers.noContact')}</small>
                </span>
                <span>
                  <strong>
                    {h.order_count ?? 0} {t('customers.purchases')} ·{" "}
                    {formatCurrency(Number(h.total_spent ?? 0))}
                  </strong>
                  <small>
                    {h.last_purchase_at
                      ? t('customers.lastPurchase', { date: formatDate(h.last_purchase_at) })
                      : t('customers.noPurchase')}
                  </small>
                </span>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">{t('customers.empty')}</div>
      )}
    </section>
  );
}
