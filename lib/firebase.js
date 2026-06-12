import { getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseApps = new Map(getApps().map((app) => [app.name, app]));

function appConfig(prefix) {
  return {
    apiKey: process.env[`NEXT_PUBLIC_${prefix}_API_KEY`],
    authDomain: process.env[`NEXT_PUBLIC_${prefix}_AUTH_DOMAIN`],
    projectId: process.env[`NEXT_PUBLIC_${prefix}_PROJECT_ID`],
    storageBucket: process.env[`NEXT_PUBLIC_${prefix}_STORAGE_BUCKET`],
    messagingSenderId: process.env[`NEXT_PUBLIC_${prefix}_MESSAGING_SENDER_ID`],
    appId: process.env[`NEXT_PUBLIC_${prefix}_APP_ID`],
  };
}

function getNamedApp(name, prefix) {
  if (firebaseApps.has(name)) return firebaseApps.get(name);
  const app = initializeApp(appConfig(prefix), name);
  firebaseApps.set(name, app);
  return app;
}

export const duitbizApp = getNamedApp("duitbiz", "DUITBIZ");
export const duitstockApp = getNamedApp("duitstock", "DUITSTOCK");
export const supplierApp = getNamedApp("supplierDebt", "SUPPLIER");

export const duitbizDb = getFirestore(duitbizApp);
export const duitstockDb = getFirestore(duitstockApp);
export const supplierDb = getFirestore(supplierApp);
