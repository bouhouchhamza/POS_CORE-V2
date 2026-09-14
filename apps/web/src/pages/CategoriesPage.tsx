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
import { resolveAssetUrl } from '../api/client'
import { useI18n } from '../i18n'
import { formatDate, getApiErrorMessage } from '../utils/format'

const maxImageSize = 5 * 1024 * 1024

function getCategoryImage(category: Category) {
  return resolveAssetUrl(category.image_url || category.image)
}

export default function CategoriesPage() {
  const { t } = useI18n()
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
      setError(t('categories.imageTooLarge'))
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
        setSuccess(t('categories.updated'))
      } else {
        await createCategory(buildPayload())
        setSuccess(t('categories.created'))
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
    if (!window.confirm(t('categories.confirmDelete',{name:category.name}))) return

    try {
      setError(null)
      await deleteCategory(category.id)
      setSuccess(t('categories.deleted'))
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
          <h2>{t('categories.title')}</h2>
          <p>{t('categories.subtitle')}</p>
        </div>
      </div>

      {isLoading ? <Loading label={t('categories.loading')} /> : null}
      <ErrorMessage message={error} />
      {success ? <div className="success-message">{success}</div> : null}

      {!isLoading ? (
        <>
          <section className="panel form-panel compact-form">
            <div className="panel-title">
              <h3>{t(editingCategory?'categories.edit':'categories.add')}</h3>
              {editingCategory ? (
                <button className="button secondary" onClick={resetForm} type="button">
                  {t('common.cancel')}
                </button>
              ) : null}
            </div>

            <form className="form-grid category-form" onSubmit={handleSubmit}>
              <label>
                {t('categories.name')}
                <input
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>

              <label>
                {t('categories.image')}
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
                  <p>{t('categories.currentImage')}</p>
                  <img
                    alt={editingCategory?.name ?? t('categories.categoryAlt')}
                    className="category-image-preview"
                    src={currentImage}
                  />
                </div>
              ) : null}

              {previewImage ? (
                <div>
                  <p>{t('categories.newImage')}</p>
                  <img alt={t('categories.preview')} className="category-image-preview" src={previewImage} />
                </div>
              ) : null}

              <button className="button" disabled={isSubmitting} type="submit">
                {t(editingCategory?'common.save':'common.add')}
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
                        {t('common.edit')}
                      </button>
                      <button
                        className="button danger"
                        onClick={() => handleDelete(category)}
                        type="button"
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="empty-state">{t('categories.empty')}</div>
          )}
        </>
      ) : null}
    </section>
  )
}
