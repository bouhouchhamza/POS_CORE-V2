import client, { unwrapData } from './client'
import type {
  Product,
  StockCorrectionPayload,
  StockMovement,
  StockQuantityPayload,
} from '../types'

type StockChangeResponse = {
  message: string
  product: Product
  movement: StockMovement
}

export async function getStockMovements() {
  const response = await client.get<{ data: StockMovement[] }>('/stock-movements')
  return unwrapData<StockMovement[]>(response)
}

export async function getProductStockMovements(productId: number) {
  const response = await client.get<{ data: StockMovement[] }>(
    `/products/${productId}/stock-movements`,
  )
  return unwrapData<StockMovement[]>(response)
}

export async function increaseStock(
  productId: number,
  payload: StockQuantityPayload,
) {
  const response = await client.post<StockChangeResponse>(
    `/products/${productId}/stock/increase`,
    payload,
  )
  return unwrapData<StockChangeResponse>(response)
}

export async function decreaseStock(
  productId: number,
  payload: StockQuantityPayload,
) {
  const response = await client.post<StockChangeResponse>(
    `/products/${productId}/stock/decrease`,
    payload,
  )
  return unwrapData<StockChangeResponse>(response)
}

export async function correctStock(
  productId: number,
  payload: StockCorrectionPayload,
) {
  const response = await client.post<StockChangeResponse>(
    `/products/${productId}/stock/correction`,
    payload,
  )
  return unwrapData<StockChangeResponse>(response)
}
