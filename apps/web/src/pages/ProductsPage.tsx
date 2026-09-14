import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getCategories } from "../api/categories";
import {
  createProduct,
  deleteProduct,
  getProducts,
  updateProduct,
} from "../api/products";
import ErrorMessage from "../components/ErrorMessage";
import Loading from "../components/Loading";
import type { Category, Product } from "../types";
import { formatCurrency, getApiErrorMessage } from "../utils/format";
import { resolveAssetUrl } from "../api/client";
import { useI18n } from "../i18n";

type ProductForm = {
  category_id: string;
  name: string;
  sku:string;
  barcode:string;
  unit:string;
  tax_rate:string;
  sale_price: string;
  stock: string;
  min_stock: string;
  track_stock: boolean;
  is_active: boolean;
};

const emptyForm: ProductForm = {
  category_id: "",
  name: "",
  sku:"",barcode:"",unit:"piece",tax_rate:"0",
  sale_price: "",
  stock: "0",
  min_stock: "0",
  track_stock: true,
  is_active: true,
};

function getProductImage(product: Product) {
  return resolveAssetUrl(product.image_url || product.image);
}

export default function ProductsPage() {
  const { t } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadData() {
    try {
      setError(null);

      const [productsData, categoriesData] = await Promise.all([
        getProducts(),
        getCategories(),
      ]);

      setProducts(productsData);
      setCategories(categoriesData);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filteredProducts = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();
    const safeProducts = Array.isArray(products) ? products : [];

    return safeProducts.filter((product) => {
      const matchesSearch = product.name.toLowerCase().includes(searchTerm);
      const matchesCategory = categoryFilter
        ? String(product.category_id ?? "") === categoryFilter
        : true;

      return matchesSearch && matchesCategory;
    });
  }, [categoryFilter, products, search]);

  function startEdit(product: Product) {
    setEditingProduct(product);
    setImageFile(null);
    setSuccess(null);

    setForm({
      category_id: product.category_id ? String(product.category_id) : "",
      name: product.name,
      sku:product.sku??"",barcode:product.barcode??"",unit:product.unit??"piece",tax_rate:String(product.tax_rate??0),
      sale_price: String(product.sale_price),
      stock: String(product.stock),
      min_stock: String(product.min_stock),
      track_stock: product.track_stock,
      is_active: product.is_active,
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setEditingProduct(null);
    setForm(emptyForm);
    setImageFile(null);
    setSuccess(null);
  }

  function toFormData(): FormData {
    const data = new FormData();

    data.append("category_id", form.category_id);

    data.append("name", form.name.trim());
    data.append('sku',form.sku.trim());data.append('barcode',form.barcode.trim());data.append('unit',form.unit);data.append('tax_rate',String(Number(form.tax_rate||0)));
    data.append("sale_price", String(Number(form.sale_price || 0)));
    data.append("stock", String(Number(form.stock || 0)));
    data.append("min_stock", String(Number(form.min_stock || 0)));
    data.append("track_stock", form.track_stock ? "true" : "false");
    data.append("is_active", form.is_active ? "1" : "0");

    if (imageFile) {
      data.append("image", imageFile);
    }

    return data;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      const payload = toFormData();

      if (editingProduct) {
        await updateProduct(editingProduct.id, payload);
        setSuccess(t('products.updated'));
      } else {
        await createProduct(payload);
        setSuccess(t('products.created'));
      }

      resetForm();
      await loadData();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(product: Product) {
    if (!window.confirm(t('products.confirmDelete', { name: product.name }))) return;

    try {
      setError(null);
      await deleteProduct(product.id);
      setSuccess(t('products.deleted'));
      await loadData();
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  }

  const currentImage = editingProduct ? getProductImage(editingProduct) : "";
  const previewImage = imageFile ? URL.createObjectURL(imageFile) : "";

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>{t('products.title')}</h2>
          <p>{t('products.subtitle')}</p>
        </div>
      </div>

      {isLoading ? <Loading label={t('products.loading')} /> : null}
      <ErrorMessage message={error} />
      {success ? <div className="success-message">{success}</div> : null}

      {!isLoading ? (
        <>
          <section className="panel form-panel">
            <div className="panel-title">
              <h3>{t(editingProduct ? 'products.edit' : 'products.add')}</h3>

              {editingProduct ? (
                <button
                  className="button secondary"
                  onClick={resetForm}
                  type="button"
                >
                  {t('common.cancel')}
                </button>
              ) : null}
            </div>

            <form className="form-grid product-form" onSubmit={handleSubmit}>
              <label>
                {t('products.category')}
                <select
                  value={form.category_id}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      category_id: event.target.value,
                    }))
                  }
                >
                  <option value="">{t('products.noCategory')}</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                {t('products.name')}
                <input
                  required
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>

              <label>
                {t('products.salePrice')}
                <input
                  min="0"
                  required
                  step="0.01"
                  type="number"
                  value={form.sale_price}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      sale_price: event.target.value,
                    }))
                  }
                />
              </label>

              <label>SKU<input value={form.sku} onChange={event=>setForm(current=>({...current,sku:event.target.value}))}/></label>
              <label>Code-barres<input value={form.barcode} onChange={event=>setForm(current=>({...current,barcode:event.target.value}))}/></label>
              <label>Unité<select value={form.unit} onChange={event=>setForm(current=>({...current,unit:event.target.value}))}>{['piece','kg','gram','liter','ml','pack','box','custom'].map(unit=><option key={unit}>{unit}</option>)}</select></label>
              <label>Taxe %<input min="0" max="100" step="0.001" type="number" value={form.tax_rate} onChange={event=>setForm(current=>({...current,tax_rate:event.target.value}))}/></label>

              <label>
                {t('products.stock')}
                <input
                  min="0"
                  type="number"
                  value={form.stock}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      stock: event.target.value,
                    }))
                  }
                />
              </label>

              <label>
                {t('products.minStock')}
                <input
                  min="0"
                  type="number"
                  value={form.min_stock}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      min_stock: event.target.value,
                    }))
                  }
                />
              </label>

              <label>
                {t('products.image')}
                <input
                  accept="image/*"
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;

                    if (!file) {
                      setImageFile(null);
                      return;
                    }

                    const maxSizeInMb = 5;
                    const maxSizeInBytes = maxSizeInMb * 1024 * 1024;

                    if (file.size > maxSizeInBytes) {
                      setError(t('products.imageTooLarge', { size: maxSizeInMb }));
                      setImageFile(null);
                      event.target.value = "";
                      return;
                    }

                    setError(null);
                    setImageFile(file);
                  }}
                />
              </label>

              {currentImage ? (
                <div className="wide">
                  <p>{t('products.currentImage')}</p>
                  <img
                    alt={editingProduct?.name ?? "Produit"}
                    className="product-image-preview"
                    src={currentImage}
                  />
                </div>
              ) : null}

              {previewImage ? (
                <div className="wide">
                  <p>{t('products.newImage')}</p>
                  <img
                    alt="Preview"
                    className="product-image-preview"
                    src={previewImage}
                  />
                </div>
              ) : null}

              <label className="checkbox-label">
                <input checked={form.track_stock} type="checkbox" onChange={(event) => setForm((current) => ({ ...current, track_stock: event.target.checked }))} />
                {t('products.trackStock')}
              </label>
              <p className="wide">{t('products.trackHelp')}</p>

              <label className="checkbox-label">
                <input
                  checked={form.is_active}
                  type="checkbox"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      is_active: event.target.checked,
                    }))
                  }
                />
                {t('common.active')}
              </label>

              <button className="button" disabled={isSubmitting} type="submit">
                {t(editingProduct ? 'common.save' : 'common.add')}
              </button>
            </form>
          </section>

          <div className="toolbar">
            <input
              placeholder={t('products.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />

            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option value="">{t('products.allCategories')}</option>
              {Array.isArray(categories) && categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          {filteredProducts && Array.isArray(filteredProducts) && filteredProducts.length ? (
            <div className="product-grid">
              {filteredProducts.map((product) => {
                const isLowStock = product.track_stock && product.stock <= product.min_stock;
                const image = getProductImage(product);

                return (
                  <article className="product-card" key={product.id}>
                    {image ? (
                      <img
                        alt={product.name}
                        className="product-image"
                        src={image}
                      />
                    ) : (
                      <div className="product-image product-image-placeholder">
                        {product.name.charAt(0).toUpperCase()}
                      </div>
                    )}

                    <div className="product-card-header">
                      <div>
                        <h3>{product.name}</h3>
                        <p>{product.category?.name ?? t('products.noCategory')}</p>
                      </div>

                      <span
                        className={`badge ${
                          product.is_active ? "success" : "muted"
                        }`}
                      >
                        {t(product.is_active ? 'common.active' : 'common.inactive')}
                      </span>
                    </div>

                    <div className="product-meta">
                      <span>{t('products.salePrice')}: {formatCurrency(product.sale_price)}</span>
                      <span className="badge muted">{t(product.track_stock ? 'products.stockTracked' : 'products.stockUntracked')}</span>
                      <span className={isLowStock ? "text-warning" : undefined}>
                        {t('products.stock')}: {product.track_stock ? `${product.stock} / min ${product.min_stock}` : "—"}
                      </span>
                    </div>

                    {isLowStock ? (
                      <span className="badge warning">{t('products.lowStock')}</span>
                    ) : null}

                    <div className="card-actions">
                      <button
                        className="button secondary"
                        onClick={() => startEdit(product)}
                        type="button"
                      >
                        {t('common.edit')}
                      </button>

                      <button
                        className="button danger"
                        onClick={() => handleDelete(product)}
                        type="button"
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">{t('products.empty')}</div>
          )}
        </>
      ) : null}
    </section>
  );
}
