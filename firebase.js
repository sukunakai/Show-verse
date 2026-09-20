// firebase.js - Shared Firebase Client Module for Show Verse
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
  initializeFirestore, 
  getFirestore, 
  setLogLevel,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCH-LYBYGMDRjkcu4RObtih_afuqzIsGGg",
  authDomain: "show-verse-901fe.firebaseapp.com",
  projectId: "show-verse-901fe",
  storageBucket: "show-verse-901fe.firebasestorage.app",
  messagingSenderId: "774807739924",
  appId: "1:774807739924:web:ef9f40adc12cfe557ad101"
};

let appInstance = null;
let authInstance = null;
let dbInstance = null;

try {
  appInstance = initializeApp(firebaseConfig);
  authInstance = getAuth(appInstance);

  // Suppress verbose benign network retry warnings in the console
  try {
    setLogLevel('error');
  } catch (_) {}

  // Initialize Firestore with long-polling and multi-tab persistent cache
  // This circumvents proxy/firewall streaming drops that cause 'Could not reach Cloud Firestore backend' [code=unavailable]
  try {
    dbInstance = initializeFirestore(appInstance, {
      experimentalForceLongPolling: true,
      experimentalAutoDetectLongPolling: true,
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
      })
    });
  } catch (cacheErr) {
    try {
      dbInstance = initializeFirestore(appInstance, {
        experimentalForceLongPolling: true,
        experimentalAutoDetectLongPolling: true
      });
    } catch (pollErr) {
      dbInstance = getFirestore(appInstance);
    }
  }
} catch (e) {
  console.warn("Firebase initialization warning:", e ? (e.message || String(e)) : "init error");
}

export const app = appInstance;
export const auth = authInstance;
export const db = dbInstance;

if (typeof window !== "undefined") {
  window.showverseFirebase = { app, auth, db };
  window.db = db;
  window.auth = auth;
}

