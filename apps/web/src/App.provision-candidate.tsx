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
import MenuImportPage from "./pages/MenuImportPage";
import UniversalOrdersPage from './pages/UniversalOrdersPage';
import TablesPage from './pages/TablesPage';
import KitchenPage from './pages/KitchenPage';
import SuppliersPage from './pages/SuppliersPage';
import PurchasesPage from './pages/PurchasesPage';
import PublicMenuPage from './pages/PublicMenuPage';
import SetupPage from './pages/SetupPage';
import SetupGate from './components/SetupGate';
import CustomersPage from './pages/CustomersPage';
import LicensePage from './pages/LicensePage';
import VendorAdminPage from './pages/VendorAdminPage';
import ProvisionPage from './pages/ProvisionPage.provision-candidate';
import "./App.css";

function DefaultRedirect() {
  const { defaultPath } = useAuth();

  return <Navigate to={defaultPath} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/vendor/*" element={<VendorAdminPage />} />
      <Route path="/provision" element={<ProvisionPage />} />
      <Route element={<SetupGate />}>
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/menu/:slug/table/:token" element={<PublicMenuPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<DefaultRedirect />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/categories" element={<CategoriesPage />} />

          <Route path="/sales" element={<CaissePage />} />
          <Route path="/caisse" element={<Navigate to="/sales" replace />} />

          <Route path="/commandes" element={<CommandesPage />} />
          <Route path="/orders" element={<UniversalOrdersPage />} />
          <Route path="/tables" element={<TablesPage />} />
          <Route path="/kitchen" element={<KitchenPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/purchases" element={<PurchasesPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/stock" element={<StockPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/activation" element={<LicensePage />} />
          <Route path="/menu-import" element={<MenuImportPage />} />
          <Route path="/rapport" element={<RapportPage />} />

          <Route path="*" element={<DefaultRedirect />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
      </Route>
    </Routes>
  );
}
