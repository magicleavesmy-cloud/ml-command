import { getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseApps = new Map(getApps().map((app) => [app.name, app]));

const firebaseConfigs = {
  DUITBIZ: {
    apiKey: process.env.NEXT_PUBLIC_DUITBIZ_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_DUITBIZ_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_DUITBIZ_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_DUITBIZ_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_DUITBIZ_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_DUITBIZ_APP_ID,
  },
  DUITSTOCK: {
    apiKey: process.env.NEXT_PUBLIC_DUITSTOCK_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_DUITSTOCK_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_DUITSTOCK_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_DUITSTOCK_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_DUITSTOCK_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_DUITSTOCK_APP_ID,
  },
  SUPPLIER: {
    apiKey: process.env.NEXT_PUBLIC_SUPPLIER_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_SUPPLIER_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_SUPPLIER_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_SUPPLIER_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_SUPPLIER_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_SUPPLIER_APP_ID,
  },
};

const configEnvNames = {
  DUITBIZ: {
    apiKey: "NEXT_PUBLIC_DUITBIZ_API_KEY",
    authDomain: "NEXT_PUBLIC_DUITBIZ_AUTH_DOMAIN",
    projectId: "NEXT_PUBLIC_DUITBIZ_PROJECT_ID",
    storageBucket: "NEXT_PUBLIC_DUITBIZ_STORAGE_BUCKET",
    messagingSenderId: "NEXT_PUBLIC_DUITBIZ_MESSAGING_SENDER_ID",
    appId: "NEXT_PUBLIC_DUITBIZ_APP_ID",
  },
  DUITSTOCK: {
    apiKey: "NEXT_PUBLIC_DUITSTOCK_API_KEY",
    authDomain: "NEXT_PUBLIC_DUITSTOCK_AUTH_DOMAIN",
    projectId: "NEXT_PUBLIC_DUITSTOCK_PROJECT_ID",
    storageBucket: "NEXT_PUBLIC_DUITSTOCK_STORAGE_BUCKET",
    messagingSenderId: "NEXT_PUBLIC_DUITSTOCK_MESSAGING_SENDER_ID",
    appId: "NEXT_PUBLIC_DUITSTOCK_APP_ID",
  },
  SUPPLIER: {
    apiKey: "NEXT_PUBLIC_SUPPLIER_API_KEY",
    authDomain: "NEXT_PUBLIC_SUPPLIER_AUTH_DOMAIN",
    projectId: "NEXT_PUBLIC_SUPPLIER_PROJECT_ID",
    storageBucket: "NEXT_PUBLIC_SUPPLIER_STORAGE_BUCKET",
    messagingSenderId: "NEXT_PUBLIC_SUPPLIER_MESSAGING_SENDER_ID",
    appId: "NEXT_PUBLIC_SUPPLIER_APP_ID",
  },
};

function missingEnvKeys(prefix) {
  const config = firebaseConfigs[prefix];
  const envNames = configEnvNames[prefix];
  const requiredFields = [
    ["apiKey", envNames.apiKey],
    ["authDomain", envNames.authDomain],
    ["projectId", envNames.projectId],
    ["storageBucket", envNames.storageBucket],
    ["messagingSenderId", envNames.messagingSenderId],
    ["appId", envNames.appId],
  ];

  return requiredFields
    .filter(([field]) => !config[field])
    .map(([, envName]) => envName);
}

function getNamedApp(name, prefix) {
  if (firebaseApps.has(name)) return firebaseApps.get(name);
  const missingKeys = missingEnvKeys(prefix);
  if (missingKeys.length > 0) {
    console.error(
      `[Firebase] ${name} is missing env vars: ${missingKeys
        .join(", ")}`
    );
  }
  const app = initializeApp(firebaseConfigs[prefix], name);
  firebaseApps.set(name, app);
  return app;
}

export const duitbizApp = getNamedApp("duitbiz", "DUITBIZ");
export const duitstockApp = getNamedApp("duitstock", "DUITSTOCK");
export const supplierApp = getNamedApp("supplierDebt", "SUPPLIER");

export const duitbizDb = getFirestore(duitbizApp);
export const duitstockDb = getFirestore(duitstockApp);
export const supplierDb = getFirestore(supplierApp);

export const firebaseDebugInfo = [
  { label: "Duitbiz", app: duitbizApp },
  { label: "DuitStock", app: duitstockApp },
  { label: "Supplier Debt", app: supplierApp },
].map(({ label, app }) => ({
  label,
  appName: app.name,
  projectId: app.options.projectId || "<missing>",
}));
