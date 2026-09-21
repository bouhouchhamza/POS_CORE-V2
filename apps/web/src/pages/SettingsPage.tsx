import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
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
import { getAvailableRoles,getRoleLabel,normalizeRole } from '../auth/roles'
import {useAuth}from'../auth/useAuth'
import { useI18n } from '../i18n'
import { isTauriRuntime, resolveNativePrinter, type NativePrinter } from '../utils/nativePrint'
import { printErrorMessage } from '../utils/printerErrors'
import CoreV2BusinessSettings from '../components/CoreV2BusinessSettings'

type SettingKey = keyof AppSettings

type SettingsTab = 'commerce' | 'receipt' | 'users'

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
  role: 'cashier',
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

function updateFormRole(value: string, current: UserForm): UserForm {
  const role = normalizeRole(value)
  return role ? { ...current, role } : current
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
  const { t, language } = useI18n()
  const {user:currentUser}=useAuth()
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
        setSuccess(t('settings.userUpdated'))
      } else {
        await createUser(payload)
        setSuccess(t('settings.userCreated'))
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
        role: user.role,
        is_active: !user.is_active,
        password: null,
      })
      setSuccess(t(user.is_active?'settings.userDisabled':'settings.userEnabled'))
      await loadUsers()
    } catch (err) {
      setError(getApiErrorMessage(err))
    }
  }

  async function removeUser(user: AppUser) {
    if (!window.confirm(t('settings.confirmDeleteUser',{name:user.name}))) return

    setError(null)
    setSuccess(null)

    try {
      await deleteUser(user.id)
      setSuccess(t('settings.userDeleted'))
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
          <h3>{t('settings.users')}</h3>
          <p>{t('settings.usersHelp')}</p>
        </div>
      </div>

      {isLoading ? <Loading label={t('settings.loadingUsers')} /> : null}
      <ErrorMessage message={error} />
      {success ? <div className="success-message">{success}</div> : null}

      {!isLoading ? (
        <div className="users-management-grid">
          <form className="form-grid user-form" onSubmit={handleUserSubmit}>
            <div className="panel-title user-form-title">
              <h3>{t(editingUser?'settings.editUser':'settings.addUser')}</h3>
              {editingUser ? (
                <button
                  className="button secondary"
                  onClick={resetUserForm}
                  type="button"
                >
                  {t('common.cancel')}
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
                autoComplete="username"
                value={form.email}
              />
            </label>

            <label>
              {t('settings.password')}
              <input
                minLength={1}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                placeholder={
                  editingUser ? t('settings.passwordOptional') : undefined
                }
                required={!editingUser}
                type="password"
                autoComplete="new-password"
                value={form.password}
              />
            </label>

            <label>
              {t('settings.role')}
              <select
                onChange={(event) =>
                  setForm((current) => updateFormRole(event.target.value, current))
                }
                value={form.role}
              >
                {Array.from(new Set([form.role,...getAvailableRoles(currentUser?.business?.business_type??'custom')])).map(role=><option key={role} value={role}>{getRoleLabel(role,language)}</option>)}
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
                ? t('settings.saving')
                : editingUser
                  ? t('common.edit')
                  : t('common.add')}
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
                    <small>{getRoleLabel(user.role,language)}</small>
                  </div>
                  <div className="user-row-actions">
                    <button
                      className="button secondary"
                      onClick={() => startEditUser(user)}
                      type="button"
                    >
                      Modifier
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => toggleUser(user)}
                      type="button"
                    >
                      {t(user.is_active?'settings.disableUser':'settings.enableUser')}
                    </button>
                    <button
                      className="button danger"
                      onClick={() => removeUser(user)}
                      type="button"
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">{t('settings.noUsers')}</div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default function SettingsPage() {
  const [searchParams] = useSearchParams()
  const { t } = useI18n()
  const [form, setForm] = useState<AppSettings>(defaultSettings)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [detectedPrinter, setDetectedPrinter] = useState<NativePrinter | null>(null)
  const [isDetectingPrinter, setIsDetectingPrinter] = useState(false)
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => searchParams.get('tab') === 'receipt' ? 'receipt' : 'commerce')

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

  async function detectPrinter() {
    if (!isTauriRuntime()) {
      setError(t('settings.printerDesktopOnly'))
      return
    }
    setIsDetectingPrinter(true)
    setError(null)
    try {
      const printer = await resolveNativePrinter(form.thermal_printer_name)
      setDetectedPrinter(printer)
      updateField('thermal_printer_name', printer.name)
    } catch (err) {
      setDetectedPrinter(null)
      setError(printErrorMessage(err, t))
    } finally {
      setIsDetectingPrinter(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    setIsSaving(true)

    try {
      const settings = await updateSettings(form)
      setForm(settings)
      setSuccess(t('settings.saved'))
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
          <h2>{t('settings.title')}</h2>
          <p>{t('settings.subtitle')}</p>
        </div>
      </div>

      {isLoading ? <Loading label={t('settings.loadingSettings')} /> : null}
      <ErrorMessage message={error} />
      {success ? <div className="success-message">{success}</div> : null}

      {!isLoading ? (
        <>
          <nav className="settings-tabs" aria-label={t('settings.sections')}>
            <button
              className={activeTab === 'commerce' ? 'active' : ''}
              onClick={() => setActiveTab('commerce')}
              type="button"
            >
              {t('settings.tabCommerce')}
            </button>
            <button
              className={activeTab === 'receipt' ? 'active' : ''}
              onClick={() => setActiveTab('receipt')}
              type="button"
            >
              {t('settings.tabReceipt')}
            </button>
            <button
              className={activeTab === 'users' ? 'active' : ''}
              onClick={() => setActiveTab('users')}
              type="button"
            >
              {t('settings.tabUsers')}
            </button>
          </nav>

          {activeTab === 'commerce' ? (
            <div className="settings-tab-panel">
              <CoreV2BusinessSettings />
              <form className="settings-form" onSubmit={handleSubmit}>
              <section className="settings-card">
                <div className="settings-card-head">
                  <span className="settings-icon">CP</span>
                  <div>
                    <h3>{t('settings.cafe')}</h3>
                    <p>{t('settings.cafeHelp')}</p>
                  </div>
                </div>

                <div className="form-grid settings-grid">
                  <label>
                    {t('settings.businessName')}
                    <input
                      required
                      maxLength={100}
                      value={form.cafe_name}
                      onChange={(event) => updateField('cafe_name', event.target.value)}
                    />
                  </label>

                  <label>
                    {t('settings.subtitleField')}
                    <input
                      maxLength={150}
                      value={form.cafe_subtitle}
                      onChange={(event) => updateField('cafe_subtitle', event.target.value)}
                    />
                  </label>

                  <label className="wide">
                    {t('settings.addressField')}
                    <input
                      maxLength={200}
                      value={form.cafe_address}
                      onChange={(event) => updateField('cafe_address', event.target.value)}
                    />
                  </label>

                  <label>
                    {t('settings.phoneField')}
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
                    <h3>{t('settings.wifi')}</h3>
                    <p>{t('settings.wifiHelp')}</p>
                  </div>
                </div>

                <div className="form-grid settings-grid">
                  <label>
                    {t('settings.wifiName')}
                    <input
                      maxLength={100}
                      value={form.wifi_name}
                      onChange={(event) => updateField('wifi_name', event.target.value)}
                    />
                  </label>

                  <label>
                    {t('settings.wifiCode')}
                    <input
                      maxLength={100}
                      value={form.wifi_code}
                      onChange={(event) => updateField('wifi_code', event.target.value)}
                    />
                  </label>
                </div>
              </section>

              <div className="settings-actions">
                <button className="button" disabled={isSaving} type="submit">
                  {t(isSaving?'settings.saving':'settings.saveSettings')}
                </button>
              </div>
              </form>
            </div>
          ) : null}

          {activeTab === 'receipt' ? (
            <div className="settings-tab-panel">
              <form className="settings-form" onSubmit={handleSubmit}>
              <section className="settings-card">
                <div className="settings-card-head">
                  <span className="settings-icon">Tk</span>
                  <div>
                    <h3>{t('settings.ticket')}</h3>
                    <p>{t('settings.ticketHelp')}</p>
                  </div>
                </div>

                <div className="form-grid settings-grid">
                  <label>
                    {t('settings.ticketHeader')}
                    <input
                      maxLength={150}
                      value={form.ticket_header}
                      onChange={(event) => updateField('ticket_header', event.target.value)}
                    />
                  </label>

                  <label>
                    {t('settings.footerMessage')}
                    <input
                      maxLength={250}
                      value={form.ticket_footer}
                      onChange={(event) => updateField('ticket_footer', event.target.value)}
                    />
                  </label>

                  <label className="wide">
                    {t('settings.extraNote')}
                    <textarea
                      maxLength={250}
                      value={form.ticket_note}
                      onChange={(event) => updateField('ticket_note', event.target.value)}
                    />
                  </label>

                  <label className="switch-row">
                    <span>
                      {t('settings.showWifi')}
                      <small>{t('settings.includeWifi')}</small>
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
                      {t('settings.showPhone')}
                      <small>{t('settings.phoneHelp')}</small>
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
                      {t('settings.showAddress')}
                      <small>{t('settings.addressHelp')}</small>
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
                    <h3>{t('settings.printing')}</h3>
                    <p>{t('settings.printingHelp')}</p>
                  </div>
                </div>

                <div className="form-grid settings-grid">
                  <label className="wide">
                    {t('settings.printerName')}
                    <input
                      maxLength={150}
                      placeholder="POS-80, XP-80C, Thermal Printer"
                      value={form.thermal_printer_name}
                      onChange={(event) =>
                        updateField('thermal_printer_name', event.target.value)
                      }
                    />
                    <small className="field-helper">
                      {detectedPrinter
                        ? t('settings.printerDetected', { name: detectedPrinter.name, port: detectedPrinter.port })
                        : t('settings.printerAutoHelp')}
                    </small>
                  </label>

                  <button
                    className="button secondary"
                    disabled={isDetectingPrinter}
                    onClick={() => void detectPrinter()}
                    type="button"
                  >
                    {isDetectingPrinter ? t('settings.printerDetecting') : t('settings.printerDetect')}
                  </button>

                  <label className="switch-row">
                    <span>
                      {t('settings.directPrint')}
                      <small>{t('settings.nativePrintHelp')}</small>
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
                      {t('settings.browserFallback')}
                      <small>
                        {t('settings.browserFallbackHelp')}
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
                    {t('settings.ticketWidth')}
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
                      {t('settings.autoPrint')}
                      <small>{t('settings.autoPrintHelp')}</small>
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
                      {t('settings.openReceipt')}
                      <small>{t('settings.keepReceiptHelp')}</small>
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
                  {t(isSaving?'settings.saving':'settings.saveSettings')}
                </button>
              </div>
              </form>
            </div>
          ) : null}

          {activeTab === 'users' ? (
            <div className="settings-tab-panel">
              <UsersSettingsSection />
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
