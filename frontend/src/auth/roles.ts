import type { User } from "../types";

export type AppRole = "patron" | "worker";

export type NavItem = {
  to: string;
  label: string;
};

const patronNav: NavItem[] = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/products", label: "Products" },
  { to: "/categories", label: "Categories" },
  { to: "/sales", label: "Sales" },
  { to: "/stock", label: "Stock" },
  { to: "/rapport", label: "Rapport" },
  { to: "/commandes", label: "Commandes" },
  { to: "/settings", label: "Paramètres" },
];

const workerNav: NavItem[] = [
  { to: "/commandes", label: "Commandes" },
];

const patronPaths = [
  "/dashboard",
  "/products",
  "/categories",
  "/sales",
  "/stock",
  "/rapport",
  "/commandes",
  "/settings",
];

const workerPaths = ["/commandes"];

export function normalizeRole(
  role: User["role"] | null | undefined,
): AppRole | null {
  if (role === "patron" || role === "worker") {
    return role;
  }

  return null;
}

export function getDefaultPath(role: User["role"] | null | undefined) {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === "worker") return "/commandes";
  if (normalizedRole === "patron") return "/dashboard";

  return "/login";
}

export function getNavItems(role: User["role"] | null | undefined): NavItem[] {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === "worker") return workerNav;
  if (normalizedRole === "patron") return patronNav;

  return [];
}

export function canAccessPath(
  role: User["role"] | null | undefined,
  pathname: string,
) {
  const normalizedRole = normalizeRole(role);
  const path = pathname === "/" ? getDefaultPath(normalizedRole) : pathname;

  if (normalizedRole === "patron") {
    return patronPaths.includes(path);
  }

  if (normalizedRole === "worker") {
    return workerPaths.includes(path);
  }

  return false;
}
