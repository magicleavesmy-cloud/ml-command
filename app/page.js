"use client";

import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  duitbizDb,
  duitstockDb,
  firebaseDebugInfo,
  supplierDb,
} from "../lib/firebase";
import styles from "./page.module.css";

Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip
);

const AUTO_REFRESH_MS = 5 * 60 * 1000;
const LOW_STOCK_LIMIT = 10;
const PIN_CODE = "1234";
const UNLOCK_STORAGE_KEY = "magic-leaves-unlocked";
const NAV_ITEMS = ["Dashboard", "Duitbiz", "DuitStock", "Supplier Debt", "Settings", "Help", "Logout", "Lock"];

const emptyDashboard = {
  closings: [],
  expenses: [],
  duitbizSuppliers: [],
  products: [],
  movements: [],
  suppliers: [],
  supplierTransactions: [],
};

function formatCurrency(value) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-MY").format(Number(value) || 0);
}

function formatPercent(value) {
  return `${(Number(value) || 0).toFixed(1)}%`;
}

function toDateKey(date) {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

function normalizeDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function formatDate(value) {
  const date = normalizeDate(value);
  return date ? date.toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "No date";
}

function formatTime(value) {
  const date = normalizeDate(value);
  return date ? date.toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit" }) : "No time";
}

function closingTotalSales(closing) {
  return (
    Number(closing?.totalSales) ||
    (Number(closing?.daySales) || 0) + (Number(closing?.nightSales) || 0) + (Number(closing?.onlineSales) || 0)
  );
}

function isOnlinePaymentMethod(value) {
  return ["online", "bank", "transfer"].includes(String(value || "").trim().toLowerCase());
}

function getAmount(record, keys = ["amount", "balance", "outstanding", "total", "value"]) {
  for (const key of keys) {
    const value = Number(record?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function getProductQuantity(product) {
  return Number(product?.quantity ?? product?.stockQty ?? product?.qty) || 0;
}

function getProductCostPrice(product) {
  return Number(product?.costPrice ?? product?.cost ?? product?.buyPrice) || 0;
}

function getProductSellingPrice(product) {
  return Number(product?.sellingPrice ?? product?.salePrice ?? product?.price) || 0;
}

function getClosingBankAmount(closing) {
  if (closing?.bankInputAmount !== undefined) return Number(closing.bankInputAmount) || 0;
  return (closing?.closingDestination ?? "Bank") === "Bank"
    ? Number(closing?.bankAmount ?? closing?.daySales) || 0
    : 0;
}

function getSupplierSettings(suppliers, name) {
  return (
    suppliers.find((supplier) => normalizeName(supplier.name) === normalizeName(name)) ?? {
      marginPercent: 0,
      stockValue: 0,
    }
  );
}

function groupDuitbizSupplierProfit(expenses, suppliers) {
  const map = new Map();
  expenses.forEach((expense) => {
    const supplier = expense.supplierName || "No supplier";
    const settings = getSupplierSettings(suppliers, supplier);
    const current = map.get(supplier) ?? {
      supplier,
      total: 0,
      cash: 0,
      online: 0,
      pc: 0,
      marginPercent: Number(settings.marginPercent) || 0,
      stockValue: Number(settings.stockValue) || 0,
      estimatedProfit: 0,
      estimatedSoldValue: 0,
    };
    const amount = Number(expense.amount) || 0;
    current.total += amount;
    if (expense.paymentMethod === "Cash") current.cash += amount;
    if (isOnlinePaymentMethod(expense.paymentMethod)) current.online += amount;
    if (expense.paymentMethod === "PC") current.pc += amount;
    current.estimatedProfit = current.total * (current.marginPercent / 100);
    current.estimatedSoldValue = current.total - current.stockValue;
    map.set(supplier, current);
  });
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function supplierName(record, suppliersById) {
  return (
    record?.supplierName ||
    record?.name ||
    suppliersById.get(record?.supplierId)?.name ||
    suppliersById.get(record?.supplierID)?.name ||
    record?.supplierId ||
    record?.supplierID ||
    "Unknown supplier"
  );
}

function signedSupplierAmount(transaction) {
  const rawAmount = getAmount(transaction, [
    "amount",
    "debtAmount",
    "balance",
    "outstanding",
    "total",
  ]);
  const type = String(transaction?.type || transaction?.transactionType || "").toLowerCase();
  if (["payment", "paid", "repayment", "settled", "credit"].includes(type)) {
    return -Math.abs(rawAmount);
  }
  return rawAmount;
}

function productMovementName(movement) {
  return movement.productName || movement.name || movement.product || "Unnamed product";
}

async function readCollection(db, name, options = {}) {
  const constraints = [];
  if (options.where) constraints.push(where(...options.where));
  if (options.orderBy) constraints.push(orderBy(...options.orderBy));
  if (options.limit) constraints.push(limit(options.limit));
  const label = options.label || name;
  const projectId = db.app.options.projectId || "<missing>";
  const read = async (collectionQuery, mode) => {
    const snapshot = await getDocs(collectionQuery);
    console.log(
      `[Firestore] ${label}: project=${projectId}, collection=${name}, mode=${mode}, docs=${snapshot.size}`
    );
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  };

  try {
    return await read(query(collection(db, name), ...constraints), "constrained");
  } catch (error) {
    console.error(`[Firestore] ${label} error`, {
      projectId,
      collection: name,
      code: error.code,
      message: error.message,
    });
    if (!options.fallbackWithoutOrder) throw error;
    return await read(collection(db, name), "fallback");
  }
}

function useChart(canvasRef, config, renderKey) {
  useEffect(() => {
    if (!canvasRef.current || !config) return undefined;
    const chart = new Chart(canvasRef.current, config);
    return () => chart.destroy();
  }, [canvasRef, config, renderKey]);
}

function Skeleton({ className = "" }) {
  return <div className={`${styles.skeleton} ${className}`} />;
}

function StatCard({ label, value, subValue, detail, loading }) {
  return (
    <section className={styles.statCard}>
      <p>{label}</p>
      {loading ? <Skeleton className={styles.statSkeleton} /> : <strong>{value}</strong>}
      {!loading && subValue ? <span className={styles.statSubValue}>{subValue}</span> : null}
      <span>{detail}</span>
    </section>
  );
}

function BreakdownStatCard({ label, value, rows, loading }) {
  return (
    <section className={styles.statCard}>
      <p>{label}</p>
      {loading ? <Skeleton className={styles.statSkeleton} /> : <strong>{value}</strong>}
      {!loading && rows?.length ? (
        <div className={styles.statBreakdown}>
          {rows.map((row) => (
            <span key={row.label}>
              {row.label}
              <b>{row.value}</b>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function EmptyState({ children }) {
  return <div className={styles.empty}>{children}</div>;
}

function PinLockScreen({ onUnlock }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [shaking, setShaking] = useState(false);

  const submitPin = useCallback(
    (nextPin) => {
      if (nextPin === PIN_CODE) {
        window.localStorage.setItem(UNLOCK_STORAGE_KEY, "true");
        onUnlock();
        return;
      }

      setError("Wrong PIN");
      setShaking(true);
      setTimeout(() => {
        setPin("");
        setShaking(false);
      }, 420);
    },
    [onUnlock]
  );

  const pressDigit = (digit) => {
    setError("");
    setPin((current) => {
      if (current.length >= 4) return current;
      const nextPin = `${current}${digit}`;
      if (nextPin.length === 4) submitPin(nextPin);
      return nextPin;
    });
  };

  const deleteDigit = () => {
    setError("");
    setPin((current) => current.slice(0, -1));
  };

  return (
    <main className={styles.lockPage}>
      <section className={`${styles.lockCard} ${shaking ? styles.lockShake : ""}`}>
        <div className={styles.lockBrand}>
          <span className={styles.logo}>🍃</span>
          <div>
            <strong>Magic Leaves</strong>
            <p>Command Center</p>
          </div>
        </div>

        <div className={styles.pinDots} aria-label={`${pin.length} of 4 PIN digits entered`}>
          {Array.from({ length: 4 }).map((_, index) => (
            <span className={pin.length > index ? styles.pinDotFilled : ""} key={index} />
          ))}
        </div>

        <p className={`${styles.pinError} ${error ? styles.pinErrorActive : ""}`}>
          {error || "Enter 4-digit PIN"}
        </p>

        <div className={styles.pinPad}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
            <button key={digit} onClick={() => pressDigit(digit)} type="button">
              {digit}
            </button>
          ))}
          <button className={styles.pinGhostButton} aria-label="Empty keypad space" disabled type="button" />
          <button onClick={() => pressDigit("0")} type="button">
            0
          </button>
          <button className={styles.pinDeleteButton} onClick={deleteDigit} type="button">
            Delete
          </button>
        </div>
      </section>
    </main>
  );
}

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [activeView, setActiveView] = useState("Dashboard");
  const [detailView, setDetailView] = useState(null);
  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [range, setRange] = useState("week");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [errors, setErrors] = useState([]);
  const salesChartRef = useRef(null);
  const expenseChartRef = useRef(null);

  useEffect(() => {
    setUnlocked(window.localStorage.getItem(UNLOCK_STORAGE_KEY) === "true");
    setMounted(true);
  }, []);

  const loadDashboard = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setErrors([]);
    console.log("[Firebase] Active project IDs", firebaseDebugInfo);

    const results = await Promise.allSettled([
      Promise.all([
        readCollection(duitbizDb, "duitbiz_closings", {
          label: "Duitbiz closings",
          orderBy: ["dateKey", "desc"],
          limit: 45,
          fallbackWithoutOrder: true,
        }),
        readCollection(duitbizDb, "duitbiz_expenses", {
          label: "Duitbiz expenses",
          orderBy: ["dateKey", "desc"],
          limit: 100,
          fallbackWithoutOrder: true,
        }),
        readCollection(duitbizDb, "duitbiz_suppliers", {
          label: "Duitbiz supplier settings",
          fallbackWithoutOrder: true,
        }),
      ]),
      Promise.all([
        readCollection(duitstockDb, "products", { label: "DuitStock products" }),
        readCollection(duitstockDb, "movements", {
          label: "DuitStock movements",
          orderBy: ["date", "desc"],
          limit: 80,
          fallbackWithoutOrder: true,
        }),
      ]),
      Promise.all([
        readCollection(supplierDb, "suppliers", { label: "Supplier Debt suppliers" }),
        readCollection(supplierDb, "supplierTransactions", {
          label: "Supplier Debt transactions",
          orderBy: ["date", "desc"],
          limit: 200,
          fallbackWithoutOrder: true,
        }),
      ]),
    ]);

    const next = { ...emptyDashboard };
    const nextErrors = [];

    if (results[0].status === "fulfilled") {
      [next.closings, next.expenses, next.duitbizSuppliers] = results[0].value;
    } else {
      nextErrors.push(`Duitbiz: ${results[0].reason?.message || "connection failed"}`);
    }

    if (results[1].status === "fulfilled") {
      [next.products, next.movements] = results[1].value;
    } else {
      nextErrors.push(`DuitStock: ${results[1].reason?.message || "connection failed"}`);
    }

    if (results[2].status === "fulfilled") {
      [next.suppliers, next.supplierTransactions] = results[2].value;
    } else {
      nextErrors.push(`Supplier Debt: ${results[2].reason?.message || "connection failed"}`);
    }

    console.log("[Dashboard] fetched document counts", {
      closings: next.closings.length,
      expenses: next.expenses.length,
      duitbizSuppliers: next.duitbizSuppliers.length,
      products: next.products.length,
      movements: next.movements.length,
      suppliers: next.suppliers.length,
      supplierTransactions: next.supplierTransactions.length,
    });
    if (nextErrors.length > 0) {
      console.error("[Dashboard] Firestore load errors", nextErrors);
    }

    setDashboard(next);
    setErrors(nextErrors);
    setLastUpdated(new Date());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (!mounted || !unlocked) return undefined;
    loadDashboard();
    const refresh = setInterval(() => loadDashboard({ quiet: true }), AUTO_REFRESH_MS);
    return () => clearInterval(refresh);
  }, [loadDashboard, mounted, unlocked]);

  const metrics = useMemo(() => {
    const todayKey = toDateKey(new Date());
    const todayClosing =
      dashboard.closings.find((closing) => closing.dateKey === todayKey) ||
      dashboard.closings.find((closing) => normalizeDate(closing.date)?.toLocaleDateString("en-CA") === todayKey);
    const daySales = Number(todayClosing?.daySales) || 0;
    const cashExpenses = Number(todayClosing?.cashExpenses) || 0;
    const stockValue = dashboard.products.reduce(
      (total, product) => total + getProductQuantity(product) * getProductCostPrice(product),
      0
    );
    const salesValue = dashboard.products.reduce(
      (total, product) => total + getProductQuantity(product) * getProductSellingPrice(product),
      0
    );

    const suppliersById = new Map(dashboard.suppliers.map((supplier) => [supplier.id, supplier]));
    const supplierBalances = new Map();

    for (const supplier of dashboard.suppliers) {
      const initial = getAmount(supplier, ["outstanding", "balance", "amountOwed", "debt"]);
      if (initial > 0) supplierBalances.set(supplier.name || supplier.id, initial);
    }

    for (const transaction of dashboard.supplierTransactions) {
      const name = supplierName(transaction, suppliersById);
      supplierBalances.set(name, (supplierBalances.get(name) || 0) + signedSupplierAmount(transaction));
    }

    const supplierDebts = [...supplierBalances.entries()]
      .map(([name, amount]) => ({ name, amount }))
      .filter((supplier) => supplier.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    return {
      daySales,
      todayProfit: daySales - cashExpenses,
      stockValue,
      salesValue,
      supplierDebt: supplierDebts.reduce((total, supplier) => total + supplier.amount, 0),
      supplierDebts,
    };
  }, [dashboard]);

  const suppliersByIdForView = useMemo(
    () => new Map(dashboard.suppliers.map((supplier) => [supplier.id, supplier])),
    [dashboard.suppliers]
  );

  const productsByIdForView = useMemo(
    () => new Map(dashboard.products.map((product) => [product.id, product])),
    [dashboard.products]
  );

  const latestClosing = dashboard.closings[0] || {};

  const duitbizBreakdown = useMemo(() => {
    const totals = {
      daySales: 0,
      nightSales: 0,
      onlineSales: 0,
      cashExpenses: 0,
      onlineExpenses: 0,
      pcExpenses: 0,
      totalSales: 0,
      totalExpenses: 0,
    };

    for (const closing of dashboard.closings) {
      totals.daySales += Number(closing.daySales) || 0;
      totals.nightSales += Number(closing.nightSales) || 0;
      totals.onlineSales += Number(closing.onlineSales) || 0;
      totals.cashExpenses += Number(closing.cashExpenses) || 0;
      totals.onlineExpenses += Number(closing.onlineExpenses) || 0;
      totals.pcExpenses += Number(closing.pcExpenses) || 0;
      totals.totalSales += Number(closing.totalSales ?? closing.daySales) || 0;
      totals.totalExpenses += Number(closing.totalExpenses ?? closing.cashExpenses) || 0;
    }

    return totals;
  }, [dashboard.closings]);

  const pcBalanceRows = useMemo(
    () =>
      dashboard.closings
        .map((closing) => ({
          id: closing.id,
          date: closing.dateKey || formatDate(closing.date),
          oldPcBalance: Number(closing.oldPcBalance) || 0,
          newPcBalance: Number(closing.newPcBalance ?? closing.endOfDayPcBalance) || 0,
          pcAmount: Number(closing.pcAmount ?? closing.pcInputAmount ?? closing.totalPc) || 0,
        })),
    [dashboard.closings]
  );

  const pcBalanceMax = useMemo(
    () => Math.max(1, ...pcBalanceRows.map((row) => Math.abs(row.newPcBalance))),
    [pcBalanceRows]
  );

  const salesBreakdownRows = useMemo(
    () => [
      { label: "Day", value: duitbizBreakdown.daySales },
      { label: "Night", value: duitbizBreakdown.nightSales },
      { label: "Online", value: duitbizBreakdown.onlineSales },
    ],
    [duitbizBreakdown.daySales, duitbizBreakdown.nightSales, duitbizBreakdown.onlineSales]
  );

  const bigExpenses = useMemo(
    () =>
      [...dashboard.expenses]
        .sort((a, b) => getAmount(b, ["amount", "cost", "total"]) - getAmount(a, ["amount", "cost", "total"])),
    [dashboard.expenses]
  );

  const supplierProfitRows = useMemo(() => {
    const currentMonth = toDateKey(new Date()).slice(0, 7);
    const monthExpenses = dashboard.expenses.filter((expense) => String(expense.dateKey || "").startsWith(currentMonth));
    return groupDuitbizSupplierProfit(monthExpenses, dashboard.duitbizSuppliers)
      .sort((a, b) => b.estimatedProfit - a.estimatedProfit || b.total - a.total);
  }, [dashboard.duitbizSuppliers, dashboard.expenses]);

  const supplierProfitRanking = useMemo(() => supplierProfitRows.slice(0, 8), [supplierProfitRows]);

  const duitbizEstimatedProfit = useMemo(
    () =>
      supplierProfitRows.reduce(
        (sum, supplier) => (supplier.marginPercent > 0 ? sum + supplier.estimatedProfit : sum),
        0
      ),
    [supplierProfitRows]
  );

  const nonProfitableExpenses = useMemo(
    () => supplierProfitRows.reduce((sum, supplier) => (supplier.marginPercent <= 0 ? sum + supplier.total : sum), 0),
    [supplierProfitRows]
  );

  const duitbizProfitPercent = duitbizBreakdown.totalSales > 0
    ? (duitbizEstimatedProfit / duitbizBreakdown.totalSales) * 100
    : 0;

  const confirmedStockProfit = useMemo(
    () =>
      dashboard.movements.reduce((sum, movement) => {
        if (String(movement.type || "").toLowerCase() !== "out") return sum;
        const product = productsByIdForView.get(movement.productId);
        if (!product) return sum;
        const unitProfit = getProductSellingPrice(product) - getProductCostPrice(product);
        return sum + unitProfit * (Number(movement.quantity) || 0);
      }, 0),
    [dashboard.movements, productsByIdForView]
  );

  const totalCashOutToBank = useMemo(
    () => dashboard.closings.reduce((sum, closing) => sum + getClosingBankAmount(closing), 0),
    [dashboard.closings]
  );

  const currentPcBalance = Number(latestClosing.newPcBalance ?? latestClosing.endOfDayPcBalance) || 0;
  const currentMonthKey = toDateKey(new Date()).slice(0, 7);
  const monthPcRows = pcBalanceRows.filter((row) => String(row.date || "").startsWith(currentMonthKey));
  const monthStartPcBalance = monthPcRows.at(-1)?.oldPcBalance ?? currentPcBalance;
  const pcBalanceMovement = currentPcBalance - monthStartPcBalance;

  const expensesBreakdownRows = useMemo(
    () => [
      { label: "Cash", value: duitbizBreakdown.cashExpenses },
      { label: "Online", value: duitbizBreakdown.onlineExpenses },
      { label: "PC", value: duitbizBreakdown.pcExpenses },
      { label: "Non-profitable", value: nonProfitableExpenses },
    ],
    [
      duitbizBreakdown.cashExpenses,
      duitbizBreakdown.onlineExpenses,
      duitbizBreakdown.pcExpenses,
      nonProfitableExpenses,
    ]
  );

  const salesRows = useMemo(() => {
    const days = range === "today" ? 1 : range === "month" ? 30 : 7;
    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    since.setHours(0, 0, 0, 0);
    const profitByDate = new Map();
    for (const expense of dashboard.expenses) {
      const dateKey = expense.dateKey || toDateKey(normalizeDate(expense.date) || normalizeDate(expense.createdAt) || new Date());
      const settings = getSupplierSettings(dashboard.duitbizSuppliers, expense.supplierName);
      const profit = (Number(expense.amount) || 0) * ((Number(settings.marginPercent) || 0) / 100);
      profitByDate.set(dateKey, (profitByDate.get(dateKey) || 0) + profit);
    }

    return dashboard.closings
      .map((closing) => ({
        dateKey: closing.dateKey || toDateKey(normalizeDate(closing.date) || new Date()),
        sales: closingTotalSales(closing),
        profit: profitByDate.get(closing.dateKey || toDateKey(normalizeDate(closing.date) || new Date())) || 0,
      }))
      .filter((closing) => new Date(closing.dateKey) >= since)
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  }, [dashboard.closings, dashboard.duitbizSuppliers, dashboard.expenses, range]);

  const lowStock = useMemo(
    () =>
      dashboard.products
        .filter((product) => getProductQuantity(product) < LOW_STOCK_LIMIT)
        .sort((a, b) => getProductQuantity(a) - getProductQuantity(b)),
    [dashboard.products]
  );

  const recentMovements = useMemo(
    () =>
      [...dashboard.movements]
        .sort((a, b) => {
          const aDate = normalizeDate(a.date)?.getTime() || 0;
          const bDate = normalizeDate(b.date)?.getTime() || 0;
          return bDate - aDate;
        })
        .slice(0, 10),
    [dashboard.movements]
  );

  const topProducts = useMemo(() => {
    const totals = new Map();
    for (const movement of dashboard.movements) {
      if (String(movement.type).toLowerCase() !== "out") continue;
      const name = productMovementName(movement);
      totals.set(name, (totals.get(name) || 0) + (Number(movement.quantity) || 0));
    }
    return [...totals.entries()]
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
  }, [dashboard.movements]);

  const expenseBreakdown = useMemo(() => {
    const totals = new Map();
    for (const expense of dashboard.expenses) {
      const category = expense.category || expense.type || "Uncategorized";
      totals.set(category, (totals.get(category) || 0) + getAmount(expense, ["amount", "cost", "total"]));
    }
    return [...totals.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);
  }, [dashboard.expenses]);

  const todayKey = toDateKey(new Date());
  const yesterdayKey = (() => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return toDateKey(date);
  })();

  const businessHealth = useMemo(() => {
    const todayClosing = dashboard.closings.find(
      (closing) => closing.dateKey === todayKey || toDateKey(normalizeDate(closing.date) || new Date(0)) === todayKey
    );
    const yesterdayClosing = dashboard.closings.find(
      (closing) =>
        closing.dateKey === yesterdayKey || toDateKey(normalizeDate(closing.date) || new Date(0)) === yesterdayKey
    );
    const todaySales = closingTotalSales(todayClosing);
    const yesterdaySales = closingTotalSales(yesterdayClosing);
    const salesTrend = yesterdaySales > 0 ? ((todaySales - yesterdaySales) / yesterdaySales) * 100 : 0;
    const stockPotential = metrics.salesValue - metrics.stockValue;
    const highestSupplierOwed = metrics.supplierDebts[0] || null;
    const debtToStockRatio = metrics.stockValue > 0 ? metrics.supplierDebt / metrics.stockValue : 0;
    const profitStatus = duitbizProfitPercent > 20 ? "green" : duitbizProfitPercent >= 10 ? "orange" : "red";

    return {
      todaySales,
      todayDaySales: Number(todayClosing?.daySales) || 0,
      todayNightSales: Number(todayClosing?.nightSales) || 0,
      todayOnlineSales: Number(todayClosing?.onlineSales) || 0,
      salesTrend,
      stockPotential,
      highestSupplierOwed,
      debtToStockRatio,
      profitStatus,
    };
  }, [dashboard.closings, duitbizProfitPercent, metrics, todayKey, yesterdayKey]);

  const monthClosings = useMemo(
    () => dashboard.closings.filter((closing) => String(closing.dateKey || "").startsWith(currentMonthKey)),
    [currentMonthKey, dashboard.closings]
  );

  const monthSalesTotal = useMemo(
    () => monthClosings.reduce((sum, closing) => sum + closingTotalSales(closing), 0),
    [monthClosings]
  );

  const monthCashOutToBank = useMemo(
    () => monthClosings.reduce((sum, closing) => sum + getClosingBankAmount(closing), 0),
    [monthClosings]
  );

  const monthSalesSecuredPercent = monthSalesTotal > 0 ? (monthCashOutToBank / monthSalesTotal) * 100 : 0;

  const stockRisk = useMemo(() => {
    const soldKeys = new Set();
    for (const movement of dashboard.movements) {
      if (String(movement.type || "").toLowerCase() !== "out") continue;
      if (movement.productId) soldKeys.add(movement.productId);
      soldKeys.add(normalizeName(productMovementName(movement)));
    }

    const deadStock = dashboard.products.filter((product) => {
      const quantity = getProductQuantity(product);
      if (quantity <= 0) return false;
      return !soldKeys.has(product.id) && !soldKeys.has(normalizeName(product.name));
    });

    return {
      deadStockCount: deadStock.length,
      highestRiskProduct: lowStock[0] || deadStock[0] || null,
    };
  }, [dashboard.movements, dashboard.products, lowStock]);

  const fastestMovingProducts = useMemo(() => {
    const totals = new Map();
    for (const movement of dashboard.movements) {
      if (String(movement.type || "").toLowerCase() !== "out") continue;
      const product = productsByIdForView.get(movement.productId);
      const key = movement.productId || normalizeName(productMovementName(movement));
      const current = totals.get(key) || {
        name: product?.name || productMovementName(movement),
        soldQty: 0,
        remainingStock: product ? getProductQuantity(product) : 0,
      };
      current.soldQty += Number(movement.quantity) || 0;
      totals.set(key, current);
    }
    return [...totals.values()].sort((a, b) => b.soldQty - a.soldQty).slice(0, 5);
  }, [dashboard.movements, productsByIdForView]);

  const liveActivityFeed = useMemo(() => {
    const activities = [];

    dashboard.closings.slice(0, 12).forEach((closing) => {
      activities.push({
        id: `closing-${closing.id}`,
        date: normalizeDate(closing.createdAt || closing.date || closing.dateKey),
        event: "Daily closing",
        amount: closingTotalSales(closing),
        module: "Duitbiz",
      });
    });

    dashboard.expenses.slice(0, 20).forEach((expense) => {
      activities.push({
        id: `expense-${expense.id}`,
        date: normalizeDate(expense.createdAt || expense.date || expense.dateKey),
        event: `${expense.supplierName || expense.productName || expense.category || "Expense"} added`,
        amount: getAmount(expense, ["amount", "cost", "total"]),
        module: "Duitbiz",
      });
    });

    dashboard.supplierTransactions.slice(0, 20).forEach((transaction) => {
      activities.push({
        id: `supplier-${transaction.id}`,
        date: normalizeDate(transaction.createdAt || transaction.date),
        event: `${supplierName(transaction, suppliersByIdForView)} supplier payment`,
        amount: Math.abs(signedSupplierAmount(transaction)),
        module: "Supplier Debt",
      });
    });

    dashboard.movements.slice(0, 20).forEach((movement) => {
      activities.push({
        id: `movement-${movement.id}`,
        date: normalizeDate(movement.createdAt || movement.date),
        event: `${productMovementName(movement)} stock movement`,
        amount: `${formatNumber(Number(movement.quantity) || 0)} units`,
        module: "DuitStock",
      });
    });

    lowStock.slice(0, 8).forEach((product) => {
      activities.push({
        id: `low-${product.id}`,
        date: normalizeDate(product.updatedAt || product.createdAt),
        event: `${product.name || "Product"} low stock`,
        amount: `${formatNumber(getProductQuantity(product))} left`,
        module: "DuitStock",
      });
    });

    return activities
      .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
      .slice(0, 8);
  }, [
    dashboard.closings,
    dashboard.expenses,
    dashboard.movements,
    dashboard.supplierTransactions,
    lowStock,
    suppliersByIdForView,
  ]);

  const salesChartConfig = useMemo(
    () => ({
      type: "line",
      data: {
        labels: salesRows.map((row) => row.dateKey.slice(5)),
        datasets: [
          {
            label: "Sales",
            data: salesRows.map((row) => row.sales),
            borderColor: "#42bd55",
            backgroundColor: "rgba(78, 196, 95, 0.16)",
            borderWidth: 3,
            pointBackgroundColor: "#f8fcf7",
            pointBorderColor: "#42bd55",
            pointRadius: 4,
            fill: true,
            tension: 0.35,
          },
          {
            label: "Estimated profit",
            data: salesRows.map((row) => row.profit),
            borderColor: "#111b14",
            backgroundColor: "rgba(17, 27, 20, 0.08)",
            borderDash: [5, 5],
            borderWidth: 2,
            pointRadius: 3,
            fill: false,
            tension: 0.35,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: { color: "#4f5d52", boxWidth: 10, usePointStyle: true },
          },
          tooltip: {
            callbacks: {
              label: (context) => formatCurrency(context.parsed.y),
            },
          },
        },
        scales: {
          x: {
            grid: { color: "rgba(31, 75, 38, 0.08)" },
            ticks: { color: "#6f7b71" },
          },
          y: {
            grid: { color: "rgba(31, 75, 38, 0.08)" },
            ticks: {
              color: "#6f7b71",
              callback: (value) => `RM ${formatNumber(value)}`,
            },
          },
        },
      },
    }),
    [salesRows]
  );

  const expenseChartConfig = useMemo(
    () => ({
      type: "bar",
      data: {
        labels: expenseBreakdown.map((expense) => expense.category),
        datasets: [
          {
            label: "Expenses",
            data: expenseBreakdown.map((expense) => expense.amount),
            backgroundColor: "#00d4b8",
            borderRadius: 6,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            grid: { color: "rgba(255,255,255,0.06)" },
            ticks: { color: "#9fb2c8" },
          },
          y: {
            grid: { display: false },
            ticks: { color: "#dbe8f7" },
          },
        },
      },
    }),
    [expenseBreakdown]
  );

  useChart(salesChartRef, salesChartConfig, activeView);
  useChart(expenseChartRef, expenseChartConfig, activeView);

  if (!mounted) return null;

  const unlockApp = () => {
    setUnlocked(true);
  };

  const lockApp = () => {
    window.localStorage.removeItem(UNLOCK_STORAGE_KEY);
    setUnlocked(false);
    setActiveView("Dashboard");
    setDetailView(null);
    setErrors([]);
  };

  if (!unlocked) return <PinLockScreen onUnlock={unlockApp} />;

  const pageSubtitle =
    activeView === "Dashboard"
      ? "Magic Leaves business overview for today"
      : activeView === "Settings"
        ? "Workspace preferences"
        : activeView === "Help"
          ? "Support and guidance"
          : activeView === "Logout"
            ? "Session actions"
            : `${activeView} module`;

  return (
    <main className={styles.page}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarBrand}>
          <span className={styles.logo}>🍃</span>
          <strong>Magic Leaves</strong>
        </div>

        <nav className={styles.sidebarNav} aria-label="Dashboard modules">
          {NAV_ITEMS.map((item) => (
            <button
              className={`${styles.navItem} ${activeView === item ? styles.activeNavItem : ""}`}
              key={item}
              onClick={() => (item === "Lock" ? lockApp() : setActiveView(item))}
              type="button"
            >
              <span>{item.slice(0, 1)}</span>
              {item}
            </button>
          ))}
        </nav>

        <div className={styles.sidebarStatus}>
          <span>Live</span>
          <strong>{dashboard.products.length}</strong>
          <p>Products tracked</p>
          <button className={styles.lockButton} onClick={lockApp} type="button">
            Lock
          </button>
        </div>
      </aside>

      <section className={styles.dashboardArea}>
        <header className={styles.topbar}>
          <div>
            <h1>Welcome, Adam 👋</h1>
            <p>{pageSubtitle}</p>
          </div>

          <div className={styles.topbarActions}>
            <button className={styles.iconButton} type="button" title="Search">
              ⌕
            </button>
            <button className={styles.iconButton} type="button" title="Notifications">
              ◦
            </button>
            <span>
              Last updated{" "}
              {lastUpdated
                ? lastUpdated.toLocaleTimeString("en-MY", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })
                : "loading"}
            </span>
            <button
              className={styles.refreshButton}
              onClick={() => loadDashboard({ quiet: true })}
              disabled={refreshing || loading}
              type="button"
              title="Refresh dashboard"
            >
              <span className={refreshing ? styles.spin : ""}>↻</span>
              Refresh
            </button>
          </div>
        </header>

        {errors.length > 0 && (
          <section className={styles.errorPanel}>
            {errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </section>
        )}

        {activeView === "Dashboard" && (
          <section className={styles.commandCenter}>
            <section className={styles.healthGrid}>
              <section className={`${styles.kpiCard} ${styles.kpiDark}`}>
                <p>Total Sales Today</p>
                {loading ? <Skeleton className={styles.statSkeleton} /> : <strong>{formatCurrency(businessHealth.todaySales)}</strong>}
                <div className={styles.kpiBreakdown}>
                  <span>Day <b>{formatCurrency(businessHealth.todayDaySales)}</b></span>
                  <span>Night <b>{formatCurrency(businessHealth.todayNightSales)}</b></span>
                  <span>Online <b>{formatCurrency(businessHealth.todayOnlineSales)}</b></span>
                </div>
                <em className={businessHealth.salesTrend >= 0 ? styles.trendPositive : styles.trendNegative}>
                  {businessHealth.salesTrend >= 0 ? "Up" : "Down"} {formatPercent(Math.abs(businessHealth.salesTrend))} vs yesterday
                </em>
              </section>

              <section className={`${styles.kpiCard} ${styles[`profitStatus${businessHealth.profitStatus}`]}`}>
                <p>Estimated Profit</p>
                {loading ? <Skeleton className={styles.statSkeleton} /> : <strong>{formatCurrency(duitbizEstimatedProfit)}</strong>}
                <div className={styles.kpiInline}>
                  <span>Profit margin</span>
                  <b>{formatPercent(duitbizProfitPercent)}</b>
                </div>
                <em>Supplier margin logic</em>
              </section>

              <section className={styles.kpiCard}>
                <p>Inventory Power</p>
                {loading ? <Skeleton className={styles.statSkeleton} /> : <strong>{formatCurrency(metrics.stockValue)}</strong>}
                <div className={styles.kpiBreakdown}>
                  <span>Selling value <b>{formatCurrency(metrics.salesValue)}</b></span>
                  <span>Profit potential <b>{formatCurrency(businessHealth.stockPotential)}</b></span>
                </div>
                <button className={styles.viewAllButton} onClick={() => setActiveView("DuitStock")} type="button">
                  View DuitStock
                </button>
              </section>

              <section className={styles.kpiCard}>
                <p>Liability Status</p>
                {loading ? <Skeleton className={styles.statSkeleton} /> : <strong>{formatCurrency(metrics.supplierDebt)}</strong>}
                <div className={styles.kpiBreakdown}>
                  <span>Highest owed <b>{businessHealth.highestSupplierOwed?.name || "n/a"}</b></span>
                  <span>Debt-to-stock <b>{formatPercent(businessHealth.debtToStockRatio * 100)}</b></span>
                </div>
                <button className={styles.viewAllButton} onClick={() => setActiveView("Supplier Debt")} type="button">
                  View debt
                </button>
              </section>
            </section>

            <section className={styles.heartbeatGrid}>
              <section className={`${styles.panel} ${styles.chartPanel} ${styles.heartbeatChart}`}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Business heartbeat</p>
                    <h2>Weekly Sales Trend</h2>
                  </div>
                  <div className={styles.segmented} aria-label="Sales date range">
                    {["today", "week", "month"].map((option) => (
                      <button
                        key={option}
                        className={range === option ? styles.activeSegment : ""}
                        onClick={() => setRange(option)}
                        type="button"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.chartBox}>
                  {loading ? <Skeleton className={styles.chartSkeleton} /> : <canvas ref={salesChartRef} />}
                </div>
              </section>

              <aside className={styles.intelligenceStack}>
                <section className={styles.intelligenceCard}>
                  <p>Cash Position</p>
                  <strong>{formatCurrency(currentPcBalance)}</strong>
                  <span>Month start {formatCurrency(monthStartPcBalance)}</span>
                  <em className={pcBalanceMovement >= 0 ? styles.trendPositive : styles.trendNegative}>
                    {pcBalanceMovement >= 0 ? "Positive" : "Negative"} movement {formatCurrency(pcBalanceMovement)}
                  </em>
                </section>

                <section className={styles.intelligenceCard}>
                  <p>Stock Alerts</p>
                  <strong>{formatNumber(lowStock.length)} low stock</strong>
                  <span>{formatNumber(stockRisk.deadStockCount)} dead stock products</span>
                  <em>{stockRisk.highestRiskProduct?.name || "No risk product"} {stockRisk.highestRiskProduct ? `(${formatNumber(getProductQuantity(stockRisk.highestRiskProduct))} left)` : ""}</em>
                </section>

                <section className={styles.intelligenceCard}>
                  <p>Banked Out</p>
                  <strong>{formatCurrency(monthCashOutToBank)}</strong>
                  <span>{formatPercent(monthSalesSecuredPercent)} of monthly sales secured</span>
                  <button className={styles.viewAllButton} onClick={() => setActiveView("Duitbiz")} type="button">
                    View Duitbiz
                  </button>
                </section>
              </aside>
            </section>

            <section className={styles.insightGrid}>
              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Profit engine</p>
                    <h2>Top Supplier Profits</h2>
                  </div>
                  <button className={styles.viewAllButton} onClick={() => setActiveView("Duitbiz")} type="button">
                    View all
                  </button>
                </div>
                <div className={styles.barList}>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
                  ) : supplierProfitRanking.length ? (
                    supplierProfitRanking.slice(0, 5).map((supplier) => {
                      const maxAmount = supplierProfitRanking[0]?.estimatedProfit || 1;
                      return (
                        <div className={styles.barRow} key={supplier.supplier}>
                          <span>{supplier.supplier}</span>
                          <div>
                            <i style={{ width: `${Math.max(6, (supplier.estimatedProfit / maxAmount) * 100)}%` }} />
                          </div>
                          <b>{formatCurrency(supplier.estimatedProfit)} · {formatPercent(supplier.marginPercent)}</b>
                        </div>
                      );
                    })
                  ) : (
                    <EmptyState>No supplier profit data found.</EmptyState>
                  )}
                </div>
              </section>

              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Cost control</p>
                    <h2>Top Expenses</h2>
                  </div>
                  <button className={styles.viewAllButton} onClick={() => setActiveView("Duitbiz")} type="button">
                    View all
                  </button>
                </div>
                <div className={styles.dataTable}>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
                  ) : bigExpenses.length ? (
                    bigExpenses.slice(0, 5).map((expense, index) => (
                      <div className={`${styles.tableRow} ${index === 0 ? styles.highlightRow : ""}`} key={expense.id}>
                        <span>{expense.dateKey || formatDate(expense.date || expense.createdAt)}</span>
                        <strong>{expense.supplierName || expense.productName || expense.category || "Expense"}</strong>
                        <b>{formatCurrency(getAmount(expense, ["amount", "cost", "total"]))}</b>
                      </div>
                    ))
                  ) : (
                    <EmptyState>No expenses found.</EmptyState>
                  )}
                </div>
              </section>

              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Velocity</p>
                    <h2>Fastest Moving Products</h2>
                  </div>
                  <button className={styles.viewAllButton} onClick={() => setActiveView("DuitStock")} type="button">
                    View all
                  </button>
                </div>
                <div className={styles.dataTable}>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
                  ) : fastestMovingProducts.length ? (
                    fastestMovingProducts.map((product) => (
                      <div className={styles.tableRow} key={product.name}>
                        <span>{formatNumber(product.remainingStock)} left</span>
                        <strong>{product.name}</strong>
                        <b>{formatNumber(product.soldQty)} sold</b>
                      </div>
                    ))
                  ) : (
                    <EmptyState>No stock movement data found.</EmptyState>
                  )}
                </div>
              </section>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Live operations</p>
                  <h2>Activity Feed</h2>
                </div>
                <span>{liveActivityFeed.length} latest events</span>
              </div>
              <div className={styles.activityFeed}>
                {loading ? (
                  Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
                ) : liveActivityFeed.length ? (
                  liveActivityFeed.map((activity) => (
                    <div className={styles.activityRow} key={activity.id}>
                      <span>{formatTime(activity.date)}</span>
                      <strong>{activity.event}</strong>
                      <em>{activity.module}</em>
                      <b>{typeof activity.amount === "number" ? formatCurrency(activity.amount) : activity.amount}</b>
                    </div>
                  ))
                ) : (
                  <EmptyState>No recent activity found.</EmptyState>
                )}
              </div>
            </section>
          </section>
        )}

        {activeView === "Duitbiz" && (
          <section className={styles.viewStack}>
            <section className={styles.summaryGrid}>
              <BreakdownStatCard
                label="Total Sales"
                value={formatCurrency(duitbizBreakdown.totalSales)}
                rows={[
                  { label: "Day sales", value: formatCurrency(duitbizBreakdown.daySales) },
                  { label: "Night sales", value: formatCurrency(duitbizBreakdown.nightSales) },
                  { label: "Online sales", value: formatCurrency(duitbizBreakdown.onlineSales) },
                ]}
                loading={loading}
              />
              <BreakdownStatCard
                label="Total Expenses"
                value={formatCurrency(duitbizBreakdown.totalExpenses)}
                rows={[
                  { label: "Cash expenses", value: formatCurrency(duitbizBreakdown.cashExpenses) },
                  { label: "Online expenses", value: formatCurrency(duitbizBreakdown.onlineExpenses) },
                  { label: "PC expenses", value: formatCurrency(duitbizBreakdown.pcExpenses) },
                ]}
                loading={loading}
              />
              <StatCard
                label="Estimated Profit"
                value={formatCurrency(duitbizEstimatedProfit)}
                detail="Supplier margin calculation"
                loading={loading}
              />
              <StatCard
                label="PC Balance"
                value={formatCurrency(Number(latestClosing.newPcBalance ?? latestClosing.endOfDayPcBalance) || 0)}
                detail={latestClosing.dateKey ? `Latest closing ${latestClosing.dateKey}` : "Latest closing"}
                loading={loading}
              />
            </section>

            <section className={styles.dashboardGrid}>
              <section className={`${styles.panel} ${styles.chartPanel}`}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Duitbiz</p>
                    <h2>Sales Trend</h2>
                  </div>
                  <div className={styles.segmented} aria-label="Sales date range">
                    {["today", "week", "month"].map((option) => (
                      <button
                        key={option}
                        className={range === option ? styles.activeSegment : ""}
                        onClick={() => setRange(option)}
                        type="button"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.chartBox}>
                  {loading ? <Skeleton className={styles.chartSkeleton} /> : <canvas ref={salesChartRef} />}
                </div>
              </section>

              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Duitbiz</p>
                    <h2>Profit Analysis</h2>
                  </div>
                </div>
                <div className={styles.metricList}>
                  <div>
                    <span>Estimated Profit</span>
                    <strong>{formatCurrency(duitbizEstimatedProfit)}</strong>
                    <em>{duitbizProfitPercent.toFixed(1)}% overall margin</em>
                  </div>
                  <div>
                    <span>Confirmed Profit</span>
                    <strong>{formatCurrency(confirmedStockProfit)}</strong>
                    <em>From stock movement profit</em>
                  </div>
                  <div>
                    <span>Total Cash Out to Bank</span>
                    <strong>{formatCurrency(totalCashOutToBank)}</strong>
                    <em>Banked from closings</em>
                  </div>
                  <div>
                    <span>PC Balance Movement</span>
                    <strong>{formatCurrency(pcBalanceMovement)}</strong>
                    <em>{pcBalanceMovement >= 0 ? "Positive" : "Negative"}</em>
                  </div>
                </div>
              </section>
            </section>

            <section className={styles.dashboardGrid}>
              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Duitbiz</p>
                    <h2>Sales Breakdown</h2>
                  </div>
                </div>
                <div className={styles.barList}>
                  {salesBreakdownRows.map((row) => {
                    const maxValue = Math.max(1, ...salesBreakdownRows.map((item) => item.value));
                    return (
                      <div className={styles.barRow} key={row.label}>
                        <span>{row.label}</span>
                        <div>
                          <i style={{ width: `${Math.max(6, (row.value / maxValue) * 100)}%` }} />
                        </div>
                        <b>{formatCurrency(row.value)}</b>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Duitbiz</p>
                    <h2>Expenses Breakdown</h2>
                  </div>
                </div>
                <div className={styles.barList}>
                  {expensesBreakdownRows.map((row) => {
                    const maxValue = Math.max(1, ...expensesBreakdownRows.map((item) => item.value));
                    return (
                      <div className={styles.barRow} key={row.label}>
                        <span>{row.label}</span>
                        <div>
                          <i style={{ width: `${Math.max(6, (row.value / maxValue) * 100)}%` }} />
                        </div>
                        <b>{formatCurrency(row.value)}</b>
                      </div>
                    );
                  })}
                </div>
              </section>
            </section>

            <section className={styles.dashboardGrid}>
              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Duitbiz</p>
                    <h2>PC Balance History</h2>
                  </div>
                  <button className={styles.viewAllButton} onClick={() => setDetailView("pc")} type="button">
                    View all
                  </button>
                </div>
                <div className={styles.barList}>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
                  ) : pcBalanceRows.length ? (
                    pcBalanceRows.slice(0, 7).map((row) => (
                      <div className={styles.barRow} key={row.id}>
                        <span>{row.date}</span>
                        <div>
                          <i style={{ width: `${Math.max(6, (Math.abs(row.newPcBalance) / pcBalanceMax) * 100)}%` }} />
                        </div>
                        <b>{formatCurrency(row.newPcBalance)}</b>
                      </div>
                    ))
                  ) : (
                    <EmptyState>No PC balance history found.</EmptyState>
                  )}
                </div>
              </section>

              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Duitbiz</p>
                    <h2>Supplier Profit Top 8</h2>
                  </div>
                </div>
                <div className={styles.barList}>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
                  ) : supplierProfitRanking.length ? (
                    supplierProfitRanking.map((supplier) => {
                      const maxAmount = supplierProfitRanking[0]?.estimatedProfit || 1;
                      return (
                        <div className={styles.barRow} key={supplier.supplier}>
                          <span>{supplier.supplier}</span>
                          <div>
                            <i style={{ width: `${Math.max(6, (supplier.estimatedProfit / maxAmount) * 100)}%` }} />
                          </div>
                          <b>{formatCurrency(supplier.estimatedProfit)}</b>
                        </div>
                      );
                    })
                  ) : (
                    <EmptyState>No supplier chart data found.</EmptyState>
                  )}
                </div>
              </section>
            </section>

            <section className={styles.dashboardGrid}>
              <section className={`${styles.panel} ${styles.listPanel}`}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Duitbiz</p>
                    <h2>Big Expenses</h2>
                  </div>
                  <button className={styles.viewAllButton} onClick={() => setDetailView("bigExpenses")} type="button">
                    View all
                  </button>
                </div>
                <div className={styles.dataTable}>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
                  ) : bigExpenses.length ? (
                    bigExpenses.slice(0, 5).map((expense) => (
                      <div className={styles.tableRow} key={expense.id}>
                        <span>{expense.dateKey || formatDate(expense.date || expense.createdAt)}</span>
                        <strong>{expense.productName || expense.category || expense.supplierName || "Expense"}</strong>
                        <b>{formatCurrency(getAmount(expense, ["amount", "cost", "total"]))}</b>
                      </div>
                    ))
                  ) : (
                    <EmptyState>No big expenses found.</EmptyState>
                  )}
                </div>
              </section>

              <section className={`${styles.panel} ${styles.listPanel}`}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Duitbiz</p>
                    <h2>Recent Closings</h2>
                  </div>
                  <button className={styles.viewAllButton} onClick={() => setDetailView("closings")} type="button">
                    View all
                  </button>
                </div>
                <div className={styles.dataTable}>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
                  ) : dashboard.closings.length ? (
                    dashboard.closings.slice(0, 5).map((closing) => (
                      <div className={styles.tableRow} key={closing.id}>
                        <span>{closing.dateKey || formatDate(closing.date)}</span>
                        <strong>{formatCurrency(Number(closing.daySales) || 0)}</strong>
                        <b>{formatCurrency(Number(closing.cashExpenses) || 0)}</b>
                      </div>
                    ))
                  ) : (
                    <EmptyState>No Duitbiz closings found.</EmptyState>
                  )}
                </div>
              </section>
            </section>

            <section className={`${styles.panel} ${styles.listPanel}`}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Duitbiz</p>
                  <h2>Recent Expenses</h2>
                </div>
                <button className={styles.viewAllButton} onClick={() => setDetailView("expenses")} type="button">
                  View all
                </button>
              </div>
              <div className={styles.dataTable}>
                {loading ? (
                  Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
                ) : dashboard.expenses.length ? (
                  dashboard.expenses.slice(0, 5).map((expense) => (
                    <div className={styles.tableRow} key={expense.id}>
                      <span>{expense.dateKey || formatDate(expense.date || expense.createdAt)}</span>
                      <strong>{expense.productName || expense.category || expense.supplierName || "Expense"}</strong>
                      <b>{formatCurrency(getAmount(expense, ["amount", "cost", "total"]))}</b>
                    </div>
                  ))
                ) : (
                  <EmptyState>No Duitbiz expenses found.</EmptyState>
                )}
              </div>
            </section>
          </section>
        )}

        {activeView === "DuitStock" && (
          <section className={styles.viewStack}>
            <section className={styles.summaryGrid}>
              <StatCard
                label="Stock Value"
                value={formatCurrency(metrics.stockValue)}
                subValue={`Sales Value: ${formatCurrency(metrics.salesValue)}`}
                detail={`${dashboard.products.length} products`}
                loading={loading}
              />
              <StatCard
                label="Products"
                value={formatNumber(dashboard.products.length)}
                detail="Product records"
                loading={loading}
              />
              <StatCard
                label="Low Stock"
                value={formatNumber(lowStock.length)}
                detail={`Below ${LOW_STOCK_LIMIT} units`}
                loading={loading}
              />
              <StatCard
                label="Movements"
                value={formatNumber(dashboard.movements.length)}
                detail="Stock movement records"
                loading={loading}
              />
            </section>

            <section className={styles.dashboardGrid}>
              <section className={`${styles.panel} ${styles.listPanel}`}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>DuitStock</p>
                    <h2>Product List</h2>
                  </div>
                  <span>{dashboard.products.length} products</span>
                </div>
                <div className={styles.dataTable}>
                  {loading ? (
                    Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
                  ) : dashboard.products.length ? (
                    dashboard.products.slice(0, 14).map((product) => (
                      <div className={styles.tableRow} key={product.id}>
                        <span>{product.sku || product.category || "Product"}</span>
                        <strong>{product.name || "Unnamed product"}</strong>
                        <b>{formatNumber(getProductQuantity(product))}</b>
                      </div>
                    ))
                  ) : (
                    <EmptyState>No products found.</EmptyState>
                  )}
                </div>
              </section>

              <section className={`${styles.panel} ${styles.listPanel}`}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>DuitStock</p>
                    <h2>Low Stock</h2>
                  </div>
                  <span>{lowStock.length} alerts</span>
                </div>
                <div className={styles.list}>
                  {loading ? (
                    Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
                  ) : lowStock.length ? (
                    lowStock.map((product) => (
                      <div className={styles.listRow} key={product.id}>
                        <div>
                          <strong>{product.name || "Unnamed product"}</strong>
                          <span>Current quantity</span>
                        </div>
                        <b className={getProductQuantity(product) < 5 ? styles.dangerBadge : styles.badge}>
                          {formatNumber(getProductQuantity(product))}
                        </b>
                      </div>
                    ))
                  ) : (
                    <EmptyState>No products below 10 units.</EmptyState>
                  )}
                </div>
              </section>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>DuitStock</p>
                  <h2>Stock Movements</h2>
                </div>
                <span>{dashboard.movements.length} records</span>
              </div>
              <div className={styles.dataTable}>
                {loading ? (
                  Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
                ) : recentMovements.length ? (
                  recentMovements.map((movement) => (
                    <div className={styles.tableRow} key={movement.id}>
                      <span>{formatDate(movement.date || movement.createdAt)}</span>
                      <strong>{productMovementName(movement)}</strong>
                      <b>{String(movement.type || "n/a")} / {formatNumber(movement.quantity)}</b>
                    </div>
                  ))
                ) : (
                  <EmptyState>No stock movements found.</EmptyState>
                )}
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>DuitStock</p>
                  <h2>Top Selling Products</h2>
                </div>
                <span>By stock out</span>
              </div>
              <div className={styles.dataTable}>
                {loading ? (
                  Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
                ) : topProducts.length ? (
                  topProducts.map((product, index) => (
                    <div className={styles.tableRow} key={product.name}>
                      <span>#{index + 1}</span>
                      <strong>{product.name}</strong>
                      <b>{formatNumber(product.quantity)}</b>
                    </div>
                  ))
                ) : (
                  <EmptyState>No outgoing product movements found.</EmptyState>
                )}
              </div>
            </section>
          </section>
        )}

        {activeView === "Supplier Debt" && (
          <section className={styles.viewStack}>
            <section className={styles.summaryGrid}>
              <StatCard
                label="Supplier Debt"
                value={formatCurrency(metrics.supplierDebt)}
                detail={`${metrics.supplierDebts.length} suppliers owed`}
                loading={loading}
              />
              <StatCard
                label="Suppliers"
                value={formatNumber(dashboard.suppliers.length)}
                detail="Supplier records"
                loading={loading}
              />
              <StatCard
                label="Transactions"
                value={formatNumber(dashboard.supplierTransactions.length)}
                detail="Debt and payment records"
                loading={loading}
              />
            </section>

            <section className={styles.dashboardGrid}>
              <section className={`${styles.panel} ${styles.listPanel}`}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Supplier Debt</p>
                    <h2>You Owe</h2>
                  </div>
                  <span>{formatCurrency(metrics.supplierDebt)}</span>
                </div>
                <div className={styles.list}>
                  {loading ? (
                    Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
                  ) : metrics.supplierDebts.length ? (
                    metrics.supplierDebts.map((supplier) => (
                      <div className={styles.listRow} key={supplier.name}>
                        <div>
                          <strong>{supplier.name}</strong>
                          <span className={styles.overdue}>Outstanding</span>
                        </div>
                        <b>{formatCurrency(supplier.amount)}</b>
                      </div>
                    ))
                  ) : (
                    <EmptyState>No supplier debt found.</EmptyState>
                  )}
                </div>
              </section>

              <section className={`${styles.panel} ${styles.listPanel}`}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Supplier Debt</p>
                    <h2>Supplier List</h2>
                  </div>
                  <span>{dashboard.suppliers.length} suppliers</span>
                </div>
                <div className={styles.dataTable}>
                  {loading ? (
                    Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
                  ) : dashboard.suppliers.length ? (
                    dashboard.suppliers.slice(0, 12).map((supplier) => (
                      <div className={styles.tableRow} key={supplier.id}>
                        <span>{formatDate(supplier.updatedAt || supplier.createdAt)}</span>
                        <strong>{supplier.name || "Unnamed supplier"}</strong>
                        <b>{supplier.id?.slice(0, 8) || "n/a"}</b>
                      </div>
                    ))
                  ) : (
                    <EmptyState>No suppliers found.</EmptyState>
                  )}
                </div>
              </section>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Supplier Debt</p>
                  <h2>Supplier Transactions</h2>
                </div>
                <span>{dashboard.supplierTransactions.length} records</span>
              </div>
              <div className={styles.dataTable}>
                {loading ? (
                  Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
                ) : dashboard.supplierTransactions.length ? (
                  dashboard.supplierTransactions.slice(0, 14).map((transaction) => (
                    <div className={styles.tableRow} key={transaction.id}>
                      <span>{formatDate(transaction.date || transaction.createdAt)}</span>
                      <strong>{supplierName(transaction, suppliersByIdForView)}</strong>
                      <b>{formatCurrency(getAmount(transaction, ["amount", "debtAmount", "balance", "total"]))}</b>
                    </div>
                  ))
                ) : (
                  <EmptyState>No supplier transactions found.</EmptyState>
                )}
              </div>
            </section>
          </section>
        )}

        {activeView === "Settings" && (
          <section className={styles.settingsPanel}>
            <p className={styles.eyebrow}>Settings</p>
            <h2>Settings</h2>
            <span>Settings page placeholder. Module preferences and dashboard options will live here later.</span>
          </section>
        )}

        {activeView === "Help" && (
          <section className={styles.settingsPanel}>
            <p className={styles.eyebrow}>Help</p>
            <h2>Help</h2>
            <span>Help center placeholder. Support links and usage notes will live here later.</span>
          </section>
        )}

        {activeView === "Logout" && (
          <section className={styles.settingsPanel}>
            <p className={styles.eyebrow}>Logout</p>
            <h2>Logout</h2>
            <span>Logout placeholder. Authentication actions can be connected here later.</span>
          </section>
        )}

        {detailView && (
          <div className={styles.modalBackdrop} role="presentation" onClick={() => setDetailView(null)}>
            <section className={styles.modalPanel} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div>
                  <p className={styles.eyebrow}>Duitbiz</p>
                  <h2>
                    {detailView === "closings" && "All Closings"}
                    {detailView === "expenses" && "All Expenses"}
                    {detailView === "pc" && "PC Balance History"}
                    {detailView === "bigExpenses" && "Big Expenses"}
                  </h2>
                </div>
                <button className={styles.viewAllButton} onClick={() => setDetailView(null)} type="button">
                  Close
                </button>
              </div>

              <div className={styles.modalBody}>
                {detailView === "closings" && (
                  <div className={styles.dataTable}>
                    {dashboard.closings.length ? (
                      dashboard.closings.map((closing) => (
                        <div className={styles.tableRow} key={closing.id}>
                          <span>{closing.dateKey || formatDate(closing.date)}</span>
                          <strong>{formatCurrency(Number(closing.daySales) || 0)}</strong>
                          <b>{formatCurrency(Number(closing.cashExpenses) || 0)}</b>
                        </div>
                      ))
                    ) : (
                      <EmptyState>No Duitbiz closings found.</EmptyState>
                    )}
                  </div>
                )}

                {detailView === "expenses" && (
                  <div className={styles.dataTable}>
                    {dashboard.expenses.length ? (
                      dashboard.expenses.map((expense) => (
                        <div className={styles.tableRow} key={expense.id}>
                          <span>{expense.dateKey || formatDate(expense.date || expense.createdAt)}</span>
                          <strong>{expense.productName || expense.category || expense.supplierName || "Expense"}</strong>
                          <b>{formatCurrency(getAmount(expense, ["amount", "cost", "total"]))}</b>
                        </div>
                      ))
                    ) : (
                      <EmptyState>No Duitbiz expenses found.</EmptyState>
                    )}
                  </div>
                )}

                {detailView === "pc" && (
                  <div className={styles.dataTable}>
                    {pcBalanceRows.length ? (
                      pcBalanceRows.map((row) => (
                        <div className={styles.tableRow} key={row.id}>
                          <span>{row.date}</span>
                          <strong>{formatCurrency(row.oldPcBalance)} → {formatCurrency(row.newPcBalance)}</strong>
                          <b>{formatCurrency(row.pcAmount)}</b>
                        </div>
                      ))
                    ) : (
                      <EmptyState>No PC balance history found.</EmptyState>
                    )}
                  </div>
                )}

                {detailView === "bigExpenses" && (
                  <div className={styles.dataTable}>
                    {bigExpenses.length ? (
                      bigExpenses.map((expense) => (
                        <div className={styles.tableRow} key={expense.id}>
                          <span>{expense.dateKey || formatDate(expense.date || expense.createdAt)}</span>
                          <strong>{expense.productName || expense.category || expense.supplierName || "Expense"}</strong>
                          <b>{formatCurrency(getAmount(expense, ["amount", "cost", "total"]))}</b>
                        </div>
                      ))
                    ) : (
                      <EmptyState>No big expenses found.</EmptyState>
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
