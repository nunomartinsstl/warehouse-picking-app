
import React, { useState, useEffect } from 'react';
import { FileText, CheckCircle, Trash2, RefreshCw, X, Database, List, Folder, ArrowLeft, LogOut, AlertTriangle, Search } from 'lucide-react';
import { fetchCompletedOrdersFromCloud, deleteOrder, fetchOpenOrdersFromCloud, fetchStockFromCloud } from '../utils/firebase';
import { CloudOrder, StockItem } from '../types';

interface ManagerPlatformProps {
    onBack: () => void;
}

export const ManagerPlatform: React.FC<ManagerPlatformProps> = ({ onBack }) => {
    const [activeTab, setActiveTab] = useState<'open_orders' | 'finished_orders' | 'stock'>('open_orders');
    const [isLoading, setIsLoading] = useState(false);
    
    // Data State
    const [openOrders, setOpenOrders] = useState<CloudOrder[]>([]);
    const [completedOrders, setCompletedOrders] = useState<CloudOrder[]>([]);
    const [stockItems, setStockItems] = useState<StockItem[]>([]);
    const [stockSearch, setStockSearch] = useState('');

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
            } else if (activeTab === 'stock') {
                const data = await fetchStockFromCloud();
                setStockItems(data);
            }
        } catch (e) {
            console.error(e);
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

    const filteredStock = stockItems.filter(item => 
        item.material.toLowerCase().includes(stockSearch.toLowerCase()) ||
        item.bin.toLowerCase().includes(stockSearch.toLowerCase()) ||
        (item.description && item.description.toLowerCase().includes(stockSearch.toLowerCase()))
    );

    return (
        <div className="absolute inset-0 bg-[#0f131a] flex text-white overflow-hidden font-sans">
            {/* Sidebar */}
            <div className="w-64 bg-[#141923] border-r border-[#37474f] flex flex-col">
                <div className="p-6 border-b border-[#37474f] flex items-center gap-3">
                    <div className="bg-[#0277bd] p-2 rounded-lg"><Database size={24} /></div>
                    <div>
                        <h1 className="font-bold text-lg leading-tight">Plataforma<br/>Gestão</h1>
                    </div>
                </div>
                
                <nav className="flex-1 p-4 space-y-2">
                    <button 
                        onClick={() => setActiveTab('open_orders')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'open_orders' ? 'bg-[#0277bd] text-white' : 'text-gray-400 hover:bg-[#1e2736] hover:text-white'}`}
                    >
                        <Folder size={20} className={activeTab === 'open_orders' ? 'text-white' : 'text-[#ffeb3b]'} />
                        <span className="font-medium">Pedidos Abertos</span>
                    </button>

                    <button 
                        onClick={() => setActiveTab('finished_orders')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'finished_orders' ? 'bg-[#0277bd] text-white' : 'text-gray-400 hover:bg-[#1e2736] hover:text-white'}`}
                    >
                        <Folder size={20} className={activeTab === 'finished_orders' ? 'text-white' : 'text-[#00e676]'} />
                        <span className="font-medium">Pedidos Concluídos</span>
                    </button>

                    <button 
                        onClick={() => setActiveTab('stock')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'stock' ? 'bg-[#0277bd] text-white' : 'text-gray-400 hover:bg-[#1e2736] hover:text-white'}`}
                    >
                        <Folder size={20} className={activeTab === 'stock' ? 'text-white' : 'text-[#4fc3f7]'} />
                        <span className="font-medium">Stock</span>
                    </button>
                </nav>

                <div className="p-4 border-t border-[#37474f]">
                    <button onClick={onBack} className="w-full flex items-center gap-2 text-gray-500 hover:text-white px-4 py-2 transition-colors">
                        <LogOut size={18} /> Sair para Launcher
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden bg-[#0f131a]">
                {/* Header */}
                <header className="h-16 bg-[#141923] border-b border-[#37474f] flex items-center justify-between px-8">
                    <h2 className="text-xl font-bold flex items-center gap-3">
                        {activeTab === 'open_orders' && <><List className="text-[#ffeb3b]" /> Monitor de Pedidos Abertos</>}
                        {activeTab === 'finished_orders' && <><CheckCircle className="text-[#00e676]" /> Histórico de Pedidos</>}
                        {activeTab === 'stock' && <><Database className="text-[#4fc3f7]" /> Visualização de Stock</>}
                    </h2>
                    <button onClick={() => loadData()} className="flex items-center gap-2 text-[#4fc3f7] hover:bg-[#1e2736] px-3 py-1 rounded transition-colors">
                        <RefreshCw className={isLoading ? "animate-spin" : ""} size={18} /> 
                        {isLoading ? "A carregar..." : "Atualizar Dados"}
                    </button>
                </header>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-8">
                    
                    {/* OPEN ORDERS VIEW */}
                    {activeTab === 'open_orders' && (
                        <div className="space-y-8 max-w-6xl mx-auto">
                            
                            {/* Stats Card */}
                            <div className="bg-[#141923] p-6 rounded-xl border border-[#37474f] flex items-center justify-between px-10 shadow-lg">
                                <div>
                                    <div className="text-gray-400 text-sm uppercase font-bold">Total Pendente</div>
                                    <div className="text-4xl font-bold text-white mt-1">{openOrders.length}</div>
                                </div>
                                <div className="h-12 w-px bg-[#37474f]"></div>
                                <div>
                                    <div className="text-gray-400 text-sm uppercase font-bold">Itens a Recolher</div>
                                    <div className="text-4xl font-bold text-[#ffeb3b] mt-1">
                                        {openOrders.reduce((acc, o) => acc + o.items.length, 0)}
                                    </div>
                                </div>
                                <div className="h-12 w-px bg-[#37474f]"></div>
                                <div>
                                    <div className="text-gray-400 text-sm uppercase font-bold">Status</div>
                                    <div className="text-green-500 font-bold mt-2 flex items-center gap-2">
                                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                                        Live Sync Ativo
                                    </div>
                                </div>
                            </div>

                            {/* Table */}
                            <div className="bg-[#141923] rounded-xl border border-[#37474f] overflow-hidden shadow-lg">
                                <table className="w-full text-left text-sm text-gray-400">
                                    <thead className="bg-[#263238] text-gray-200 uppercase text-xs">
                                        <tr>
                                            <th className="px-6 py-4">Nome do Pedido</th>
                                            <th className="px-6 py-4">Data Criação</th>
                                            <th className="px-6 py-4 text-center">Nº Linhas</th>
                                            <th className="px-6 py-4 text-center">Status</th>
                                            <th className="px-6 py-4 text-right">Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#37474f]">
                                        {openOrders.map(order => (
                                            <tr key={order.id} className="hover:bg-[#1e2736] transition-colors">
                                                <td className="px-6 py-4 font-bold text-white">{order.name}</td>
                                                <td className="px-6 py-4">{new Date(order.createdAt).toLocaleString()}</td>
                                                <td className="px-6 py-4 text-center"><span className="bg-[#0277bd]/20 text-[#4fc3f7] px-2 py-1 rounded text-xs font-bold">{order.items.length} ITENS</span></td>
                                                <td className="px-6 py-4 text-center">
                                                    {order.status === 'IN PROCESS' ? (
                                                        <span className="text-yellow-400 font-bold text-xs border border-yellow-400/30 bg-yellow-400/10 px-2 py-1 rounded">EM ANDAMENTO</span>
                                                    ) : (
                                                        <span className="text-gray-400 text-xs">AGUARDAR</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <button onClick={() => handleDeleteOrder(order.id)} className="text-red-400 hover:bg-red-900/30 p-2 rounded transition-colors" title="Cancelar Pedido"><Trash2 size={18} /></button>
                                                </td>
                                            </tr>
                                        ))}
                                        {openOrders.length === 0 && (
                                            <tr>
                                                <td colSpan={5} className="px-6 py-12 text-center text-gray-500 flex flex-col items-center">
                                                    <CheckCircle size={40} className="mb-2 opacity-20" />
                                                    Tudo limpo! Não há pedidos pendentes.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* FINISHED ORDERS VIEW */}
                    {activeTab === 'finished_orders' && (
                        <div className="max-w-6xl mx-auto">
                            <div className="bg-[#141923] rounded-xl border border-[#37474f] overflow-hidden shadow-lg">
                                <table className="w-full text-left text-sm text-gray-400">
                                    <thead className="bg-[#263238] text-gray-200 uppercase text-xs">
                                        <tr>
                                            <th className="px-6 py-4">Nome do Pedido</th>
                                            <th className="px-6 py-4">Concluído Em</th>
                                            <th className="px-6 py-4 text-center">Status</th>
                                            <th className="px-6 py-4 text-right">Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#37474f]">
                                        {completedOrders.map(order => (
                                            <tr key={order.id} className="hover:bg-[#1e2736] transition-colors">
                                                <td className="px-6 py-4 font-bold text-white">{order.name}</td>
                                                <td className="px-6 py-4">{order.completedAt ? new Date(order.completedAt).toLocaleString() : '-'}</td>
                                                <td className="px-6 py-4 text-center"><span className="bg-[#00e676]/20 text-[#00e676] px-2 py-1 rounded text-xs font-bold">CONCLUÍDO</span></td>
                                                <td className="px-6 py-4 text-right">
                                                    <button onClick={() => handleDeleteOrder(order.id)} className="text-gray-500 hover:text-red-400 p-2"><Trash2 size={18} /></button>
                                                </td>
                                            </tr>
                                        ))}
                                        {completedOrders.length === 0 && (
                                            <tr>
                                                <td colSpan={4} className="px-6 py-12 text-center text-gray-500">Histórico vazio.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* STOCK VIEW */}
                    {activeTab === 'stock' && (
                        <div className="max-w-6xl mx-auto space-y-6">
                            <div className="bg-[#141923] p-6 rounded-xl border border-[#37474f] shadow-lg flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                     <div className="p-3 rounded-full bg-[#263238] border border-[#37474f]">
                                        <Database size={24} className="text-[#4fc3f7]" />
                                     </div>
                                     <div>
                                        <h3 className="text-xl font-bold text-white">Base de Dados de Stock</h3>
                                        <p className="text-gray-400 text-sm">Sincronizado com App Principal</p>
                                     </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-xs text-gray-400 uppercase font-bold">Total Registos</div>
                                    <span className="text-[#00e676] font-mono text-3xl font-bold">{stockItems.length}</span>
                                </div>
                            </div>
                            
                            {/* Search */}
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                                <input 
                                    type="text" 
                                    placeholder="Pesquisar material, lote ou descrição..." 
                                    value={stockSearch}
                                    onChange={(e) => setStockSearch(e.target.value)}
                                    className="w-full bg-[#141923] border border-[#37474f] rounded-lg py-3 pl-10 pr-4 text-white focus:outline-none focus:border-[#4fc3f7]"
                                />
                            </div>

                            {stockItems.length > 0 && (
                                <div className="bg-[#141923] rounded-xl border border-[#37474f] overflow-hidden max-h-[600px] overflow-y-auto shadow-lg">
                                    <table className="w-full text-left text-sm text-gray-400">
                                        <thead className="bg-[#263238] text-gray-200 uppercase text-xs sticky top-0">
                                            <tr>
                                                <th className="px-6 py-3">Material</th>
                                                <th className="px-6 py-3">Descrição</th>
                                                <th className="px-6 py-3">Local (Lote)</th>
                                                <th className="px-6 py-3 text-right">Qtd</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-[#37474f]">
                                            {filteredStock.slice(0, 100).map((item, i) => (
                                                <tr key={i} className="hover:bg-[#1e2736]">
                                                    <td className="px-6 py-2 font-mono text-[#4fc3f7]">{item.material}</td>
                                                    <td className="px-6 py-2 truncate max-w-xs">{item.description}</td>
                                                    <td className="px-6 py-2 font-mono">{item.bin}</td>
                                                    <td className="px-6 py-2 text-right font-bold text-white">{item.qtyAvailable}</td>
                                                </tr>
                                            ))}
                                            {filteredStock.length === 0 && (
                                                <tr><td colSpan={4} className="text-center py-8">Nenhum resultado encontrado.</td></tr>
                                            )}
                                            {filteredStock.length > 100 && (
                                                <tr>
                                                    <td colSpan={4} className="px-6 py-4 text-center text-xs text-gray-500 italic">...e mais {filteredStock.length - 100} itens</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};
