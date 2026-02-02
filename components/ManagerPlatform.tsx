import React, { useState, useEffect } from 'react';
import { CheckCircle, Trash2, RefreshCw, ArrowLeft, Clock, List, X, RotateCcw } from 'lucide-react';
import { fetchCompletedOrdersFromCloud, deleteOrder, fetchOpenOrdersFromCloud, revertOrderToOpen } from '../utils/firebase';
import { CloudOrder } from '../types';

interface ManagerPlatformProps {
    onBack: () => void;
}

export const ManagerPlatform: React.FC<ManagerPlatformProps> = ({ onBack }) => {
    const [activeTab, setActiveTab] = useState<'open_orders' | 'finished_orders'>('open_orders');
    const [isLoading, setIsLoading] = useState(false);
    
    // Data State
    const [openOrders, setOpenOrders] = useState<CloudOrder[]>([]);
    const [completedOrders, setCompletedOrders] = useState<CloudOrder[]>([]);
    
    // Selection for Details Modal
    const [selectedOrder, setSelectedOrder] = useState<CloudOrder | null>(null);

    useEffect(() => {
        loadData();
    }, [activeTab]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            if (activeTab === 'open_orders') {
                const data = await fetchOpenOrdersFromCloud();
                setOpenOrders(data);
            } else if (activeTab === 'finished_orders') {
                const data = await fetchCompletedOrdersFromCloud();
                setCompletedOrders(data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteOrder = async (id: string) => {
        if (!confirm("Tem a certeza que deseja apagar esta encomenda? Esta ação é irreversível.")) return;
        setIsLoading(true);
        await deleteOrder(id);
        if (selectedOrder?.id === id) setSelectedOrder(null);
        loadData();
        setIsLoading(false);
    };

    const handleRevertOrder = async (id: string) => {
        if (!confirm("Isto irá apagar os dados de picking e mover a encomenda para 'Aberto'. Continuar?")) return;
        setIsLoading(true);
        try {
            await revertOrderToOpen(id);
            setSelectedOrder(null);
            loadData();
            alert("Encomenda revertida com sucesso.");
        } catch (e) {
            console.error(e);
            alert("Erro ao reverter encomenda.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="absolute inset-0 bg-gray-100 flex flex-col text-gray-900 overflow-hidden font-sans transition-colors duration-500">
            {/* Header & Tabs */}
            <div className="bg-white border-b border-gray-200 flex-shrink-0 shadow-xl z-10 transition-colors">
                <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-4">
                        <button 
                            onClick={onBack} 
                            className="bg-gray-100 p-2 rounded-full hover:bg-gray-200 border border-gray-200 transition-all active:scale-95 text-gray-600"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <h1 className="font-bold text-xl text-gray-900 tracking-wide">Histórico de Pedidos</h1>
                    </div>
                    
                    <button 
                        onClick={() => loadData()} 
                        disabled={isLoading}
                        className="p-2 hover:bg-gray-100 rounded-full text-[#4fc3f7] transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={isLoading ? "animate-spin" : ""} size={20} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex px-4 gap-6 overflow-x-auto no-scrollbar">
                    <button 
                        onClick={() => setActiveTab('open_orders')}
                        className={`pb-3 px-2 text-sm font-bold border-b-2 transition-all whitespace-nowrap flex items-center gap-2 ${activeTab === 'open_orders' ? 'border-[#ffeb3b] text-yellow-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                    >
                        <List size={18} className={activeTab === 'open_orders' ? 'text-yellow-600' : ''} />
                        Pedidos Abertos
                    </button>
                    <button 
                        onClick={() => setActiveTab('finished_orders')}
                        className={`pb-3 px-2 text-sm font-bold border-b-2 transition-all whitespace-nowrap flex items-center gap-2 ${activeTab === 'finished_orders' ? 'border-[#00e676] text-[#00e676]' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                    >
                        <CheckCircle size={18} className={activeTab === 'finished_orders' ? 'text-[#00e676]' : ''} />
                        Pedidos Concluídos
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-gray-100 scroll-smooth transition-colors">
                 {/* OPEN ORDERS VIEW */}
                 {activeTab === 'open_orders' && (
                    <div className="space-y-4 max-w-4xl mx-auto pb-10">
                        {openOrders.length === 0 && !isLoading && (
                             <div className="text-center py-12 text-gray-500 flex flex-col items-center">
                                <div className="bg-white p-4 rounded-full mb-4 shadow">
                                    <CheckCircle size={32} className="text-gray-400" />
                                </div>
                                <p className="font-medium">Tudo limpo! Não há pedidos pendentes.</p>
                             </div>
                        )}
                        
                        {openOrders.map(order => (
                            <div key={order.id} className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg hover:border-[#4fc3f7] transition-colors">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                        <h3 className="font-bold text-gray-900 text-lg">{order.name}</h3>
                                        {order.status === 'IN PROCESS' && (
                                            <span className="text-[10px] font-bold bg-yellow-100 text-yellow-600 px-2 py-0.5 rounded border border-yellow-200">EM ANDAMENTO</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-4 text-xs text-gray-500">
                                        <span className="flex items-center gap-1 bg-gray-100 px-2 py-1 rounded border border-gray-200">
                                            <Clock size={12}/> {new Date(order.createdAt).toLocaleString()}
                                        </span>
                                        <span className="bg-[#0277bd]/10 text-[#0277bd] px-2 py-1 rounded font-bold border border-[#0277bd]/20">
                                            {order.items.length} ITENS
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center justify-end sm:border-l border-gray-200 sm:pl-4">
                                    <button 
                                        onClick={() => handleDeleteOrder(order.id)} 
                                        className="text-red-500 hover:bg-red-50 p-2 px-3 rounded-lg transition-colors flex items-center gap-2 text-sm font-bold border border-red-200 hover:border-red-300"
                                    >
                                        <Trash2 size={16} /> <span className="">Apagar</span>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                 )}

                 {/* FINISHED ORDERS VIEW */}
                 {activeTab === 'finished_orders' && (
                    <div className="space-y-4 max-w-4xl mx-auto pb-10">
                        {completedOrders.length === 0 && !isLoading && (
                             <div className="text-center py-12 text-gray-500">
                                <p>Histórico vazio.</p>
                             </div>
                        )}

                        {completedOrders.map(order => (
                            <div 
                                key={order.id} 
                                onClick={() => setSelectedOrder(order)}
                                className="bg-white/50 rounded-xl border border-gray-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm hover:bg-gray-50 transition-colors cursor-pointer group"
                            >
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="bg-[#00e676]/20 p-1.5 rounded-full">
                                            <CheckCircle size={16} className="text-[#00e676]" />
                                        </div>
                                        <h3 className="font-bold text-gray-900 text-lg">{order.name}</h3>
                                    </div>
                                    <div className="flex items-center gap-4 text-xs text-gray-500">
                                        <span className="flex items-center gap-1">
                                            <Clock size={12}/> {order.completedAt ? new Date(order.completedAt).toLocaleString() : 'Data N/A'}
                                        </span>
                                        <span>{order.pickedItems?.length || 0} itens recolhidos</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                    <button 
                                        onClick={() => handleRevertOrder(order.id)}
                                        className="p-2 text-gray-400 hover:text-[#4fc3f7] hover:bg-gray-100 rounded-full transition-colors"
                                        title="Reverter para Aberto"
                                    >
                                        <RotateCcw size={18} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                 )}
            </div>

            {/* DETAILS MODAL */}
            {selectedOrder && (
                <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl transition-colors">
                        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 rounded-t-2xl">
                            <div>
                                <div className="text-xs text-gray-500 uppercase font-bold">Detalhes do Pedido</div>
                                <h2 className="text-xl font-bold text-gray-900">{selectedOrder.name}</h2>
                            </div>
                            <button onClick={() => setSelectedOrder(null)} className="p-2 hover:bg-gray-200 rounded-full text-gray-500 transition-colors">
                                <X size={24} />
                            </button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-0">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-gray-500 bg-gray-100 uppercase font-bold sticky top-0">
                                    <tr>
                                        <th className="px-4 py-3">Material</th>
                                        <th className="px-4 py-3">Lote/Posição</th>
                                        <th className="px-4 py-3 text-right">Qtd</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 text-gray-700">
                                    {(selectedOrder.pickedItems || []).map((item, idx) => (
                                        <tr key={idx} className="hover:bg-gray-50">
                                            <td className="px-4 py-3 font-medium">{item.material}</td>
                                            <td className="px-4 py-3 text-gray-500 font-mono text-xs">{item.bin}</td>
                                            <td className="px-4 py-3 text-right font-bold text-[#00e676]">{item.pickedQty}</td>
                                        </tr>
                                    ))}
                                    {(!selectedOrder.pickedItems || selectedOrder.pickedItems.length === 0) && (
                                        <tr>
                                            <td colSpan={3} className="px-4 py-8 text-center text-gray-500 italic">
                                                Nenhum item registado.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div className="p-4 border-t border-gray-200 bg-gray-50 rounded-b-2xl flex justify-end">
                             <button 
                                onClick={() => handleRevertOrder(selectedOrder.id)}
                                className="text-red-500 text-sm font-bold flex items-center gap-2 hover:bg-red-50 px-4 py-2 rounded-lg transition-colors"
                             >
                                 <RotateCcw size={16} /> Reverter para Aberto
                             </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};