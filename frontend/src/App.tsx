import { Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth/useAuth";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import CaissePage from "./pages/CaissePage";
import CategoriesPage from "./pages/CategoriesPage";
import CommandesPage from "./pages/CommandesPage";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import ProductsPage from "./pages/ProductsPage";
import RapportPage from "./pages/RapportPage";
import SettingsPage from "./pages/SettingsPage";
import StockPage from "./pages/StockPage";
import "./App.css";

function DefaultRedirect() {
  const { defaultPath } = useAuth();

  return <Navigate to={defaultPath} replace />;
}

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<DefaultRedirect />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/categories" element={<CategoriesPage />} />

          <Route path="/sales" element={<CaissePage />} />
          <Route path="/caisse" element={<Navigate to="/sales" replace />} />

          <Route path="/commandes" element={<CommandesPage />} />
          <Route path="/stock" element={<StockPage />} />
          <Route path="/settings" element={<SettingsPage />} />

          <Route
            path="/rapport"
            element={
              user?.role === "patron" ? (
                <RapportPage />
              ) : (
                <Navigate to="/commandes" replace />
              )
            }
          />

          <Route path="*" element={<DefaultRedirect />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
