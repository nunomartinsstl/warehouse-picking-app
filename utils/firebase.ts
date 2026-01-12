import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch, setDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
import { StockItem, OrderItem } from '../types';

// --- PASTE YOUR FIREBASE CONFIG HERE ---
const firebaseConfig = {
  apiKey: "AIzaSy...", // <--- REPLACE THIS
  authDomain: "warehousepicker.firebaseapp.com", // <--- REPLACE THIS
  projectId: "warehousepicker", // <--- REPLACE THIS
  storageBucket: "warehousepicker.appspot.com", // <--- REPLACE THIS
  messagingSenderId: "123...", // <--- REPLACE THIS
  appId: "1:123..." // <--- REPLACE THIS
};

// Initialize only if not already initialized
let db: any;
try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
} catch (e) {
    console.error("Firebase init error (Did you replace the config?):", e);
}

// Helper to chunk arrays (Firestore batch limit is 500 ops)
const chunkArray = <T>(array: T[], size: number): T[][] => {
    const chunked: T[][] = [];
    let index = 0;
    while (index < array.length) {
        chunked.push(array.slice(index, size + index));
        index += size;
    }
    return chunked;
};

// --- STOCK FUNCTIONS ---

export const saveStockToCloud = async (stock: StockItem[]) => {
    if (!db) throw new Error("Database not initialized");
    
    // 1. Get all current stock docs to delete them (Full Replace strategy)
    // In a real SAP integration, we would upsert, but for Excel replacement, full wipe is safer
    const stockCollection = collection(db, 'stock');
    const snapshot = await getDocs(stockCollection);
    
    // Delete in batches
    const deleteBatches = chunkArray(snapshot.docs, 400);
    for (const batchDocs of deleteBatches) {
        const batch = writeBatch(db);
        batchDocs.forEach((d: any) => batch.delete(d.ref));
        await batch.commit();
    }

    // 2. Add new stock in batches
    const addBatches = chunkArray(stock, 400);
    for (const batchItems of addBatches) {
        const batch = writeBatch(db);
        batchItems.forEach(item => {
            // Create a unique ID based on material + bin
            const id = `${item.material}_${item.bin}`.replace(/\//g, '-'); 
            const ref = doc(db, 'stock', id);
            batch.set(ref, item);
        });
        await batch.commit();
    }
    return true;
};

export const fetchStockFromCloud = async (): Promise<StockItem[]> => {
    if (!db) return [];
    const snapshot = await getDocs(collection(db, 'stock'));
    return snapshot.docs.map(d => d.data() as StockItem);
};

// --- ORDER FUNCTIONS ---

export const saveOrderToCloud = async (orderName: string, items: OrderItem[]) => {
    if (!db) throw new Error("Database not initialized");
    const orderRef = doc(db, 'orders', orderName);
    
    await setDoc(orderRef, {
        name: orderName,
        createdAt: new Date().toISOString(),
        status: 'open',
        items: items
    });
};

export const fetchOpenOrdersFromCloud = async (): Promise<{name: string, date: string, items: OrderItem[]}[]> => {
    if (!db) return [];
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map(d => {
        const data = d.data();
        return {
            name: data.name,
            date: new Date(data.createdAt).toLocaleString('pt-PT'),
            items: data.items as OrderItem[]
        };
    });
};

export const markOrderComplete = async (orderName: string) => {
    if (!db) return;
    // In a real app, we might move it to a 'history' collection. 
    // Here we just delete it from open orders to keep it clean.
    await deleteDoc(doc(db, 'orders', orderName));
};