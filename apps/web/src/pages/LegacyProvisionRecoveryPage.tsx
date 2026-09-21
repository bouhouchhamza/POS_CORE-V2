import { Navigate, useSearchParams } from 'react-router-dom'
import ProvisionPage from './ProvisionPage'

// `/provision` exists solely for an explicitly enabled legacy recovery. New
// Vendor-created businesses are provisioned server-side and customers never
// receive a provisioning credential or a link to this page.
export default function LegacyProvisionRecoveryPage() {
  const [search] = useSearchParams()
  const enabled = import.meta.env.VITE_ENABLE_LEGACY_PROVISIONING_RECOVERY === 'true'

  if (!enabled || search.get('legacy-recovery') !== '1') {
    return <Navigate to="/activation" replace />
  }

  return <ProvisionPage />
}
