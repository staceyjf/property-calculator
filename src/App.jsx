import React, { useState } from "react";
import PropertyModel from './PropertyModel.jsx';
import BudgetTrackerComponent from './BudgetTrackerComponent.jsx';

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [mode, setMode] = useState('property'); // 'budget' or 'property'

  return mode === 'property' ? (
    <PropertyModel onSwitch={() => setMode('budget')} />
  ) : (
    <BudgetTrackerComponent onSwitch={() => setMode('property')} />
  );
}
