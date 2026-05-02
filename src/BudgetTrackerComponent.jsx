import React, { useState, useRef } from "react";
import Papa from 'papaparse';
import { SHEET_CATEGORIES, UP_TO_SHEET, PAYEE_MAPPINGS, SPREADSHEET_ID, ACTUALS_TAB_NAME, INCOME } from './config.js';

const MONTHS =["January","February","March","April","May","June","July","August","September","October","November","December"];

// ─── Robust CSV parser using PapaParse ───────────────────────────────────
function parseUpCSV(text) {
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.replace(/[\uFEFF\xEF\xBB\xBF]/g, "").trim()
  });
  const headers = result.meta.fields;

  // Find columns by substring match (robust against slight naming differences)
  function findCol(needle) {
    return headers.findIndex(h => h.toLowerCase().includes(needle.toLowerCase()));
  }
  const iDate = findCol("time");
  const iPayee = findCol("payee");
  const iDesc = findCol("description");
  const iCat = findCol("category");
  const iAmt = findCol("subtotal (aud)");
  const iType = findCol("transaction type");

  const txs = [];
  for (const row of result.data) {
    const type = (row[headers[iType]] || "").toLowerCase();
    const upCat = row[headers[iCat]] || "";
    if (type === "transfer" && upCat.toLowerCase() === "forward") continue;
    const amt = parseFloat(row[headers[iAmt]]);
    if (isNaN(amt) || amt >= 0) continue; // expenses are negative
    const payee = row[headers[iPayee]] || row[headers[iDesc]] || "";
    const sheetCat = UP_TO_SHEET[upCat] || null;
    let category = sheetCat;
    if (!category) {
      for (const [key, cat] of Object.entries(PAYEE_MAPPINGS)) {
        if (payee.toLowerCase().includes(key.toLowerCase())) {
          category = cat;
          break;
        }
      }
    }
    txs.push({
      date: (row[headers[iDate]] || "").substring(0, 10),
      payee: payee,
      amount: Math.abs(amt),
      upCategory: upCat,
      category: category,
      source: "Up",
      needsReview: !category,
    });
  }
  return txs;
}

// ─── AMP CSV parser ───────────────────────────────────────────────────────────
const AMP_MONTHS = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };

function parseAMPDate(str) {
  const m = str.match(/^(\d{2})-([A-Za-z]{3})-(\d{2})$/);
  if (!m) return str;
  return `20${m[3]}-${String(AMP_MONTHS[m[2]] || 1).padStart(2,"0")}-${m[1]}`;
}

function extractAMPPayee(desc) {
  return desc
    .replace(/^PENDING TRANSACTION - /, "")
    .replace(/^Purchase - /, "")
    .replace(/^Direct Entry (?:Debit|Credit) Item Ref:\s+\S+\s+/, "")
    .replace(/^Internet banking (?:scheduled )?(?:bill payment|external transfer)\s+\S+(?:\s+\S+)?\s*-\s*/, "")
    .replace(/^(?:Withdrawal|Refund) - /, "")
    .replace(/^Transfer (?:to|from) - /, "")
    .replace(/\s{2,}[A-Z][A-Z &'*]+\s+AU\(\d{2}\/\d{2}\)\s*$/, "")
    .trim();
}

function parseAMPCSV(text) {
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/);
  const headerIdx = lines.findIndex(l => {
    const stripped = l.trim().replace(/"/g, "");
    return /^Date[,\t]Description/i.test(stripped);
  });
  if (headerIdx === -1) return null;

  const result = Papa.parse(lines.slice(headerIdx).join("\n"), {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim().replace(/"/g, ""),
  });

  const txs = [];
  for (const row of result.data) {
    const desc = (row.Description || "").trim();
    if (!desc) continue;
    if (/^PENDING/i.test(desc)) continue;
    if (/Transfer from/i.test(desc)) continue;
    if (/Inward swift/i.test(desc)) continue;
    if (/QANTAS MONEY CC/i.test(desc)) continue;
    if (/Transfer to PayID Superhero/i.test(desc)) continue;
    if (/Transfer to andrew fanner/i.test(desc)) continue;
    if (/Transfer to PayID S J FANNER/i.test(desc)) continue;

    const amtStr = (row.Amount || "").replace(/[$,]/g, "");
    const amt = parseFloat(amtStr);
    if (isNaN(amt) || amt >= 0) continue;

    let category = null;
    for (const [key, cat] of Object.entries(PAYEE_MAPPINGS)) {
      if (desc.toLowerCase().includes(key.toLowerCase())) { category = cat; break; }
    }

    txs.push({
      date:        parseAMPDate((row.Date || "").trim()),
      payee:       extractAMPPayee(desc),
      amount:      Math.abs(amt),
      upCategory:  "",
      category,
      source:      "AMP",
      needsReview: !category,
    });
  }
  return txs;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt  = n => "$" + Math.round(n || 0).toLocaleString();
const fmtD = n => "$" + (n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// ─── Sorted category groups for <select> dropdowns ───────────────────────────
const asc = (a, b) => a.name.localeCompare(b.name);
const LIVING_CATS    = SHEET_CATEGORIES.filter(c => !c.childcare && !c.exclude).sort(asc);
const CHILDCARE_CATS = SHEET_CATEGORIES.filter(c =>  c.childcare && !c.exclude).sort(asc);
const EXCLUDE_CATS   = SHEET_CATEGORIES.filter(c => c.exclude);
const QUICK_CATS     = ["Exclude", "Entertainment"];
function CatOptions({ empty = false }) {
  return (
    <>
      {empty && <option value="">— pick category —</option>}
      {EXCLUDE_CATS.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
      <optgroup label="Living Expenses">
        {LIVING_CATS.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
      </optgroup>
      <optgroup label="Childcare & School">
        {CHILDCARE_CATS.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
      </optgroup>
    </>
  );
}

// ─── BudgetTrackerComponent ───────────────────────────────────────────────────
export default function BudgetTrackerComponent() {
  console.log("BudgetTracker rendering");
  const [step, setStep] = useState("upload");
  const [txs, setTxs] = useState([]);
  const [startMonth, setStartMonth] = useState(0);
  const [endMonth, setEndMonth]     = useState(new Date().getMonth());
  const [year, setYear]             = useState(new Date().getFullYear());
  const [log, setLog]               = useState([]);
  const [expanded, setExpanded]     = useState(null);
  const [showSheet, setShowSheet]   = useState(false);
  const [drag, setDrag]             = useState(false);
  const [googleToken, setGoogleToken] = useState(null);
  const [sheetStatus, setSheetStatus] = useState(null); // null|'writing'|'done'|{error}
  const [driveError, setDriveError]     = useState(null);
  const fileRef = useRef(null);

  // ─── Process files ──────────────────────────────────────────────────────
  const processFiles = async (files) => {
    setStep("parsing"); setLog(["Starting…"]);
    let all = [];

    for (const file of Array.from(files)) {
      const name = file.name.toLowerCase();
      if (name.endsWith(".csv")) {
        setLog(l => [...l, `📄 Parsing ${file.name}…`]);
        const text = await file.text();
        const ampRows = parseAMPCSV(text);
        const rows  = ampRows !== null ? ampRows : parseUpCSV(text);
        const label = ampRows !== null ? "AMP" : "Up Bank";
        const uncat = rows.filter(r => !r.category).length;
        setLog(l => [...l,
          `✅ ${label}: ${rows.length} expenses parsed`,
          uncat ? `⚠️  ${uncat} need manual category` : `✅ All auto-categorised`
        ]);
        all = [...all, ...rows];
      }
    }

    // Filter to selected month/year later in derived state
    setLog(l => [...l, ``, `📊 ${all.length} transactions loaded`, all.length > 0 ? `ℹ️  From ${Math.min(...all.map(t => new Date(t.date).getTime()))} to ${Math.max(...all.map(t => new Date(t.date).getTime()))}` : ""]);
    setTxs(all);
    setTimeout(() => setStep("review"), 900);
  };


  // ─── Google Sheets OAuth + write ─────────────────────────────────────────
  const colLetter = idx => {
    let n = idx + 1, s = "";
    while (n > 0) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); }
    return s;
  };

  const signInGoogle = () => {
    if (!window.google) { alert("Google sign-in not loaded yet — try again in a moment."); return; }
    window.google.accounts.oauth2.initTokenClient({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly",
      callback: resp => { if (resp.access_token) setGoogleToken(resp.access_token); },
    }).requestAccessToken();
  };

  const sheetsApi = async (path, opts = {}) => {
    const resp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${googleToken}`, "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    if (!resp.ok) throw new Error(`Sheets API ${resp.status}: ${await resp.text()}`);
    return resp.json();
  };

  const driveApi = async (path, { raw = false, ...opts } = {}) => {
    const resp = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${googleToken}`, ...(opts.headers || {}) },
    });
    if (!resp.ok) throw new Error(`Drive API ${resp.status}: ${await resp.text()}`);
    return raw ? resp : resp.json();
  };

  const openDrivePicker = () => {
    if (!googleToken) { signInGoogle(); return; }
    setDriveError(null);
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
    if (!apiKey) { setDriveError("Add VITE_GOOGLE_API_KEY to your .env file"); return; }

    const buildPicker = () => {
      const view = new window.google.picker.DocsView()
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false);
      const picker = new window.google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(googleToken)
        .setDeveloperKey(apiKey)
        .setTitle("Select bank statement files")
        .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
        .setCallback(async data => {
          if (data.action !== window.google.picker.Action.PICKED) return;
          const picked = data[window.google.picker.Response.DOCUMENTS] || [];
          setStep("parsing"); setLog(["Fetching from Drive…"]);
          const fileObjects = [];
          for (const doc of picked) {
            const name = doc[window.google.picker.Document.NAME];
            const id   = doc[window.google.picker.Document.ID];
            const mime = doc[window.google.picker.Document.MIME_TYPE];
            setLog(l => [...l, `☁️  Downloading ${name}…`]);
            try {
              const isGSheet = mime === "application/vnd.google-apps.spreadsheet";
              const path = isGSheet
                ? `/files/${id}/export?mimeType=text%2Fcsv`
                : `/files/${id}?alt=media&supportsAllDrives=true`;
              const resp = await driveApi(path, { raw: true });
              const blob = await resp.blob();
              fileObjects.push(new File([blob], isGSheet ? name + ".csv" : name, { type: isGSheet ? "text/csv" : mime }));
            } catch(e) {
              setLog(l => [...l, `❌ Failed: ${e.message}`]);
            }
          }
          if (fileObjects.length) await processFiles(fileObjects);
        })
        .build();
      picker.setVisible(true);
    };

    if (window.google?.picker) {
      buildPicker();
    } else {
      window.gapi.load("picker", buildPicker);
    }
  };

  const writeToSheet = async () => {
    if (!googleToken) { signInGoogle(); return; }
    setSheetStatus("writing");
    try {
      // ── 1. Get sheet metadata (need numeric sheetId for formatting) ────────
      const meta = await sheetsApi(`?fields=sheets.properties`);
      const sheetMeta = meta.sheets?.find(s => s.properties.title === ACTUALS_TAB_NAME);
      if (!sheetMeta) throw new Error(`Tab "${ACTUALS_TAB_NAME}" not found — please set up the sheet template first.`);
      const sheetId = sheetMeta.properties.sheetId;

      // ── 2. Read the tab to find row/col positions ─────────────────────────
      // Row 1 (index 0): "Actual" / "Budget" labels
      // Row 2 (index 1): "Jan 2026", "Feb 2026", … month headers
      const { values = [] } = await sheetsApi(`/values/${encodeURIComponent(ACTUALS_TAB_NAME)}`);
      const dateRow  = values[1] || [];
      const cats     = SHEET_CATEGORIES.filter(c => !c.exclude);
      const valueUpdates  = [];
      const formatRequests = [];

      for (const m of monthsToShow) {
        const dateStr  = `01/${String(m + 1).padStart(2, "0")}/${year}`;
        const monthCol = dateRow.findIndex(h => (h || "").trim() === dateStr);
        if (monthCol === -1) continue;

        // Write category actuals (including fixedMonthly transfers)
        for (const cat of cats) {
          const rowIdx = values.findIndex(row =>
            (row[0] || "").trim().toLowerCase() === cat.name.trim().toLowerCase()
          );
          if (rowIdx === -1) continue;
          const actual = ((monthlyTotals[m] || {})[cat.name] || 0) + (cat.fixedMonthly || 0);
          valueUpdates.push({
            range: `${ACTUALS_TAB_NAME}!${colLetter(monthCol)}${rowIdx + 1}`,
            values: [[actual > 0 ? parseFloat(actual.toFixed(2)) : ""]],
          });
        }

        // Change row 1 label from "Budget" → "Actual"
        valueUpdates.push({
          range: `${ACTUALS_TAB_NAME}!${colLetter(monthCol)}1`,
          values: [["Actual"]],
        });

        // Clear grey background for the whole column
        formatRequests.push({
          repeatCell: {
            range: { sheetId, startColumnIndex: monthCol, endColumnIndex: monthCol + 1 },
            cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } } },
            fields: "userEnteredFormat.backgroundColor",
          },
        });
      }


      if (valueUpdates.length > 0) {
        await sheetsApi(`/values:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: valueUpdates }),
        });
      }
      if (formatRequests.length > 0) {
        await sheetsApi(":batchUpdate", {
          method: "POST",
          body: JSON.stringify({ requests: formatRequests }),
        });
      }
      const monthLabels = monthsToShow.map(m => MONTHS[m].substring(0, 3)).join(", ");
      setSheetStatus({ done: true, msg: `✓ Written ${monthLabels} (${valueUpdates.length - monthsToShow.length} rows)` });
    } catch (e) {
      setSheetStatus({ error: e.message });
    }
  };

  // ─── Derived state ───────────────────────────────────────────────────────
  const loadedMonths = [...new Set(
    txs.filter(t => t.date.startsWith(String(year))).map(t => parseInt(t.date.split("-")[1]) - 1)
  )].sort((a, b) => a - b);

  const monthsToShow = [];
  for (let m = startMonth; m <= endMonth; m++) monthsToShow.push(m);

  const rangeLabel = startMonth === endMonth
    ? `${MONTHS[startMonth]} ${year}`
    : `${MONTHS[startMonth].substring(0, 3)} – ${MONTHS[endMonth].substring(0, 3)} ${year}`;
  const filteredTxs = txs.filter(t => {
    const [y, m] = t.date.split("-");
    return y === String(year) && monthsToShow.includes(parseInt(m) - 1);
  });

  const totals = filteredTxs.reduce((acc, t) => {
    const k = t.category || "__uncat__";
    acc[k] = (acc[k] || 0) + t.amount;
    return acc;
  }, {});

  const bycat = filteredTxs.reduce((acc, t) => {
    const k = t.category || "__uncat__";
    if (!acc[k]) acc[k] = [];
    acc[k].push({ ...t, _i: txs.findIndex(x => x === t) });
    return acc;
  }, {});
  Object.values(bycat).forEach(rows => rows.sort((a, b) => a.date.localeCompare(b.date)));

  // For multi-month, group by month
  const monthlyTotals = monthsToShow.reduce((acc, m) => {
    acc[m] = filteredTxs.filter(t => {
      const [y, mm] = t.date.split("-");
      return parseInt(mm) - 1 === m;
    }).reduce((acc2, t) => {
      const k = t.category || "__uncat__";
      acc2[k] = (acc2[k] || 0) + t.amount;
      return acc2;
    }, {});
    return acc;
  }, {});

  const budgetMultiplier = monthsToShow.length;
  // Annual categories are stored as yearly totals — scale to the selected period
  const effectiveBudget = (cat) => {
    const monthly = cat.annual ? cat.budget / 12 : cat.quarterly ? cat.budget / 3 : cat.budget;
    return monthly * budgetMultiplier;
  };
  // Add fixedMonthly to totals (transfers to sub-accounts counted per month)
  const fixedTotals = { ...totals };
  for (const cat of SHEET_CATEGORIES) {
    if (cat.fixedMonthly) fixedTotals[cat.name] = (fixedTotals[cat.name] || 0) + cat.fixedMonthly * budgetMultiplier;
  }

  const livingCats    = SHEET_CATEGORIES.filter(c => !c.childcare && !c.exclude);
  const childcareCats = SHEET_CATEGORIES.filter(c =>  c.childcare && !c.exclude);
  const livingTotal   = livingCats.reduce((s, c) => s + (fixedTotals[c.name] || 0), 0);
  const ccTotal       = childcareCats.reduce((s, c) => s + (fixedTotals[c.name] || 0), 0);
  const livingBudget  = livingCats.reduce((s, c) => s + effectiveBudget(c), 0);
  const ccBudget      = childcareCats.reduce((s, c) => s + effectiveBudget(c), 0);
  const uncatTotal    = fixedTotals["__uncat__"] || 0;
  const excludedCatNames = new Set(SHEET_CATEGORIES.filter(c => c.exclude).map(c => c.name));
  const excludeTotal  = filteredTxs.filter(t => excludedCatNames.has(t.category)).reduce((s, t) => s + t.amount, 0);
  const needsReview   = filteredTxs.filter(t => !t.category);
  const needsReviewGroups = Object.values(
    needsReview.reduce((acc, t) => {
      if (!acc[t.payee]) acc[t.payee] = { payee: t.payee, upCategory: t.upCategory, txs: [] };
      acc[t.payee].txs.push(t);
      return acc;
    }, {})
  ).sort((a, b) => b.txs.reduce((s, t) => s + t.amount, 0) - a.txs.reduce((s, t) => s + t.amount, 0));
  const totalIncome = monthsToShow.reduce((sum, m) => {
    const key = `${year}-${String(m + 1).padStart(2, "0")}`;
    return sum + INCOME.reduce((s, p) => s + (p.monthlyOverrides?.[key] ?? p.monthly), 0);
  }, 0);
  const totalExpenses = livingTotal + ccTotal + uncatTotal;
  const forecasted    = totalIncome - totalExpenses;

  // ─── Colours ─────────────────────────────────────────────────────────────
  const C = { bg:"#f9fafb", card:"#ffffff", border:"#e5e7eb", text:"#111827", muted:"#6b7280",
    blue:"#2563eb", green:"#059669", amber:"#d97706", red:"#dc2626", purple:"#7c3aed" };
  const shadow = "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)";

  // ─── Category row component ──────────────────────────────────────────────
  function CatRow({ cat, accent }) {
    const actual  = fixedTotals[cat.name] || 0;
    const rows    = bycat[cat.name] || [];
    const budget  = effectiveBudget(cat);
    const diff    = actual - budget;
    const over    = diff > 0 && budget > 0;
    const open    = expanded === cat.name;
    const pct     = budget > 0 ? Math.min(actual / budget * 100, 100) : 0;

    return (
      <div>
        <div
          onClick={() => rows.length > 0 && setExpanded(open ? null : cat.name)}
          style={{ display:"flex", alignItems:"center", padding:"7px 8px", borderRadius:7,
            cursor: rows.length > 0 ? "pointer" : "default",
            background: open ? "#f3f4f6" : "transparent", gap:6, userSelect:"none" }}
        >
          <span style={{ color:C.muted, fontSize:9, width:10 }}>{rows.length > 0 ? (open?"▼":"▶") : " "}</span>
          <span style={{ flex:1, fontSize:12, color: actual>0 ? C.text : C.muted }}>
            {cat.name}
            {rows.length > 0 && <span style={{ color:C.muted, fontSize:10, marginLeft:5 }}>({rows.length})</span>}
          </span>
          {/* progress bar */}
          <div style={{ width:50, height:3, background:"#f3f4f6", borderRadius:2, flexShrink:0 }}>
            {pct > 0 && <div style={{ width:`${pct}%`, height:"100%", background: over ? C.red : accent, borderRadius:2 }} />}
          </div>
          <span style={{ fontSize:11, color:C.muted, width:68, textAlign:"right" }}>
            {budget > 0 ? fmt(budget) : "—"}
          </span>
          <span style={{ fontSize:12, fontWeight: actual>0?700:400, width:80, textAlign:"right",
            color: actual>0 ? (over ? C.red : accent) : C.muted }}>
            {actual > 0 ? fmtD(actual) : "—"}
          </span>
          <span style={{ fontSize:11, width:78, textAlign:"right",
            color: actual===0 || budget===0 ? "transparent" : over ? C.red : accent }}>
            {actual>0 && budget>0 ? (over ? `+${fmt(diff)}` : `−${fmt(Math.abs(diff))}`) : ""}
          </span>
        </div>

        {open && (
          <div style={{ background:"#f9fafb", borderRadius:8, margin:"2px 0 4px 18px", padding:"4px 10px" }}>
            {rows.map((t, i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", padding:"5px 0", borderBottom:`1px solid ${C.border}`, gap:8, fontSize:11 }}>
                <input
                  type="date"
                  value={t.date}
                  style={{ background:"transparent", border:"none", borderBottom:`1px solid ${C.border}`, color:C.muted, padding:"1px 2px", fontSize:10, fontFamily:"inherit", width:96, flexShrink:0, cursor:"pointer" }}
                  onChange={e => { if (e.target.value) setTxs(prev => prev.map((x,j) => j===t._i ? {...x, date:e.target.value} : x)); }}
                />
                <span style={{ flex:1, color:"#374151" }}>{t.payee}</span>
                <span style={{ color:C.muted, fontSize:10, marginRight:4 }}>{t.source}</span>
                <select
                  style={{ background:"#f9fafb", border:`1px solid ${C.border}`, borderRadius:5, color:C.text, padding:"2px 6px", fontSize:10, fontFamily:"inherit" }}
                  value={t.category || ""}
                  onChange={e => {
                    const newCat = e.target.value;
                    setTxs(prev => prev.map((x,j) => j===t._i ? {...x, category:newCat} : x));
                    setExpanded(newCat);
                  }}
                >
                  <CatOptions />
                </select>
                <span style={{ color:C.text, fontWeight:600, width:72, textAlign:"right" }}>{fmtD(t.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Section header row ──────────────────────────────────────────────────
  function SectionHeader({ label, actual, budget, color }) {
    const diff = actual - budget; const over = diff > 0 && budget > 0;
    return (
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:12 }}>
        <span style={{ fontWeight:700, fontSize:14, color }}>{label}</span>
        <span style={{ fontSize:12 }}>
          <span style={{ fontWeight:700, color }}>{fmt(actual)}</span>
          <span style={{ color:C.muted }}> / {fmt(budget)} budget &nbsp;</span>
          {budget > 0 && <span style={{ fontSize:11, fontWeight:600, color: over ? C.red : color }}>
            {over ? `↑ ${fmt(diff)} over` : `↓ ${fmt(Math.abs(diff))} under`}
          </span>}
        </span>
      </div>
    );
  }

  // ─── Column labels ───────────────────────────────────────────────────────
  const ColLabels = () => (
    <div style={{ display:"flex", gap:6, padding:"4px 8px", fontSize:9, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", borderBottom:`1px solid ${C.border}`, marginBottom:4 }}>
      <span style={{ width:10 }} /><span style={{ flex:1 }} /><span style={{ width:50 }} />
      <span style={{ width:68, textAlign:"right" }}>Budget</span>
      <span style={{ width:80, textAlign:"right" }}>Actual</span>
      <span style={{ width:78, textAlign:"right" }}>Variance</span>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  if (step === "upload") return (
    <div style={{ fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", background:C.bg, minHeight:"100vh", color:C.text, padding:24, fontSize:13 }}>
      <div style={{ maxWidth:640, margin:"0 auto" }}>
        <div style={{ paddingBottom:20, marginBottom:20, borderBottom:`1px solid ${C.border}` }}>
          <div style={{ fontSize:22, fontWeight:700, color:C.text, letterSpacing:"-0.025em" }}>Fanner's Budget Tracker</div>
          <div style={{ fontSize:13, color:C.muted, marginTop:4 }}>Up Bank + AMP — budget reconciliation</div>
        </div>

        <div
          style={{ border:`2px dashed ${drag ? C.blue : "#e5e7eb"}`, borderRadius:14, padding:"36px 24px", textAlign:"center", cursor:"pointer", background: drag?"#eff6ff":"transparent", transition:"all 0.15s" }}
          onDrop={e => { e.preventDefault(); setDrag(false); processFiles(e.dataTransfer.files); }}
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onClick={() => fileRef.current?.click()}
        >
          <div style={{ fontSize:30, marginBottom:10, opacity:0.4 }}>↑</div>
          <div style={{ fontSize:14, fontWeight:600, color:C.text, marginBottom:4 }}>Drop files here or click to browse</div>
          <div style={{ fontSize:12, color:C.muted }}>Up Bank CSV · AMP Bank CSV</div>
          <input ref={fileRef} type="file" accept=".csv" multiple style={{ display:"none" }} onChange={e => processFiles(e.target.files)} />

          <div style={{ display:"flex", alignItems:"center", gap:10, margin:"20px 0 16px" }}>
            <div style={{ flex:1, height:1, background:"#e5e7eb" }} />
            <span style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:"0.1em" }}>or</span>
            <div style={{ flex:1, height:1, background:"#e5e7eb" }} />
          </div>

          <button
            onClick={e => { e.stopPropagation(); openDrivePicker(); }}
            style={{ background:"transparent", color:C.text, border:`1px solid ${C.border}`, borderRadius:6, padding:"8px 18px", fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"inherit" }}
          >
            Google Drive{!googleToken && <span style={{ color:C.muted, fontWeight:400, marginLeft:6, fontSize:11 }}>· sign in required</span>}
          </button>
          {driveError && <div style={{ fontSize:11, color:C.red, marginTop:8 }}>❌ {driveError}</div>}
        </div>

      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  if (step === "parsing") return (
    <div style={{ fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", background:C.bg, minHeight:"100vh", color:C.text, padding:24 }}>
      <div style={{ maxWidth:640, margin:"0 auto" }}>
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, boxShadow:shadow, padding:20 }}>
          <div style={{ fontSize:18, fontWeight:700, color:C.text, marginBottom:14 }}>Parsing files…</div>
          <div style={{ background:"#f3f4f6", borderRadius:8, padding:14, fontFamily:"'SF Mono','Fira Code',monospace", fontSize:12, lineHeight:2.0, minHeight:100 }}>
            {log.filter(Boolean).map((l,i) => (
              <div key={i} style={{ color: l.startsWith("✅")?C.green:l.startsWith("❌")?C.red:l.startsWith("⚠️")?C.amber:l.startsWith("📊")||l.startsWith("ℹ️")?C.blue:C.muted }}>{l}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // REVIEW
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", background:C.bg, minHeight:"100vh", color:C.text, padding:24, fontSize:13 }}>
      <div style={{ maxWidth:860, margin:"0 auto" }}>

        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16, flexWrap:"wrap", gap:10 }}>
          <div>
            <div style={{ fontSize:20, fontWeight:700, color:C.text, letterSpacing:"-0.02em" }}>
              {rangeLabel}
            </div>
            <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>
              {filteredTxs.length} transactions &nbsp;·&nbsp;
              {needsReview.length > 0
                ? <span style={{ color:C.amber }}>{needsReview.length} uncategorised</span>
                : <span style={{ color:C.green }}>all categorised ✅</span>}
            </div>
            {loadedMonths.length > 1 && (
              <div style={{ marginTop:8, display:"flex", gap:8, alignItems:"center" }}>
                <span style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em" }}>View</span>
                <select
                  style={{ background:"#f9fafb", border:`1px solid #e5e7eb`, borderRadius:7, color:C.text, padding:"5px 8px", fontSize:11, fontFamily:"inherit" }}
                  value={startMonth}
                  onChange={e => { const v = +e.target.value; setStartMonth(v); if (v > endMonth) setEndMonth(v); }}
                >
                  {loadedMonths.map(m => <option key={m} value={m}>{MONTHS[m]}</option>)}
                </select>
                <span style={{ color:C.muted, fontSize:12 }}>→</span>
                <select
                  style={{ background:"#f9fafb", border:`1px solid #e5e7eb`, borderRadius:7, color:C.text, padding:"5px 8px", fontSize:11, fontFamily:"inherit" }}
                  value={endMonth}
                  onChange={e => { const v = +e.target.value; setEndMonth(v); if (v < startMonth) setStartMonth(v); }}
                >
                  {loadedMonths.map(m => <option key={m} value={m}>{MONTHS[m]}</option>)}
                </select>
              </div>
            )}
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            <button style={{ background:"transparent", color:C.muted, border:`1px solid ${C.border}`, borderRadius:6, padding:"7px 14px", fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"inherit" }} onClick={() => { setTxs([]); setStep("upload"); }}>← Upload</button>
            <button style={{ background:"transparent", color:C.text, border:`1px solid ${C.border}`, borderRadius:6, padding:"7px 14px", fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"inherit" }} onClick={() => setShowSheet(s => !s)}>Preview</button>
            <button
              disabled={sheetStatus === "writing"}
              style={{ background: sheetStatus?.done ? C.green : C.blue, color:"#fff", border:"none", borderRadius:6, padding:"7px 14px", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}
              onClick={() => { setSheetStatus(null); writeToSheet(); }}
            >
              {sheetStatus === "writing" ? "Writing…" : sheetStatus?.done ? sheetStatus.msg : googleToken ? `Write ${rangeLabel} →` : `Connect & Write →`}
            </button>
            {sheetStatus?.error && <span style={{ fontSize:11, color:C.red }}>{sheetStatus.error}</span>}
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:12, marginBottom:16 }}>
          {[
            { label:"Living Expenses",    actual:livingTotal,                    budget:livingBudget,          color:C.blue   },
            { label:"Childcare & School", actual:ccTotal,                        budget:ccBudget,              color:C.purple },
            { label:"Grand Total",        actual:livingTotal+ccTotal+uncatTotal, budget:livingBudget+ccBudget, color:C.green  },
          ].map(({ label, actual, budget, color }) => {
            const diff = actual - budget; const over = diff > 0 && budget > 0;
            const pct = budget > 0 ? Math.min(actual/budget*100, 100) : 0;
            return (
              <div key={label} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, boxShadow:shadow, padding:"14px 18px" }}>
                <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>{label}</div>
                <div style={{ display:"flex", gap:12, marginBottom:6 }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:9, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:2 }}>Budget</div>
                    <div style={{ fontSize:18, fontWeight:700, color:C.muted }}>{fmt(budget)}</div>
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:9, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:2 }}>Actual</div>
                    <div style={{ fontSize:18, fontWeight:800, color: over ? C.red : color }}>{fmt(actual)}</div>
                  </div>
                </div>
                {budget>0 && <div style={{ fontSize:11, fontWeight:600, color: over ? C.red : color, marginBottom:6 }}>
                  {over ? `↑ ${fmt(diff)} over` : `↓ ${fmt(Math.abs(diff))} under`}
                </div>}
                {label === "Grand Total" && excludeTotal > 0 && (
                  <div style={{ fontSize:10, color:C.muted, marginBottom:6 }}>
                    {fmt(excludeTotal)} excluded from totals
                  </div>
                )}
                <div style={{ background:"#f3f4f6", borderRadius:3, height:3 }}>
                  <div style={{ width:`${pct}%`, height:"100%", background: over?C.red:color, borderRadius:3, transition:"width 0.4s" }} />
                </div>
              </div>
            );
          })}
          {/* Savings card */}
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, boxShadow:shadow, padding:"14px 18px" }}>
            <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>
              {forecasted >= 0 ? "Actual Savings" : "Overspend"}
            </div>
            <div style={{ display:"flex", gap:12, marginBottom:6 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:9, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:2 }}>Income</div>
                <div style={{ fontSize:18, fontWeight:700, color:C.muted }}>{fmt(totalIncome)}</div>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:9, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:2 }}>{forecasted >= 0 ? "Saved" : "Over by"}</div>
                <div style={{ fontSize:18, fontWeight:800, color: forecasted >= 0 ? C.green : C.red }}>{fmt(Math.abs(forecasted))}</div>
              </div>
            </div>
            <div style={{ fontSize:11, fontWeight:600, color: forecasted >= 0 ? C.green : C.red, marginBottom:6 }}>
              {forecasted >= 0 ? `↑ ${fmt(forecasted)} saved` : `↓ ${fmt(Math.abs(forecasted))} over`}
            </div>
            <div style={{ background:"#f3f4f6", borderRadius:3, height:3 }}>
              <div style={{ width:`${Math.min(totalExpenses/totalIncome*100,100)}%`, height:"100%", background: forecasted>=0?C.green:C.red, borderRadius:3, transition:"width 0.4s" }} />
            </div>
          </div>
        </div>

        {/* Uncategorised warning block */}
        {needsReview.length > 0 && (
          <div style={{ background:"#fffbeb", border:`1px solid #fcd34d`, borderRadius:8, padding:16, marginBottom:14 }}>
            <div style={{ fontWeight:600, color:C.amber, marginBottom:10, fontSize:13 }}>
              {needsReview.length} transaction{needsReview.length !== 1 ? "s" : ""} need a category
              <span style={{ fontWeight:400, fontSize:11, marginLeft:8 }}>— grouped by payee, largest first</span>
            </div>
            {needsReviewGroups.map(({ payee, upCategory, txs: group }) => {
              const groupTotal = group.reduce((s, t) => s + t.amount, 0);
              const groupSet = new Set(group);
              return (
                <div key={payee} style={{ display:"flex", alignItems:"flex-start", padding:"7px 0", borderBottom:`1px solid #f0e8c0`, gap:8, fontSize:11 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ color:C.text, fontWeight:500 }}>{payee}</div>
                    {group.length > 1
                      ? <div style={{ color:C.muted, fontSize:10 }}>{group.length} transactions · {group.map(t => t.date.slice(5)).join(", ")}</div>
                      : <div style={{ color:C.muted, fontSize:10 }}>{group[0].date}{upCategory ? ` · ${upCategory}` : ""}</div>
                    }
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:3, alignItems:"stretch", flexShrink:0, width:100 }}>
                    {QUICK_CATS.map(cat => (
                      <button key={cat} onClick={() => setTxs(prev => prev.map(x => groupSet.has(x) ? {...x, category:cat} : x))}
                        style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:4, padding:"2px 8px", fontSize:10, fontWeight:500, cursor:"pointer", color:C.text, fontFamily:"inherit", whiteSpace:"nowrap", textAlign:"center" }}>
                        {cat}
                      </button>
                    ))}
                    <select
                      value=""
                      onChange={e => { if (!e.target.value) return; setTxs(prev => prev.map(x => groupSet.has(x) ? {...x, category:e.target.value} : x)); }}
                      style={{ background:"#f9fafb", border:`1px solid #e8c060`, borderRadius:4, color:C.muted, padding:"2px 4px", fontSize:10, fontFamily:"inherit", cursor:"pointer", width:"100%" }}
                    >
                      <option value="">more…</option>
                      <CatOptions />
                    </select>
                  </div>
                  <span style={{ color:C.amber, fontWeight:700, width:72, textAlign:"right", flexShrink:0, paddingTop:2 }}>{fmtD(groupTotal)}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Multi-Month Table */}
        {monthsToShow.length > 1 && (
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, boxShadow:shadow, padding:"16px 18px", marginBottom:12 }}>
            <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:12 }}>Actual vs Budget</div>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                    <th style={{ textAlign:"left", padding:"8px", color:C.muted }}>Category</th>
                    <th style={{ textAlign:"right", padding:"8px", color:C.muted }}>Budget</th>
                    {monthsToShow.map(m => (
                      <th key={m} style={{ textAlign:"right", padding:"8px", color:C.muted }}>{MONTHS[m].substring(0,3)}</th>
                    ))}
                    <th style={{ textAlign:"right", padding:"8px", color:C.muted }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {SHEET_CATEGORIES.filter(c => !c.exclude).map(cat => {
                    const totalActual = monthsToShow.reduce((sum, m) => sum + (monthlyTotals[m][cat.name] || 0), 0) + (cat.fixedMonthly ? cat.fixedMonthly * monthsToShow.length : 0);
                    const rangeBudget = effectiveBudget(cat);
                    const over = totalActual > rangeBudget && cat.budget > 0;
                    return (
                      <tr key={cat.name} style={{ borderBottom:`1px solid ${C.border}` }}>
                        <td style={{ padding:"8px", color: totalActual > 0 ? C.text : C.muted }}>{cat.name}</td>
                        <td style={{ textAlign:"right", padding:"8px", color:C.muted }}>{cat.budget > 0 ? fmt(rangeBudget) : "—"}</td>
                        {monthsToShow.map(m => {
                          const actual = (monthlyTotals[m][cat.name] || 0) + (cat.fixedMonthly || 0);
                          return (
                            <td key={m} style={{ textAlign:"right", padding:"8px", color: actual > 0 ? C.text : C.muted }}>
                              {actual > 0 ? fmtD(actual) : "—"}
                            </td>
                          );
                        })}
                        <td style={{ textAlign:"right", padding:"8px", color: over ? C.red : totalActual > 0 ? C.green : C.muted }}>
                          {totalActual > 0 ? fmtD(totalActual) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Living Expenses */}
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, boxShadow:shadow, padding:"16px 18px", marginBottom:12 }}>
          <SectionHeader label="Living Expenses" actual={livingTotal} budget={livingBudget} color={C.blue} />
          <ColLabels />
          {livingCats.map(cat => <CatRow key={cat.name} cat={cat} accent={C.blue} />)}
        </div>

        {/* Childcare */}
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, boxShadow:shadow, padding:"16px 18px", marginBottom:12 }}>
          <SectionHeader label="Childcare & School" actual={ccTotal} budget={ccBudget} color={C.purple} />
          <ColLabels />
          {childcareCats.map(cat => <CatRow key={cat.name} cat={cat} accent={C.purple} />)}
        </div>

        {/* Excluded */}
        {excludeTotal > 0 && (
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, boxShadow:shadow, padding:"16px 18px", marginBottom:12, opacity:0.85 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:12 }}>
              <span style={{ fontWeight:600, fontSize:14, color:C.muted }}>Excluded from budget</span>
              <span style={{ fontSize:12, color:C.muted }}>{fmt(excludeTotal)} not counted · re-assign below if needed</span>
            </div>
            <ColLabels />
            {SHEET_CATEGORIES.filter(c => c.exclude).map(cat => <CatRow key={cat.name} cat={cat} accent={C.muted} />)}
          </div>
        )}

        {/* Sheet update panel */}
        {showSheet && (
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, boxShadow:shadow, padding:18, marginBottom:12 }}>
            <div style={{ fontWeight:600, color:C.text, marginBottom:12, fontSize:13 }}>
              Actuals for {rangeLabel}
            </div>
            <div style={{ background:"#f9fafb", borderRadius:6, padding:14, fontFamily:"'SF Mono','Fira Code',monospace", fontSize:11, lineHeight:2.0 }}>
              {SHEET_CATEGORIES.filter(c => !c.exclude).map(cat => {
                const actual = totals[cat.name] || 0;
                return (
                  <div key={cat.name} style={{ display:"flex", justifyContent:"space-between", color: cat.childcare ? C.purple : actual>0 ? C.text : C.muted }}>
                    <span>{cat.name}</span>
                    <span style={{ fontWeight: actual>0 ? 700:400 }}>{actual>0 ? fmtD(actual) : "—"}</span>
                  </div>
                );
              })}
              {uncatTotal > 0 && (
                <div style={{ display:"flex", justifyContent:"space-between", color:C.amber, borderTop:`1px solid ${C.border}`, paddingTop:6, marginTop:6 }}>
                  <span>⚠️ Uncategorised (review above)</span><span>{fmtD(uncatTotal)}</span>
                </div>
              )}
            </div>
            {!googleToken && (
              <div style={{ marginTop:10, fontSize:11, color:C.muted }}>
                Click <strong style={{ color:C.blue }}>Connect Google →</strong> above to write these values directly to your Sheet.
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}