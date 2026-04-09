import React, { useState, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { SPREADSHEET_ID, ACTUALS_TAB_NAME, INCOME } from "./config.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const CURRENT_YEAR = 2026;
const YEARS = 20;

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmt  = n => "$" + Math.round(n).toLocaleString();
const fmtK = n => (n >= 0 ? "" : "-") + "$" + Math.round(Math.abs(n) / 1000) + "k";
const fmtM = n => "$" + (Math.abs(n) / 1e6).toFixed(2) + "m";

// ─── Tax (AUS 2024/25) ────────────────────────────────────────────────────────
function calcTax(income) {
  if (income <= 18200)  return 0;
  if (income <= 45000)  return (income - 18200) * 0.19;
  if (income <= 120000) return 5092  + (income - 45000)  * 0.325;
  if (income <= 180000) return 29467 + (income - 120000) * 0.37;
  return 51667 + (income - 180000) * 0.45;
}

// ─── Mortgage helpers ─────────────────────────────────────────────────────────
function monthlyRepayment(principal, annualRatePct, termMonths = 300) {
  if (principal <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / termMonths;
  return principal * r / (1 - Math.pow(1 + r, -termMonths));
}

function remainingBalance(principal, annualRatePct, monthsElapsed, termMonths = 300) {
  if (principal <= 0 || monthsElapsed <= 0) return Math.max(0, principal);
  const r = annualRatePct / 100 / 12;
  const pmt = monthlyRepayment(principal, annualRatePct, termMonths);
  if (r === 0) return Math.max(0, principal - pmt * monthsElapsed);
  return Math.max(0, principal * Math.pow(1 + r, monthsElapsed) - pmt * (Math.pow(1 + r, monthsElapsed) - 1) / r);
}

// ─── Scenario palette ─────────────────────────────────────────────────────────
const SCEN = {
  A: { color: "#3d8ef0", label: "A: Keep flat + Invest" },
  B: { color: "#27c99a", label: "B: Sell + Buy house"   },
  C: { color: "#f0a020", label: "C: Status quo"         },
};

// ─── Default lifecycle events ─────────────────────────────────────────────────
const DEFAULT_EVENTS = [
  { id: 1, year: 2027, label: "Youngest starts school (childcare → OOSH ×2)", monthlyDelta: -3200 },
  { id: 2, year: 2032, label: "Child 1: private school Year 5",                monthlyDelta: Math.round(35000 / 12) },
  { id: 3, year: 2034, label: "Child 2: private school Year 5",                monthlyDelta: Math.round(35000 / 12) },
];

// ─── Shared styles ────────────────────────────────────────────────────────────
const PAL = {
  bg: "#070d1a", card: "#0c1422", border: "#142030", text: "#d8e8f5",
  muted: "#3a5570", blue: "#3d8ef0", green: "#27c99a", amber: "#f0a020",
  red: "#e05555", purple: "#9d7ff5",
};

// ─── Shared input styles (module-level so Field can use them) ────────────────
const INP = {
  background: "#060d18", border: "1px solid #1a3050", borderRadius: 7,
  color: PAL.text, padding: "6px 8px", fontSize: 12, fontFamily: "inherit",
  width: "100%", boxSizing: "border-box",
};
const LBL = {
  color: PAL.muted, fontSize: 10, textTransform: "uppercase",
  letterSpacing: "0.08em", display: "block", marginBottom: 3,
};

// ─── Field — module-level so hooks work correctly ────────────────────────────
function Field({ label, value, onChange, noPrefix }) {
  const [draft, setDraft] = useState(null); // null = not editing

  return (
    <div>
      <span style={LBL}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {!noPrefix && <span style={{ color: PAL.muted, fontSize: 12, flexShrink: 0 }}>$</span>}
        <input
          type="text"
          inputMode="numeric"
          value={draft !== null ? draft : String(value)}
          onFocus={e => { setDraft(String(value)); e.target.select(); }}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => {
            const n = parseFloat((draft || "").replace(/[^0-9.-]/g, ""));
            if (!isNaN(n)) onChange(n);
            setDraft(null);
          }}
          style={INP}
        />
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PropertyModel({ onSwitch }) {

  // Current situation
  const [flatValue,    setFlatValue]    = useState(1850000);
  const [mortgageOwing, setMortgageOwing] = useState(1200000);
  const [currentRate,  setCurrentRate]  = useState(5.89);
  const [cashSavings,  setCashSavings]  = useState(0);

  // Income & expenses (overridden by "Load from Sheet")
  // These are NET take-home figures (after PAYG) — do NOT apply calcTax() again
  const [monthlyNetIncome,     setMonthlyNetIncome]     = useState(INCOME.reduce((s, p) => s + p.monthly, 0));
  const [baseMonthlyLiving,    setBaseMonthlyLiving]    = useState(15000);  // includes existing mortgage
  const [baseMonthlyChildcare, setBaseMonthlyChildcare] = useState(4000);

  // Assumptions
  const [inflationRate,   setInflationRate]   = useState(3);
  const [incomeGrowth,    setIncomeGrowth]    = useState(3.5);
  const [propertyGrowth,  setPropertyGrowth]  = useState(6.9); // Collaroy Plateau CAGR 2017-2025
  const [rentGrowth,      setRentGrowth]      = useState(4);

  // Scenario A — keep flat + investment property
  const [invPrice,   setInvPrice]   = useState(1000000);
  const [invRate,    setInvRate]    = useState(6.5);
  const [weeklyRent, setWeeklyRent] = useState(700);

  // Scenario B — sell flat + buy Collaroy Plateau house
  const [housePrice, setHousePrice] = useState(2600000); // median Sep25-Mar26
  const [houseRate,  setHouseRate]  = useState(5.89);

  // Scenario C — keep flat, invest cash
  const [cashReturn, setCashReturn] = useState(7);

  // Lifecycle events
  const [events, setEvents] = useState(DEFAULT_EVENTS);

  // Google Sheets
  const [googleToken, setGoogleToken] = useState(null);
  const [loadStatus,  setLoadStatus]  = useState(null);

  // ── Styles ─────────────────────────────────────────────────────────────────
  // ── Google sign-in ──────────────────────────────────────────────────────────
  const signInGoogle = () => {
    if (!window.google) { alert("Google sign-in not loaded"); return; }
    window.google.accounts.oauth2.initTokenClient({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      callback: resp => { if (resp.access_token) setGoogleToken(resp.access_token); },
    }).requestAccessToken();
  };

  const sheetsApi = async path => {
    const resp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}${path}`, {
      headers: { Authorization: `Bearer ${googleToken}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) throw new Error(`Sheets API ${resp.status}`);
    return resp.json();
  };

  const loadFromSheet = async () => {
    if (!googleToken) { signInGoogle(); return; }
    setLoadStatus("loading");
    try {
      const { values = [] } = await sheetsApi(`/values/${encodeURIComponent(ACTUALS_TAB_NAME)}`);
      const labelRow  = values[0] || [];
      const actualCols = labelRow.reduce((acc, l, i) => (i > 0 && l === "Actual" ? [...acc, i] : acc), []);
      if (!actualCols.length) throw new Error("No reconciled months found");
      // Median: robust against partial months (e.g. April only half-imported)
      const median = name => {
        const row = values.find(r => (r[0] || "").trim().toLowerCase() === name.toLowerCase());
        if (!row) return 0;
        const vals = actualCols
          .map(c => parseFloat((row[c] || "0").replace(/[$,]/g, "")) || 0)
          .filter(v => v > 0)
          .sort((a, b) => a - b);
        if (!vals.length) return 0;
        const mid = Math.floor(vals.length / 2);
        return vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
      };
      // Most recent month: use for income to reflect latest salary
      const mostRecent = name => {
        const row = values.find(r => (r[0] || "").trim().toLowerCase() === name.toLowerCase());
        if (!row) return 0;
        return parseFloat((row[actualCols[actualCols.length - 1]] || "0").replace(/[$,]/g, "")) || 0;
      };
      const living = median("Living Total");
      const cc     = median("Childcare Total");
      const income = mostRecent("Income");  // April = new salary
      const loaded = {};
      if (living > 0)  { setBaseMonthlyLiving(Math.round(living));      loaded.living  = Math.round(living); }
      if (cc > 0)      { setBaseMonthlyChildcare(Math.round(cc));        loaded.cc      = Math.round(cc); }
      if (income > 0)  { setMonthlyNetIncome(Math.round(income));         loaded.income  = Math.round(income); }
      console.log("[Sheet load]", loaded);
      setLoadStatus({ done: true, months: actualCols.length, loaded });
    } catch (e) {
      setLoadStatus({ error: e.message });
    }
  };

  // ── Projection engine ───────────────────────────────────────────────────────
  const projData = useMemo(() => {
    const inf   = inflationRate  / 100;
    const incG  = incomeGrowth   / 100;
    const propG = propertyGrowth / 100;
    const rentG = rentGrowth     / 100;
    const cashG = cashReturn     / 100;

    // Fixed nominal mortgage payments (don't inflate)
    const flatMthly = monthlyRepayment(mortgageOwing, currentRate);

    // Non-mortgage base — this part inflates
    const baseNonMortgage = Math.max(0, baseMonthlyLiving - flatMthly) + baseMonthlyChildcare;

    // Scenario A: investment property
    const invMortgage = Math.max(0, invPrice - cashSavings);
    const invMthly    = monthlyRepayment(invMortgage, invRate);

    // Scenario B: sell flat → buy house
    const flatEquity    = flatValue - mortgageOwing;
    const houseMortgage = Math.max(0, housePrice - flatEquity - cashSavings);
    const houseMthly    = monthlyRepayment(houseMortgage, houseRate);

    return Array.from({ length: YEARS + 1 }, (_, i) => {
      const year = CURRENT_YEAR + i;

      // Lifecycle: sum all active event deltas (in today's dollars, then inflated with base)
      const eventDelta = events.reduce((sum, ev) => year >= ev.year ? sum + ev.monthlyDelta : sum, 0);
      const nonMortgageExp = Math.max(0, baseNonMortgage + eventDelta) * Math.pow(1 + inf, i);

      // Income after tax
      // Income is already net take-home — grow it at incomeGrowth rate
      const netMthlyIncome = monthlyNetIncome * Math.pow(1 + incG, i);

      // Flat
      const flatV  = flatValue * Math.pow(1 + propG, i);
      const flatBal = remainingBalance(mortgageOwing, currentRate, i * 12);
      const flatEq  = flatV - flatBal;

      // ── Scenario A ─────────────────────────────────────────────────────────
      const invV   = invPrice * Math.pow(1 + propG, i);
      const invBal = remainingBalance(invMortgage, invRate, i * 12);
      const rental = weeklyRent * 52 / 12 * Math.pow(1 + rentG, i);
      // Negative gearing: interest + 1% maintenance vs rental income; 37% marginal rate
      const invInterest = invBal * (invRate / 100) / 12;
      const invMaint    = invV * 0.01 / 12;
      const rentalLoss  = rental - invInterest - invMaint;
      const negGear     = rentalLoss < 0 ? Math.abs(rentalLoss) * 0.37 : 0;

      const A_cashFlow = netMthlyIncome - nonMortgageExp - flatMthly + rental + negGear - invMthly;
      const A_netWorth = flatEq + (invV - invBal);

      // ── Scenario B ─────────────────────────────────────────────────────────
      const houseV   = housePrice * Math.pow(1 + propG, i);
      const houseBal = remainingBalance(houseMortgage, houseRate, i * 12);

      const B_cashFlow = netMthlyIncome - nonMortgageExp - houseMthly;
      const B_netWorth = houseV - houseBal;

      // ── Scenario C ─────────────────────────────────────────────────────────
      const investedCash = cashSavings * Math.pow(1 + cashG, i);

      const C_cashFlow = netMthlyIncome - nonMortgageExp - flatMthly;
      const C_netWorth = flatEq + investedCash;

      return {
        year,
        income:   Math.round(netMthlyIncome),
        expenses: Math.round(nonMortgageExp + flatMthly),
        A: { cashFlow: Math.round(A_cashFlow), netWorth: Math.round(A_netWorth) },
        B: { cashFlow: Math.round(B_cashFlow), netWorth: Math.round(B_netWorth) },
        C: { cashFlow: Math.round(C_cashFlow), netWorth: Math.round(C_netWorth) },
      };
    });
  }, [
    mortgageOwing, currentRate, flatValue, cashSavings,
    monthlyNetIncome, baseMonthlyLiving, baseMonthlyChildcare,
    inflationRate, incomeGrowth, propertyGrowth, rentGrowth, cashReturn,
    invPrice, invRate, weeklyRent,
    housePrice, houseRate,
    events,
  ]);

  // ── Chart data ──────────────────────────────────────────────────────────────
  const cashFlowChart = projData.map(d => ({
    year: d.year,
    [SCEN.A.label]: d.A.cashFlow,
    [SCEN.B.label]: d.B.cashFlow,
    [SCEN.C.label]: d.C.cashFlow,
  }));
  const netWorthChart = projData.map(d => ({
    year: d.year,
    [SCEN.A.label]: d.A.netWorth,
    [SCEN.B.label]: d.B.netWorth,
    [SCEN.C.label]: d.C.netWorth,
  }));
  const eventYears = events.map(e => e.year);

  const ChartCard = ({ title, sub, data, yFmt }) => (
    <div style={{ background: PAL.card, border: `1px solid ${PAL.border}`, borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: PAL.text, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 10, color: PAL.muted, marginBottom: 14 }}>{sub}</div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={PAL.border} />
          <XAxis dataKey="year" stroke={PAL.muted} tick={{ fontSize: 10 }} />
          <YAxis tickFormatter={yFmt} stroke={PAL.muted} tick={{ fontSize: 10 }} width={58} />
          <Tooltip formatter={v => fmt(v)} labelFormatter={l => `Year: ${l}`}
            contentStyle={{ background: PAL.card, border: `1px solid ${PAL.border}`, borderRadius: 8, color: PAL.text, fontSize: 11 }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {eventYears.map(y => <ReferenceLine key={y} x={y} stroke={PAL.muted} strokeDasharray="4 2" label={{ value: y, position: "top", fontSize: 8, fill: PAL.muted }} />)}
          <ReferenceLine y={0} stroke={PAL.red} strokeDasharray="2 2" />
          {Object.entries(SCEN).map(([k, s]) => (
            <Line key={k} type="monotone" dataKey={s.label} stroke={s.color} dot={false} strokeWidth={2} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );

  // ── Derived display values ──────────────────────────────────────────────────
  const flatEquity      = flatValue - mortgageOwing;
  const invMortgageAmt  = Math.max(0, invPrice - cashSavings);
  const houseMortgageAmt = Math.max(0, housePrice - flatEquity - cashSavings);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'DM Mono','Fira Code',monospace", background: PAL.bg, minHeight: "100vh", color: PAL.text, padding: 24, fontSize: 13 }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#eef4ff" }}>Property Scenario Planner</div>
            <div style={{ fontSize: 11, color: PAL.muted, marginTop: 3 }}>
              20-year projection · Northern Beaches · Collaroy Plateau CAGR 6.9% (2017–2025)
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {!googleToken
              ? <button onClick={signInGoogle} style={{ background: "#1a4a8a", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  Connect Google
                </button>
              : <button onClick={loadFromSheet} disabled={loadStatus === "loading"}
                  style={{ background: loadStatus?.done ? "#1a5a3a" : "#1a4a8a", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  {loadStatus === "loading" ? "Loading…" : loadStatus?.done ? `✓ Loaded (${loadStatus.months}mo avg)` : "Load from Sheet →"}
                </button>
            }
            {loadStatus?.error && <span style={{ fontSize: 10, color: PAL.red }}>{loadStatus.error}</span>}
            {loadStatus?.done && loadStatus.loaded && (
              <span style={{ fontSize: 10, color: PAL.muted }}>
                Living: {loadStatus.loaded.living ? `$${loadStatus.loaded.living.toLocaleString()}` : "—"} ·
                Childcare: {loadStatus.loaded.cc ? `$${loadStatus.loaded.cc.toLocaleString()}` : "—"} ·
                Income: {loadStatus.loaded.income ? `$${loadStatus.loaded.income.toLocaleString()}/mo` : "—"}
              </span>
            )}
            <button onClick={onSwitch} style={{ background: PAL.blue, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              Budget Tracker
            </button>
          </div>
        </div>

        {/* Inputs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>

          {/* Current situation */}
          <div style={{ background: PAL.card, border: `1px solid ${PAL.border}`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: PAL.text, marginBottom: 12 }}>Current Situation</div>
            <div style={{ display: "grid", gap: 9 }}>
              <Field label="Flat Value"                        value={flatValue}            onChange={setFlatValue} />
              <Field label="Mortgage Owing"                    value={mortgageOwing}        onChange={setMortgageOwing} />
              <Field label="Interest Rate %"                   value={currentRate}          onChange={setCurrentRate}  step={0.01} noPrefix />
              <Field label="Cash Savings"                      value={cashSavings}          onChange={setCashSavings} />
              <Field label="Monthly Net Income (take-home)"    value={monthlyNetIncome}     onChange={setMonthlyNetIncome} step={100} />
              <Field label="Monthly Living (incl. mortgage)"   value={baseMonthlyLiving}    onChange={setBaseMonthlyLiving} step={100} />
              <Field label="Monthly Childcare"                 value={baseMonthlyChildcare} onChange={setBaseMonthlyChildcare} step={100} />
            </div>
          </div>

          {/* Scenario A */}
          <div style={{ background: "#080f1e", border: `1px solid ${PAL.blue}55`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: PAL.blue, marginBottom: 2 }}>Scenario A</div>
            <div style={{ fontSize: 10, color: PAL.muted, marginBottom: 12 }}>Keep flat + buy investment property</div>
            <div style={{ display: "grid", gap: 9 }}>
              <Field label="Investment Property Price" value={invPrice}   onChange={setInvPrice} />
              <Field label="Investment Rate %"         value={invRate}    onChange={setInvRate}  step={0.01} noPrefix />
              <Field label="Weekly Rent"               value={weeklyRent} onChange={setWeeklyRent} step={50} />
              <div style={{ background: "#060d18", borderRadius: 6, padding: "8px 10px", fontSize: 10, color: PAL.muted, lineHeight: 1.8 }}>
                Deposit (savings): {fmt(cashSavings)}<br />
                Mortgage: {fmt(invMortgageAmt)}<br />
                Monthly repayment: {fmt(monthlyRepayment(invMortgageAmt, invRate))}<br />
                Monthly rental: {fmt(weeklyRent * 52 / 12)}<br />
                <span style={{ color: PAL.blue }}>Neg. gearing @ 37% marginal</span>
              </div>
            </div>
          </div>

          {/* Scenario B */}
          <div style={{ background: "#081410", border: `1px solid ${PAL.green}55`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: PAL.green, marginBottom: 2 }}>Scenario B</div>
            <div style={{ fontSize: 10, color: PAL.muted, marginBottom: 12 }}>Sell flat + buy house (Collaroy Plateau median)</div>
            <div style={{ display: "grid", gap: 9 }}>
              <Field label="House Price"    value={housePrice} onChange={setHousePrice} />
              <Field label="Home Loan Rate %" value={houseRate} onChange={setHouseRate} step={0.01} noPrefix />
              <div style={{ background: "#060d18", borderRadius: 6, padding: "8px 10px", fontSize: 10, color: PAL.muted, lineHeight: 1.8 }}>
                Flat equity: {fmt(flatEquity)}<br />
                + Cash savings: {fmt(cashSavings)}<br />
                Deposit total: {fmt(flatEquity + cashSavings)}<br />
                Mortgage: {fmt(houseMortgageAmt)}<br />
                Monthly repayment: {fmt(monthlyRepayment(houseMortgageAmt, houseRate))}
              </div>
            </div>
          </div>

          {/* Scenario C + Assumptions */}
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ background: "#14100a", border: `1px solid ${PAL.amber}55`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: PAL.amber, marginBottom: 2 }}>Scenario C</div>
              <div style={{ fontSize: 10, color: PAL.muted, marginBottom: 12 }}>Keep flat + invest cash savings</div>
              <Field label="Investment Return %" value={cashReturn} onChange={setCashReturn} step={0.5} noPrefix />
            </div>
            <div style={{ background: PAL.card, border: `1px solid ${PAL.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: PAL.muted, marginBottom: 10 }}>Assumptions</div>
              <div style={{ display: "grid", gap: 8 }}>
                <Field label="CPI / Inflation %"  value={inflationRate}  onChange={setInflationRate}  step={0.5} noPrefix />
                <Field label="Income Growth %"    value={incomeGrowth}   onChange={setIncomeGrowth}   step={0.5} noPrefix />
                <Field label="Property Growth %"  value={propertyGrowth} onChange={setPropertyGrowth} step={0.1} noPrefix />
                <Field label="Rent Growth %"      value={rentGrowth}     onChange={setRentGrowth}     step={0.5} noPrefix />
              </div>
            </div>
          </div>
        </div>

        {/* Lifecycle events */}
        <div style={{ background: PAL.card, border: `1px solid ${PAL.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: PAL.text, marginBottom: 10 }}>Lifecycle Events</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {events.map(ev => (
              <div key={ev.id} style={{ background: "#060d18", borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 10, color: PAL.muted, marginBottom: 8 }}>{ev.label}</div>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <div style={{ width: 72 }}>
                    <span style={lbl}>Year</span>
                    <input type="text" inputMode="numeric" value={ev.year} style={INP}
                      onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n)) setEvents(evs => evs.map(x => x.id === ev.id ? { ...x, year: n } : x)); }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={LBL}>Monthly Δ $</span>
                    <input type="text" inputMode="numeric" value={ev.monthlyDelta} style={INP}
                      onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n)) setEvents(evs => evs.map(x => x.id === ev.id ? { ...x, monthlyDelta: n } : x)); }} />
                  </div>
                  <span style={{ fontSize: 12, color: ev.monthlyDelta < 0 ? PAL.green : PAL.amber, paddingBottom: 8 }}>
                    {ev.monthlyDelta < 0 ? "↓" : "↑"}{fmtK(Math.abs(ev.monthlyDelta))}/mo
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Scenario summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
          {Object.entries(SCEN).map(([k, s]) => (
            <div key={k} style={{ background: PAL.card, border: `1px solid ${s.color}44`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: s.color, marginBottom: 10 }}>{s.label}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, textAlign: "center" }}>
                {[0, 10, 20].map(yr => {
                  const d = projData[yr];
                  return (
                    <div key={yr}>
                      <div style={{ fontSize: 9, color: PAL.muted, textTransform: "uppercase", marginBottom: 4 }}>{yr === 0 ? "Now" : `${yr}yr`}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: d[k].cashFlow >= 0 ? s.color : PAL.red }}>
                        {fmtK(d[k].cashFlow)}<span style={{ fontSize: 9 }}>/mo</span>
                      </div>
                      <div style={{ fontSize: 10, color: PAL.muted, marginTop: 2 }}>{fmtM(d[k].netWorth)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <ChartCard
            title="Monthly Cash Flow"
            sub="Net income after tax, all expenses and mortgage repayments — dashed lines mark lifecycle events"
            data={cashFlowChart}
            yFmt={fmtK}
          />
          <ChartCard
            title="Net Worth"
            sub="Property equity + invested cash across all three scenarios"
            data={netWorthChart}
            yFmt={fmtM}
          />
        </div>

        {/* Detail table */}
        <div style={{ background: PAL.card, border: `1px solid ${PAL.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: PAL.text, marginBottom: 10 }}>
            Year-by-Year Detail <span style={{ color: PAL.muted, fontWeight: 400 }}>(every 2 years · ★ = lifecycle event)</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${PAL.border}` }}>
                  {["Year", "Net income/mo", "Expenses/mo", "CF: A", "CF: B", "CF: C", "Worth: A", "Worth: B", "Worth: C"].map(h => (
                    <th key={h} style={{ textAlign: "right", padding: "6px 8px", color: PAL.muted, fontWeight: 400, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projData.filter((_, i) => i % 2 === 0).map(d => {
                  const isEvent = eventYears.includes(d.year);
                  return (
                    <tr key={d.year} style={{ borderBottom: `1px solid ${PAL.border}22`, background: isEvent ? "#0a1628" : "transparent" }}>
                      <td style={{ padding: "5px 8px", color: isEvent ? PAL.blue : PAL.text, fontWeight: isEvent ? 700 : 400 }}>
                        {d.year}{isEvent ? " ★" : ""}
                      </td>
                      <td style={{ textAlign: "right", padding: "5px 8px", color: PAL.green }}>{fmt(d.income)}</td>
                      <td style={{ textAlign: "right", padding: "5px 8px", color: PAL.amber }}>{fmt(d.expenses)}</td>
                      {["A", "B", "C"].map(k => (
                        <td key={k} style={{ textAlign: "right", padding: "5px 8px", color: d[k].cashFlow >= 0 ? PAL.green : PAL.red }}>
                          {fmt(d[k].cashFlow)}
                        </td>
                      ))}
                      {["A", "B", "C"].map(k => (
                        <td key={k} style={{ textAlign: "right", padding: "5px 8px", color: PAL.muted }}>
                          {fmtM(d[k].netWorth)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
