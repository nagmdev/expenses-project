import { initializeApp, getApps, getApp, deleteApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  onSnapshot,
  query,
  limit,
  type Firestore,
  type DocumentData,
  type Unsubscribe,
  type CollectionReference,
} from 'firebase/firestore';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

export const FIREBASE_STORAGE_KEY = 'expenses_firebase_config';

/**
 * Retrieve Firebase credentials from localStorage first, then fallback to Vite environment variables.
 */
export function getFirebaseConfig(): FirebaseConfig | null {
  // 1. Check localStorage first
  try {
    const saved = localStorage.getItem(FIREBASE_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.apiKey && parsed.projectId) {
        return {
          apiKey: parsed.apiKey || '',
          authDomain: parsed.authDomain || '',
          projectId: parsed.projectId || '',
          storageBucket: parsed.storageBucket || '',
          messagingSenderId: parsed.messagingSenderId || '',
          appId: parsed.appId || '',
          measurementId: parsed.measurementId || '',
        };
      }
    }
  } catch (err) {
    console.warn('[Firebase] Failed to parse localStorage config:', err);
  }

  // 2. Check Vite environment variables (Vercel / .env)
  const envApiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const envProjectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;

  if (envApiKey && envProjectId) {
    return {
      apiKey: envApiKey,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
      projectId: envProjectId,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
      appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
      measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || '',
    };
  }

  return null;
}

/**
 * Save Firebase configuration to localStorage or delete it if null
 */
export function saveFirebaseConfig(config: FirebaseConfig | null): void {
  try {
    if (config) {
      localStorage.setItem(FIREBASE_STORAGE_KEY, JSON.stringify(config));
    } else {
      localStorage.removeItem(FIREBASE_STORAGE_KEY);
    }
  } catch (err) {
    console.error('[Firebase] Failed to save config to localStorage:', err);
  }
}

/**
 * Check if Firebase configuration is present and valid
 */
export function isFirebaseConfigured(): boolean {
  const config = getFirebaseConfig();
  return Boolean(config && config.apiKey && config.projectId);
}

// Singleton instances
let appInstance: FirebaseApp | null = null;
let dbInstance: Firestore | null = null;
let currentConfigString = '';

/**
 * Initialize or retrieve Firebase and Firestore instances
 */
export function initFirebase(): { app: FirebaseApp | null; db: Firestore | null } {
  const config = getFirebaseConfig();
  if (!config || !config.apiKey || !config.projectId) {
    appInstance = null;
    dbInstance = null;
    currentConfigString = '';
    return { app: null, db: null };
  }

  const newConfigString = JSON.stringify(config);
  if (appInstance && dbInstance && currentConfigString === newConfigString) {
    return { app: appInstance, db: dbInstance };
  }

  try {
    const existingApps = getApps();
    if (existingApps.length > 0) {
      appInstance = existingApps[0];
    } else {
      appInstance = initializeApp(config as FirebaseOptions);
    }
    dbInstance = getFirestore(appInstance);
    currentConfigString = newConfigString;
    return { app: appInstance, db: dbInstance };
  } catch (err) {
    console.error('[Firebase] Failed to initialize Firebase app:', err);
    return { app: null, db: null };
  }
}

/**
 * Reset Firebase app instance (e.g. when credentials are updated or cleared)
 */
export async function resetFirebaseApp(): Promise<void> {
  const existingApps = getApps();
  for (const a of existingApps) {
    try {
      await deleteApp(a);
    } catch {}
  }
  appInstance = null;
  dbInstance = null;
  currentConfigString = '';
}

// Initial bootstrap
const { app, db } = initFirebase();
export { app, db };

/**
 * Get Firestore database instance safely
 */
export function getDb(): Firestore | null {
  if (!dbInstance) {
    const res = initFirebase();
    return res.db;
  }
  return dbInstance;
}

// Firestore Collection Helpers
export function getOrganizationsCollection(): CollectionReference<DocumentData> | null {
  const database = getDb();
  return database ? collection(database, 'organizations') : null;
}

export function getMembersCollection(): CollectionReference<DocumentData> | null {
  const database = getDb();
  return database ? collection(database, 'members') : null;
}

export function getServicesCollection(): CollectionReference<DocumentData> | null {
  const database = getDb();
  return database ? collection(database, 'services') : null;
}

export function getProvidersCollection(): CollectionReference<DocumentData> | null {
  const database = getDb();
  return database ? collection(database, 'providers') : null;
}

export function getRequestsCollection(): CollectionReference<DocumentData> | null {
  const database = getDb();
  return database ? collection(database, 'requests') : null;
}

export const collections = {
  organizations: getOrganizationsCollection,
  members: getMembersCollection,
  services: getServicesCollection,
  providers: getProvidersCollection,
  requests: getRequestsCollection,
};

// =========================================================================
// CRUD Helpers
// =========================================================================

/**
 * Fetch all documents from a Firestore collection
 */
export async function fetchCollectionDocs<T = DocumentData>(collectionName: string): Promise<T[]> {
  const database = getDb();
  if (!database) return [];

  const colRef = collection(database, collectionName);
  const snap = await getDocs(colRef);
  return snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  })) as T[];
}

/**
 * Subscribe to real-time changes on a collection
 */
export function subscribeToCollection<T = DocumentData>(
  collectionName: string,
  onUpdate: (items: T[]) => void,
  onError?: (err: Error) => void
): Unsubscribe | null {
  const database = getDb();
  if (!database) return null;

  try {
    const colRef = collection(database, collectionName);
    return onSnapshot(
      colRef,
      (snapshot) => {
        const items = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as T[];
        onUpdate(items);
      },
      (error) => {
        console.error(`[Firebase] Error in listener for ${collectionName}:`, error);
        if (onError) onError(error);
      }
    );
  } catch (err) {
    console.error(`[Firebase] Failed to subscribe to ${collectionName}:`, err);
    return null;
  }
}

/**
 * Set a document with a specific ID (create or full merge)
 */
export async function setFirestoreDoc<T extends Record<string, any>>(
  collectionName: string,
  docId: string,
  data: T
): Promise<void> {
  const database = getDb();
  if (!database) throw new Error('Firestore not initialized');

  const docRef = doc(database, collectionName, docId);
  await setDoc(docRef, data, { merge: true });
}

/**
 * Add a new document with an auto-generated Firestore ID
 */
export async function addFirestoreDoc<T extends Record<string, any>>(
  collectionName: string,
  data: T
): Promise<string> {
  const database = getDb();
  if (!database) throw new Error('Firestore not initialized');

  const colRef = collection(database, collectionName);
  const docRef = await addDoc(colRef, data);
  return docRef.id;
}

/**
 * Update an existing document fields
 */
export async function updateFirestoreDoc(
  collectionName: string,
  docId: string,
  data: Record<string, any>
): Promise<void> {
  const database = getDb();
  if (!database) throw new Error('Firestore not initialized');

  const docRef = doc(database, collectionName, docId);
  await updateDoc(docRef, data);
}

/**
 * Delete a document from a collection
 */
export async function deleteFirestoreDoc(
  collectionName: string,
  docId: string
): Promise<void> {
  const database = getDb();
  if (!database) throw new Error('Firestore not initialized');

  const docRef = doc(database, collectionName, docId);
  await deleteDoc(docRef);
}

/**
 * Test the Firestore connection using the provided configuration or the stored one.
 */
export async function testFirebaseConnection(
  customConfig?: FirebaseConfig
): Promise<{ success: boolean; message: string }> {
  try {
    const configToTest = customConfig || getFirebaseConfig();
    if (!configToTest || !configToTest.apiKey || !configToTest.projectId) {
      return {
        success: false,
        message: 'بيانات الاعتماد غير مكتملة. يرجى توفير API Key و Project ID كحد أدنى.',
      };
    }

    // Use a unique app name to avoid collision during test
    const testAppName = `test-app-${Date.now()}`;
    const testApp = initializeApp(configToTest as FirebaseOptions, testAppName);
    const testDb = getFirestore(testApp);

    // Attempt a light query (limit 1) on organizations collection
    const colRef = collection(testDb, 'organizations');
    const q = query(colRef, limit(1));
    await getDocs(q);

    // Clean up test app
    await deleteApp(testApp);

    return {
      success: true,
      message: 'تم الاتصال بقاعدة بيانات Cloud Firestore بنجاح وبسرعة فائقة!',
    };
  } catch (err: any) {
    console.error('[Firebase] Connection test failed:', err);
    let msg = err?.message || 'فشل الاتصال بقاعدة البيانات.';
    if (msg.includes('permission-denied') || msg.includes('PERMISSION_DENIED')) {
      msg = 'تم الاتصال بالمشروع ولكن تم رفض الصلاحية. يرجى تفعيل قواعد الأمان Firestore Rules للسماح بالقراءة والكتابة (Test Mode).';
    } else if (msg.includes('api-key-not-valid') || msg.includes('API_KEY_INVALID')) {
      msg = 'مفتاح API Key غير صالح. يرجى التحقق من نقله بدقة من لوحة تحكم Firebase.';
    } else if (msg.includes('project-not-found') || msg.includes('PROJECT_NOT_FOUND')) {
      msg = 'المشروع غير موجود. يرجى التأكد من Project ID.';
    }
    return {
      success: false,
      message: msg,
    };
  }
}

// Re-export common firestore primitives
export {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  type Firestore,
  type DocumentData,
  type Unsubscribe,
};

