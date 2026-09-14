import { api, unwrapData } from './client'
import type { ExtractedMenu, MenuImportResult } from '../types'
import { createMenuPdfFormData } from '../menu-upload'

export async function previewMenu(file: File) {
  return unwrapData<ExtractedMenu>(await api.post('/menu-import/preview', createMenuPdfFormData(file)))
}

export async function confirmMenu(menu: ExtractedMenu) {
  return unwrapData<MenuImportResult>(await api.post('/menu-import/confirm', { session_id: menu.session_id, categories: menu.categories }))
}
