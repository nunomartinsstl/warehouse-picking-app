import React, { useState, useEffect } from 'react';
import { CloudUpload, FileText, CheckCircle, Trash2, RefreshCw, X, Database, List, AlertTriangle } from 'lucide-react';
import { FileUpload } from './FileUpload';
import { parseExcel, processStockFile, processOrderFile } from '../utils/excelParser';
import { saveStockToCloud, createCloudOrder, fetchCompletedOrdersFromCloud, deleteOrder, fetchOpenOrdersFromCloud, fetchStockFromCloud } from '../utils/firebase';
import { CloudOrder, StockItem } from '../types';

interface ManagerDashboardProps {
    onClose: () => void;
}

export const ManagerDashboard: React.FC<ManagerDashboardProps> = ({ onClose }) => {
    const [activeTab, setActiveTab] = useState<'stock' | 'orders' | 'history'>('orders');
    const [isLoading, setIsLoading] = useState(false);
    
    // Data State
    const [openOrders, setOpenOrders] = useState<CloudOrder[]>([]);
    const [completedOrders, setCompletedOrders] = useState<CloudOrder[]>([]);
    const [currentStockCount, setCurrentStockCount] = useState<number | null>(null);

    useEffect(() => {
        loadData();
    }, [activeTab]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            if (activeTab === 'orders') {
                const data = await fetchOpenOrdersFromCloud();
                setOpenOrders(data);
            } else if (activeTab === 'history') {
                const data = await fetchCompletedOrdersFromCloud();
                setCompletedOrders(data);
            } else if (activeTab === 'stock') {
                const stock = await fetchStockFromCloud();
                setCurrentStockCount(stock.length);
            }
        } catch (e: any) {
            console.error(e);
            alert(`Erro ao carregar dados: ${e.message || e}. Verifique a configuração do Firebase.`);
        } finally {
            setIsLoading(false);
        }
    };

    // --- STOCK HANDLERS ---
    const handleStockUpload = async (file: File) => {
        if (!confirm("Isto irá substituir TODO o stock atual na Cloud. Continuar?")) return;
        setIsLoading(true);
        try {
            const raw = await parseExcel(file);
            const processed = processStockFile(raw);
            if (processed.length === 0) {
                alert("Nenhum registo de stock válido encontrado.");
                return;
            }
            await saveStockToCloud(processed);
            alert(`Stock atualizado com sucesso! ${processed.length} registos.`);
            loadData();
        } catch (e: any) {
            console.error(e);
            alert("Erro ao processar ficheiro de stock.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-[#0f131a] text-white flex flex-col z-50">
             <div className="p-4 border-b border-[#37474f] flex justify-between items-center bg-[#141923]">
                <h1 className="text-xl font-bold flex items-center gap-2"><Database className="text-[#0277bd]" /> Dashboard de Gestão</h1>
                <button onClick={onClose} className="p-2 hover:bg-[#263238] rounded-full"><X size={24} /></button>
             </div>
             
             <div className="flex border-b border-[#37474f] bg-[#1e2736]">
                <button onClick={() => setActiveTab('orders')} className={`flex-1 py-4 font-bold border-b-2 ${activeTab === 'orders' ? 'border-[#ffeb3b] text-white' : 'border-transparent text-gray-400'}`}>PEDIDOS ABERTOS</button>
                <button onClick={() => setActiveTab('stock')} className={`flex-1 py-4 font-bold border-b-2 ${activeTab === 'stock' ? 'border-[#4fc3f7] text-white' : 'border-transparent text-gray-400'}`}>STOCK</button>
                <button onClick={() => setActiveTab('history')} className={`flex-1 py-4 font-bold border-b-2 ${activeTab === 'history' ? 'border-[#00e676] text-white' : 'border-transparent text-gray-400'}`}>HISTÓRICO</button>
             </div>

             <div className="flex-1 overflow-y-auto p-6">
                {isLoading && <div className="text-center py-4"><RefreshCw className="animate-spin mx-auto text-[#4fc3f7]" /></div>}

                {activeTab === 'stock' && (
                    <div className="space-y-6 max-w-2xl mx-auto">
                         <div className="bg-[#141923] p-6 rounded-xl border border-[#37474f] text-center">
                            <h2 className="text-lg font-bold mb-2">Stock Atual na Cloud</h2>
                            <div className="text-4xl font-mono text-[#4fc3f7] font-bold">{currentStockCount ?? '-'}</div>
                            <div className="text-gray-500 text-sm mt-1">Registos</div>
                         </div>
                         
                         <div className="bg-[#141923] p-6 rounded-xl border border-[#37474f]">
                            <h3 className="font-bold mb-4 flex items-center gap-2"><CloudUpload size={20} /> Upload de Novo Stock</h3>
                            <p className="text-xs text-gray-400 mb-4 bg-yellow-500/10 border border-yellow-500/20 p-2 rounded flex items-center gap-2">
                                <AlertTriangle size={14} className="text-yellow-500" />
                                Atenção: O upload de um novo ficheiro substitui integralmente o stock existente.
                            </p>
                            <FileUpload label="Selecionar Ficheiro Excel (Stock)" status="idle" onFileSelect={handleStockUpload} />
                         </div>
                    </div>
                )}

                {activeTab === 'orders' && (
                    <div className="space-y-4">
                        {openOrders.map(o => (
                            <div key={o.id} className="bg-[#141923] p-4 rounded border border-[#37474f] flex justify-between items-center">
                                <div>
                                    <div className="font-bold">{o.name}</div>
                                    <div className="text-xs text-gray-400">{new Date(o.createdAt).toLocaleString()}</div>
                                </div>
                                <div className="text-sm font-bold text-[#ffeb3b]">{o.items.length} Itens</div>
                            </div>
                        ))}
                        {openOrders.length === 0 && <div className="text-center text-gray-500 mt-10">Sem pedidos abertos.</div>}
                    </div>
                )}

                {activeTab === 'history' && (
                    <div className="space-y-4">
                        {completedOrders.map(o => (
                            <div key={o.id} className="bg-[#141923] p-4 rounded border border-[#37474f] flex justify-between items-center opacity-75">
                                <div>
                                    <div className="font-bold">{o.name}</div>
                                    <div className="text-xs text-gray-400">Concluído: {o.completedAt ? new Date(o.completedAt).toLocaleString() : '-'}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <CheckCircle size={16} className="text-green-500" />
                                    <span className="text-xs font-bold text-green-500">CONCLUÍDO</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
             </div>
        </div>
    );
};