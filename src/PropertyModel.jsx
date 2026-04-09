import React, { useState, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { SPREADSHEET_ID, ACTUALS_TAB_NAME, INCOME } from "./config.js";

const fmt = (n) => "$" + Math.round(n).toLocaleString();
const fmtK = (n) => (n >= 0 ? "" : "-") + "$" + Math.round(Math.abs(n) / 1000) + "k";
const fmtM = (n) => "$" + (Math.abs(n) / 1000000).toFixed(2) + "m";

const RATES = { conservative: 0.03, moderate: 0.05, optimistic: 0.07 };
const RATE_COLORS = { conservative: "#94a3b8", moderate: "#3b82f6", optimistic: "#10b981" };

function calcTax(income) {
  if (income <= 18200) return 0;
  if (income <= 45000) return (income - 18200) * 0.19;
  if (income <= 120000) return 5092 + (income - 45000) * 0.325;
  if (income <= 180000) return 29467 + (income - 120000) * 0.37;
  return 51667 + (income - 180000) * 0.45;
}

function negGearBenefit(rentalIncome, mortgageInterest, otherCosts, marginalRate) {
  const loss = rentalIncome - mortgageInterest - otherCosts;
  return loss < 0 ? Math.abs(loss) * marginalRate : 0;
}

function borrowingCap(grossIncome, expenses, existingDebt, rate = 0.089) {
  const netMonthly = (grossIncome - calcTax(grossIncome)) / 12;
  const existingRepay = existingDebt > 0
    ? (existingDebt * (rate / 12)) / (1 - Math.pow(1 + rate / 12, -300)) : 0;
  const available = Math.max(0, (netMonthly - expenses) * 0.65 - existingRepay);
  const maxLoan = available * ((1 - Math.pow(1 + rate / 12, -300)) / (rate / 12));
  return { maxLoan, existingRepay };
}

export default function PropertyModel({ onSwitch }) {
  const [flatValue, setFlatValue] = useState(1850000);
  const [mortgageOwing, setMortgageOwing] = useState(1200000);
  const [housePrice, setHousePrice] = useState(0);
  const [invPropPrice, setInvPropPrice] = useState(0);
  const [cashSavings, setCashSavings] = useState(0);
  const [interestRate, setInterestRate] = useState(5.89);
  const [weeklyRent, setWeeklyRent] = useState(0);
  const [grossIncome, setGrossIncome] = useState(INCOME.reduce((s, p) => s + p.monthly, 0) * 12);
  const [monthlyExpenses, setMonthlyExpenses] = useState(0);
  const [schoolFees, setSchoolFees] = useState(0);
  const [activeTab, setActiveTab] = useState("summary");
  const [googleToken, setGoogleToken] = useState(null);
  const [loadStatus, setLoadStatus] = useState(null);
  const years = 5;

  const signInGoogle = () => {
    if (!window.google) { alert("Google sign-in not loaded yet — try again in a moment."); return; }
    window.google.accounts.oauth2.initTokenClient({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      callback: resp => { if (resp.access_token) setGoogleToken(resp.access_token); },
    }).requestAccessToken();
  };

  const sheetsApi = async (path) => {
    const resp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}${path}`, {
      headers: { Authorization: `Bearer ${googleToken}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) throw new Error(`Sheets API ${resp.status}: ${await resp.text()}`);
    return resp.json();
  };

  const loadFromSheet = async () => {
    if (!googleToken) { signInGoogle(); return; }
    setLoadStatus("loading");
    try {
      const { values = [] } = await sheetsApi(`/values/${encodeURIComponent(ACTUALS_TAB_NAME)}`);
      const labelRow = values[0] || [];

      // Find reconciled columns (header row = "Actual"), skip col 0 (labels) and last col (Totals)
      const actualCols = labelRow.reduce((acc, label, i) => {
        if (i > 0 && label === "Actual") acc.push(i);
        return acc;
      }, []);
      if (actualCols.length === 0) throw new Error("No reconciled months found — write actuals to the sheet first.");

      // Average a named row across all reconciled columns, stripping currency formatting
      const avgRow = (name) => {
        const row = values.find(r => (r[0] || "").trim().toLowerCase() === name.toLowerCase());
        if (!row) return 0;
        const vals = actualCols.map(c => parseFloat((row[c] || "0").replace(/[$,]/g, "")) || 0);
        return vals.reduce((s, v) => s + v, 0) / vals.length;
      };

      const livingAvg   = avgRow("Living Total");
      const ccAvg       = avgRow("Childcare Total");
      const incomeAvg   = avgRow("Income");  // monthly combined

      if (livingAvg > 0)  setMonthlyExpenses(Math.round(livingAvg));
      if (ccAvg > 0)      setSchoolFees(Math.round(ccAvg));
      // Income row is monthly — property model grossIncome is annual
      if (incomeAvg > 0)  setGrossIncome(Math.round(incomeAvg * 12));

      setLoadStatus({ done: true, months: actualCols.length });
    } catch (e) {
      setLoadStatus({ error: e.message });
    }
  };

  const equity = flatValue - mortgageOwing;
  const annualRent = weeklyRent * 52;
  const monthlyRent = annualRent / 12;
  const totalExp = monthlyExpenses + schoolFees;

  // Calculations for projections
  const projections = useMemo(() => {
    const data = [];
    for (let y = 0; y <= years; y++) {
      const yearIncome = grossIncome * Math.pow(1.03, y); // 3% annual income growth
      const yearRent = annualRent * Math.pow(1.04, y); // 4% rent growth
      const yearExpenses = totalExp * 12 * Math.pow(1.03, y); // 3% expense growth
      const netIncome = yearIncome - calcTax(yearIncome) - yearExpenses;
      const mortgagePayment = mortgageOwing > 0 ? (mortgageOwing * (interestRate / 100 / 12)) / (1 - Math.pow(1 + interestRate / 100 / 12, -300)) * 12 : 0;
      const cashFlow = netIncome - mortgagePayment;
      const principalPaid = mortgagePayment - (mortgageOwing * (interestRate / 100 / 12));
      const remainingMortgage = mortgageOwing - principalPaid * y;
      const propertyValue = housePrice * Math.pow(1.05, y); // 5% property growth
      const equityValue = propertyValue - remainingMortgage;
      data.push({
        year: y,
        income: yearIncome,
        expenses: yearExpenses,
        netIncome,
        cashFlow,
        mortgage: remainingMortgage,
        equity: equityValue,
        propertyValue,
      });
    }
    return data;
  }, [grossIncome, annualRent, totalExp, mortgageOwing, interestRate, housePrice, years]);

  const conservative = projections.map(p => ({ year: p.year, equity: p.equity * Math.pow(1 + RATES.conservative, p.year) }));
  const moderate = projections.map(p => ({ year: p.year, equity: p.equity * Math.pow(1 + RATES.moderate, p.year) }));
  const optimistic = projections.map(p => ({ year: p.year, equity: p.equity * Math.pow(1 + RATES.optimistic, p.year) }));

  // ─── Colours ─────────────────────────────────────────────────────────────
  const C = { bg:"#070d1a", card:"#0c1422", border:"#142030", text:"#d8e8f5", muted:"#3a5570",
    blue:"#3d8ef0", green:"#27c99a", amber:"#f0a020", red:"#e05555", purple:"#9d7ff5" };

  return (
    <div style={{ fontFamily:"'DM Mono','Fira Code',monospace", background:C.bg, minHeight:"100vh", color:C.text, padding:24, fontSize:13 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize:20, fontWeight:700, color:"#eef4ff", letterSpacing:"-0.02em" }}>Property Investment Calculator</div>
            <div style={{ fontSize:12, color:C.muted, marginTop:3 }}>Investment projections and borrowing capacity</div>
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            {!googleToken
              ? <button onClick={signInGoogle} style={{ background:"#1a4a8a", color:"#fff", border:"none", borderRadius:8, padding:"10px 20px", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>Connect Google</button>
              : <button onClick={loadFromSheet} disabled={loadStatus === "loading"} style={{ background: loadStatus?.done ? "#1a5a3a" : "#1a4a8a", color:"#fff", border:"none", borderRadius:8, padding:"10px 20px", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
                  {loadStatus === "loading" ? "Loading…" : loadStatus?.done ? `✓ Loaded (${loadStatus.months}mo avg)` : "Load from Sheet →"}
                </button>
            }
            {loadStatus?.error && <span style={{ fontSize:11, color:C.red }}>{loadStatus.error}</span>}
            <button onClick={onSwitch} style={{ background:C.blue, color:"white", border:"none", borderRadius:8, padding:"10px 20px", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
              Switch to Budget Tracker
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:20 }}>
            <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:16 }}>Inputs</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ color:C.muted, fontSize:11, textTransform:"uppercase", letterSpacing:"0.1em" }}>Flat Value: <input type="number" value={flatValue} onChange={e => setFlatValue(Number(e.target.value))} style={{ background:"#060d18", border:`1px solid #1a3050`, borderRadius:7, color:C.text, padding:"8px 10px", fontSize:12, fontFamily:"inherit", width:"100%" }} /></label>
              <label style={{ color:C.muted, fontSize:11, textTransform:"uppercase", letterSpacing:"0.1em" }}>Mortgage Owing: <input type="number" value={mortgageOwing} onChange={e => setMortgageOwing(Number(e.target.value))} style={{ background:"#060d18", border:`1px solid #1a3050`, borderRadius:7, color:C.text, padding:"8px 10px", fontSize:12, fontFamily:"inherit", width:"100%" }} /></label>
              <label style={{ color:C.muted, fontSize:11, textTransform:"uppercase", letterSpacing:"0.1em" }}>House Price: <input type="number" value={housePrice} onChange={e => setHousePrice(Number(e.target.value))} style={{ background:"#060d18", border:`1px solid #1a3050`, borderRadius:7, color:C.text, padding:"8px 10px", fontSize:12, fontFamily:"inherit", width:"100%" }} /></label>
              <label style={{ color:C.muted, fontSize:11, textTransform:"uppercase", letterSpacing:"0.1em" }}>Investment Property Price: <input type="number" value={invPropPrice} onChange={e => setInvPropPrice(Number(e.target.value))} style={{ background:"#060d18", border:`1px solid #1a3050`, borderRadius:7, color:C.text, padding:"8px 10px", fontSize:12, fontFamily:"inherit", width:"100%" }} /></label>
              <label style={{ color:C.muted, fontSize:11, textTransform:"uppercase", letterSpacing:"0.1em" }}>Cash Savings: <input type="number" value={cashSavings} onChange={e => setCashSavings(Number(e.target.value))} style={{ background:"#060d18", border:`1px solid #1a3050`, borderRadius:7, color:C.text, padding:"8px 10px", fontSize:12, fontFamily:"inherit", width:"100%" }} /></label>
              <label style={{ color:C.muted, fontSize:11, textTransform:"uppercase", letterSpacing:"0.1em" }}>Interest Rate (%): <input type="number" step="0.01" value={interestRate} onChange={e => setInterestRate(Number(e.target.value))} style={{ background:"#060d18", border:`1px solid #1a3050`, borderRadius:7, color:C.text, padding:"8px 10px", fontSize:12, fontFamily:"inherit", width:"100%" }} /></label>
              <label style={{ color:C.muted, fontSize:11, textTransform:"uppercase", letterSpacing:"0.1em" }}>Weekly Rent: <input type="number" value={weeklyRent} onChange={e => setWeeklyRent(Number(e.target.value))} style={{ background:"#060d18", border:`1px solid #1a3050`, borderRadius:7, color:C.text, padding:"8px 10px", fontSize:12, fontFamily:"inherit", width:"100%" }} /></label>
              <label style={{ color:C.muted, fontSize:11, textTransform:"uppercase", letterSpacing:"0.1em" }}>Gross Income: <input type="number" value={grossIncome} onChange={e => setGrossIncome(Number(e.target.value))} style={{ background:"#060d18", border:`1px solid #1a3050`, borderRadius:7, color:C.text, padding:"8px 10px", fontSize:12, fontFamily:"inherit", width:"100%" }} /></label>
              <label style={{ color:C.muted, fontSize:11, textTransform:"uppercase", letterSpacing:"0.1em" }}>Monthly Expenses: <input type="number" value={monthlyExpenses} onChange={e => setMonthlyExpenses(Number(e.target.value))} style={{ background:"#060d18", border:`1px solid #1a3050`, borderRadius:7, color:C.text, padding:"8px 10px", fontSize:12, fontFamily:"inherit", width:"100%" }} /></label>
              <label style={{ color:C.muted, fontSize:11, textTransform:"uppercase", letterSpacing:"0.1em" }}>School Fees: <input type="number" value={schoolFees} onChange={e => setSchoolFees(Number(e.target.value))} style={{ background:"#060d18", border:`1px solid #1a3050`, borderRadius:7, color:C.text, padding:"8px 10px", fontSize:12, fontFamily:"inherit", width:"100%" }} /></label>
            </div>
          </div>

          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:20 }}>
            <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:16 }}>Summary</div>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
                <span style={{ color:C.muted }}>Equity:</span>
                <span style={{ color:C.green, fontWeight:600 }}>{fmt(equity)}</span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
                <span style={{ color:C.muted }}>Annual Rent:</span>
                <span style={{ color:C.blue, fontWeight:600 }}>{fmt(annualRent)}</span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
                <span style={{ color:C.muted }}>Monthly Rent:</span>
                <span style={{ color:C.blue, fontWeight:600 }}>{fmt(monthlyRent)}</span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
                <span style={{ color:C.muted }}>Total Expenses:</span>
                <span style={{ color:C.amber, fontWeight:600 }}>{fmt(totalExp)}</span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0" }}>
                <span style={{ color:C.muted }}>Borrowing Capacity:</span>
                <span style={{ color:C.purple, fontWeight:600 }}>{fmt(borrowingCap(grossIncome, totalExp, mortgageOwing).maxLoan)}</span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 40 }}>
          <div style={{ fontSize:18, fontWeight:700, color:C.text, marginBottom:20 }}>Projections</div>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:20, height: 400 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={projections}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="year" stroke={C.muted} />
                <YAxis tickFormatter={fmtK} stroke={C.muted} />
                <Tooltip formatter={(value) => fmt(value)} contentStyle={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, color:C.text }} />
                <Legend />
                <Line type="monotone" dataKey="equity" stroke={C.green} name="Equity" />
                <Line type="monotone" dataKey="propertyValue" stroke={C.blue} name="Property Value" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{ marginTop: 40 }}>
          <div style={{ fontSize:18, fontWeight:700, color:C.text, marginBottom:20 }}>Investment Scenarios</div>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:20, height: 400 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="year" stroke={C.muted} />
                <YAxis tickFormatter={fmtM} stroke={C.muted} />
                <Tooltip formatter={(value) => fmt(value)} contentStyle={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, color:C.text }} />
                <Legend />
                <Line type="monotone" dataKey="equity" data={conservative} stroke={RATE_COLORS.conservative} name="Conservative (3%)" />
                <Line type="monotone" dataKey="equity" data={moderate} stroke={RATE_COLORS.moderate} name="Moderate (5%)" />
                <Line type="monotone" dataKey="equity" data={optimistic} stroke={RATE_COLORS.optimistic} name="Optimistic (7%)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}