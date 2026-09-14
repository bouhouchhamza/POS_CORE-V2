import { Printer } from 'lucide-react'
import { printSaleTicket } from '../api/sales'
import type { Sale, UniversalOrder } from '../types'
import { useI18n } from '../i18n'

type Props = { sale: Sale; order: UniversalOrder; businessName: string; currency: string }

export default function RestaurantReceipt({ sale, order, businessName, currency }: Props) {
  const { t } = useI18n()
  return <section className="restaurant-receipt">
    <header><h3>{businessName}</h3><p>{t('restaurantReceipt.ticket',{id:sale.id,order:order.order_number})}</p>{order.table_id ? <strong>{order.table_name ?? `${t('common.table')} ${order.table_number ?? order.table_id}`}</strong> : null}<small>{new Date(sale.created_at).toLocaleString()}</small></header>
    <div>{order.items.map(item => <article key={item.id}><span><strong>{item.quantity} × {item.product_name}</strong>{item.modifiers.length ? <small>{item.modifiers.map(modifier => modifier.name).join(', ')}</small> : null}{item.notes ? <small>{item.notes}</small> : null}</span><b>{item.total.toFixed(2)}</b></article>)}</div>
    <dl><div><dt>{t('restaurantReceipt.subtotal')}</dt><dd>{order.subtotal.toFixed(2)}</dd></div><div><dt>{t('restaurantReceipt.discount')}</dt><dd>{order.discount.toFixed(2)}</dd></div><div><dt>{t('restaurantReceipt.taxes')}</dt><dd>{order.tax.toFixed(2)}</dd></div><div><dt>{t('restaurantReceipt.payment')}</dt><dd>{t(`payment.${sale.payment_method}`)}</dd></div><div><dt>{t('restaurantReceipt.total')}</dt><dd>{sale.total.toFixed(2)} {currency}</dd></div></dl>
    <p>{t('restaurantReceipt.cashier',{name:sale.user?.name??t('common.notAvailable')})}</p>
    <button className="button" onClick={() => void printSaleTicket(sale.id, 2)}><Printer size={17}/>{t('restaurantReceipt.print')}</button>
  </section>
}
