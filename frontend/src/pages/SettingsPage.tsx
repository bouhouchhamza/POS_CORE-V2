import { useEffect, useState, type FormEvent } from 'react'
import {
  defaultSettings,
  getSettings,
  updateSettings,
  type AppSettings,
} from '../api/settings'
import {
  createUser,
  deleteUser,
  getUsers,
  updateUser,
} from '../api/users'
import ErrorMessage from '../components/ErrorMessage'
import Loading from '../components/Loading'
import type { AppUser, UserPayload } from '../types'
import { getApiErrorMessage } from '../utils/format'

type SettingKey = keyof AppSettings

type UserForm = {
  name: string
  email: string
  password: string
  role: AppUser['role']
  is_active: boolean
}

const emptyUserForm: UserForm = {
  name: '',
  email: '',
  password: '',
  role: 'worker',
  is_active: true,
}

function getUserInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

function roleLabel(role: AppUser['role']) {
  return role === 'patron' ? 'Patron' : 'Worker'
}

function toUserPayload(form: UserForm): UserPayload {
  return {
    name: form.name.trim(),
    email: form.email.trim(),
    role: form.role,
    is_active: form.is_active,
    password: form.password.trim() || null,
  }
}

function UsersSettingsSection() {
  const [users, setUsers] = useState<AppUser[]>([])
  const [form, setForm] = useState<UserForm>(emptyUserForm)
  const [editingUser, setEditingUser] = useState<AppUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function loadUsers() {
    try {
      setError(null)
      const data = await getUsers()
      setUsers(data)
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [])

  function resetUserForm() {
    setEditingUser(null)
    setForm(emptyUserForm)
  }

  function startEditUser(user: AppUser) {
    setEditingUser(user)
    setSuccess(null)
    setError(null)
    setForm({
      name: user.name,
      email: user.email,
      password: '',
      role: user.role,
      is_active: user.is_active,
    })
  }

  async function handleUserSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    setIsSaving(true)

    try {
      const payload = toUserPayload(form)

      if (editingUser) {
        await updateUser(editingUser.id, payload)
        setSuccess('Utilisateur modifié.')
      } else {
        await createUser(payload)
        setSuccess('Utilisateur ajouté.')
      }

      resetUserForm()
      await loadUsers()
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  async function toggleUser(user: AppUser) {
    setError(null)
    setSuccess(null)

    try {
      await updateUser(user.id, {
        name: user.name,
        email: user.email,
        role: user.role,
        is_active: !user.is_active,
        password: null,
      })
      setSuccess(user.is_active ? 'Utilisateur désactivé.' : 'Utilisateur activé.')
      await loadUsers()
    } catch (err) {
      setError(getApiErrorMessage(err))
    }
  }

  async function removeUser(user: AppUser) {
    if (!window.confirm(`Supprimer ${user.name} ?`)) return

    setError(null)
    setSuccess(null)

    try {
      await deleteUser(user.id)
      setSuccess('Utilisateur supprimé.')
      if (editingUser?.id === user.id) resetUserForm()
      await loadUsers()
    } catch (err) {
      setError(getApiErrorMessage(err))
    }
  }

  return (
    <section className="settings-card users-settings-card">
      <div className="settings-card-head">
        <span className="settings-icon">Ut</span>
        <div>
          <h3>Utilisateurs</h3>
          <p>Ajouter, modifier et activer les profils de connexion.</p>
        </div>
      </div>

      {isLoading ? <Loading label="Chargement des utilisateurs..." /> : null}
      <ErrorMessage message={error} />
      {success ? <div className="success-message">{success}</div> : null}

      {!isLoading ? (
        <div className="users-management-grid">
          <form className="form-grid user-form" onSubmit={handleUserSubmit}>
            <div className="panel-title user-form-title">
              <h3>{editingUser ? 'Modifier utilisateur' : 'Ajouter utilisateur'}</h3>
              {editingUser ? (
                <button
                  className="button secondary"
                  onClick={resetUserForm}
                  type="button"
                >
                  Annuler
                </button>
              ) : null}
            </div>

            <label>
              Nom
              <input
                maxLength={100}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                required
                value={form.name}
              />
            </label>

            <label>
              Email
              <input
                maxLength={255}
                onChange={(event) =>
                  setForm((current) => ({ ...current, email: event.target.value }))
                }
                required
                type="email"
                value={form.email}
              />
            </label>

            <label>
              Mot de passe
              <input
                minLength={4}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                placeholder={
                  editingUser ? 'Laisser vide pour ne pas changer' : undefined
                }
                required={!editingUser}
                type="password"
                value={form.password}
              />
            </label>

            <label>
              Rôle
              <select
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    role: event.target.value as AppUser['role'],
                  }))
                }
                value={form.role}
              >
                <option value="patron">Patron</option>
                <option value="worker">Worker</option>
              </select>
            </label>

            <label className="checkbox-label user-active-check">
              <input
                checked={form.is_active}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    is_active: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              Actif
            </label>

            <button className="button" disabled={isSaving} type="submit">
              {isSaving
                ? 'Enregistrement...'
                : editingUser
                  ? 'Modifier'
                  : 'Ajouter'}
            </button>
          </form>

          <div className="users-list">
            {users.length ? (
              users.map((user) => (
                <article className="user-row-card" key={user.id}>
                  <span className="profile-avatar user-avatar">
                    {getUserInitials(user.name)}
                  </span>
                  <div className="user-row-main">
                    <div className="user-row-head">
                      <strong>{user.name}</strong>
                      <span className={`badge ${user.is_active ? 'success' : 'muted'}`}>
                        {user.is_active ? 'Actif' : 'Inactif'}
                      </span>
                    </div>
                    <span>{user.email}</span>
                    <small>{roleLabel(user.role)}</small>
                  </div>
                  <div className="user-row-actions">
                    <button
                      className="button secondary"
                      onClick={() => startEditUser(user)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => toggleUser(user)}
                      type="button"
                    >
                      {user.is_active ? 'Désactiver' : 'Activer'}
                    </button>
                    <button
                      className="button danger"
                      onClick={() => removeUser(user)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">Aucun utilisateur disponible.</div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default function SettingsPage() {
  const [form, setForm] = useState<AppSettings>(defaultSettings)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function loadSettings() {
      try {
        setError(null)
        const settings = await getSettings()
        if (mounted) setForm(settings)
      } catch (err) {
        if (mounted) setError(getApiErrorMessage(err))
      } finally {
        if (mounted) setIsLoading(false)
      }
    }

    loadSettings()

    return () => {
      mounted = false
    }
  }, [])

  function updateField<K extends SettingKey>(key: K, value: AppSettings[K]) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    setIsSaving(true)

    try {
      const settings = await updateSettings(form)
      setForm(settings)
      setSuccess('Paramètres enregistrés.')
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>Paramètres</h2>
          <p>Gérer les paramètres du café, WiFi et ticket.</p>
        </div>
      </div>

      {isLoading ? <Loading label="Chargement des paramètres..." /> : null}
      <ErrorMessage message={error} />
      {success ? <div className="success-message">{success}</div> : null}

      {!isLoading ? (
        <>
          <form className="settings-form" onSubmit={handleSubmit}>
          <section className="settings-card">
            <div className="settings-card-head">
              <span className="settings-icon">BC</span>
              <div>
                <h3>Paramètres Café</h3>
                <p>Informations affichées dans l'application et sur le ticket.</p>
              </div>
            </div>

            <div className="form-grid settings-grid">
              <label>
                Nom du café
                <input
                  required
                  maxLength={100}
                  value={form.cafe_name}
                  onChange={(event) => updateField('cafe_name', event.target.value)}
                />
              </label>

              <label>
                Sous-titre
                <input
                  maxLength={150}
                  value={form.cafe_subtitle}
                  onChange={(event) => updateField('cafe_subtitle', event.target.value)}
                />
              </label>

              <label className="wide">
                Adresse
                <input
                  maxLength={200}
                  value={form.cafe_address}
                  onChange={(event) => updateField('cafe_address', event.target.value)}
                />
              </label>

              <label>
                Téléphone
                <input
                  maxLength={50}
                  value={form.cafe_phone}
                  onChange={(event) => updateField('cafe_phone', event.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <span className="settings-icon">Wi</span>
              <div>
                <h3>Paramètres WiFi</h3>
                <p>Nom et code WiFi à afficher sur les tickets.</p>
              </div>
            </div>

            <div className="form-grid settings-grid">
              <label>
                Nom WiFi
                <input
                  maxLength={100}
                  value={form.wifi_name}
                  onChange={(event) => updateField('wifi_name', event.target.value)}
                />
              </label>

              <label>
                Code WiFi
                <input
                  maxLength={100}
                  value={form.wifi_code}
                  onChange={(event) => updateField('wifi_code', event.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <span className="settings-icon">Tk</span>
              <div>
                <h3>Paramètres Ticket</h3>
                <p>Texte et informations visibles sur la facture imprimée.</p>
              </div>
            </div>

            <div className="form-grid settings-grid">
              <label>
                En-tête ticket
                <input
                  maxLength={150}
                  value={form.ticket_header}
                  onChange={(event) => updateField('ticket_header', event.target.value)}
                />
              </label>

              <label>
                Message footer
                <input
                  maxLength={250}
                  value={form.ticket_footer}
                  onChange={(event) => updateField('ticket_footer', event.target.value)}
                />
              </label>

              <label className="wide">
                Note supplémentaire
                <textarea
                  maxLength={250}
                  value={form.ticket_note}
                  onChange={(event) => updateField('ticket_note', event.target.value)}
                />
              </label>

              <label className="switch-row">
                <span>
                  Afficher WiFi
                  <small>Inclure nom/code WiFi sur ticket</small>
                </span>
                <input
                  checked={form.show_wifi_on_ticket}
                  type="checkbox"
                  onChange={(event) =>
                    updateField('show_wifi_on_ticket', event.target.checked)
                  }
                />
              </label>

              <label className="switch-row">
                <span>
                  Afficher téléphone
                  <small>Visible seulement si un numéro existe</small>
                </span>
                <input
                  checked={form.show_phone_on_ticket}
                  type="checkbox"
                  onChange={(event) =>
                    updateField('show_phone_on_ticket', event.target.checked)
                  }
                />
              </label>

              <label className="switch-row">
                <span>
                  Afficher adresse
                  <small>Adresse du café sur le ticket</small>
                </span>
                <input
                  checked={form.show_address_on_ticket}
                  type="checkbox"
                  onChange={(event) =>
                    updateField('show_address_on_ticket', event.target.checked)
                  }
                />
              </label>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <span className="settings-icon">Pr</span>
              <div>
                <h3>Paramètres Impression</h3>
                <p>Largeur thermique et comportement après validation.</p>
              </div>
            </div>

            <div className="form-grid settings-grid">
              <label className="wide">
                Nom imprimante thermique
                <input
                  maxLength={150}
                  placeholder="POS-80, XP-80C, Thermal Printer"
                  value={form.thermal_printer_name}
                  onChange={(event) =>
                    updateField('thermal_printer_name', event.target.value)
                  }
                />
                <small className="field-helper">
                  Nom exact de l’imprimante dans Windows.
                </small>
              </label>

              <label className="switch-row">
                <span>
                  Impression directe
                  <small>Imprime directement via Laravel, sans fenêtre Chrome.</small>
                </span>
                <input
                  checked={form.direct_print_enabled}
                  type="checkbox"
                  onChange={(event) =>
                    updateField('direct_print_enabled', event.target.checked)
                  }
                />
              </label>

              <label className="switch-row">
                <span>
                  Utiliser impression navigateur si échec
                  <small>
                    Si l’imprimante directe échoue, ouvrir la fenêtre d’impression
                    navigateur. Laisser désactivé pour ne jamais afficher de dialogue.
                  </small>
                </span>
                <input
                  checked={form.fallback_browser_print}
                  type="checkbox"
                  onChange={(event) =>
                    updateField('fallback_browser_print', event.target.checked)
                  }
                />
              </label>

              <label>
                Largeur ticket mm
                <select
                  value={form.ticket_width}
                  onChange={(event) =>
                    updateField('ticket_width', Number(event.target.value) as 58 | 80)
                  }
                >
                  <option value={80}>80 mm</option>
                  <option value={58}>58 mm</option>
                </select>
              </label>

              <label className="switch-row">
                <span>
                  Imprimer automatiquement après commande
                  <small>La validation imprime la facture sans action extra.</small>
                </span>
                <input
                  checked={form.auto_print_after_order}
                  type="checkbox"
                  onChange={(event) =>
                    updateField('auto_print_after_order', event.target.checked)
                  }
                />
              </label>

              <label className="switch-row">
                <span>
                  Ouvrir ticket après commande
                  <small>Garde la facture visible après validation.</small>
                </span>
                <input
                  checked={form.open_ticket_after_order}
                  type="checkbox"
                  onChange={(event) =>
                    updateField('open_ticket_after_order', event.target.checked)
                  }
                />
              </label>
            </div>
          </section>

          <div className="settings-actions">
            <button className="button" disabled={isSaving} type="submit">
              {isSaving ? 'Enregistrement...' : 'Enregistrer les paramètres'}
            </button>
          </div>
          </form>

          <UsersSettingsSection />
        </>
      ) : null}
    </section>
  )
}
