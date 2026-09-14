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

type ProductForm = {
  category_id: string;
  name: string;
  sale_price: string;
  stock: string;
  min_stock: string;
  is_active: boolean;
};

const emptyForm: ProductForm = {
  category_id: "",
  name: "",
  sale_price: "",
  stock: "0",
  min_stock: "0",
  is_active: true,
};

function getProductImage(product: Product) {
  return product.image_url || product.image || "";
}

export default function ProductsPage() {
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
      sale_price: String(product.sale_price),
      stock: String(product.stock),
      min_stock: String(product.min_stock),
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
    data.append("sale_price", String(Number(form.sale_price || 0)));
    data.append("stock", String(Number(form.stock || 0)));
    data.append("min_stock", String(Number(form.min_stock || 0)));
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
        setSuccess("Produit modifié.");
      } else {
        await createProduct(payload);
        setSuccess("Produit ajouté.");
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
    if (!window.confirm(`Supprimer ${product.name} ?`)) return;

    try {
      setError(null);
      await deleteProduct(product.id);
      setSuccess("Produit supprimé.");
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
          <h2>Products</h2>
          <p>
            Gérez les prix, les images, le stock minimum et les produits actifs.
          </p>
        </div>
      </div>

      {isLoading ? <Loading label="Chargement des produits..." /> : null}
      <ErrorMessage message={error} />
      {success ? <div className="success-message">{success}</div> : null}

      {!isLoading ? (
        <>
          <section className="panel form-panel">
            <div className="panel-title">
              <h3>{editingProduct ? "Modifier produit" : "Ajouter produit"}</h3>

              {editingProduct ? (
                <button
                  className="button secondary"
                  onClick={resetForm}
                  type="button"
                >
                  Annuler
                </button>
              ) : null}
            </div>

            <form className="form-grid product-form" onSubmit={handleSubmit}>
              <label>
                Category
                <select
                  value={form.category_id}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      category_id: event.target.value,
                    }))
                  }
                >
                  <option value="">Sans catégorie</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Name
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
                Sale price
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

              <label>
                Stock
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
                Min stock
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
                Image
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
                      setError(`L'image ne doit pas dépasser ${maxSizeInMb}MB.`);
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
                  <p>Image actuelle:</p>
                  <img
                    alt={editingProduct?.name ?? "Produit"}
                    className="product-image-preview"
                    src={currentImage}
                  />
                </div>
              ) : null}

              {previewImage ? (
                <div className="wide">
                  <p>Nouvelle image:</p>
                  <img
                    alt="Preview"
                    className="product-image-preview"
                    src={previewImage}
                  />
                </div>
              ) : null}

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
                Active
              </label>

              <button className="button" disabled={isSubmitting} type="submit">
                {editingProduct ? "Enregistrer" : "Ajouter"}
              </button>
            </form>
          </section>

          <div className="toolbar">
            <input
              placeholder="Rechercher produit..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />

            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option value="">Toutes catégories</option>
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
                const isLowStock = product.stock <= product.min_stock;
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
                        <p>{product.category?.name ?? "Sans catégorie"}</p>
                      </div>

                      <span
                        className={`badge ${
                          product.is_active ? "success" : "muted"
                        }`}
                      >
                        {product.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>

                    <div className="product-meta">
                      <span>Vente: {formatCurrency(product.sale_price)}</span>
                      <span className={isLowStock ? "text-warning" : undefined}>
                        Stock: {product.stock} / min {product.min_stock}
                      </span>
                    </div>

                    {isLowStock ? (
                      <span className="badge warning">Low stock</span>
                    ) : null}

                    <div className="card-actions">
                      <button
                        className="button secondary"
                        onClick={() => startEdit(product)}
                        type="button"
                      >
                        Edit
                      </button>

                      <button
                        className="button danger"
                        onClick={() => handleDelete(product)}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">Aucun produit trouvé.</div>
          )}
        </>
      ) : null}
    </section>
  );
}
