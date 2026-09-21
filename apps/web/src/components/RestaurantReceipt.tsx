import { Printer } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPublicSettings } from '../api/settings'
import type { Sale, UniversalOrder } from '../types'
import { useI18n } from '../i18n'
import { isTauriRuntime, nativePrintSale } from '../utils/nativePrint'
import {
  CorePosPrintError,
  isPrinterConfigurationError,
  printErrorDetail,
  printErrorMessage,
} from '../utils/printerErrors'

type Props = { sale: Sale; order: UniversalOrder; businessName: string; currency: string }

export default function RestaurantReceipt({ sale, order, businessName, currency }: Props) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [printing, setPrinting] = useState(false)
  const [printError, setPrintError] = useState<unknown>(null)

  async function print() {
    if (printing) return
    setPrinting(true)
    setPrintError(null)

    try {
      if (isTauriRuntime()) {
        await nativePrintSale(sale, await getPublicSettings(), 2)
        return
      }

      if (typeof window.print !== 'function') {
        throw new CorePosPrintError('PRINT_BRIDGE_UNAVAILABLE')
      }

      document.body.classList.add('restaurant-print-mode')
      const finish = () => {
        document.body.classList.remove('restaurant-print-mode')
        window.removeEventListener('afterprint', finish)
        setPrinting(false)
      }
      window.addEventListener('afterprint', finish)
      window.print()
      window.setTimeout(finish, 1200)
    } catch (error) {
      setPrintError(error)
      if (!isTauriRuntime()) setPrinting(false)
    } finally {
      if (isTauriRuntime()) setPrinting(false)
    }
  }

  return <section className="restaurant-receipt">
    <header><h3>{businessName}</h3><p>{t('restaurantReceipt.ticket',{id:sale.id,order:order.order_number})}</p>{order.table_id ? <strong>{order.table_name ?? `${t('common.table')} ${order.table_number ?? order.table_id}`}</strong> : null}<small>{new Date(sale.created_at).toLocaleString()}</small></header>
    <div>{order.items.map(item => <article key={item.id}><span><strong>{item.quantity} × {item.product_name}</strong>{item.modifiers.length ? <small>{item.modifiers.map(modifier => modifier.name).join(', ')}</small> : null}{item.notes ? <small>{item.notes}</small> : null}</span><b>{item.total.toFixed(2)}</b></article>)}</div>
    <dl><div><dt>{t('restaurantReceipt.subtotal')}</dt><dd>{order.subtotal.toFixed(2)}</dd></div><div><dt>{t('restaurantReceipt.discount')}</dt><dd>{order.discount.toFixed(2)}</dd></div><div><dt>{t('restaurantReceipt.taxes')}</dt><dd>{order.tax.toFixed(2)}</dd></div><div><dt>{t('restaurantReceipt.payment')}</dt><dd>{t(`payment.${sale.payment_method}`)}</dd></div><div><dt>{t('restaurantReceipt.total')}</dt><dd>{sale.total.toFixed(2)} {currency}</dd></div></dl>
    <p>{t('restaurantReceipt.cashier',{name:sale.user?.name??t('common.notAvailable')})}</p>
    {printError?<div className="printer-error-notice" role="alert"><strong>{printErrorMessage(printError,t)}</strong><p>{printErrorDetail(printError,t)}</p><div>{isPrinterConfigurationError(printError)?<button className="button secondary" onClick={()=>navigate('/settings?tab=receipt')}>{t('print.configure')}</button>:null}<button className="button secondary" onClick={()=>setPrintError(null)}>{t('print.close')}</button></div></div>:null}
    <button className="button" disabled={printing} onClick={() => void print()}><Printer size={17}/>{printing?t('reports.printing'):t('restaurantReceipt.print')}</button>
  </section>
}
