import { useEffect, useState, type FormEvent } from 'react'
import {
  createCategory,
  deleteCategory,
  getCategories,
  updateCategory,
} from '../api/categories'
import ErrorMessage from '../components/ErrorMessage'
import Loading from '../components/Loading'
import type { Category } from '../types'
import { formatDate, getApiErrorMessage } from '../utils/format'

const maxImageSize = 5 * 1024 * 1024

function getCategoryImage(category: Category) {
  return category.image_url || category.image || ''
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [name, setName] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function loadCategories() {
    try {
      setError(null)
      setCategories(await getCategories())
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadCategories()
  }, [])

  function resetForm() {
    setName('')
    setImageFile(null)
    setEditingCategory(null)
    setSuccess(null)
  }

  function handleImageChange(file: File | null) {
    if (!file) {
      setImageFile(null)
      return
    }

    if (file.size > maxImageSize) {
      setError("L'image ne doit pas depasser 5MB.")
      setImageFile(null)
      return
    }

    setError(null)
    setImageFile(file)
  }

  function buildPayload() {
    const data = new FormData()
    data.append('name', name.trim())

    if (imageFile) {
      data.append('image', imageFile)
    }

    return data
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    setIsSubmitting(true)

    try {
      if (editingCategory) {
        await updateCategory(editingCategory.id, buildPayload())
        setSuccess('Categorie modifiee.')
      } else {
        await createCategory(buildPayload())
        setSuccess('Categorie ajoutee.')
      }

      resetForm()
      await loadCategories()
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete(category: Category) {
    if (!window.confirm(`Supprimer ${category.name} ?`)) return

    try {
      setError(null)
      await deleteCategory(category.id)
      setSuccess('Categorie supprimee.')
      await loadCategories()
    } catch (err) {
      setError(getApiErrorMessage(err))
    }
  }

  const currentImage = editingCategory ? getCategoryImage(editingCategory) : ''
  const previewImage = imageFile ? URL.createObjectURL(imageFile) : ''

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>Categories</h2>
          <p>Organisez les produits par famille avec une image visible en commandes.</p>
        </div>
      </div>

      {isLoading ? <Loading label="Chargement des categories..." /> : null}
      <ErrorMessage message={error} />
      {success ? <div className="success-message">{success}</div> : null}

      {!isLoading ? (
        <>
          <section className="panel form-panel compact-form">
            <div className="panel-title">
              <h3>{editingCategory ? 'Modifier categorie' : 'Ajouter categorie'}</h3>
              {editingCategory ? (
                <button className="button secondary" onClick={resetForm} type="button">
                  Annuler
                </button>
              ) : null}
            </div>

            <form className="form-grid category-form" onSubmit={handleSubmit}>
              <label>
                Name
                <input
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>

              <label>
                Image
                <input
                  accept="image/*"
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null
                    handleImageChange(file)

                    if (file && file.size > maxImageSize) {
                      event.target.value = ''
                    }
                  }}
                />
              </label>

              {currentImage ? (
                <div>
                  <p>Image actuelle:</p>
                  <img
                    alt={editingCategory?.name ?? 'Categorie'}
                    className="category-image-preview"
                    src={currentImage}
                  />
                </div>
              ) : null}

              {previewImage ? (
                <div>
                  <p>Nouvelle image:</p>
                  <img alt="Preview" className="category-image-preview" src={previewImage} />
                </div>
              ) : null}

              <button className="button" disabled={isSubmitting} type="submit">
                {editingCategory ? 'Enregistrer' : 'Ajouter'}
              </button>
            </form>
          </section>

          {categories && Array.isArray(categories) && categories.length ? (
            <div className="category-list">
              {categories.map((category) => {
                const image = getCategoryImage(category)

                return (
                  <article className="category-card" key={category.id}>
                    {image ? (
                      <img alt={category.name} className="category-image" src={image} />
                    ) : (
                      <div className="category-image category-image-placeholder">
                        {category.name.charAt(0).toUpperCase()}
                      </div>
                    )}

                    <div>
                      <h3>{category.name}</h3>
                      <p>{formatDate(category.created_at)}</p>
                    </div>

                    <div className="table-actions">
                      <button
                        className="button secondary"
                        onClick={() => {
                          setEditingCategory(category)
                          setImageFile(null)
                          setName(category.name)
                          setSuccess(null)
                          window.scrollTo({ top: 0, behavior: 'smooth' })
                        }}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        className="button danger"
                        onClick={() => handleDelete(category)}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="empty-state">Aucune categorie.</div>
          )}
        </>
      ) : null}
    </section>
  )
}
