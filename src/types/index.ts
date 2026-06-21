import { Timestamp } from 'firebase/firestore';

export interface Store {
  id: string;         // CNPJ (sem formatação)
  cnpj: string;
  officialName: string;
  nickname: string;   // apelido dado pelo usuário
  address?: string;
  city?: string;
  state?: string;
}

export interface ReceiptItem {
  code: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
}

export interface Receipt {
  id: string;
  storeId: string;    // CNPJ
  storeName: string;  // apelido ou nome oficial
  officialStoreName: string;
  date: Timestamp;
  total: number;
  qrUrl: string;
  accessKey?: string;
  items: ReceiptItem[];
  createdAt: Timestamp;
}

export interface ProductPrice {
  storeId: string;
  storeName: string;
  price: number;
  date: Timestamp;
  receiptId: string;
  quantity: number;
  unit: string;
}

export interface Product {
  id: string;
  name: string;
  normalizedName: string;
  code?: string;
  prices: ProductPrice[];
  cheapestPrice?: number;
  cheapestStore?: string;
  lastPrice?: number;
  lastStore?: string;
}

export interface ShoppingListItem {
  id: string;
  productName: string;
  quantity: number;
  unit: string;
  checked: boolean;
  estimatedPrice?: number;
  cheapestStoreId?: string;
  cheapestStoreName?: string;
}

export interface ShoppingList {
  id: string;
  name: string;
  items: ShoppingListItem[];
  totalEstimate: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface StoreRanking {
  store: Store;
  averagePrice: number;
  totalReceipts: number;
  cheapestItems: number;
  totalSpent: number;
}

export type RootStackParamList = {
  MainTabs: undefined;
  ReceiptDetail: { receiptId: string };
  StoreNickname: { cnpj: string; officialName: string; onSave: (nickname: string) => void };
  ProductCompare: { productName: string };
  ShoppingListDetail: { listId: string };
  ManualItems: { store: Store; date: string; total: number; qrUrl: string };
};

export type BottomTabParamList = {
  Scanner: undefined;
  History: undefined;
  Compare: undefined;
  Shopping: undefined;
  Stores: undefined;
};
