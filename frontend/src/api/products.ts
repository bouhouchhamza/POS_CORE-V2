import { api, unwrapData } from "./client";
import type { Product, ProductPayload } from "../types";

export async function getProducts() {
  const response = await api.get("/products");
  return unwrapData<Product[]>(response);
}

export async function getProduct(id: number) {
  const response = await api.get(`/products/${id}`);
  return unwrapData<Product>(response);
}

export async function createProduct(payload: ProductPayload | FormData) {
  const response = await api.post("/products", payload);
  return unwrapData<Product>(response);
}

export async function updateProduct(
  id: number,
  payload: ProductPayload | FormData,
) {
  if (payload instanceof FormData) {
    const response = await api.post(`/products/${id}?_method=PUT`, payload);
    return unwrapData<Product>(response);
  }

  const response = await api.put(`/products/${id}`, payload);
  return unwrapData<Product>(response);
}

export async function deleteProduct(id: number) {
  const response = await api.delete(`/products/${id}`);
  return response.data;
}

export async function getLowStockProducts() {
  const response = await api.get("/products-low-stock");
  return unwrapData<Product[]>(response);
}
