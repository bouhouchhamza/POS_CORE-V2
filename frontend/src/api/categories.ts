import client, { unwrapData } from './client'
import type { Category, CategoryPayload } from '../types'

export async function getCategories() {
  const response = await client.get<{ data: Category[] }>('/categories')
  return unwrapData<Category[]>(response)
}

export async function getCategory(id: number) {
  const response = await client.get<{ data: Category }>(`/categories/${id}`)
  return unwrapData<Category>(response)
}

export async function createCategory(payload: CategoryPayload | FormData) {
  const response = await client.post<{ data: Category }>('/categories', payload)
  return unwrapData<Category>(response)
}

export async function updateCategory(id: number, payload: CategoryPayload | FormData) {
  if (payload instanceof FormData) {
    const response = await client.post<{ data: Category }>(
      `/categories/${id}?_method=PUT`,
      payload,
    )
    return unwrapData<Category>(response)
  }

  const response = await client.put<{ data: Category }>(
    `/categories/${id}`,
    payload,
  )
  return unwrapData<Category>(response)
}

export async function deleteCategory(id: number) {
  await client.delete(`/categories/${id}`)
}
