import { useEffect, useState } from 'react'
import { getSales, returnSale } from '../api/sales'
import {
  defaultSettings,
  getPublicSettings,
  type AppSettings,
} from '../api/settings'
import ErrorMessage from '../components/ErrorMessage'
import Loading from '../components/Loading'
import Receipt from '../components/Receipt'
import type { Sale } from '../types'
import { formatCurrency, formatDate, getApiErrorMessage } from '../utils/format'
import { isTauriRuntime, nativePrintSale } from '../utils/nativePrint'
import { CorePosPrintError, printErrorMessage } from '../utils/printerErrors'
import { useI18n } from '../i18n'

export default function SalesPage() {
  const { t } = useI18n()
  const [sales, setSales] = useState<Sale[]>([])
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [printingSaleId, setPrintingSaleId] = useState<number | null>(null)
  const [returning,setReturning]=useState(false)
  const [returnReason,setReturnReason]=useState('')
  const [returnQuantities,setReturnQuantities]=useState<Record<number,number>>({})

  async function loadSales() {
    try {
      setError(null)
      const [salesData, settingsData] = await Promise.all([
        getSales(),
        getPublicSettings().catch(() => defaultSettings),
      ])
      setSales(salesData)
      setSettings(settingsData)
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadSales()
  }, [])

  function printTicket(onError: (error: unknown) => void, onFinished: () => void) {
    let finished = false
    const ticketWidth = settings.ticket_width === 58 ? '58mm' : '80mm'

    document.body.classList.add('ticket-print-mode')
    document.body.style.setProperty('--ticket-page-width', ticketWidth)

    const finish = () => {
      if (finished) return
      finished = true
      window.removeEventListener('afterprint', finish)
      document.body.classList.remove('ticket-print-mode')
      document.body.style.removeProperty('--ticket-page-width')
    }

    window.addEventListener('afterprint', finish)
    window.setTimeout(() => {
      try {
        if (typeof window.print !== 'function') throw new CorePosPrintError('PRINT_BRIDGE_UNAVAILABLE')
        window.print()
        window.setTimeout(() => { finish(); onFinished() }, 1200)
      } catch (error) {
        onError(error)
        finish()
        onFinished()
      }
    }, 100)
  }

  async function printSale(sale: Sale) {
    if (printingSaleId !== null) return
    setSelectedSale(sale)
    if (isTauriRuntime()) {
      try {
        setPrintingSaleId(sale.id)
        setError(null)
        await nativePrintSale(sale, settings, 2)
      } catch (err) {
        setError(printErrorMessage(err, t))
      } finally {
        setPrintingSaleId(null)
      }
      return
    }
    setPrintingSaleId(sale.id)
    setError(null)
    printTicket(
      (error) => setError(printErrorMessage(error, t)),
      () => setPrintingSaleId(null),
    )
  }

  async function submitReturn(){
    if(!selectedSale)return
    const items=(selectedSale.items??[]).map(item=>({sale_item_id:item.id,quantity:Number(returnQuantities[item.id]??0)})).filter(item=>item.quantity>0)
    if(!items.length||returnReason.trim().length<2){setError(t('sales.selectionRequired'));return}
    try{await returnSale(selectedSale.id,{reason:returnReason.trim(),refund_method:'original',items});setReturning(false);setSelectedSale(null);setReturnReason('');setReturnQuantities({});await loadSales()}catch(err){setError(getApiErrorMessage(err))}
  }

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>{t('sales.title')}</h2>
          <p>{t('sales.subtitle')}</p>
        </div>
      </div>

      {isLoading ? <Loading label={t('sales.loading')} /> : null}
      <ErrorMessage message={error} />

      {!isLoading && !error ? (
        sales.length ? (
          <div className="table-wrap panel">
            <table>
              <thead>
                <tr>
                  <th>{t('sales.sale')}</th>
                  <th>{t('common.user')}</th>
                  <th>{t('orders.total')}</th>
                  <th>{t('common.profit')}</th>
                  <th>{t('sales.payment')}</th>
                  <th>{t('stock.date')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id}>
                    <td>#{sale.id}</td>
                    <td>{sale.user?.name ?? 'N/A'}</td>
                    <td>{formatCurrency(sale.total)}</td>
                    <td>{formatCurrency(sale.profit)}</td>
                    <td>{sale.payment_method}</td>
                    <td>{formatDate(sale.created_at)}</td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="button secondary"
                          onClick={() => setSelectedSale(sale)}
                          type="button"
                        >
                          {t('common.details')}
                        </button>
                        <button className="button secondary" onClick={()=>{setSelectedSale(sale);setReturning(true)}} type="button">{t('sales.return')}</button>
                        <button
                          className="button"
                          disabled={printingSaleId !== null}
                          onClick={() => void printSale(sale)}
                          type="button"
                        >
                          {printingSaleId === sale.id ? t('reports.printing') : t('common.print')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">{t('sales.empty')}</div>
        )
      ) : null}

      {selectedSale ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal large-modal">
            <div className="panel-title">
              <h3>{t('sales.detailTitle', { id: selectedSale.id })}</h3>
              <button
                className="button secondary"
                onClick={() => setSelectedSale(null)}
                type="button"
              >
                {t('common.close')}
              </button>
            </div>

            <div className="sale-detail-grid">
              <span>{t('orders.total')}: {formatCurrency(selectedSale.total)}</span>
              <span>{t('common.profit')}: {formatCurrency(selectedSale.profit)}</span>
              <span>{t('sales.payment')}: {t(`payment.${selectedSale.payment_method}`)}</span>
              <span>{t('stock.date')}: {formatDate(selectedSale.created_at)}</span>
              <span>{t('sales.worker')}: {selectedSale.user?.name ?? t('common.notAvailable')}</span>
              <span>{t('stock.note')}: {selectedSale.note ?? '-'}</span>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('common.product')}</th>
                    <th>{t('common.quantity')}</th>
                    <th>{t('common.unit')}</th>
                    <th>{t('orders.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSale.items?.map((item) => (
                    <tr key={item.id}>
                      <td>{item.product?.name ?? `${t('common.product')} #${item.product_id}`}</td>
                      <td>{item.quantity}</td>
                      <td>{formatCurrency(item.unit_price)}</td>
                      <td>{formatCurrency(item.total)}</td>
                      {returning?<td><input aria-label={t('sales.returnQuantity',{product:item.product?.name??item.product_id})} max={item.quantity} min="0" onChange={event=>setReturnQuantities(current=>({...current,[item.id]:Number(event.target.value)}))} step="0.001" type="number" value={returnQuantities[item.id]??0}/></td>:null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {returning?<div className="panel"><h4>{t('sales.returnTitle')}</h4><label>{t('common.reason')}<textarea onChange={event=>setReturnReason(event.target.value)} value={returnReason}/></label><p>{t('sales.returnHelp')}</p><button className="button" onClick={()=>void submitReturn()} type="button">{t('sales.confirmReturn')}</button></div>:null}

            <Receipt sale={selectedSale} settings={settings} />

            <div className="modal-actions">
              <button className="button" disabled={printingSaleId !== null} onClick={() => void printSale(selectedSale)} type="button">
                {t('common.print')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
