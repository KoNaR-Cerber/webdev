import React from 'react';

import { RobotProvider } from './context/RobotContext';
import Dashboard from './components/layout/Dashboard';


function App() {
  return (
    <RobotProvider>
      <Dashboard />
    </RobotProvider>
  );
}

export default App;