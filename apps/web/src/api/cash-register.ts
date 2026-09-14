import {api,unwrapData} from './client'
import type {CashRegisterSession} from '../types'
export async function getCurrentCashRegister(){return unwrapData<CashRegisterSession|null>(await api.get('/cash-register/current'))}
export async function openCashRegister(opening_cash:string,opening_note:string|null){return unwrapData<CashRegisterSession>(await api.post('/cash-register/open',{opening_cash,opening_note}))}
export async function closeCashRegister(actual_cash:string,closing_note:string|null){return unwrapData<CashRegisterSession>(await api.post('/cash-register/close',{actual_cash,closing_note}))}
export async function getCashRegisterSessions(){return unwrapData<CashRegisterSession[]>(await api.get('/cash-register/sessions'))}
