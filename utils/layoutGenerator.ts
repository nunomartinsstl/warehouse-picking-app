import { WarehouseLayout, LayoutNode, Unit } from '../types';

export const generateLayoutCoords = (visualLayout: WarehouseLayout): Map<string, LayoutNode> => {
    const map = new Map<string, LayoutNode>();

    if (!visualLayout) return map;

    visualLayout.units.forEach(unit => {
        const { levels, bays, size } = unit.params;
        const levelConfig = unit.params.levelConfig || [];

        // Determine dimensions
        let maxBays = bays;
        let maxBins = unit.params.bins;
        
        if (levelConfig.length > 0) {
            maxBays = Math.max(...levelConfig.map(l => l.bays));
            maxBins = Math.max(...levelConfig.map(l => l.bins));
        }

        const rackWidth = maxBays * size;
        const rackHeight = levels * size;
        const rackDepth = maxBins * size;

        const halfW = rackWidth / 2;
        const halfD = rackDepth / 2;

        // Find type name
        const typeName = visualLayout.storageTypes.find(t => t.id === unit.typeId)?.name || 'Unknown';

        for (let l = 0; l < levels; l++) {
            const currentLevelConfig = levelConfig[l] || { bays: bays, bins: unit.params.bins };
            const levelBays = currentLevelConfig.bays;
            const levelBins = currentLevelConfig.bins;
            
            const bayWidth = rackWidth / levelBays;
            const binDepth = rackDepth / levelBins;

            for (let b = 0; b < levelBays; b++) {
                for (let d = 0; d < levelBins; d++) {
                    // Local Coordinates (relative to unit center)
                    const localX = -halfW + (b * bayWidth) + (bayWidth / 2);
                    const localY = (l * size) + (size / 2);
                    
                    // FLIPPED Z LOGIC: Depth 1 (d=0) is at +Z (Front), Depth Max is at -Z (Back)
                    const localZ = halfD - (d * binDepth) - (binDepth / 2);

                    // Transform to World Coordinates
                    // Rotate around Y axis
                    const cos = Math.cos(-unit.rotY); // Three.js rotation is counter-clockwise, but our data might be different. 
                    // RackUnit uses rotation={[0, -unit.rotY, 0]}. 
                    // Standard rotation matrix for Y:
                    // x' = x cos - z sin
                    // z' = x sin + z cos
                    // But RackUnit applies rotation to the group.
                    // So we need to apply the SAME rotation to our point.
                    // The group rotation is -unit.rotY.
                    const sin = Math.sin(-unit.rotY);

                    const rotatedX = localX * cos - localZ * sin;
                    const rotatedZ = localX * sin + localZ * cos;

                    const worldX = unit.posX + rotatedX;
                    const worldY = localY; // No vertical rotation
                    const worldZ = unit.posZ + rotatedZ;

                    // Bin Code: unitId-level-column-depth
                    // Levels: 0-based in loop, but usually displayed as 0-based in this app?
                    // Columns (b): 0-based in loop, displayed as 1-based.
                    // Depths (d): 0-based in loop, displayed as 1-based.
                    const binCode = `${unit.id}-${l}-${b + 1}-${d + 1}`;

                    map.set(binCode, {
                        bin: binCode,
                        x: worldX,
                        y: worldY,
                        z: worldZ,
                        type: typeName
                    });
                }
            }
        }
    });

    return map;
};
