import { BookOpen, Coffee, Package, ShoppingBasket, Store, UtensilsCrossed } from 'lucide-react'
import type { BusinessType, FeatureKey } from '../types'

export const businessTypes:{id:BusinessType;title:string;description:string;icon:typeof Store}[]=[
  {id:'cafe',title:'Café',description:'Tables, QR Menu, Cuisine, Takeaway',icon:Coffee},
  {id:'restaurant',title:'Restaurant',description:'Tables, QR Menu, Cuisine, Takeaway, Livraison',icon:UtensilsCrossed},
  {id:'library',title:'Librairie',description:'POS, Stock, Code-barres, Fournisseurs, Achats',icon:BookOpen},
  {id:'grocery',title:'Alimentation / Épicerie',description:'POS, Stock, Achats, Produits au poids',icon:ShoppingBasket},
  {id:'drugstore',title:'Droguerie',description:'POS, Stock, Code-barres, Fournisseurs, Achats',icon:Package},
  {id:'retail',title:'Commerce / Retail',description:'POS, Stock, Fournisseurs, Achats, Clients',icon:Store},
  {id:'custom',title:'Personnalisé',description:'Choisissez vous-même les modules',icon:Store},
]

export const recommendedModules:Record<BusinessType,FeatureKey[]>={cafe:['pos','inventory','tables','qr_menu','kitchen','takeaway'],restaurant:['pos','inventory','tables','qr_menu','kitchen','takeaway'],library:['pos','inventory','barcode','suppliers','purchases','customers'],grocery:['pos','inventory','barcode','suppliers','purchases','weighted_products'],drugstore:['pos','inventory','barcode','suppliers','purchases'],retail:['pos','inventory','barcode','suppliers','purchases','customers'],custom:['pos']}
export const businessTypeLabel=(type:BusinessType)=>businessTypes.find(item=>item.id===type)?.title??type
