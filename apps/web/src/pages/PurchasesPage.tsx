import { useEffect, useState, type FormEvent } from "react";
import {
  createPurchase,
  getPurchase,
  getPurchases,
  getSuppliers,
  receivePurchase,
  returnPurchase,
} from "../api/core-v2";
import { getProducts } from "../api/products";
import type { Product, Purchase, PurchaseDetail, PurchaseItem, Supplier } from "../types";
import { getApiErrorMessage } from "../utils/format";
import ErrorMessage from "../components/ErrorMessage";
import { useI18n } from "../i18n";

export default function PurchasesPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Purchase[]>([]),
    [suppliers, setSuppliers] = useState<Supplier[]>([]),
    [products, setProducts] = useState<Product[]>([]),
    [supplier, setSupplier] = useState(0),
    [product, setProduct] = useState(0),
    [reference, setReference] = useState(""),
    [quantity, setQuantity] = useState(1),
    [price, setPrice] = useState(0),
    [detail, setDetail] = useState<PurchaseDetail | null>(null),
    [returnItem, setReturnItem] = useState(0),
    [returnQuantity, setReturnQuantity] = useState(1),
    [reason, setReason] = useState(""),
    [error, setError] = useState<string | null>(null);
  const load = () =>
    Promise.all([getPurchases(), getSuppliers(), getProducts()]).then(
      ([a, b, c]) => {
        setRows(a);
        setSuppliers(b);
        setProducts(c);
        setSupplier((x) => x || b[0]?.id || 0);
        setProduct((x) => x || c[0]?.id || 0);
      },
    );
  useEffect(() => {
    void load();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await createPurchase({
        supplier_id: supplier,
        reference,
        status: "ordered",
        payment_status: "unpaid",
        tax: 0,
        items: [
          { product_id: product, quantity, purchase_price: price, tax: 0 },
        ],
      });
      setReference("");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  }
  async function openDetail(id: number) {
    try {
      const value = await getPurchase(id);
      setDetail(value);
      setReturnItem(value.items?.[0]?.id ?? 0);
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  }
  async function submitReturn() {
    if (!detail || !returnItem || reason.trim().length < 2) return;
    try {
      await returnPurchase(detail.id, {
        purchase_item_id: returnItem,
        quantity: returnQuantity,
        reason: reason.trim(),
      });
      setDetail(await getPurchase(detail.id));
      setReason("");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  }
  return (
    <section>
      <div className="page-title">
        <div>
          <h2>{t('purchases.title')}</h2>
          <p>{t('purchases.subtitle')}</p>
        </div>
      </div>
      <ErrorMessage message={error} />
      <form className="settings-card form-grid settings-grid" onSubmit={submit}>
        <label>
          {t('purchases.supplier')}
          <select
            value={supplier}
            onChange={(e) => setSupplier(Number(e.target.value))}
          >
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('common.reference')}
          <input
            required
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        <label>
          {t('common.product')}
          <select
            value={product}
            onChange={(e) => setProduct(Number(e.target.value))}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('common.quantity')}
          <input
            type="number"
            min="0.001"
            step="0.001"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </label>
        <label>
          {t('purchases.purchasePrice')}
          <input
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
          />
        </label>
        <button className="button" type="submit">
          {t('common.create')}
        </button>
      </form>
      <div className="users-list">
        {rows.length ? (
          rows.map((p) => (
            <article className="user-row" key={p.id}>
              <span>
                <strong>{p.reference}</strong>
                <small>
                  {p.supplier_name} · {t(`purchases.status.${p.status}`)}
                </small>
              </span>
              <div className="table-actions">
                <button
                  className="button secondary"
                  onClick={() => void openDetail(p.id)}
                  type="button"
                >
                  {t('common.details')}
                </button>
                {p.status !== "received" && p.status !== "cancelled" ? (
                  <button
                    className="button"
                    onClick={async () => {
                      await receivePurchase(p.id);
                      await load();
                    }}
                    type="button"
                  >
                    {t('purchases.receive')}
                  </button>
                ) : null}
              </div>
            </article>
          ))
        ) : (
          <div className="empty-state">{t('purchases.empty')}</div>
        )}
      </div>
      {detail ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal large-modal">
            <div className="panel-title">
              <h3>{t('purchases.detailTitle', { reference: detail.reference })}</h3>
              <button
                className="button secondary"
                onClick={() => setDetail(null)}
                type="button"
              >
                {t('common.close')}
              </button>
            </div>
            <p>
              {detail.supplier_name} · {t(`purchases.status.${detail.status}`)}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('common.product')}</th>
                    <th>{t('common.received')}</th>
                    <th>{t('common.returned')}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items?.map((item: PurchaseItem) => (
                    <tr key={item.id}>
                      <td>{item.product_name}</td>
                      <td>{item.received_quantity}</td>
                      <td>{item.returned_quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detail.status === "received" ? (
              <div className="panel">
                <h4>{t('purchases.supplierReturn')}</h4>
                <label>
                  {t('common.product')}
                  <select
                    value={returnItem}
                    onChange={(e) => setReturnItem(Number(e.target.value))}
                  >
                    {detail.items?.map((item: PurchaseItem) => (
                      <option key={item.id} value={item.id}>
                        {item.product_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('common.quantity')}
                  <input
                    min="0.001"
                    step="0.001"
                    type="number"
                    value={returnQuantity}
                    onChange={(e) => setReturnQuantity(Number(e.target.value))}
                  />
                </label>
                <label>
                  {t('common.reason')}
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button
                  className="button"
                  onClick={() => void submitReturn()}
                  type="button"
                >
                  {t('purchases.confirmReturn')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
