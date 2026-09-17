import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Organization, 
  User, 
  OrganizationMember, 
  ServiceCategory, 
  ServiceProvider, 
  ExpenseRequest, 
  DisbursementDetails,
  RequestAttachment,
  Role,
  PaymentMethod
} from '../types';
import {
  isFirebaseConfigured,
  initFirebase,
  getDb,
  setFirestoreDoc,
  updateFirestoreDoc,
  deleteFirestoreDoc,
  collection,
  onSnapshot,
  changeUserPassword,
  updateUserProfile,
  signInWithGoogle,
  loginWithEmailPassword,
  sendPasswordReset,
  adminCreateUserAccount,
  logoutUser,
  subscribeToAuth,
  purgeSampleDataFromFirestore,
  type FirebaseUser,
} from '../lib/firebase';

export { 
  signInWithGoogle, 
  logoutUser, 
  loginWithEmailPassword, 
  sendPasswordReset, 
  adminCreateUserAccount 
} from '../lib/firebase';

export const SUPER_ADMINS_STORAGE_KEY = 'expenses_super_admins_v3';

const STORAGE_KEYS = {
  ORGS: 'expenses_organizations_v3',
  MEMBERS: 'expenses_members_v3',
  SERVICES: 'expenses_services_v3',
  PROVIDERS: 'expenses_providers_v3',
  REQUESTS: 'expenses_requests_v3',
  ACTIVE_ORG: 'expenses_active_org_id_v3',
  ROLE: 'expenses_current_role_v3',
  ACTIVE_TAB: 'expenses_active_tab_v3',
};

// Immediate purge of all legacy v1 and v2 localStorage keys
try {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && (k.startsWith('expenses_') || k.includes('ofq')) && !k.endsWith('_v3')) {
      keysToRemove.push(k);
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
} catch {}

const DUMMY_IDS = new Set([
  'org-ofq', 'org-rwd', 'mem-1', 'mem-2', 'mem-3',
  'srv-cloud', 'srv-software', 'srv-hardware', 'srv-legal', 'srv-mkt', 'srv-travel',
  'prov-aws', 'prov-github', 'prov-jarir', 'prov-law',
  'req-101', 'req-102', 'req-103'
]);

const safeGetLocal = <T,>(key: string, fallback: T): T => {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return fallback;
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      const cleaned = parsed.filter((item: any) => {
        if (!item || typeof item !== 'object') return false;
        if (DUMMY_IDS.has(item.id) || DUMMY_IDS.has(item.orgId)) return false;
        if (item.name && typeof item.name === 'string' && item.name.includes('أفق التقنية')) return false;
        return true;
      });
      if (cleaned.length !== parsed.length) {
        localStorage.setItem(key, JSON.stringify(cleaned));
      }
      return cleaned as unknown as T;
    }
    return parsed as T;
  } catch (err) {
    console.warn(`[ExpenseSystem] Error parsing ${key} from localStorage:`, err);
    return fallback;
  }
};

const safeSetLocal = <T,>(key: string, value: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`[ExpenseSystem] Error writing ${key} to localStorage:`, err);
  }
};

const safeFetchJson = async <T = any>(url: string, options?: RequestInit): Promise<T | null> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return null;
    }
    return (await res.json()) as T;
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
};

interface AppContextType {
  // Scoped Data (Strict isolation based on role & org)
  organizations: Organization[];
  allOrganizations: Organization[]; // For super admin management
  activeOrgId: string;
  activeOrg?: Organization;
  users: User[];
  currentUser: User;
  firebaseUser: FirebaseUser | null;
  authLoading: boolean;
  currentRole: Role;
  members: OrganizationMember[];
  services: ServiceCategory[];
  providers: ServiceProvider[];
  requests: ExpenseRequest[];
  activeTab: string;
  loading: boolean;
  isBackendConnected: boolean;
  isFirebaseConnected: boolean;
  isFirebaseModalOpen: boolean;
  firebaseError: string | null;
  clearFirebaseError: () => void;
  
  // Controls
  setActiveOrgId: (id: string) => void;
  setCurrentRole: (role: Role) => void;
  setActiveTab: (tab: string) => void;
  openFirebaseModal: () => void;
  closeFirebaseModal: () => void;
  
  // Auth & Roles
  superAdminEmails: string[];
  addSuperAdminEmail: (email: string) => Promise<void>;
  signInWithGoogle: () => Promise<any>;
  loginWithEmail: (email: string, password: string) => Promise<any>;
  resetPassword: (email: string) => Promise<any>;
  logoutUser: () => Promise<void>;
  updateUserProfileInfo: (displayName: string, phone?: string) => Promise<{ success: boolean; error?: string }>;
  changeCurrentUserPassword: (currentPass: string, newPass: string) => Promise<{ success: boolean; error?: string }>;
  
  // Admin User Provisioning
  createCompanyUser: (data: {
    name: string;
    email?: string;
    password?: string;
    phone?: string;
    role: Role;
    department?: string;
    jobTitle?: string;
    orgId?: string;
  }) => Promise<{ success: boolean; message?: string; credentials?: { email: string; password: string } }>;

  // Organizations
  addOrganization: (org: Omit<Organization, 'id' | 'createdAt'>) => Promise<void>;
  updateOrganization: (orgId: string, updates: Partial<Organization>) => Promise<void>;
  deleteOrganization: (orgId: string) => Promise<{ success: boolean; message?: string }>;
  
  // Members & User Management
  addMember: (member: Omit<OrganizationMember, 'id' | 'joinedAt'>) => Promise<void>;
  updateMember: (memberId: string, updates: Partial<OrganizationMember>) => Promise<void>;
  toggleMemberStatus: (memberId: string, active: boolean) => Promise<void>;
  removeMember: (memberId: string) => Promise<void>;
  adminResetUserPassword: (email: string) => Promise<{ success: boolean; message?: string }>;
  
  // Services
  addService: (service: Omit<ServiceCategory, 'id' | 'spentAmount'>) => Promise<void>;
  updateService: (service: ServiceCategory) => Promise<void>;
  deleteService: (serviceId: string) => Promise<void>;
  
  // Providers
  addProvider: (provider: Omit<ServiceProvider, 'id' | 'totalPaid'>) => Promise<void>;
  updateProvider: (provider: ServiceProvider) => Promise<void>;
  deleteProvider: (providerId: string) => Promise<void>;
  
  // Expense Requests & Workflow
  createRequest: (data: {
    title: string;
    description: string;
    justification: string;
    amount: number;
    currency: string;
    serviceCategoryId: string;
    providerId: string;
    urgency: 'low' | 'medium' | 'high';
    attachmentNames?: string[];
    preferredPaymentMethod?: PaymentMethod;
    paymentAccountDetails?: string;
    orgId?: string;
  }) => Promise<void>;
  
  approveRequest: (requestId: string, note?: string) => Promise<void>;
  rejectRequest: (requestId: string, reason: string) => Promise<void>;
  requestClarification: (requestId: string, question: string) => Promise<void>;
  replyClarification: (requestId: string, replyText: string, attachmentName?: string) => Promise<void>;
  disburseRequest: (requestId: string, details: Omit<DisbursementDetails, 'disbursedAt' | 'disbursedBy'>) => Promise<void>;
  
  refreshData: () => Promise<void>;
  resetToSampleData: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Raw internal states populated by real-time Firestore listeners
  const [rawOrganizations, setRawOrganizations] = useState<Organization[]>(() => {
    return safeGetLocal<Organization[]>(STORAGE_KEYS.ORGS, []);
  });

  const [activeOrgId, setActiveOrgIdState] = useState<string>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_ORG);
    if (saved === 'org-ofq' || saved === 'org-rwd') {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_ORG);
      return '';
    }
    return saved || '';
  });

  const [activeTab, setActiveTabState] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_TAB) || 'dashboard';
  });

  const [rawMembers, setRawMembers] = useState<OrganizationMember[]>(() => {
    return safeGetLocal<OrganizationMember[]>(STORAGE_KEYS.MEMBERS, []);
  });

  const [rawServices, setRawServices] = useState<ServiceCategory[]>(() => {
    return safeGetLocal<ServiceCategory[]>(STORAGE_KEYS.SERVICES, []);
  });

  const [rawProviders, setRawProviders] = useState<ServiceProvider[]>(() => {
    return safeGetLocal<ServiceProvider[]>(STORAGE_KEYS.PROVIDERS, []);
  });

  const [rawRequests, setRawRequests] = useState<ExpenseRequest[]>(() => {
    return safeGetLocal<ExpenseRequest[]>(STORAGE_KEYS.REQUESTS, []);
  });

  const [loading, setLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);

  const [isBackendConnected, setIsBackendConnected] = useState(false);
  const [isFirebaseConnected, setIsFirebaseConnected] = useState(false);
  const [isFirebaseModalOpen, setIsFirebaseModalOpen] = useState(false);
  const [firebaseError, setFirebaseError] = useState<string | null>(null);
  const [firebaseSyncCounter, setFirebaseSyncCounter] = useState(0);

  const clearFirebaseError = () => setFirebaseError(null);
  const openFirebaseModal = () => setIsFirebaseModalOpen(true);
  const closeFirebaseModal = () => {
    setIsFirebaseModalOpen(false);
    setFirebaseSyncCounter(prev => prev + 1);
  };

  const setActiveOrgId = (id: string) => {
    setActiveOrgIdState(id);
    try {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_ORG, id);
    } catch {}
  };

  const setActiveTab = (tab: string) => {
    setActiveTabState(tab);
    try {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_TAB, tab);
    } catch {}
  };

  // Subscribe to Firebase Authentication state
  useEffect(() => {
    const unsubscribe = subscribeToAuth((user) => {
      setFirebaseUser(user);
      setAuthLoading(false);
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Super admin emails list (loaded from default, env, local storage, and Firestore 'super_admins' collection)
  const [superAdminEmails, setSuperAdminEmails] = useState<string[]>(() => {
    const defaultAdmins = ['marwanagib813@gmail.com', 'mahmoud@tieapps.com'];
    const envAdmins = import.meta.env.VITE_SUPER_ADMIN_EMAILS || '';
    const envList = envAdmins.split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean);
    const localAdmins = safeGetLocal<string[]>(SUPER_ADMINS_STORAGE_KEY, []);
    return Array.from(new Set([...defaultAdmins, ...envList, ...localAdmins]));
  });

  // =========================================================================
  // RBAC & ROLE RESOLUTION
  // =========================================================================
  const userEmail = firebaseUser?.email?.toLowerCase().trim() || '';

  // Find membership in organizations
  const userMemberRecord = useMemo(() => {
    if (!firebaseUser) return null;
    const uid = firebaseUser.uid;
    const email = userEmail.toLowerCase().trim();
    return rawMembers.find(m => 
      (Boolean(uid) && m.userId === uid) || 
      (Boolean(email) && m.userEmail?.toLowerCase().trim() === email)
    ) || null;
  }, [firebaseUser, userEmail, rawMembers]);

  const isSuperAdmin = useMemo(() => {
    if (!userEmail) return false;
    if (userEmail === 'marwanagib813@gmail.com' || userEmail === 'mahmoud@tieapps.com') return true;
    if (superAdminEmails.some(e => e.trim().toLowerCase() === userEmail)) return true;
    if (userMemberRecord?.role === 'super_admin') return true;
    return false;
  }, [userEmail, superAdminEmails, userMemberRecord]);

  // Determine active role
  const resolvedRole: Role = useMemo(() => {
    if (isSuperAdmin) return 'super_admin';
    if (userMemberRecord) return userMemberRecord.role;
    return 'employee';
  }, [isSuperAdmin, userMemberRecord]);

  // Determine effective organization ID
  const effectiveOrgId = useMemo(() => {
    if (isSuperAdmin) {
      return activeOrgId || (rawOrganizations[0]?.id || '');
    }
    if (userMemberRecord?.orgId) {
      return userMemberRecord.orgId;
    }
    // Strict isolation: if not super admin and not assigned to an organization, DO NOT fallback to another company!
    return '';
  }, [isSuperAdmin, activeOrgId, userMemberRecord, rawOrganizations]);

  // Keep activeOrgId in sync with effectiveOrgId and prevent empty string deadlock
  useEffect(() => {
    if (!isSuperAdmin && effectiveOrgId && effectiveOrgId !== activeOrgId) {
      setActiveOrgIdState(effectiveOrgId);
      try {
        localStorage.setItem(STORAGE_KEYS.ACTIVE_ORG, effectiveOrgId);
      } catch {}
    } else if (isSuperAdmin && !activeOrgId && rawOrganizations.length > 0) {
      setActiveOrgIdState(rawOrganizations[0].id);
      try {
        localStorage.setItem(STORAGE_KEYS.ACTIVE_ORG, rawOrganizations[0].id);
      } catch {}
    }
  }, [isSuperAdmin, effectiveOrgId, activeOrgId, rawOrganizations]);

  // Dynamic currentUser object
  const currentUser: User = useMemo(() => {
    if (!firebaseUser) {
      return {
        id: 'guest',
        name: 'زائر غير مسجل',
        email: '',
        role: 'employee',
      };
    }

    const defaultAdminName = userEmail === 'marwanagib813@gmail.com' ? 'مروه نجيب' : userEmail === 'mahmoud@tieapps.com' ? 'محمود' : userEmail.split('@')[0];

    return {
      id: firebaseUser.uid,
      name: userMemberRecord?.userName || firebaseUser.displayName || defaultAdminName || 'مستخدم',
      email: firebaseUser.email || '',
      role: resolvedRole,
      avatar: firebaseUser.photoURL || undefined,
      phone: userMemberRecord?.phone || firebaseUser.phoneNumber || '',
      orgId: effectiveOrgId,
    };
  }, [firebaseUser, userMemberRecord, userEmail, resolvedRole, effectiveOrgId]);

  // Adjust active tab on role switch (e.g. employee defaults to my-requests / tracker)
  useEffect(() => {
    if (!firebaseUser) return;
    if (resolvedRole === 'employee') {
      if (activeTab === 'dashboard' || activeTab === 'services' || activeTab === 'providers' || activeTab === 'organizations') {
        setActiveTab('my-requests');
      }
    } else if (resolvedRole === 'data_entry') {
      if (activeTab === 'dashboard' || activeTab === 'requests') {
        setActiveTab('providers');
      }
    }
  }, [resolvedRole, firebaseUser, activeTab]);

  // =========================================================================
  // ZERO DATA LEAKAGE: Strict Tenant and Employee Scoping
  // =========================================================================
  const scopedOrganizations = useMemo(() => {
    if (!firebaseUser) return [];
    if (resolvedRole === 'super_admin') return rawOrganizations;
    if (!effectiveOrgId) return [];
    return rawOrganizations.filter(o => o.id === effectiveOrgId);
  }, [firebaseUser, resolvedRole, rawOrganizations, effectiveOrgId]);

  const activeOrg = useMemo(() => {
    return rawOrganizations.find(o => o.id === effectiveOrgId);
  }, [rawOrganizations, effectiveOrgId]);

  const scopedMembers = useMemo(() => {
    if (!firebaseUser) return [];
    if (resolvedRole === 'super_admin') {
      return effectiveOrgId === 'all' ? rawMembers : rawMembers.filter(m => m.orgId === effectiveOrgId);
    }
    if (!effectiveOrgId) return [];
    if (resolvedRole === 'org_admin') {
      return rawMembers.filter(m => m.orgId === effectiveOrgId);
    }
    // Role is employee: strictly sees their own membership profile
    return rawMembers.filter(m => 
      m.orgId === effectiveOrgId && 
      (m.userId === firebaseUser.uid || (Boolean(m.userEmail && userEmail) && m.userEmail.toLowerCase().trim() === userEmail))
    );
  }, [firebaseUser, resolvedRole, rawMembers, effectiveOrgId, userEmail]);

  const scopedServices = useMemo(() => {
    if (!firebaseUser) return [];
    if (resolvedRole === 'super_admin') {
      return effectiveOrgId === 'all' ? rawServices : rawServices.filter(s => s.orgId === effectiveOrgId);
    }
    if (!effectiveOrgId) return [];
    return rawServices.filter(s => s.orgId === effectiveOrgId);
  }, [firebaseUser, resolvedRole, rawServices, effectiveOrgId]);

  const scopedProviders = useMemo(() => {
    if (!firebaseUser) return [];
    if (resolvedRole === 'super_admin') {
      return effectiveOrgId === 'all' ? rawProviders : rawProviders.filter(p => p.orgId === effectiveOrgId);
    }
    if (!effectiveOrgId) return [];
    return rawProviders.filter(p => p.orgId === effectiveOrgId);
  }, [firebaseUser, resolvedRole, rawProviders, effectiveOrgId]);

  // STRICT REQUEST SCOPING:
  // - super_admin: sees all requests (or filtered by activeOrgId if specific org chosen)
  // - org_admin: strictly sees requests for their company only
  // - employee: strictly sees their OWN requests only! Absolutely zero leakage of other employees' requests!
  const scopedRequests = useMemo(() => {
    if (!firebaseUser) return [];

    const myUid = firebaseUser.uid;
    const myEmail = userEmail.toLowerCase().trim();

    if (resolvedRole === 'super_admin') {
      if (effectiveOrgId && effectiveOrgId !== 'all') {
        return rawRequests.filter(r => r.orgId === effectiveOrgId || !r.orgId);
      }
      return rawRequests;
    }

    if (resolvedRole === 'org_admin') {
      // Company Admin sees all requests inside their specific company only
      return rawRequests.filter(r => r.orgId === effectiveOrgId);
    }

    // Role is employee (or non-admin): strictly sees their own submitted requests only! Zero data leakage!
    return rawRequests.filter(r => {
      const isMyRequest = 
        r.requesterId === myUid || 
        r.requesterId === currentUser.id || 
        (Boolean(r.requesterEmail && myEmail) && r.requesterEmail!.toLowerCase().trim() === myEmail);
      return isMyRequest && (!effectiveOrgId || r.orgId === effectiveOrgId);
    });
  }, [firebaseUser, resolvedRole, rawRequests, effectiveOrgId, userEmail, currentUser]);

  const users: User[] = useMemo(() => {
    if (!firebaseUser) return [];
    const list: User[] = [currentUser];
    scopedMembers.forEach(m => {
      if (m.userId !== currentUser.id) {
        list.push({
          id: m.userId,
          name: m.userName,
          email: m.userEmail,
          role: m.role,
          phone: m.phone,
          orgId: m.orgId,
        });
      }
    });
    return list;
  }, [firebaseUser, currentUser, scopedMembers]);

  // =========================================================================
  // Real-Time Firebase Listeners
  // =========================================================================
  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setIsFirebaseConnected(false);
      return;
    }

    const { db } = initFirebase();
    if (!db) {
      setIsFirebaseConnected(false);
      return;
    }

    // Await authentication before attaching listeners to avoid security rule permission-denied
    if (!firebaseUser) {
      return;
    }

    setIsFirebaseConnected(true);
    setFirebaseError(null);
    purgeSampleDataFromFirestore().catch(() => {});

    // 1. Organizations Listener
    const unsubOrgs = onSnapshot(collection(db, 'organizations'), (snapshot) => {
      setIsFirebaseConnected(true);
      setFirebaseError(null);
      const list = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as Organization))
        .filter(o => !DUMMY_IDS.has(o.id));
      
      setRawOrganizations(list);
      safeSetLocal(STORAGE_KEYS.ORGS, list);
    }, (err: any) => {
      console.warn('[Firebase] Organizations onSnapshot error:', err);
      setIsFirebaseConnected(false);
      if (err?.code === 'permission-denied') {
        setFirebaseError('قواعد أمان Firebase تمنع الوصول (Permission Denied). يرجى ضبط القواعد في Firebase Console.');
      } else {
        setFirebaseError(err?.message || 'تعذر الاتصال بقاعدة بيانات Firebase');
      }
    });

    // 2. Members Listener
    const unsubMembers = onSnapshot(collection(db, 'members'), (snapshot) => {
      const list = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as OrganizationMember))
        .filter(m => !DUMMY_IDS.has(m.id) && !DUMMY_IDS.has(m.orgId));
      setRawMembers(list);
      safeSetLocal(STORAGE_KEYS.MEMBERS, list);
    }, (err) => {
      console.warn('[Firebase] Members onSnapshot error:', err);
    });

    // 3. Services Listener
    const unsubServices = onSnapshot(collection(db, 'services'), (snapshot) => {
      const list = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as ServiceCategory))
        .filter(s => !DUMMY_IDS.has(s.id) && !DUMMY_IDS.has(s.orgId));
      setRawServices(list);
      safeSetLocal(STORAGE_KEYS.SERVICES, list);
    }, (err) => {
      console.warn('[Firebase] Services onSnapshot error:', err);
    });

    // 4. Providers Listener
    const unsubProviders = onSnapshot(collection(db, 'providers'), (snapshot) => {
      const list = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as ServiceProvider))
        .filter(p => !DUMMY_IDS.has(p.id) && !DUMMY_IDS.has(p.orgId));
      setRawProviders(list);
      safeSetLocal(STORAGE_KEYS.PROVIDERS, list);
    }, (err) => {
      console.warn('[Firebase] Providers onSnapshot error:', err);
    });

    // 5. Requests Listener
    const unsubRequests = onSnapshot(collection(db, 'requests'), (snapshot) => {
      const list = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as ExpenseRequest))
        .filter(r => !DUMMY_IDS.has(r.id) && !DUMMY_IDS.has(r.orgId));
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setRawRequests(list);
      safeSetLocal(STORAGE_KEYS.REQUESTS, list);
    }, (err) => {
      console.warn('[Firebase] Requests onSnapshot error:', err);
    });

    // 6. Super Admins Listener
    const unsubSuperAdmins = onSnapshot(collection(db, 'super_admins'), (snapshot) => {
      const dbAdmins = snapshot.docs.map(d => (d.data().email || d.id || '').toLowerCase().trim()).filter(Boolean);
      if (dbAdmins.length > 0) {
        setSuperAdminEmails(prev => {
          const merged = Array.from(new Set([...prev, ...dbAdmins]));
          safeSetLocal(SUPER_ADMINS_STORAGE_KEY, merged);
          return merged;
        });
      }
    }, (err) => {
      console.warn('[Firebase] Super admins onSnapshot error:', err);
    });

    return () => {
      unsubOrgs();
      unsubMembers();
      unsubServices();
      unsubProviders();
      unsubRequests();
      unsubSuperAdmins();
    };
  }, [firebaseUser, firebaseSyncCounter]);

  // Refresh data: sync with local Express API if present and Firebase is not active
  const refreshData = useCallback(async () => {
    if (isFirebaseConfigured()) {
      setFirebaseSyncCounter(prev => prev + 1);
      return;
    }

    try {
      setLoading(true);
      const [orgsData, memsData, srvsData, provsData, reqsData] = await Promise.all([
        safeFetchJson<Organization[]>('/api/organizations'),
        safeFetchJson<OrganizationMember[]>('/api/members'),
        safeFetchJson<ServiceCategory[]>('/api/services'),
        safeFetchJson<ServiceProvider[]>('/api/providers'),
        safeFetchJson<ExpenseRequest[]>('/api/requests'),
      ]);

      if (orgsData && Array.isArray(orgsData)) {
        setIsBackendConnected(true);
        setRawOrganizations(orgsData);
        safeSetLocal(STORAGE_KEYS.ORGS, orgsData);

        if (memsData && Array.isArray(memsData)) {
          setRawMembers(memsData);
          safeSetLocal(STORAGE_KEYS.MEMBERS, memsData);
        }
        if (srvsData && Array.isArray(srvsData)) {
          setRawServices(srvsData);
          safeSetLocal(STORAGE_KEYS.SERVICES, srvsData);
        }
        if (provsData && Array.isArray(provsData)) {
          setRawProviders(provsData);
          safeSetLocal(STORAGE_KEYS.PROVIDERS, provsData);
        }
        if (reqsData && Array.isArray(reqsData)) {
          setRawRequests(reqsData);
          safeSetLocal(STORAGE_KEYS.REQUESTS, reqsData);
        }
      } else {
        setIsBackendConnected(false);
      }
    } catch (err) {
      console.warn('[ExpenseSystem] Fallback mode:', err);
      setIsBackendConnected(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Reset to empty
  const resetToSampleData = async () => {
    setRawOrganizations([]);
    setRawMembers([]);
    setRawServices([]);
    setRawProviders([]);
    setRawRequests([]);
    setActiveOrgId('');
    setActiveTab('dashboard');

    safeSetLocal(STORAGE_KEYS.ORGS, []);
    safeSetLocal(STORAGE_KEYS.MEMBERS, []);
    safeSetLocal(STORAGE_KEYS.SERVICES, []);
    safeSetLocal(STORAGE_KEYS.PROVIDERS, []);
    safeSetLocal(STORAGE_KEYS.REQUESTS, []);
    try {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_ORG);
      localStorage.setItem(STORAGE_KEYS.ACTIVE_TAB, 'dashboard');
    } catch {}

    await purgeSampleDataFromFirestore();
  };

  // =========================================================================
  // SUPER ADMIN MANAGEMENT
  // =========================================================================
  const addSuperAdminEmail = async (email: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return;

    if (isFirebaseConfigured() && getDb()) {
      try {
        const docId = cleanEmail.replace(/[^a-zA-Z0-9]/g, '_');
        await setFirestoreDoc('super_admins', docId, {
          email: cleanEmail,
          createdAt: new Date().toISOString(),
          active: true,
        });
      } catch (err) {
        console.error('[Firebase] Error saving super admin email:', err);
      }
    }

    setSuperAdminEmails(prev => {
      const updated = Array.from(new Set([...prev, cleanEmail]));
      safeSetLocal(SUPER_ADMINS_STORAGE_KEY, updated);
      return updated;
    });
  };

  // =========================================================================
  // USER PROVISIONING BY ORG ADMIN / SUPER ADMIN
  // =========================================================================
  const createCompanyUser = async (data: {
    name: string;
    email?: string;
    password?: string;
    phone?: string;
    role: Role;
    department?: string;
    jobTitle?: string;
    orgId?: string;
  }): Promise<{ success: boolean; message?: string; credentials?: { email: string; password: string } }> => {
    try {
      const targetOrgId = data.orgId || effectiveOrgId;
      if (!targetOrgId || targetOrgId === 'all') {
        return { success: false, message: 'يرجى تحديد المؤسسة أولاً لإضافة الموظف إليها.' };
      }

      const effectiveEmail = data.email?.trim().toLowerCase() || `emp_${Date.now().toString().slice(-6)}@company.local`;
      const effectivePassword = data.password?.trim() || '123456';

      let createdUid = `user-${Date.now()}`;
      if (isFirebaseConfigured()) {
        try {
          const res = await adminCreateUserAccount(effectiveEmail, effectivePassword, data.name);
          createdUid = res.uid;
        } catch (authErr: any) {
          console.error('[Admin Provision Auth Error]', authErr);
          if (authErr?.code === 'auth/email-already-in-use') {
            return { success: false, message: 'هذا البريد الإلكتروني مسجل مسبقاً في النظام.' };
          } else if (authErr?.code === 'auth/weak-password') {
            return { success: false, message: 'كلمة المرور يجب ألا تقل عن 6 خانات.' };
          } else {
            return { success: false, message: authErr?.message || 'تعذر إنشاء حساب المصادقة.' };
          }
        }
      }

      const defaultJobTitle = data.role === 'org_admin' 
        ? 'مدير المؤسسة' 
        : data.role === 'data_entry' 
        ? 'مدخل بيانات' 
        : 'موظف';

      const newMember: OrganizationMember = {
        id: `mem-${Date.now()}`,
        orgId: targetOrgId,
        userId: createdUid,
        userName: data.name.trim(),
        userEmail: effectiveEmail,
        phone: data.phone?.trim() || '',
        role: data.role,
        department: data.department?.trim() || (data.role === 'data_entry' ? 'إدخال البيانات والتسجيل' : 'العمليات والتوريد'),
        jobTitle: data.jobTitle?.trim() || defaultJobTitle,
        joinedAt: new Date().toISOString().split('T')[0],
        active: true,
      };

      if (isFirebaseConfigured() && getDb()) {
        await setFirestoreDoc('members', newMember.id, newMember);
      }

      setRawMembers(prev => {
        const updated = [newMember, ...prev.filter(m => m.userEmail !== newMember.userEmail)];
        safeSetLocal(STORAGE_KEYS.MEMBERS, updated);
        return updated;
      });

      return { 
        success: true, 
        message: 'تم إنشاء وتفعيل حساب الموظف بنجاح!',
        credentials: {
          email: effectiveEmail,
          password: effectivePassword
        }
      };
    } catch (err: any) {
      console.error('[Create Company User Error]', err);
      return { success: false, message: err?.message || 'حدث خطأ أثناء إنشاء الحساب.' };
    }
  };

  // =========================================================================
  // MUTATIONS
  // =========================================================================

  // 1. ORGANIZATIONS
  const addOrganization = async (orgData: Omit<Organization, 'id' | 'createdAt'>) => {
    const id = `org-${Date.now()}`;
    const createdAt = new Date().toISOString();
    const newOrg: Organization = {
      id,
      ...orgData,
      code: orgData.code?.trim().toUpperCase() || orgData.name.trim().slice(0, 3).toUpperCase() || 'ORG',
      createdAt,
    };

    if (isFirebaseConfigured() && getDb()) {
      try {
        await setFirestoreDoc('organizations', id, newOrg);
      } catch (err) {
        console.error('[Firebase] Error saving organization:', err);
      }
    }

    if (isBackendConnected) {
      await safeFetchJson<Organization>('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orgData),
      });
    }

    setRawOrganizations(prev => {
      const updated = [newOrg, ...prev];
      safeSetLocal(STORAGE_KEYS.ORGS, updated);
      return updated;
    });

    setActiveOrgId(id);
  };

  const updateOrganization = async (orgId: string, updates: Partial<Organization>) => {
    const org = rawOrganizations.find(o => o.id === orgId);
    if (!org) return;

    const updatedOrg: Organization = {
      ...org,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    if (isFirebaseConfigured() && getDb()) {
      try {
        await updateFirestoreDoc('organizations', orgId, updatedOrg);
      } catch (err) {
        console.error('[Firebase] Error updating organization:', err);
      }
    }

    if (isBackendConnected) {
      await safeFetchJson(`/api/organizations/${orgId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedOrg),
      });
    }

    setRawOrganizations(prev => {
      const updated = prev.map(o => o.id === orgId ? updatedOrg : o);
      safeSetLocal(STORAGE_KEYS.ORGS, updated);
      return updated;
    });
  };

  const deleteOrganization = async (orgId: string): Promise<{ success: boolean; message?: string }> => {
    if (isFirebaseConfigured() && getDb()) {
      try {
        await deleteFirestoreDoc('organizations', orgId);
      } catch (err: any) {
        console.error('[Firebase] Error deleting organization:', err);
        return { success: false, message: err?.message || 'تعذر حذف الشركة من قاعدة البيانات' };
      }
    }

    if (isBackendConnected) {
      await safeFetchJson(`/api/organizations/${orgId}`, { method: 'DELETE' });
    }

    setRawOrganizations(prev => {
      const updated = prev.filter(o => o.id !== orgId);
      safeSetLocal(STORAGE_KEYS.ORGS, updated);
      return updated;
    });

    if (activeOrgId === orgId) {
      const remaining = rawOrganizations.filter(o => o.id !== orgId);
      setActiveOrgId(remaining[0]?.id || '');
    }

    return { success: true, message: 'تم حذف الشركة بنجاح.' };
  };

  // 2. MEMBERS
  const addMember = async (memberData: Omit<OrganizationMember, 'id' | 'joinedAt'>) => {
    const newMember: OrganizationMember = {
      ...memberData,
      id: `mem-${Date.now()}`,
      joinedAt: new Date().toISOString().split('T')[0],
    };

    if (isFirebaseConfigured() && getDb()) {
      try {
        await setFirestoreDoc('members', newMember.id, newMember);
      } catch (err) {
        console.error('[Firebase] Error adding member:', err);
      }
    }

    if (isBackendConnected) {
      await safeFetchJson<OrganizationMember>('/api/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(memberData),
      });
    }

    setRawMembers(prev => {
      const updated = [newMember, ...prev];
      safeSetLocal(STORAGE_KEYS.MEMBERS, updated);
      return updated;
    });
  };

  const removeMember = async (memberId: string) => {
    if (isFirebaseConfigured() && getDb()) {
      try {
        await deleteFirestoreDoc('members', memberId);
      } catch (err) {
        console.error('[Firebase] Error removing member:', err);
      }
    }

    if (isBackendConnected) {
      await safeFetchJson(`/api/members/${memberId}`, { method: 'DELETE' });
    }

    setRawMembers(prev => {
      const updated = prev.filter(m => m.id !== memberId);
      safeSetLocal(STORAGE_KEYS.MEMBERS, updated);
      return updated;
    });
  };

  const updateMember = async (memberId: string, updates: Partial<OrganizationMember>) => {
    const mem = rawMembers.find(m => m.id === memberId);
    if (!mem) return;

    const updatedMember: OrganizationMember = {
      ...mem,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    if (isFirebaseConfigured() && getDb()) {
      try {
        await updateFirestoreDoc('members', memberId, updatedMember);
      } catch (err) {
        console.error('[Firebase] Error updating member:', err);
      }
    }

    if (isBackendConnected) {
      await safeFetchJson(`/api/members/${memberId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedMember),
      });
    }

    setRawMembers(prev => {
      const updated = prev.map(m => m.id === memberId ? updatedMember : m);
      safeSetLocal(STORAGE_KEYS.MEMBERS, updated);
      return updated;
    });
  };

  const toggleMemberStatus = async (memberId: string, active: boolean) => {
    await updateMember(memberId, { active });
  };

  const adminResetUserPassword = async (email: string): Promise<{ success: boolean; message?: string }> => {
    if (!email || !email.trim()) {
      return { success: false, message: 'البريد الإلكتروني غير متوفر.' };
    }
    try {
      await sendPasswordReset(email.trim().toLowerCase());
      return { 
        success: true, 
        message: `تم إرسال رابط استعادة وتعيين كلمة المرور بنجاح إلى: ${email}` 
      };
    } catch (err: any) {
      console.error('[Admin Reset Password Error]', err);
      return { 
        success: false, 
        message: err?.message || 'تعذر إرسال رابط استعادة كلمة المرور.' 
      };
    }
  };

  // 3. SERVICES
  const addService = async (serviceData: Omit<ServiceCategory, 'id' | 'spentAmount'>) => {
    const newService: ServiceCategory = {
      ...serviceData,
      id: `srv-${Date.now()}`,
      spentAmount: 0,
    };

    if (isFirebaseConfigured() && getDb()) {
      try {
        await setFirestoreDoc('services', newService.id, newService);
      } catch (err) {
        console.error('[Firebase] Error adding service:', err);
      }
    }

    if (isBackendConnected) {
      await safeFetchJson<ServiceCategory>('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serviceData),
      });
    }

    setRawServices(prev => {
      const updated = [...prev, newService];
      safeSetLocal(STORAGE_KEYS.SERVICES, updated);
      return updated;
    });
  };

  const updateService = async (updatedService: ServiceCategory) => {
    if (isFirebaseConfigured() && getDb()) {
      try {
        await setFirestoreDoc('services', updatedService.id, updatedService);
      } catch (err) {
        console.error('[Firebase] Error updating service:', err);
      }
    }

    if (isBackendConnected) {
      await safeFetchJson<ServiceCategory>(`/api/services/${updatedService.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedService),
      });
    }

    setRawServices(prev => {
      const updated = prev.map(s => s.id === updatedService.id ? updatedService : s);
      safeSetLocal(STORAGE_KEYS.SERVICES, updated);
      return updated;
    });
  };

  const deleteService = async (serviceId: string) => {
    if (isFirebaseConfigured() && getDb()) {
      try {
        await deleteFirestoreDoc('services', serviceId);
      } catch (err) {
        console.error('[Firebase] Error deleting service:', err);
      }
    }

    if (isBackendConnected) {
      await safeFetchJson(`/api/services/${serviceId}`, { method: 'DELETE' });
    }

    setRawServices(prev => {
      const updated = prev.filter(s => s.id !== serviceId);
      safeSetLocal(STORAGE_KEYS.SERVICES, updated);
      return updated;
    });
  };

  // 4. PROVIDERS
  const addProvider = async (providerData: Omit<ServiceProvider, 'id' | 'totalPaid'>) => {
    const newProvider: ServiceProvider = {
      ...providerData,
      id: `prov-${Date.now()}`,
      totalPaid: 0,
      active: true,
    };

    if (isFirebaseConfigured() && getDb()) {
      try {
        await setFirestoreDoc('providers', newProvider.id, newProvider);
      } catch (err) {
        console.error('[Firebase] Error adding provider:', err);
      }
    }

    if (isBackendConnected) {
      await safeFetchJson<ServiceProvider>('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(providerData),
      });
    }

    setRawProviders(prev => {
      const updated = [...prev, newProvider];
      safeSetLocal(STORAGE_KEYS.PROVIDERS, updated);
      return updated;
    });
  };

  const updateProvider = async (updatedProvider: ServiceProvider) => {
    if (isFirebaseConfigured() && getDb()) {
      try {
        await setFirestoreDoc('providers', updatedProvider.id, updatedProvider);
      } catch (err) {
        console.error('[Firebase] Error updating provider:', err);
      }
    }

    if (isBackendConnected) {
      await safeFetchJson<ServiceProvider>(`/api/providers/${updatedProvider.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedProvider),
      });
    }

    setRawProviders(prev => {
      const updated = prev.map(p => p.id === updatedProvider.id ? updatedProvider : p);
      safeSetLocal(STORAGE_KEYS.PROVIDERS, updated);
      return updated;
    });
  };

  const deleteProvider = async (providerId: string) => {
    if (isFirebaseConfigured() && getDb()) {
      try {
        await deleteFirestoreDoc('providers', providerId);
      } catch (err) {
        console.error('[Firebase] Error deleting provider:', err);
      }
    }

    if (isBackendConnected) {
      await safeFetchJson(`/api/providers/${providerId}`, { method: 'DELETE' });
    }

    setRawProviders(prev => {
      const updated = prev.filter(p => p.id !== providerId);
      safeSetLocal(STORAGE_KEYS.PROVIDERS, updated);
      return updated;
    });
  };

  // 5. EXPENSE REQUESTS
  const createRequest = async (data: {
    title: string;
    description: string;
    justification: string;
    amount: number;
    currency: string;
    serviceCategoryId: string;
    providerId: string;
    urgency: 'low' | 'medium' | 'high';
    attachmentNames?: string[];
    preferredPaymentMethod?: PaymentMethod;
    paymentAccountDetails?: string;
    orgId?: string;
  }) => {
    const service = rawServices.find(s => s.id === data.serviceCategoryId);
    const provider = rawProviders.find(p => p.id === data.providerId);
    
    // Resolve organization ID rigorously
    let targetOrgId = data.orgId || (effectiveOrgId && effectiveOrgId !== 'all' ? effectiveOrgId : '');
    if (!targetOrgId) {
      if (userMemberRecord?.orgId) {
        targetOrgId = userMemberRecord.orgId;
      } else if (rawOrganizations.length > 0) {
        targetOrgId = rawOrganizations[0].id;
      } else {
        // Auto-provision default organization so no order is ever orphaned
        const defaultOrgId = `org-${Date.now()}`;
        const defaultOrg: Organization = {
          id: defaultOrgId,
          name: 'المؤسسة الرئيسية',
          code: 'MAIN',
          currency: data.currency || 'SAR',
          budget: 500000,
          description: 'المؤسسة الرئيسية المعتمدة للنظام',
          createdAt: new Date().toISOString(),
        };
        targetOrgId = defaultOrgId;
        if (isFirebaseConfigured() && getDb()) {
          try {
            await setFirestoreDoc('organizations', defaultOrgId, defaultOrg);
          } catch (e) {
            console.error('[Firebase] Auto create default org error:', e);
          }
        }
        setRawOrganizations([defaultOrg]);
        safeSetLocal(STORAGE_KEYS.ORGS, [defaultOrg]);
      }
    }

    const now = new Date();
    const dateFormatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const attachments: RequestAttachment[] = (data.attachmentNames || []).map((name, i) => ({
      id: `att-${Date.now()}-${i}`,
      name,
      size: '1.2 MB',
      type: 'pdf',
      uploadedAt: dateFormatted,
    }));

    const newRequest: ExpenseRequest = {
      id: `req-${Date.now()}`,
      requestNumber: `REQ-${Math.floor(10000 + Math.random() * 90000)}`,
      orgId: targetOrgId,
      requesterId: currentUser.id,
      requesterName: currentUser.name,
      requesterEmail: currentUser.email || userEmail,
      requesterDepartment: currentUser.role === 'org_admin' ? 'الإدارة العامة' : (userMemberRecord?.department || 'العمليات والتوريد'),
      requesterPhone: currentUser.phone || userMemberRecord?.phone,
      preferredPaymentMethod: data.preferredPaymentMethod || 'instapay',
      paymentAccountDetails: data.paymentAccountDetails || '',
      serviceCategoryId: data.serviceCategoryId,
      serviceCategoryName: service?.name || 'خدمة عامة',
      providerId: data.providerId,
      providerName: provider?.name || 'مورد عام',
      title: data.title,
      description: data.description,
      justification: data.justification,
      amount: data.amount,
      currency: data.currency,
      status: 'pending',
      urgency: data.urgency,
      attachments,
      comments: [],
      timeline: [
        {
          id: `tl-${Date.now()}`,
          status: 'created',
          title: 'تم إنشاء وتقديم طلب الصرف',
          description: data.paymentAccountDetails 
            ? `طريقة التحويل المفضلة: ${data.preferredPaymentMethod || 'انستاباي'} (${data.paymentAccountDetails})`
            : 'تم إرسال الطلب للاعتماد المالي والإداري',
          actorName: currentUser.name,
          timestamp: dateFormatted,
        }
      ],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    if (isFirebaseConfigured() && getDb()) {
      try {
        await setFirestoreDoc('requests', newRequest.id, newRequest);
      } catch (err) {
        console.error('[Firebase] Error creating request:', err);
      }
    }

    if (isBackendConnected) {
      await safeFetchJson<ExpenseRequest>('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRequest),
      });
    }

    setRawRequests(prev => {
      const updated = [newRequest, ...prev];
      safeSetLocal(STORAGE_KEYS.REQUESTS, updated);
      return updated;
    });
  };

  const approveRequest = async (requestId: string, note?: string) => {
    const now = new Date();
    const dateFormatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    let targetUpdated: ExpenseRequest | null = null;

    setRawRequests(prev => {
      const list = prev.map(req => {
        if (req.id !== requestId) return req;
        const comments = [...req.comments];
        if (note) {
          comments.push({
            id: `cmt-${Date.now()}`,
            authorId: currentUser.id,
            authorName: currentUser.name,
            authorRole: 'مدير المؤسسة',
            content: note,
            type: 'internal_note' as const,
            createdAt: now.toISOString(),
          });
        }
        const timeline = [
          ...req.timeline,
          {
            id: `tl-${Date.now()}`,
            status: 'approved' as const,
            title: 'تمت الموافقة والاعتماد المالي',
            description: note ? `ملاحظات الاعتماد: ${note}` : 'تم اعتماد الطلب وتحويله للصرف المالي',
            actorName: currentUser.name,
            timestamp: dateFormatted,
          }
        ];
        const updated: ExpenseRequest = {
          ...req,
          status: 'approved' as const,
          comments,
          timeline,
          updatedAt: now.toISOString(),
        };
        targetUpdated = updated;
        return updated;
      });
      safeSetLocal(STORAGE_KEYS.REQUESTS, list);
      return list;
    });

    if (targetUpdated && isFirebaseConfigured() && getDb()) {
      try {
        await setFirestoreDoc('requests', requestId, targetUpdated);
      } catch (err) {
        console.error('[Firebase] Error approving request:', err);
      }
    }

    if (isBackendConnected) {
      await safeFetchJson<ExpenseRequest>(`/api/requests/${requestId}/approve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note, actorName: currentUser.name }),
      });
    }
  };

  const rejectRequest = async (requestId: string, reason: string) => {
    const now = new Date();
    const dateFormatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    let targetUpdated: ExpenseRequest | null = null;

    setRawRequests(prev => {
      const list = prev.map(req => {
        if (req.id !== requestId) return req;
        const comments = [
          ...req.comments,
          {
            id: `cmt-${Date.now()}`,
            authorId: currentUser.id,
            authorName: currentUser.name,
            authorRole: 'مدير المؤسسة',
            content: `سبب الرفض: ${reason}`,
            type: 'internal_note' as const,
            createdAt: now.toISOString(),
          }
        ];
        const timeline = [
          ...req.timeline,
          {
            id: `tl-${Date.now()}`,
            status: 'rejected' as const,
            title: 'تم رفض طلب الصرف',
            description: `السبب: ${reason}`,
            actorName: currentUser.name,
            timestamp: dateFormatted,
          }
        ];
        const updated: ExpenseRequest = {
          ...req,
          status: 'rejected' as const,
          rejectionReason: reason,
          comments,
          timeline,
          updatedAt: now.toISOString(),
        };
        targetUpdated = updated;
        return updated;
      });
      safeSetLocal(STORAGE_KEYS.REQUESTS, list);
      return list;
    });

    if (targetUpdated && isFirebaseConfigured() && getDb()) {
      try {
        await setFirestoreDoc('requests', requestId, targetUpdated);
      } catch (err) {
        console.error('[Firebase] Error rejecting request:', err);
      }
    }

    if (isBackendConnected) {
      await safeFetchJson<ExpenseRequest>(`/api/requests/${requestId}/reject`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, actorName: currentUser.name }),
      });
    }
  };

  const requestClarification = async (requestId: string, question: string) => {
    const now = new Date();
    const dateFormatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    let targetUpdated: ExpenseRequest | null = null;

    setRawRequests(prev => {
      const list = prev.map(req => {
        if (req.id !== requestId) return req;
        const comments = [
          ...req.comments,
          {
            id: `cmt-${Date.now()}`,
            authorId: currentUser.id,
            authorName: currentUser.name,
            authorRole: 'مدير المؤسسة',
            content: question,
            type: 'clarification_request' as const,
            createdAt: now.toISOString(),
          }
        ];
        const timeline = [
          ...req.timeline,
          {
            id: `tl-${Date.now()}`,
            status: 'clarification_requested' as const,
            title: 'طلب توضيحات ومستندات إضافية',
            description: question,
            actorName: currentUser.name,
            timestamp: dateFormatted,
          }
        ];
        const updated: ExpenseRequest = {
          ...req,
          status: 'clarification_requested' as const,
          comments,
          timeline,
          updatedAt: now.toISOString(),
        };
        targetUpdated = updated;
        return updated;
      });
      safeSetLocal(STORAGE_KEYS.REQUESTS, list);
      return list;
    });

    if (targetUpdated && isFirebaseConfigured() && getDb()) {
      try {
        await setFirestoreDoc('requests', requestId, targetUpdated);
      } catch (err) {
        console.error('[Firebase] Error requesting clarification:', err);
      }
    }

    if (isBackendConnected) {
      await safeFetchJson<ExpenseRequest>(`/api/requests/${requestId}/clarify`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, actorName: currentUser.name }),
      });
    }
  };

  const replyClarification = async (requestId: string, replyText: string, attachmentName?: string) => {
    const now = new Date();
    const dateFormatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    let targetUpdated: ExpenseRequest | null = null;

    setRawRequests(prev => {
      const list = prev.map(req => {
        if (req.id !== requestId) return req;
        const attachments = [...req.attachments];
        if (attachmentName) {
          attachments.push({
            id: `att-${Date.now()}`,
            name: attachmentName,
            size: '850 KB',
            type: 'pdf',
            uploadedAt: dateFormatted,
          });
        }
        const comments = [
          ...req.comments,
          {
            id: `cmt-${Date.now()}`,
            authorId: currentUser.id,
            authorName: currentUser.name,
            authorRole: 'طالب الصرف',
            content: replyText,
            type: 'clarification_reply' as const,
            createdAt: now.toISOString(),
            attachmentName,
          }
        ];
        const timeline = [
          ...req.timeline,
          {
            id: `tl-${Date.now()}`,
            status: 'pending' as const,
            title: 'قام طالب الصرف بتقديم التوضيح والمستندات',
            description: replyText,
            actorName: currentUser.name,
            timestamp: dateFormatted,
          }
        ];
        const updated: ExpenseRequest = {
          ...req,
          status: 'pending' as const,
          attachments,
          comments,
          timeline,
          updatedAt: now.toISOString(),
        };
        targetUpdated = updated;
        return updated;
      });
      safeSetLocal(STORAGE_KEYS.REQUESTS, list);
      return list;
    });

    if (targetUpdated && isFirebaseConfigured() && getDb()) {
      try {
        await setFirestoreDoc('requests', requestId, targetUpdated);
      } catch (err) {
        console.error('[Firebase] Error replying to clarification:', err);
      }
    }

    if (isBackendConnected) {
      await safeFetchJson<ExpenseRequest>(`/api/requests/${requestId}/reply`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replyText, attachmentName, actorName: currentUser.name }),
      });
    }
  };

  const disburseRequest = async (
    requestId: string, 
    details: Omit<DisbursementDetails, 'disbursedAt' | 'disbursedBy'>
  ) => {
    const now = new Date();
    const dateFormatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const methodLabel = 
      details.paymentMethod === 'instapay' ? 'انستاباي (InstaPay)' :
      details.paymentMethod === 'bank_transfer' ? 'تحويل بنكي' :
      details.paymentMethod === 'digital_wallet' ? 'محفظة إلكترونية' :
      details.paymentMethod === 'cash' ? 'نقداً / خزينة' : 'شيك مصرفي';

    let disbursedAmount = 0;
    let targetServiceId = '';
    let targetProviderId = '';
    let targetUpdated: ExpenseRequest | null = null;

    setRawRequests(prev => {
      const list = prev.map(req => {
        if (req.id !== requestId) return req;
        disbursedAmount = req.amount;
        targetServiceId = req.serviceCategoryId;
        targetProviderId = req.providerId;

        const disbursement: DisbursementDetails = {
          paymentMethod: details.paymentMethod,
          referenceNumber: details.referenceNumber,
          bankName: details.bankName || 'انستاباي / المصرف الرئيسي',
          receiptUrl: details.receiptUrl,
          notes: details.notes,
          disbursedAt: dateFormatted,
          disbursedBy: currentUser.name,
        };

        const timeline = [
          ...req.timeline,
          {
            id: `tl-${Date.now()}`,
            status: 'disbursed' as const,
            title: 'تم تحويل وصرف المبلغ بنجاح',
            description: `طريقة الصرف: ${methodLabel} | رقم العملية/المرجع: ${details.referenceNumber}`,
            actorName: currentUser.name,
            timestamp: dateFormatted,
          }
        ];

        const updated: ExpenseRequest = {
          ...req,
          status: 'disbursed' as const,
          disbursement,
          timeline,
          updatedAt: now.toISOString(),
        };
        targetUpdated = updated;
        return updated;
      });
      safeSetLocal(STORAGE_KEYS.REQUESTS, list);
      return list;
    });

    // Update spentAmount / totalPaid
    if (disbursedAmount > 0) {
      if (targetServiceId) {
        setRawServices(prev => {
          const updated = prev.map(s => {
            if (s.id !== targetServiceId) return s;
            const newSpent = s.spentAmount + disbursedAmount;
            const newObj = { ...s, spentAmount: newSpent };
            if (isFirebaseConfigured() && getDb()) {
              setFirestoreDoc('services', s.id, newObj).catch(console.error);
            }
            return newObj;
          });
          safeSetLocal(STORAGE_KEYS.SERVICES, updated);
          return updated;
        });
      }
      if (targetProviderId) {
        setRawProviders(prev => {
          const updated = prev.map(p => {
            if (p.id !== targetProviderId) return p;
            const newPaid = p.totalPaid + disbursedAmount;
            const newObj = { ...p, totalPaid: newPaid };
            if (isFirebaseConfigured() && getDb()) {
              setFirestoreDoc('providers', p.id, newObj).catch(console.error);
            }
            return newObj;
          });
          safeSetLocal(STORAGE_KEYS.PROVIDERS, updated);
          return updated;
        });
      }
    }

    if (targetUpdated && isFirebaseConfigured() && getDb()) {
      try {
        await setFirestoreDoc('requests', requestId, targetUpdated);
      } catch (err) {
        console.error('[Firebase] Error disbursing request in Firestore:', err);
      }
    }

    if (isBackendConnected) {
      await safeFetchJson<ExpenseRequest>(`/api/requests/${requestId}/disburse`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...details, actorName: currentUser.name }),
      });
    }
  };

  const handleSignInWithGoogle = async () => {
    const res = await signInWithGoogle();
    setFirebaseSyncCounter(prev => prev + 1);
    return res;
  };

  const handleLoginWithEmail = async (email: string, pass: string) => {
    const res = await loginWithEmailPassword(email, pass);
    setFirebaseSyncCounter(prev => prev + 1);
    return res;
  };

  const handleResetPassword = async (email: string) => {
    return await sendPasswordReset(email);
  };

  const handleLogoutUser = async () => {
    await logoutUser();
    setFirebaseUser(null);
    setActiveOrgIdState('');
    try {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_ORG);
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_TAB);
    } catch {}
  };

  const handleChangeCurrentUserPassword = async (currentPass: string, newPass: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await changeUserPassword(currentPass, newPass);
      return { success: true };
    } catch (err: any) {
      console.error('[ChangePassword Error]', err);
      const code = err?.code || '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        return { success: false, error: 'كلمة المرور الحالية غير صحيحة.' };
      } else if (code === 'auth/weak-password') {
        return { success: false, error: 'كلمة المرور الجديدة ضعيفة. يجب أن تتكون من 6 خانات على الأقل.' };
      } else if (code === 'auth/too-many-requests') {
        return { success: false, error: 'تم تجاوز عدد المحاولات مؤقتاً. يرجى الانتظار قليلاً.' };
      }
      return { success: false, error: err?.message || 'تعذر تغيير كلمة المرور.' };
    }
  };

  const handleUpdateUserProfileInfo = async (displayName: string, phone?: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await updateUserProfile(displayName);
      
      if (isSuperAdmin && userEmail) {
        const docId = userEmail.replace(/[^a-zA-Z0-9]/g, '_');
        await setFirestoreDoc('super_admins', docId, {
          name: displayName.trim(),
          phone: phone ? phone.trim() : '',
          updatedAt: new Date().toISOString()
        });
      }
      
      if (userMemberRecord) {
        await updateFirestoreDoc('members', userMemberRecord.id, {
          userName: displayName.trim(),
          phone: phone ? phone.trim() : (userMemberRecord.phone || '')
        });
      }

      setFirebaseSyncCounter(prev => prev + 1);
      return { success: true };
    } catch (err: any) {
      console.error('[UpdateProfile Error]', err);
      return { success: false, error: err?.message || 'تعذر تحديث البيانات الشخصية.' };
    }
  };

  return (
    <AppContext.Provider
      value={{
        organizations: scopedOrganizations,
        allOrganizations: rawOrganizations,
        activeOrgId: effectiveOrgId,
        activeOrg,
        users,
        currentUser,
        firebaseUser,
        authLoading,
        currentRole: resolvedRole,
        members: scopedMembers,
        services: scopedServices,
        providers: scopedProviders,
        requests: scopedRequests,
        activeTab,
        loading,
        isBackendConnected,
        isFirebaseConnected,
        isFirebaseModalOpen,
        firebaseError,
        clearFirebaseError,
        setActiveOrgId,
        setCurrentRole: () => {}, // Role is strictly resolved from authentication & membership
        setActiveTab,
        openFirebaseModal,
        closeFirebaseModal,
        superAdminEmails,
        addSuperAdminEmail,
        signInWithGoogle: handleSignInWithGoogle,
        loginWithEmail: handleLoginWithEmail,
        resetPassword: handleResetPassword,
        logoutUser: handleLogoutUser,
        updateUserProfileInfo: handleUpdateUserProfileInfo,
        changeCurrentUserPassword: handleChangeCurrentUserPassword,
        createCompanyUser,
        addOrganization,
        updateOrganization,
        deleteOrganization,
        addMember,
        updateMember,
        toggleMemberStatus,
        removeMember,
        adminResetUserPassword,
        addService,
        updateService,
        deleteService,
        addProvider,
        updateProvider,
        deleteProvider,
        createRequest,
        approveRequest,
        rejectRequest,
        requestClarification,
        replyClarification,
        disburseRequest,
        refreshData,
        resetToSampleData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
