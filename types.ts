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