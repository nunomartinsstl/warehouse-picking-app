
import React, { useState, useEffect } from 'react';
import { CloudUpload, FileText, CheckCircle, Trash2, RefreshCw, X, Database, List } from 'lucide-react';
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
        setIsLoading(false);
    };

    // --- STOCK HANDLERS ---
    const handleStockUpload = async (file: File) => {
        if (!confirm("Isto irá substituir TODO o stock atual na Cloud. Continuar?")) return;
        setIsLoading(true);
        try {
            const raw = await parseExcel(file);
            const processed = processStockFile(raw);
            if (processed.length === 0) throw new Error("Ficheiro inválido ou vazio");
            
            await saveStockToCloud(processed);
            alert(`Sucesso! ${processed.length} itens de stock atualizados.`);
            setCurrentStockCount(processed.length);
        } catch (e) {
            alert("Erro ao atualizar stock: " + e);
        } finally {
            setIsLoading(false);
        }
    };

    // --- ORDER HANDLERS ---
    const handleOrderUpload = async (file: File) => {
        setIsLoading(true);
        try {
            const name = file.name.replace(/\.[^/.]+$/, "");
            const raw = await parseExcel(file);
            const processed = processOrderFile(raw);
            if (processed.length === 0) throw new Error("Ficheiro sem itens válidos");

            await createCloudOrder(name, processed);
            alert("Encomenda criada com sucesso!");
            loadData(); // Refresh list
        } catch (e) {
            alert("Erro ao criar encomenda: " + e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteOrder = async (id: string) => {
        if (!confirm("Tem a certeza que deseja apagar esta encomenda?")) return;
        setIsLoading(true);
        await deleteOrder(id);
        loadData();
        setIsLoading(false);
    };

    return (
        <div className="absolute inset-0 z-50 bg-[#0f131a] flex flex-col text-white animate-fade-in">
            {/* Header */}
            <div className="bg-[#141923] border-b border-[#37474f] p-4 flex justify-between items-center shadow-lg">
                <div className="flex items-center gap-3">
                    <div className="bg-[#0277bd] p-2 rounded-lg"><Database size={24} /></div>
                    <div>
                        <h1 className="text-xl font-bold text-white">Plataforma de Gestão</h1>
                        <p className="text-xs text-gray-400">Administrador</p>
                    </div>
                </div>
                <button onClick={onClose} className="bg-[#263238] hover:bg-[#37474f] p-2 rounded-full transition-colors">
                    <X size={24} />
                </button>
            </div>

            {/* Navigation */}
            <div className="flex border-b border-[#37474f] bg-[#1e2736]">
                <button onClick={() => setActiveTab('orders')} className={`flex-1 py-4 font-bold text-sm flex items-center justify-center gap-2 border-b-2 transition-colors ${activeTab === 'orders' ? 'border-[#4fc3f7] text-white bg-[#263238]' : 'border-transparent text-gray-400 hover:bg-[#263238]'}`}>
                    <List size={18} /> PEDIDOS ABERTOS
                </button>
                <button onClick={() => setActiveTab('stock')} className={`flex-1 py-4 font-bold text-sm flex items-center justify-center gap-2 border-b-2 transition-colors ${activeTab === 'stock' ? 'border-[#4fc3f7] text-white bg-[#263238]' : 'border-transparent text-gray-400 hover:bg-[#263238]'}`}>
                    <CloudUpload size={18} /> STOCK
                </button>
                <button onClick={() => setActiveTab('history')} className={`flex-1 py-4 font-bold text-sm flex items-center justify-center gap-2 border-b-2 transition-colors ${activeTab === 'history' ? 'border-[#4fc3f7] text-white bg-[#263238]' : 'border-transparent text-gray-400 hover:bg-[#263238]'}`}>
                    <CheckCircle size={18} /> HISTÓRICO
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 bg-[#0f131a]">
                
                {isLoading && (
                    <div className="flex justify-center items-center py-8">
                        <RefreshCw className="animate-spin text-[#4fc3f7]" size={32} />
                    </div>
                )}

                {/* --- ORDERS TAB --- */}
                {activeTab === 'orders' && !isLoading && (
                    <div className="space-y-6">
                        <div className="bg-[#141923] p-6 rounded-xl border border-[#37474f]">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-[#4fc3f7]"><CloudUpload /> Carregar Nova Encomenda</h3>
                            <FileUpload label="Selecionar ficheiro Excel (Material, Qtd)" status="idle" onFileSelect={handleOrderUpload} />
                            <p className="text-xs text-gray-500 mt-2">Formato esperado: Colunas 'MATERIAL' e 'QTD'</p>
                        </div>

                        <div>
                            <h3 className="text-lg font-bold mb-4 text-gray-300">Encomendas Pendentes ({openOrders.length})</h3>
                            <div className="grid gap-3">
                                {openOrders.map(order => (
                                    <div key={order.id} className="bg-[#1e2736] p-4 rounded-lg border border-[#37474f] flex justify-between items-center group hover:border-[#4fc3f7] transition-colors">
                                        <div>
                                            <div className="font-bold text-white text-lg">{order.name}</div>
                                            <div className="text-sm text-gray-400">Criado em: {new Date(order.createdAt).toLocaleString()}</div>
                                            <div className="text-xs text-[#4fc3f7] mt-1">{order.items.length} linhas de pedido</div>
                                        </div>
                                        <button onClick={() => handleDeleteOrder(order.id)} className="p-3 bg-[#263238] text-red-400 rounded hover:bg-red-900/30 transition-colors" title="Apagar">
                                            <Trash2 size={20} />
                                        </button>
                                    </div>
                                ))}
                                {openOrders.length === 0 && <div className="text-center text-gray-500 py-8">Não há encomendas abertas.</div>}
                            </div>
                        </div>
                    </div>
                )}

                {/* --- STOCK TAB --- */}
                {activeTab === 'stock' && !isLoading && (
                    <div className="max-w-2xl mx-auto space-y-6">
                        <div className="bg-[#141923] p-8 rounded-xl border border-[#37474f] text-center">
                            <div className="w-20 h-20 bg-[#263238] rounded-full flex items-center justify-center mx-auto mb-4 border border-[#37474f]">
                                <Database size={40} className="text-[#00e676]" />
                            </div>
                            <h2 className="text-2xl font-bold text-white mb-1">Base de Dados de Stock</h2>
                            <p className="text-gray-400 mb-6">Total de registos na Cloud: <span className="text-[#00e676] font-mono text-xl">{currentStockCount !== null ? currentStockCount : '...'}</span></p>
                            
                            <div className="bg-[#1e2736] p-6 rounded-lg border border-dashed border-gray-600">
                                <h3 className="text-sm font-bold text-gray-300 mb-4 uppercase">Substituir Stock (Upload Excel)</h3>
                                <FileUpload label="Carregar Ficheiro de Stock" status="idle" onFileSelect={handleStockUpload} />
                                <p className="text-xs text-red-400 mt-4 flex items-center justify-center gap-1"><Trash2 size={12}/> Atenção: Esta ação apaga o stock anterior.</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* --- HISTORY TAB --- */}
                {activeTab === 'history' && !isLoading && (
                    <div className="space-y-4">
                         <h3 className="text-lg font-bold mb-4 text-gray-300">Encomendas Concluídas</h3>
                         {completedOrders.map(order => (
                             <div key={order.id} className="bg-[#1e2736] p-4 rounded-lg border border-[#37474f] opacity-75 hover:opacity-100 transition-opacity">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <div className="font-bold text-white">{order.name}</div>
                                        <div className="text-xs text-gray-400">Concluído: {order.completedAt ? new Date(order.completedAt).toLocaleString() : '-'}</div>
                                    </div>
                                    <div className="bg-[#00e676]/20 text-[#00e676] text-xs font-bold px-2 py-1 rounded">CONCLUÍDO</div>
                                </div>
                             </div>
                         ))}
                         {completedOrders.length === 0 && <div className="text-center text-gray-500 py-8">Histórico vazio.</div>}
                    </div>
                )}
            </div>
        </div>
    );
};
