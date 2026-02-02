import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import 'firebase/compat/auth';
import { User, StockItem, CloudOrder, OrderItem, PickingTask } from '../types';

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

// --- ORDER FUNCTIONS ---

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

export const updateOrderStatus = async (orderId: string, newStatus: 'OPEN' | 'IN PROCESS' | 'COMPLETED') => {
    const database = ensureDb();
    
    const updates: any = {};
    updates[`/nexus_orders/${orderId}/status`] = newStatus;
    
    if (newStatus === 'COMPLETED') {
        updates[`/nexus_orders/${orderId}/completedAt`] = new Date().toISOString();
    }

    try {
        await database.ref().update(updates);
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
        await database.ref().update(updates);
        console.log(`Order ${orderId} completed and results uploaded.`);
    } catch (e) {
        console.error(`Error completing order ${orderId}:`, e);
        throw e;
    }
};