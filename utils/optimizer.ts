import { LayoutNode, OrderItem, PickingTask, StockItem } from '../types';

const DOOR_COORDS = { x: 0, y: 1.5, z: 25 };

const getDistance = (p1: { x: number; y: number; z: number }, p2: { x: number; y: number; z: number }) => {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2) + Math.pow(p2.z - p1.z, 2));
};

export const generatePickingList = (
  orders: OrderItem[],
  stock: StockItem[],
  layout: Map<string, LayoutNode>
): PickingTask[] => {
  let currentPos = { ...DOOR_COORDS };
  const tasks: PickingTask[] = [];
  
  // Clone orders to track remaining needs
  const remainingOrders = orders.map(o => ({ ...o }));

  // Create a pool of available stock with coordinates
  // We only care about stock that is relevant to the orders
  let relevantStock = stock.filter(s => 
    remainingOrders.some(o => o.material === s.material)
  ).map(s => {
    const coords = layout.get(s.bin) || { x: 0, y: 0, z: 0 }; // Default to 0,0,0 if missing, strictly for fallback
    return {
      ...s,
      ...coords,
      hasCoords: layout.has(s.bin)
    };
  }).filter(s => s.hasCoords); // Only pick from bins we know the location of

  let sequence = 1;

  while (remainingOrders.some(o => o.qty > 0) && relevantStock.length > 0) {
    // Filter stock for items we still need
    const candidateStock = relevantStock.filter(s => {
      const needed = remainingOrders.find(o => o.material === s.material);
      return needed && needed.qty > 0;
    });

    if (candidateStock.length === 0) break; // Cannot fulfill rest

    // Find nearest neighbor
    let bestIdx = -1;
    let minDist = Infinity;

    for (let i = 0; i < candidateStock.length; i++) {
      const dist = getDistance(currentPos, candidateStock[i]);
      if (dist < minDist) {
        minDist = dist;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;

    const chosenStock = candidateStock[bestIdx];
    
    // Calculate pick qty
    const orderItem = remainingOrders.find(o => o.material === chosenStock.material)!;
    const pickQty = Math.min(orderItem.qty, chosenStock.qtyAvailable);

    // Add task
    tasks.push({
      sequence: sequence++,
      material: chosenStock.material,
      bin: chosenStock.bin,
      qtyToPick: pickQty,
      coordinates: { x: chosenStock.x, y: chosenStock.y, z: chosenStock.z },
      distanceFromLast: minDist
    });

    // Update state
    orderItem.qty -= pickQty;
    currentPos = { x: chosenStock.x, y: chosenStock.y, z: chosenStock.z };

    // Decrement stock in our working pool (or remove if empty)
    // We find the item in the original 'relevantStock' array to modify/remove it
    const realIdx = relevantStock.indexOf(chosenStock);
    if (realIdx > -1) {
       relevantStock[realIdx].qtyAvailable -= pickQty;
       if (relevantStock[realIdx].qtyAvailable <= 0) {
         relevantStock.splice(realIdx, 1);
       }
    }
  }

  return tasks;
};