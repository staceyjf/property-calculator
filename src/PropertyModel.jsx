import React, { useState, useMemo, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { SPREADSHEET_ID, ACTUALS_TAB_NAME, INCOME, SHEET_CATEGORIES } from "./config.js";

// ─── Budget-based monthly baselines (used as initial defaults before sheet load) ─
// annual/quarterly → amortise; irregular → amortise via budget/12; fixedBudget/regular → use as-is
function monthlyFromBudget(isChildcare) {
  return Math.round(
    SHEET_CATEGORIES
      .filter(c => !c.exclude && !!c.childcare === isChildcare)
      .reduce((sum, c) => {
        if (c.quarterly)              return sum + c.budget / 3;
        if (c.annual || c.irregular)  return sum + c.budget / 12;
        return sum + c.budget; // regular monthly or fixedBudget
      }, 0)
  );
}
const BUDGET_MONTHLY_LIVING    = monthlyFromBudget(false); // incl. mortgage
const BUDGET_MONTHLY_CHILDCARE = monthlyFromBudget(true);

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

// ─── NSW Stamp Duty ───────────────────────────────────────────────────────────
function nswStampDuty(price) {
  if (price <= 14000)    return price * 0.0125;
  if (price <= 30000)    return 175   + (price - 14000)   * 0.015;
  if (price <= 80000)    return 415   + (price - 30000)   * 0.0175;
  if (price <= 300000)   return 1290  + (price - 80000)   * 0.035;
  if (price <= 1000000)  return 8990  + (price - 300000)  * 0.045;
  if (price <= 3000000)  return 40490 + (price - 1000000) * 0.055;
  return 150490 + (price - 3000000) * 0.07;
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

// Offset account: same repayment but interest charged only on (balance − offset).
// Simulated month-by-month because the offset proportion changes as the balance falls.
function remainingBalanceWithOffset(principal, annualRatePct, offsetBalance, termMonths, monthsElapsed) {
  if (principal <= 0 || monthsElapsed <= 0) return Math.max(0, principal);
  const r   = annualRatePct / 100 / 12;
  const pmt = monthlyRepayment(principal, annualRatePct, termMonths);
  let bal = principal;
  for (let m = 0; m < monthsElapsed && bal > 0; m++) {
    const interest = Math.max(0, bal - offsetBalance) * r;
    bal = Math.max(0, bal - (pmt - interest));
  }
  return bal;
}

// ─── Scenario palette ─────────────────────────────────────────────────────────
const SCEN = {
  A: { color: "#3d8ef0", label: "A: Keep flat + Invest"    },
  B: { color: "#27c99a", label: "B: Sell + Buy house"      },
  C: { color: "#9d7ff5", label: "C: Reno + Sell 2027"      },
  D: { color: "#f0a020", label: "D: Keep flat + Offset"    },
};

// ─── Default lifecycle events ─────────────────────────────────────────────────
// endYear (optional): first year the cost/income no longer applies (exclusive upper bound)
// isIncome: true  → adds to income each year in range (not inflated, not treated as expense)
// isIncome: false → adds to expenses (positive = more expense, negative = expense saving)
// Year 5 → Year 12 = 8 years; Child 1 starts Yr5 2030 → finishes Yr12 2037 (endYear 2038)
//                             Child 2 starts Yr5 2032 → finishes Yr12 2039 (endYear 2040)
const DEFAULT_EVENTS = [
  { id: 1, year: 2027,                label: "Youngest starts school (childcare → OOSH ×2)", monthlyDelta: -3200 },
  { id: 2, year: 2030, endYear: 2038, label: "Child 1: private school (Yr 5–12)",            monthlyDelta: Math.round(35000 / 12) },
  { id: 3, year: 2032, endYear: 2040, label: "Child 2: private school (Yr 5–12)",            monthlyDelta: Math.round(35000 / 12) },
  // Income events — set the monthly amount (= annual ÷ 12) and the year range they apply
  { id: 4, year: 2026, endYear: 2027, label: "UK income (enter annual ÷ 12)",                monthlyDelta: 0, isIncome: true },
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
  const [cashSavings,  setCashSavings]  = useState(150000);

  // Income & expenses (overridden by "Load from Sheet")
  // These are NET take-home figures (after PAYG) — do NOT apply calcTax() again
  const [monthlyNetIncome,     setMonthlyNetIncome]     = useState(INCOME.reduce((s, p) => s + p.monthly, 0));
  const [andrewAnnualBonus,    setAndrewAnnualBonus]    = useState(0);
  const [staceyAnnualBonus,    setStaceyAnnualBonus]    = useState(0);
  const [baseMonthlyLiving,    setBaseMonthlyLiving]    = useState(BUDGET_MONTHLY_LIVING);    // full budget incl. annual items; overridden by "Load from Sheet"
  const [baseMonthlyChildcare, setBaseMonthlyChildcare] = useState(BUDGET_MONTHLY_CHILDCARE); // same

  // Assumptions
  const [inflationRate,   setInflationRate]   = useState(3);
  const [incomeGrowth,    setIncomeGrowth]    = useState(3.5);
  const [propertyGrowth,  setPropertyGrowth]  = useState(5.5); // long-run excl. COVID spike
  const [rentGrowth,      setRentGrowth]      = useState(4);

  // Scenario A — keep flat + investment property
  const [invPrice,       setInvPrice]       = useState(1000000);
  const [invRate,        setInvRate]        = useState(6.5);
  const [weeklyRent,     setWeeklyRent]     = useState(700);
  const [marginalTaxRate, setMarginalTaxRate] = useState(45); // Andrew's top bracket

  // Scenario B — sell flat + buy Collaroy Plateau house
  const [housePrice, setHousePrice] = useState(2600000); // median Sep25-Mar26
  const [houseRate,  setHouseRate]  = useState(5.89);

  // Scenario D — keep flat, cash in offset account (no extra rate input needed)

  // Scenario D — reno flat, sell in dSaleYear, buy house
  const [dSaleYear,    setDSaleYear]    = useState(2027);
  const [renoCost,     setRenoCost]     = useState(100000);
  const [renoValueAdd, setRenoValueAdd] = useState(150000);

  // Lifecycle events
  const [events, setEvents] = useState(DEFAULT_EVENTS);
  const nextId = useRef(DEFAULT_EVENTS.length + 1);
  const addEvent = (isIncome) => {
    const id = ++nextId.current;
    setEvents(evs => [...evs, {
      id,
      year: CURRENT_YEAR,
      endYear: CURRENT_YEAR + 1,
      label: isIncome ? "New income event" : "New expense event",
      monthlyDelta: 0,
      isIncome,
    }]);
  };
  const removeEvent = id => setEvents(evs => evs.filter(x => x.id !== id));
  const updateEvent = (id, patch) => setEvents(evs => evs.map(x => x.id === id ? { ...x, ...patch } : x));

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

      // Find the Totals column — full-year blend of actuals + budget, just divide by 12
      const totalCol = labelRow.findIndex(l => (l || "").trim().toLowerCase() === "totals");
      if (totalCol === -1) throw new Error("No Totals column found in sheet");

      const getTotal = name => {
        const row = values.find(r => (r[0] || "").trim().toLowerCase() === name.toLowerCase());
        if (!row) return 0;
        return parseFloat((row[totalCol] || "0").replace(/[$,]/g, "")) || 0;
      };

      // Most recent actual month: use for income to capture latest salary
      const mostRecent = name => {
        const row = values.find(r => (r[0] || "").trim().toLowerCase() === name.toLowerCase());
        if (!row) return 0;
        return parseFloat((row[actualCols[actualCols.length - 1]] || "0").replace(/[$,]/g, "")) || 0;
      };

      const living = getTotal("Living Total") / 12;
      const cc     = getTotal("Childcare Total") / 12;
      const income = mostRecent("Income");  // use most-recent month to pick up latest salary
      const loaded = {};
      if (living > 0)  { setBaseMonthlyLiving(Math.round(living));   loaded.living  = Math.round(living); }
      if (cc > 0)      { setBaseMonthlyChildcare(Math.round(cc));     loaded.cc      = Math.round(cc); }
      if (income > 0)  { setMonthlyNetIncome(Math.round(income));     loaded.income  = Math.round(income); }
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

    // Fixed nominal mortgage payments (don't inflate)
    const flatMthly = monthlyRepayment(mortgageOwing, currentRate);

    // Non-mortgage base — this part inflates
    const baseNonMortgage = Math.max(0, baseMonthlyLiving - flatMthly) + baseMonthlyChildcare;

    // Scenario A: investment property — stamp duty comes out of savings first
    const stampDutyA  = nswStampDuty(invPrice);
    const invDeposit  = Math.max(0, cashSavings - stampDutyA);
    const invMortgage = Math.max(0, invPrice - invDeposit);
    const invMthly    = monthlyRepayment(invMortgage, invRate);

    // Scenario B: sell flat → buy house — stamp duty + agent commission (~2%) reduce deposit
    const flatEquity    = flatValue - mortgageOwing;
    const stampDutyB    = nswStampDuty(housePrice);
    const sellingCosts  = flatValue * 0.02; // ~2% agent commission
    const houseDeposit  = Math.max(0, flatEquity + cashSavings - stampDutyB - sellingCosts);
    const houseMortgage = Math.max(0, housePrice - houseDeposit);
    const houseMthly    = monthlyRepayment(houseMortgage, houseRate);

    // Scenario D: reno flat, sell in dSaleYear, buy house at market price that year
    const dIdx           = Math.max(1, dSaleYear - CURRENT_YEAR); // years until sale (min 1)
    const dRenoFlatValue = flatValue + renoValueAdd;              // reno-uplifted flat value base
    const dFlatSaleV     = dRenoFlatValue * Math.pow(1 + propG, dIdx);
    const dFlatBalAtSale = remainingBalance(mortgageOwing, currentRate, dIdx * 12);
    const dSellingCostsD = dFlatSaleV * 0.02;
    const dHousePriceAtSale = housePrice * Math.pow(1 + propG, dIdx);
    const dStampDutyD    = nswStampDuty(dHousePriceAtSale);
    const dCashAtSale    = cashSavings - renoCost;
    const dHouseDepositD = Math.max(0, (dFlatSaleV - dFlatBalAtSale) + dCashAtSale - dStampDutyD - dSellingCostsD);
    const dHouseMortgageD = Math.max(0, dHousePriceAtSale - dHouseDepositD);
    const dHouseMthlyD   = monthlyRepayment(dHouseMortgageD, houseRate);

    return Array.from({ length: YEARS + 1 }, (_, i) => {
      const year = CURRENT_YEAR + i;

      // Lifecycle: split expense events (inflated) from income events (fixed, not inflated)
      const active = ev => year >= ev.year && (ev.endYear == null || year < ev.endYear);
      const expenseDelta = events.reduce((sum, ev) => !ev.isIncome && active(ev) ? sum + ev.monthlyDelta : sum, 0);
      const incomeDelta  = events.reduce((sum, ev) =>  ev.isIncome && active(ev) ? sum + ev.monthlyDelta : sum, 0);
      const nonMortgageExp = Math.max(0, baseNonMortgage + expenseDelta) * Math.pow(1 + inf, i);

      // Income after tax — salary + annual bonuses grow at incomeGrowth; income events are fixed
      const baseMthlyIncome = monthlyNetIncome + (andrewAnnualBonus + staceyAnnualBonus) / 12;
      const netMthlyIncome  = baseMthlyIncome * Math.pow(1 + incG, i) + incomeDelta;

      // Flat
      const flatV  = flatValue * Math.pow(1 + propG, i);
      const flatBal = remainingBalance(mortgageOwing, currentRate, i * 12);
      const flatEq  = flatV - flatBal;

      // ── Scenario A ─────────────────────────────────────────────────────────
      const invV        = invPrice * Math.pow(1 + propG, i);
      const invBal      = remainingBalance(invMortgage, invRate, i * 12);
      const grossRental = weeklyRent * 52 / 12 * Math.pow(1 + rentG, i);
      const mgmtFee     = grossRental * 0.10; // 10% property management fee (tax-deductible)
      const netRental   = grossRental - mgmtFee; // actual cash that arrives in your account
      // Deductibles for tax: interest + maintenance (1% of value) + management fee
      const invInterest    = invBal * (invRate / 100) / 12;
      const invMaint       = invV * 0.01 / 12;
      const taxableRental  = grossRental - invInterest - invMaint - mgmtFee;
      // Negative = loss → tax offset at owner's marginal rate; Positive = profit → taxed at same rate
      const mtr = marginalTaxRate / 100;
      const rentalTaxEffect = taxableRental < 0
        ? Math.abs(taxableRental) * mtr    // refund (positive cash flow)
        : -taxableRental * mtr;            // tax liability (negative cash flow)

      const A_cashFlow = netMthlyIncome - nonMortgageExp - flatMthly + netRental + rentalTaxEffect - invMthly;
      const A_netWorth = flatEq + (invV - invBal);

      // ── Scenario B ─────────────────────────────────────────────────────────
      const houseV   = housePrice * Math.pow(1 + propG, i);
      const houseBal = remainingBalance(houseMortgage, houseRate, i * 12);

      const B_cashFlow = netMthlyIncome - nonMortgageExp - houseMthly;
      const B_netWorth = houseV - houseBal;

      // ── Scenario C (Reno + Sell) ────────────────────────────────────────────
      let C_cashFlow, C_netWorth;
      if (i < dIdx) {
        // Pre-sale: reno'd flat, savings reduced by reno cost
        const cFlatV_i   = dRenoFlatValue * Math.pow(1 + propG, i);
        const cFlatBal_i = remainingBalance(mortgageOwing, currentRate, i * 12);
        C_cashFlow = netMthlyIncome - nonMortgageExp - flatMthly;
        C_netWorth = (cFlatV_i - cFlatBal_i) + (cashSavings - renoCost);
      } else {
        // Post-sale: in new house, mortgage from sale year
        const yrs      = i - dIdx;
        const cHouseV  = dHousePriceAtSale * Math.pow(1 + propG, yrs);
        const cHouseBal = remainingBalance(dHouseMortgageD, houseRate, yrs * 12);
        C_cashFlow = netMthlyIncome - nonMortgageExp - dHouseMthlyD;
        C_netWorth = cHouseV - cHouseBal;
      }

      // ── Scenario D (Offset) ─────────────────────────────────────────────────
      // Repayment is the same as status quo; interest charged only on (balance − offset).
      // Benefit is purely faster equity growth — cash remains accessible in offset.
      const offsetBal  = remainingBalanceWithOffset(mortgageOwing, currentRate, cashSavings, 300, i * 12);
      const D_cashFlow = netMthlyIncome - nonMortgageExp - flatMthly;
      const D_netWorth = flatV - offsetBal + cashSavings;

      return {
        year,
        income:   Math.round(netMthlyIncome),
        expenses: Math.round(nonMortgageExp + flatMthly),
        A: { cashFlow: Math.round(A_cashFlow), netWorth: Math.round(A_netWorth) },
        B: { cashFlow: Math.round(B_cashFlow), netWorth: Math.round(B_netWorth) },
        C: { cashFlow: Math.round(C_cashFlow), netWorth: Math.round(C_netWorth) },
        D: { cashFlow: Math.round(D_cashFlow), netWorth: Math.round(D_netWorth) },
      };
    });
  }, [
    mortgageOwing, currentRate, flatValue, cashSavings,
    monthlyNetIncome, andrewAnnualBonus, staceyAnnualBonus,
    baseMonthlyLiving, baseMonthlyChildcare,
    inflationRate, incomeGrowth, propertyGrowth, rentGrowth,
    invPrice, invRate, weeklyRent, marginalTaxRate,
    housePrice, houseRate,
    dSaleYear, renoCost, renoValueAdd,
    events,
  ]);

  // ── Chart data ──────────────────────────────────────────────────────────────
  const cashFlowChart = projData.map(d => ({
    year: d.year,
    [SCEN.A.label]: d.A.cashFlow,
    [SCEN.B.label]: d.B.cashFlow,
    [SCEN.C.label]: d.C.cashFlow,
    [SCEN.D.label]: d.D.cashFlow,
  }));
  const netWorthChart = projData.map(d => ({
    year: d.year,
    [SCEN.A.label]: d.A.netWorth,
    [SCEN.B.label]: d.B.netWorth,
    [SCEN.C.label]: d.C.netWorth,
    [SCEN.D.label]: d.D.netWorth,
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
  const flatEquity       = flatValue - mortgageOwing;
  const stampDutyADisp   = nswStampDuty(invPrice);
  const invDepositDisp   = Math.max(0, cashSavings - stampDutyADisp);
  const invMortgageAmt   = Math.max(0, invPrice - invDepositDisp);
  const stampDutyBDisp   = nswStampDuty(housePrice);
  const sellingCostsDisp = flatValue * 0.02;
  const houseDepositDisp = Math.max(0, flatEquity + cashSavings - stampDutyBDisp - sellingCostsDisp);
  const houseMortgageAmt = Math.max(0, housePrice - houseDepositDisp);

  // Scenario D display values
  const dIdxDisp         = Math.max(1, dSaleYear - CURRENT_YEAR);
  const pG               = propertyGrowth / 100;
  const dRenoFlatDisp    = flatValue + renoValueAdd;
  const dFlatSaleDisp    = dRenoFlatDisp * Math.pow(1 + pG, dIdxDisp);
  const dFlatBalDisp     = remainingBalance(mortgageOwing, currentRate, dIdxDisp * 12);
  const dSellCostsDisp   = dFlatSaleDisp * 0.02;
  const dHousePriceDisp  = housePrice * Math.pow(1 + pG, dIdxDisp);
  const dStampDutyDDisp  = nswStampDuty(dHousePriceDisp);
  const dCashDisp        = cashSavings - renoCost;
  const dDepositDDisp    = Math.max(0, (dFlatSaleDisp - dFlatBalDisp) + dCashDisp - dStampDutyDDisp - dSellCostsDisp);
  const dMortgageDDisp   = Math.max(0, dHousePriceDisp - dDepositDDisp);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'DM Mono','Fira Code',monospace", background: PAL.bg, minHeight: "100vh", color: PAL.text, padding: 24, fontSize: 13 }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#eef4ff" }}>Property Scenario Planner</div>
            <div style={{ fontSize: 11, color: PAL.muted, marginTop: 3 }}>
              20-year projection · Northern Beaches · long-run ~5.5% p.a. (excl. COVID spike)
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {!googleToken
              ? <button onClick={signInGoogle} style={{ background: "#1a4a8a", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  Connect Google
                </button>
              : <button onClick={loadFromSheet} disabled={loadStatus === "loading"}
                  style={{ background: loadStatus?.done ? "#1a5a3a" : "#1a4a8a", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  {loadStatus === "loading" ? "Loading…" : loadStatus?.done ? `✓ Loaded (annual ÷ 12)` : "Load from Sheet →"}
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>

          {/* Current situation */}
          <div style={{ background: PAL.card, border: `1px solid ${PAL.border}`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: PAL.text, marginBottom: 12 }}>Current Situation</div>
            <div style={{ display: "grid", gap: 9 }}>
              <Field label="Flat Value"                        value={flatValue}            onChange={setFlatValue} />
              <Field label="Mortgage Owing"                    value={mortgageOwing}        onChange={setMortgageOwing} />
              <Field label="Interest Rate %"                   value={currentRate}          onChange={setCurrentRate}  step={0.01} noPrefix />
              <Field label="Cash Savings"                      value={cashSavings}          onChange={setCashSavings} />
              <Field label="Monthly Net Income (take-home)"    value={monthlyNetIncome}     onChange={setMonthlyNetIncome} step={100} />
              <Field label="Andrew Annual Bonus"               value={andrewAnnualBonus}    onChange={setAndrewAnnualBonus} step={1000} />
              <Field label="Stacey Annual Bonus"               value={staceyAnnualBonus}    onChange={setStaceyAnnualBonus} step={1000} />
              <Field label="Monthly Living (incl. mortgage)"   value={baseMonthlyLiving}    onChange={setBaseMonthlyLiving} step={100} />
              <Field label="Monthly Childcare"                 value={baseMonthlyChildcare} onChange={setBaseMonthlyChildcare} step={100} />
            </div>
          </div>

          {/* Scenario A */}
          <div style={{ background: "#080f1e", border: `1px solid ${PAL.blue}55`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: PAL.blue, marginBottom: 2 }}>Scenario A</div>
            <div style={{ fontSize: 10, color: PAL.muted, marginBottom: 12 }}>Keep flat + buy investment property</div>
            <div style={{ display: "grid", gap: 9 }}>
              <Field label="Investment Property Price"  value={invPrice}        onChange={setInvPrice} />
              <Field label="Investment Rate %"          value={invRate}         onChange={setInvRate}  step={0.01} noPrefix />
              <Field label="Weekly Rent"                value={weeklyRent}      onChange={setWeeklyRent} step={50} />
              <Field label="Owner's Marginal Tax Rate %" value={marginalTaxRate} onChange={setMarginalTaxRate} step={1} noPrefix />
              <div style={{ background: "#060d18", borderRadius: 6, padding: "8px 10px", fontSize: 10, color: PAL.muted, lineHeight: 1.8 }}>
                Savings: {fmt(cashSavings)}<br />
                <span style={{ color: PAL.red }}>− Stamp duty: {fmt(stampDutyADisp)}</span><br />
                Deposit: {fmt(invDepositDisp)}<br />
                Mortgage: {fmt(invMortgageAmt)}<br />
                Monthly repayment: {fmt(monthlyRepayment(invMortgageAmt, invRate))}<br />
                Gross rental: {fmt(weeklyRent * 52 / 12)} · Net (−10% mgmt): {fmt(weeklyRent * 52 / 12 * 0.9)}<br />
                <span style={{ color: PAL.blue }}>Neg. gearing @ {marginalTaxRate}% · Profit taxed @ {marginalTaxRate}%</span>
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
                <span style={{ color: PAL.red }}>− Stamp duty: {fmt(stampDutyBDisp)}</span><br />
                <span style={{ color: PAL.red }}>− Selling costs (~2%): {fmt(sellingCostsDisp)}</span><br />
                Deposit: {fmt(houseDepositDisp)}<br />
                Mortgage: {fmt(houseMortgageAmt)}<br />
                Monthly repayment: {fmt(monthlyRepayment(houseMortgageAmt, houseRate))}
              </div>
            </div>
          </div>

          {/* Scenario C (Reno + Sell) + Assumptions */}
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ background: "#100a18", border: `1px solid ${PAL.purple}55`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: PAL.purple, marginBottom: 2 }}>Scenario C</div>
              <div style={{ fontSize: 10, color: PAL.muted, marginBottom: 12 }}>Reno flat, sell + buy house in {dSaleYear}</div>
              <div style={{ display: "grid", gap: 9 }}>
                <Field label="Reno Cost"      value={renoCost}     onChange={setRenoCost} />
                <Field label="Reno Value Add" value={renoValueAdd} onChange={setRenoValueAdd} />
                <div>
                  <span style={LBL}>Sale Year</span>
                  <input type="text" inputMode="numeric" value={dSaleYear} style={INP}
                    onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= CURRENT_YEAR + 1) setDSaleYear(n); }} />
                </div>
                <div style={{ background: "#060d18", borderRadius: 6, padding: "8px 10px", fontSize: 10, color: PAL.muted, lineHeight: 1.8 }}>
                  Flat (reno'd + {dIdxDisp}yr growth): {fmt(dFlatSaleDisp)}<br />
                  <span style={{ color: PAL.red }}>− Mortgage bal: {fmt(dFlatBalDisp)}</span><br />
                  <span style={{ color: PAL.red }}>− Selling costs: {fmt(dSellCostsDisp)}</span><br />
                  Cash avail (savings − reno): {fmt(dCashDisp)}<br />
                  House price in {dSaleYear}: {fmt(dHousePriceDisp)}<br />
                  <span style={{ color: PAL.red }}>− Stamp duty: {fmt(dStampDutyDDisp)}</span><br />
                  Deposit: {fmt(dDepositDDisp)} · Mortgage: {fmt(dMortgageDDisp)}<br />
                  Monthly repayment: {fmt(monthlyRepayment(dMortgageDDisp, houseRate))}
                </div>
              </div>
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

          {/* Scenario D (Offset) */}
          <div style={{ background: "#14100a", border: `1px solid ${PAL.amber}55`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: PAL.amber, marginBottom: 2 }}>Scenario D</div>
            <div style={{ fontSize: 10, color: PAL.muted, marginBottom: 12 }}>Keep flat — cash in offset account</div>
            <div style={{ background: "#060d18", borderRadius: 6, padding: "8px 10px", fontSize: 10, color: PAL.muted, lineHeight: 1.9, marginTop: 8 }}>
              Offset balance: {fmt(cashSavings)}<br />
              Effective interest on: {fmt(mortgageOwing)} − {fmt(cashSavings)} = {fmt(mortgageOwing - cashSavings)}<br />
              Monthly interest saving: {fmt(cashSavings * (currentRate / 100) / 12)}/mo<br />
              <span style={{ color: PAL.amber }}>
                Equivalent return: {currentRate}% guaranteed, tax-free<br />
                vs 7% invested @ 45% tax = ~{(7 * (1 - 0.45)).toFixed(1)}% net
              </span><br />
              Same repayment as status quo — benefit shows in faster equity buildup.
            </div>
          </div>
        </div>

        {/* Lifecycle events */}
        <div style={{ background: PAL.card, border: `1px solid ${PAL.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: PAL.text }}>Lifecycle Events</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: PAL.muted }}>
                <span style={{ color: PAL.amber }}>■</span> expense &nbsp;
                <span style={{ color: PAL.green }}>■</span> income (not inflated · enter annual ÷ 12)
              </span>
              <button onClick={() => addEvent(true)}
                style={{ background: "#0a2010", border: `1px solid ${PAL.green}55`, borderRadius: 6, color: PAL.green, fontSize: 10, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit" }}>
                + Income event
              </button>
              <button onClick={() => addEvent(false)}
                style={{ background: "#1a1000", border: `1px solid ${PAL.amber}55`, borderRadius: 6, color: PAL.amber, fontSize: 10, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit" }}>
                + Expense event
              </button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {events.map(ev => {
              const accent = ev.isIncome ? PAL.green : PAL.amber;
              return (
                <div key={ev.id} style={{ background: "#060d18", borderRadius: 8, padding: 10, borderLeft: `2px solid ${accent}44` }}>
                  {/* Label row + delete */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <input
                      type="text"
                      value={ev.label}
                      onChange={e => updateEvent(ev.id, { label: e.target.value })}
                      style={{ ...INP, fontSize: 10, color: accent, background: "transparent", border: "none", padding: 0, fontWeight: ev.isIncome ? 600 : 400 }}
                    />
                    <button onClick={() => removeEvent(ev.id)}
                      style={{ background: "none", border: "none", color: PAL.muted, fontSize: 13, cursor: "pointer", lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
                      title="Remove event">×</button>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                    <div style={{ width: 66 }}>
                      <span style={LBL}>Start yr</span>
                      <input type="text" inputMode="numeric" value={ev.year} style={INP}
                        onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n)) updateEvent(ev.id, { year: n }); }} />
                    </div>
                    <div style={{ width: 66 }}>
                      <span style={LBL}>End yr</span>
                      <input type="text" inputMode="numeric" value={ev.endYear ?? ""} placeholder="open" style={INP}
                        onChange={e => { const n = parseInt(e.target.value); updateEvent(ev.id, { endYear: isNaN(n) ? undefined : n }); }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <span style={LBL}>{ev.isIncome ? "Monthly Δ $ (− = loss)" : "Monthly Δ $"}</span>
                      <input type="text" inputMode="numeric" value={ev.monthlyDelta} style={INP}
                        onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n)) updateEvent(ev.id, { monthlyDelta: n }); }} />
                    </div>
                    <span style={{ fontSize: 12, paddingBottom: 8, color:
                      ev.isIncome
                        ? (ev.monthlyDelta >= 0 ? PAL.green : PAL.red)
                        : (ev.monthlyDelta <= 0 ? PAL.green : PAL.amber)
                    }}>
                      {ev.isIncome
                        ? (ev.monthlyDelta >= 0 ? "+" : "−")
                        : (ev.monthlyDelta < 0 ? "↓" : "↑")}
                      {fmtK(Math.abs(ev.monthlyDelta))}/mo
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Scenario summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
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
            sub="Property equity + invested cash across all four scenarios"
            data={netWorthChart}
            yFmt={fmtM}
          />
        </div>

        {/* Detail table */}
        <div style={{ background: PAL.card, border: `1px solid ${PAL.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: PAL.text, marginBottom: 10 }}>
            Year-by-Year Detail <span style={{ color: PAL.muted, fontWeight: 400 }}>(every 2 years + event years · ★ = lifecycle event)</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${PAL.border}` }}>
                  {["Year", "Net income/mo", "Expenses/mo", "CF: A", "CF: B", "CF: C", "CF: D", "Worth: A", "Worth: B", "Worth: C", "Worth: D"].map(h => (
                    <th key={h} style={{ textAlign: "right", padding: "6px 8px", color: PAL.muted, fontWeight: 400, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projData.filter((d, i) => i % 2 === 0 || eventYears.includes(d.year)).map(d => {
                  const isEvent = eventYears.includes(d.year);
                  return (
                    <tr key={d.year} style={{ borderBottom: `1px solid ${PAL.border}22`, background: isEvent ? "#0a1628" : "transparent" }}>
                      <td style={{ padding: "5px 8px", color: isEvent ? PAL.blue : PAL.text, fontWeight: isEvent ? 700 : 400 }}>
                        {d.year}{isEvent ? " ★" : ""}
                      </td>
                      <td style={{ textAlign: "right", padding: "5px 8px", color: PAL.green }}>{fmt(d.income)}</td>
                      <td style={{ textAlign: "right", padding: "5px 8px", color: PAL.amber }}>{fmt(d.expenses)}</td>
                      {["A", "B", "C", "D"].map(k => (
                        <td key={k} style={{ textAlign: "right", padding: "5px 8px", color: d[k].cashFlow >= 0 ? PAL.green : PAL.red }}>
                          {fmt(d[k].cashFlow)}
                        </td>
                      ))}
                      {["A", "B", "C", "D"].map(k => (
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
