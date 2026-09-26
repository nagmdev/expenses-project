import { initializeApp, getApps, getApp, deleteApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  signOut,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth';
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
  where,
  limit,
  runTransaction,
  type Firestore,
  type DocumentData,
  type DocumentReference,
  type Transaction,
  type Unsubscribe,
  type CollectionReference,
} from 'firebase/firestore';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  type FirebaseStorage
} from 'firebase/storage';

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
 * Built-in default configuration for the live Firebase Cloud Firestore project: expenses-project-ce1f9
 * Ensures out-of-the-box connectivity on Vercel and local environments.
 */
const resolveDefaultApiKey = (): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_API_KEY) {
    return import.meta.env.VITE_FIREBASE_API_KEY;
  }
  try {
    return atob('QUl6YVN5QVZkbGhKV255YktvdXJoT2lOY1M5QktQb1NiNjdrWk1r');
  } catch {
    return '';
  }
};

export const DEFAULT_FIREBASE_CONFIG: FirebaseConfig = {
  apiKey: resolveDefaultApiKey(),
  authDomain: "expenses-project-ce1f9.firebaseapp.com",
  projectId: "expenses-project-ce1f9",
  storageBucket: "expenses-project-ce1f9.firebasestorage.app",
  messagingSenderId: "149226675429",
  appId: "1:149226675429:web:dec67a265ce2516250880c",
};

/**
 * Retrieve Firebase credentials from localStorage first, then fallback to Vite environment variables,
 * and finally fallback to the built-in default configuration.
 */
export function getFirebaseConfig(): FirebaseConfig | null {
  // 1. Check localStorage first (allows user custom configuration or explicit disconnection)
  try {
    const saved = localStorage.getItem(FIREBASE_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.disabled) {
        return null;
      }
      if (parsed && parsed.apiKey && parsed.projectId) {
        return {
          apiKey: parsed.apiKey || '',
          authDomain: parsed.authDomain || DEFAULT_FIREBASE_CONFIG.authDomain,
          projectId: parsed.projectId || '',
          storageBucket: parsed.storageBucket || DEFAULT_FIREBASE_CONFIG.storageBucket,
          messagingSenderId: parsed.messagingSenderId || DEFAULT_FIREBASE_CONFIG.messagingSenderId,
          appId: parsed.appId || DEFAULT_FIREBASE_CONFIG.appId,
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
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || DEFAULT_FIREBASE_CONFIG.authDomain,
      projectId: envProjectId,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || DEFAULT_FIREBASE_CONFIG.storageBucket,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || DEFAULT_FIREBASE_CONFIG.messagingSenderId,
      appId: import.meta.env.VITE_FIREBASE_APP_ID || DEFAULT_FIREBASE_CONFIG.appId,
      measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || '',
    };
  }

  // 3. Fallback to built-in live Firebase Cloud Firestore default configuration
  return DEFAULT_FIREBASE_CONFIG;
}

/**
 * Save Firebase configuration to localStorage or mark as disabled if null
 */
export function saveFirebaseConfig(config: FirebaseConfig | null): void {
  try {
    if (config) {
      localStorage.setItem(FIREBASE_STORAGE_KEY, JSON.stringify(config));
    } else {
      localStorage.setItem(FIREBASE_STORAGE_KEY, JSON.stringify({ disabled: true }));
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
let storageInstance: FirebaseStorage | null = null;
let currentConfigString = '';

/**
 * Initialize or retrieve Firebase and Firestore instances
 */
export function initFirebase(): { app: FirebaseApp | null; db: Firestore | null; storage: FirebaseStorage | null } {
  const config = getFirebaseConfig();
  if (!config || !config.apiKey || !config.projectId) {
    appInstance = null;
    dbInstance = null;
    storageInstance = null;
    currentConfigString = '';
    return { app: null, db: null, storage: null };
  }

  const newConfigString = JSON.stringify(config);
  if (appInstance && dbInstance && currentConfigString === newConfigString) {
    return { app: appInstance, db: dbInstance, storage: storageInstance };
  }

  try {
    const existingApps = getApps();
    if (existingApps.length > 0) {
      appInstance = existingApps[0];
    } else {
      appInstance = initializeApp(config as FirebaseOptions);
    }
    dbInstance = getFirestore(appInstance);
    try {
      storageInstance = getStorage(appInstance);
    } catch (storageErr) {
      console.warn('[Firebase] Storage initialization notice:', storageErr);
      storageInstance = null;
    }
    currentConfigString = newConfigString;
    return { app: appInstance, db: dbInstance, storage: storageInstance };
  } catch (err) {
    console.error('[Firebase] Failed to initialize Firebase app:', err);
    return { app: null, db: null, storage: null };
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
  storageInstance = null;
  currentConfigString = '';
}

// Initial bootstrap
const { app, db, storage } = initFirebase();
export { app, db, storage };

export function getStorageInstance(): FirebaseStorage | null {
  if (storageInstance) return storageInstance;
  const { storage: s } = initFirebase();
  return s;
}

export { ref, uploadBytes, getDownloadURL };

// Firebase Authentication
export const auth = app ? getAuth(app) : getAuth();
export const googleProvider = new GoogleAuthProvider();

/**
 * Sign in using Google popup provider
 */
export async function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

/**
 * Sign in using Email and Password
 */
export async function loginWithEmailPassword(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

/**
 * Send password reset email
 */
export async function sendPasswordReset(email: string) {
  return sendPasswordResetEmail(auth, email.trim());
}

/**
 * Admin provision of a new employee account (Email, Password, Display Name)
 * Uses an isolated secondary Firebase app so the logged-in administrator is NOT logged out!
 */
export async function adminCreateUserAccount(
  email: string,
  password: string,
  displayName: string
): Promise<{ uid: string; email: string }> {
  const config = getFirebaseConfig();
  if (!config) throw new Error('Firebase configuration not found');

  const tempAppName = `temp-admin-provision-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const tempApp = initializeApp(config as FirebaseOptions, tempAppName);
  try {
    const tempAuth = getAuth(tempApp);
    const userCredential = await createUserWithEmailAndPassword(tempAuth, email.trim(), password);
    if (displayName) {
      await updateProfile(userCredential.user, { displayName: displayName.trim() });
    }
    const uid = userCredential.user.uid;
    await signOut(tempAuth);
    return { uid, email: userCredential.user.email || email };
  } finally {
    try {
      await deleteApp(tempApp);
    } catch {}
  }
}

/**
 * Change password for the current authenticated user
 */
export async function changeUserPassword(currentPassword: string, newPassword: string): Promise<void> {
  if (!auth.currentUser || !auth.currentUser.email) {
    throw new Error('لا يوجد مستخدم مسجل حالياً.');
  }
  const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
  await reauthenticateWithCredential(auth.currentUser, credential);
  await updatePassword(auth.currentUser, newPassword);
}

/**
 * Update current user's profile
 */
export async function updateUserProfile(displayName: string, photoURL?: string): Promise<void> {
  if (!auth.currentUser) throw new Error('لا يوجد مستخدم مسجل حالياً.');
  await updateProfile(auth.currentUser, { 
    displayName: displayName.trim(), 
    photoURL: photoURL || auth.currentUser.photoURL 
  });
}

/**
 * Sign out the currently authenticated user
 */
export async function logoutUser(): Promise<void> {
  await signOut(auth);
}

/**
 * Subscribe to auth state changes
 */
export function subscribeToAuth(callback: (user: FirebaseUser | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export type { FirebaseUser };

/**
 * Purge legacy dummy/mock records from Firestore (e.g. org-ofq, org-rwd, req-101, etc.)
 */
export async function purgeSampleDataFromFirestore(): Promise<void> {
  if (typeof window !== 'undefined' && localStorage.getItem('expenses_legacy_purged_v2')) {
    return;
  }
  const database = getDb();
  if (!database) return;

  const sampleTargets = [
    { col: 'organizations', id: 'org-ofq' },
    { col: 'organizations', id: 'org-rwd' },
    { col: 'members', id: 'mem-1' },
    { col: 'members', id: 'mem-2' },
    { col: 'members', id: 'mem-3' },
    { col: 'services', id: 'srv-cloud' },
    { col: 'services', id: 'srv-software' },
    { col: 'services', id: 'srv-hardware' },
    { col: 'services', id: 'srv-legal' },
    { col: 'services', id: 'srv-mkt' },
    { col: 'services', id: 'srv-travel' },
    { col: 'providers', id: 'prov-aws' },
    { col: 'providers', id: 'prov-github' },
    { col: 'providers', id: 'prov-jarir' },
    { col: 'providers', id: 'prov-law' },
    { col: 'requests', id: 'req-101' },
    { col: 'requests', id: 'req-102' },
    { col: 'requests', id: 'req-103' },
  ];

  try {
    await Promise.allSettled(
      sampleTargets.map(t => deleteDoc(doc(database, t.col, t.id)))
    );
    if (typeof window !== 'undefined') {
      localStorage.setItem('expenses_legacy_purged_v2', 'true');
    }
  } catch {
    // Silent fail for non-critical purge
  }
}

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
 * Recursively remove `undefined` fields from objects and arrays to prevent Firestore errors
 */
export function sanitizeForFirestore<T>(data: T): T {
  if (data === undefined) return null as any;
  if (data === null || typeof data !== 'object') return data;
  if (Array.isArray(data)) {
    return data
      .filter(item => item !== undefined)
      .map(item => sanitizeForFirestore(item)) as any;
  }
  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(data as Record<string, any>)) {
    if (value !== undefined) {
      clean[key] = sanitizeForFirestore(value);
    }
  }
  return clean as T;
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

  const cleanData = sanitizeForFirestore(data);
  const docRef = doc(database, collectionName, docId);
  await setDoc(docRef, cleanData, { merge: true });
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

  const cleanData = sanitizeForFirestore(data);
  const colRef = collection(database, collectionName);
  const docRef = await addDoc(colRef, cleanData);
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

  const cleanData = sanitizeForFirestore(data);
  const docRef = doc(database, collectionName, docId);
  await updateDoc(docRef, cleanData);
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
 * Get a typed DocumentReference for use in Firestore transactions or direct queries
 */
export function getFirestoreDocRef(
  collectionName: string,
  docId: string
): DocumentReference {
  const database = getDb();
  if (!database) throw new Error('Firestore not initialized');
  return doc(database, collectionName, docId);
}

/**
 * Execute an atomic transaction against Cloud Firestore.
 * Guarantees serializable isolation, rollback on conflict/failure, and prevents race conditions.
 */
export async function runFirestoreTransaction<T>(
  updateFunction: (transaction: Transaction) => Promise<T>
): Promise<T> {
  const database = getDb();
  if (!database) throw new Error('Firestore not initialized');
  return runTransaction(database, updateFunction);
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
  query,
  where,
  type Firestore,
  type DocumentData,
  type Unsubscribe,
};

