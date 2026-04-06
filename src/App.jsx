import React, { useState, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

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

export default function App() {
  const [flatValue, setFlatValue] = useState(0);
  const [mortgageOwing, setMortgageOwing] = useState(0);
  const [housePrice, setHousePrice] = useState(0);
  const [invPropPrice, setInvPropPrice] = useState(0);
  const [cashSavings, setCashSavings] = useState(0);
  const [interestRate, setInterestRate] = useState(0);
  const [weeklyRent, setWeeklyRent] = useState(0);
  const [grossIncome, setGrossIncome] = useState(0);
  const [monthlyExpenses, setMonthlyExpenses] = useState(0);
  const [schoolFees, setSchoolFees] = useState(0);
  const [activeTab, setActiveTab] = useState("summary");
  const years = 5;

  const equity = flatValue - mortgageOwing;
  const annualRent = weeklyRent * 52;
  const monthlyRent = annualRent / 12;
  const totalExp = monthlyExpenses + schoolFees;
  const annualTax = calcTax(grossIncome);
  const netMonthlyIncome = (grossIncome - annualTax) / 12;
  const marginalRate = grossIncome > 180000 ? 0.47 : grossIncome > 120000 ? 0.39 : 0.345;

  const scenarios = useMemo(() => {
    const out = {};
    Object.entries(RATES).forEach(([label, gr]) => {
      const r = interestRate / 100 / 12;

      // A: Sell & Upgrade
      const sellCosts = flatValue * 0.02;
      const netSale = flatValue - mortgageOwing - sellCosts;
      const sdA = housePrice * 0.045;
      const depositA = netSale + cashSavings - sdA - housePrice * 0.008;
      const mortA = Math.max(0, housePrice - depositA);
      const repayA = mortA > 0 ? (mortA * r) / (1 - Math.pow(1 + r, -300)) : 0;
      const surplusA = netMonthlyIncome - repayA - totalExp;
      const bcA = borrowingCap(grossIncome, totalExp, 0);
      const houseY5 = housePrice * Math.pow(1 + gr, years);
      const mortAY5 = Math.max(0, mortA * Math.pow(1 + r, years * 12) - repayA * ((Math.pow(1 + r, years * 12) - 1) / r));
      const wealthA = houseY5 - mortAY5;
      const yearlyA = Array.from({ length: years + 1 }, (_, y) => {
        const val = housePrice * Math.pow(1 + gr, y);
        const bal = y === 0 ? mortA : Math.max(0, mortA * Math.pow(1 + r, y * 12) - repayA * ((Math.pow(1 + r, y * 12) - 1) / r));
        return { year: y, equity: val - bal };
      });

      // B: Keep flat + invest
      const invDeposit = invPropPrice * 0.20;
      const sdB = invPropPrice * 0.0675;
      const cashNeededB = invDeposit + sdB + invPropPrice * 0.008;
      const canAffordB = equity * 0.80 + cashSavings >= cashNeededB;
      const flatRepay = (mortgageOwing * r) / (1 - Math.pow(1 + r, -300));
      const invMort = invPropPrice - invDeposit;
      const invRepay = (invMort * r) / (1 - Math.pow(1 + r, -300));
      const totalRepayB = flatRepay + invRepay;
      const annualInterest = invMort * (interestRate / 100);
      const annualPropCosts = invPropPrice * 0.015;
      const ngBenefit = negGearBenefit(annualRent, annualInterest, annualPropCosts, marginalRate);
      const netRentMo = monthlyRent - annualPropCosts / 12 + ngBenefit / 12;
      const surplusB = netMonthlyIncome - totalRepayB - totalExp + netRentMo;
      const bcB = borrowingCap(grossIncome, totalExp, mortgageOwing);
      const flatY5 = flatValue * Math.pow(1 + gr, years);
      const invY5 = invPropPrice * Math.pow(1 + gr, years);
      const flatMortY5 = Math.max(0, mortgageOwing * Math.pow(1 + r, years * 12) - flatRepay * ((Math.pow(1 + r, years * 12) - 1) / r));
      const invMortY5 = Math.max(0, invMort * Math.pow(1 + r, years * 12) - invRepay * ((Math.pow(1 + r, years * 12) - 1) / r));
      const wealthB = (flatY5 - flatMortY5) + (invY5 - invMortY5);
      const houseY5B = housePrice * Math.pow(1 + gr, years);
      const equityY5 = (flatY5 - flatMortY5) + (invY5 - invMortY5);
      const depositNeedY5 = houseY5B * 0.20 + houseY5B * 0.045;
      const ladderGap = equityY5 * 0.80 - depositNeedY5;
      const yearlyB = Array.from({ length: years + 1 }, (_, y) => {
        const fv = flatValue * Math.pow(1 + gr, y);
        const iv = invPropPrice * Math.pow(1 + gr, y);
        const fm = y === 0 ? mortgageOwing : Math.max(0, mortgageOwing * Math.pow(1 + r, y * 12) - flatRepay * ((Math.pow(1 + r, y * 12) - 1) / r));
        const im = y === 0 ? invMort : Math.max(0, invMort * Math.pow(1 + r, y * 12) - invRepay * ((Math.pow(1 + r, y * 12) - 1) / r));
        return { year: y, equity: (fv - fm) + (iv - im) };
      });

      out[label] = {
        A: { wealthA, mortA, repayA, sdA, surplusA, bcA, houseY5, yearlyA },
        B: { wealthB, invMort, invRepay, flatRepay, totalRepayB, surplusB, bcB, ngBenefit, annualInterest, annualPropCosts, netRentMo, cashNeededB, canAffordB, houseY5B, equityY5, ladderGap, depositNeedY5, yearlyB, sdB },
        winner: wealthA > wealthB ? "A" : "B",
        gap: Math.abs(wealthA - wealthB),
      };
    });
    return out;
  }, [flatValue, mortgageOwing, housePrice, invPropPrice, cashSavings, interestRate, weeklyRent, grossIncome, totalExp, netMonthlyIncome, marginalRate, equity, annualRent, monthlyRent, years]);

  const chartData = useMemo(() => Array.from({ length: years + 1 }, (_, y) => {
    const row = { year: `Yr ${y}` };
    Object.entries(scenarios).forEach(([rate, s]) => {
      row[`A_${rate}`] = s.A.yearlyA[y]?.equity;
      row[`B_${rate}`] = s.B.yearlyB[y]?.equity;
    });
    return row;
  }), [scenarios, years]);

  const s = scenarios.moderate;
  const tabs = ["summary", "borrowing", "cashflow", "property ladder", "chart"];
  const inputStyle = { width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "6px 8px", color: "#f1f5f9", fontSize: 13 };
  const labelStyle = { fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 };
  const rowStyle = { display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderBottom: "1px solid #334155" };

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#0f172a", minHeight: "100vh", color: "#e2e8f0", padding: "20px" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>

        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#f8fafc", margin: 0 }}>Property Decision Model</h1>
          <p style={{ color: "#94a3b8", fontSize: 13, margin: "4px 0 0" }}>Upgrade to House vs Keep Flat + Investment Property · 5yr · Northern Beaches Sydney</p>
        </div>

        <div style={{ background: "#1e293b", borderRadius: 12, padding: "14px 18px", marginBottom: 12, display: "flex", gap: 14, flexWrap: "wrap" }}>
          {[
            ["Gross income", grossIncome, setGrossIncome, 10000],
            ["Living expenses /mo", monthlyExpenses, setMonthlyExpenses, 500],
            ["School/childcare /mo", schoolFees, setSchoolFees, 500],
            ["Interest rate %", interestRate, setInterestRate, 0.1],
            ["Weekly rent ($)", weeklyRent, setWeeklyRent, 50],
          ].map(([l, v, set, step]) => (
            <div key={l} style={{ flex: "1 1 130px" }}>
              <div style={labelStyle}>{l}</div>
              <input type="number" value={v} onChange={e => set(Number(e.target.value))} step={step} style={inputStyle} />
            </div>
          ))}
        </div>

        <div style={{ background: "#1e293b", borderRadius: 12, padding: "14px 18px", marginBottom: 16, display: "flex", gap: 14, flexWrap: "wrap" }}>
          {[
            ["Flat value", flatValue, setFlatValue, 50000],
            ["Mortgage owing", mortgageOwing, setMortgageOwing, 50000],
            ["Target house", housePrice, setHousePrice, 50000],
            ["Investment property", invPropPrice, setInvPropPrice, 50000],
            ["Cash savings", cashSavings, setCashSavings, 10000],
          ].map(([l, v, set, step]) => (
            <div key={l} style={{ flex: "1 1 130px" }}>
              <div style={labelStyle}>{l}</div>
              <input type="number" value={v} onChange={e => set(Number(e.target.value))} step={step} style={inputStyle} />
            </div>
          ))}
        </div>

        <div style={{ background: "#1e293b", borderRadius: 8, padding: "10px 18px", marginBottom: 20, display: "flex", gap: 24, flexWrap: "wrap" }}>
          {[
            ["Equity", fmt(equity), "#10b981"],
            ["Net income/mo", fmt(netMonthlyIncome), "#3b82f6"],
            ["Total expenses/mo", fmt(totalExp), "#f87171"],
            ["Marginal tax rate", (marginalRate * 100).toFixed(0) + "%", "#a78bfa"],
            ["NG benefit/yr (B)", fmt(s.B.ngBenefit), "#f59e0b"],
          ].map(([l, v, c]) => (
            <div key={l}>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>{l}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: c }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {tabs.map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              style={{ padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, textTransform: "capitalize",
                background: activeTab === t ? "#3b82f6" : "#1e293b", color: activeTab === t ? "#fff" : "#94a3b8" }}>
              {t}
            </button>
          ))}
        </div>

        {activeTab === "summary" && Object.entries(scenarios).map(([rate, sc]) => (
          <div key={rate} style={{ background: "#1e293b", borderRadius: 12, padding: 20, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#f8fafc", textTransform: "capitalize" }}>
                {rate} growth · {(RATES[rate] * 100).toFixed(0)}%/yr
              </h2>
              <span style={{ background: sc.winner === "B" ? "#064e3b" : "#1e3a5f", color: sc.winner === "B" ? "#34d399" : "#60a5fa",
                borderRadius: 20, padding: "3px 14px", fontSize: 12, fontWeight: 700 }}>
                {sc.winner === "B" ? "📈 Invest wins" : "🏠 Upgrade wins"} by {fmtM(sc.gap)}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[
                { label: "A — Sell & Upgrade to House", wealth: sc.A.wealthA, color: "#3b82f6", surplus: sc.A.surplusA, rows: [
                  ["New mortgage", fmt(sc.A.mortA)],
                  ["Monthly repayment", fmt(sc.A.repayA) + "/mo"],
                  ["Stamp duty", fmt(sc.A.sdA)],
                  ["House value @ Y5", fmt(sc.A.houseY5)],
                  ["Monthly surplus", fmt(sc.A.surplusA)],
                ]},
                { label: "B — Keep Flat + Investment Property", wealth: sc.B.wealthB, color: "#10b981", surplus: sc.B.surplusB, rows: [
                  ["Inv. mortgage", fmt(sc.B.invMort)],
                  ["Total repayments", fmt(sc.B.totalRepayB) + "/mo"],
                  ["Net rent (after costs + NG)", fmt(sc.B.netRentMo) + "/mo"],
                  ["NG benefit /yr", fmt(sc.B.ngBenefit)],
                  ["Monthly surplus", fmt(sc.B.surplusB)],
                ]},
              ].map(({ label, wealth, color, surplus, rows }) => (
                <div key={label} style={{ background: "#0f172a", borderRadius: 10, padding: 16, border: `1px solid ${color}33` }}>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color, marginBottom: 2 }}>{fmt(wealth)}</div>
                  <div style={{ fontSize: 10, color: "#64748b", marginBottom: 12 }}>NET WEALTH @ 5 YRS</div>
                  {rows.map(([k, v]) => (
                    <div key={k} style={rowStyle}>
                      <span style={{ color: "#94a3b8" }}>{k}</span>
                      <span style={{ color: k === "Monthly surplus" ? (surplus > 0 ? "#34d399" : "#f87171") : "#e2e8f0", fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}

        {activeTab === "borrowing" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {[
              { title: "Scenario A — Upgrade", mortgage: s.A.mortA, bc: s.A.bcA, can: s.A.bcA.maxLoan >= s.A.mortA },
              { title: "Scenario B — Investment", mortgage: s.B.invMort, bc: s.B.bcB, can: s.B.bcB.maxLoan >= s.B.invMort },
            ].map(({ title, mortgage, bc, can }) => (
              <div key={title} style={{ background: "#1e293b", borderRadius: 12, padding: 20 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc", margin: "0 0 16px" }}>{title}</h3>
                {[
                  ["Gross income", fmt(grossIncome)],
                  ["Annual tax (est.)", fmt(annualTax)],
                  ["Net monthly income", fmt(netMonthlyIncome)],
                  ["Monthly expenses", fmt(totalExp)],
                  ["Bank assessment rate", "~8.9%"],
                  ["Max borrowing capacity", fmt(bc.maxLoan)],
                  ["Mortgage needed", fmt(mortgage)],
                ].map(([k, v]) => (
                  <div key={k} style={rowStyle}>
                    <span style={{ color: "#94a3b8" }}>{k}</span>
                    <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
                <div style={{ marginTop: 16, padding: 12, borderRadius: 8, textAlign: "center",
                  background: can ? "#064e3b" : "#450a0a", color: can ? "#34d399" : "#fca5a5", fontWeight: 700, fontSize: 14 }}>
                  {can ? "✅ Within borrowing capacity" : "⚠️ May exceed capacity — verify with broker"}
                </div>
              </div>
            ))}
            <div style={{ gridColumn: "1 / -1", background: "#1e293b", borderRadius: 12, padding: 16, fontSize: 12, color: "#94a3b8", lineHeight: 1.7 }}>
              <strong style={{ color: "#e2e8f0" }}>Note:</strong> Banks apply a ~3% serviceability buffer above your actual rate (~8.9% assessment). For Scenario B, lenders typically credit 80% of rental income back against the investment mortgage. A mortgage broker is essential — different lenders assess capacity very differently at this income level.
            </div>
          </div>
        )}

        {activeTab === "cashflow" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              {[
                { title: "Scenario A — Monthly Budget", color: "#3b82f6", rows: [
                  ["Net monthly income", fmt(netMonthlyIncome), "#10b981"],
                  ["Living expenses", "−" + fmt(monthlyExpenses), "#f87171"],
                  ["School / childcare", "−" + fmt(schoolFees), "#f87171"],
                  ["Mortgage repayment", "−" + fmt(s.A.repayA), "#f87171"],
                  ["Monthly surplus", fmt(s.A.surplusA), s.A.surplusA > 0 ? "#34d399" : "#f87171"],
                ]},
                { title: "Scenario B — Monthly Budget", color: "#10b981", rows: [
                  ["Net monthly income", fmt(netMonthlyIncome), "#10b981"],
                  ["Living expenses", "−" + fmt(monthlyExpenses), "#f87171"],
                  ["School / childcare", "−" + fmt(schoolFees), "#f87171"],
                  ["Flat mortgage", "−" + fmt(s.B.flatRepay), "#f87171"],
                  ["Investment mortgage", "−" + fmt(s.B.invRepay), "#f87171"],
                  ["Rental income", "+" + fmt(monthlyRent), "#10b981"],
                  ["Property costs", "−" + fmt(s.B.annualPropCosts / 12), "#f87171"],
                  ["NG tax benefit /mo", "+" + fmt(s.B.ngBenefit / 12), "#f59e0b"],
                  ["Monthly surplus", fmt(s.B.surplusB), s.B.surplusB > 0 ? "#34d399" : "#f87171"],
                ]},
              ].map(({ title, color, rows }) => (
                <div key={title} style={{ background: "#1e293b", borderRadius: 12, padding: 20 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 16px", borderLeft: `3px solid ${color}`, paddingLeft: 10, color: "#f8fafc" }}>{title}</h3>
                  {rows.map(([k, v, c]) => (
                    <div key={k} style={rowStyle}>
                      <span style={{ color: "#94a3b8" }}>{k}</span>
                      <span style={{ color: c, fontWeight: k.includes("surplus") ? 800 : 600 }}>{v}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div style={{ background: "#1e293b", borderRadius: 12, padding: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#f59e0b", margin: "0 0 12px" }}>🔶 Negative Gearing Detail (Scenario B)</h3>
              {[
                ["Annual rental income", fmt(annualRent)],
                ["Annual mortgage interest", fmt(s.B.annualInterest)],
                ["Strata, rates, PM fees (~1.5%)", fmt(s.B.annualPropCosts)],
                ["Annual rental loss", fmt(annualRent - s.B.annualInterest - s.B.annualPropCosts)],
                ["Marginal tax rate", (marginalRate * 100).toFixed(0) + "%"],
                ["Annual NG tax saving", fmt(s.B.ngBenefit)],
                ["5-year total NG benefit", fmt(s.B.ngBenefit * years)],
              ].map(([k, v]) => (
                <div key={k} style={rowStyle}>
                  <span style={{ color: "#94a3b8" }}>{k}</span>
                  <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "property ladder" && (
          <div>
            <div style={{ background: "#1e293b", borderRadius: 12, padding: 20, marginBottom: 16 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 8px", color: "#f8fafc" }}>If you go Scenario B — can you still buy the $2.6m house in 5 years?</h2>
              <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 20, lineHeight: 1.6 }}>At 5%/yr, the target house becomes ~$3.3m by 2030. Does your combined equity keep pace?</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {Object.entries(scenarios).map(([rate, sc]) => (
                  <div key={rate} style={{ background: "#0f172a", borderRadius: 10, padding: 16, border: `1px solid ${sc.B.ladderGap > 0 ? "#10b981" : "#ef4444"}44` }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#f8fafc", textTransform: "capitalize", marginBottom: 12 }}>{rate} · {(RATES[rate] * 100).toFixed(0)}%/yr</div>
                    {[
                      ["House price @ Y5", fmt(sc.B.houseY5B)],
                      ["Your total equity @ Y5", fmt(sc.B.equityY5)],
                      ["Deposit + SD needed", fmt(sc.B.depositNeedY5)],
                      ["Usable equity (80%)", fmt(sc.B.equityY5 * 0.80)],
                      ["Surplus / gap", fmt(sc.B.ladderGap)],
                    ].map(([k, v]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid #1e293b" }}>
                        <span style={{ color: "#94a3b8" }}>{k}</span>
                        <span style={{ color: k === "Surplus / gap" ? (sc.B.ladderGap > 0 ? "#34d399" : "#f87171") : "#e2e8f0", fontWeight: 600 }}>{v}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 12, textAlign: "center", padding: 8, borderRadius: 6,
                      background: sc.B.ladderGap > 0 ? "#064e3b" : "#450a0a",
                      color: sc.B.ladderGap > 0 ? "#34d399" : "#fca5a5", fontSize: 13, fontWeight: 700 }}>
                      {sc.B.ladderGap > 0 ? "✅ Can buy house @ Y5" : "❌ Market moves away"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background: "#1e293b", borderRadius: 12, padding: 20, fontSize: 13, color: "#94a3b8", lineHeight: 1.8 }}>
              <p style={{ margin: "0 0 8px" }}>• <strong style={{ color: "#e2e8f0" }}>Conservative (3%/yr):</strong> Equity keeps pace. The house stays within reach.</p>
              <p style={{ margin: "0 0 8px" }}>• <strong style={{ color: "#e2e8f0" }}>Moderate (5%/yr):</strong> The house appreciates fast — this is the key risk zone for Northern Beaches.</p>
              <p style={{ margin: "0 0 8px" }}>• <strong style={{ color: "#e2e8f0" }}>Optimistic (7%/yr):</strong> Both properties grow strongly but so does the target. Gap is tight.</p>
              <p style={{ margin: 0 }}>• <strong style={{ color: "#f59e0b" }}>Key insight:</strong> At your income and equity level you're not locked out — but the window may be shorter than you think. If the house is a genuine life goal, that has to weigh against the pure wealth numbers.</p>
            </div>
          </div>
        )}

        {activeTab === "chart" && (
          <div style={{ background: "#1e293b", borderRadius: 12, padding: 20 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px", color: "#f8fafc" }}>Net Equity Growth — All Scenarios</h2>
            <p style={{ fontSize: 12, color: "#64748b", marginBottom: 20 }}>Dashed = Scenario A (upgrade). Solid = Scenario B (invest).</p>
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="year" stroke="#64748b" fontSize={12} />
                <YAxis tickFormatter={fmtK} stroke="#64748b" fontSize={11} width={65} />
                <Tooltip formatter={(v) => fmt(v)} contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {Object.entries(RATES).map(([rate]) => [
                  <Line key={`A_${rate}`} type="monotone" dataKey={`A_${rate}`} stroke={RATE_COLORS[rate]} strokeWidth={2} dot={false} strokeDasharray="6 4" name={`A: Upgrade (${rate})`} />,
                  <Line key={`B_${rate}`} type="monotone" dataKey={`B_${rate}`} stroke={RATE_COLORS[rate]} strokeWidth={2.5} dot={false} name={`B: Invest (${rate})`} />,
                ])}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <div style={{ fontSize: 11, color: "#475569", marginTop: 20, lineHeight: 1.6 }}>
          For illustrative purposes only — not financial advice. Consult a licensed financial adviser, mortgage broker, and accountant before making any property decisions.
        </div>
      </div>
    </div>
  );
}
