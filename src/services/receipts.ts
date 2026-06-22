import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  orderBy,
  where,
  Timestamp,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { Receipt, Store, Product, ProductPrice, ShoppingList, ShoppingListItem } from '../types';
import { SefazResult, normalizeCNPJ, normalizeProductName } from './sefaz';

// ── Stores ──────────────────────────────────────────────────────────────────

export async function getStore(cnpj: string): Promise<Store | null> {
  const id = normalizeCNPJ(cnpj);
  const snap = await getDoc(doc(db, 'stores', id));
  return snap.exists() ? (snap.data() as Store) : null;
}

export async function saveStore(store: Store): Promise<void> {
  await setDoc(doc(db, 'stores', store.id), store, { merge: true });
}

export async function updateStoreNickname(cnpj: string, nickname: string): Promise<void> {
  const id = normalizeCNPJ(cnpj);
  await setDoc(doc(db, 'stores', id), { nickname }, { merge: true });
}

export async function getAllStores(): Promise<Store[]> {
  const snap = await getDocs(collection(db, 'stores'));
  return snap.docs.map((d) => d.data() as Store);
}

// ── Receipts ─────────────────────────────────────────────────────────────────

export async function saveReceipt(sefazData: SefazResult, store: Store): Promise<string> {
  const batch = writeBatch(db);

  // Save receipt
  const receiptRef = doc(collection(db, 'receipts'));
  const receipt: Omit<Receipt, 'id'> = {
    storeId: store.id,
    storeName: store.nickname || store.officialName,
    officialStoreName: store.officialName,
    date: Timestamp.fromDate(new Date(sefazData.date)),
    total: sefazData.total,
    qrUrl: '',
    accessKey: sefazData.accessKey,
    items: sefazData.items,
    createdAt: serverTimestamp() as Timestamp,
  };
  batch.set(receiptRef, receipt);

  // Update products price history
  for (const item of sefazData.items) {
    const normalizedName = normalizeProductName(item.name);
    const productId = normalizedName.replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').slice(0, 60);
    const productRef = doc(db, 'products', productId);

    const priceEntry: ProductPrice = {
      storeId: store.id,
      storeName: store.nickname || store.officialName,
      price: item.unitPrice,
      date: Timestamp.fromDate(new Date(sefazData.date)),
      receiptId: receiptRef.id,
      quantity: item.quantity,
      unit: item.unit,
    };

    const existingSnap = await getDoc(productRef);
    if (existingSnap.exists()) {
      const existing = existingSnap.data() as Product;
      const prices = [...existing.prices, priceEntry];
      const cheapest = prices.reduce((min, p) => (p.price < min.price ? p : min));
      batch.set(
        productRef,
        {
          prices,
          cheapestPrice: cheapest.price,
          cheapestStore: cheapest.storeName,
          cheapestStoreId: cheapest.storeId,
          lastPrice: item.unitPrice,
          lastStore: store.nickname || store.officialName,
        },
        { merge: true }
      );
    } else {
      const newProduct: Product = {
        id: productId,
        name: item.name,
        normalizedName,
        code: item.code,
        prices: [priceEntry],
        cheapestPrice: item.unitPrice,
        cheapestStore: store.nickname || store.officialName,
        lastPrice: item.unitPrice,
        lastStore: store.nickname || store.officialName,
      };
      batch.set(productRef, newProduct);
    }
  }

  await batch.commit();
  return receiptRef.id;
}

export async function getAllReceipts(): Promise<Receipt[]> {
  const q = query(collection(db, 'receipts'), orderBy('date', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Receipt));
}

export async function getReceiptsByStore(storeId: string): Promise<Receipt[]> {
  const q = query(
    collection(db, 'receipts'),
    where('storeId', '==', storeId),
    orderBy('date', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Receipt));
}

export async function getReceipt(id: string): Promise<Receipt | null> {
  const snap = await getDoc(doc(db, 'receipts', id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Receipt) : null;
}

export async function deleteReceipt(receipt: Receipt): Promise<void> {
  const batch = writeBatch(db);

  // Remove a nota
  batch.delete(doc(db, 'receipts', receipt.id));

  // Remove os preços deste recibo de cada produto
  for (const item of receipt.items) {
    const normalizedName = normalizeProductName(item.name);
    const productId = normalizedName.replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').slice(0, 60);
    const productRef = doc(db, 'products', productId);
    const snap = await getDoc(productRef);
    if (!snap.exists()) continue;

    const product = snap.data() as Product;
    const remaining = product.prices.filter((p) => p.receiptId !== receipt.id);

    if (remaining.length === 0) {
      batch.delete(productRef);
    } else {
      const cheapest = remaining.reduce((min, p) => (p.price < min.price ? p : min));
      batch.set(productRef, {
        ...product,
        prices: remaining,
        cheapestPrice: cheapest.price,
        cheapestStore: cheapest.storeName,
        cheapestStoreId: cheapest.storeId,
        lastPrice: remaining[remaining.length - 1].price,
        lastStore: remaining[remaining.length - 1].storeName,
      });
    }
  }

  await batch.commit();
}

// ── Products ─────────────────────────────────────────────────────────────────

export async function getAllProducts(): Promise<Product[]> {
  const snap = await getDocs(collection(db, 'products'));
  return snap.docs.map((d) => d.data() as Product);
}

export async function searchProducts(term: string): Promise<Product[]> {
  const all = await getAllProducts();
  const normalized = normalizeProductName(term);
  return all.filter((p) => p.normalizedName.includes(normalized));
}

export async function getProduct(id: string): Promise<Product | null> {
  const snap = await getDoc(doc(db, 'products', id));
  return snap.exists() ? (snap.data() as Product) : null;
}

export async function renameProduct(productId: string, newName: string): Promise<void> {
  await setDoc(doc(db, 'products', productId), { name: newName }, { merge: true });
}

export async function mergeProducts(sourceId: string, targetId: string): Promise<void> {
  const [sourceSnap, targetSnap] = await Promise.all([
    getDoc(doc(db, 'products', sourceId)),
    getDoc(doc(db, 'products', targetId)),
  ]);
  if (!sourceSnap.exists() || !targetSnap.exists()) throw new Error('Produto não encontrado');

  const source = sourceSnap.data() as Product;
  const target = targetSnap.data() as Product;

  const mergedPrices = [...target.prices, ...source.prices].sort(
    (a, b) => a.date.toMillis() - b.date.toMillis()
  );
  const cheapest = mergedPrices.reduce((min, p) => (p.price < min.price ? p : min));
  const last = mergedPrices[mergedPrices.length - 1];

  const batch = writeBatch(db);
  batch.set(doc(db, 'products', targetId), {
    ...target,
    prices: mergedPrices,
    cheapestPrice: cheapest.price,
    cheapestStore: cheapest.storeName,
    cheapestStoreId: cheapest.storeId,
    lastPrice: last.price,
    lastStore: last.storeName,
  });
  batch.delete(doc(db, 'products', sourceId));
  await batch.commit();
}

// ── Shopping Lists ────────────────────────────────────────────────────────────

export async function getShoppingLists(): Promise<ShoppingList[]> {
  const q = query(collection(db, 'shopping_lists'), orderBy('updatedAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ShoppingList));
}

export async function saveShoppingList(list: Omit<ShoppingList, 'id'>): Promise<string> {
  const ref = doc(collection(db, 'shopping_lists'));
  await setDoc(ref, list);
  return ref.id;
}

export async function updateShoppingList(id: string, list: Partial<ShoppingList>): Promise<void> {
  await setDoc(doc(db, 'shopping_lists', id), { ...list, updatedAt: serverTimestamp() }, { merge: true });
}

export async function estimateShoppingList(items: ShoppingListItem[]): Promise<ShoppingListItem[]> {
  const enriched: ShoppingListItem[] = [];

  for (const item of items) {
    const normalized = normalizeProductName(item.productName);
    const productId = normalized.replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').slice(0, 60);
    const product = await getProduct(productId);

    if (product && product.prices.length > 0) {
      const cheapest = product.prices.reduce((min, p) => (p.price < min.price ? p : min));
      enriched.push({
        ...item,
        estimatedPrice: cheapest.price * item.quantity,
        cheapestStoreId: cheapest.storeId,
        cheapestStoreName: cheapest.storeName,
      });
    } else {
      enriched.push(item);
    }
  }

  return enriched;
}
