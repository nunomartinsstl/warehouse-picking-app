
import React, { useState } from 'react';
import { PickerInterface } from './components/PickerInterface';
import { ManagerPlatform } from './components/ManagerPlatform';

const App: React.FC = () => {
  const [view, setView] = useState<'picker' | 'manager'>('picker');

  if (view === 'manager') {
    return <ManagerPlatform onBack={() => setView('picker')} />;
  }

  return <PickerInterface onSwitchToManager={() => setView('manager')} />;
};

export default App;
