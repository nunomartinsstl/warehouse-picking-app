import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, ArrowRight, Save, Trash2, CheckCircle, X, FileText, Loader2, MapPin, Box, Crop as CropIcon, ZoomIn, ArrowLeft, History, QrCode } from 'lucide-react';
import ReactCrop, { Crop, PixelCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import { Html5Qrcode } from 'html5-qrcode';
import { StockItem, ReceiptItem, User } from '../types';
import { fetchStockFromCloud, submitReceipt, auth } from '../utils/firebase';

interface ReceiverInterfaceProps {
    onBack: () => void;
    user: User | null;
}

type Stage = 'setup' | 'cropping' | 'location_input' | 'scanning' | 'form' | 'summary';

export const ReceiverInterface: React.FC<ReceiverInterfaceProps> = ({ onBack, user }) => {
    // State
    const [stage, setStage] = useState<Stage>('setup');
    const [poNumber, setPoNumber] = useState('');
    const [documentImage, setDocumentImage] = useState<string>(''); // Base64
    const [showImagePreview, setShowImagePreview] = useState(false);
    const [tempImageSrc, setTempImageSrc] = useState<string>('');
    
    // Input State
    const [scannedBin, setScannedBin] = useState('');
    
    // Suggestion State
    const [showSuggestionModal, setShowSuggestionModal] = useState(false);
    const [suggestedMaterial, setSuggestedMaterial] = useState<string | null>(null);

    // Receipt Data
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
    const scannerRef = useRef<Html5Qrcode | null>(null);

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

    // Draft Persistence for PO (Safety against camera reload)
    useEffect(() => {
        const savedPO = localStorage.getItem('setling_draft_po');
        if (savedPO && !poNumber) setPoNumber(savedPO);
    }, []);

    useEffect(() => {
        localStorage.setItem('setling_draft_po', poNumber);
    }, [poNumber]);

    // --- IMAGE UTILS ---
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

    const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const { width, height, naturalWidth, naturalHeight } = e.currentTarget;
        const crop = centerCrop(
            makeAspectCrop(
                { unit: '%', width: 80 },
                width / height,
                width,
                height
            ),
            width,
            height
        );
        setCrop(crop);
        setCompletedCrop({
            x: (crop.x / 100) * naturalWidth,
            y: (crop.y / 100) * naturalHeight,
            width: (crop.width / 100) * naturalWidth,
            height: (crop.height / 100) * naturalHeight,
            unit: 'px'
        });
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
                const base64 = canvas.toDataURL('image/jpeg', 0.85);
                setDocumentImage(base64);
                setStage('setup');
            }
        }
    };

    // --- COMMON LOGIC: PROCESS LOCATION ---
    const processLocation = useCallback((binCode: string) => {
        const bin = binCode.trim().toUpperCase();
        setScannedBin(bin);

        const existingStock = stock.find(s => s.bin === bin);
        
        if (existingStock) {
            setSuggestedMaterial(existingStock.material);
            setShowSuggestionModal(true);
            setStage('location_input'); // Go to input view to show the modal
        } else {
            proceedToForm('');
        }
    }, [stock]);

    const proceedToForm = (material: string) => {
        setCurrentMaterial(material);
        setCurrentQty('');
        setAutocompleteOptions([]);
        setStage('form');
        setShowSuggestionModal(false);
        setSuggestedMaterial(null);
    };

    // --- SCANNER LOGIC ---
    useEffect(() => {
        if (stage === 'scanning') {
            const startScanner = async () => {
                // Short delay to ensure DOM element exists
                await new Promise(r => setTimeout(r, 100));
                
                try {
                    // Cleanup old instance if it exists (safety check)
                    if (scannerRef.current) {
                        try {
                            await scannerRef.current.stop();
                        } catch (err) {
                            console.warn("Previous scanner stop failed", err);
                        }
                        try { scannerRef.current.clear(); } catch(e) {}
                        scannerRef.current = null;
                    }

                    const html5QrCode = new Html5Qrcode("reader");
                    scannerRef.current = html5QrCode;

                    await html5QrCode.start(
                        { facingMode: "environment" },
                        { 
                            fps: 10, 
                            qrbox: { width: 250, height: 250 },
                            aspectRatio: 1.0
                        },
                        (decodedText) => {
                            // On Success
                            // Detach from ref to prevent cleanup from running simultaneously
                            scannerRef.current = null;
                            
                            html5QrCode.stop().then(() => {
                                try { html5QrCode.clear(); } catch(e) {}
                                processLocation(decodedText);
                            }).catch(err => {
                                console.error("Failed to stop scanner on success", err);
                                // Force proceed anyway
                                processLocation(decodedText);
                            });
                        },
                        (errorMessage) => {
                            // ignore frame errors
                        }
                    );
                } catch (err) {
                    console.error("Error starting scanner:", err);
                    if (stage === 'scanning') {
                        alert("Erro ao iniciar câmara. Verifique as permissões.");
                        setStage('location_input');
                    }
                }
            };

            startScanner();
        }

        // Cleanup function when component unmounts or stage changes
        return () => {
            if (scannerRef.current) {
                const scannerInstance = scannerRef.current;
                scannerRef.current = null; // Mark as handled so we don't double-stop
                
                scannerInstance.stop().catch(err => {
                    console.warn("Scanner stop cleanup warning:", err);
                }).finally(() => {
                    try { scannerInstance.clear(); } catch(e) {}
                });
            }
        };
    }, [stage, processLocation]);

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
            setStage('location_input');
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
        
        // Use username if available, otherwise email, otherwise uid, otherwise 'unknown'
        const userIdToSubmit = user?.username || user?.email || auth.currentUser?.uid || 'unknown';

        setIsSaving(true);
        try {
            await submitReceipt({
                poNumber: poNumber || 'N/A',
                documentImage,
                items: scannedItems,
                date: new Date().toISOString(),
                userId: userIdToSubmit
            });
            
            alert("Receção registada com sucesso!");
            
            // Reset
            setScannedItems([]);
            setPoNumber('');
            localStorage.removeItem('setling_draft_po');
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

    // IMAGE PREVIEW MODAL
    const ImagePreviewModal = () => (
        <div 
            className="absolute inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-4 animate-in fade-in duration-200"
            onClick={() => setShowImagePreview(false)}
        >
            <button 
                onClick={(e) => { e.stopPropagation(); setShowImagePreview(false); }}
                className="absolute top-4 right-4 bg-gray-800/80 text-white p-2 rounded-full backdrop-blur-sm z-50"
            >
                <X size={24} />
            </button>
            
            <div className="flex-1 flex items-center justify-center w-full overflow-hidden p-2" onClick={(e) => e.stopPropagation()}>
                <img 
                    src={documentImage} 
                    alt="Document Full" 
                    className="max-w-full max-h-full object-contain shadow-2xl rounded-lg" 
                />
            </div>

            <button 
                onClick={(e) => { e.stopPropagation(); setShowImagePreview(false); }}
                className="mt-4 bg-white text-black px-8 py-3 rounded-full font-bold flex items-center gap-2 hover:bg-gray-200 transition-colors shadow-lg z-50"
            >
                <ArrowLeft size={20} /> Voltar
            </button>
        </div>
    );

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
            <div className="flex flex-col h-full bg-gray-900 text-white p-6 overflow-y-auto relative">
                {showImagePreview && <ImagePreviewModal />}

                <button onClick={onBack} className="text-gray-400 flex items-center gap-2 mb-6 font-bold hover:text-white transition-colors">
                    <X size={20} /> Cancelar Entrada
                </button>

                <h1 className="text-2xl font-bold mb-6 text-[#4fc3f7] flex items-center gap-2">
                    <FileText /> Entrada de Material
                </h1>

                <div className="space-y-6 max-w-md mx-auto w-full">
                    <div>
                        <label className="block text-gray-400 text-xs uppercase font-bold mb-2">Pedido de Compra <span className="text-red-500">*</span></label>
                        <input 
                            type="text" 
                            value={poNumber}
                            onChange={(e) => setPoNumber(e.target.value)}
                            placeholder="Ex: PO-2023-999"
                            className={`w-full bg-gray-800 border rounded-xl p-4 text-white placeholder-gray-600 focus:outline-none transition-colors ${!poNumber && documentImage ? 'border-red-500/50' : 'border-gray-700 focus:border-[#4fc3f7]'}`}
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
                            <div className="relative rounded-xl overflow-hidden border border-gray-700 group cursor-pointer" onClick={() => setShowImagePreview(true)}>
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all z-10 flex items-center justify-center">
                                    <ZoomIn className="text-white opacity-0 group-hover:opacity-100 transform scale-75 group-hover:scale-100 transition-all" size={32} />
                                </div>
                                <img src={documentImage} alt="Doc" className="w-full h-auto object-cover max-h-60" />
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setDocumentImage(''); }}
                                    className="absolute top-2 right-2 bg-red-500/80 text-white p-2 rounded-full z-20 hover:bg-red-500 transition-colors"
                                >
                                    <Trash2 size={16} />
                                </button>
                                <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-2 text-center text-xs text-[#00e676] font-bold z-10">
                                    <CheckCircle size={12} className="inline mr-1" /> Imagem Processada (Toque para ver)
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="pt-6">
                        <button 
                            disabled={!documentImage || !poNumber.trim()}
                            onClick={() => { setStage('location_input'); }}
                            className="w-full bg-[#00e676] hover:bg-[#00c853] text-black font-bold py-4 rounded-xl flex justify-center items-center gap-2 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Box size={20} /> Arrumar Materiais
                        </button>
                        {(!documentImage || !poNumber.trim()) && (
                            <p className="text-center text-xs text-gray-500 mt-2">
                                {!poNumber.trim() ? "Preencha o Nº do Pedido de Compra." : "Digitalize o documento para continuar."}
                            </p>
                        )}
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
                        onClick={() => setStage('location_input')}
                        className="absolute top-4 right-4 z-20 bg-gray-800/80 text-white p-2 rounded-full backdrop-blur-sm"
                    >
                        <X size={24} />
                    </button>
                    
                    <div className="w-full max-w-md bg-black rounded-xl overflow-hidden relative border border-gray-700 shadow-2xl">
                        {/* Camera Container */}
                        <div id="reader" className="w-full aspect-square bg-black overflow-hidden relative">
                            {/* Overlay */}
                            <div className="absolute inset-0 border-2 border-[#4fc3f7]/30 pointer-events-none z-10 flex items-center justify-center">
                                <div className="w-64 h-64 border-2 border-[#4fc3f7] rounded-lg opacity-50 relative">
                                    <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-[#4fc3f7] -mt-1 -ml-1"></div>
                                    <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-[#4fc3f7] -mt-1 -mr-1"></div>
                                    <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-[#4fc3f7] -mb-1 -ml-1"></div>
                                    <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-[#4fc3f7] -mb-1 -mr-1"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <p className="text-white mt-4 font-bold animate-pulse">Aponte para o código QR da posição</p>
                </div>
            </div>
        );
    }

    if (stage === 'location_input') {
        return (
            <div className="flex flex-col h-full bg-gray-900 text-white p-6 relative">
                <button 
                    onClick={() => setStage('summary')} // Shortcut to finish
                    className="absolute top-4 right-4 z-20 text-gray-400 hover:text-white"
                >
                    <X size={24} />
                </button>

                <div className="flex-1 flex flex-col justify-center items-center max-w-md mx-auto w-full">
                    <div className="bg-gray-800 p-4 rounded-full mb-6 border border-gray-700">
                        <MapPin size={48} className="text-[#4fc3f7]" />
                    </div>
                    
                    <h2 className="text-2xl font-bold mb-4 text-center">Indique a Posição</h2>
                    <p className="text-gray-400 text-center mb-8 px-4">
                        Digitalize o código QR da localização onde vai colocar o material.
                    </p>

                    <button 
                        onClick={() => setStage('scanning')}
                        className="w-full bg-[#4fc3f7] hover:bg-[#29b6f6] text-black font-bold py-6 rounded-xl flex justify-center items-center gap-3 transition-all shadow-lg text-lg"
                    >
                        <QrCode size={28} /> Ler Código QR
                    </button>
                </div>

                {/* SUGGESTION MODAL OVERLAY */}
                {showSuggestionModal && (
                    <div className="absolute inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-6">
                        <div className="bg-white dark:bg-[#141923] border border-gray-200 dark:border-[#37474f] rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
                            <div className="flex items-center gap-2 mb-4 text-[#4fc3f7]">
                                <History size={24} />
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Material Encontrado</h3>
                            </div>
                            
                            <p className="text-gray-600 dark:text-gray-300 text-sm mb-4">
                                O histórico indica que esta posição contém:
                            </p>
                            
                            <div className="bg-gray-100 dark:bg-[#0f131a] p-4 rounded-xl border border-gray-200 dark:border-[#37474f] mb-6 text-center shadow-inner">
                                <span className="text-xl font-bold text-gray-900 dark:text-white break-all">{suggestedMaterial}</span>
                            </div>
                            
                            <div className="flex gap-3">
                                <button 
                                    onClick={() => proceedToForm('')}
                                    className="flex-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-white py-3 rounded-xl font-bold transition-colors"
                                >
                                    Não, é outro
                                </button>
                                <button 
                                    onClick={() => proceedToForm(suggestedMaterial || '')}
                                    className="flex-1 bg-[#4fc3f7] hover:bg-[#29b6f6] text-black py-3 rounded-xl font-bold transition-colors shadow-lg"
                                >
                                    Sim, usar
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    if (stage === 'form') {
        return (
            <div className="flex flex-col h-full bg-gray-900 text-white p-6 overflow-y-auto">
                <div className="max-w-md mx-auto w-full space-y-6">
                    <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex items-center justify-between shadow-lg">
                        <div>
                            <div className="text-xs text-gray-500 uppercase font-bold">A Arrumar em:</div>
                            <div className="text-2xl font-mono text-[#4fc3f7] font-bold mt-1">{scannedBin}</div>
                        </div>
                        <button onClick={() => setStage('location_input')} className="text-gray-500 hover:text-white p-2">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="space-y-1 relative">
                        <label className="text-xs text-gray-500 uppercase font-bold ml-1">Material</label>
                        <input 
                            type="text" 
                            value={currentMaterial}
                            onChange={(e) => handleMaterialChange(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl p-4 text-white font-bold text-lg focus:border-[#4fc3f7] focus:outline-none transition-colors"
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
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl p-4 text-white text-3xl font-bold text-center focus:border-[#00e676] focus:outline-none transition-colors"
                            placeholder="0"
                        />
                    </div>

                    <div className="pt-4 flex gap-3">
                        <button 
                            onClick={() => handleSaveItem('continue')}
                            className="flex-1 bg-[#4fc3f7] hover:bg-[#29b6f6] text-black font-bold py-4 rounded-xl flex justify-center items-center gap-2 shadow-lg"
                        >
                            <ArrowRight size={20} /> Próximo
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
                
                <div className="flex-1 overflow-y-auto bg-gray-800 rounded-xl border border-gray-700 p-2 mb-4 shadow-inner">
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
                        onClick={() => { setStage('location_input'); }}
                        className="w-full bg-gray-800 hover:bg-gray-700 border border-dashed border-gray-600 text-gray-300 py-3 rounded-xl flex justify-center items-center gap-2 transition-colors"
                    >
                        <Box size={18} /> Adicionar Mais Itens
                    </button>

                    <div className="flex gap-3">
                        <button 
                            onClick={() => { if(confirm("Cancelar entrada?")) { setStage('setup'); setScannedItems([]); } }}
                            className="flex-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-900/50 py-4 rounded-xl font-bold transition-colors"
                        >
                            Cancelar
                        </button>
                        <button 
                            onClick={handleFinalConfirm}
                            disabled={isSaving || scannedItems.length === 0}
                            className="flex-1 bg-[#00e676] hover:bg-[#00c853] text-black font-bold py-4 rounded-xl flex justify-center items-center gap-2 shadow-lg disabled:opacity-50 transition-all"
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