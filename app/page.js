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

const emptyDashboard = {
  closings: [],
  expenses: [],
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

function getAmount(record, keys = ["amount", "balance", "outstanding", "total", "value"]) {
  for (const key of keys) {
    const value = Number(record?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
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

  try {
    const snapshot = await getDocs(query(collection(db, name), ...constraints));
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    if (!options.fallbackWithoutOrder) throw error;
    const snapshot = await getDocs(collection(db, name));
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }
}

function useChart(canvasRef, config) {
  useEffect(() => {
    if (!canvasRef.current || !config) return undefined;
    const chart = new Chart(canvasRef.current, config);
    return () => chart.destroy();
  }, [canvasRef, config]);
}

function Skeleton({ className = "" }) {
  return <div className={`${styles.skeleton} ${className}`} />;
}

function StatCard({ label, value, detail, loading }) {
  return (
    <section className={styles.statCard}>
      <p>{label}</p>
      {loading ? <Skeleton className={styles.statSkeleton} /> : <strong>{value}</strong>}
      <span>{detail}</span>
    </section>
  );
}

function EmptyState({ children }) {
  return <div className={styles.empty}>{children}</div>;
}

export default function Home() {
  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [range, setRange] = useState("week");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [errors, setErrors] = useState([]);
  const salesChartRef = useRef(null);
  const expenseChartRef = useRef(null);

  const loadDashboard = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setErrors([]);

    const results = await Promise.allSettled([
      Promise.all([
        readCollection(duitbizDb, "duitbiz_closings", {
          orderBy: ["dateKey", "desc"],
          limit: 45,
          fallbackWithoutOrder: true,
        }),
        readCollection(duitbizDb, "duitbiz_expenses", {
          orderBy: ["date", "desc"],
          limit: 100,
          fallbackWithoutOrder: true,
        }),
      ]),
      Promise.all([
        readCollection(duitstockDb, "products"),
        readCollection(duitstockDb, "movements", {
          orderBy: ["date", "desc"],
          limit: 80,
          fallbackWithoutOrder: true,
        }),
      ]),
      Promise.all([
        readCollection(supplierDb, "suppliers"),
        readCollection(supplierDb, "supplierTransactions", {
          orderBy: ["date", "desc"],
          limit: 200,
          fallbackWithoutOrder: true,
        }),
      ]),
    ]);

    const next = { ...emptyDashboard };
    const nextErrors = [];

    if (results[0].status === "fulfilled") {
      [next.closings, next.expenses] = results[0].value;
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

    // DEBUG - remove after fixing field names
    console.log("=== ML COMMAND DEBUG ===");
    console.log("CLOSINGS count:", next.closings.length, "| sample:", JSON.stringify(next.closings[0] || {}));
    console.log("EXPENSES count:", next.expenses.length, "| sample:", JSON.stringify(next.expenses[0] || {}));
    console.log("PRODUCTS count:", next.products.length, "| sample:", JSON.stringify(next.products[0] || {}));
    console.log("MOVEMENTS count:", next.movements.length, "| sample:", JSON.stringify(next.movements[0] || {}));
    console.log("SUPPLIERS count:", next.suppliers.length, "| sample:", JSON.stringify(next.suppliers[0] || {}));
    console.log("TRANSACTIONS count:", next.supplierTransactions.length, "| sample:", JSON.stringify(next.supplierTransactions[0] || {}));
    console.log("ERRORS:", nextErrors);
    console.log("=== END DEBUG ===");

    setDashboard(next);
    setErrors(nextErrors);
    setLastUpdated(new Date());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadDashboard();
    const refresh = setInterval(() => loadDashboard({ quiet: true }), AUTO_REFRESH_MS);
    return () => clearInterval(refresh);
  }, [loadDashboard]);

  const metrics = useMemo(() => {
    const todayKey = toDateKey(new Date());
    const todayClosing =
      dashboard.closings.find((closing) => closing.dateKey === todayKey) ||
      dashboard.closings.find((closing) => normalizeDate(closing.date)?.toLocaleDateString("en-CA") === todayKey);
    const daySales = Number(todayClosing?.daySales) || 0;
    const cashExpenses = Number(todayClosing?.cashExpenses) || 0;
    const stockValue = dashboard.products.reduce(
      (total, product) => total + (Number(product.quantity) || 0) * (Number(product.costPrice) || 0),
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
      supplierDebt: supplierDebts.reduce((total, supplier) => total + supplier.amount, 0),
      supplierDebts,
    };
  }, [dashboard]);

  const salesRows = useMemo(() => {
    const days = range === "today" ? 1 : range === "month" ? 30 : 7;
    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    since.setHours(0, 0, 0, 0);

    return dashboard.closings
      .map((closing) => ({
        dateKey: closing.dateKey || toDateKey(normalizeDate(closing.date) || new Date()),
        sales: Number(closing.daySales) || 0,
      }))
      .filter((closing) => new Date(closing.dateKey) >= since)
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  }, [dashboard.closings, range]);

  const lowStock = useMemo(
    () =>
      dashboard.products
        .filter((product) => (Number(product.quantity) || 0) < LOW_STOCK_LIMIT)
        .sort((a, b) => (Number(a.quantity) || 0) - (Number(b.quantity) || 0)),
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

  const salesChartConfig = useMemo(
    () => ({
      type: "line",
      data: {
        labels: salesRows.map((row) => row.dateKey.slice(5)),
        datasets: [
          {
            label: "Sales",
            data: salesRows.map((row) => row.sales),
            borderColor: "#00d4b8",
            backgroundColor: "rgba(0, 212, 184, 0.16)",
            borderWidth: 3,
            pointBackgroundColor: "#f5fff9",
            pointBorderColor: "#00d4b8",
            pointRadius: 4,
            fill: true,
            tension: 0.35,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => formatCurrency(context.parsed.y),
            },
          },
        },
        scales: {
          x: {
            grid: { color: "rgba(255,255,255,0.06)" },
            ticks: { color: "#9fb2c8" },
          },
          y: {
            grid: { color: "rgba(255,255,255,0.06)" },
            ticks: {
              color: "#9fb2c8",
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

  useChart(salesChartRef, salesChartConfig);
  useChart(expenseChartRef, expenseChartConfig);

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <div className={styles.brand}>
            <span className={styles.logo}>🍃</span>
            <h1>Magic Leaves</h1>
          </div>
          <p>Command Center</p>
        </div>

        <div className={styles.topbarActions}>
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

      <section className={styles.statsGrid}>
        <StatCard
          label="Today's Sales"
          value={formatCurrency(metrics.daySales)}
          detail="Duitbiz closing"
          loading={loading}
        />
        <StatCard
          label="Today's Profit"
          value={formatCurrency(metrics.todayProfit)}
          detail="Sales minus cash expenses"
          loading={loading}
        />
        <StatCard
          label="Stock Value"
          value={formatCurrency(metrics.stockValue)}
          detail={`${dashboard.products.length} products`}
          loading={loading}
        />
        <StatCard
          label="Supplier Debt"
          value={formatCurrency(metrics.supplierDebt)}
          detail={`${metrics.supplierDebts.length} suppliers owed`}
          loading={loading}
        />
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Duitbiz</p>
            <h2>Sales Chart</h2>
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

      <section className={styles.twoColumn}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>⚠️ Low Stock</h2>
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
                  <b className={(Number(product.quantity) || 0) < 5 ? styles.dangerBadge : styles.badge}>
                    {formatNumber(product.quantity)}
                  </b>
                </div>
              ))
            ) : (
              <EmptyState>No products below 10 units.</EmptyState>
            )}
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>💰 You Owe</h2>
            <span>{formatCurrency(metrics.supplierDebt)}</span>
          </div>
          <div className={styles.list}>
            {loading ? (
              Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
            ) : metrics.supplierDebts.length ? (
              metrics.supplierDebts.slice(0, 8).map((supplier) => (
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
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>DuitStock</p>
            <h2>Recent Activity</h2>
          </div>
          <span>Last 10 movements</span>
        </div>
        <div className={styles.activityTable}>
          {loading ? (
            Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
          ) : recentMovements.length ? (
            recentMovements.map((movement) => {
              const type = String(movement.type || "").toLowerCase();
              const date = normalizeDate(movement.date);
              return (
                <div className={styles.activityRow} key={movement.id}>
                  <strong>{productMovementName(movement)}</strong>
                  <span className={type === "in" ? styles.inType : styles.outType}>{type || "n/a"}</span>
                  <span>{formatNumber(movement.quantity)}</span>
                  <time>
                    {date
                      ? date.toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })
                      : "No date"}
                  </time>
                </div>
              );
            })
          ) : (
            <EmptyState>No recent stock movements found.</EmptyState>
          )}
        </div>
      </section>

      <section className={styles.twoColumn}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>Top Selling Products</h2>
            <span>By stock out</span>
          </div>
          <div className={styles.rankList}>
            {loading ? (
              Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
            ) : topProducts.length ? (
              topProducts.map((product, index) => (
                <div className={styles.rankRow} key={product.name}>
                  <span>{index + 1}</span>
                  <strong>{product.name}</strong>
                  <b>{formatNumber(product.quantity)}</b>
                </div>
              ))
            ) : (
              <EmptyState>No outgoing product movements found.</EmptyState>
            )}
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>Expense Breakdown</h2>
            <span>Duitbiz categories</span>
          </div>
          <div className={styles.smallChartBox}>
            {loading ? <Skeleton className={styles.chartSkeleton} /> : <canvas ref={expenseChartRef} />}
          </div>
        </div>
      </section>
    </main>
  );
}