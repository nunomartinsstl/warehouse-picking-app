import { LayoutNode, OrderItem, PickingTask, StockItem } from '../types';

// Define Floor Zones with specific entrance coordinates and rotations
// Rotation: 0 (Front/Z+), Math.PI (Back/Z-), Math.PI/2 (Left/X+), -Math.PI/2 (Right/X-)
export const FLOORS = [
    // Piso 0: Front Entrance. Units Z ~ -24 to 10. Door at Z=25 is good.
    { id: 0, maxX: 35, start: { x: 0, y: 0, z: 25 }, rotation: 0 }, 
    // Piso 1: Right Edge Entrance. Units X ~ 45 to 78. Door at X=82.
    { id: 1, maxX: 100, start: { x: 82, y: 0, z: -16 }, rotation: -Math.PI/2 },  
    // Piso 2: Right Edge Entrance. Units X ~ 115 to 149. Door at X=153.
    { id: 2, maxX: 9999, start: { x: 153, y: 0, z: -14 }, rotation: -Math.PI/2 } 
];

const getDistance = (p1: { x: number; y: number; z: number }, p2: { x: number; y: number; z: number }) => {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2) + Math.pow(p2.z - p1.z, 2));
};

export const determineFloor = (x: number): number => {
    if (x < FLOORS[0].maxX) return 0;
    if (x < FLOORS[1].maxX) return 1;
    return 2;
};

/**
 * Re-optimizes the route starting from a specific task.
 * It keeps the target task first, then sorts the remaining unpicked tasks using Nearest Neighbor.
 */
export const reorderRemainingTasks = (
    currentTask: PickingTask,
    remainingTasks: PickingTask[]
): PickingTask[] => {
    if (remainingTasks.length === 0) return [currentTask];

    const newRoute: PickingTask[] = [currentTask];
    let currentPos = currentTask.coordinates;
    const pool = [...remainingTasks]; // Clone to modify

    while (pool.length > 0) {
        let bestIdx = -1;
        let minDist = Infinity;

        for (let i = 0; i < pool.length; i++) {
            const dist = getDistance(currentPos, pool[i].coordinates);
            if (dist < minDist) {
                minDist = dist;
                bestIdx = i;
            }
        }

        if (bestIdx !== -1) {
            const nextTask = pool[bestIdx];
            
            // Check if we switched floors (simple check based on floorId)
            const floorChanged = nextTask.floorId !== determineFloor(currentPos.x);
            
            newRoute.push({
                ...nextTask,
                distanceFromLast: minDist,
                startNewSection: floorChanged // Mark visual break if floor changed
            });
            
            currentPos = nextTask.coordinates;
            pool.splice(bestIdx, 1);
        } else {
            break; 
        }
    }

    return newRoute;
};

export const generatePickingList = (
  orders: OrderItem[],
  stock: StockItem[],
  layout: Map<string, LayoutNode>
): PickingTask[] => {
  const tasks: PickingTask[] = [];
  
  // Clone orders to track remaining needs
  const remainingOrders = orders.map(o => ({ ...o }));

  // 1. Enrich stock with coordinates and Floor ID
  let enrichedStock = stock.filter(s => 
    remainingOrders.some(o => o.material === s.material)
  ).map(s => {
    const coords = layout.get(s.bin);
    if (!coords) return null;
    return {
      ...s,
      ...coords,
      floorId: determineFloor(coords.x)
    };
  }).filter(s => s !== null) as (StockItem & LayoutNode & { floorId: number })[];

  let sequence = 1;

  // 2. Process each floor sequentially
  // This effectively treats them as independent units by resetting the context for each floor loop
  for (const floor of FLOORS) {
      // Get stock only for this floor
      let floorStock = enrichedStock.filter(s => s.floorId === floor.id);
      
      if (floorStock.length === 0) continue;

      // START NEW SECTION: Reset current position to the floor's specific entrance
      let currentPos = { ...floor.start };
      let isFirstOnFloor = true;

      // Nearest Neighbor for this floor
      while (remainingOrders.some(o => o.qty > 0) && floorStock.length > 0) {
           // Filter for items we still need on this floor
           const candidateStock = floorStock.filter(s => {
              const needed = remainingOrders.find(o => o.material === s.material);
              return needed && needed.qty > 0;
           });

           if (candidateStock.length === 0) break;

           // Find nearest
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
           
           // Calculate Pick Qty
           const orderItem = remainingOrders.find(o => o.material === chosenStock.material)!;
           const pickQty = Math.min(orderItem.qty, chosenStock.qtyAvailable);

           // Add Task
           tasks.push({
               sequence: sequence++,
               material: chosenStock.material,
               bin: chosenStock.bin,
               qtyToPick: pickQty,
               coordinates: { x: chosenStock.x, y: chosenStock.y, z: chosenStock.z },
               distanceFromLast: minDist,
               floorId: floor.id,
               startNewSection: isFirstOnFloor // Breaks the visual line and marks logical section start
           });

           isFirstOnFloor = false;

           // Update State
           orderItem.qty -= pickQty;
           currentPos = { x: chosenStock.x, y: chosenStock.y, z: chosenStock.z };

           // Decrement global enriched stock pool and local floor pool
           const realIdx = enrichedStock.indexOf(chosenStock);
           if (realIdx > -1) {
                enrichedStock[realIdx].qtyAvailable -= pickQty;
                if (enrichedStock[realIdx].qtyAvailable <= 0) {
                    enrichedStock.splice(realIdx, 1);
                }
           }
           
           // Also remove from local floorStock loop to avoid re-picking same instance if exhausted
           floorStock = floorStock.filter(s => enrichedStock.includes(s));
      }
  }

  return tasks;
};