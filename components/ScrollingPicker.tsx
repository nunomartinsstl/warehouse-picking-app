import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { WarehouseLayout } from '../types';

interface ScrollingPickerProps {
    visualLayout: WarehouseLayout | null;
    initialBin: string;
    onBinChange: (bin: string) => void;
}

export const ScrollingPicker: React.FC<ScrollingPickerProps> = ({ visualLayout, initialBin, onBinChange }) => {
    const [selectedUnitId, setSelectedUnitId] = useState<number>(0);
    const [selectedLevel, setSelectedLevel] = useState<number>(0);
    const [selectedColumn, setSelectedColumn] = useState<number>(1);
    const [selectedDepth, setSelectedDepth] = useState<number>(1);

    // Get list of available unit IDs
    const availableUnits = useMemo(() =>
        visualLayout?.units.map(u => u.id).sort((a, b) => a - b) ?? [],
        [visualLayout]
    );

    // Parse initial bin - Only update state, DO NOT notify parent
    useEffect(() => {
        if (initialBin) {
            const parts = initialBin.split('-').map(p => parseInt(p, 10)).filter(n => !isNaN(n));
            if (parts.length >= 4) {
                setSelectedUnitId(parts[0]);
                setSelectedLevel(parts[1]);
                setSelectedColumn(parts[2]);
                setSelectedDepth(parts[3]);
            }
        } else if (availableUnits.length > 0 && selectedUnitId === 0) {
            // Initialize with first unit if empty
            setSelectedUnitId(availableUnits[0]);
        }
    }, [initialBin, availableUnits]); // Intentionally omit selectedUnitId to avoid loops

    // Get current unit configuration
    const currentUnit = useMemo(() =>
        visualLayout?.units.find(u => u.id === selectedUnitId),
        [visualLayout, selectedUnitId]
    );

    // Determine limits based on unit config
    const limits = useMemo(() => {
        if (!currentUnit) return { levels: 1, columns: 1, depths: 1 };

        const { levels, bays, bins, levelConfig } = currentUnit.params;
        let maxColumns = bays;
        let maxDepths = bins;

        // If levels are 0-indexed, we might need to adjust index access
        // Assuming levelConfig is 0-indexed array matching level numbers 0..N
        if (levelConfig?.[selectedLevel]) {
            maxColumns = levelConfig[selectedLevel].bays;
            maxDepths = levelConfig[selectedLevel].bins;
        }

        return { levels, columns: maxColumns, depths: maxDepths };
    }, [currentUnit, selectedLevel]);

    // Helper to notify parent
    const notifyChange = (u: number, l: number, c: number, d: number) => {
        const binCode = `${u}-${l}-${c}-${d}`;
        onBinChange(binCode);
    };

    // Auto-correct values if they exceed new limits
    useEffect(() => {
        let changed = false;
        let newL = selectedLevel;
        let newC = selectedColumn;
        let newD = selectedDepth;

        // Levels are 0-based now, so max level is limits.levels (assuming levels count includes 0)
        // Actually, usually 'levels' param is count. So 0 to levels-1.
        if (selectedLevel >= limits.levels) { newL = 0; changed = true; }
        if (selectedColumn > limits.columns) { newC = 1; changed = true; }
        if (selectedDepth > limits.depths) { newD = 1; changed = true; }

        if (changed) {
            setSelectedLevel(newL);
            setSelectedColumn(newC);
            setSelectedDepth(newD);
            // Only notify if we actually auto-corrected something
            notifyChange(selectedUnitId, newL, newC, newD);
        }
    }, [selectedUnitId, limits, selectedLevel, selectedColumn, selectedDepth]);

    // Handlers
    const handleUnitChange = (direction: 'up' | 'down') => {
        if (availableUnits.length === 0) return;
        const currentIndex = availableUnits.indexOf(selectedUnitId);
        let newIndex = direction === 'up' ? currentIndex + 1 : currentIndex - 1;
        if (newIndex >= availableUnits.length) newIndex = 0;
        if (newIndex < 0) newIndex = availableUnits.length - 1;
        
        const newUnit = availableUnits[newIndex];
        setSelectedUnitId(newUnit);
        notifyChange(newUnit, selectedLevel, selectedColumn, selectedDepth);
    };

    const handleValueChange = (type: 'level' | 'column' | 'depth', direction: 'up' | 'down') => {
        let val = type === 'level' ? selectedLevel : type === 'column' ? selectedColumn : selectedDepth;
        
        // Adjust max/min logic for 0-based levels
        const isLevel = type === 'level';
        const max = isLevel ? limits.levels - 1 : (type === 'column' ? limits.columns : limits.depths);
        const min = isLevel ? 0 : 1;

        let newVal = direction === 'up' ? val + 1 : val - 1;
        
        if (newVal > max) newVal = min;
        if (newVal < min) newVal = max;

        if (type === 'level') setSelectedLevel(newVal);
        if (type === 'column') setSelectedColumn(newVal);
        if (type === 'depth') setSelectedDepth(newVal);

        notifyChange(
            selectedUnitId, 
            type === 'level' ? newVal : selectedLevel,
            type === 'column' ? newVal : selectedColumn,
            type === 'depth' ? newVal : selectedDepth
        );
    };

    const PickerColumn = ({ label, value, max, type }: { label: string, value: number, max: number, type: 'level' | 'column' | 'depth' }) => (
        <div className="flex flex-col items-center bg-gray-50 dark:bg-gray-800 rounded-lg p-1 w-full">
            <span className="text-[10px] text-gray-500 uppercase font-bold mb-1">{label}</span>
            <button 
                onClick={() => handleValueChange(type, 'up')}
                className="p-1 text-gray-400 hover:text-[#4fc3f7] active:scale-95 transition-all"
            >
                <ChevronUp size={20} />
            </button>
            
            <div className="h-8 flex items-center justify-center">
                <span className="text-xl font-bold text-gray-800 dark:text-white font-mono">
                    {value}
                </span>
            </div>

            <button 
                onClick={() => handleValueChange(type, 'down')}
                className="p-1 text-gray-400 hover:text-[#4fc3f7] active:scale-95 transition-all"
            >
                <ChevronDown size={20} />
            </button>
        </div>
    );

    return (
        <div className="grid grid-cols-4 gap-2 w-full">
            {/* Unit Column */}
            <div className="flex flex-col items-center bg-gray-50 dark:bg-gray-800 rounded-lg p-1 w-full">
                <span className="text-[10px] text-gray-500 uppercase font-bold mb-1">ID Unidade</span>
                <button 
                    onClick={() => handleUnitChange('up')}
                    className="p-1 text-gray-400 hover:text-[#4fc3f7] active:scale-95 transition-all"
                >
                    <ChevronUp size={20} />
                </button>
                
                <div className="h-8 flex items-center justify-center">
                    <span className="text-xl font-bold text-gray-800 dark:text-white font-mono">
                        {selectedUnitId}
                    </span>
                </div>

                <button 
                    onClick={() => handleUnitChange('down')}
                    className="p-1 text-gray-400 hover:text-[#4fc3f7] active:scale-95 transition-all"
                >
                    <ChevronDown size={20} />
                </button>
            </div>

            <PickerColumn label="Nível" value={selectedLevel} max={limits.levels} type="level" />
            <PickerColumn label="Coluna" value={selectedColumn} max={limits.columns} type="column" />
            <PickerColumn label="Prof." value={selectedDepth} max={limits.depths} type="depth" />
        </div>
    );
};