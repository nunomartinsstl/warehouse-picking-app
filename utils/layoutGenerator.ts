import { WarehouseLayout, LayoutNode, Unit } from '../types';

export const generateLayoutCoords = (layout: WarehouseLayout): Map<string, LayoutNode> => {
    const coords = new Map<string, LayoutNode>();

    layout.units.forEach(unit => {
        const { levels, size } = unit.params;
        const levelConfig = unit.params.levelConfig || [];

        // Determine dimensions
        let maxBays = unit.params.bays;
        let maxBins = unit.params.bins;
        
        if (levelConfig.length > 0) {
            maxBays = Math.max(...levelConfig.map(l => l.bays));
            maxBins = Math.max(...levelConfig.map(l => l.bins));
        }

        const rackWidth = maxBays * size;
        const rackDepth = maxBins * size;
        
        const halfW = rackWidth / 2;
        const halfD = rackDepth / 2;

        for (let l = 0; l < levels; l++) {
            const currentLevelConfig = levelConfig[l] || { bays: unit.params.bays, bins: unit.params.bins };
            const levelBays = currentLevelConfig.bays;
            const levelBins = currentLevelConfig.bins;
            
            const bayWidth = rackWidth / levelBays;
            const binDepth = rackDepth / levelBins;

            for (let b = 0; b < levelBays; b++) {
                for (let d = 0; d < levelBins; d++) {
                    // Local coordinates (relative to unit center)
                    // Matches RackUnit logic in Scene3D.tsx
                    const localX = -halfW + (b * bayWidth) + (bayWidth/2);
                    const localY = (l * size) + (size/2);
                    // FLIPPED Z: Depth 1 (d=0) is at +Z (Front), Depth Max is at -Z (Back)
                    const localZ = halfD - (d * binDepth) - (binDepth/2);

                    // Transform to World Coordinates
                    // Rotation is around Y axis. Scene3D uses rotation={[0, -unit.rotY, 0]}
                    // So we rotate by -unit.rotY
                    const theta = -unit.rotY;
                    const cosTheta = Math.cos(theta);
                    const sinTheta = Math.sin(theta);

                    // Rotate local X and Z
                    const rotatedX = localX * cosTheta - localZ * sinTheta;
                    const rotatedZ = localX * sinTheta + localZ * cosTheta;

                    const worldX = unit.posX + rotatedX;
                    const worldY = localY; // Assuming unit is at Y=0
                    const worldZ = unit.posZ + rotatedZ;

                    // Construct bin code: unitId-level-column-depth
                    const binCode = `${unit.id}-${l}-${b+1}-${d+1}`;
                    
                    // Find type name
                    const typeDef = layout.storageTypes.find(t => t.id === unit.typeId);
                    const typeName = typeDef ? typeDef.name : 'Unknown';

                    coords.set(binCode, {
                        bin: binCode,
                        x: Number(worldX.toFixed(2)),
                        y: Number(worldY.toFixed(2)),
                        z: Number(worldZ.toFixed(2)),
                        type: typeName
                    });
                }
            }
        }
    });

    return coords;
};

export const parseUploadedLayout = (json: any): WarehouseLayout => {
    // Handle the specific JSON format provided by user
    // It has "warehouses" array. We take the first one or the one matching currentWarehouseIndex
    
    let targetWarehouse = json;

    if (json.warehouses && Array.isArray(json.warehouses)) {
        const index = json.currentWarehouseIndex || 0;
        targetWarehouse = json.warehouses[index];
    }

    // Map unitsData to units if necessary
    const units = targetWarehouse.units || targetWarehouse.unitsData || [];

    return {
        version: json.version || "8.0",
        whWidth: targetWarehouse.width || 50,
        whDepth: targetWarehouse.depth || 50,
        floors: targetWarehouse.floors || [],
        storageTypes: targetWarehouse.storageTypes || [],
        units: units,
        colors: json.colors
    };
};
