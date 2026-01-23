import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, child, update, set, push, remove } from 'firebase/database';
import { StockItem, OrderItem, CloudOrder, PickingTask } from '../types';

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyARcjDl6-8W15RHX17GLy3H68VfbRIOOgU",
  authDomain: "setling-avac-data.firebaseapp.com",
  databaseURL: "https://setling-avac-data-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "setling-avac-data",
  storageBucket: "setling-avac-data.firebasestorage.app",
  messagingSenderId: "730262521814",
  appId: "1:730262521814:web:7ca301ea02a65b1df00677"
};

// Initialize Firebase
let db: any = null;
let initError: string | null = null;

try {
    const app = initializeApp(firebaseConfig);
    
    // CRITICAL FIX: Explicitly pass the URL to getDatabase. 
    // This is required for databases hosted in 'europe-west1' to bypass region auto-detection failures.
    db = getDatabase(app, firebaseConfig.databaseURL); 
    
    console.log("Firebase initialized. Connected to:", firebaseConfig.databaseURL);
} catch (e: any) {
    console.error("Firebase init error:", e);
    initError = e.message || "Unknown Firebase initialization error";
}

// Helper to check DB status
const ensureDb = () => {
    if (!db) {
        if (initError) throw new Error(`Erro na conexão Firebase: ${initError}`);
        throw new Error("Base de dados não inicializada. Verifique a configuração.");
    }
    return db;
};

// --- STOCK FUNCTIONS ---

export const fetchStockFromCloud = async (): Promise<StockItem[]> => {
    const database = ensureDb();
    try {
        const dbRef = ref(database);
        // Updated path to 'nexus_stock'
        const snapshot = await get(child(dbRef, 'nexus_stock'));
        if (snapshot.exists()) {
            const data = snapshot.val();
            const rawList = Array.isArray(data) ? data : Object.values(data);
            
            // Map 'nexus_stock' schema to internal 'StockItem' type
            // External: sku, description, quantity, batch
            // Internal: material, description, qtyAvailable, bin
            return rawList.map((item: any) => ({
                material: item.sku || '',
                description: item.description || '',
                qtyAvailable: Number(item.quantity) || 0,
                // Using 'batch' as 'bin' location. If batch is "-", it's unassigned.
                bin: (item.batch && item.batch !== '-') ? item.batch : 'Geral' 
            })).filter(i => i.material);
        } else {
            console.warn("No stock found in DB (nexus_stock)");
            return [];
        }
    } catch (e) {
        console.error("Error fetching stock:", e);
        throw e;
    }
};

export const saveStockToCloud = async (stock: StockItem[]) => {
    // Note: In the new structure, this might overwrite with the wrong format if not careful.
    // Ideally, the other app handles stock updates, but keeping this for compatibility if needed.
    const database = ensureDb();
    try {
        // Reverse mapping for saving (Internal -> External)
        const nexusStock = stock.map(s => ({
            sku: s.material,
            description: s.description,
            quantity: s.qtyAvailable,
            batch: s.bin,
            lastUpdated: new Date().toISOString()
        }));
        await set(ref(database, 'nexus_stock'), nexusStock);
        console.log("Stock saved successfully to nexus_stock");
    } catch (e) {
        console.error("Error saving stock:", e);
        throw e;
    }
};

// --- ORDER FUNCTIONS ---

export const fetchOpenOrdersFromCloud = async (): Promise<CloudOrder[]> => {
    const database = ensureDb();
    try {
        // Updated path to 'nexus_orders'
        const ordersRef = ref(database, 'nexus_orders');
        const snapshot = await get(ordersRef);
        
        if (snapshot.exists()) {
            const data = snapshot.val();
            // Handle both Array and Object responses from Firebase
            const allOrders = Object.keys(data).map(key => {
                const rawOrder = data[key];
                return {
                    id: key, // Use the Firebase Key (or existing ID if valid)
                    name: rawOrder.title || rawOrder.name || 'Sem Nome',
                    status: rawOrder.status || 'OPEN',
                    createdAt: rawOrder.dateCreated || rawOrder.createdAt || new Date().toISOString(),
                    // Map items: sku -> material, quantity -> qty
                    items: (rawOrder.items || []).map((i: any) => ({
                        material: i.sku || i.material,
                        qty: Number(i.quantity || i.qty)
                    }))
                };
            }) as CloudOrder[];

            // Client-side filter
            const openOrders = allOrders.filter(o => o.status === 'OPEN' || o.status === 'IN PROCESS');
            return openOrders;
        }
        return [];
    } catch (e) {
        console.error("Error fetching open orders:", e);
        throw e;
    }
};

export const fetchCompletedOrdersFromCloud = async (): Promise<CloudOrder[]> => {
    const database = ensureDb();
    try {
        const ordersRef = ref(database, 'nexus_orders');
        const snapshot = await get(ordersRef);
        
        if (snapshot.exists()) {
            const data = snapshot.val();
            const allOrders = Object.keys(data).map(key => {
                const rawOrder = data[key];
                return {
                    id: key,
                    name: rawOrder.title || rawOrder.name || 'Sem Nome',
                    status: rawOrder.status || 'OPEN',
                    createdAt: rawOrder.dateCreated || rawOrder.createdAt || new Date().toISOString(),
                    completedAt: rawOrder.completedAt,
                    pickedItems: rawOrder.pickedItems || [],
                    items: (rawOrder.items || []).map((i: any) => ({
                        material: i.sku || i.material,
                        qty: Number(i.quantity || i.qty)
                    }))
                };
            }) as CloudOrder[];

            // Updated status check to 'COMPLETED'
            return allOrders.filter(o => o.status === 'COMPLETED');
        }
        return [];
    } catch (e) {
        console.error("Error fetching completed orders:", e);
        throw e;
    }
};

export const createCloudOrder = async (name: string, items: OrderItem[]) => {
    const database = ensureDb();
    try {
        const ordersRef = ref(database, 'nexus_orders');
        const newOrderRef = push(ordersRef);
        
        // Map Internal -> External format
        const newOrder = {
            id: newOrderRef.key,
            title: name, // Internal 'name' -> External 'title'
            items: items.map(i => ({
                sku: i.material, // Internal 'material' -> External 'sku'
                quantity: i.qty, // Internal 'qty' -> External 'quantity'
                description: '', // Optional
                isCustom: false
            })),
            status: 'OPEN',
            dateCreated: new Date().toISOString(), // Internal 'createdAt' -> External 'dateCreated'
            creator: 'WarehousePickerApp'
        };
        
        await set(newOrderRef, newOrder);
        console.log("Order created:", newOrderRef.key);
        return newOrderRef.key;
    } catch (e) {
        console.error("Error creating order:", e);
        throw e;
    }
};

export const deleteOrder = async (orderId: string) => {
    const database = ensureDb();
    try {
        await remove(ref(database, `nexus_orders/${orderId}`));
        console.log("Order deleted:", orderId);
    } catch (e) {
        console.error("Error deleting order:", e);
        throw e;
    }
};

// New function to revert a completed order back to OPEN (Removing picking data)
export const revertOrderToOpen = async (orderId: string) => {
    const database = ensureDb();
    const updates: any = {};
    
    updates[`/nexus_orders/${orderId}/status`] = 'OPEN';
    updates[`/nexus_orders/${orderId}/completedAt`] = null;
    updates[`/nexus_orders/${orderId}/pickedItems`] = null;
    updates[`/nexus_orders/${orderId}/excelReport`] = null;
    updates[`/nexus_orders/${orderId}/exportData`] = null;

    try {
        await update(ref(database), updates);
        console.log(`Order ${orderId} reverted to OPEN. Picking data cleared.`);
    } catch (e) {
        console.error(`Error reverting order ${orderId}:`, e);
        throw e;
    }
};

export const updateOrderStatus = async (orderId: string, newStatus: 'OPEN' | 'IN PROCESS' | 'COMPLETED') => {
    const database = ensureDb();
    
    const updates: any = {};
    updates[`/nexus_orders/${orderId}/status`] = newStatus;
    
    if (newStatus === 'COMPLETED') {
        updates[`/nexus_orders/${orderId}/completedAt`] = new Date().toISOString();
    }

    try {
        await update(ref(database), updates);
        console.log(`Order ${orderId} updated to ${newStatus}`);
    } catch (e) {
        console.error(`Error updating order ${orderId}:`, e);
        throw e;
    }
};

export const markOrderComplete = async (orderId: string, pickedItems: PickingTask[] = [], excelReportBase64: string = '') => {
    const database = ensureDb();
    const updates: any = {};
    
    updates[`/nexus_orders/${orderId}/status`] = 'COMPLETED';
    updates[`/nexus_orders/${orderId}/completedAt`] = new Date().toISOString();
    
    // Save picking results (upload to Cloud Order)
    updates[`/nexus_orders/${orderId}/pickedItems`] = pickedItems;
    
    // GENERATE EXPORT DATA STRUCTURE
    // Format: Itm, C, I, Cen., Depósito de saída, Depósito, Material, Texto breve, Lote, Qtd.pedido, Dt.remessa
    const exportData = pickedItems.map((task, index) => ({
        Itm: (index + 1) * 10,
        C: 'P',
        I: '',
        Cen: '1700',
        DepositoSaida: '0001',
        Deposito: '0004',
        Material: task.material,
        TextoBreve: '', // Description not always available in task context, left empty for external fill
        Lote: task.bin, // The picked bin
        QtdPedido: task.pickedQty ?? 0, // Ensure value is not undefined (default to 0)
        DtRemessa: new Date().toLocaleDateString('pt-PT') // Today's date DD/MM/YYYY
    }));

    updates[`/nexus_orders/${orderId}/exportData`] = exportData;

    // Save Excel report if provided
    if (excelReportBase64) {
        updates[`/nexus_orders/${orderId}/excelReport`] = excelReportBase64;
    }

    try {
        await update(ref(database), updates);
        console.log(`Order ${orderId} completed and results uploaded.`);
    } catch (e) {
        console.error(`Error completing order ${orderId}:`, e);
        throw e;
    }
};