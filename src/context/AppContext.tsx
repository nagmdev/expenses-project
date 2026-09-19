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
  PaymentMethod,
  AuditLogEntry,
  PaymentAccount,
  Department,
  AuditActionType,
  AuditEntityType,
  EmailNotificationSettings,
  EmailLogEntry,
  EmailEventType,
  isServiceMatchingOrg,
  AccountTransaction,
  TransactionType,
  RequestType,
  PettyCashCustody,
  CustodySettlementItem,
  CustodyStatus
} from '../types';
import { 
  DEFAULT_EMAIL_SETTINGS, 
  sendNotificationEmail 
} from '../services/emailService';
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
  logoutUser,
  loginWithEmailPassword,
  sendPasswordReset,
  adminCreateUserAccount,
  subscribeToAuth,
  purgeSampleDataFromFirestore
} from '../lib/firebase';
import { User as FirebaseUser } from 'firebase/auth';

export { 
  signInWithGoogle, 
  logoutUser, 
  loginWithEmailPassword, 
  sendPasswordReset, 
  adminCreateUserAccount 
} from '../lib/firebase';

export const SUPER_ADMINS_STORAGE_KEY = 'expenses_super_admin_emails_v3';

const STORAGE_KEYS = {
  ORGS: 'expenses_organizations_v3',
  MEMBERS: 'expenses_members_v3',
  SERVICES: 'expenses_services_v3',
  PROVIDERS: 'expenses_providers_v3',
  REQUESTS: 'expenses_requests_v3',
  ACTIVE_ORG: 'expenses_active_org_id_v3',
  ROLE: 'expenses_current_role_v3',
  ACTIVE_TAB: 'expenses_active_tab_v3',
  AUDIT_LOGS: 'expenses_audit_logs_v3',
  PAYMENT_ACCOUNTS: 'expenses_payment_accounts_v3',
  DEPARTMENTS: 'expenses_departments_v3',
  EMAIL_SETTINGS: 'expenses_email_settings_v3',
  EMAIL_LOGS: 'expenses_email_logs_v3',
  ACCOUNT_TRANSACTIONS: 'expenses_account_transactions_v3',
  PETTY_CASH_CUSTODIES: 'expense_system_custodies',
  CUSTODY_SETTLEMENTS: 'expense_system_custody_settlements',
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
      const seenIds = new Set<string>();
      const seenKeys = new Set<string>();
      const cleaned = parsed.filter((item: any) => {
        if (!item || typeof item !== 'object') return false;
        if (DUMMY_IDS.has(item.id) || DUMMY_IDS.has(item.orgId)) return false;
        if (item.name && typeof item.name === 'string' && item.name.includes('أفق التقنية')) return false;

        // Strict deduplication by ID
        if (item.id) {
          if (seenIds.has(item.id)) return false;
          seenIds.add(item.id);
        }

        // Strict deduplication by requestNumber for expense requests
        if (item.requestNumber) {
          const rNum = String(item.requestNumber).trim().toUpperCase();
          if (seenKeys.has(rNum)) return false;
          seenKeys.add(rNum);
        }

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
  allMembers: OrganizationMember[];
  services: ServiceCategory[];
  allServices: ServiceCategory[];
  providers: ServiceProvider[];
  allProviders: ServiceProvider[];
  requests: ExpenseRequest[];
  allRequests: ExpenseRequest[];
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
  removeSuperAdminEmail: (email: string) => Promise<void>;
  updateSuperAdminRole: (email: string, newRole: Role, targetOrgId?: string) => Promise<void>;
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
  addOrganization: (org: Omit<Organization, 'id' | 'createdAt'>) => Promise<{ success: boolean; message?: string; org?: Organization }>;
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
  
  createRequest: (data: {
    title: string;
    description: string;
    justification: string;
    amount: number;
    currency: string;
    serviceCategoryId: string;
    serviceCategoryName?: string;
    providerId: string;
    providerName?: string;
    urgency: 'low' | 'medium' | 'high';
    requestType?: RequestType;
    targetAccountId?: string;
    itemsDetail?: string;
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

  // Payment Accounts & Vaults
  paymentAccounts: PaymentAccount[];
  allPaymentAccounts: PaymentAccount[];
  transactions: AccountTransaction[];
  allTransactions: AccountTransaction[];
  addPaymentAccount: (account: Omit<PaymentAccount, 'id' | 'createdAt'>) => Promise<void>;
  updatePaymentAccount: (accountId: string, updates: Partial<PaymentAccount>) => Promise<void>;
  deletePaymentAccount: (accountId: string) => Promise<void>;
  togglePaymentAccountStatus: (accountId: string, active: boolean) => Promise<void>;
  recordManualAccountAdjustment: (accountId: string, type: TransactionType, amount: number, description: string) => Promise<void>;

  // Petty Cash & Custodies (العهد النقدية وتصفيتها)
  custodies: PettyCashCustody[];
  allCustodies: PettyCashCustody[];
  custodySettlements: CustodySettlementItem[];
  allCustodySettlements: CustodySettlementItem[];
  issueCustody: (
    orgId: string, 
    employeeId: string, 
    employeeName: string, 
    employeePhone: string | undefined, 
    amount: number, 
    sourceAccountId: string, 
    notes?: string
  ) => Promise<{ success: boolean; message?: string }>;
  settleCustodyItem: (
    custodyId: string, 
    amount: number, 
    description: string, 
    serviceCategoryId?: string, 
    vendorName?: string, 
    invoiceNumber?: string, 
    invoiceDate?: string, 
    receiptUrl?: string
  ) => Promise<{ success: boolean; message?: string }>;
  replenishCustody: (
    custodyId: string, 
    amount: number, 
    sourceAccountId: string, 
    notes?: string
  ) => Promise<{ success: boolean; message?: string }>;

  // Departments & Structure
  departments: Department[];
  allDepartments: Department[];
  addDepartment: (dept: Omit<Department, 'id' | 'createdAt'>) => Promise<void>;
  updateDepartment: (deptId: string, updates: Partial<Department>) => Promise<void>;
  deleteDepartment: (deptId: string) => Promise<void>;

  // Audit Trail & Logging
  auditLogs: AuditLogEntry[];
  allAuditLogs: AuditLogEntry[];
  logAuditAction: (params: {
    actionType: AuditActionType;
    entityType: AuditEntityType;
    entityId: string;
    entityName: string;
    details: string;
    orgId?: string;
    orgName?: string;
  }) => Promise<void>;
  
  // Email Notifications & Settings
  emailSettings: EmailNotificationSettings;
  updateEmailSettings: (settings: Partial<EmailNotificationSettings>) => Promise<void>;
  emailLogs: EmailLogEntry[];
  sendTestEmail: (recipientEmail: string, templateType?: EmailEventType) => Promise<{ success: boolean; message: string }>;
  clearEmailLogs: () => Promise<void>;

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

  const [rawAuditLogs, setRawAuditLogs] = useState<AuditLogEntry[]>(() => {
    return safeGetLocal<AuditLogEntry[]>(STORAGE_KEYS.AUDIT_LOGS, []);
  });

  const [rawPaymentAccounts, setRawPaymentAccounts] = useState<PaymentAccount[]>(() => {
    return safeGetLocal<PaymentAccount[]>(STORAGE_KEYS.PAYMENT_ACCOUNTS, []);
  });

  const [rawTransactions, setRawTransactions] = useState<AccountTransaction[]>(() => {
    return safeGetLocal<AccountTransaction[]>(STORAGE_KEYS.ACCOUNT_TRANSACTIONS, []);
  });

  const [rawCustodies, setRawCustodies] = useState<PettyCashCustody[]>(() => {
    return safeGetLocal<PettyCashCustody[]>(STORAGE_KEYS.PETTY_CASH_CUSTODIES, []);
  });

  const [rawCustodySettlements, setRawCustodySettlements] = useState<CustodySettlementItem[]>(() => {
    return safeGetLocal<CustodySettlementItem[]>(STORAGE_KEYS.CUSTODY_SETTLEMENTS, []);
  });

  const [rawDepartments, setRawDepartments] = useState<Department[]>(() => {
    return safeGetLocal<Department[]>(STORAGE_KEYS.DEPARTMENTS, []);
  });

  const [emailSettings, setEmailSettings] = useState<EmailNotificationSettings>(() => {
    return safeGetLocal<EmailNotificationSettings>(STORAGE_KEYS.EMAIL_SETTINGS, DEFAULT_EMAIL_SETTINGS);
  });

  const [emailLogs, setEmailLogs] = useState<EmailLogEntry[]>(() => {
    return safeGetLocal<EmailLogEntry[]>(STORAGE_KEYS.EMAIL_LOGS, []);
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
    const defaultAdmins = ['mahmoud@tieapps.com', 'awadhsaudi2030@gmail.com'];
    const envAdmins = import.meta.env.VITE_SUPER_ADMIN_EMAILS || '';
    const envList = envAdmins.split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean);
    const localAdmins = safeGetLocal<string[]>(SUPER_ADMINS_STORAGE_KEY, []);
    return Array.from(new Set([...defaultAdmins, ...envList, ...localAdmins])).filter(e => e.toLowerCase().trim() !== 'marwanagib813@gmail.com');
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
    if (userEmail === 'marwanagib813@gmail.com') return false; // Explicitly ensure this email is never admin
    if (userEmail === 'mahmoud@tieapps.com') return true;
    if (superAdminEmails.some(e => e.trim().toLowerCase() === userEmail && e.trim().toLowerCase() !== 'marwanagib813@gmail.com')) return true;
    if (userMemberRecord?.role === 'super_admin' && userEmail !== 'marwanagib813@gmail.com') return true;
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

    const defaultAdminName = userEmail === 'mahmoud@tieapps.com' ? 'محمود' : userEmail.split('@')[0];

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
      if (activeTab === 'dashboard' || activeTab === 'services' || activeTab === 'providers' || activeTab === 'organizations' || activeTab === 'settings') {
        setActiveTab('my-requests');
      }
    } else if (resolvedRole === 'data_entry') {
      if (activeTab === 'dashboard' || activeTab === 'requests' || activeTab === 'settings') {
        setActiveTab('providers');
      }
    } else if (resolvedRole === 'finance') {
      if (activeTab === 'organizations' || activeTab === 'settings') {
        setActiveTab('treasury');
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
    if (resolvedRole === 'org_admin' || resolvedRole === 'finance') {
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
      return effectiveOrgId === 'all' ? rawServices : rawServices.filter(s => isServiceMatchingOrg(s, effectiveOrgId));
    }
    if (!effectiveOrgId) return [];
    return rawServices.filter(s => isServiceMatchingOrg(s, effectiveOrgId));
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
  // - org_admin / finance: strictly sees requests for their company only
  // - employee: strictly sees their OWN requests only! Absolutely zero leakage of other employees' requests!
  const scopedRequests = useMemo(() => {
    if (!firebaseUser) return [];

    const myUid = firebaseUser.uid;
    const myEmail = userEmail.toLowerCase().trim();

    let list: ExpenseRequest[] = [];
    if (resolvedRole === 'super_admin') {
      if (effectiveOrgId && effectiveOrgId !== 'all') {
        list = rawRequests.filter(r => r.orgId === effectiveOrgId || !r.orgId);
      } else {
        list = rawRequests;
      }
    } else if (resolvedRole === 'org_admin' || resolvedRole === 'finance') {
      // Company Admin and Finance (Disburser) see all requests inside their specific company only
      list = rawRequests.filter(r => r.orgId === effectiveOrgId);
    } else {
      // Role is employee (or non-admin): strictly sees their own submitted requests only! Zero data leakage!
      list = rawRequests.filter(r => {
        const isMyRequest = 
          r.requesterId === myUid || 
          r.requesterId === currentUser.id || 
          (Boolean(r.requesterEmail && myEmail) && r.requesterEmail!.toLowerCase().trim() === myEmail);
        return isMyRequest && (!effectiveOrgId || r.orgId === effectiveOrgId);
      });
    }

    // Absolute deduplication guarantee (No duplicate cards by ID or Request Number)
    const seenIds = new Set<string>();
    const seenNumbers = new Set<string>();
    return list.filter(r => {
      const numKey = (r.requestNumber || '').trim().toUpperCase();
      if (seenIds.has(r.id) || (numKey && seenNumbers.has(numKey))) {
        return false;
      }
      seenIds.add(r.id);
      if (numKey) seenNumbers.add(numKey);
      return true;
    });
  }, [firebaseUser, resolvedRole, rawRequests, effectiveOrgId, userEmail, currentUser]);

  const scopedPaymentAccounts = useMemo(() => {
    if (!firebaseUser) return [];
    if (resolvedRole === 'super_admin') {
      return effectiveOrgId === 'all' ? rawPaymentAccounts : rawPaymentAccounts.filter(a => a.orgId === effectiveOrgId);
    }
    if (!effectiveOrgId) return [];
    return rawPaymentAccounts.filter(a => a.orgId === effectiveOrgId);
  }, [firebaseUser, resolvedRole, rawPaymentAccounts, effectiveOrgId]);

  const scopedTransactions = useMemo(() => {
    if (!firebaseUser) return [];
    if (resolvedRole === 'super_admin') {
      return effectiveOrgId === 'all' ? rawTransactions : rawTransactions.filter(t => t.orgId === effectiveOrgId);
    }
    if (!effectiveOrgId) return [];
    return rawTransactions.filter(t => t.orgId === effectiveOrgId);
  }, [firebaseUser, resolvedRole, rawTransactions, effectiveOrgId]);

  const scopedCustodies = useMemo(() => {
    if (!firebaseUser) return [];
    if (resolvedRole === 'super_admin') {
      return effectiveOrgId === 'all' ? rawCustodies : rawCustodies.filter(c => c.orgId === effectiveOrgId);
    }
    if (!effectiveOrgId) return [];
    if (resolvedRole === 'employee' && currentUser) {
      return rawCustodies.filter(c => c.orgId === effectiveOrgId && (c.employeeId === currentUser.id || c.employeeName === currentUser.name));
    }
    return rawCustodies.filter(c => c.orgId === effectiveOrgId);
  }, [firebaseUser, resolvedRole, rawCustodies, effectiveOrgId, currentUser]);

  const scopedCustodySettlements = useMemo(() => {
    if (!firebaseUser) return [];
    if (resolvedRole === 'super_admin') {
      return effectiveOrgId === 'all' ? rawCustodySettlements : rawCustodySettlements.filter(s => s.orgId === effectiveOrgId);
    }
    if (!effectiveOrgId) return [];
    if (resolvedRole === 'employee' && currentUser) {
      return rawCustodySettlements.filter(s => s.orgId === effectiveOrgId && (s.employeeId === currentUser.id || s.employeeName === currentUser.name));
    }
    return rawCustodySettlements.filter(s => s.orgId === effectiveOrgId);
  }, [firebaseUser, resolvedRole, rawCustodySettlements, effectiveOrgId, currentUser]);

  const scopedDepartments = useMemo(() => {
    if (!firebaseUser) return [];
    if (resolvedRole === 'super_admin') {
      return effectiveOrgId === 'all' ? rawDepartments : rawDepartments.filter(d => d.orgId === effectiveOrgId);
    }
    if (!effectiveOrgId) return [];
    return rawDepartments.filter(d => d.orgId === effectiveOrgId);
  }, [firebaseUser, resolvedRole, rawDepartments, effectiveOrgId]);

  const scopedAuditLogs = useMemo(() => {
    if (!firebaseUser) return [];
    if (resolvedRole === 'super_admin') {
      if (effectiveOrgId && effectiveOrgId !== 'all') {
        return rawAuditLogs.filter(l => l.orgId === effectiveOrgId || !l.orgId);
      }
      return rawAuditLogs;
    }
    if (!effectiveOrgId) return [];
    return rawAuditLogs.filter(l => l.orgId === effectiveOrgId);
  }, [firebaseUser, resolvedRole, rawAuditLogs, effectiveOrgId]);

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

    // 1. Organizations Listener with Real-Time Self-Healing Deduplication
    const unsubOrgs = onSnapshot(collection(db, 'organizations'), (snapshot) => {
      setIsFirebaseConnected(true);
      setFirebaseError(null);
      const list = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as Organization))
        .filter(o => !DUMMY_IDS.has(o.id));
      
      const seenIds = new Set<string>();
      const seenIdentity = new Set<string>();
      const dedupedList: Organization[] = [];

      for (const org of list) {
        const normKey = `${(org.name || '').trim().toLowerCase()}:::${(org.code || '').trim().toUpperCase()}`;
        if (!seenIds.has(org.id) && !seenIdentity.has(normKey)) {
          seenIds.add(org.id);
          seenIdentity.add(normKey);
          dedupedList.push(org);
        } else {
          // Automatic Self-Healing: Purge duplicate document permanently from Firestore
          console.warn(`[Firestore Self-Healing] Auto-deleting duplicate company doc: "${org.name}" (${org.id})`);
          if (isFirebaseConfigured() && getDb()) {
            deleteFirestoreDoc('organizations', org.id).catch(() => {});
          }
        }
      }

      setRawOrganizations(dedupedList);
      safeSetLocal(STORAGE_KEYS.ORGS, dedupedList);
    }, (err: any) => {
      console.warn('[Firebase] Organizations onSnapshot error:', err);
      setIsFirebaseConnected(false);
      if (err?.code === 'permission-denied') {
        setFirebaseError('قواعد أمان Firebase تمنع الوصول (Permission Denied). يرجى ضبط القواعد في Firebase Console.');
      } else {
        setFirebaseError(err?.message || 'تعذر الاتصال بقاعدة بيانات Firebase');
      }
    });

    // 2. Members Listener with Self-Healing Deduplication
    const unsubMembers = onSnapshot(collection(db, 'members'), (snapshot) => {
      const list = snapshot.docs
        .map(d => {
          const m = { id: d.id, ...d.data() } as OrganizationMember;
          if (m.userEmail?.toLowerCase().trim() === 'marwanagib813@gmail.com' && m.role === 'super_admin') {
            m.role = 'employee';
          }
          return m;
        })
        .filter(m => !DUMMY_IDS.has(m.id) && !DUMMY_IDS.has(m.orgId));

      const seenIds = new Set<string>();
      const seenEmailOrg = new Set<string>();
      const dedupedList: OrganizationMember[] = [];

      for (const mem of list) {
        const emailKey = `${mem.orgId}:::${(mem.userEmail || '').trim().toLowerCase()}`;
        if (!seenIds.has(mem.id) && (!mem.userEmail || !seenEmailOrg.has(emailKey))) {
          seenIds.add(mem.id);
          if (mem.userEmail) seenEmailOrg.add(emailKey);
          dedupedList.push(mem);
        } else {
          console.warn(`[Firestore Self-Healing] Auto-deleting duplicate member doc: "${mem.userName}" (${mem.id})`);
          if (isFirebaseConfigured() && getDb()) {
            deleteFirestoreDoc('members', mem.id).catch(() => {});
          }
        }
      }

      setRawMembers(dedupedList);
      safeSetLocal(STORAGE_KEYS.MEMBERS, dedupedList);
    }, (err) => {
      console.warn('[Firebase] Members onSnapshot error:', err);
    });

    // 3. Services Listener with Self-Healing Deduplication
    const unsubServices = onSnapshot(collection(db, 'services'), (snapshot) => {
      const list = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as ServiceCategory))
        .filter(s => !DUMMY_IDS.has(s.id) && !DUMMY_IDS.has(s.orgId));

      const seenIds = new Set<string>();
      const seenIdentity = new Set<string>();
      const dedupedList: ServiceCategory[] = [];

      for (const s of list) {
        const key = `${s.orgId}:::${(s.code || s.name || '').trim().toLowerCase()}`;
        if (!seenIds.has(s.id) && !seenIdentity.has(key)) {
          seenIds.add(s.id);
          seenIdentity.add(key);
          dedupedList.push(s);
        } else {
          console.warn(`[Firestore Self-Healing] Auto-deleting duplicate service doc: "${s.name}" (${s.id})`);
          if (isFirebaseConfigured() && getDb()) {
            deleteFirestoreDoc('services', s.id).catch(() => {});
          }
        }
      }

      setRawServices(dedupedList);
      safeSetLocal(STORAGE_KEYS.SERVICES, dedupedList);
    }, (err) => {
      console.warn('[Firebase] Services onSnapshot error:', err);
    });

    // 4. Providers Listener with Self-Healing Deduplication
    const unsubProviders = onSnapshot(collection(db, 'providers'), (snapshot) => {
      const list = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as ServiceProvider))
        .filter(p => !DUMMY_IDS.has(p.id) && !DUMMY_IDS.has(p.orgId));

      const seenIds = new Set<string>();
      const seenIdentity = new Set<string>();
      const dedupedList: ServiceProvider[] = [];

      for (const p of list) {
        const key = `${p.orgId}:::${(p.name || '').trim().toLowerCase()}`;
        if (!seenIds.has(p.id) && !seenIdentity.has(key)) {
          seenIds.add(p.id);
          seenIdentity.add(key);
          dedupedList.push(p);
        } else {
          console.warn(`[Firestore Self-Healing] Auto-deleting duplicate provider doc: "${p.name}" (${p.id})`);
          if (isFirebaseConfigured() && getDb()) {
            deleteFirestoreDoc('providers', p.id).catch(() => {});
          }
        }
      }

      setRawProviders(dedupedList);
      safeSetLocal(STORAGE_KEYS.PROVIDERS, dedupedList);
    }, (err) => {
      console.warn('[Firebase] Providers onSnapshot error:', err);
    });

    // 5. Requests Listener with Real-Time Self-Healing Deduplication & Attachment Cleanup
    const unsubRequests = onSnapshot(collection(db, 'requests'), (snapshot) => {
      const list = snapshot.docs
        .map(d => {
          const data = d.data();
          // Filter out dummy/unwanted attachments so fake documentation never displays
          const rawAttachments = Array.isArray(data.attachments) ? data.attachments : [];
          const cleanedAttachments = rawAttachments.filter((att: any) => 
            att && att.name && 
            !String(att.name).includes('فاتورة_عرض_سعر') && 
            String(att.name).trim() !== 'fdvbgfbgfb' &&
            String(att.name).trim().length > 0
          );
          return {
            id: d.id,
            ...data,
            attachments: cleanedAttachments,
          } as ExpenseRequest;
        })
        .filter(r => !DUMMY_IDS.has(r.id) && !DUMMY_IDS.has(r.orgId));

      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const seenIds = new Set<string>();
      const seenReqNumbers = new Set<string>();
      const dedupedList: ExpenseRequest[] = [];

      for (const req of list) {
        const numKey = (req.requestNumber || '').trim().toUpperCase();
        const isDuplicateId = seenIds.has(req.id);
        const isDuplicateNum = Boolean(numKey && seenReqNumbers.has(numKey));

        if (!isDuplicateId && !isDuplicateNum) {
          seenIds.add(req.id);
          if (numKey) seenReqNumbers.add(numKey);
          dedupedList.push(req);
        } else {
          // Automatic Self-Healing: Purge duplicate document permanently from Firestore
          console.warn(`[Firestore Self-Healing] Auto-deleting duplicate request doc: "${req.requestNumber}" (${req.id})`);
          if (isFirebaseConfigured() && getDb()) {
            deleteFirestoreDoc('requests', req.id).catch(() => {});
          }
        }
      }

      setRawRequests(dedupedList);
      safeSetLocal(STORAGE_KEYS.REQUESTS, dedupedList);
    }, (err) => {
      console.warn('[Firebase] Requests onSnapshot error:', err);
    });

    // 6. Super Admins Listener
    const unsubSuperAdmins = onSnapshot(collection(db, 'super_admins'), (snapshot) => {
      // Self-healing: if marwanagib813 is in Firestore super_admins collection, purge it immediately
      snapshot.docs.forEach(docSnap => {
        const email = (docSnap.data().email || docSnap.id || '').toLowerCase().trim();
        if (email === 'marwanagib813@gmail.com' || docSnap.id.toLowerCase().includes('marwanagib813')) {
          console.warn('[Firestore Self-Healing] Auto-removing marwanagib813 from super_admins collection in Firestore');
          if (isFirebaseConfigured() && getDb()) {
            deleteFirestoreDoc('super_admins', docSnap.id).catch(() => {});
          }
        }
      });

      const dbAdmins = snapshot.docs
        .map(d => (d.data().email || d.id || '').toLowerCase().trim())
        .filter(e => e && e !== 'marwanagib813@gmail.com');
      const defaultAdmins = ['mahmoud@tieapps.com'];
      const envAdmins = import.meta.env.VITE_SUPER_ADMIN_EMAILS || '';
      const envList = envAdmins.split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean);
      const merged = Array.from(new Set([...defaultAdmins, ...envList, ...dbAdmins])).filter(e => e !== 'marwanagib813@gmail.com');
      setSuperAdminEmails(merged);
      safeSetLocal(SUPER_ADMINS_STORAGE_KEY, merged);
    }, (err) => {
      console.warn('[Firebase] Super admins onSnapshot error:', err);
    });

    // 7. Payment Accounts Listener with Self-Healing Deduplication
    const unsubPaymentAccounts = onSnapshot(collection(db, 'paymentAccounts'), (snapshot) => {
      const list = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as PaymentAccount))
        .filter(p => !DUMMY_IDS.has(p.id) && !DUMMY_IDS.has(p.orgId));

      const seenIds = new Set<string>();
      const seenIdentity = new Set<string>();
      const dedupedList: PaymentAccount[] = [];

      for (const p of list) {
        const key = `${p.orgId}:::${(p.accountIdentifier || p.name || '').trim().toLowerCase()}`;
        if (!seenIds.has(p.id) && !seenIdentity.has(key)) {
          seenIds.add(p.id);
          seenIdentity.add(key);
          dedupedList.push(p);
        } else {
          console.warn(`[Firestore Self-Healing] Auto-deleting duplicate payment account doc: "${p.name}" (${p.id})`);
          if (isFirebaseConfigured() && getDb()) {
            deleteFirestoreDoc('paymentAccounts', p.id).catch(() => {});
          }
        }
      }

      setRawPaymentAccounts(dedupedList);
      safeSetLocal(STORAGE_KEYS.PAYMENT_ACCOUNTS, dedupedList);
    }, (err) => {
      console.warn('[Firebase] PaymentAccounts onSnapshot error:', err);
    });

    // 8. Departments Listener with Self-Healing Deduplication
    const unsubDepartments = onSnapshot(collection(db, 'departments'), (snapshot) => {
      const list = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as Department))
        .filter(d => !DUMMY_IDS.has(d.id) && !DUMMY_IDS.has(d.orgId));

      const seenIds = new Set<string>();
      const seenIdentity = new Set<string>();
      const dedupedList: Department[] = [];

      for (const d of list) {
        const key = `${d.orgId}:::${(d.name || '').trim().toLowerCase()}`;
        if (!seenIds.has(d.id) && !seenIdentity.has(key)) {
          seenIds.add(d.id);
          seenIdentity.add(key);
          dedupedList.push(d);
        } else {
          console.warn(`[Firestore Self-Healing] Auto-deleting duplicate department doc: "${d.name}" (${d.id})`);
          if (isFirebaseConfigured() && getDb()) {
            deleteFirestoreDoc('departments', d.id).catch(() => {});
          }
        }
      }

      setRawDepartments(dedupedList);
      safeSetLocal(STORAGE_KEYS.DEPARTMENTS, dedupedList);
    }, (err) => {
      console.warn('[Firebase] Departments onSnapshot error:', err);
    });

    // 9. Audit Logs Listener
    const unsubAuditLogs = onSnapshot(collection(db, 'auditLogs'), (snapshot) => {
      const list = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as AuditLogEntry))
        .filter(a => !DUMMY_IDS.has(a.id));
      list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setRawAuditLogs(list);
      safeSetLocal(STORAGE_KEYS.AUDIT_LOGS, list);
    }, (err) => {
      console.warn('[Firebase] AuditLogs onSnapshot error:', err);
    });

    // 10. Email Logs Listener
    const unsubEmailLogs = onSnapshot(collection(db, 'email_logs'), (snapshot) => {
      const list = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as EmailLogEntry));
      list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setEmailLogs(list);
      safeSetLocal(STORAGE_KEYS.EMAIL_LOGS, list);
    }, (err) => {
      console.warn('[Firebase] EmailLogs onSnapshot error:', err);
    });

    // 11. Account Transactions Listener
    const unsubAccountTransactions = onSnapshot(collection(db, 'accountTransactions'), (snapshot) => {
      const list = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as AccountTransaction))
        .filter(t => !DUMMY_IDS.has(t.id));
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setRawTransactions(list);
      safeSetLocal(STORAGE_KEYS.ACCOUNT_TRANSACTIONS, list);
    }, (err) => {
      console.warn('[Firebase] AccountTransactions onSnapshot error:', err);
    });

    // 12. Petty Cash Custodies Listener
    const unsubCustodies = onSnapshot(collection(db, 'pettyCashCustodies'), (snapshot) => {
      const list = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as PettyCashCustody))
        .filter(c => !DUMMY_IDS.has(c.id) && !DUMMY_IDS.has(c.orgId));
      list.sort((a, b) => new Date(b.createdAt || b.issuedAt).getTime() - new Date(a.createdAt || a.issuedAt).getTime());

      const seen = new Set<string>();
      const deduped: PettyCashCustody[] = [];
      for (const c of list) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          deduped.push(c);
        }
      }
      setRawCustodies(deduped);
      safeSetLocal(STORAGE_KEYS.PETTY_CASH_CUSTODIES, deduped);
    }, (err) => {
      console.warn('[Firebase] PettyCashCustodies onSnapshot error:', err);
    });

    // 13. Custody Settlements Listener
    const unsubCustodySettlements = onSnapshot(collection(db, 'custodySettlements'), (snapshot) => {
      const list = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as CustodySettlementItem))
        .filter(s => !DUMMY_IDS.has(s.id) && !DUMMY_IDS.has(s.orgId));
      list.sort((a, b) => new Date(b.createdAt || b.invoiceDate || '').getTime() - new Date(a.createdAt || a.invoiceDate || '').getTime());

      const seen = new Set<string>();
      const deduped: CustodySettlementItem[] = [];
      for (const s of list) {
        if (!seen.has(s.id)) {
          seen.add(s.id);
          deduped.push(s);
        }
      }
      setRawCustodySettlements(deduped);
      safeSetLocal(STORAGE_KEYS.CUSTODY_SETTLEMENTS, deduped);
    }, (err) => {
      console.warn('[Firebase] CustodySettlements onSnapshot error:', err);
    });

    return () => {
      unsubOrgs();
      unsubMembers();
      unsubServices();
      unsubProviders();
      unsubRequests();
      unsubSuperAdmins();
      unsubPaymentAccounts();
      unsubDepartments();
      unsubAuditLogs();
      unsubEmailLogs();
      unsubAccountTransactions();
      unsubCustodies();
      unsubCustodySettlements();
    };
  }, [firebaseUser, firebaseSyncCounter]);

  // =========================================================================
  // PROACTIVE MEMBER & USER SELF-HEALING SYNCHRONIZATION
  // Guarantees that any user who submits requests, logs in via Google/Email,
  // or exists in requests will have an official OrganizationMember record in Firestore.
  // =========================================================================
  useEffect(() => {
    if (!isFirebaseConfigured() || !getDb()) return;

    const missingMembersMap = new Map<string, {
      orgId: string;
      userId: string;
      userName: string;
      userEmail: string;
      phone?: string;
      department?: string;
      joinedAt: string;
    }>();

    // 1. Scan requests for any requesters missing from rawMembers
    for (const req of rawRequests) {
      const email = (req.requesterEmail || '').trim().toLowerCase();
      const uid = (req.requesterId || '').trim();
      if (!email && !uid) continue;

      const exists = rawMembers.some(m => 
        (email && m.userEmail && m.userEmail.trim().toLowerCase() === email) ||
        (uid && m.userId && m.userId === uid)
      );

      if (!exists) {
        const key = email || uid;
        if (!missingMembersMap.has(key)) {
          missingMembersMap.set(key, {
            orgId: req.orgId || (rawOrganizations[0]?.id || 'org-main'),
            userId: uid || `user-${Date.now()}`,
            userName: req.requesterName || (email ? email.split('@')[0] : 'موظف'),
            userEmail: email,
            phone: req.requesterPhone || '',
            department: req.requesterDepartment || 'العمليات والتشغيل',
            joinedAt: (req.createdAt || new Date().toISOString()).split('T')[0],
          });
        }
      }
    }

    // 2. Scan currently logged in firebaseUser if non-super-admin
    if (firebaseUser && userEmail && !isSuperAdmin) {
      const exists = rawMembers.some(m => 
        (userEmail && m.userEmail && m.userEmail.trim().toLowerCase() === userEmail) ||
        (firebaseUser.uid && m.userId === firebaseUser.uid)
      );

      if (!exists && !missingMembersMap.has(userEmail)) {
        const matchingReq = rawRequests.find(r => 
          (r.requesterEmail && r.requesterEmail.trim().toLowerCase() === userEmail) || 
          r.requesterId === firebaseUser.uid
        );
        const targetOrgId = matchingReq?.orgId || (rawOrganizations[0]?.id || 'org-main');

        missingMembersMap.set(userEmail, {
          orgId: targetOrgId,
          userId: firebaseUser.uid,
          userName: firebaseUser.displayName || userEmail.split('@')[0] || 'موظف',
          userEmail: userEmail,
          phone: firebaseUser.phoneNumber || '',
          department: 'العمليات والتشغيل',
          joinedAt: new Date().toISOString().split('T')[0],
        });
      }
    }

    if (missingMembersMap.size > 0) {
      console.info(`[Self-Healing] Detected ${missingMembersMap.size} missing member records. Auto-provisioning into Firestore...`);
      const newMembersToAppend: OrganizationMember[] = [];

      missingMembersMap.forEach((data) => {
        const memberId = `mem-${data.userId || Date.now()}`;
        const newMemDoc: OrganizationMember = {
          id: memberId,
          orgId: data.orgId,
          userId: data.userId,
          userName: data.userName,
          userEmail: data.userEmail,
          phone: data.phone,
          department: data.department || 'العمليات والتشغيل',
          jobTitle: 'موظف',
          role: 'employee',
          active: true,
          joinedAt: data.joinedAt,
        };

        setFirestoreDoc('members', memberId, newMemDoc).catch(err => {
          console.warn('[Self-Healing] Error persisting auto-healed member doc:', err);
        });

        newMembersToAppend.push(newMemDoc);
      });

      setRawMembers(prev => {
        const existingEmails = new Set(prev.map(m => (m.userEmail || '').trim().toLowerCase()).filter(Boolean));
        const existingUids = new Set(prev.map(m => m.userId).filter(Boolean));
        const uniqueToAdd = newMembersToAppend.filter(m => 
          (!m.userEmail || !existingEmails.has(m.userEmail.trim().toLowerCase())) &&
          (!m.userId || !existingUids.has(m.userId))
        );
        if (uniqueToAdd.length === 0) return prev;
        const updated = [...prev, ...uniqueToAdd];
        safeSetLocal(STORAGE_KEYS.MEMBERS, updated);
        return updated;
      });
    }
  }, [rawRequests, rawMembers, firebaseUser, userEmail, isSuperAdmin, rawOrganizations]);

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
  // AUDIT LOGGING HELPER
  // =========================================================================
  const logAuditAction = async (params: {
    actionType: AuditActionType;
    entityType: AuditEntityType;
    entityId: string;
    entityName: string;
    details: string;
    orgId?: string;
    orgName?: string;
  }) => {
    try {
      const id = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const timestamp = new Date().toISOString();
      const actorId = firebaseUser?.uid || currentUser.id || 'admin';
      const actorName = currentUser.name || firebaseUser?.displayName || 'المسؤول';
      const actorEmail = firebaseUser?.email || currentUser.email || '';
      const targetOrg = params.orgId ? rawOrganizations.find(o => o.id === params.orgId) : activeOrg;

      const newEntry: AuditLogEntry = {
        id,
        actionType: params.actionType,
        entityType: params.entityType,
        entityId: params.entityId,
        entityName: params.entityName,
        orgId: params.orgId || targetOrg?.id || '',
        orgName: params.orgName || targetOrg?.name || '',
        actorId,
        actorName,
        actorEmail,
        details: params.details,
        timestamp,
      };

      if (isFirebaseConfigured() && getDb()) {
        await setFirestoreDoc('auditLogs', id, newEntry).catch(err => {
          console.warn('[Firebase] Error saving audit log:', err);
        });
      }

      setRawAuditLogs(prev => {
        const updated = [newEntry, ...prev.slice(0, 499)];
        safeSetLocal(STORAGE_KEYS.AUDIT_LOGS, updated);
        return updated;
      });
    } catch (err) {
      console.warn('[Audit Logger Warning]', err);
    }
  };

  const removeSuperAdminEmail = async (email: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return;

    if (isFirebaseConfigured() && getDb()) {
      try {
        const docId = cleanEmail.replace(/[^a-zA-Z0-9]/g, '_');
        await deleteFirestoreDoc('super_admins', docId);
      } catch (err) {
        console.error('[Firebase] Error removing super admin email:', err);
      }
    }

    setSuperAdminEmails(prev => {
      const updated = prev.filter(e => e.trim().toLowerCase() !== cleanEmail);
      safeSetLocal(SUPER_ADMINS_STORAGE_KEY, updated);
      return updated;
    });

    await logAuditAction({
      actionType: 'role_change',
      entityType: 'member',
      entityId: cleanEmail,
      entityName: cleanEmail,
      details: `تمت إزالة صلاحية السوبر أدمن عن الحساب (${cleanEmail})`,
    });
  };

  const updateSuperAdminRole = async (email: string, newRole: Role, targetOrgId?: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return;

    if (newRole === 'super_admin') {
      await addSuperAdminEmail(cleanEmail);
      return;
    }

    // Demote from super admin
    await removeSuperAdminEmail(cleanEmail);

    // If targetOrgId is provided or user has a member record in an org, update or create their member role
    const existingMember = rawMembers.find(m => m.userEmail?.toLowerCase().trim() === cleanEmail);
    const orgIdToUse = targetOrgId || existingMember?.orgId || rawOrganizations[0]?.id || '';

    if (existingMember) {
      await updateMember(existingMember.id, {
        role: newRole,
        orgId: orgIdToUse,
      });
    } else if (orgIdToUse) {
      await addMember({
        orgId: orgIdToUse,
        userId: `user-${Date.now()}`,
        userName: cleanEmail.split('@')[0],
        userEmail: cleanEmail,
        role: newRole,
        department: newRole === 'finance' ? 'المالية والحسابات' : 'الإدارة العامة',
        jobTitle: newRole === 'org_admin' ? 'مدير شركة' : newRole === 'finance' ? 'مسؤول الصرف والخزينة' : newRole === 'data_entry' ? 'مدخل بيانات' : 'موظف',
        active: true,
      });
    }

    await logAuditAction({
      actionType: 'role_change',
      entityType: 'member',
      entityId: cleanEmail,
      entityName: cleanEmail,
      details: `تم تعديل رتبة المشرف (${cleanEmail}) إلى رتبة (${newRole === 'org_admin' ? 'مدير شركة' : newRole === 'finance' ? 'مسؤول الصرف والخزينة' : newRole === 'data_entry' ? 'مدخل بيانات' : 'موظف'}) للشركة (${orgIdToUse})`,
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
        : data.role === 'finance'
        ? 'مسؤول الصرف والخزينة'
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
        department: data.department?.trim() || (data.role === 'finance' ? 'المالية والحسابات' : data.role === 'data_entry' ? 'إدخال البيانات والتسجيل' : 'العمليات والتشغيل'),
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

      await logAuditAction({
        actionType: 'create',
        entityType: 'member',
        entityId: newMember.id,
        entityName: newMember.userName,
        orgId: targetOrgId,
        details: `تم إنشاء حساب وتعيين موظف جديد: "${newMember.userName}" (${newMember.userEmail}) برتبة ${newMember.role} وقسم ${newMember.department}`,
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
  const addOrganization = async (orgData: Omit<Organization, 'id' | 'createdAt'>): Promise<{ success: boolean; message?: string; org?: Organization }> => {
    const cleanName = orgData.name.trim();
    const cleanCode = (orgData.code?.trim() || cleanName.slice(0, 3)).toUpperCase();

    // Prevent duplicates by name or code
    const duplicate = rawOrganizations.find(o => 
      o.name.trim().toLowerCase() === cleanName.toLowerCase() ||
      o.code.trim().toUpperCase() === cleanCode
    );

    if (duplicate) {
      return { 
        success: false, 
        message: `توجد مؤسسة مسجلة بالفعل بنفس الاسم "${duplicate.name}" أو الكود (${duplicate.code}). تم منع التكرار.` 
      };
    }

    const cleanSlug = cleanCode.toLowerCase().replace(/[^a-z0-9]/g, '');
    const id = cleanSlug ? `org-${cleanSlug}` : `org-${Date.now()}`;
    const createdAt = new Date().toISOString();
    const newOrg: Organization = {
      id,
      ...orgData,
      name: cleanName,
      code: cleanCode,
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
        body: JSON.stringify(newOrg),
      });
    }

    setRawOrganizations(prev => {
      if (prev.some(o => o.id === id || o.code.toUpperCase() === cleanCode || o.name.trim().toLowerCase() === cleanName.toLowerCase())) {
        return prev;
      }
      const updated = [newOrg, ...prev];
      safeSetLocal(STORAGE_KEYS.ORGS, updated);
      return updated;
    });

    setActiveOrgId(id);

    await logAuditAction({
      actionType: 'create',
      entityType: 'organization',
      entityId: id,
      entityName: newOrg.name,
      orgId: id,
      orgName: newOrg.name,
      details: `تم إنشاء شركة ومؤسسة جديدة: "${newOrg.name}" بكود (${newOrg.code}) وميزانية معتمدة ${newOrg.budget.toLocaleString()} ${newOrg.currency}`,
    });

    return { success: true, org: newOrg };
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

    const nameChanged = Boolean(updates.name && updates.name.trim() !== org.name.trim());
    const budgetChanged = updates.budget !== undefined && updates.budget !== org.budget;
    const actionType: AuditActionType = nameChanged ? 'rename' : (budgetChanged ? 'budget_change' : 'update');
    let details = `تم تعديل بيانات الشركة: "${updatedOrg.name}"`;
    if (nameChanged) details += ` (إعادة التسمية من "${org.name}" إلى "${updatedOrg.name}")`;
    if (budgetChanged) details += ` (تعديل الميزانية من ${org.budget.toLocaleString()} إلى ${updatedOrg.budget.toLocaleString()} ${updatedOrg.currency})`;

    await logAuditAction({
      actionType,
      entityType: 'organization',
      entityId: orgId,
      entityName: updatedOrg.name,
      orgId,
      orgName: updatedOrg.name,
      details,
    });
  };

  const deleteOrganization = async (orgId: string): Promise<{ success: boolean; message?: string }> => {
    const orgToDelete = rawOrganizations.find(o => o.id === orgId);
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

    if (orgToDelete) {
      await logAuditAction({
        actionType: 'delete',
        entityType: 'organization',
        entityId: orgId,
        entityName: orgToDelete.name,
        orgId,
        orgName: orgToDelete.name,
        details: `تم حذف الشركة "${orgToDelete.name}" (${orgToDelete.code}) من النظام`,
      });
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
      if (prev.some(m => m.id === newMember.id || (m.orgId === newMember.orgId && m.userEmail?.toLowerCase() === newMember.userEmail?.toLowerCase()))) {
        return prev;
      }
      const updated = [newMember, ...prev];
      safeSetLocal(STORAGE_KEYS.MEMBERS, updated);
      return updated;
    });

    await logAuditAction({
      actionType: 'create',
      entityType: 'member',
      entityId: newMember.id,
      entityName: newMember.userName,
      orgId: newMember.orgId,
      details: `تم إضافة وتعيين موظف جديد: "${newMember.userName}" (${newMember.jobTitle} - ${newMember.department}) برتبة ${newMember.role}`,
    });
  };

  const removeMember = async (memberId: string) => {
    const mem = rawMembers.find(m => m.id === memberId);
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

    if (mem) {
      await logAuditAction({
        actionType: 'delete',
        entityType: 'member',
        entityId: memberId,
        entityName: mem.userName,
        orgId: mem.orgId,
        details: `تم حذف حساب وسجل الموظف "${mem.userName}" (${mem.userEmail}) من النظام`,
      });
    }
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

    const nameChanged = Boolean(
      (updates.userName && updates.userName.trim() !== mem.userName.trim()) ||
      (updates.jobTitle && updates.jobTitle.trim() !== mem.jobTitle.trim())
    );
    const roleChanged = Boolean(updates.role && updates.role !== mem.role);
    const actionType: AuditActionType = roleChanged ? 'role_change' : (nameChanged ? 'rename' : 'update');
    let details = `تم تعديل بيانات الموظف: "${updatedMember.userName}"`;
    if (nameChanged) details += ` (تعديل الاسم أو المسمى إلى "${updatedMember.userName} - ${updatedMember.jobTitle}")`;
    if (roleChanged) details += ` (ترقية أو تعديل الرتبة إلى ${updatedMember.role})`;

    await logAuditAction({
      actionType,
      entityType: 'member',
      entityId: memberId,
      entityName: updatedMember.userName,
      orgId: updatedMember.orgId,
      details,
    });
  };

  const toggleMemberStatus = async (memberId: string, active: boolean) => {
    const mem = rawMembers.find(m => m.id === memberId);
    await updateMember(memberId, { active });

    await logAuditAction({
      actionType: 'status_toggle',
      entityType: 'member',
      entityId: memberId,
      entityName: mem?.userName || memberId,
      orgId: mem?.orgId,
      details: `تم ${active ? 'تنشيط وتفعيل' : 'تعليق وإيقاف'} حساب الموظف "${mem?.userName || memberId}"`,
    });
  };

  const adminResetUserPassword = async (email: string): Promise<{ success: boolean; message?: string }> => {
    if (!email || !email.trim()) {
      return { success: false, message: 'البريد الإلكتروني غير متوفر.' };
    }
    try {
      await sendPasswordReset(email.trim().toLowerCase());
      
      await logAuditAction({
        actionType: 'password_reset',
        entityType: 'member',
        entityId: email,
        entityName: email,
        details: `تم إرسال رابط رسمي لاستعادة وإعادة تعيين كلمة المرور إلى البريد: "${email}"`,
      });

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
    const id = `srv-${Date.now()}`;
    const newService: ServiceCategory = {
      ...serviceData,
      id,
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
      if (prev.some(s => s.id === id || (s.orgId === newService.orgId && (s.code === newService.code || s.name.trim().toLowerCase() === newService.name.trim().toLowerCase())))) {
        return prev;
      }
      const updated = [...prev, newService];
      safeSetLocal(STORAGE_KEYS.SERVICES, updated);
      return updated;
    });

    await logAuditAction({
      actionType: 'create',
      entityType: 'service',
      entityId: id,
      entityName: newService.name,
      orgId: newService.orgId,
      details: `تم إنشاء بند صرف وتكلفة جديد: "${newService.name}" بكود (${newService.code}) وسقف ميزانية ${newService.budgetLimit.toLocaleString()}`,
    });
  };

  const updateService = async (updatedService: ServiceCategory) => {
    const oldService = rawServices.find(s => s.id === updatedService.id);

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

    const nameChanged = Boolean(oldService && oldService.name.trim() !== updatedService.name.trim());
    const budgetChanged = Boolean(oldService && oldService.budgetLimit !== updatedService.budgetLimit);
    const actionType: AuditActionType = nameChanged ? 'rename' : (budgetChanged ? 'budget_change' : 'update');
    let details = `تم تعديل بند الصرف: "${updatedService.name}"`;
    if (nameChanged && oldService) details += ` (إعادة التسمية من "${oldService.name}" إلى "${updatedService.name}")`;
    if (budgetChanged && oldService) details += ` (تعديل سقف الميزانية من ${oldService.budgetLimit.toLocaleString()} إلى ${updatedService.budgetLimit.toLocaleString()})`;

    await logAuditAction({
      actionType,
      entityType: 'service',
      entityId: updatedService.id,
      entityName: updatedService.name,
      orgId: updatedService.orgId,
      details,
    });
  };

  const deleteService = async (serviceId: string) => {
    const srv = rawServices.find(s => s.id === serviceId);

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

    if (srv) {
      await logAuditAction({
        actionType: 'delete',
        entityType: 'service',
        entityId: serviceId,
        entityName: srv.name,
        orgId: srv.orgId,
        details: `تم حذف بند الصرف "${srv.name}" (${srv.code}) من النظام`,
      });
    }
  };

  // 4. PROVIDERS
  const addProvider = async (providerData: Omit<ServiceProvider, 'id' | 'totalPaid'>) => {
    const id = `prov-${Date.now()}`;
    const newProvider: ServiceProvider = {
      ...providerData,
      id,
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
      if (prev.some(p => p.id === id || (p.orgId === newProvider.orgId && p.name.trim().toLowerCase() === newProvider.name.trim().toLowerCase()))) {
        return prev;
      }
      const updated = [...prev, newProvider];
      safeSetLocal(STORAGE_KEYS.PROVIDERS, updated);
      return updated;
    });

    await logAuditAction({
      actionType: 'create',
      entityType: 'provider',
      entityId: id,
      entityName: newProvider.name,
      orgId: newProvider.orgId,
      details: `تم إضافة مورد ومقدم خدمة جديد: "${newProvider.name}" (هاتف: ${newProvider.phone || '-'})`,
    });
  };

  const updateProvider = async (updatedProvider: ServiceProvider) => {
    const oldProvider = rawProviders.find(p => p.id === updatedProvider.id);

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

    const nameChanged = Boolean(oldProvider && oldProvider.name.trim() !== updatedProvider.name.trim());
    const actionType: AuditActionType = nameChanged ? 'rename' : 'update';
    let details = `تم تعديل بيانات المورد: "${updatedProvider.name}"`;
    if (nameChanged && oldProvider) details += ` (إعادة التسمية من "${oldProvider.name}" إلى "${updatedProvider.name}")`;

    await logAuditAction({
      actionType,
      entityType: 'provider',
      entityId: updatedProvider.id,
      entityName: updatedProvider.name,
      orgId: updatedProvider.orgId,
      details,
    });
  };

  const deleteProvider = async (providerId: string) => {
    const prov = rawProviders.find(p => p.id === providerId);

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

    if (prov) {
      await logAuditAction({
        actionType: 'delete',
        entityType: 'provider',
        entityId: providerId,
        entityName: prov.name,
        orgId: prov.orgId,
        details: `تم حذف المورد "${prov.name}" من النظام`,
      });
    }
  };

  // 5. PAYMENT ACCOUNTS / VAULTS
  const addPaymentAccount = async (accountData: Omit<PaymentAccount, 'id' | 'createdAt'>) => {
    const id = `vault-${Date.now()}`;
    const createdAt = new Date().toISOString();
    const initBal = Number(accountData.initialBalance || accountData.currentBalance || accountData.balance || 0);
    const newAccount: PaymentAccount = {
      id,
      ...accountData,
      initialBalance: initBal,
      currentBalance: initBal,
      balance: initBal,
      totalIn: Number(accountData.totalIn || 0),
      totalOut: Number(accountData.totalOut || 0),
      createdAt,
    };

    if (isFirebaseConfigured() && getDb()) {
      try {
        await setFirestoreDoc('paymentAccounts', id, newAccount);
      } catch (err) {
        console.error('[Firebase] Error saving payment account:', err);
      }
    }

    setRawPaymentAccounts(prev => {
      if (prev.some(a => a.id === id || (a.orgId === newAccount.orgId && a.accountIdentifier === newAccount.accountIdentifier))) {
        return prev;
      }
      const updated = [newAccount, ...prev];
      safeSetLocal(STORAGE_KEYS.PAYMENT_ACCOUNTS, updated);
      return updated;
    });

    if (initBal > 0) {
      const txId = `tx-${Date.now()}`;
      const initTx: AccountTransaction = {
        id: txId,
        orgId: newAccount.orgId,
        accountId: id,
        accountName: newAccount.name,
        type: 'in',
        amount: initBal,
        balanceBefore: 0,
        balanceAfter: initBal,
        referenceType: 'initial',
        description: `رصيد افتتاحي عند إنشاء الحساب`,
        actorName: currentUser.name,
        actorId: currentUser.id,
        createdAt,
      };
      if (isFirebaseConfigured() && getDb()) {
        setFirestoreDoc('accountTransactions', txId, initTx).catch(() => {});
      }
      setRawTransactions(prev => {
        const updated = [initTx, ...prev];
        safeSetLocal(STORAGE_KEYS.ACCOUNT_TRANSACTIONS, updated);
        return updated;
      });
    }

    await logAuditAction({
      actionType: 'create',
      entityType: 'vault',
      entityId: id,
      entityName: newAccount.name,
      orgId: newAccount.orgId,
      details: `تم إنشاء وسيلة وخزينة دفع جديدة: "${newAccount.name}" (${newAccount.type}) برصيد افتتاحي ${initBal.toLocaleString()} ${newAccount.currency}`,
    });
  };

  const updatePaymentAccount = async (accountId: string, updates: Partial<PaymentAccount>) => {
    const account = rawPaymentAccounts.find(a => a.id === accountId);
    if (!account) return;

    const updatedAccount: PaymentAccount = {
      ...account,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    if (isFirebaseConfigured() && getDb()) {
      try {
        await updateFirestoreDoc('paymentAccounts', accountId, updatedAccount);
      } catch (err) {
        console.error('[Firebase] Error updating payment account:', err);
      }
    }

    setRawPaymentAccounts(prev => {
      const updated = prev.map(a => a.id === accountId ? updatedAccount : a);
      safeSetLocal(STORAGE_KEYS.PAYMENT_ACCOUNTS, updated);
      return updated;
    });

    const nameChanged = Boolean(updates.name && updates.name.trim() !== account.name.trim());
    await logAuditAction({
      actionType: nameChanged ? 'rename' : 'update',
      entityType: 'vault',
      entityId: accountId,
      entityName: updatedAccount.name,
      orgId: updatedAccount.orgId,
      details: nameChanged 
        ? `تم إعادة تسمية وسيلة الدفع من "${account.name}" إلى "${updatedAccount.name}"`
        : `تم تعديل بيانات وسيلة وخزينة الدفع "${updatedAccount.name}"`,
    });
  };

  const deletePaymentAccount = async (accountId: string) => {
    const account = rawPaymentAccounts.find(a => a.id === accountId);
    if (isFirebaseConfigured() && getDb()) {
      try {
        await deleteFirestoreDoc('paymentAccounts', accountId);
      } catch (err) {
        console.error('[Firebase] Error deleting payment account:', err);
      }
    }

    setRawPaymentAccounts(prev => {
      const updated = prev.filter(a => a.id !== accountId);
      safeSetLocal(STORAGE_KEYS.PAYMENT_ACCOUNTS, updated);
      return updated;
    });

    if (account) {
      await logAuditAction({
        actionType: 'delete',
        entityType: 'vault',
        entityId: accountId,
        entityName: account.name,
        orgId: account.orgId,
        details: `تم حذف وسيلة وخزينة الدفع "${account.name}" من النظام`,
      });
    }
  };

  const togglePaymentAccountStatus = async (accountId: string, active: boolean) => {
    const account = rawPaymentAccounts.find(a => a.id === accountId);
    await updatePaymentAccount(accountId, { active });

    await logAuditAction({
      actionType: 'status_toggle',
      entityType: 'vault',
      entityId: accountId,
      entityName: account?.name || accountId,
      orgId: account?.orgId,
      details: `تم ${active ? 'تفعيل' : 'تعطيل'} حساب/خزينة الدفع "${account?.name || accountId}"`,
    });
  };

  const recordManualAccountAdjustment = async (
    accountId: string,
    type: TransactionType,
    amount: number,
    description: string
  ) => {
    const account = rawPaymentAccounts.find(a => a.id === accountId);
    if (!account) return;

    const numAmount = Math.abs(amount);
    if (numAmount <= 0) return;

    const balanceBefore = Number(account.currentBalance ?? account.balance ?? 0);
    const balanceAfter = type === 'in' ? balanceBefore + numAmount : balanceBefore - numAmount;
    const newTotalIn = type === 'in' ? Number(account.totalIn || 0) + numAmount : Number(account.totalIn || 0);
    const newTotalOut = type === 'out' ? Number(account.totalOut || 0) + numAmount : Number(account.totalOut || 0);

    const updatedAccount: PaymentAccount = {
      ...account,
      currentBalance: balanceAfter,
      balance: balanceAfter,
      totalIn: newTotalIn,
      totalOut: newTotalOut,
      updatedAt: new Date().toISOString(),
    };

    const transId = `tx-${Date.now()}`;
    const newTransaction: AccountTransaction = {
      id: transId,
      orgId: account.orgId,
      accountId: account.id,
      accountName: account.name,
      type,
      amount: numAmount,
      balanceBefore,
      balanceAfter,
      referenceType: 'manual_adjustment',
      description: description.trim() || (type === 'in' ? 'إيداع نقدي مباشر' : 'سحب نقدي مباشر'),
      actorName: currentUser.name,
      actorId: currentUser.id,
      createdAt: new Date().toISOString(),
    };

    if (isFirebaseConfigured() && getDb()) {
      try {
        await updateFirestoreDoc('paymentAccounts', accountId, updatedAccount);
        await setFirestoreDoc('accountTransactions', transId, newTransaction);
      } catch (err) {
        console.error('[Firebase] Error recording manual adjustment:', err);
      }
    }

    setRawPaymentAccounts(prev => {
      const updated = prev.map(a => a.id === accountId ? updatedAccount : a);
      safeSetLocal(STORAGE_KEYS.PAYMENT_ACCOUNTS, updated);
      return updated;
    });

    setRawTransactions(prev => {
      const updated = [newTransaction, ...prev];
      safeSetLocal(STORAGE_KEYS.ACCOUNT_TRANSACTIONS, updated);
      return updated;
    });

    await logAuditAction({
      actionType: 'update',
      entityType: 'vault',
      entityId: accountId,
      entityName: account.name,
      orgId: account.orgId,
      details: `${type === 'in' ? 'إيداع وتغذية رصيد (+ IN)' : 'سحب وتسوية رصيد (- OUT)'} بقيمة ${numAmount.toLocaleString()} ${account.currency}. الرصيد: ${balanceBefore.toLocaleString()} -> ${balanceAfter.toLocaleString()}. البيان: ${description}`,
    });
  };

  // =========================================================================
  // PETTY CASH & CUSTODIES MANAGEMENT (العهد النقدية وتصفيتها واستعاضتها)
  // =========================================================================
  const issueCustody = async (
    orgId: string, 
    employeeId: string, 
    employeeName: string, 
    employeePhone: string | undefined, 
    amount: number, 
    sourceAccountId: string, 
    notes?: string
  ): Promise<{ success: boolean; message?: string }> => {
    const numAmount = Math.abs(Number(amount));
    if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
      return { success: false, message: 'يرجى إدخال مبلغ صحيح للعهدة.' };
    }

    const sourceAccount = rawPaymentAccounts.find(a => a.id === sourceAccountId);
    if (!sourceAccount) {
      return { success: false, message: 'حساب الخزينة / مصدر الصرف غير موجود.' };
    }

    const balanceBefore = Number(sourceAccount.currentBalance ?? sourceAccount.balance ?? 0);
    const balanceAfter = balanceBefore - numAmount;
    const newTotalOut = Number(sourceAccount.totalOut || 0) + numAmount;

    const updatedAccount: PaymentAccount = {
      ...sourceAccount,
      currentBalance: balanceAfter,
      balance: balanceAfter,
      totalOut: newTotalOut,
      updatedAt: new Date().toISOString(),
    };

    const custodyId = `cus-${Date.now()}`;
    const custodyNumber = `CUS-${Math.floor(100 + Math.random() * 900)}`;
    const txId = `tx-${Date.now()}`;

    const newTransaction: AccountTransaction = {
      id: txId,
      orgId: sourceAccount.orgId || orgId,
      accountId: sourceAccount.id,
      accountName: sourceAccount.name,
      type: 'out',
      amount: numAmount,
      balanceBefore,
      balanceAfter,
      referenceType: 'custody',
      referenceId: custodyId,
      referenceNumber: custodyNumber,
      description: `صرف عهدة نقدية للموظف ${employeeName}`,
      actorName: currentUser.name || 'مدير النظام',
      actorId: currentUser.id,
      createdAt: new Date().toISOString(),
    };

    const newCustody: PettyCashCustody = {
      id: custodyId,
      orgId,
      custodyNumber,
      employeeId,
      employeeName,
      employeePhone: employeePhone || '',
      totalAmount: numAmount,
      remainingAmount: numAmount,
      settledAmount: 0,
      currency: sourceAccount.currency || 'EGP',
      sourceAccountId: sourceAccount.id,
      sourceAccountName: sourceAccount.name,
      status: 'active',
      issuedAt: new Date().toISOString(),
      notes: notes || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (isFirebaseConfigured() && getDb()) {
      try {
        await setFirestoreDoc('pettyCashCustodies', custodyId, newCustody);
        await updateFirestoreDoc('paymentAccounts', sourceAccountId, updatedAccount);
        await setFirestoreDoc('accountTransactions', txId, newTransaction);
      } catch (err) {
        console.error('[Firebase] Error issuing custody:', err);
      }
    }

    setRawCustodies(prev => {
      const updated = [newCustody, ...prev];
      safeSetLocal(STORAGE_KEYS.PETTY_CASH_CUSTODIES, updated);
      return updated;
    });

    setRawPaymentAccounts(prev => {
      const updated = prev.map(a => a.id === sourceAccountId ? updatedAccount : a);
      safeSetLocal(STORAGE_KEYS.PAYMENT_ACCOUNTS, updated);
      return updated;
    });

    setRawTransactions(prev => {
      const updated = [newTransaction, ...prev];
      safeSetLocal(STORAGE_KEYS.ACCOUNT_TRANSACTIONS, updated);
      return updated;
    });

    await logAuditAction({
      actionType: 'create',
      entityType: 'custody',
      entityId: custodyId,
      entityName: `${custodyNumber} - ${employeeName}`,
      details: `صرف عهدة نقدية للموظف ${employeeName} بقيمة ${numAmount} ${newCustody.currency} من خزينة/حساب "${sourceAccount.name}"`,
      orgId,
      orgName: rawOrganizations.find(o => o.id === orgId)?.name,
    });

    return { success: true, message: `تم صرف العهدة بنجاح برقم ${custodyNumber}` };
  };

  const settleCustodyItem = async (
    custodyId: string, 
    amount: number, 
    description: string, 
    serviceCategoryId?: string, 
    vendorName?: string, 
    invoiceNumber?: string, 
    invoiceDate?: string, 
    receiptUrl?: string
  ): Promise<{ success: boolean; message?: string }> => {
    const custody = rawCustodies.find(c => c.id === custodyId);
    if (!custody) {
      return { success: false, message: 'العهدة غير موجودة أو تم حذفها.' };
    }

    const numAmount = Math.abs(Number(amount));
    if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
      return { success: false, message: 'يرجى إدخال مبلغ صحيح للفاتورة.' };
    }

    const newRemaining = Math.max(0, custody.remainingAmount - numAmount);
    const newSettled = custody.settledAmount + numAmount;
    const isFullySettled = newRemaining <= 0;
    const newStatus: CustodyStatus = isFullySettled ? 'settled' : custody.status;
    const settledAt = isFullySettled ? new Date().toISOString() : custody.settledAt;

    const matchedService = rawServices.find(s => s.id === serviceCategoryId);
    const serviceCategoryName = matchedService?.name || '';

    const settlementId = `stl-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const newSettlement: CustodySettlementItem = {
      id: settlementId,
      custodyId,
      orgId: custody.orgId,
      employeeId: custody.employeeId,
      employeeName: custody.employeeName,
      amount: numAmount,
      currency: custody.currency || 'EGP',
      serviceCategoryId: serviceCategoryId || '',
      serviceCategoryName,
      vendorName: vendorName || '',
      invoiceNumber: invoiceNumber || '',
      invoiceDate: invoiceDate || new Date().toISOString().split('T')[0],
      description: description.trim() || 'فاتورة تسوية عهدة',
      receiptUrl: receiptUrl || '',
      status: 'approved',
      createdAt: new Date().toISOString(),
    };

    const updatedCustody: PettyCashCustody = {
      ...custody,
      remainingAmount: newRemaining,
      settledAmount: newSettled,
      status: newStatus,
      settledAt,
      updatedAt: new Date().toISOString(),
    };

    if (isFirebaseConfigured() && getDb()) {
      try {
        await updateFirestoreDoc('pettyCashCustodies', custodyId, updatedCustody);
        await setFirestoreDoc('custodySettlements', settlementId, newSettlement);
      } catch (err) {
        console.error('[Firebase] Error settling custody item:', err);
      }
    }

    setRawCustodies(prev => {
      const updated = prev.map(c => c.id === custodyId ? updatedCustody : c);
      safeSetLocal(STORAGE_KEYS.PETTY_CASH_CUSTODIES, updated);
      return updated;
    });

    setRawCustodySettlements(prev => {
      const updated = [newSettlement, ...prev];
      safeSetLocal(STORAGE_KEYS.CUSTODY_SETTLEMENTS, updated);
      return updated;
    });

    await logAuditAction({
      actionType: 'update',
      entityType: 'custody',
      entityId: custodyId,
      entityName: `${custody.custodyNumber} - ${custody.employeeName}`,
      details: `تسجيل فاتورة تصفية عهدة بمبلغ ${numAmount} ${custody.currency} (فاتورة #${invoiceNumber || 'بدون'}) للموظف ${custody.employeeName}`,
      orgId: custody.orgId,
      orgName: rawOrganizations.find(o => o.id === custody.orgId)?.name,
    });

    return { success: true, message: `تم تسجيل فاتورة التصفية بنجاح بمبلغ ${numAmount} ${custody.currency}` };
  };

  const replenishCustody = async (
    custodyId: string, 
    amount: number, 
    sourceAccountId: string, 
    notes?: string
  ): Promise<{ success: boolean; message?: string }> => {
    const custody = rawCustodies.find(c => c.id === custodyId);
    if (!custody) {
      return { success: false, message: 'العهدة غير موجودة.' };
    }

    const numAmount = Math.abs(Number(amount));
    if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
      return { success: false, message: 'يرجى إدخال مبلغ استعاضة صحيح.' };
    }

    const sourceAccount = rawPaymentAccounts.find(a => a.id === sourceAccountId);
    if (!sourceAccount) {
      return { success: false, message: 'حساب الخزينة / المصدر المالي غير موجود.' };
    }

    const balanceBefore = Number(sourceAccount.currentBalance ?? sourceAccount.balance ?? 0);
    const balanceAfter = balanceBefore - numAmount;
    const newTotalOut = Number(sourceAccount.totalOut || 0) + numAmount;

    const updatedAccount: PaymentAccount = {
      ...sourceAccount,
      currentBalance: balanceAfter,
      balance: balanceAfter,
      totalOut: newTotalOut,
      updatedAt: new Date().toISOString(),
    };

    const txId = `tx-${Date.now()}`;
    const newTransaction: AccountTransaction = {
      id: txId,
      orgId: sourceAccount.orgId || custody.orgId,
      accountId: sourceAccount.id,
      accountName: sourceAccount.name,
      type: 'out',
      amount: numAmount,
      balanceBefore,
      balanceAfter,
      referenceType: 'custody',
      referenceId: custodyId,
      referenceNumber: custody.custodyNumber,
      description: `استعاضة عهدة نقدية للموظف ${custody.employeeName} (${custody.custodyNumber})`,
      actorName: currentUser.name || 'مدير النظام',
      actorId: currentUser.id,
      createdAt: new Date().toISOString(),
    };

    const updatedCustody: PettyCashCustody = {
      ...custody,
      totalAmount: custody.totalAmount + numAmount,
      remainingAmount: custody.remainingAmount + numAmount,
      status: 'active',
      notes: notes ? (custody.notes ? `${custody.notes} | [استعاضة: ${notes}]` : notes) : custody.notes,
      updatedAt: new Date().toISOString(),
    };

    if (isFirebaseConfigured() && getDb()) {
      try {
        await updateFirestoreDoc('pettyCashCustodies', custodyId, updatedCustody);
        await updateFirestoreDoc('paymentAccounts', sourceAccountId, updatedAccount);
        await setFirestoreDoc('accountTransactions', txId, newTransaction);
      } catch (err) {
        console.error('[Firebase] Error replenishing custody:', err);
      }
    }

    setRawCustodies(prev => {
      const updated = prev.map(c => c.id === custodyId ? updatedCustody : c);
      safeSetLocal(STORAGE_KEYS.PETTY_CASH_CUSTODIES, updated);
      return updated;
    });

    setRawPaymentAccounts(prev => {
      const updated = prev.map(a => a.id === sourceAccountId ? updatedAccount : a);
      safeSetLocal(STORAGE_KEYS.PAYMENT_ACCOUNTS, updated);
      return updated;
    });

    setRawTransactions(prev => {
      const updated = [newTransaction, ...prev];
      safeSetLocal(STORAGE_KEYS.ACCOUNT_TRANSACTIONS, updated);
      return updated;
    });

    await logAuditAction({
      actionType: 'update',
      entityType: 'custody',
      entityId: custodyId,
      entityName: `${custody.custodyNumber} - ${custody.employeeName}`,
      details: `استعاضة عهدة بقيمة ${numAmount} ${custody.currency} للموظف ${custody.employeeName} من حساب ${sourceAccount.name}`,
      orgId: custody.orgId,
      orgName: rawOrganizations.find(o => o.id === custody.orgId)?.name,
    });

    return { success: true, message: `تمت استعاضة العهدة بنجاح بمبلغ ${numAmount} ${custody.currency}` };
  };

  // 6. DEPARTMENTS & STRUCTURE
  const addDepartment = async (deptData: Omit<Department, 'id' | 'createdAt'>) => {
    const id = `dept-${Date.now()}`;
    const createdAt = new Date().toISOString();
    const newDept: Department = {
      id,
      ...deptData,
      createdAt,
    };

    if (isFirebaseConfigured() && getDb()) {
      try {
        await setFirestoreDoc('departments', id, newDept);
      } catch (err) {
        console.error('[Firebase] Error saving department:', err);
      }
    }

    setRawDepartments(prev => {
      if (prev.some(d => d.id === id || (d.orgId === newDept.orgId && d.name.trim().toLowerCase() === newDept.name.trim().toLowerCase()))) {
        return prev;
      }
      const updated = [newDept, ...prev];
      safeSetLocal(STORAGE_KEYS.DEPARTMENTS, updated);
      return updated;
    });

    await logAuditAction({
      actionType: 'create',
      entityType: 'department',
      entityId: id,
      entityName: newDept.name,
      orgId: newDept.orgId,
      details: `تم إنشاء قسم إداري جديد: "${newDept.name}"${newDept.managerName ? ` برئاسة (${newDept.managerName})` : ''}`,
    });
  };

  const updateDepartment = async (deptId: string, updates: Partial<Department>) => {
    const dept = rawDepartments.find(d => d.id === deptId);
    if (!dept) return;

    const updatedDept: Department = {
      ...dept,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    if (isFirebaseConfigured() && getDb()) {
      try {
        await updateFirestoreDoc('departments', deptId, updatedDept);
      } catch (err) {
        console.error('[Firebase] Error updating department:', err);
      }
    }

    setRawDepartments(prev => {
      const updated = prev.map(d => d.id === deptId ? updatedDept : d);
      safeSetLocal(STORAGE_KEYS.DEPARTMENTS, updated);
      return updated;
    });

    const nameChanged = Boolean(updates.name && updates.name.trim() !== dept.name.trim());
    await logAuditAction({
      actionType: nameChanged ? 'rename' : 'update',
      entityType: 'department',
      entityId: deptId,
      entityName: updatedDept.name,
      orgId: updatedDept.orgId,
      details: nameChanged 
        ? `تم إعادة تسمية القسم الإداري من "${dept.name}" إلى "${updatedDept.name}"`
        : `تم تعديل بيانات القسم الإداري "${updatedDept.name}"`,
    });
  };

  const deleteDepartment = async (deptId: string) => {
    const dept = rawDepartments.find(d => d.id === deptId);
    if (isFirebaseConfigured() && getDb()) {
      try {
        await deleteFirestoreDoc('departments', deptId);
      } catch (err) {
        console.error('[Firebase] Error deleting department:', err);
      }
    }

    setRawDepartments(prev => {
      const updated = prev.filter(d => d.id !== deptId);
      safeSetLocal(STORAGE_KEYS.DEPARTMENTS, updated);
      return updated;
    });

    if (dept) {
      await logAuditAction({
        actionType: 'delete',
        entityType: 'department',
        entityId: deptId,
        entityName: dept.name,
        orgId: dept.orgId,
        details: `تم حذف القسم الإداري "${dept.name}" من النظام`,
      });
    }
  };

  // 5. EXPENSE REQUESTS
  const createRequest = async (data: {
    title: string;
    description: string;
    justification: string;
    amount: number;
    currency: string;
    serviceCategoryId: string;
    serviceCategoryName?: string;
    providerId: string;
    providerName?: string;
    urgency: 'low' | 'medium' | 'high';
    requestType?: RequestType;
    targetAccountId?: string;
    itemsDetail?: string;
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

    const isIncome = data.requestType === 'income';

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
      serviceCategoryName: service?.name || data.serviceCategoryName || 'خدمة عامة',
      providerId: data.providerId,
      providerName: provider?.name || data.providerName || 'مورد عام',
      title: data.title,
      description: data.description,
      justification: data.justification,
      amount: data.amount,
      currency: data.currency,
      status: 'pending',
      urgency: data.urgency,
      requestType: data.requestType || 'expense',
      targetAccountId: data.targetAccountId,
      itemsDetail: data.itemsDetail,
      attachments,
      comments: [],
      timeline: [
        {
          id: `tl-${Date.now()}`,
          status: 'created',
          title: isIncome ? 'تم إنشاء وتقديم طلب توريد / تحصيل مالي' : 'تم إنشاء وتقديم طلب الصرف',
          description: data.paymentAccountDetails 
            ? `طريقة التحويل: ${data.preferredPaymentMethod || 'انستاباي'} (${data.paymentAccountDetails})`
            : (isIncome ? 'تم إرسال طلب التوريد للمراجعة والاستلام المالي' : 'تم إرسال الطلب للاعتماد المالي والإداري'),
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
      // Prevent duplicate creation if real-time onSnapshot already populated it
      const exists = prev.some(r => r.id === newRequest.id || (r.requestNumber && r.requestNumber === newRequest.requestNumber));
      if (exists) {
        return prev.map(r => (r.id === newRequest.id || (r.requestNumber && r.requestNumber === newRequest.requestNumber)) ? newRequest : r);
      }
      const updated = [newRequest, ...prev];
      safeSetLocal(STORAGE_KEYS.REQUESTS, updated);
      return updated;
    });

    // Automated Email Dispatch: Notify Company Admins and Super Admins
    try {
      const targetOrg = rawOrganizations.find(o => o.id === targetOrgId);
      const adminEmails = Array.from(new Set([
        ...rawMembers.filter(m => m.orgId === targetOrgId && m.role === 'org_admin').map(m => m.userEmail || ''),
        ...superAdminEmails,
        'awadhsaudi2030@gmail.com',
      ])).filter(e => e && e.includes('@'));

      if (adminEmails.length > 0) {
        sendNotificationEmail('new_request', adminEmails, {
          request: newRequest,
          org: targetOrg,
          actorName: currentUser.name,
        }, emailSettings).then(newLogs => {
          if (newLogs.length > 0) {
            setEmailLogs(prev => [...newLogs, ...prev].slice(0, 500));
          }
        }).catch(err => console.warn('[Email Dispatch Warning]', err));
      }
    } catch (e) {
      console.warn('[Email Dispatch Error]', e);
    }
  };

  const approveRequest = async (requestId: string, note?: string) => {
    if (resolvedRole !== 'super_admin' && resolvedRole !== 'org_admin') {
      console.warn('[RBAC] User does not have permission to approve requests:', resolvedRole);
      alert('عفواً، صلاحية اعتماد الطلبات مقتصرة على مدراء المؤسسة فقط. مسؤول الصرف يقوم بالصرف المالي فقط بعد الاعتماد.');
      return;
    }

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

    // Automated Email Dispatch: Notify Requester
    if (targetUpdated && (targetUpdated as ExpenseRequest).requesterEmail) {
      try {
        const reqObj = targetUpdated as ExpenseRequest;
        const targetOrg = rawOrganizations.find(o => o.id === reqObj.orgId);
        sendNotificationEmail('request_approved', [reqObj.requesterEmail!], {
          request: reqObj,
          org: targetOrg,
          note,
          actorName: currentUser.name,
        }, emailSettings).then(newLogs => {
          if (newLogs.length > 0) setEmailLogs(prev => [...newLogs, ...prev].slice(0, 500));
        }).catch(err => console.warn('[Email Dispatch Warning]', err));
      } catch (e) {
        console.warn('[Email Dispatch Error]', e);
      }
    }
  };

  const rejectRequest = async (requestId: string, reason: string) => {
    if (resolvedRole !== 'super_admin' && resolvedRole !== 'org_admin') {
      console.warn('[RBAC] User does not have permission to reject requests:', resolvedRole);
      alert('عفواً، صلاحية رفض الطلبات مقتصرة على مدراء المؤسسة فقط.');
      return;
    }

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

    // Automated Email Dispatch: Notify Requester
    if (targetUpdated && (targetUpdated as ExpenseRequest).requesterEmail) {
      try {
        const reqObj = targetUpdated as ExpenseRequest;
        const targetOrg = rawOrganizations.find(o => o.id === reqObj.orgId);
        sendNotificationEmail('request_rejected', [reqObj.requesterEmail!], {
          request: reqObj,
          org: targetOrg,
          rejectionReason: reason,
          actorName: currentUser.name,
        }, emailSettings).then(newLogs => {
          if (newLogs.length > 0) setEmailLogs(prev => [...newLogs, ...prev].slice(0, 500));
        }).catch(err => console.warn('[Email Dispatch Warning]', err));
      } catch (e) {
        console.warn('[Email Dispatch Error]', e);
      }
    }
  };

  const requestClarification = async (requestId: string, question: string) => {
    if (resolvedRole !== 'super_admin' && resolvedRole !== 'org_admin') {
      console.warn('[RBAC] User does not have permission to request clarification:', resolvedRole);
      alert('عفواً، صلاحية طلب توضيحات مقتصرة على مدراء المؤسسة فقط.');
      return;
    }

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

    // Automated Email Dispatch: Notify Requester
    if (targetUpdated && (targetUpdated as ExpenseRequest).requesterEmail) {
      try {
        const reqObj = targetUpdated as ExpenseRequest;
        const targetOrg = rawOrganizations.find(o => o.id === reqObj.orgId);
        sendNotificationEmail('clarification_requested', [reqObj.requesterEmail!], {
          request: reqObj,
          org: targetOrg,
          clarificationQuestion: question,
          actorName: currentUser.name,
        }, emailSettings).then(newLogs => {
          if (newLogs.length > 0) setEmailLogs(prev => [...newLogs, ...prev].slice(0, 500));
        }).catch(err => console.warn('[Email Dispatch Warning]', err));
      } catch (e) {
        console.warn('[Email Dispatch Error]', e);
      }
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
            ...(attachmentName ? { attachmentName } : {}),
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

    // Automated Email Dispatch: Notify Admins of clarification reply
    if (targetUpdated) {
      try {
        const reqObj = targetUpdated as ExpenseRequest;
        const targetOrg = rawOrganizations.find(o => o.id === reqObj.orgId);
        const adminEmails = Array.from(new Set([
          ...rawMembers.filter(m => m.orgId === reqObj.orgId && m.role === 'org_admin').map(m => m.userEmail || ''),
          ...superAdminEmails
        ])).filter(e => e && e.includes('@'));

        if (adminEmails.length > 0) {
          sendNotificationEmail('clarification_replied', adminEmails, {
            request: reqObj,
            org: targetOrg,
            note: replyText,
            actorName: currentUser.name,
          }, emailSettings).then(newLogs => {
            if (newLogs.length > 0) setEmailLogs(prev => [...newLogs, ...prev].slice(0, 500));
          }).catch(err => console.warn('[Email Dispatch Warning]', err));
        }
      } catch (e) {
        console.warn('[Email Dispatch Error]', e);
      }
    }
  };

  const disburseRequest = async (
    requestId: string, 
    details: Omit<DisbursementDetails, 'disbursedAt' | 'disbursedBy'>
  ) => {
    if (resolvedRole !== 'super_admin' && resolvedRole !== 'org_admin' && resolvedRole !== 'finance') {
      console.warn('[RBAC] User does not have permission to disburse requests:', resolvedRole);
      alert('عفواً، ليس لديك صلاحية تنفيذ عمليات الصرف والتحويل.');
      return;
    }

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

        const isIncome = req.requestType === 'income';

        const timeline = [
          ...req.timeline,
          {
            id: `tl-${Date.now()}`,
            status: 'disbursed' as const,
            title: isIncome ? 'تم تأكيد واستلام توريد المبلغ بنجاح' : 'تم تحويل وصرف المبلغ بنجاح',
            description: `${isIncome ? 'طريقة الاستلام' : 'طريقة الصرف'}: ${methodLabel} | رقم العملية/المرجع: ${details.referenceNumber}`,
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

    // 1. Automatic Treasury / Payment Account Balance & Ledger Integration
    if (disbursedAmount > 0 && targetUpdated) {
      const reqObj = targetUpdated as ExpenseRequest;
      const isIncome = reqObj.requestType === 'income';

      let targetAccount = details.accountId ? rawPaymentAccounts.find(a => a.id === details.accountId) : null;
      if (!targetAccount && details.bankName) {
        targetAccount = rawPaymentAccounts.find(a => 
          (a.orgId === reqObj.orgId) && 
          (details.bankName?.includes(a.name) || details.bankName?.includes(a.accountIdentifier))
        ) || null;
      }
      if (!targetAccount) {
        targetAccount = rawPaymentAccounts.find(a => 
          a.orgId === reqObj.orgId && 
          a.type === (details.paymentMethod === 'instapay' ? 'instapay' : details.paymentMethod === 'digital_wallet' ? 'wallet' : details.paymentMethod === 'bank_transfer' ? 'bank' : 'cash')
        ) || null;
      }

      if (targetAccount) {
        const balanceBefore = Number(targetAccount.currentBalance ?? targetAccount.balance ?? 0);
        const balanceAfter = isIncome ? balanceBefore + disbursedAmount : balanceBefore - disbursedAmount;
        const newTotalIn = isIncome ? Number(targetAccount.totalIn || 0) + disbursedAmount : Number(targetAccount.totalIn || 0);
        const newTotalOut = !isIncome ? Number(targetAccount.totalOut || 0) + disbursedAmount : Number(targetAccount.totalOut || 0);

        const updatedAccount: PaymentAccount = {
          ...targetAccount,
          currentBalance: balanceAfter,
          balance: balanceAfter,
          totalIn: newTotalIn,
          totalOut: newTotalOut,
          updatedAt: now.toISOString(),
        };

        const txId = `tx-${Date.now()}`;
        const newTx: AccountTransaction = {
          id: txId,
          orgId: targetAccount.orgId,
          accountId: targetAccount.id,
          accountName: targetAccount.name,
          type: isIncome ? 'in' : 'out',
          amount: disbursedAmount,
          balanceBefore,
          balanceAfter,
          referenceType: 'request',
          referenceId: reqObj.id,
          referenceNumber: reqObj.requestNumber,
          description: isIncome 
            ? `توريد وتحصيل للطلب رقم (${reqObj.requestNumber}) - ${reqObj.title} - المودع: ${reqObj.requesterName}`
            : `صرف وتحويل للطلب رقم (${reqObj.requestNumber}) - ${reqObj.title} - المستلم: ${reqObj.requesterName}`,
          actorName: currentUser.name,
          actorId: currentUser.id,
          createdAt: now.toISOString(),
        };

        if (isFirebaseConfigured() && getDb()) {
          updateFirestoreDoc('paymentAccounts', targetAccount.id, updatedAccount).catch(console.error);
          setFirestoreDoc('accountTransactions', txId, newTx).catch(console.error);
        }

        setRawPaymentAccounts(prev => {
          const updated = prev.map(a => a.id === targetAccount!.id ? updatedAccount : a);
          safeSetLocal(STORAGE_KEYS.PAYMENT_ACCOUNTS, updated);
          return updated;
        });

        setRawTransactions(prev => {
          const updated = [newTx, ...prev];
          safeSetLocal(STORAGE_KEYS.ACCOUNT_TRANSACTIONS, updated);
          return updated;
        });
      }
    }

    // 2. Update spentAmount / totalPaid (for expense requests)
    if (disbursedAmount > 0 && targetUpdated && (targetUpdated as ExpenseRequest).requestType !== 'income') {
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

    // Automated Email Dispatch: Notify Requester of disbursement
    if (targetUpdated && (targetUpdated as ExpenseRequest).requesterEmail) {
      try {
        const reqObj = targetUpdated as ExpenseRequest;
        const targetOrg = rawOrganizations.find(o => o.id === reqObj.orgId);
        const vault = rawPaymentAccounts.find(p => p.id === details.paymentMethod || p.accountIdentifier === details.referenceNumber);
        sendNotificationEmail('request_paid', [reqObj.requesterEmail!], {
          request: reqObj,
          org: targetOrg,
          disbursedVaultName: vault?.name || details.bankName,
          transactionRef: details.referenceNumber,
          note: details.notes,
          actorName: currentUser.name,
        }, emailSettings).then(newLogs => {
          if (newLogs.length > 0) setEmailLogs(prev => [...newLogs, ...prev].slice(0, 500));
        }).catch(err => console.warn('[Email Dispatch Warning]', err));
      } catch (e) {
        console.warn('[Email Dispatch Error]', e);
      }
    }
  };

  const updateEmailSettings = async (partial: Partial<EmailNotificationSettings>) => {
    const updated = { ...emailSettings, ...partial };
    setEmailSettings(updated);
    safeSetLocal(STORAGE_KEYS.EMAIL_SETTINGS, updated);
    if (isFirebaseConfigured() && getDb()) {
      try {
        await setFirestoreDoc('system_settings', 'email_notifications', updated);
      } catch (err) {
        console.error('[Firebase] Error updating email settings:', err);
      }
    }
    await logAuditAction({
      actionType: 'update',
      entityType: 'organization',
      entityId: 'email_settings',
      entityName: 'إعدادات الإشعارات البريدية',
      details: 'تم تحديث خيارات وقنوات إرسال البريد الإلكتروني',
    });
  };

  const sendTestEmail = async (recipientEmail: string, templateType: EmailEventType = 'test_email') => {
    if (!recipientEmail || !recipientEmail.includes('@')) {
      return { success: false, message: 'يرجى إدخال عنوان بريد إلكتروني صحيح.' };
    }
    try {
      const fakeReq: ExpenseRequest = {
        id: 'req-test',
        requestNumber: `REQ-${Math.floor(10000 + Math.random() * 90000)}`,
        orgId: activeOrgId || rawOrganizations[0]?.id || 'org-1',
        requesterId: currentUser.id,
        requesterName: currentUser.name,
        requesterEmail: recipientEmail,
        requesterDepartment: 'العمليات والتوريد',
        serviceCategoryId: 'serv-test',
        serviceCategoryName: 'مهمات ومصروفات تشغيلية',
        providerId: 'prov-test',
        providerName: 'المورد الرئيسي',
        title: 'طلب صرف تجريبي لمعاينة الإشعار',
        description: 'تجربة إرسال إشعار بريدي للتأكد من وصول الرسائل وتنسيق القالب العربي.',
        justification: 'فحص الربط السحابي مع Firebase ومزود البريد ومجموعة mail',
        amount: 2750,
        currency: 'EGP',
        status: 'pending',
        urgency: 'medium',
        attachments: [],
        comments: [],
        timeline: [],
        preferredPaymentMethod: 'instapay',
        paymentAccountDetails: 'finance@instapay',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const logs = await sendNotificationEmail(templateType, [recipientEmail], {
        request: fakeReq,
        org: activeOrg || rawOrganizations[0],
        actorName: currentUser.name,
        customSubject: '🧪 بريد اختباري من نظام مصروفي',
        customMessage: 'تم إرسال هذا البريد بنجاح لمعاينة قالب الإشعار البريدي والتحقق من الربط مع Firebase ومجموعة mail.',
        note: 'هذا إشعار اختباري للتأكد من وصول الرسائل بالشكل المطلوب للموظفين والمديرين.',
      }, { ...emailSettings, enabled: true });

      if (logs.length > 0) {
        setEmailLogs(prev => [...logs, ...prev].slice(0, 500));
        const firstLog = logs[0];
        if (firstLog.status === 'failed') {
          return {
            success: false,
            message: firstLog.errorMessage || 'تعذر إرسال البريد التجريبي. يرجى التحقق من إعدادات ومفتاح مزود البريد.',
          };
        }
      }

      return { success: true, message: `تم إرسال البريد التجريبي إلى (${recipientEmail}) بنجاح!` };
    } catch (err: any) {
      return { success: false, message: err?.message || 'فشل إرسال البريد التجريبي.' };
    }
  };

  const clearEmailLogs = async () => {
    setEmailLogs([]);
    safeSetLocal(STORAGE_KEYS.EMAIL_LOGS, []);
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
        allMembers: rawMembers,
        services: scopedServices,
        allServices: rawServices,
        providers: scopedProviders,
        allProviders: rawProviders,
        requests: scopedRequests,
        allRequests: rawRequests,
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
        removeSuperAdminEmail,
        updateSuperAdminRole,
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
        paymentAccounts: scopedPaymentAccounts,
        allPaymentAccounts: rawPaymentAccounts,
        transactions: scopedTransactions,
        allTransactions: rawTransactions,
        addPaymentAccount,
        updatePaymentAccount,
        deletePaymentAccount,
        togglePaymentAccountStatus,
        recordManualAccountAdjustment,
        custodies: scopedCustodies,
        allCustodies: rawCustodies,
        custodySettlements: scopedCustodySettlements,
        allCustodySettlements: rawCustodySettlements,
        issueCustody,
        settleCustodyItem,
        replenishCustody,
        departments: scopedDepartments,
        allDepartments: rawDepartments,
        addDepartment,
        updateDepartment,
        deleteDepartment,
        auditLogs: scopedAuditLogs,
        allAuditLogs: rawAuditLogs,
        logAuditAction,
        emailSettings,
        updateEmailSettings,
        emailLogs,
        sendTestEmail,
        clearEmailLogs,
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
