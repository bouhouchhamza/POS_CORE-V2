import type { LoginProfile } from "../types";

const PROFILES_STORAGE_KEY = "bimik_cafe_profiles";

export function loadProfiles(): LoginProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;

    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("[loadProfiles] Invalid profiles storage", error);
    return [];
  }
}

export function saveProfiles(profiles: LoginProfile[]): void {
  try {
    const safeProfiles = Array.isArray(profiles) ? profiles : [];
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(safeProfiles));
  } catch (error) {
    console.warn("[saveProfiles] Failed to save profiles", error);
  }
}

export function clearStoredProfiles(): void {
  localStorage.removeItem(PROFILES_STORAGE_KEY);
}
