import React, { useState, useEffect, useRef } from 'react';
import { PickerInterface } from './components/PickerInterface';
import { ManagerPlatform } from './components/ManagerPlatform';
import { ReceiverInterface } from './components/ReceiverInterface';
import { Lock, ArrowRight, ArrowLeft, Mail, LogIn, Loader2, LogOut, User as UserIcon, Eye, EyeOff, Package, Archive, Box } from 'lucide-react';
import { authenticateUser, auth, fetchUserProfile, signOutUser } from './utils/firebase';
import { User as UserType } from './types';

const App: React.FC = () => {
  // Added 'mode_select' to authStage
  const [authStage, setAuthStage] = useState<'loading' | 'company_select' | 'login' | 'mode_select' | 'app'>('loading');
  const [selectedCompany, setSelectedCompany] = useState<{id: string, name: string} | null>(null);
  
  // Login Form State
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserType | null>(null);
  
  // View State
  const [view, setView] = useState<'picker' | 'manager'>('picker');
  
  // New: Application Mode (Picking vs Receiving)
  const [appMode, setAppMode] = useState<'picking' | 'receiving'>('picking');
  
  // Logo State
  const [logoError, setLogoError] = useState(false);

  // Updated Logo URLs
  const logoUrl = "https://setling.pt/wp-content/uploads/2024/07/setling-logo-white-110.svg";
  const logoAvac = "https://setling-avac.com/wp-content/uploads/2024/10/setling-avac-logo-color-192px.svg";
  const logoHotelaria = "https://setlinghotelaria.pt/wp-content/uploads/2024/12/setling-hotelaria-logo-big.svg";

  // Guard to prevent auto-login logic from firing during manual login process
  const isManualLogin = useRef(false);

  // --- AUTO LOGIN & PERSISTENCE ---
  useEffect(() => {
      // 1. Check LocalStorage for last email
      const lastEmail = localStorage.getItem('setling_last_email');
      if (lastEmail) setIdentifier(lastEmail);

      // 2. Listen for Firebase Auth Session
      if (!auth) return;

      const unsubscribe = auth.onAuthStateChanged(async (user: any) => {
          // If we are performing a manual login, let handleLogin function control the flow
          if (isManualLogin.current) return;

          if (user) {
              // User is already signed in (session persisted)
              try {
                  const dbUser = await fetchUserProfile(user.uid);
                  setCurrentUser(dbUser);
                  
                  // Auto-set company based on profile
                  const companyName = dbUser.companyId === '1' ? 'SETLING AVAC' : 'SETLING HOTELARIA';
                  setSelectedCompany({ id: dbUser.companyId, name: companyName });
                  
                  setAuthStage('mode_select');
              } catch (err) {
                  console.error("Auto-login failed:", err);
                  // Force logout if profile is invalid
                  await signOutUser();
                  setAuthStage('company_select');
              }
          } else {
              setAuthStage('company_select');
          }
      });

      return () => unsubscribe();
  }, []);

  const handleCompanySelect = (id: string, name: string) => {
      setSelectedCompany({ id, name });
      setAuthStage('login');
      setError('');
      // Leave identifier pre-filled if it exists
      setPassword('');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompany) return;
    if (!password) {
        setError('Por favor, introduza a password.');
        return;
    }

    setIsLoading(true);
    setError('');
    isManualLogin.current = true; // Lock listener

    try {
        // Pass password to authenticateUser
        const user = await authenticateUser(identifier, password, selectedCompany.id);
        setCurrentUser(user);
        setAuthStage('mode_select'); // Go to mode selection
        setView('picker');
    } catch (err: any) {
        console.error(err);
        setError(err.message || "Erro ao efetuar login. Verifique as credenciais.");
    } finally {
        setIsLoading(false);
        isManualLogin.current = false; // Unlock listener
    }
  };

  const handleLogout = async () => {
      await signOutUser();
      setCurrentUser(null);
      setSelectedCompany(null);
      setAuthStage('company_select');
      setView('picker');
  };

  const selectMode = (mode: 'picking' | 'receiving') => {
      setAppMode(mode);
      setAuthStage('app');
  };

  if (authStage === 'loading') {
      return (
          <div className="w-full h-screen bg-gray-900 flex items-center justify-center text-[#4fc3f7]">
              <Loader2 className="animate-spin w-10 h-10" />
          </div>
      );
  }

  if (authStage === 'company_select') {
    return (
      <div className="w-full h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-6 font-sans">
        <div className="mb-12 text-center w-full max-w-md">
            <div className="flex justify-center mb-6">
                {!logoError ? (
                  <img 
                    src={logoUrl}
                    alt="Company Logo" 
                    // No invert needed for dark mode since logo is white
                    className="h-24 max-w-full object-contain transition-all"
                    onError={() => setLogoError(true)}
                  />
                ) : (
                  <div className="flex flex-col items-center">
                    <div className="bg-[#0277bd]/20 p-4 rounded-full border border-[#0277bd]/50 mb-4">
                        <span className="text-[#4fc3f7] font-black text-3xl tracking-tighter">SA</span>
                    </div>
                    <h1 className="text-3xl font-bold tracking-widest text-[#2c52ad]">SETLING</h1>
                  </div>
                )}
            </div>
            
            <p className="text-[#3b82f6] tracking-widest text-lg font-bold opacity-80">PICKING DE ARMAZÉM</p>
        </div>
        
        <div className="w-full max-w-sm space-y-4">
          <p className="text-center text-gray-500 text-xs uppercase font-bold tracking-wider mb-2">Selecione a Empresa</p>
          
          <button 
            onClick={() => handleCompanySelect("1", "SETLING AVAC")}
            className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-[#4fc3f7] p-6 rounded-xl shadow-lg flex items-center justify-between group transition-all"
          >
            <div className="flex items-center gap-4">
              <div className="bg-[#4fc3f7]/10 p-3 rounded-lg w-14 h-14 flex items-center justify-center">
                 <span className="text-[#4fc3f7] font-black text-2xl tracking-tighter">SA</span>
              </div>
              <div className="text-left">
                  <div className="font-bold text-lg text-white">SETLING AVAC</div>
              </div>
            </div>
            <ArrowRight className="text-[#4fc3f7] opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>

          <button 
            onClick={() => handleCompanySelect("2", "SETLING HOTELARIA")}
            className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-[#00e676] p-6 rounded-xl shadow-lg flex items-center justify-between group transition-all"
          >
            <div className="flex items-center gap-4">
               <div className="bg-[#00e676]/10 p-3 rounded-lg w-14 h-14 flex items-center justify-center">
                 <span className="text-[#00e676] font-black text-2xl tracking-tighter">SH</span>
               </div>
              <div className="text-left">
                  <div className="font-bold text-lg text-white">SETLING HOTELARIA</div>
              </div>
            </div>
            <ArrowRight className="text-[#00e676] opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        </div>
        
        <div className="absolute bottom-6 text-gray-600 text-xs">v1.3.4</div>
      </div>
    );
  }

  if (authStage === 'login') {
    return (
      <div className="w-full h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-6 font-sans">
        <div className="w-full max-w-xs">
          <button onClick={() => { setAuthStage('company_select'); setPassword(''); setError(''); }} className="mb-8 text-gray-500 hover:text-white flex items-center gap-2 transition-colors">
            <ArrowLeft size={20} /> <span className="text-sm font-bold">Voltar</span>
          </button>
          
          <div className="text-center mb-8">
              {!logoError && (
                  <div className="flex justify-center mb-4">
                      <img src={logoUrl} alt="Logo" className="h-10 w-auto object-contain transition-all" />
                  </div>
              )}
              
              <div className="inline-block px-3 py-1 rounded-full bg-gray-800 text-xs text-gray-400 font-bold mb-4 border border-gray-700">
                  {selectedCompany?.name}
              </div>
              <h2 className="text-2xl font-bold text-white">Autenticação</h2>
          </div>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1">
                <label className="text-xs text-gray-500 uppercase font-bold ml-1">Utilizador / Email</label>
                <div className="relative">
                    <UserIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500" size={18} />
                    <input 
                        type="text" 
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        placeholder="Nome de utilizador ou Email"
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-10 p-3 text-white placeholder-gray-600 focus:border-[#4fc3f7] focus:outline-none transition-colors"
                        autoFocus
                    />
                </div>
            </div>

            <div className="space-y-1">
                <label className="text-xs text-gray-500 uppercase font-bold ml-1">Password</label>
                <div className="relative">
                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500" size={18} />
                    <input 
                        type={showPassword ? "text" : "password"} 
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••"
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-10 pr-10 p-3 text-white placeholder-gray-600 focus:border-[#4fc3f7] focus:outline-none transition-colors"
                    />
                    <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-300"
                    >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                </div>
            </div>
            
            {error && (
                <div className="bg-red-900/30 border border-red-800 text-red-400 text-center text-sm p-3 rounded-lg animate-pulse">
                    {error}
                </div>
            )}
            
            <button 
              type="submit"
              disabled={isLoading}
              className="w-full bg-[#00e676] hover:bg-[#00c853] text-black font-bold py-4 rounded-xl shadow-lg shadow-green-900/10 flex justify-center items-center gap-2 transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? <Loader2 className="animate-spin" /> : <LogIn size={18} />} 
              ENTRAR
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- NEW: MODE SELECTION SCREEN ---
  if (authStage === 'mode_select') {
      return (
          <div className="w-full h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-6 font-sans">
              <div className="mb-12 text-center">
                  <h2 className="text-3xl font-bold mb-2">Bem-vindo</h2>
                  <p className="text-gray-400">Selecione o modo de operação</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-2xl">
                  <button 
                    onClick={() => selectMode('picking')}
                    className="bg-gray-800 hover:bg-[#4fc3f7]/10 border-2 border-gray-700 hover:border-[#4fc3f7] p-8 rounded-2xl flex flex-col items-center gap-4 transition-all group"
                  >
                      <div className="bg-gray-700 group-hover:bg-[#4fc3f7] p-6 rounded-full transition-colors">
                          <Package size={40} className="text-white" />
                      </div>
                      <h3 className="text-2xl font-bold">Picking</h3>
                  </button>

                  <button 
                    onClick={() => selectMode('receiving')}
                    className="bg-gray-800 hover:bg-[#00e676]/10 border-2 border-gray-700 hover:border-[#00e676] p-8 rounded-2xl flex flex-col items-center gap-4 transition-all group"
                  >
                      <div className="bg-gray-700 group-hover:bg-[#00e676] p-6 rounded-full transition-colors">
                          <Archive size={40} className="text-white" />
                      </div>
                      <h3 className="text-2xl font-bold">Entrada</h3>
                  </button>
              </div>

              <button 
                onClick={handleLogout}
                className="mt-12 text-gray-500 hover:text-white flex items-center gap-2 text-sm"
              >
                  <LogOut size={16} /> Terminar Sessão
              </button>
          </div>
      );
  }

  // --- APP LAYOUT ---
  return (
      <div className="relative w-full h-full bg-gray-900 text-white transition-colors">
          {/* Header Buttons (Absolute top-right for quick access in development/prod) */}
          <div className="fixed top-4 right-4 z-[100] flex items-center gap-3">
              {selectedCompany && (
                <div className="bg-white/90 p-2 rounded-lg shadow-lg border border-white/20 hidden xs:block">
                    <img
                        src={selectedCompany.id === '1' ? logoAvac : logoHotelaria}
                        alt={selectedCompany.name}
                        className="h-8 w-auto object-contain"
                    />
                </div>
              )}

              {/* Mode Switcher Button (Only visible if already in app) */}
              <button
                onClick={() => {
                    setAuthStage('mode_select');
                }}
                className="bg-gray-800 hover:bg-gray-700 border border-gray-600 p-2 rounded-full shadow-lg backdrop-blur-sm transition-all text-gray-300"
                title="Mudar Modo"
              >
                  {appMode === 'picking' ? <Package size={20} /> : <Archive size={20} />}
              </button>

              <button 
                onClick={handleLogout}
                className="bg-red-900/30 hover:bg-red-900/50 text-red-400 p-2 rounded-full border border-red-900/50 shadow-lg backdrop-blur-sm transition-all"
                title="Sair"
              >
                  <LogOut size={20} />
              </button>
          </div>

          {/* Conditional Rendering based on Mode */}
          {appMode === 'receiving' ? (
              <ReceiverInterface 
                  onBack={() => {
                      setAuthStage('mode_select');
                  }} 
                  user={currentUser}
              />
          ) : view === 'manager' ? (
             <ManagerPlatform onBack={() => setView('picker')} />
          ) : (
             <PickerInterface 
                onSwitchToManager={() => setView('manager')} 
                companyLogo={selectedCompany?.id === '1' ? logoAvac : logoHotelaria}
             />
          )}
      </div>
  );
};

export default App;