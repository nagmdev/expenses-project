import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { 
  Organization, 
  User, 
  OrganizationMember, 
  ServiceCategory, 
  ServiceProvider, 
  ExpenseRequest, 
  DisbursementDetails,
  RequestAttachment
} from '../types';
import {
  isFirebaseConfigured,
  initFirebase,
  getDb,
  setFirestoreDoc,
  deleteFirestoreDoc,
  collection,
  onSnapshot,
  doc,
  setDoc,
  type Firestore,
  signInWithGoogle,
  logoutUser,
  subscribeToAuth,
  purgeSampleDataFromFirestore,
  type FirebaseUser,
} from '../lib/firebase';

export { signInWithGoogle, logoutUser } from '../lib/firebase';

const STORAGE_KEYS = {
  ORGS: 'expenses_organizations_v2',
  MEMBERS: 'expenses_members_v2',
  SERVICES: 'expenses_services_v2',
  PROVIDERS: 'expenses_providers_v2',
  REQUESTS: 'expenses_requests_v2',
  ACTIVE_ORG: 'expenses_active_org_id_v2',
  ROLE: 'expenses_current_role_v2',
  ACTIVE_TAB: 'expenses_active_tab_v2',
};

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
  organizations: Organization[];
  activeOrgId: string;
  activeOrg?: Organization;
  users: User[];
  currentUser: User;
  firebaseUser: FirebaseUser | null;
  currentRole: 'org_admin' | 'employee';
  members: OrganizationMember[];
  services: ServiceCategory[];
  providers: ServiceProvider[];
  requests: ExpenseRequest[];
  activeTab: string;
  loading: boolean;
  isBackendConnected: boolean;
  isFirebaseConnected: boolean;
  isFirebaseModalOpen: boolean;
  
  setActiveOrgId: (id: string) => void;
  setCurrentRole: (role: 'org_admin' | 'employee') => void;
  setActiveTab: (tab: string) => void;
  openFirebaseModal: () => void;
  closeFirebaseModal: () => void;
  signInWithGoogle: () => Promise<any>;
  logoutUser: () => Promise<void>;
  
  // Organizations
  addOrganization: (org: Omit<Organization, 'id' | 'createdAt'>) => Promise<void>;
  
  // Members
  addMember: (member: Omit<OrganizationMember, 'id' | 'joinedAt'>) => Promise<void>;
  removeMember: (memberId: string) => Promise<void>;
  
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
  // Initialize state cleanly with zero fake data
  const [organizations, setOrganizations] = useState<Organization[]>(() => {
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

  const [currentRole, setCurrentRoleState] = useState<'org_admin' | 'employee'>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.ROLE);
    return (saved === 'employee' || saved === 'org_admin') ? saved : 'org_admin';
  });

  const [activeTab, setActiveTabState] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_TAB) || 'dashboard';
  });

  const [members, setMembers] = useState<OrganizationMember[]>(() => {
    return safeGetLocal<OrganizationMember[]>(STORAGE_KEYS.MEMBERS, []);
  });

  const [services, setServices] = useState<ServiceCategory[]>(() => {
    return safeGetLocal<ServiceCategory[]>(STORAGE_KEYS.SERVICES, []);
  });

  const [providers, setProviders] = useState<ServiceProvider[]>(() => {
    return safeGetLocal<ServiceProvider[]>(STORAGE_KEYS.PROVIDERS, []);
  });

  const [requests, setRequests] = useState<ExpenseRequest[]>(() => {
    return safeGetLocal<ExpenseRequest[]>(STORAGE_KEYS.REQUESTS, []);
  });

  const [loading, setLoading] = useState(false);
  const [isBackendConnected, setIsBackendConnected] = useState(false);
  const [isFirebaseConnected, setIsFirebaseConnected] = useState(false);
  const [isFirebaseModalOpen, setIsFirebaseModalOpen] = useState(false);
  const [firebaseSyncCounter, setFirebaseSyncCounter] = useState(0);

  const openFirebaseModal = () => setIsFirebaseModalOpen(true);
  const closeFirebaseModal = () => {
    setIsFirebaseModalOpen(false);
    setFirebaseSyncCounter(prev => prev + 1);
  };

  // Setters with persistent localStorage syncing
  const setActiveOrgId = (id: string) => {
    setActiveOrgIdState(id);
    try {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_ORG, id);
    } catch {}
  };

  const setCurrentRole = (role: 'org_admin' | 'employee') => {
    setCurrentRoleState(role);
    try {
      localStorage.setItem(STORAGE_KEYS.ROLE, role);
    } catch {}
  };

  const setActiveTab = (tab: string) => {
    setActiveTabState(tab);
    try {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_TAB, tab);
    } catch {}
  };

  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);

  // Subscribe to Firebase Authentication state changes
  useEffect(() => {
    const unsubscribe = subscribeToAuth((user) => {
      setFirebaseUser(user);
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Dynamic user derived from real active organization member or authenticated Google user
  const activeOrg = organizations.find(o => o.id === activeOrgId);
  const activeOrgMembers = members.filter(m => activeOrgId === 'all' || m.orgId === activeOrgId);
  
  const currentMember = activeOrgMembers.find(m => m.role === currentRole) || activeOrgMembers[0];
  const currentUser: User = firebaseUser ? {
    id: firebaseUser.uid,
    name: firebaseUser.displayName || currentMember?.userName || firebaseUser.email?.split('@')[0] || 'مستخدم Google',
    email: firebaseUser.email || currentMember?.userEmail || '',
    role: currentRole,
    avatar: firebaseUser.photoURL || undefined,
    phone: firebaseUser.phoneNumber || '',
  } : {
    id: currentMember?.userId || (currentRole === 'org_admin' ? 'admin-user' : 'employee-user'),
    name: currentMember?.userName || (currentRole === 'org_admin' ? 'مدير المؤسسة' : 'الموظف / طالب الصرف'),
    email: currentMember?.userEmail || '',
    role: currentRole,
  };

  const users: User[] = [
    ...(firebaseUser ? [{
      id: firebaseUser.uid,
      name: `${firebaseUser.displayName || 'مستخدم Google'} (الحالي)`,
      email: firebaseUser.email || '',
      role: currentRole,
      avatar: firebaseUser.photoURL || undefined,
    }] : []),
    ...members.map(m => ({
      id: m.userId,
      name: m.userName,
      email: m.userEmail,
      role: m.role,
    }))
  ];
  if (users.length === 0) {
    users.push(currentUser);
  }

  // =========================================================================
  // Real-Time Firebase Listeners (Cloud Firestore First)
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

    setIsFirebaseConnected(true);

    // One-time cleanup of any legacy sample mock data from Firestore
    purgeSampleDataFromFirestore().catch(() => {});

    // 1. Organizations Listener
    const unsubOrgs = onSnapshot(collection(db, 'organizations'), (snapshot) => {
      const list = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as Organization))
        .filter(o => !DUMMY_IDS.has(o.id));
      
      setOrganizations(list);
      safeSetLocal(STORAGE_KEYS.ORGS, list);

      if (list.length > 0) {
        if (!activeOrgId || !list.some(o => o.id === activeOrgId)) {
          setActiveOrgId(list[0].id);
        }
      } else {
        setActiveOrgId('');
      }
    }, (err) => {
      console.warn('[Firebase] Organizations onSnapshot error:', err);
      setIsFirebaseConnected(false);
    });

    // 2. Members Listener
    const unsubMembers = onSnapshot(collection(db, 'members'), (snapshot) => {
      const list = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as OrganizationMember))
        .filter(m => !DUMMY_IDS.has(m.id) && !DUMMY_IDS.has(m.orgId));
      setMembers(list);
      safeSetLocal(STORAGE_KEYS.MEMBERS, list);
    }, (err) => {
      console.warn('[Firebase] Members onSnapshot error:', err);
    });

    // 3. Services Listener
    const unsubServices = onSnapshot(collection(db, 'services'), (snapshot) => {
      const list = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as ServiceCategory))
        .filter(s => !DUMMY_IDS.has(s.id) && !DUMMY_IDS.has(s.orgId));
      setServices(list);
      safeSetLocal(STORAGE_KEYS.SERVICES, list);
    }, (err) => {
      console.warn('[Firebase] Services onSnapshot error:', err);
    });

    // 4. Providers Listener
    const unsubProviders = onSnapshot(collection(db, 'providers'), (snapshot) => {
      const list = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as ServiceProvider))
        .filter(p => !DUMMY_IDS.has(p.id) && !DUMMY_IDS.has(p.orgId));
      setProviders(list);
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
      setRequests(list);
      safeSetLocal(STORAGE_KEYS.REQUESTS, list);
    }, (err) => {
      console.warn('[Firebase] Requests onSnapshot error:', err);
    });

    return () => {
      unsubOrgs();
      unsubMembers();
      unsubServices();
      unsubProviders();
      unsubRequests();
    };
  }, [firebaseSyncCounter]);

  // Refresh data: if backend API is reachable and Firebase is not active, sync with local Express API
  const refreshData = useCallback(async () => {
    if (isFirebaseConfigured()) {
      // Re-trigger Firebase listener sync
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
        setOrganizations(orgsData);
        safeSetLocal(STORAGE_KEYS.ORGS, orgsData);

        if (memsData && Array.isArray(memsData)) {
          setMembers(memsData);
          safeSetLocal(STORAGE_KEYS.MEMBERS, memsData);
        }
        if (srvsData && Array.isArray(srvsData)) {
          setServices(srvsData);
          safeSetLocal(STORAGE_KEYS.SERVICES, srvsData);
        }
        if (provsData && Array.isArray(provsData)) {
          setProviders(provsData);
          safeSetLocal(STORAGE_KEYS.PROVIDERS, provsData);
        }
        if (reqsData && Array.isArray(reqsData)) {
          setRequests(reqsData);
          safeSetLocal(STORAGE_KEYS.REQUESTS, reqsData);
        }

        if (orgsData.length > 0 && activeOrgId === 'all') {
          setActiveOrgId(orgsData[0].id);
        }
      } else {
        // Backend offline / Vercel static deployment
        setIsBackendConnected(false);
      }
    } catch (err) {
      console.warn('[ExpenseSystem] Operating in resilient localStorage mode:', err);
      setIsBackendConnected(false);
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Reset / Clear helper
  const resetToSampleData = async () => {
    setOrganizations([]);
    setMembers([]);
    setServices([]);
    setProviders([]);
    setRequests([]);
    setActiveOrgId('');
    setCurrentRole('org_admin');
    setActiveTab('dashboard');

    safeSetLocal(STORAGE_KEYS.ORGS, []);
    safeSetLocal(STORAGE_KEYS.MEMBERS, []);
    safeSetLocal(STORAGE_KEYS.SERVICES, []);
    safeSetLocal(STORAGE_KEYS.PROVIDERS, []);
    safeSetLocal(STORAGE_KEYS.REQUESTS, []);
    try {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_ORG);
      localStorage.setItem(STORAGE_KEYS.ROLE, 'org_admin');
      localStorage.setItem(STORAGE_KEYS.ACTIVE_TAB, 'dashboard');
    } catch {}

    // Purge any legacy sample mock data from Cloud Firestore
    await purgeSampleDataFromFirestore();
  };

  // =========================================================================
  // MUTATIONS (Firestore First -> Express API -> LocalStorage Fallback)
  // =========================================================================

  // 1. ORGANIZATIONS
  const addOrganization = async (orgData: Omit<Organization, 'id' | 'createdAt'>) => {
    const id = `org-${Date.now()}`;
    const createdAt = new Date().toISOString();
    const newOrg: Organization = {
      id,
      ...orgData,
      createdAt,
    };

    const newMember: OrganizationMember = {
      id: `mem-${Date.now()}`,
      orgId: id,
      userId: 'user-admin',
      userName: 'المدير العام',
      userEmail: `admin@${orgData.code.toLowerCase() || 'company'}.com`,
      role: 'org_admin',
      department: 'الإدارة العامة',
      jobTitle: 'المدير العام',
      joinedAt: createdAt.split('T')[0],
      active: true,
    };

    // Firebase Firestore Sync
    if (isFirebaseConfigured() && getDb()) {
      try {
        await Promise.all([
          setFirestoreDoc('organizations', id, newOrg),
          setFirestoreDoc('members', newMember.id, newMember)
        ]);
      } catch (err) {
        console.error('[Firebase] Error saving organization:', err);
      }
    }

    // Backend Express Sync
    if (isBackendConnected) {
      await safeFetchJson<Organization>('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orgData),
      });
    }

    // Local state & persistence
    setOrganizations(prev => {
      const updated = [newOrg, ...prev];
      safeSetLocal(STORAGE_KEYS.ORGS, updated);
      return updated;
    });
    setMembers(prev => {
      const updated = [newMember, ...prev];
      safeSetLocal(STORAGE_KEYS.MEMBERS, updated);
      return updated;
    });
    setActiveOrgId(id);
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

    setMembers(prev => {
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

    setMembers(prev => {
      const updated = prev.filter(m => m.id !== memberId);
      safeSetLocal(STORAGE_KEYS.MEMBERS, updated);
      return updated;
    });
  };

  // Auto-sync Google user's role and organization membership with Firestore
  useEffect(() => {
    if (!firebaseUser || !firebaseUser.email) return;

    const userEmail = firebaseUser.email.toLowerCase();
    
    // Check if user's email matches an OrganizationMember in Firestore
    const activeOrgMember = members.find(
      m => (activeOrgId === 'all' || m.orgId === activeOrgId) && m.userEmail?.toLowerCase() === userEmail
    );
    const matchingMember = activeOrgMember || members.find(
      m => m.userEmail?.toLowerCase() === userEmail
    );

    if (matchingMember) {
      if (matchingMember.role === 'org_admin' || matchingMember.role === 'employee') {
        setCurrentRoleState(matchingMember.role);
        try {
          localStorage.setItem(STORAGE_KEYS.ROLE, matchingMember.role);
        } catch {}
      }
    } else {
      // If not yet a member, default to employee or let them join the active organization
      setCurrentRoleState('employee');
      try {
        localStorage.setItem(STORAGE_KEYS.ROLE, 'employee');
      } catch {}

      const targetOrgId = activeOrgId === 'all' ? (organizations[0]?.id || 'org-ofq') : activeOrgId;
      if (targetOrgId && organizations.length > 0) {
        const isAlreadyInOrg = members.some(
          m => m.orgId === targetOrgId && m.userEmail?.toLowerCase() === userEmail
        );
        if (!isAlreadyInOrg) {
          const newMemberData: Omit<OrganizationMember, 'id' | 'joinedAt'> = {
            orgId: targetOrgId,
            userId: firebaseUser.uid,
            userName: firebaseUser.displayName || userEmail.split('@')[0],
            userEmail: firebaseUser.email,
            role: 'employee',
            department: 'العمليات والتوريد',
            jobTitle: 'موظف',
            active: true,
          };
          addMember(newMemberData).catch(err => {
            console.warn('[AppContext] Failed to auto-join organization:', err);
          });
        }
      }
    }
  }, [firebaseUser, members, activeOrgId, organizations]);

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

    setServices(prev => {
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

    setServices(prev => {
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

    setServices(prev => {
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

    setProviders(prev => {
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

    setProviders(prev => {
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

    setProviders(prev => {
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
  }) => {
    const service = services.find(s => s.id === data.serviceCategoryId);
    const provider = providers.find(p => p.id === data.providerId);
    const orgId = activeOrgId && activeOrgId !== 'all' 
      ? activeOrgId 
      : (organizations[0]?.id || '');

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
      orgId,
      requesterId: currentUser.id,
      requesterName: currentUser.name,
      requesterDepartment: currentRole === 'org_admin' ? 'الإدارة العامة' : 'العمليات والتوريد',
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
          description: 'تم إرسال الطلب للاعتماد المالي والإداري',
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

    setRequests(prev => {
      const updated = [newRequest, ...prev];
      safeSetLocal(STORAGE_KEYS.REQUESTS, updated);
      return updated;
    });
  };

  const approveRequest = async (requestId: string, note?: string) => {
    const now = new Date();
    const dateFormatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    let targetUpdated: ExpenseRequest | null = null;

    setRequests(prev => {
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

    setRequests(prev => {
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

    setRequests(prev => {
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

    setRequests(prev => {
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
      details.paymentMethod === 'bank_transfer' ? 'تحويل بنكي' :
      details.paymentMethod === 'cash' ? 'نقداً / خزينة' : 'شيك مصرفي';

    let disbursedAmount = 0;
    let targetServiceId = '';
    let targetProviderId = '';
    let targetUpdated: ExpenseRequest | null = null;

    setRequests(prev => {
      const list = prev.map(req => {
        if (req.id !== requestId) return req;
        disbursedAmount = req.amount;
        targetServiceId = req.serviceCategoryId;
        targetProviderId = req.providerId;

        const disbursement: DisbursementDetails = {
          paymentMethod: details.paymentMethod,
          referenceNumber: details.referenceNumber,
          bankName: details.bankName || 'المصرف الرئيسي',
          notes: details.notes,
          disbursedAt: dateFormatted,
          disbursedBy: currentUser.name,
        };

        const timeline = [
          ...req.timeline,
          {
            id: `tl-${Date.now()}`,
            status: 'disbursed' as const,
            title: 'تم تنفيذ وصرف المبلغ المالي بنجاح',
            description: `طريقة الصرف: ${methodLabel} | رقم المرجع: ${details.referenceNumber}`,
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

    // Update service and provider spentAmount / totalPaid
    if (disbursedAmount > 0) {
      if (targetServiceId) {
        setServices(prev => {
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
        setProviders(prev => {
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
    return await signInWithGoogle();
  };

  const handleLogoutUser = async () => {
    await logoutUser();
    setFirebaseUser(null);
  };

  return (
    <AppContext.Provider
      value={{
        organizations,
        activeOrgId,
        activeOrg,
        users,
        currentUser,
        firebaseUser,
        currentRole,
        members,
        services,
        providers,
        requests,
        activeTab,
        loading,
        isBackendConnected,
        isFirebaseConnected,
        isFirebaseModalOpen,
        setActiveOrgId,
        setCurrentRole,
        setActiveTab,
        openFirebaseModal,
        closeFirebaseModal,
        signInWithGoogle: handleSignInWithGoogle,
        logoutUser: handleLogoutUser,
        addOrganization,
        addMember,
        removeMember,
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
