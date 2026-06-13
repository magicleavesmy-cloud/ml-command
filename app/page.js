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
const NAV_ITEMS = ["Dashboard", "Duitbiz", "DuitStock", "Supplier Debt", "Settings", "Help", "Logout"];

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

function formatDate(value) {
  const date = normalizeDate(value);
  return date ? date.toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "No date";
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

function EmptyState({ children }) {
  return <div className={styles.empty}>{children}</div>;
}

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [activeView, setActiveView] = useState("Dashboard");
  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [range, setRange] = useState("week");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [errors, setErrors] = useState([]);
  const salesChartRef = useRef(null);
  const expenseChartRef = useRef(null);

  useEffect(() => {
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

    console.log("[Dashboard] fetched document counts", {
      closings: next.closings.length,
      expenses: next.expenses.length,
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

  useChart(salesChartRef, salesChartConfig, activeView);
  useChart(expenseChartRef, expenseChartConfig, activeView);

  if (!mounted) return null;

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
              onClick={() => setActiveView(item)}
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
          <>
            <section className={styles.summaryGrid}>
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
                label="Sales Value"
                value={formatCurrency(metrics.salesValue)}
                detail="Inventory at selling price"
                loading={loading}
              />
              <StatCard
                label="Supplier Debt"
                value={formatCurrency(metrics.supplierDebt)}
                detail={`${metrics.supplierDebts.length} suppliers owed`}
                loading={loading}
              />
            </section>

            <section className={styles.dashboardGrid}>
              <section className={`${styles.panel} ${styles.chartPanel}`}>
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

              <aside className={styles.sideStack}>
                <section className={styles.miniCard}>
                  <p>Stock Overview</p>
                  <strong>{formatNumber(dashboard.products.length)}</strong>
                  <span>{formatCurrency(metrics.salesValue)} sales value</span>
                </section>

                <section className={styles.miniCard}>
                  <p>Low Stock Alerts</p>
                  <strong>{lowStock.length}</strong>
                  <span>Products below {LOW_STOCK_LIMIT} units</span>
                </section>

                <section className={styles.miniCard}>
                  <p>Supplier Debt Summary</p>
                  <strong>{formatCurrency(metrics.supplierDebt)}</strong>
                  <span>{metrics.supplierDebts.length} suppliers owed</span>
                </section>
              </aside>

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
                    lowStock.slice(0, 8).map((product) => (
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
              </section>

              <section className={`${styles.panel} ${styles.listPanel}`}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Operations</p>
                    <h2>Recent Movements</h2>
                  </div>
                  <span>{dashboard.movements.length} records</span>
                </div>
                <div className={styles.dataTable}>
                  {loading ? (
                    Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
                  ) : recentMovements.length ? (
                    recentMovements.slice(0, 6).map((movement) => (
                      <div className={styles.tableRow} key={movement.id}>
                        <span>{formatDate(movement.date || movement.createdAt)}</span>
                        <strong>{productMovementName(movement)}</strong>
                        <b>{String(movement.type || "n/a")} / {formatNumber(movement.quantity)}</b>
                      </div>
                    ))
                  ) : (
                    <EmptyState>No recent stock movements found.</EmptyState>
                  )}
                </div>
              </section>

              <section className={`${styles.panel} ${styles.quickActions}`}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Workspace</p>
                    <h2>Quick Actions</h2>
                  </div>
                </div>
                <div className={styles.actionGrid}>
                  {["Refresh Data", "Open Duitbiz", "Open Stock", "Open Debt"].map((action) => (
                    <button
                      key={action}
                      onClick={() => {
                        if (action === "Refresh Data") loadDashboard({ quiet: true });
                        if (action === "Open Duitbiz") setActiveView("Duitbiz");
                        if (action === "Open Stock") setActiveView("DuitStock");
                        if (action === "Open Debt") setActiveView("Supplier Debt");
                      }}
                      type="button"
                    >
                      <span>＋</span>
                      {action}
                    </button>
                  ))}
                </div>
              </section>
            </section>
          </>
        )}

        {activeView === "Duitbiz" && (
          <section className={styles.viewStack}>
            <section className={styles.summaryGrid}>
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
                label="Closings"
                value={formatNumber(dashboard.closings.length)}
                detail="Recent closing records"
                loading={loading}
              />
              <StatCard
                label="Expenses"
                value={formatNumber(dashboard.expenses.length)}
                detail="Duitbiz expense records"
                loading={loading}
              />
            </section>

            <section className={styles.dashboardGrid}>
              <section className={`${styles.panel} ${styles.chartPanel}`}>
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

              <section className={`${styles.panel} ${styles.listPanel}`}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Duitbiz</p>
                    <h2>Closings</h2>
                  </div>
                  <span>{dashboard.closings.length} records</span>
                </div>
                <div className={styles.dataTable}>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
                  ) : dashboard.closings.length ? (
                    dashboard.closings.slice(0, 10).map((closing) => (
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

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.eyebrow}>Duitbiz</p>
                  <h2>Expenses</h2>
                </div>
                <span>{dashboard.expenses.length} records</span>
              </div>
              <div className={styles.dataTable}>
                {loading ? (
                  Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className={styles.rowSkeleton} />)
                ) : dashboard.expenses.length ? (
                  dashboard.expenses.slice(0, 12).map((expense) => (
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
      </section>
    </main>
  );
}
