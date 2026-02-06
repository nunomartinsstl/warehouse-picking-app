import React, { useState, useRef, useEffect } from 'react';
import { Camera, QrCode, ArrowRight, Save, Trash2, CheckCircle, X, FileText, AlertTriangle, Loader2, MapPin, Box, Crop as CropIcon } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import ReactCrop, { Crop, PixelCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import { StockItem, ReceiptItem } from '../types';
import { fetchStockFromCloud, submitReceipt, auth } from '../utils/firebase';

interface ReceiverInterfaceProps {
    onBack: () => void;
}

type Stage = 'setup' | 'cropping' | 'scanning' | 'form' | 'summary';

export const ReceiverInterface: React.FC<ReceiverInterfaceProps> = ({ onBack }) => {
    // State
    const [stage, setStage] = useState<Stage>('setup');
    const [poNumber, setPoNumber] = useState('');
    const [documentImage, setDocumentImage] = useState<string>(''); // Base64
    const [tempImageSrc, setTempImageSrc] = useState<string>('');
    const [scannedBin, setScannedBin] = useState('');
    const [scannedItems, setScannedItems] = useState<ReceiptItem[]>([]);
    
    // Crop State
    const [crop, setCrop] = useState<Crop>();
    const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
    const imgRef = useRef<HTMLImageElement>(null);
    
    // Form State
    const [currentMaterial, setCurrentMaterial] = useState('');
    const [currentQty, setCurrentQty] = useState<number | ''>('');
    const [autocompleteOptions, setAutocompleteOptions] = useState<string[]>([]);
    
    // Data State
    const [stock, setStock] = useState<StockItem[]>([]);
    const [allMaterials, setAllMaterials] = useState<string[]>([]);
    
    // UI State
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    
    const fileInputRef = useRef<HTMLInputElement>(null);
    const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

    // Initial Load
    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            try {
                const data = await fetchStockFromCloud();
                setStock(data);
                // Extract unique materials for autocomplete
                const materials = Array.from(new Set(data.map(s => s.material))).sort();
                setAllMaterials(materials);
            } catch (e) {
                console.error("Failed to load stock data", e);
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, []);

    // --- UTILS ---
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.addEventListener('load', () => {
                setTempImageSrc(reader.result?.toString() || '');
                setStage('cropping');
            });
            reader.readAsDataURL(file);
        }
    };

    // Auto Detect Edges logic
    const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const { width, height, naturalWidth, naturalHeight } = e.currentTarget;
        
        // Simple heuristic: 10% margin, or try to find content
        // For accurate edge detection, we'd need a canvas pass
        const cropWidth = 80; // Default 80%
        const cropHeight = 80; 
        
        // Try simple smart detection using canvas
        const autoCrop = detectContent(e.currentTarget);
        
        if (autoCrop) {
            setCrop(autoCrop);
            setCompletedCrop({
                x: (autoCrop.x / 100) * naturalWidth,
                y: (autoCrop.y / 100) * naturalHeight,
                width: (autoCrop.width / 100) * naturalWidth,
                height: (autoCrop.height / 100) * naturalHeight,
                unit: 'px'
            });
        } else {
            // Fallback center
            const crop = centerCrop(
                makeAspectCrop(
                    {
                        unit: '%',
                        width: 80,
                    },
                    width / height,
                    width,
                    height
                ),
                width,
                height
            );
            setCrop(crop);
        }
    };

    const detectContent = (img: HTMLImageElement): Crop | null => {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 100; // Small scale for speed
            canvas.height = 100 * (img.naturalHeight / img.naturalWidth);
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            // Analyze rows and cols for "content" (variance from corner color)
            // Assumes document is lighter/different than background or background is uniform
            
            // Simplify: Just return null to use center crop for now if complex detection is risky
            // Or implement a safe margin
            return {
                unit: '%',
                x: 10,
                y: 10,
                width: 80,
                height: 80
            };
        } catch (e) {
            return null;
        }
    };

    const applySharpen = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
        // Convolution kernel for sharpening
        // [ 0, -1,  0]
        // [-1,  5, -1]
        // [ 0, -1,  0]
        const weights = [0, -1, 0, -1, 5, -1, 0, -1, 0];
        const side = Math.round(Math.sqrt(weights.length));
        const halfSide = Math.floor(side / 2);
        
        const srcData = ctx.getImageData(0, 0, w, h);
        const dstData = ctx.createImageData(w, h);
        
        const src = srcData.data;
        const dst = dstData.data;
        
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const dstOff = (y * w + x) * 4;
                let r = 0, g = 0, b = 0;
                
                for (let cy = 0; cy < side; cy++) {
                    for (let cx = 0; cx < side; cx++) {
                        const scy = Math.min(h - 1, Math.max(0, y + cy - halfSide));
                        const scx = Math.min(w - 1, Math.max(0, x + cx - halfSide));
                        const srcOff = (scy * w + scx) * 4;
                        const wt = weights[cy * side + cx];
                        
                        r += src[srcOff] * wt;
                        g += src[srcOff + 1] * wt;
                        b += src[srcOff + 2] * wt;
                    }
                }
                
                dst[dstOff] = r;
                dst[dstOff + 1] = g;
                dst[dstOff + 2] = b;
                dst[dstOff + 3] = 255; // Alpha
            }
        }
        
        ctx.putImageData(dstData, 0, 0);
    };

    const confirmCrop = async () => {
        if (completedCrop && imgRef.current) {
            const image = imgRef.current;
            const canvas = document.createElement('canvas');
            const scaleX = image.naturalWidth / image.width;
            const scaleY = image.naturalHeight / image.height;
            
            canvas.width = completedCrop.width * scaleX;
            canvas.height = completedCrop.height * scaleY;
            
            const ctx = canvas.getContext('2d');
            if (ctx) {
                // 1. Draw Cropped Image
                ctx.drawImage(
                    image,
                    completedCrop.x * scaleX,
                    completedCrop.y * scaleY,
                    completedCrop.width * scaleX,
                    completedCrop.height * scaleY,
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );
                
                // 2. Apply Sharpening
                try {
                    applySharpen(ctx, canvas.width, canvas.height);
                } catch (e) {
                    console.warn("Sharpening failed", e);
                }

                // 3. Compress and Save
                const base64 = canvas.toDataURL('image/jpeg', 0.85);
                setDocumentImage(base64);
                setStage('setup');
            }
        }
    };

    // --- STAGE 2: SCANNER ---
    useEffect(() => {
        if (stage === 'scanning') {
            const startScanner = async () => {
                try {
                    await new Promise(r => setTimeout(r, 100)); // DOM wait
                    
                    if (html5QrCodeRef.current) {
                        await html5QrCodeRef.current.stop().catch(() => {});
                        html5QrCodeRef.current.clear();
                    }

                    const html5QrCode = new Html5Qrcode("reader");
                    html5QrCodeRef.current = html5QrCode;

                    await html5QrCode.start(
                        { facingMode: "environment" },
                        { fps: 10, qrbox: { width: 250, height: 250 } },
                        (decodedText) => {
                            handleScanSuccess(decodedText);
                        },
                        () => {}
                    );
                } catch (err) {
                    console.error(err);
                    alert("Erro ao iniciar câmara.");
                    setStage('setup');
                }
            };
            startScanner();
        }

        return () => {
            if (html5QrCodeRef.current && stage !== 'scanning') {
                html5QrCodeRef.current.stop().catch(console.error).finally(() => {
                    html5QrCodeRef.current?.clear();
                    html5QrCodeRef.current = null;
                });
            }
        };
    }, [stage]);

    const handleScanSuccess = (decodedText: string) => {
        if (html5QrCodeRef.current) {
            html5QrCodeRef.current.pause(true);
        }
        
        const bin = decodedText.trim().toUpperCase();
        setScannedBin(bin);
        
        // Suggest Material based on Bin History (Current Stock)
        const existingStock = stock.find(s => s.bin === bin);
        if (existingStock) {
            setCurrentMaterial(existingStock.material);
        } else {
            setCurrentMaterial('');
        }
        
        setCurrentQty('');
        setAutocompleteOptions([]);
        setStage('form');
    };

    // --- FORM HANDLERS ---
    const handleMaterialChange = (value: string) => {
        setCurrentMaterial(value);
        if (value.length > 0) {
            const matches = allMaterials.filter(m => m.toLowerCase().includes(value.toLowerCase())).slice(0, 5);
            setAutocompleteOptions(matches);
        } else {
            setAutocompleteOptions([]);
        }
    };

    const handleSaveItem = (action: 'continue' | 'finish') => {
        if (!currentMaterial || !currentQty) {
            alert("Preencha o material e a quantidade.");
            return;
        }
        
        const newItem: ReceiptItem = {
            id: Date.now().toString(),
            bin: scannedBin,
            material: currentMaterial.toUpperCase(),
            qty: Number(currentQty)
        };
        
        setScannedItems([...scannedItems, newItem]);
        setCurrentMaterial('');
        setCurrentQty('');
        setAutocompleteOptions([]);
        
        if (action === 'continue') {
            setStage('scanning');
        } else {
            setStage('summary');
        }
    };

    const handleUpdateItem = (id: string, field: 'material' | 'qty', value: string) => {
        setScannedItems(scannedItems.map(item => {
            if (item.id === id) {
                return { ...item, [field]: field === 'qty' ? Number(value) : value };
            }
            return item;
        }));
    };

    const handleDeleteItem = (id: string) => {
        if (confirm("Tem a certeza que deseja remover este item?")) {
            setScannedItems(scannedItems.filter(item => item.id !== id));
        }
    };

    const handleFinalConfirm = async () => {
        if (scannedItems.length === 0) return;
        
        setIsSaving(true);
        try {
            await submitReceipt({
                poNumber: poNumber || 'N/A',
                documentImage,
                items: scannedItems,
                date: new Date().toISOString(),
                userId: auth.currentUser?.uid || 'unknown'
            });
            
            alert("Receção registada com sucesso!");
            
            // Reset
            setScannedItems([]);
            setPoNumber('');
            setDocumentImage('');
            setStage('setup');
        } catch (error) {
            console.error("Error submitting receipt:", error);
            alert("Erro ao registar receção. Tente novamente.");
        } finally {
            setIsSaving(false);
        }
    };

    // --- RENDER ---

    if (stage === 'cropping') {
        return (
            <div className="flex flex-col h-full bg-black text-white p-4">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold flex items-center gap-2"><CropIcon /> Ajustar Documento</h2>
                    <button onClick={() => setStage('setup')} className="bg-gray-800 p-2 rounded-full"><X /></button>
                </div>
                
                <div className="flex-1 flex items-center justify-center bg-gray-900 overflow-hidden rounded-lg border border-gray-700 relative">
                    <ReactCrop 
                        crop={crop} 
                        onChange={c => setCrop(c)} 
                        onComplete={c => setCompletedCrop(c)}
                        className="max-h-full"
                    >
                        <img 
                            ref={imgRef} 
                            src={tempImageSrc} 
                            onLoad={onImageLoad}
                            alt="Crop target" 
                            className="max-h-[70vh] w-auto object-contain"
                        />
                    </ReactCrop>
                </div>

                <div className="mt-4">
                    <button 
                        onClick={confirmCrop}
                        className="w-full bg-[#00e676] hover:bg-[#00c853] text-black font-bold py-4 rounded-xl flex justify-center items-center gap-2 transition-all shadow-lg"
                    >
                        <CheckCircle size={20} /> Confirmar & Melhorar Texto
                    </button>
                </div>
            </div>
        );
    }

    if (stage === 'setup') {
        return (
            <div className="flex flex-col h-full bg-gray-900 text-white p-6 overflow-y-auto">
                <button onClick={onBack} className="text-gray-400 flex items-center gap-2 mb-6 font-bold hover:text-white transition-colors">
                    <X size={20} /> Cancelar Entrada
                </button>

                <h1 className="text-2xl font-bold mb-6 text-[#4fc3f7] flex items-center gap-2">
                    <FileText /> Entrada de Material
                </h1>

                <div className="space-y-6 max-w-md mx-auto w-full">
                    <div>
                        <label className="block text-gray-400 text-xs uppercase font-bold mb-2">Pedido de Compra (Opcional)</label>
                        <input 
                            type="text" 
                            value={poNumber}
                            onChange={(e) => setPoNumber(e.target.value)}
                            placeholder="Ex: PO-2023-999"
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl p-4 text-white placeholder-gray-600 focus:border-[#4fc3f7] focus:outline-none transition-colors"
                        />
                    </div>

                    <div>
                        <label className="block text-gray-400 text-xs uppercase font-bold mb-2">Documento</label>
                        
                        <input 
                            type="file" 
                            accept="image/*" 
                            capture="environment" // Forces native camera
                            ref={fileInputRef} 
                            onChange={handleFileChange}
                            className="hidden" 
                        />
                        
                        {!documentImage ? (
                            <button 
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full h-40 border-2 border-dashed border-gray-700 rounded-xl flex flex-col items-center justify-center text-gray-500 hover:border-[#4fc3f7] hover:text-[#4fc3f7] transition-all bg-gray-800/50"
                            >
                                {isLoading ? <Loader2 className="animate-spin mb-2" /> : <Camera className="mb-2 w-8 h-8" />}
                                <span className="font-bold text-sm">Digitalizar Documento</span>
                                <span className="text-xs mt-1 opacity-70">Toque para abrir a câmara</span>
                            </button>
                        ) : (
                            <div className="relative rounded-xl overflow-hidden border border-gray-700">
                                <img src={documentImage} alt="Doc" className="w-full h-auto object-cover max-h-60" />
                                <button 
                                    onClick={() => setDocumentImage('')}
                                    className="absolute top-2 right-2 bg-red-500/80 text-white p-2 rounded-full"
                                >
                                    <Trash2 size={16} />
                                </button>
                                <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-2 text-center text-xs text-[#00e676] font-bold">
                                    <CheckCircle size={12} className="inline mr-1" /> Imagem Processada
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="pt-6">
                        <button 
                            disabled={!documentImage}
                            onClick={() => setStage('scanning')}
                            className="w-full bg-[#00e676] hover:bg-[#00c853] text-black font-bold py-4 rounded-xl flex justify-center items-center gap-2 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Box size={20} /> Arrumar Materiais
                        </button>
                        {!documentImage && <p className="text-center text-xs text-gray-500 mt-2">Digitalize o documento para continuar.</p>}
                    </div>
                </div>
            </div>
        );
    }

    if (stage === 'scanning') {
        return (
            <div className="flex flex-col h-full bg-black">
                <div className="relative flex-1 flex flex-col justify-center items-center">
                    <button 
                        onClick={() => setStage('summary')} // Shortcut to finish if scan fails or done
                        className="absolute top-4 right-4 z-20 bg-gray-800/80 text-white p-2 rounded-full backdrop-blur-sm"
                    >
                        <X size={24} />
                    </button>
                    
                    <div id="reader" className="w-full max-w-md aspect-square bg-black overflow-hidden relative border border-gray-700">
                        {/* Overlay */}
                        <div className="absolute inset-0 border-2 border-[#4fc3f7]/30 pointer-events-none z-10 flex items-center justify-center">
                            <div className="w-64 h-64 border-2 border-[#4fc3f7] rounded-lg opacity-50"></div>
                        </div>
                    </div>
                    
                    <p className="text-white mt-4 font-bold animate-pulse">Leia o código da posição (Lote/Bin)</p>
                </div>
            </div>
        );
    }

    if (stage === 'form') {
        return (
            <div className="flex flex-col h-full bg-gray-900 text-white p-6 overflow-y-auto">
                <div className="max-w-md mx-auto w-full space-y-6">
                    <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex items-center justify-between">
                        <div>
                            <div className="text-xs text-gray-500 uppercase font-bold">Localização</div>
                            <div className="text-xl font-mono text-[#4fc3f7] font-bold">{scannedBin}</div>
                        </div>
                        <MapPin className="text-gray-600" />
                    </div>

                    <div className="space-y-1 relative">
                        <label className="text-xs text-gray-500 uppercase font-bold ml-1">Material</label>
                        <input 
                            type="text" 
                            value={currentMaterial}
                            onChange={(e) => handleMaterialChange(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl p-4 text-white font-bold focus:border-[#4fc3f7] focus:outline-none"
                            placeholder="SKU / Ref"
                            autoFocus
                        />
                        {/* Autocomplete Dropdown */}
                        {autocompleteOptions.length > 0 && (
                            <div className="absolute left-0 right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-20 max-h-40 overflow-y-auto">
                                {autocompleteOptions.map((opt, idx) => (
                                    <div 
                                        key={idx} 
                                        onClick={() => { setCurrentMaterial(opt); setAutocompleteOptions([]); }}
                                        className="p-3 hover:bg-gray-700 cursor-pointer border-b border-gray-700 last:border-0"
                                    >
                                        {opt}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs text-gray-500 uppercase font-bold ml-1">Quantidade</label>
                        <input 
                            type="number" 
                            value={currentQty}
                            onChange={(e) => setCurrentQty(Number(e.target.value))}
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl p-4 text-white text-3xl font-bold text-center focus:border-[#00e676] focus:outline-none"
                            placeholder="0"
                        />
                    </div>

                    <div className="pt-4 flex gap-3">
                        <button 
                            onClick={() => handleSaveItem('continue')}
                            className="flex-1 bg-[#4fc3f7] hover:bg-[#29b6f6] text-black font-bold py-4 rounded-xl flex justify-center items-center gap-2"
                        >
                            <QrCode size={20} /> Continuar
                        </button>
                        <button 
                            onClick={() => handleSaveItem('finish')}
                            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-4 rounded-xl flex justify-center items-center gap-2 border border-gray-600"
                        >
                            <CheckCircle size={20} /> Finalizar
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (stage === 'summary') {
        return (
            <div className="flex flex-col h-full bg-gray-900 text-white p-4">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <FileText className="text-[#00e676]" /> Resumo da Entrada
                </h2>
                
                <div className="flex-1 overflow-y-auto bg-gray-800 rounded-xl border border-gray-700 p-2 mb-4">
                    {scannedItems.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-gray-500">Nenhum item registado.</div>
                    ) : (
                        <table className="w-full text-left text-sm">
                            <thead className="text-gray-500 uppercase font-bold border-b border-gray-700">
                                <tr>
                                    <th className="p-2">Posição</th>
                                    <th className="p-2">Material</th>
                                    <th className="p-2 text-center">Qtd</th>
                                    <th className="p-2"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                                {scannedItems.map((item) => (
                                    <tr key={item.id} className="hover:bg-gray-700/30">
                                        <td className="p-2 font-mono text-[#4fc3f7] text-xs">{item.bin}</td>
                                        <td className="p-2">
                                            <input 
                                                className="bg-transparent border-b border-gray-600 w-full focus:outline-none focus:border-[#4fc3f7]"
                                                value={item.material}
                                                onChange={(e) => handleUpdateItem(item.id, 'material', e.target.value)}
                                            />
                                        </td>
                                        <td className="p-2">
                                            <input 
                                                type="number"
                                                className="bg-transparent border-b border-gray-600 w-16 text-center focus:outline-none focus:border-[#00e676]"
                                                value={item.qty}
                                                onChange={(e) => handleUpdateItem(item.id, 'qty', e.target.value)}
                                            />
                                        </td>
                                        <td className="p-2 text-right">
                                            <button onClick={() => handleDeleteItem(item.id)} className="text-red-400 p-1">
                                                <Trash2 size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="space-y-3">
                    <button 
                        onClick={() => setStage('scanning')}
                        className="w-full bg-gray-800 hover:bg-gray-700 border border-dashed border-gray-600 text-gray-300 py-3 rounded-xl flex justify-center items-center gap-2"
                    >
                        <QrCode size={18} /> Adicionar Mais Itens
                    </button>

                    <div className="flex gap-3">
                        <button 
                            onClick={() => { if(confirm("Cancelar entrada?")) { setStage('setup'); setScannedItems([]); } }}
                            className="flex-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-900/50 py-4 rounded-xl font-bold"
                        >
                            Cancelar
                        </button>
                        <button 
                            onClick={handleFinalConfirm}
                            disabled={isSaving || scannedItems.length === 0}
                            className="flex-1 bg-[#00e676] hover:bg-[#00c853] text-black font-bold py-4 rounded-xl flex justify-center items-center gap-2 shadow-lg disabled:opacity-50"
                        >
                            {isSaving ? <Loader2 className="animate-spin" /> : <Save size={20} />} 
                            Confirmar
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return null;
};