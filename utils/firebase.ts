import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import 'firebase/compat/auth';
import { User, StockItem, CloudOrder, OrderItem, PickingTask, ReceiptData } from '../types';

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
let auth: any = null;
let initError: string | null = null;

try {
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    
    // CRITICAL FIX: Explicitly pass the URL to getDatabase. 
    db = firebase.app().database(firebaseConfig.databaseURL); 
    auth = firebase.auth();
    
    console.log("Firebase initialized. Connected to:", firebaseConfig.databaseURL);
} catch (e: any) {
    console.error("Firebase init error:", e);
    initError = e.message || "Unknown Firebase initialization error";
}

// Export auth for App.tsx
export { auth };

// Helper to check DB status
const ensureDb = () => {
    if (!db) {
        if (initError) throw new Error(`Erro na conexão Firebase: ${initError}`);
        throw new Error("Base de dados não inicializada. Verifique a configuração.");
    }
    return db;
};

// --- AUTHENTICATION FUNCTIONS ---

export const signOutUser = async () => {
    if (auth) {
        await auth.signOut();
    }
};

export const fetchUserProfile = async (uid: string): Promise<User> => {
    const database = ensureDb();
    const snapshot = await database.ref(`nexus_users/${uid}`).once('value');
    if (!snapshot.exists()) {
        throw new Error("Perfil de utilizador não encontrado.");
    }
    return snapshot.val() as User;
};

export const authenticateUser = async (identifier: string, password: string, targetCompanyId: string): Promise<User> => {
    if (!auth) throw new Error("Serviço de autenticação não inicializado.");

    try {
        let emailToAuth = identifier;

        if (!identifier.includes('@')) {
             const storedEmail = localStorage.getItem(`usermap_${identifier.toLowerCase()}`);
             if (storedEmail) {
                 console.log(`Resolved username '${identifier}' to '${storedEmail}' via local cache.`);
                 emailToAuth = storedEmail;
             } else {
                 throw new Error("Nome de utilizador desconhecido neste dispositivo. Por favor use o Email na primeira vez.");
             }
        }

        const userCredential = await auth.signInWithEmailAndPassword(emailToAuth, password);
        const uid = userCredential.user?.uid;
        
        if (!uid) throw new Error("Erro ao obter UID do utilizador.");

        const user = await fetchUserProfile(uid);

        const userRole = (user.role || '').toUpperCase();
        const allowedRoles = ['ADMIN', 'LOGISTICA', 'LOGÍSTICA'];
        
        if (!allowedRoles.includes(userRole)) {
            await auth.signOut();
            throw new Error("Acesso negado. Apenas perfil 'Admin' ou 'Logística'.");
        }

        if (userRole !== 'ADMIN' && user.companyId !== targetCompanyId) {
            await auth.signOut();
            throw new Error("Não tem permissão para aceder a esta empresa.");
        }
        
        if (user.username) {
            localStorage.setItem(`usermap_${user.username.toLowerCase()}`, user.email);
        }
        localStorage.setItem('setling_last_email', user.email);

        return user;
    } catch (e: any) {
        console.error("Auth error:", e);
        if (e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password' || e.code === 'auth/invalid-email') {
            throw new Error("Credenciais inválidas.");
        }
        if (e.code === 'auth/user-not-found') {
             throw new Error("Utilizador não encontrado.");
        }
        throw e;
    }
};

// --- STOCK FUNCTIONS ---

export const fetchStockFromCloud = async (): Promise<StockItem[]> => {
    const database = ensureDb();
    try {
        const snapshot = await database.ref('nexus_stock').once('value');
        if (snapshot.exists()) {
            const data = snapshot.val();
            const rawList = Array.isArray(data) ? data : Object.values(data);
            
            return rawList.map((item: any) => ({
                material: item.sku || '',
                description: item.description || '',
                qtyAvailable: Number(item.quantity) || 0,
                bin: (item.batch && item.batch !== '-') ? item.batch : 'Geral' 
            })).filter((i: any) => i.material);
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
    const database = ensureDb();
    try {
        const nexusStock = stock.map(s => ({
            sku: s.material,
            description: s.description,
            quantity: s.qtyAvailable,
            batch: s.bin,
            lastUpdated: new Date().toISOString()
        }));
        await database.ref('nexus_stock').set(nexusStock);
        console.log("Stock saved successfully to nexus_stock");
    } catch (e) {
        console.error("Error saving stock:", e);
        throw e;
    }
};

// --- RECEIPT FUNCTIONS (ENTRADA) ---

export const submitReceipt = async (receipt: ReceiptData) => {
    const database = ensureDb();
    
    // 1. Save the Receipt Record
    const receiptRef = database.ref('nexus_receipts').push();
    await receiptRef.set({
        ...receipt,
        id: receiptRef.key
    });

    // 2. Update Stock Levels
    // We fetch current stock, update it, and save it back.
    // Note: In a high concurrency environment, we would use transactions per item, 
    // but for this app, reading and writing the whole array is the established pattern.
    const currentStock = await fetchStockFromCloud();
    const updatedStock = [...currentStock];

    receipt.items.forEach(newItem => {
        const existingIndex = updatedStock.findIndex(s => s.material === newItem.material && s.bin === newItem.bin);
        
        if (existingIndex > -1) {
            // Update existing
            updatedStock[existingIndex].qtyAvailable += newItem.qty;
        } else {
            // Create new
            updatedStock.push({
                material: newItem.material,
                description: '', // Optional: fetch description if we had a master data table
                bin: newItem.bin,
                qtyAvailable: newItem.qty
            });
        }
    });

    await saveStockToCloud(updatedStock);
    console.log("Receipt processed and stock updated.");
};

// --- TRANSFER FUNCTIONS ---

export const submitTransfer = async (data: { originBin: string, destBin: string, material: string, qty: number, userId: string }) => {
    const database = ensureDb();
    
    // 1. Log the Transfer
    const transferRef = database.ref('nexus_transfers').push();
    await transferRef.set({
        ...data,
        timestamp: new Date().toISOString(),
        id: transferRef.key
    });

    // 2. Update Stock
    const currentStock = await fetchStockFromCloud();
    const updatedStock = [...currentStock];

    // Find Source
    const sourceIndex = updatedStock.findIndex(s => s.material === data.material && s.bin === data.originBin);
    if (sourceIndex === -1) {
        throw new Error("Origem não encontrada ou sem stock.");
    }

    if (updatedStock[sourceIndex].qtyAvailable < data.qty) {
        throw new Error("Quantidade insuficiente na origem.");
    }

    // Deduct from Source
    updatedStock[sourceIndex].qtyAvailable -= data.qty;
    
    // If source becomes 0, we might want to keep it or remove it. 
    // Usually we keep it with 0 or remove it. Let's keep it for now or remove if 0?
    // Let's remove if 0 to keep list clean, or keep it. 
    // The fetchStockFromCloud filters (i => i.material), so 0 qty items might be visible.
    // Let's leave it as is.

    // Find/Create Destination
    const destIndex = updatedStock.findIndex(s => s.material === data.material && s.bin === data.destBin);
    
    if (destIndex > -1) {
        updatedStock[destIndex].qtyAvailable += data.qty;
    } else {
        updatedStock.push({
            material: data.material,
            description: updatedStock[sourceIndex].description, // Copy description
            bin: data.destBin,
            qtyAvailable: data.qty
        });
    }

    // Remove items with 0 qty to clean up? Or keep them?
    // If we remove them, we might lose the record that the bin *can* hold that item.
    // But for a clean stock list, removing 0s is often better.
    // Let's filter out 0s.
    const finalStock = updatedStock.filter(s => s.qtyAvailable > 0);

    await saveStockToCloud(finalStock);
    console.log("Transfer processed successfully.");
};

// --- ORDER FUNCTIONS ---

export const fetchOrder = async (orderId: string): Promise<CloudOrder | null> => {
    const database = ensureDb();
    try {
        const snapshot = await database.ref(`nexus_orders/${orderId}`).once('value');
        if (snapshot.exists()) {
            const rawOrder = snapshot.val();
            return {
                id: orderId,
                name: rawOrder.title || rawOrder.name || 'Sem Nome',
                status: rawOrder.status || 'OPEN',
                createdAt: rawOrder.dateCreated || rawOrder.createdAt || new Date().toISOString(),
                pickedBy: rawOrder.pickedBy,
                items: (rawOrder.items || []).map((i: any) => ({
                    material: i.sku || i.material,
                    qty: Number(i.quantity || i.qty)
                }))
            } as CloudOrder;
        }
        return null;
    } catch (e) {
        console.error(`Error fetching order ${orderId}:`, e);
        throw e;
    }
};

export const fetchOpenOrdersFromCloud = async (): Promise<CloudOrder[]> => {
    const database = ensureDb();
    try {
        const snapshot = await database.ref('nexus_orders').once('value');
        
        if (snapshot.exists()) {
            const data = snapshot.val();
            const allOrders = Object.keys(data).map(key => {
                const rawOrder = data[key];
                return {
                    id: key,
                    name: rawOrder.title || rawOrder.name || 'Sem Nome',
                    status: rawOrder.status || 'OPEN',
                    createdAt: rawOrder.dateCreated || rawOrder.createdAt || new Date().toISOString(),
                    items: (rawOrder.items || []).map((i: any) => ({
                        material: i.sku || i.material,
                        qty: Number(i.quantity || i.qty)
                    }))
                };
            }) as CloudOrder[];

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
        const snapshot = await database.ref('nexus_orders').once('value');
        
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
        const ordersRef = database.ref('nexus_orders');
        const newOrderRef = ordersRef.push();
        
        const newOrder = {
            id: newOrderRef.key,
            title: name,
            items: items.map(i => ({
                sku: i.material,
                quantity: i.qty,
                description: '',
                isCustom: false
            })),
            status: 'OPEN',
            dateCreated: new Date().toISOString(),
            creator: 'WarehousePickerApp'
        };
        
        await newOrderRef.set(newOrder);
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
        await database.ref(`nexus_orders/${orderId}`).remove();
        console.log("Order deleted:", orderId);
    } catch (e) {
        console.error("Error deleting order:", e);
        throw e;
    }
};

export const revertOrderToOpen = async (orderId: string) => {
    const database = ensureDb();
    const updates: any = {};
    
    updates[`/nexus_orders/${orderId}/status`] = 'OPEN';
    updates[`/nexus_orders/${orderId}/completedAt`] = null;
    updates[`/nexus_orders/${orderId}/pickedBy`] = null;
    updates[`/nexus_orders/${orderId}/pickedItems`] = null;
    updates[`/nexus_orders/${orderId}/excelReport`] = null;
    updates[`/nexus_orders/${orderId}/exportData`] = null;

    try {
        await database.ref().update(updates);
        console.log(`Order ${orderId} reverted to OPEN. Picking data cleared.`);
    } catch (e) {
        console.error(`Error reverting order ${orderId}:`, e);
        throw e;
    }
};

export const updateOrderStatus = async (orderId: string, newStatus: 'OPEN' | 'IN PROCESS' | 'COMPLETED', pickedBy?: string) => {
    const database = ensureDb();
    
    const updates: any = {};
    updates[`/nexus_orders/${orderId}/status`] = newStatus;
    
    if (newStatus === 'COMPLETED') {
        updates[`/nexus_orders/${orderId}/completedAt`] = new Date().toISOString();
    }

    if (pickedBy) {
        updates[`/nexus_orders/${orderId}/pickedBy`] = pickedBy;
    }

    try {
        await database.ref().update(updates);
        console.log(`Order ${orderId} updated to ${newStatus}`);
    } catch (e) {
        console.error(`Error updating order ${orderId}:`, e);
        throw e;
    }
};

export const decrementStock = async (pickedItems: PickingTask[]): Promise<{ success: boolean; details: string[] }> => {
    const database = ensureDb();
    
    // FORCE ARRAY: Firebase might return { "0": {...}, "1": {...} } as an object
    const itemsToProcess = Array.isArray(pickedItems) ? pickedItems : Object.values(pickedItems);
    
    console.log("[STOCK-DEBUG] Starting decrement for items:", itemsToProcess);

    if (!itemsToProcess || itemsToProcess.length === 0) {
        console.warn("[STOCK-DEBUG] Abort: No items or no DB.");
        return { success: false, details: ["Nenhum item para processar."] };
    }

    try {
        const stockRef = database.ref('nexus_stock');
        const logs: string[] = [];
        
        const transactionResult = await stockRef.transaction((currentData: any) => {
            if (!currentData) {
                console.warn("[STOCK-DEBUG] Transaction found NO stock data in DB.");
                return currentData;
            }

            // Iterate through items picked by the warehouse app
            itemsToProcess.forEach((picked: PickingTask, idx: number) => {
                // Ensure we are working with strings, but NO trimming/replacing
                const pickedSku = String(picked.material || ''); 
                const pickedBin = String(picked.bin || '');
                const qtyToDeduct = Number(picked.pickedQty);

                console.log(`[STOCK-DEBUG] Item #${idx} -> SKU: '${pickedSku}', BIN: '${pickedBin}', QTY: ${qtyToDeduct}`);

                if (qtyToDeduct > 0 && pickedSku) {
                    let matched = false;
                    // We must iterate the stock DB structure
                    for (const key in currentData) {
                        const stockItem = currentData[key];
                        if (!stockItem) continue;

                        const stockSku = String(stockItem.sku || '');
                        const stockBatch = String(stockItem.batch || '');

                        // EXACT MATCH REQUIRED
                        const isSkuMatch = stockSku === pickedSku;
                        // If picked bin is empty/undefined, we require logic to handle it.
                        // Here we assume strict bin matching if provided.
                        const isBinMatch = pickedBin ? (stockBatch === pickedBin) : false;

                        if (isSkuMatch && isBinMatch) {
                            const currentQty = Number(stockItem.quantity) || 0;
                            
                            console.log(`[STOCK-DEBUG] MATCH FOUND at Key '${key}'. DB Stock: ${currentQty}. Deducting: ${qtyToDeduct}`);

                            // Deduct
                            const deduction = Math.min(currentQty, qtyToDeduct);
                            
                            if (deduction > 0) {
                                stockItem.quantity = currentQty - deduction;
                                stockItem.lastUpdated = new Date().toISOString();
                                console.log(`[STOCK-DEBUG] NEW DB Stock: ${stockItem.quantity}`);
                            } else {
                                console.warn(`[STOCK-DEBUG] Stock was 0, could not deduct.`);
                            }
                            matched = true;
                            break; // Stop looking for this specific picked line
                        }
                    }
                    if (!matched) {
                         console.error(`[STOCK-DEBUG] NO MATCH for SKU: '${pickedSku}' + Bin: '${pickedBin}'`);
                    }
                } else {
                    console.warn(`[STOCK-DEBUG] Skipped Item #${idx} due to invalid data.`);
                }
            });

            return currentData; // Commit changes
        });

        if (transactionResult.committed) {
            console.log("[STOCK-DEBUG] Transaction Committed Successfully.");
            // Post-process logs for the UI 
            itemsToProcess.forEach((p: PickingTask) => {
                if(Number(p.pickedQty) > 0) {
                    logs.push(`Processado: ${p.material} (${p.pickedQty})`);
                }
            });
            return { success: true, details: logs };
        } else {
            console.error("[STOCK-DEBUG] Transaction Failed/Aborted by Firebase.");
            return { success: false, details: ["Transação abortada pelo banco de dados."] };
        }

    } catch (e: any) {
        console.error("[STOCK-DEBUG] Exception in decrementStock:", e);
        return { success: false, details: [e.message] };
    }
};

export const markOrderComplete = async (orderId: string, pickedItems: PickingTask[] = [], excelReportBase64: string = '', pickerInfo: string = 'unknown') => {
    const database = ensureDb();
    const updates: any = {};
    
    updates[`/nexus_orders/${orderId}/status`] = 'COMPLETED';
    updates[`/nexus_orders/${orderId}/completedAt`] = new Date().toISOString();
    updates[`/nexus_orders/${orderId}/pickedBy`] = pickerInfo;
    
    updates[`/nexus_orders/${orderId}/pickedItems`] = pickedItems;
    
    const exportData = pickedItems.map((task, index) => ({
        Itm: (index + 1) * 10,
        C: 'P',
        I: '',
        Cen: '1700',
        DepositoSaida: '0001',
        Deposito: '0004',
        Material: task.material,
        TextoBreve: '',
        Lote: task.bin,
        QtdPedido: task.pickedQty ?? 0,
        DtRemessa: new Date().toLocaleDateString('pt-PT')
    }));

    updates[`/nexus_orders/${orderId}/exportData`] = exportData;

    if (excelReportBase64) {
        updates[`/nexus_orders/${orderId}/excelReport`] = excelReportBase64;
    }

    try {
        // 1. Update Order Status
        await database.ref().update(updates);
        console.log(`Order ${orderId} completed and results uploaded.`);

        // 2. Decrement Stock
        if (pickedItems.length > 0) {
            console.log("Starting automatic stock deduction...");
            const stockResult = await decrementStock(pickedItems);
            if (stockResult.success) {
                console.log("Stock deducted successfully.");
                // Optionally log this to the order changeLog if needed
            } else {
                console.warn("Stock deduction failed or partial:", stockResult.details);
            }
        }

    } catch (e) {
        console.error(`Error completing order ${orderId}:`, e);
        throw e;
    }
};