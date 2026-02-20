
export interface OrderItem {
  material: string;
  qty: number;
}

export interface StockItem {
  material: string;
  description: string;
  bin: string; // "Lote" or location reference
  qtyAvailable: number;
}

export interface LayoutNode {
  bin: string; // "Ref Completa"
  x: number;
  y: number;
  z: number;
  type?: string;
}

export interface PickingTask {
  sequence: number;
  material: string;
  bin: string;
  qtyToPick: number;
  pickedQty?: number; // Actual amount picked
  coordinates: { x: number; y: number; z: number };
  distanceFromLast: number;
  status?: 'pending' | 'picked';
  timestamp?: string;
  floorId: number; // New: Identifies the floor
  startNewSection: boolean; // New: Indicates this task starts a new path segment (e.g., new floor)
  isAdHoc?: boolean; // Was this picked freely outside the list?
  requiresConfirmation?: boolean; // Does the supervisor/user need to explicitly accept this extra item?
  isPartial?: boolean; // Flag if the picked quantity is less than requested
  isSplit?: boolean; // Flag if this item is being picked from multiple locations
}

export interface PickingSession {
  id: string;
  orderName: string;
  orderDate: string;
  dateCompleted: string;
  tasks: PickingTask[];
}

// Visual Layout Types from JSON
export interface WarehouseLayout {
  version: string;
  whWidth: number;
  whDepth: number;
  floors: { id: number; name: string }[];
  storageTypes: StorageType[];
  units: Unit[];
  colors?: { bg: string; grid: string; floor: string };
}

export interface StorageType {
  id: string;
  name: string;
  color: string;
}

export interface Unit {
  id: number;
  typeId: string;
  floorIndex: number;
  posX: number;
  posZ: number;
  rotY: number;
  params: UnitParams;
}

export interface UnitParams {
  levels: number;
  bays: number;
  bins: number;
  size: number;
  levelConfig?: LevelConfig[];
}

export interface LevelConfig {
  bays: number;
  bins: number;
  bayConfig?: Record<string, number>;
}

export interface ProcessedData {
  layout: Map<string, LayoutNode>;
  stock: StockItem[];
  orders: OrderItem[];
}

// --- USER TYPES ---
export interface User {
  uid: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string; // 'ADMIN', 'LOGISTICA'
  companyId: string; // "1" = AVAC, "2" = HOTELARIA
}

// --- CLOUD TYPES ---
export type OrderStatus = 'OPEN' | 'IN PROCESS' | 'COMPLETED';

export interface CloudOrder {
    id: string; // Firestore ID
    name: string;
    items: OrderItem[];
    status: OrderStatus;
    createdAt: string; // ISO String
    completedAt?: string; // ISO String
    pickerId?: string;
    pickedItems?: PickingTask[]; // Store the results
    excelReport?: string; // Base64 string of the generated Excel file
    isUploaded?: boolean; // Local state flag
}

// --- RECEIPT TYPES ---
export interface ReceiptItem {
    id: string;
    bin: string;
    material: string;
    qty: number;
}

export interface ReceiptData {
    poNumber: string;
    documentImage: string; // Base64 JPEG
    items: ReceiptItem[];
    date: string;
    userId: string;
}