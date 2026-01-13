
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch, setDoc, updateDoc, query, orderBy, where, deleteDoc } from 'firebase/firestore';
import { StockItem, OrderItem, CloudOrder } from '../types';

// --- PASTE YOUR FIREBASE CONFIG HERE ---
// Ensure you have enabled Firestore Database in your Firebase Console
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
            const id = `${item.material}_${item.bin}`.replace(/\//g, '-').replace(/\s+/g, ''); 
            const ref = doc(db, 'stock', id);
            batch.set(ref, item);
        });
        await batch.commit();
    }
    return true;
};

export const fetchStockFromCloud = async (): Promise<StockItem[]> => {
    if (!db) return [];
    try {
        const snapshot = await getDocs(collection(db, 'stock'));
        return snapshot.docs.map(d => d.data() as StockItem);
    } catch (e) {
        console.error("Error fetching stock:", e);
        return [];
    }
};

// --- ORDER FUNCTIONS ---

// Upload a new Order (from Excel)
export const createCloudOrder = async (orderName: string, items: OrderItem[]) => {
    if (!db) throw new Error("Database not initialized");
    // Sanitize ID
    const safeId = orderName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const orderRef = doc(db, 'orders', safeId);
    
    const newOrder: CloudOrder = {
        id: safeId,
        name: orderName,
        items: items,
        status: 'open',
        createdAt: new Date().toISOString()
    };

    await setDoc(orderRef, newOrder);
};

// Fetch only OPEN orders for the Picker
export const fetchOpenOrdersFromCloud = async (): Promise<CloudOrder[]> => {
    if (!db) return [];
    try {
        const q = query(
            collection(db, 'orders'), 
            where('status', '==', 'open'),
            orderBy('createdAt', 'desc')
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => d.data() as CloudOrder);
    } catch (e) {
        console.error("Error fetching open orders:", e);
        return [];
    }
};

// Fetch COMPLETED orders for the Manager
export const fetchCompletedOrdersFromCloud = async (): Promise<CloudOrder[]> => {
    if (!db) return [];
    try {
        const q = query(
            collection(db, 'orders'), 
            where('status', '==', 'completed'),
            orderBy('completedAt', 'desc')
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => d.data() as CloudOrder);
    } catch (e) {
        console.error("Error fetching completed orders:", e);
        return [];
    }
};

// Move order to completed status
export const markOrderComplete = async (orderId: string) => {
    if (!db) return;
    const orderRef = doc(db, 'orders', orderId);
    await updateDoc(orderRef, {
        status: 'completed',
        completedAt: new Date().toISOString()
    });
};

// Delete an order (Manager utility)
export const deleteOrder = async (orderId: string) => {
    if (!db) return;
    await deleteDoc(doc(db, 'orders', orderId));
};
