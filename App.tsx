import React, { useState } from 'react';
import { PickerInterface } from './components/PickerInterface';
import { ManagerPlatform } from './components/ManagerPlatform';
import { Lock, Briefcase, ArrowRight, ArrowLeft, Building2, Package } from 'lucide-react';

const App: React.FC = () => {
  const [authStage, setAuthStage] = useState<'landing' | 'password' | 'app'>('landing');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  
  const [view, setView] = useState<'picker' | 'manager'>('picker');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === '1234') {
      setAuthStage('app');
      setView('picker');
    } else {
      setError('Senha incorreta');
      setPassword('');
    }
  };

  if (authStage === 'landing') {
    return (
      <div className="w-full h-screen bg-[#0f131a] text-white flex flex-col items-center justify-center p-6 font-sans">
        <div className="mb-12 text-center">
            <div className="flex justify-center mb-4">
                <div className="bg-[#0277bd]/20 p-4 rounded-full border border-[#0277bd]/50">
                    <Package size={48} className="text-[#4fc3f7]" />
                </div>
            </div>
            {/* Branding Color Updated */}
            <h1 className="text-3xl font-bold tracking-widest text-[#2c52ad]">SETLING</h1>
            <p className="text-[#4fc3f7] tracking-widest text-sm font-bold opacity-80">WAREHOUSE OPERATIONS</p>
        </div>
        
        <div className="w-full max-w-sm space-y-4">
          <button 
            onClick={() => setAuthStage('password')}
            className="w-full bg-[#1e2736] hover:bg-[#263238] border border-[#37474f] hover:border-[#4fc3f7] p-6 rounded-xl shadow-lg flex items-center justify-between group transition-all"
          >
            <div className="flex items-center gap-4">
              <div className="text-left">
                  <div className="font-bold text-lg text-white">SETLING AVAC</div>
                  <div className="text-xs text-gray-400">Logística & Picking</div>
              </div>
            </div>
            <ArrowRight className="text-[#4fc3f7] opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>

          <button 
            onClick={() => alert("Módulo em desenvolvimento.")}
            className="w-full bg-[#141923] border border-[#37474f] p-6 rounded-xl shadow-lg flex items-center justify-between opacity-50 cursor-not-allowed"
          >
            <div className="flex items-center gap-4">
              <div className="text-left">
                  <div className="font-bold text-lg text-gray-400">SETLING HOTELARIA</div>
                  <div className="text-xs text-gray-600">Brevemente</div>
              </div>
            </div>
          </button>
        </div>
        
        <div className="absolute bottom-6 text-gray-600 text-xs">v1.2.0</div>
      </div>
    );
  }

  if (authStage === 'password') {
    return (
      <div className="w-full h-screen bg-[#0f131a] text-white flex flex-col items-center justify-center p-6 font-sans">
        <div className="w-full max-w-xs">
          <button onClick={() => { setAuthStage('landing'); setPassword(''); setError(''); }} className="mb-8 text-gray-400 hover:text-white flex items-center gap-2 transition-colors">
            <ArrowLeft size={20} /> <span className="text-sm font-bold">Voltar</span>
          </button>
          
          <h2 className="text-2xl font-bold mb-2 text-center text-white">Acesso Reservado</h2>
          <p className="text-gray-400 text-center mb-8 text-sm">Introduza o código de acesso para AVAC</p>
          
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <input 
                type="password" 
                inputMode="numeric"
                pattern="[0-9]*"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                placeholder="PIN"
                className="w-full bg-[#1e2736] border border-[#37474f] rounded-xl p-4 text-center text-3xl font-bold tracking-[0.5em] text-white focus:border-[#4fc3f7] focus:outline-none transition-colors placeholder:tracking-normal placeholder:text-base placeholder:font-normal placeholder:text-gray-600"
                autoFocus
              />
            </div>
            
            {error && (
                <div className="bg-red-500/10 border border-red-500/50 text-red-400 text-center text-sm p-3 rounded-lg">
                    {error}
                </div>
            )}
            
            <button 
              type="submit"
              className="w-full bg-[#00e676] hover:bg-[#00c853] text-black font-bold py-4 rounded-xl shadow-lg shadow-green-900/20 flex justify-center items-center gap-2 transition-transform active:scale-95"
            >
              <Lock size={18} /> ENTRAR
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (view === 'manager') {
    return <ManagerPlatform onBack={() => setView('picker')} />;
  }

  return <PickerInterface onSwitchToManager={() => setView('manager')} />;
};

export default App;