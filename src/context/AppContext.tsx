import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
  VisaRequest,
  VisaPaymentRecord,
} from '../types';
import { DEFAULT_EMAIL_SETTINGS } from '../services/emailTemplates';
import { createNotificationTransport } from '../services/emailService';
import {
  isFirebaseConfigured,
  initFirebase,
  getDb,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  or,
  orderBy,
  limit,
  onSnapshot,
  setDoc,
  changeUserPassword,
  updateUserProfile,
  signInWithGoogle,
  logoutUser,
  loginWithEmailPassword,
  sendPasswordReset,
  adminCreateUserAccount,
  subscribeToAuth,
  sendVerificationEmailToCurrentUser,
  refreshCurrentUserToken,
  purgeSampleDataFromFirestore,
  deleteFirestoreDoc,
  sanitizeForFirestore,
  auth,
} from '../lib/firebase';
import { User as FirebaseUser } from 'firebase/auth';
import type { Query, DocumentData } from 'firebase/firestore';
import { arrayRemove, arrayUnion, updateDoc } from 'firebase/firestore';
import { createFirestoreStore } from '../domain/firestoreStore';
import type { DataStore } from '../domain/store';
import { COL, DomainError, isDomainError, normalizeEmail, normalizeKeyValue, type Actor } from '../domain/common';
import {
  createExpenseRequest,
  disburseExpenseRequest,
  transitionExpenseRequest,
  updateExpenseRequest,
  type NotifyContext,
  type RequestDraft,
} from '../domain/requests';
import {
  adjustAccountBalance,
  createPaymentAccount,
  deletePaymentAccount as deletePaymentAccountOp,
  issueCustody as issueCustodyOp,
  replenishCustody as replenishCustodyOp,
  settleCustodyItem as settleCustodyItemOp,
  updatePaymentAccount as updatePaymentAccountOp,
} from '../domain/treasury';
import {
  addVisaPayment as addVisaPaymentOp,
  createVisaRequest as createVisaRequestOp,
  decideVisaRequest,
  deleteVisaRequest as deleteVisaRequestOp,
  updateVisaRequest as updateVisaRequestOp,
} from '../domain/visa';
import {
  createEntity,
  createMember,
  createOrganization,
  deleteEntity,
  ensureOrgNotificationRecipients,
  isRealUid,
  pickMembershipToLink,
  removeMember as removeMemberOp,
  removeOrganization,
  updateEntity,
  updateMemberRecord,
  updateOrganization as updateOrganizationOp,
} from '../domain/directory';
import {
  buildOutboxEvent,
  dispatchOutboxEvent,
  isDue,
  outboxToEmailLogs,
  type OutboxEvent,
} from '../domain/outbox';
import { newOperationKey } from '../utils/ids';
import { singleFlight } from '../utils/singleFlight';

export {
  signInWithGoogle,
  logoutUser,
  loginWithEmailPassword,
  sendPasswordReset,
  adminCreateUserAccount,
} from '../lib/firebase';

/** Pass the same key for every retry of one user intent (see hooks/useSubmitGuard). */
export interface MutationOptions {
  idempotencyKey?: string;
}

export interface DisburseOptions extends MutationOptions {
  batchId?: string;
}

export interface DisburseOutcome {
  changed: boolean;
  reason?: string;
  request: ExpenseRequest;
}

/**
 * Intelligent helper to resolve the underlying linked parent bank account for an InstaPay or Wallet account.
 * Follows Egyptian banking practices: InstaPay and electronic wallets are directly linked to / debited from bank accounts.
 */
export const resolveParentBankAccount = (
  account: PaymentAccount | null | undefined,
  allAccounts: PaymentAccount[]
): PaymentAccount | null => {
  if (!account || (account.type !== 'instapay' && account.type !== 'wallet')) {
    return null;
  }
  if (account.parentAccountId) {
    const parent = allAccounts.find(a => a.id === account.parentAccountId);
    if (parent && parent.id !== account.id) return parent;
  }
  return null;
};

// Only per-viewer UI preferences live in localStorage. Business data is NEVER
// persisted there: it is not transactional, not multi-tab safe, user-editable and
// goes stale. Firestore (with its own IndexedDB cache) is the single source of truth.
const PREF_KEYS = {
  ACTIVE_ORG: 'expenses_active_org_id_v3',
  ACTIVE_TAB: 'expenses_active_tab_v3',
};

const LEGACY_EMAIL_SETTINGS_KEY = 'expenses_email_settings_v3';
const LEGACY_BUSINESS_KEYS = [
  'expenses_organizations_v3',
  'expenses_members_v3',
  'expenses_services_v3',
  'expenses_providers_v3',
  'expenses_requests_v3',
  'expenses_audit_logs_v3',
  'expenses_payment_accounts_v3',
  'expenses_departments_v3',
  'expenses_email_logs_v3',
  'expenses_account_transactions_v3',
  'expense_system_custodies',
  'expense_system_custody_settlements',
  'expenses_visa_requests_v3',
  'expenses_super_admin_emails_v3',
];

// The old localStorage "database" (LEGACY_BUSINESS_KEYS) is NEVER deleted automatically.
// The previous version saved writes locally first and only logged Firestore errors, so
// some records (all visa requests, departments created by org admins, edits the old rules
// rejected) exist ONLY in the browser that created them. Those keys are no longer read as
// a data source, but they are kept intact so they can be recovered into Firestore.
export const LEGACY_LOCAL_DATA_KEYS = LEGACY_BUSINESS_KEYS;

const LISTENER_LABELS: Record<string, string> = {
  Organizations: 'الشركات',
  Organization: 'بيانات الشركة',
  Members: 'الموظفين',
  Services: 'بنود الصرف',
  Providers: 'الموردين',
  Departments: 'الأقسام',
  Requests: 'طلبات الصرف',
  'Requests (fallback)': 'طلبات الصرف',
  'Visa Requests': 'طلبات التأشيرات',
  'Payment Accounts': 'الخزائن والحسابات',
  'Account Transactions': 'الحركات المالية',
  Custodies: 'العهد',
  'Custody Settlements': 'تسويات العهد',
  'Audit Logs': 'سجل التدقيق',
  Outbox: 'سجل الإشعارات',
  'Email Logs': 'سجل البريد القديم',
};

const DUMMY_IDS = new Set([
  'org-ofq', 'org-rwd', 'mem-1', 'mem-2', 'mem-3',
  'srv-cloud', 'srv-software', 'srv-hardware', 'srv-legal', 'srv-mkt', 'srv-travel',
  'prov-aws', 'prov-github', 'prov-jarir', 'prov-law',
  'req-101', 'req-102', 'req-103'
]);

// The ONLY built-in platform owner. Must stay identical to builtInSuperAdmins() in
// firestore.rules: the UI must never consider someone a super admin that the rules
// do not (that mismatch makes every list come back empty). Additional super admins
// can only be granted from the app (super_admins collection), never from env/config.
const DEFAULT_SUPER_ADMINS = ['mahmoud@tieapps.com'];

const readPref = (key: string, fallback = '') => {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};
const writePref = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
};

const uniqueById = <T extends { id: string }>(list: T[]): T[] => {
  const seen = new Set<string>();
  return list.filter(item => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

const byCreatedDesc = (a: { createdAt?: string }, b: { createdAt?: string }) =>
  new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();

/** Translate low-level errors into a message the user can act on. */
export function toUserError(err: unknown): Error {
  if (isDomainError(err)) return err;
  const e = err as any;
  const code: string = e?.code || '';
  const msg: string = e?.message || String(err || '');
  if (code === 'permission-denied' || /permission|PERMISSION_DENIED/i.test(msg)) {
    return new Error('رفضت قاعدة البيانات هذه العملية (صلاحيات غير كافية). تأكد من صلاحيات حسابك ومن نشر ملف قواعد الأمان المحدّث firestore.rules.');
  }
  if (code === 'unavailable' || code === 'deadline-exceeded' || /offline|network/i.test(msg)) {
    return new Error('تعذر الاتصال بقاعدة البيانات. تحقق من الاتصال ثم أعد المحاولة — إعادة المحاولة آمنة ولن تُكرر العملية.');
  }
  if (code === 'aborted' || code === 'failed-precondition') {
    return new Error('تعارضت العملية مع تعديل متزامن على نفس البيانات. أعد المحاولة.');
  }
  return err instanceof Error ? err : new Error(msg || 'حدث خطأ غير متوقع.');
}

interface CreateRequestData {
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
  attachments?: RequestAttachment[];
  preferredPaymentMethod?: PaymentMethod;
  paymentAccountDetails?: string;
  beneficiaryName?: string;
  orgId?: string;
  isPrepaidByRequester?: boolean;
  invoiceNumber?: string;
  invoiceDate?: string;
  invoiceAttachment?: RequestAttachment;
  visaDocumentAttachment?: RequestAttachment;
  installmentTransferAttachment?: RequestAttachment;
  installmentDeviceType?: string;
  installmentDeviceDescription?: string;
  walletTransferAttachment?: RequestAttachment;
  /** Idempotency key for this submission (stable across retries of the same form). */
  idempotencyKey?: string;
}

interface AppContextType {
  // Scoped Data (Strict isolation based on role & org)
  organizations: Organization[];
  allOrganizations: Organization[];
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
  isFirebaseConnected: boolean;
  isFirebaseModalOpen: boolean;
  firebaseError: string | null;
  clearFirebaseError: () => void;

  // Controls
  effectiveOrgId: string;
  setActiveOrgId: (id: string) => void;
  setCurrentRole: (role: Role) => void;
  setActiveTab: (tab: string) => void;
  openFirebaseModal: () => void;
  closeFirebaseModal: () => void;
  forceRefreshUserState: () => Promise<boolean>;
  /** The account is suspended (active: false) in its org; the security rules deny it all org data. */
  isAccountSuspended: boolean;
  /**
   * The signed-in email is a listed super admin, but the security rules do not grant
   * it (email not verified and no super_admins/{uid} record). Data is NOT gone — the
   * database refuses to serve it until the email is verified.
   */
  superAdminNeedsVerification: boolean;
  sendSuperAdminVerificationEmail: () => Promise<{ success: boolean; message: string }>;
  recheckSuperAdminVerification: () => Promise<boolean>;
  /** Data sources the database refused to serve (permission-denied), shown to the user instead of silently empty lists. */
  permissionDeniedSources: string[];

  // Auth & Roles
  superAdminEmails: string[];
  addSuperAdminEmail: (email: string) => Promise<void>;
  removeSuperAdminEmail: (email: string) => Promise<void>;
  updateSuperAdminRole: (email: string, newRole: Role, targetOrgId?: string) => Promise<void>;
  signInWithGoogle: () => Promise<any>;
  loginWithEmail: (email: string, password: string) => Promise<any>;
  resetPassword: (email: string) => Promise<any>;
  logoutUser: () => Promise<void>;
  updateUserProfileInfo: (dataOrDisplayName: string | {
    name: string;
    phone?: string;
    instapay?: string;
    wallet?: string;
    walletProvider?: string;
    bankName?: string;
    iban?: string;
    preferredPaymentMethod?: PaymentMethod;
  }, maybePhone?: string) => Promise<{ success: boolean; error?: string }>;
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
    idempotencyKey?: string;
  }) => Promise<{ success: boolean; message?: string; credentials?: { email: string; password: string } }>;

  // Organizations
  addOrganization: (org: Omit<Organization, 'id' | 'createdAt'>, opts?: MutationOptions) => Promise<{ success: boolean; message?: string; org?: Organization }>;
  updateOrganization: (orgId: string, updates: Partial<Organization>) => Promise<void>;
  deleteOrganization: (orgId: string) => Promise<{ success: boolean; message?: string }>;

  // Members & User Management
  addMember: (member: Omit<OrganizationMember, 'id' | 'joinedAt'>, opts?: MutationOptions) => Promise<void>;
  updateMember: (memberId: string, updates: Partial<OrganizationMember>) => Promise<void>;
  toggleMemberStatus: (memberId: string, active: boolean) => Promise<void>;
  removeMember: (memberId: string) => Promise<void>;
  adminResetUserPassword: (email: string) => Promise<{ success: boolean; message?: string }>;

  // Services
  addService: (service: Omit<ServiceCategory, 'id' | 'spentAmount'>, opts?: MutationOptions) => Promise<void>;
  updateService: (service: ServiceCategory) => Promise<void>;
  deleteService: (serviceId: string) => Promise<void>;

  // Providers
  addProvider: (provider: Omit<ServiceProvider, 'id' | 'totalPaid'>, opts?: MutationOptions) => Promise<void>;
  updateProvider: (provider: ServiceProvider) => Promise<void>;
  deleteProvider: (providerId: string) => Promise<void>;

  createRequest: (data: CreateRequestData) => Promise<ExpenseRequest>;
  updateRequest: (requestId: string, updatedFields: Partial<ExpenseRequest>, opts?: MutationOptions) => Promise<void>;
  approveRequest: (requestId: string, note?: string, opts?: MutationOptions) => Promise<void>;
  rejectRequest: (requestId: string, reason: string, opts?: MutationOptions) => Promise<void>;
  requestClarification: (requestId: string, question: string, opts?: MutationOptions) => Promise<void>;
  replyClarification: (requestId: string, replyText: string, attachmentName?: string, opts?: MutationOptions) => Promise<void>;
  disburseRequest: (
    requestId: string,
    details: Omit<DisbursementDetails, 'disbursedAt' | 'disbursedBy'>,
    opts?: DisburseOptions
  ) => Promise<DisburseOutcome>;

  // Payment Accounts & Vaults
  paymentAccounts: PaymentAccount[];
  allPaymentAccounts: PaymentAccount[];
  transactions: AccountTransaction[];
  allTransactions: AccountTransaction[];
  addPaymentAccount: (account: Omit<PaymentAccount, 'id' | 'createdAt'>, opts?: MutationOptions) => Promise<void>;
  updatePaymentAccount: (accountId: string, updates: Partial<PaymentAccount>) => Promise<void>;
  deletePaymentAccount: (accountId: string) => Promise<void>;
  togglePaymentAccountStatus: (accountId: string, active: boolean) => Promise<void>;
  recordManualAccountAdjustment: (accountId: string, type: TransactionType, amount: number, description: string, opts?: MutationOptions) => Promise<void>;
  resolveParentBankAccount: (account: PaymentAccount | null | undefined) => PaymentAccount | null;

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
    notes?: string,
    opts?: MutationOptions
  ) => Promise<{ success: boolean; message?: string }>;
  settleCustodyItem: (
    custodyId: string,
    amount: number,
    description: string,
    serviceCategoryId?: string,
    vendorName?: string,
    invoiceNumber?: string,
    invoiceDate?: string,
    receiptUrl?: string,
    opts?: MutationOptions
  ) => Promise<{ success: boolean; message?: string }>;
  replenishCustody: (
    custodyId: string,
    amount: number,
    sourceAccountId: string,
    notes?: string,
    opts?: MutationOptions
  ) => Promise<{ success: boolean; message?: string }>;

  // Departments & Structure
  departments: Department[];
  allDepartments: Department[];
  addDepartment: (dept: Omit<Department, 'id' | 'createdAt'>, opts?: MutationOptions) => Promise<void>;
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
    operationId?: string;
  }) => Promise<void>;

  // Email Notifications & Settings
  emailSettings: EmailNotificationSettings;
  updateEmailSettings: (settings: Partial<EmailNotificationSettings>) => Promise<void>;
  emailLogs: EmailLogEntry[];
  sendTestEmail: (recipientEmail: string, templateType?: EmailEventType) => Promise<{ success: boolean; message: string }>;
  clearEmailLogs: () => Promise<void>;

  // Visa Issuance & Expense Management (طلبات وإصدار التأشيرات ومصروفاتها)
  visaRequests: VisaRequest[];
  allVisaRequests: VisaRequest[];
  createVisaRequest: (data: Omit<VisaRequest, 'id' | 'requestNumber' | 'status' | 'paidAmount' | 'remainingBalance' | 'payments' | 'createdAt' | 'updatedAt'>, opts?: MutationOptions) => Promise<VisaRequest>;
  updateVisaRequest: (id: string, updates: Partial<VisaRequest>) => Promise<void>;
  approveVisaRequest: (id: string, approverName?: string) => Promise<void>;
  rejectVisaRequest: (id: string, reason: string, approverName?: string) => Promise<void>;
  addVisaPayment: (visaId: string, payment: Omit<VisaPaymentRecord, 'id' | 'visaRequestId' | 'recordedBy' | 'recordedByName' | 'recordedAt'>, opts?: MutationOptions) => Promise<void>;
  deleteVisaRequest: (id: string) => Promise<void>;

  refreshData: () => Promise<void>;
  resetToSampleData: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

// Auth accounts created during a createCompanyUser intent, keyed by idempotency key,
// so retrying the same intent after a partial failure re-uses the account instead of
// failing with "email already in use" (kept in memory only; never persisted).
const provisionedAccounts = new Map<string, { uid: string; email: string; password: string }>();

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Raw states: populated ONLY by real-time Firestore listeners (one per collection).
  const [rawOrganizations, setRawOrganizations] = useState<Organization[]>([]);
  const [rawMembers, setRawMembers] = useState<OrganizationMember[]>([]);
  const [myMemberships, setMyMemberships] = useState<OrganizationMember[]>([]);
  const [rawServices, setRawServices] = useState<ServiceCategory[]>([]);
  const [rawProviders, setRawProviders] = useState<ServiceProvider[]>([]);
  const [rawRequests, setRawRequests] = useState<ExpenseRequest[]>([]);
  const [rawVisaRequests, setRawVisaRequests] = useState<VisaRequest[]>([]);
  const [rawAuditLogs, setRawAuditLogs] = useState<AuditLogEntry[]>([]);
  const [rawPaymentAccounts, setRawPaymentAccounts] = useState<PaymentAccount[]>([]);
  const [rawTransactions, setRawTransactions] = useState<AccountTransaction[]>([]);
  const [rawCustodies, setRawCustodies] = useState<PettyCashCustody[]>([]);
  const [rawCustodySettlements, setRawCustodySettlements] = useState<CustodySettlementItem[]>([]);
  const [rawDepartments, setRawDepartments] = useState<Department[]>([]);
  const [outboxEvents, setOutboxEvents] = useState<OutboxEvent[]>([]);
  const [legacyEmailLogs, setLegacyEmailLogs] = useState<EmailLogEntry[]>([]);
  const [emailLogsClearedAt, setEmailLogsClearedAt] = useState<string>('');
  const [emailSettings, setEmailSettings] = useState<EmailNotificationSettings>(DEFAULT_EMAIL_SETTINGS);
  // system_settings/notification_recipients: platform super admins notified about every org
  // (emails: null while the document does not exist yet).
  const [platformRecipients, setPlatformRecipients] = useState<{ loaded: boolean; emails: string[] | null }>({ loaded: false, emails: null });
  // Scope of the last complete members snapshot ('*' = all orgs), for the recipients backfill.
  const [membersSnapshotScope, setMembersSnapshotScope] = useState('');

  const [activeOrgId, setActiveOrgIdState] = useState<string>(() => {
    const saved = readPref(PREF_KEYS.ACTIVE_ORG);
    return saved === 'org-ofq' || saved === 'org-rwd' ? '' : saved;
  });
  const [activeTab, setActiveTabState] = useState<string>(() => readPref(PREF_KEYS.ACTIVE_TAB, 'dashboard'));

  const [authLoading, setAuthLoading] = useState(true);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [userDocLoaded, setUserDocLoaded] = useState(false);
  const [membershipsLoaded, setMembershipsLoaded] = useState(false);
  const [orgsLoaded, setOrgsLoaded] = useState(false);

  const [isFirebaseConnected, setIsFirebaseConnected] = useState(false);
  const [isFirebaseModalOpen, setIsFirebaseModalOpen] = useState(false);
  const [firebaseError, setFirebaseError] = useState<string | null>(null);
  const [firebaseSyncCounter, setFirebaseSyncCounter] = useState(0);
  // Mirrors what the security rules can see about super-admin status.
  const [emailVerified, setEmailVerified] = useState(false);
  const [hasUidSuperAdminRecord, setHasUidSuperAdminRecord] = useState(false);
  const [permissionDeniedSources, setPermissionDeniedSources] = useState<string[]>([]);

  const clearFirebaseError = () => setFirebaseError(null);
  const openFirebaseModal = () => setIsFirebaseModalOpen(true);
  const closeFirebaseModal = () => {
    setIsFirebaseModalOpen(false);
    setFirebaseSyncCounter(prev => prev + 1);
  };

  const setActiveOrgId = (id: string) => {
    setActiveOrgIdState(id);
    writePref(PREF_KEYS.ACTIVE_ORG, id);
  };

  const setActiveTab = (tab: string) => {
    setActiveTabState(tab);
    writePref(PREF_KEYS.ACTIVE_TAB, tab);
  };

  // Subscribe to Firebase Authentication state
  useEffect(() => {
    const unsubscribe = subscribeToAuth(user => {
      setFirebaseUser(user);
      setEmailVerified(Boolean(user?.emailVerified));
      setAuthLoading(false);
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const [superAdminEmails, setSuperAdminEmails] = useState<string[]>(() =>
    Array.from(new Set([...DEFAULT_SUPER_ADMINS]))
  );

  const [userDocProfile, setUserDocProfile] = useState<{
    id?: string;
    email?: string;
    name?: string;
    role?: Role;
    orgId?: string;
    active?: boolean;
    department?: string;
    phone?: string;
    payoutProfile?: any;
    instapay?: string;
    wallet?: string;
    walletProvider?: string;
    bankName?: string;
    iban?: string;
    preferredPaymentMethod?: PaymentMethod;
  } | null>(null);

  // Canonical identity = Firebase UID. Email is only a secondary lookup for members
  // an admin provisioned before the user's first sign-in. ONE listener (an OR query)
  // feeds `myMemberships`; if the OR query is rejected we fall back to per-query
  // slots whose union is derived (never merged into another listener's state).
  const buildMembershipQueries = (db: ReturnType<typeof getDb>, user: FirebaseUser) => {
    const members = collection(db!, 'members');
    const email = user.email || '';
    return {
      combined: email
        ? query(members, or(where('userId', '==', user.uid), where('userEmail', '==', email)))
        : query(members, where('userId', '==', user.uid)),
      fallbacks: [
        query(members, where('userId', '==', user.uid)),
        ...(email ? [query(members, where('userEmail', '==', email))] : []),
        ...(email && normalizeEmail(email) !== email ? [query(members, where('userEmail', '==', normalizeEmail(email)))] : []),
      ],
    };
  };

  const toMembers = (docs: Array<{ id: string; data: () => DocumentData }>) =>
    docs.map(d => ({ ...d.data(), id: d.id } as OrganizationMember)).filter(m => !DUMMY_IDS.has(m.id));

  // Manual status check ("check my access now") — a one-shot read, no writes except the
  // user's own profile document.
  const forceRefreshUserState = useCallback(async (): Promise<boolean> => {
    if (!firebaseUser) return false;
    const { db } = initFirebase();
    if (!db) return false;

    try {
      let profileData: any = null;
      try {
        const userDocSnap = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDocSnap.exists()) {
          profileData = userDocSnap.data();
          setUserDocProfile(profileData);
        }
      } catch (e) {
        console.warn('[forceRefresh] user doc check:', e);
      }

      const { combined, fallbacks } = buildMembershipQueries(db, firebaseUser);
      let found: OrganizationMember[] = [];
      try {
        found = toMembers((await getDocs(combined)).docs);
      } catch {
        const results = await Promise.allSettled(fallbacks.map(q => getDocs(q)));
        found = uniqueById(results.flatMap(r => (r.status === 'fulfilled' ? toMembers(r.value.docs) : [])));
      }
      setMyMemberships(found);
      setMembershipsLoaded(true);

      // Link the user's own profile to the membership an admin created for them. The
      // security rules accept a self-written role/orgId only when it matches the
      // membership named in memberId, so all three come from the same record.
      const link = profileData?.orgId
        ? null
        : pickMembershipToLink(found, { uid: firebaseUser.uid, email: firebaseUser.email, emailVerified: firebaseUser.emailVerified });
      const resolvedOrg = profileData?.orgId || link?.orgId || '';
      if (!resolvedOrg) return false;

      if (link) {
        try {
          await setDoc(
            doc(db, 'users', firebaseUser.uid),
            sanitizeForFirestore({
              id: firebaseUser.uid,
              // Only a verified address may be written to one's own profile.
              ...(firebaseUser.emailVerified ? { email: normalizeEmail(firebaseUser.email) } : {}),
              name: link.userName || firebaseUser.displayName || 'موظف',
              role: link.role,
              orgId: link.orgId,
              memberId: link.id,
              department: link.department || '',
              phone: link.phone || '',
              active: true,
              updatedAt: new Date().toISOString(),
            }),
            { merge: true }
          );
        } catch (err: any) {
          console.warn('[forceRefresh] profile link rejected:', err?.message || err);
          return false;
        }
      }
      setActiveOrgId(resolvedOrg);
      setFirebaseSyncCounter(prev => prev + 1);
      return true;
    } catch (err) {
      console.error('[forceRefreshUserState] Unexpected error:', err);
      return false;
    }
  }, [firebaseUser]);

  // Identity listeners: super admins, own profile doc, own memberships, shared settings.
  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    const { db } = initFirebase();
    if (!db || !firebaseUser) {
      setUserDocProfile(null);
      setHasUidSuperAdminRecord(false);
      setMyMemberships([]);
      setUserDocLoaded(false);
      setMembershipsLoaded(false);
      return;
    }

    const unsubs: Array<() => void> = [];

    // UID-keyed super-admin record: the rules honour it even without a verified email.
    unsubs.push(onSnapshot(doc(db, 'super_admins', firebaseUser.uid), snap => {
      setHasUidSuperAdminRecord(snap.exists());
    }, err => {
      console.warn('[Firebase] Own super-admin record:', err?.message || err);
      setHasUidSuperAdminRecord(false);
    }));

    unsubs.push(onSnapshot(collection(db, 'super_admins'), snapshot => {
      const dbAdmins = snapshot.docs.map(d => (d.data().email || d.id || '').toLowerCase().trim()).filter(Boolean);
      setSuperAdminEmails(Array.from(new Set([...DEFAULT_SUPER_ADMINS, ...dbAdmins])));
    }, err => console.warn('[Firebase] Super admins listener:', err?.message || err)));

    unsubs.push(onSnapshot(doc(db, 'users', firebaseUser.uid), docSnap => {
      setUserDocProfile(docSnap.exists() ? (docSnap.data() as any) : null);
      setUserDocLoaded(true);
    }, err => {
      console.warn('[Firebase] User profile listener:', err?.message || err);
      setUserDocLoaded(true);
    }));

    const { combined, fallbacks } = buildMembershipQueries(db, firebaseUser);
    let fallbackUnsubs: Array<() => void> = [];
    const startFallback = () => {
      const slots = new Map<number, OrganizationMember[]>();
      fallbackUnsubs = fallbacks.map((q, i) =>
        onSnapshot(q, snap => {
          slots.set(i, toMembers(snap.docs));
          setMyMemberships(uniqueById(Array.from(slots.values()).flat()));
          setMembershipsLoaded(true);
        }, err => {
          console.warn('[Firebase] Membership listener:', err?.message || err);
          slots.set(i, []);
          setMembershipsLoaded(true);
        })
      );
    };
    const unsubCombined = onSnapshot(combined, snap => {
      setMyMemberships(toMembers(snap.docs));
      setMembershipsLoaded(true);
    }, err => {
      console.warn('[Firebase] Combined membership query rejected, using fallback:', err?.message || err);
      startFallback();
    });
    unsubs.push(() => {
      unsubCombined();
      fallbackUnsubs.forEach(u => u());
    });

    unsubs.push(onSnapshot(doc(db, 'system_settings', 'email_notifications'), snap => {
      if (snap.exists()) {
        setEmailSettings({ ...DEFAULT_EMAIL_SETTINGS, ...(snap.data() as Partial<EmailNotificationSettings>) });
      } else {
        setEmailSettings(DEFAULT_EMAIL_SETTINGS);
      }
    }, err => console.warn('[Firebase] Email settings listener:', err?.message || err)));

    unsubs.push(onSnapshot(doc(db, 'system_settings', 'notification_recipients'), snap => {
      const emails = snap.exists() ? snap.data().emails : null;
      setPlatformRecipients({ loaded: true, emails: Array.isArray(emails) ? emails : snap.exists() ? [] : null });
    }, err => console.warn('[Firebase] Notification recipients listener:', err?.message || err)));

    return () => unsubs.forEach(u => {
      try { u(); } catch {}
    });
  }, [firebaseUser]);

  // =========================================================================
  // RBAC & ROLE RESOLUTION
  // =========================================================================
  const userEmail = firebaseUser?.email?.toLowerCase().trim() || '';

  const userMemberRecord = useMemo(() => {
    if (!firebaseUser) return null;
    const matching = myMemberships.filter(m =>
      m.userId === firebaseUser.uid || (Boolean(userEmail) && normalizeEmail(m.userEmail) === userEmail)
    );
    if (matching.length === 0) return null;
    const rolePriority: Record<string, number> = { super_admin: 5, org_admin: 4, finance: 3, data_entry: 2, employee: 1 };
    const withOrg = matching.filter(m => Boolean(m.orgId && m.orgId.trim()));
    const pool = withOrg.length > 0 ? withOrg : matching;
    return [...pool].sort((a, b) => (rolePriority[b.role] || 0) - (rolePriority[a.role] || 0))[0];
  }, [firebaseUser, userEmail, myMemberships]);

  // The email is on the super-admin list (built-in, env or super_admins collection).
  const isListedSuperAdmin = useMemo(() => {
    if (!userEmail) return false;
    return superAdminEmails.some(e => e.trim().toLowerCase() === userEmail);
  }, [userEmail, superAdminEmails]);

  // Super admin exactly as firestore.rules sees it: a super_admins/{uid} record, or a
  // listed email that Firebase has VERIFIED. Treating an unverified listed email as
  // super admin made the UI subscribe to every company while the database refused
  // all of it — every list came back empty and the data looked deleted.
  const isSuperAdmin = hasUidSuperAdminRecord || (isListedSuperAdmin && emailVerified);
  const superAdminNeedsVerification = Boolean(firebaseUser) && isListedSuperAdmin && !isSuperAdmin;

  // Suspended accounts (active: false) get no org data under firestore.rules; the UI
  // says so instead of showing an empty or "awaiting assignment" screen.
  const isAccountSuspended = useMemo(() => {
    if (!firebaseUser || isSuperAdmin) return false;
    if (userDocProfile?.orgId) return userDocProfile.active === false;
    return myMemberships.length > 0 && myMemberships.every(m => m.active === false);
  }, [firebaseUser, isSuperAdmin, userDocProfile, myMemberships]);

  const resolvedRole: Role = useMemo(() => {
    if (isSuperAdmin) return 'super_admin';
    if (userDocProfile?.role && userDocProfile.role !== 'super_admin') return userDocProfile.role;
    if (userMemberRecord && userMemberRecord.role !== 'super_admin') return userMemberRecord.role;
    return 'employee';
  }, [isSuperAdmin, userDocProfile, userMemberRecord]);

  const effectiveOrgId = useMemo(() => {
    if (isSuperAdmin) {
      return activeOrgId || (rawOrganizations[0]?.id || '');
    }
    if (userDocProfile?.orgId) return userDocProfile.orgId;
    if (userMemberRecord?.orgId) return userMemberRecord.orgId;
    // A remembered org is only honoured if the user actually belongs to it.
    if (activeOrgId && myMemberships.some(m => m.orgId === activeOrgId)) return activeOrgId;
    return '';
  }, [isSuperAdmin, activeOrgId, userDocProfile, userMemberRecord, myMemberships, rawOrganizations]);

  useEffect(() => {
    if (!isSuperAdmin && effectiveOrgId && effectiveOrgId !== activeOrgId) {
      setActiveOrgId(effectiveOrgId);
    } else if (isSuperAdmin && !activeOrgId && rawOrganizations.length > 0) {
      setActiveOrgId(rawOrganizations[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, effectiveOrgId, activeOrgId, rawOrganizations]);

  const currentUser: User = useMemo(() => {
    if (!firebaseUser) {
      return { id: 'guest', name: 'زائر غير مسجل', email: '', role: 'employee' };
    }
    const defaultAdminName = userEmail === 'mahmoud@tieapps.com' ? 'محمود' : userEmail.split('@')[0];

    return {
      id: firebaseUser.uid,
      name: userDocProfile?.name || userMemberRecord?.userName || firebaseUser.displayName || defaultAdminName || 'مستخدم',
      email: firebaseUser.email || userDocProfile?.email || userMemberRecord?.userEmail || '',
      role: resolvedRole,
      avatar: firebaseUser.photoURL || undefined,
      phone: userDocProfile?.phone || userMemberRecord?.phone || firebaseUser.phoneNumber || '',
      orgId: effectiveOrgId,
      instapay: userDocProfile?.instapay || userMemberRecord?.instapay || '',
      wallet: userDocProfile?.wallet || userMemberRecord?.wallet || '',
      walletProvider: userDocProfile?.walletProvider || userMemberRecord?.walletProvider || '',
      bankName: userDocProfile?.bankName || userMemberRecord?.bankName || '',
      iban: userDocProfile?.iban || userMemberRecord?.iban || '',
      preferredPaymentMethod: userDocProfile?.preferredPaymentMethod || userMemberRecord?.preferredPaymentMethod || 'instapay',
    };
  }, [firebaseUser, userDocProfile, userMemberRecord, userEmail, resolvedRole, effectiveOrgId]);

  // Adjust active tab on role switch (e.g. employee defaults to my-requests / tracker)
  useEffect(() => {
    if (!firebaseUser) return;
    if (resolvedRole === 'employee') {
      if (['dashboard', 'services', 'providers', 'organizations', 'settings'].includes(activeTab)) setActiveTab('my-requests');
    } else if (resolvedRole === 'data_entry') {
      if (['dashboard', 'requests', 'settings'].includes(activeTab)) setActiveTab('providers');
    } else if (resolvedRole === 'finance') {
      if (['organizations', 'settings'].includes(activeTab)) setActiveTab('treasury');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const activeOrg = useMemo(() => rawOrganizations.find(o => o.id === effectiveOrgId), [rawOrganizations, effectiveOrgId]);

  const scopedMembers = useMemo(() => {
    if (!firebaseUser) return [];
    if (resolvedRole === 'super_admin') {
      return effectiveOrgId === 'all' ? rawMembers : rawMembers.filter(m => m.orgId === effectiveOrgId);
    }
    if (!effectiveOrgId) return [];
    if (resolvedRole === 'org_admin' || resolvedRole === 'finance') {
      return rawMembers.filter(m => m.orgId === effectiveOrgId);
    }
    return uniqueById([...rawMembers, ...myMemberships]).filter(m =>
      m.orgId === effectiveOrgId &&
      (m.userId === firebaseUser.uid || (Boolean(m.userEmail && userEmail) && normalizeEmail(m.userEmail) === userEmail))
    );
  }, [firebaseUser, resolvedRole, rawMembers, myMemberships, effectiveOrgId, userEmail]);

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

  // STRICT REQUEST SCOPING (employees only ever see their own requests)
  const scopedRequests = useMemo(() => {
    if (!firebaseUser) return [];
    const myUid = firebaseUser.uid;
    if (resolvedRole === 'super_admin') {
      return effectiveOrgId && effectiveOrgId !== 'all'
        ? rawRequests.filter(r => r.orgId === effectiveOrgId || !r.orgId)
        : rawRequests;
    }
    if (resolvedRole === 'org_admin' || resolvedRole === 'finance') {
      return rawRequests.filter(r => r.orgId === effectiveOrgId);
    }
    return rawRequests.filter(r =>
      r.requesterId === myUid || (Boolean(r.requesterEmail && userEmail) && normalizeEmail(r.requesterEmail) === userEmail)
    );
  }, [firebaseUser, resolvedRole, rawRequests, effectiveOrgId, userEmail]);

  const scopedVisaRequests = useMemo(() => {
    if (!firebaseUser) return [];
    let list: VisaRequest[];
    if (resolvedRole === 'super_admin') {
      list = effectiveOrgId && effectiveOrgId !== 'all' ? rawVisaRequests.filter(r => r.orgId === effectiveOrgId || !r.orgId) : rawVisaRequests;
    } else if (resolvedRole === 'org_admin' || resolvedRole === 'finance') {
      list = rawVisaRequests.filter(r => r.orgId === effectiveOrgId);
    } else {
      list = rawVisaRequests.filter(r =>
        r.requesterId === firebaseUser.uid || (Boolean(r.requesterEmail && userEmail) && normalizeEmail(r.requesterEmail) === userEmail)
      );
    }
    return [...list].sort(byCreatedDesc);
  }, [firebaseUser, resolvedRole, rawVisaRequests, effectiveOrgId, userEmail]);

  const scopedPaymentAccounts = useMemo(() => {
    if (!firebaseUser) return [];
    if (resolvedRole === 'super_admin') {
      return effectiveOrgId === 'all' ? rawPaymentAccounts : rawPaymentAccounts.filter(a => a.orgId === effectiveOrgId);
    }
    if (!effectiveOrgId) return [];
    return rawPaymentAccounts.filter(a => a.orgId === effectiveOrgId);
  }, [firebaseUser, resolvedRole, rawPaymentAccounts, effectiveOrgId]);

  // NOTE: no "de-duplication by reference number" here any more. Two ledger entries
  // with the same reference (e.g. a custody issued and later replenished) are both
  // real money movements; hiding (or worse, deleting) one breaks reconciliation.
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
    if (resolvedRole === 'employee') {
      return rawCustodies.filter(c => c.orgId === effectiveOrgId && c.employeeId === currentUser.id);
    }
    return rawCustodies.filter(c => c.orgId === effectiveOrgId);
  }, [firebaseUser, resolvedRole, rawCustodies, effectiveOrgId, currentUser.id]);

  const scopedCustodySettlements = useMemo(() => {
    if (!firebaseUser) return [];
    if (resolvedRole === 'super_admin') {
      return effectiveOrgId === 'all' ? rawCustodySettlements : rawCustodySettlements.filter(s => s.orgId === effectiveOrgId);
    }
    if (!effectiveOrgId) return [];
    if (resolvedRole === 'employee') {
      return rawCustodySettlements.filter(s => s.orgId === effectiveOrgId && s.employeeId === currentUser.id);
    }
    return rawCustodySettlements.filter(s => s.orgId === effectiveOrgId);
  }, [firebaseUser, resolvedRole, rawCustodySettlements, effectiveOrgId, currentUser.id]);

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
      return effectiveOrgId && effectiveOrgId !== 'all'
        ? rawAuditLogs.filter(l => l.orgId === effectiveOrgId || !l.orgId)
        : rawAuditLogs;
    }
    if (!effectiveOrgId) return [];
    return rawAuditLogs.filter(l => l.orgId === effectiveOrgId);
  }, [firebaseUser, resolvedRole, rawAuditLogs, effectiveOrgId]);

  const emailLogs = useMemo(() => {
    const merged = [...outboxToEmailLogs(outboxEvents), ...legacyEmailLogs];
    merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return emailLogsClearedAt ? merged.filter(l => l.timestamp > emailLogsClearedAt) : merged;
  }, [outboxEvents, legacyEmailLogs, emailLogsClearedAt]);

  const users: User[] = useMemo(() => {
    if (!firebaseUser) return [];
    const list: User[] = [currentUser];
    scopedMembers.forEach(m => {
      if (m.userId !== currentUser.id) {
        list.push({ id: m.userId, name: m.userName, email: m.userEmail, role: m.role, phone: m.phone, orgId: m.orgId });
      }
    });
    return list;
  }, [firebaseUser, currentUser, scopedMembers]);

  // =========================================================================
  // Real-Time Firestore Listeners — exactly ONE canonical listener per collection,
  // each REPLACING its slice of state (no merging between listeners, no writes).
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
    if (!firebaseUser) return;

    setIsFirebaseConnected(true);
    setFirebaseError(null);
    setPermissionDeniedSources([]);
    // Legacy one-time cleanup (idempotent deletes of known demo ids); only super admins may delete.
    if (isSuperAdmin) purgeSampleDataFromFirestore().catch(() => {});

    const unsubs: Array<() => void> = [];
    const isOrgStaff = resolvedRole === 'org_admin' || resolvedRole === 'finance';

    const handleListenerError = (name: string) => (err: any) => {
      console.warn(`[Firebase] ${name} listener:`, err?.message || err);
      if (err?.code === 'permission-denied') {
        // Never let a refused read look like "no data": tell the user what was refused.
        const label = LISTENER_LABELS[name] || name;
        setPermissionDeniedSources(prev => (prev.includes(label) ? prev : [...prev, label]));
      }
      if (err?.code === 'unavailable') {
        setIsFirebaseConnected(false);
        setFirebaseError('تعذر الاتصال بقاعدة البيانات. يرجى التحقق من اتصال الإنترنت.');
      }
    };

    const listen = <T extends { id: string },>(
      name: string,
      q: Query<DocumentData> | null,
      apply: (items: T[]) => void,
      filter: (item: T) => boolean = () => true,
    ) => {
      if (!q) {
        apply([]);
        return;
      }
      unsubs.push(onSnapshot(q, snapshot => {
        setIsFirebaseConnected(true);
        const items = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as unknown as T)).filter(filter);
        apply(items);
      }, handleListenerError(name)));
    };

    const orgScoped = (col: string) =>
      isSuperAdmin
        ? collection(db, col)
        : effectiveOrgId
        ? query(collection(db, col), where('orgId', '==', effectiveOrgId))
        : null;
    const financeScoped = (col: string) =>
      isSuperAdmin
        ? collection(db, col)
        : isOrgStaff && effectiveOrgId
        ? query(collection(db, col), where('orgId', '==', effectiveOrgId))
        : null;
    const notDummy = (x: any) => !DUMMY_IDS.has(x.id) && !DUMMY_IDS.has(x.orgId);

    // 1. Organizations
    if (isSuperAdmin || effectiveOrgId) setOrgsLoaded(false);
    if (isSuperAdmin) {
      listen<Organization>('Organizations', collection(db, 'organizations'), list => {
        setRawOrganizations(list);
        setOrgsLoaded(true);
      }, notDummy);
    } else if (effectiveOrgId) {
      unsubs.push(onSnapshot(doc(db, 'organizations', effectiveOrgId), docSnap => {
        setIsFirebaseConnected(true);
        setRawOrganizations(docSnap.exists() ? [{ ...docSnap.data(), id: docSnap.id } as Organization] : []);
        setOrgsLoaded(true);
      }, err => {
        handleListenerError('Organization')(err);
        setOrgsLoaded(true);
      }));
    } else {
      setRawOrganizations([]);
      setOrgsLoaded(true);
    }

    // 2. Directory
    setMembersSnapshotScope('');
    const membersScope = isSuperAdmin ? '*' : effectiveOrgId;
    listen<OrganizationMember>('Members', orgScoped('members'), list => {
      setRawMembers(list);
      setMembersSnapshotScope(membersScope);
    }, notDummy);
    listen<ServiceCategory>('Services', orgScoped('services'), setRawServices, notDummy);
    listen<ServiceProvider>('Providers', orgScoped('providers'), setRawProviders, notDummy);
    listen<Department>('Departments', orgScoped('departments'), setRawDepartments, notDummy);

    // 3. Requests (employees: ONE disjunctive query on uid OR email, with fallback)
    const setRequestsSorted = (list: ExpenseRequest[]) => setRawRequests([...list].sort(byCreatedDesc));
    if (isSuperAdmin || isOrgStaff) {
      listen<ExpenseRequest>('Requests', isSuperAdmin ? collection(db, 'requests') : effectiveOrgId ? query(collection(db, 'requests'), where('orgId', '==', effectiveOrgId)) : null, setRequestsSorted, notDummy);
    } else {
      const reqCol = collection(db, 'requests');
      const email = firebaseUser.email || '';
      const combined = email
        ? query(reqCol, or(where('requesterId', '==', firebaseUser.uid), where('requesterEmail', '==', email)))
        : query(reqCol, where('requesterId', '==', firebaseUser.uid));
      let fallbackUnsubs: Array<() => void> = [];
      const unsubCombined = onSnapshot(combined, snap => {
        setRequestsSorted(snap.docs.map(d => ({ ...d.data(), id: d.id } as ExpenseRequest)).filter(notDummy));
      }, err => {
        console.warn('[Firebase] Combined requests query rejected, using fallback:', err?.message || err);
        const slots = new Map<number, ExpenseRequest[]>();
        const qs = [query(reqCol, where('requesterId', '==', firebaseUser.uid)), ...(email ? [query(reqCol, where('requesterEmail', '==', email))] : [])];
        fallbackUnsubs = qs.map((q, i) => onSnapshot(q, snap => {
          slots.set(i, snap.docs.map(d => ({ ...d.data(), id: d.id } as ExpenseRequest)).filter(notDummy));
          setRequestsSorted(uniqueById(Array.from(slots.values()).flat()));
        }, handleListenerError('Requests (fallback)')));
      });
      unsubs.push(() => {
        unsubCombined();
        fallbackUnsubs.forEach(u => u());
      });
    }

    // 4. Visa requests
    listen<VisaRequest>(
      'Visa Requests',
      isSuperAdmin
        ? collection(db, 'visaRequests')
        : isOrgStaff && effectiveOrgId
        ? query(collection(db, 'visaRequests'), where('orgId', '==', effectiveOrgId))
        : query(collection(db, 'visaRequests'), where('requesterId', '==', firebaseUser.uid)),
      setRawVisaRequests,
      notDummy,
    );

    // 5. Treasury (finance & org admins only)
    listen<PaymentAccount>('Payment Accounts', financeScoped('paymentAccounts'), setRawPaymentAccounts, notDummy);
    listen<AccountTransaction>('Account Transactions', financeScoped('accountTransactions'), list => setRawTransactions([...list].sort(byCreatedDesc)), notDummy);

    // 6. Custodies & settlements (employees: their own only)
    const employeeScoped = (col: string) =>
      isSuperAdmin || isOrgStaff ? financeScoped(col) : query(collection(db, col), where('employeeId', '==', firebaseUser.uid));
    listen<PettyCashCustody>('Custodies', employeeScoped('custodies'), list =>
      setRawCustodies([...list].sort((a, b) => new Date(b.createdAt || b.issuedAt).getTime() - new Date(a.createdAt || a.issuedAt).getTime())), notDummy);
    listen<CustodySettlementItem>('Custody Settlements', employeeScoped('custodySettlements'), list => setRawCustodySettlements([...list].sort(byCreatedDesc)), notDummy);

    // 7. Audit logs
    listen<AuditLogEntry>(
      'Audit Logs',
      isSuperAdmin ? collection(db, 'auditLogs') : resolvedRole === 'org_admin' && effectiveOrgId ? query(collection(db, 'auditLogs'), where('orgId', '==', effectiveOrgId)) : null,
      list => setRawAuditLogs([...list].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())),
    );

    // 8. Notification outbox (doubles as the email log) + legacy email logs
    listen<OutboxEvent>(
      'Outbox',
      isSuperAdmin
        ? query(collection(db, 'outbox'), orderBy('createdAt', 'desc'), limit(150))
        : resolvedRole === 'org_admin' && effectiveOrgId
        ? query(collection(db, 'outbox'), where('orgId', '==', effectiveOrgId))
        : null,
      setOutboxEvents,
    );
    listen<EmailLogEntry>('Email Logs', isSuperAdmin ? collection(db, 'email_logs') : null, setLegacyEmailLogs);

    return () => unsubs.forEach(u => {
      try { u(); } catch {}
    });
  }, [firebaseUser, isSuperAdmin, resolvedRole, effectiveOrgId, firebaseSyncCounter]);

  // Clear everything on sign-out so the next user of this browser never sees stale data.
  useEffect(() => {
    if (firebaseUser) return;
    setRawOrganizations([]);
    setRawMembers([]);
    setMyMemberships([]);
    setRawServices([]);
    setRawProviders([]);
    setRawRequests([]);
    setRawVisaRequests([]);
    setRawAuditLogs([]);
    setRawPaymentAccounts([]);
    setRawTransactions([]);
    setRawCustodies([]);
    setRawCustodySettlements([]);
    setRawDepartments([]);
    setOutboxEvents([]);
    setLegacyEmailLogs([]);
    setOrgsLoaded(false);
  }, [firebaseUser]);

  const loading = Boolean(
    firebaseUser && isFirebaseConfigured() && (!userDocLoaded || !membershipsLoaded || ((isSuperAdmin || Boolean(effectiveOrgId)) && !orgsLoaded))
  );

  // =========================================================================
  // MUTATION PLUMBING
  // =========================================================================
  const storeRef = useRef<{ db: unknown; store: DataStore } | null>(null);
  const getStore = (): DataStore => {
    const db = getDb();
    if (!db) {
      throw new DomainError('offline', 'قاعدة البيانات السحابية غير متصلة. لا يمكن حفظ أي عملية بدون اتصال بقاعدة البيانات.');
    }
    if (!storeRef.current || storeRef.current.db !== db) {
      storeRef.current = { db, store: createFirestoreStore(db) };
    }
    return storeRef.current.store;
  };

  const actor: Actor = { id: currentUser.id, name: currentUser.name, email: currentUser.email, role: resolvedRole };

  /**
   * Every write goes through here:
   *  - requires an authenticated user and a live database (no silent local-only "success"),
   *  - concurrent identical calls collapse into one (single-flight),
   *  - errors are translated and RE-THROWN so the UI never shows success on failure.
   */
  const mutate = <T,>(name: string, flightKey: string, fn: (store: DataStore) => Promise<T>): Promise<T> =>
    singleFlight(`${name}:${flightKey}`, async () => {
      if (!firebaseUser) throw new DomainError('unauthenticated', 'يجب تسجيل الدخول أولاً.');
      try {
        return await fn(getStore());
      } catch (err) {
        throw toUserError(err);
      }
    });

  const fingerprint = (...parts: unknown[]) => {
    try {
      return JSON.stringify(parts);
    } catch {
      return newOperationKey();
    }
  };

  const outboxDispatchRef = useRef<{ store: DataStore; transport: ReturnType<typeof createNotificationTransport> } | null>(null);
  const getDispatcher = () => {
    const store = getStore();
    if (!outboxDispatchRef.current || outboxDispatchRef.current.store !== store) {
      outboxDispatchRef.current = { store, transport: createNotificationTransport(store, async () => (await auth.currentUser?.getIdToken()) ?? null) };
    }
    return outboxDispatchRef.current;
  };

  /** Fire-and-forget delivery; failures stay in the outbox and are retried by the worker. */
  const dispatchEvents = (eventIds: string[]) => {
    if (!eventIds.length) return;
    try {
      const { store, transport } = getDispatcher();
      eventIds.forEach(id => {
        dispatchOutboxEvent(store, id, transport).catch(err => console.warn('[Outbox] dispatch deferred:', id, err?.message || err));
      });
    } catch (err) {
      console.warn('[Outbox] dispatcher unavailable:', err);
    }
  };

  // Outbox worker: retries pending/failed deliveries with backoff. Any number of admin
  // tabs may run it; the transactional claim guarantees one delivery per event.
  const workerBusyRef = useRef(false);
  useEffect(() => {
    if (!firebaseUser || !(isSuperAdmin || resolvedRole === 'org_admin' || resolvedRole === 'finance')) return;
    const { db } = initFirebase();
    if (!db) return;
    const scopeOrg = isSuperAdmin ? '' : effectiveOrgId;
    if (!isSuperAdmin && !scopeOrg) return;

    const tick = async () => {
      if (workerBusyRef.current) return;
      workerBusyRef.current = true;
      try {
        const filters = [where('status', 'in', ['pending', 'failed', 'sending'])];
        if (scopeOrg) filters.push(where('orgId', '==', scopeOrg));
        const snap = await getDocs(query(collection(db, 'outbox'), ...filters, limit(20)));
        const now = new Date();
        const due = snap.docs.map(d => ({ ...d.data(), id: d.id } as OutboxEvent)).filter(ev => isDue(ev, now));
        if (due.length === 0) return;
        const { store, transport } = getDispatcher();
        for (const ev of due) {
          await dispatchOutboxEvent(store, ev.id, transport).catch(() => undefined);
        }
      } catch (err: any) {
        console.warn('[Outbox worker]', err?.message || err);
      } finally {
        workerBusyRef.current = false;
      }
    };
    const first = setTimeout(tick, 5_000);
    const interval = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, isSuperAdmin, resolvedRole, effectiveOrgId]);

  // One-time initialization of the notification recipient lists firestore.rules checks
  // outbox events against, for orgs / platforms that predate them. Only a MISSING list
  // is filled, and only from a complete members snapshot, so this never overwrites the
  // list the membership operations maintain.
  const orgRecipientsBackfillRef = useRef(new Set<string>());
  useEffect(() => {
    if (!firebaseUser || !(isSuperAdmin || resolvedRole === 'org_admin')) return;
    if (!membersSnapshotScope || membersSnapshotScope !== (isSuperAdmin ? '*' : effectiveOrgId)) return;
    for (const org of rawOrganizations) {
      if (Array.isArray(org.notificationRecipients) || orgRecipientsBackfillRef.current.has(org.id)) continue;
      if (!isSuperAdmin && org.id !== effectiveOrgId) continue;
      orgRecipientsBackfillRef.current.add(org.id);
      ensureOrgNotificationRecipients(getStore(), actor, org.id, rawMembers).catch(err => {
        orgRecipientsBackfillRef.current.delete(org.id);
        console.warn('[notifications] org recipients not initialized:', org.id, err?.message || err);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, isSuperAdmin, resolvedRole, effectiveOrgId, membersSnapshotScope, rawOrganizations, rawMembers]);

  // The platform recipient list must equal the CURRENT super admins (built-in + super_admins
  // collection). It is created when missing and also corrected once per session when it
  // still contains removed admins, so a revoked admin stops receiving every org's
  // notifications. Idempotent: writes only when the stored list differs.
  const platformRecipientsBackfillRef = useRef(false);
  useEffect(() => {
    if (!isSuperAdmin || !platformRecipients.loaded || platformRecipientsBackfillRef.current) return;
    const db = getDb();
    if (!db) return;
    platformRecipientsBackfillRef.current = true;
    (async () => {
      const snap = await getDocs(collection(db, 'super_admins'));
      const emails = Array.from(new Set(
        [...DEFAULT_SUPER_ADMINS, ...snap.docs.map(d => String(d.data().email || d.id))].map(normalizeEmail)
      )).filter(e => e.includes('@')).sort();
      const sameList = (stored: unknown) =>
        Array.isArray(stored) &&
        stored.length === emails.length &&
        [...stored].map(e => normalizeEmail(String(e))).sort().every((e, i) => e === emails[i]);
      await getStore().runTransaction(async tx => {
        const current = await tx.get<{ emails?: string[] }>('system_settings', 'notification_recipients');
        if (current && sameList(current.emails)) return;
        tx.set('system_settings', 'notification_recipients', { emails, updatedAt: new Date().toISOString() });
      });
    })().catch(err => {
      platformRecipientsBackfillRef.current = false;
      console.warn('[notifications] platform recipients not initialized:', err?.message || err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, platformRecipients]);

  /** True when `entity` is the record created by this very idempotency key (i.e. a retry of a success). */
  const isSameOperation = (entity: { id: string } | undefined, prefix: string, key?: string) =>
    Boolean(entity && key && ((entity as any).operationKey === key || entity.id === `${prefix}-${key}`));

  const orgById = (orgId?: string) => rawOrganizations.find(o => o.id === orgId);

  // Admin-facing notifications may only address what firestore.rules → outbox accepts:
  // the org's notificationRecipients, the platform list and the built-in super admin.
  const adminRecipientsFor = (orgId: string) =>
    Array.from(new Set([
      ...(orgById(orgId)?.notificationRecipients || []),
      ...(platformRecipients.emails || []),
      ...DEFAULT_SUPER_ADMINS,
    ].map(normalizeEmail))).filter(e => e.includes('@'));

  const notifyFor = (orgId: string): NotifyContext => ({
    settings: emailSettings,
    org: orgById(orgId),
    adminRecipients: adminRecipientsFor(orgId),
  });

  // =========================================================================
  // Refresh / reset
  // =========================================================================
  const refreshData = useCallback(async () => {
    setFirebaseSyncCounter(prev => prev + 1);
  }, []);

  const resetToSampleData = async () => {
    setActiveOrgId('');
    setActiveTab('dashboard');
    await purgeSampleDataFromFirestore();
    setFirebaseSyncCounter(prev => prev + 1);
  };

  // =========================================================================
  // AUDIT LOGGING HELPER (for actions that are not already audited atomically)
  // =========================================================================
  const logAuditAction = async (params: {
    actionType: AuditActionType;
    entityType: AuditEntityType;
    entityId: string;
    entityName: string;
    details: string;
    orgId?: string;
    orgName?: string;
    operationId?: string;
  }) => {
    try {
      const id = `audit-${params.operationId || newOperationKey()}`;
      const targetOrg = params.orgId ? orgById(params.orgId) : activeOrg;
      const entry: AuditLogEntry = {
        id,
        actionType: params.actionType,
        entityType: params.entityType,
        entityId: params.entityId,
        entityName: params.entityName,
        orgId: params.orgId || targetOrg?.id || '',
        orgName: params.orgName || targetOrg?.name || '',
        actorId: actor.id,
        actorName: actor.name,
        actorEmail: actor.email,
        details: params.details,
        timestamp: new Date().toISOString(),
      };
      await getStore().runTransaction(async tx => {
        if (await tx.get(COL.auditLogs, id)) return; // same operation already logged
        tx.set(COL.auditLogs, id, entry);
      });
    } catch (err) {
      console.warn('[Audit Logger Warning]', err);
    }
  };

  // =========================================================================
  // SUPER ADMIN MANAGEMENT
  // =========================================================================
  const addSuperAdminEmail = async (email: string) => {
    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail) return;
    await mutate('superAdmin', `add:${cleanEmail}`, async () => {
      const db = getDb()!;
      await setDoc(doc(db, 'super_admins', cleanEmail), {
        email: cleanEmail,
        role: 'super_admin',
        promotedAt: new Date().toISOString(),
        active: true,
      }, { merge: true });
      // Platform notification recipients (a missing list is filled by the backfill below).
      await updateDoc(doc(db, 'system_settings', 'notification_recipients'), { emails: arrayUnion(cleanEmail), updatedAt: new Date().toISOString() })
        .catch(err => console.warn('[superAdmin] notification recipients not updated:', err?.message || err));
    });
    setSuperAdminEmails(prev => Array.from(new Set([...prev, cleanEmail])));
    await logAuditAction({
      actionType: 'role_change',
      entityType: 'member',
      entityId: cleanEmail,
      entityName: cleanEmail,
      details: `تمت ترقية الحساب (${cleanEmail}) إلى سوبر أدمن (مشرف عام على المنصة) 👑`,
    });
  };

  const removeSuperAdminEmail = async (email: string) => {
    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail) return;
    await mutate('superAdmin', `remove:${cleanEmail}`, async () => {
      await deleteFirestoreDoc('super_admins', cleanEmail);
      const legacyId = cleanEmail.replace(/[^a-zA-Z0-9]/g, '_');
      if (legacyId !== cleanEmail) await deleteFirestoreDoc('super_admins', legacyId).catch(() => {});
      await updateDoc(doc(getDb()!, 'system_settings', 'notification_recipients'), { emails: arrayRemove(cleanEmail), updatedAt: new Date().toISOString() })
        .catch(err => console.warn('[superAdmin] notification recipients not updated:', err?.message || err));
    });
    setSuperAdminEmails(prev => prev.filter(e => e.trim().toLowerCase() !== cleanEmail));
    await logAuditAction({
      actionType: 'role_change',
      entityType: 'member',
      entityId: cleanEmail,
      entityName: cleanEmail,
      details: `تمت إزالة صلاحية السوبر أدمن عن الحساب (${cleanEmail})`,
    });
  };

  const updateSuperAdminRole = async (email: string, newRole: Role, targetOrgId?: string) => {
    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail) return;
    if (newRole === 'super_admin') {
      await addSuperAdminEmail(cleanEmail);
      return;
    }
    await removeSuperAdminEmail(cleanEmail);

    const existingMember = rawMembers.find(m => normalizeEmail(m.userEmail) === cleanEmail);
    const orgIdToUse = targetOrgId || existingMember?.orgId || rawOrganizations[0]?.id || '';
    if (existingMember) {
      await updateMember(existingMember.id, { role: newRole, orgId: orgIdToUse });
    } else if (orgIdToUse) {
      await addMember({
        orgId: orgIdToUse,
        userId: '',
        userName: cleanEmail.split('@')[0],
        userEmail: cleanEmail,
        role: newRole,
        department: newRole === 'finance' ? 'المالية والحسابات' : 'الإدارة العامة',
        jobTitle: newRole === 'org_admin' ? 'مدير شركة' : newRole === 'finance' ? 'مسؤول الصرف والخزينة' : newRole === 'data_entry' ? 'مدخل بيانات' : 'موظف',
        active: true,
      });
    }
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
    idempotencyKey?: string;
  }): Promise<{ success: boolean; message?: string; credentials?: { email: string; password: string } }> => {
    const targetOrgId = data.orgId || effectiveOrgId;
    if (!targetOrgId || targetOrgId === 'all') {
      return { success: false, message: 'يرجى تحديد المؤسسة أولاً لإضافة الموظف إليها.' };
    }
    const opKey = data.idempotencyKey || newOperationKey();

    try {
      return await mutate('createCompanyUser', data.idempotencyKey || fingerprint(data), async store => {
        const generateSecurePassword = (): string => {
          const pool = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
          const arr = new Uint8Array(12);
          crypto.getRandomValues(arr);
          return Array.from(arr).map(b => pool[b % pool.length]).join('');
        };

        let account = provisionedAccounts.get(opKey);
        if (!account) {
          const email = normalizeEmail(data.email) || `emp_${opKey.slice(0, 8)}@company.local`;
          const password = data.password?.trim() || generateSecurePassword();
          try {
            const res = await adminCreateUserAccount(email, password, data.name);
            account = { uid: res.uid, email, password };
            provisionedAccounts.set(opKey, account);
          } catch (authErr: any) {
            if (authErr?.code === 'auth/email-already-in-use') throw new DomainError('duplicate', 'هذا البريد الإلكتروني مسجل مسبقاً في النظام.');
            if (authErr?.code === 'auth/weak-password') throw new DomainError('weak_password', 'كلمة المرور يجب ألا تقل عن 6 خانات.');
            throw new DomainError('auth_failed', authErr?.message || 'تعذر إنشاء حساب المصادقة.');
          }
        }

        const defaultJobTitle = data.role === 'org_admin' ? 'مدير المؤسسة' : data.role === 'finance' ? 'مسؤول الصرف والخزينة' : data.role === 'data_entry' ? 'مدخل بيانات' : 'موظف';
        await createMember(store, actor, {
          orgId: targetOrgId,
          userId: account.uid,
          userName: data.name.trim(),
          userEmail: account.email,
          phone: data.phone?.trim() || '',
          role: data.role,
          department: data.department?.trim() || (data.role === 'finance' ? 'المالية والحسابات' : data.role === 'data_entry' ? 'إدخال البيانات والتسجيل' : 'العمليات والتشغيل'),
          jobTitle: data.jobTitle?.trim() || defaultJobTitle,
          active: true,
        }, opKey, { writeUserProfile: true });

        provisionedAccounts.delete(opKey);
        return {
          success: true,
          message: 'تم إنشاء وتفعيل حساب الموظف بنجاح!',
          credentials: { email: account.email, password: account.password },
        };
      });
    } catch (err: any) {
      console.error('[Create Company User Error]', err);
      return { success: false, message: toUserError(err).message };
    }
  };

  // =========================================================================
  // ORGANIZATIONS
  // =========================================================================
  const addOrganization = async (orgData: Omit<Organization, 'id' | 'createdAt'>, opts?: MutationOptions): Promise<{ success: boolean; message?: string; org?: Organization }> => {
    const cleanName = orgData.name.trim();
    const cleanCode = (orgData.code?.trim() || cleanName.slice(0, 3)).toUpperCase();
    const duplicate = rawOrganizations.find(o =>
      o.name.trim().toLowerCase() === cleanName.toLowerCase() || (o.code || '').trim().toUpperCase() === cleanCode
    );
    // A retry of an intent that already succeeded must resolve to success, not 'duplicate'.
    if (duplicate && !isSameOperation(duplicate, 'org', opts?.idempotencyKey)) {
      return { success: false, message: `توجد مؤسسة مسجلة بالفعل بنفس الاسم "${duplicate.name}" أو الكود (${duplicate.code}). تم منع التكرار.` };
    }
    try {
      const opKey = opts?.idempotencyKey || newOperationKey();
      const res = await mutate('addOrganization', opts?.idempotencyKey || cleanCode, store =>
        createOrganization(store, actor, { ...orgData, name: cleanName, code: cleanCode }, opKey)
      );
      setActiveOrgId(res.value.id);
      return { success: true, org: res.value };
    } catch (err) {
      return { success: false, message: toUserError(err).message };
    }
  };

  const updateOrganization = async (orgId: string, updates: Partial<Organization>) => {
    await mutate('updateOrganization', fingerprint(orgId, updates), store =>
      updateOrganizationOp(store, actor, orgId, updates, newOperationKey())
    );
  };

  const deleteOrganization = async (orgId: string): Promise<{ success: boolean; message?: string }> => {
    const hasFinancialRecords =
      rawRequests.some(r => r.orgId === orgId) ||
      rawTransactions.some(t => t.orgId === orgId) ||
      rawPaymentAccounts.some(a => a.orgId === orgId);
    try {
      await mutate('deleteOrganization', orgId, store =>
        removeOrganization(store, actor, orgId, hasFinancialRecords ? 'archive' : 'delete', newOperationKey())
      );
      if (activeOrgId === orgId) {
        const remaining = rawOrganizations.filter(o => o.id !== orgId && !o.archived);
        setActiveOrgId(remaining[0]?.id || '');
      }
      return {
        success: true,
        message: hasFinancialRecords ? 'تم أرشفة الشركة بنجاح والاحتفاظ ببياناتها المالية التاريخية.' : 'تم حذف الشركة بنجاح.',
      };
    } catch (err) {
      return { success: false, message: toUserError(err).message };
    }
  };

  // =========================================================================
  // MEMBERS
  // =========================================================================
  const addMember = async (memberData: Omit<OrganizationMember, 'id' | 'joinedAt'>, opts?: MutationOptions) => {
    const email = normalizeEmail(memberData.userEmail);
    if (email) {
      const existingInOrg = rawMembers.find(m => normalizeEmail(m.userEmail) === email && m.orgId === memberData.orgId);
      if (existingInOrg && !isSameOperation(existingInOrg, 'mem', opts?.idempotencyKey)) {
        throw new Error(`البريد الإلكتروني (${memberData.userEmail}) مسجل بالفعل في هذه المؤسسة باسم "${existingInOrg.userName}"`);
      }
    }
    // Re-use the real UID if this person already signed in / belongs to another org.
    const knownUid = rawMembers.find(m => normalizeEmail(m.userEmail) === email && isRealUid(m.userId))?.userId;
    const opKey = opts?.idempotencyKey || newOperationKey();
    await mutate('addMember', opts?.idempotencyKey || fingerprint(memberData.orgId, email || memberData.userName), store =>
      createMember(store, actor, { ...memberData, userId: isRealUid(memberData.userId) ? memberData.userId : knownUid || '' }, opKey)
    );
  };

  /**
   * users/{uid} profiles that may carry a membership's access and that this user can
   * read: the member's own UID, and profiles self-linked to the membership (memberId)
   * — members invited by email keep a placeholder userId after their first sign-in.
   * (Profiles are no longer matched by email: that field is not proof of identity.)
   */
  const linkedProfileIds = async (mem: OrganizationMember | undefined): Promise<string[]> => {
    const db = getDb();
    if (!db || !mem) return [];
    const ids = new Set<string>();
    if (isRealUid(mem.userId)) {
      try {
        await getDoc(doc(db, 'users', mem.userId)); // readable: missing, own, or in an org we administer
        ids.add(mem.userId);
      } catch {
        // The profile's primary org is one we do not administer: not this membership's to change.
      }
    }
    try {
      const snap = await getDocs(query(collection(db, 'users'), where('orgId', '==', mem.orgId), where('memberId', '==', mem.id)));
      snap.docs.forEach(d => ids.add(d.id));
    } catch (e) {
      console.warn('[members] linked profile lookup skipped:', e);
    }
    return Array.from(ids);
  };

  const updateMember = async (memberId: string, updates: Partial<OrganizationMember>) => {
    const mem = rawMembers.find(m => m.id === memberId) || myMemberships.find(m => m.id === memberId);
    await mutate('updateMember', fingerprint(memberId, updates), async store =>
      updateMemberRecord(store, actor, memberId, updates, await linkedProfileIds(mem), newOperationKey())
    );
  };

  const toggleMemberStatus = async (memberId: string, active: boolean) => {
    await updateMember(memberId, { active });
  };

  const removeMember = async (memberId: string) => {
    const mem = rawMembers.find(m => m.id === memberId);
    await mutate('removeMember', memberId, async store =>
      removeMemberOp(store, actor, memberId, await linkedProfileIds(mem), newOperationKey())
    );
  };

  const adminResetUserPassword = async (email: string): Promise<{ success: boolean; message?: string }> => {
    if (!email || !email.trim()) return { success: false, message: 'البريد الإلكتروني غير متوفر.' };
    try {
      await singleFlight(`resetPassword:${normalizeEmail(email)}`, () => sendPasswordReset(normalizeEmail(email)));
      await logAuditAction({
        actionType: 'password_reset',
        entityType: 'member',
        entityId: email,
        entityName: email,
        details: `تم إرسال رابط رسمي لاستعادة وإعادة تعيين كلمة المرور إلى البريد: "${email}"`,
      });
      return { success: true, message: `تم إرسال رابط استعادة وتعيين كلمة المرور بنجاح إلى: ${email}` };
    } catch (err: any) {
      console.error('[Admin Reset Password Error]', err);
      return { success: false, message: err?.message || 'تعذر إرسال رابط استعادة كلمة المرور.' };
    }
  };

  // =========================================================================
  // SERVICES / PROVIDERS / DEPARTMENTS
  // =========================================================================
  const addService = async (serviceData: Omit<ServiceCategory, 'id' | 'spentAmount'>, opts?: MutationOptions) => {
    const dup = rawServices.find(s =>
      s.orgId === serviceData.orgId &&
      ((serviceData.code && normalizeKeyValue(s.code) === normalizeKeyValue(serviceData.code)) ||
        s.name.trim().toLowerCase() === serviceData.name.trim().toLowerCase())
    );
    if (dup && !isSameOperation(dup, 'srv', opts?.idempotencyKey)) throw new Error(`يوجد بند صرف مسجل بالفعل بنفس الاسم أو الكود ("${dup.name}").`);
    const opKey = opts?.idempotencyKey || newOperationKey();
    await mutate('addService', opts?.idempotencyKey || fingerprint(serviceData.orgId, serviceData.code, serviceData.name), store =>
      createEntity<ServiceCategory>(store, actor, 'service', id => ({ ...serviceData, id, spentAmount: 0 }),
        s => `تم إنشاء بند صرف وتكلفة جديد: "${s.name}" بكود (${s.code}) وسقف ميزانية ${Number(s.budgetLimit || 0).toLocaleString()}`, opKey)
    );
  };

  const updateService = async (updatedService: ServiceCategory) => {
    await mutate('updateService', fingerprint(updatedService), store =>
      updateEntity<ServiceCategory>(store, actor, 'service', updatedService.id, updatedService, (before, after) => {
        const nameChanged = before.name.trim() !== after.name.trim();
        const budgetChanged = before.budgetLimit !== after.budgetLimit;
        let details = `تم تعديل بند الصرف: "${after.name}"`;
        if (nameChanged) details += ` (إعادة التسمية من "${before.name}" إلى "${after.name}")`;
        if (budgetChanged) details += ` (تعديل سقف الميزانية من ${Number(before.budgetLimit).toLocaleString()} إلى ${Number(after.budgetLimit).toLocaleString()})`;
        return { actionType: nameChanged ? 'rename' : budgetChanged ? 'budget_change' : 'update', details };
      }, newOperationKey())
    );
  };

  const deleteService = async (serviceId: string) => {
    const inUse = rawRequests.some(r => r.serviceCategoryId === serviceId);
    await mutate('deleteService', serviceId, store => deleteEntity(store, actor, 'service', serviceId, inUse ? 'deactivate' : 'delete', newOperationKey()));
  };

  const addProvider = async (providerData: Omit<ServiceProvider, 'id' | 'totalPaid'>, opts?: MutationOptions) => {
    const dup = rawProviders.find(p => p.orgId === providerData.orgId && p.name.trim().toLowerCase() === providerData.name.trim().toLowerCase());
    if (dup && !isSameOperation(dup, 'prov', opts?.idempotencyKey)) throw new Error(`يوجد مورد مسجل بالفعل بنفس الاسم ("${dup.name}").`);
    const opKey = opts?.idempotencyKey || newOperationKey();
    await mutate('addProvider', opts?.idempotencyKey || fingerprint(providerData.orgId, providerData.name), store =>
      createEntity<ServiceProvider>(store, actor, 'provider', id => ({ ...providerData, id, totalPaid: 0, active: true }),
        p => `تم إضافة مورد ومقدم خدمة جديد: "${p.name}" (هاتف: ${p.phone || '-'})`, opKey)
    );
  };

  const updateProvider = async (updatedProvider: ServiceProvider) => {
    await mutate('updateProvider', fingerprint(updatedProvider), store =>
      updateEntity<ServiceProvider>(store, actor, 'provider', updatedProvider.id, updatedProvider, (before, after) => {
        const nameChanged = before.name.trim() !== after.name.trim();
        return {
          actionType: nameChanged ? 'rename' : 'update',
          details: `تم تعديل بيانات المورد: "${after.name}"${nameChanged ? ` (إعادة التسمية من "${before.name}" إلى "${after.name}")` : ''}`,
        };
      }, newOperationKey())
    );
  };

  const deleteProvider = async (providerId: string) => {
    const inUse = rawRequests.some(r => r.providerId === providerId);
    await mutate('deleteProvider', providerId, store => deleteEntity(store, actor, 'provider', providerId, inUse ? 'deactivate' : 'delete', newOperationKey()));
  };

  const addDepartment = async (deptData: Omit<Department, 'id' | 'createdAt'>, opts?: MutationOptions) => {
    const dup = rawDepartments.find(d => d.orgId === deptData.orgId && d.name.trim().toLowerCase() === deptData.name.trim().toLowerCase());
    if (dup && !isSameOperation(dup, 'dept', opts?.idempotencyKey)) throw new Error(`يوجد قسم بنفس الاسم ("${dup.name}") في هذه الشركة.`);
    const opKey = opts?.idempotencyKey || newOperationKey();
    await mutate('addDepartment', opts?.idempotencyKey || fingerprint(deptData.orgId, deptData.name), store =>
      createEntity<Department>(store, actor, 'department', (id, nowIso) => ({ ...deptData, id, createdAt: nowIso }),
        d => `تم إنشاء قسم إداري جديد: "${d.name}"${d.managerName ? ` برئاسة (${d.managerName})` : ''}`, opKey)
    );
  };

  const updateDepartment = async (deptId: string, updates: Partial<Department>) => {
    await mutate('updateDepartment', fingerprint(deptId, updates), store =>
      updateEntity<Department>(store, actor, 'department', deptId, updates, (before, after) => {
        const nameChanged = before.name.trim() !== after.name.trim();
        return {
          actionType: nameChanged ? 'rename' : 'update',
          details: nameChanged ? `تم إعادة تسمية القسم الإداري من "${before.name}" إلى "${after.name}"` : `تم تعديل بيانات القسم الإداري "${after.name}"`,
        };
      }, newOperationKey())
    );
  };

  const deleteDepartment = async (deptId: string) => {
    await mutate('deleteDepartment', deptId, store => deleteEntity(store, actor, 'department', deptId, 'delete', newOperationKey()));
  };

  // =========================================================================
  // PAYMENT ACCOUNTS / VAULTS ("cards")
  // =========================================================================
  const addPaymentAccount = async (accountData: Omit<PaymentAccount, 'id' | 'createdAt'>, opts?: MutationOptions) => {
    const identifier = normalizeKeyValue(accountData.accountIdentifier);
    const dup = rawPaymentAccounts.find(a => a.orgId === accountData.orgId && identifier && normalizeKeyValue(a.accountIdentifier) === identifier);
    if (dup && !isSameOperation(dup, 'vault', opts?.idempotencyKey)) throw new Error(`يوجد حساب مسجل بالفعل بنفس الرقم / المعرف ("${dup.name}").`);
    const opKey = opts?.idempotencyKey || newOperationKey();
    await mutate('addPaymentAccount', opts?.idempotencyKey || fingerprint(accountData.orgId, identifier), store =>
      createPaymentAccount(store, actor, accountData, opKey)
    );
  };

  const updatePaymentAccount = async (accountId: string, updates: Partial<PaymentAccount>) => {
    await mutate('updatePaymentAccount', fingerprint(accountId, updates), store =>
      updatePaymentAccountOp(store, actor, accountId, updates, newOperationKey())
    );
  };

  const deletePaymentAccount = async (accountId: string) => {
    await mutate('deletePaymentAccount', accountId, store => deletePaymentAccountOp(store, actor, accountId, newOperationKey()));
  };

  const togglePaymentAccountStatus = async (accountId: string, active: boolean) => {
    await updatePaymentAccount(accountId, { active });
  };

  const recordManualAccountAdjustment = async (accountId: string, type: TransactionType, amount: number, description: string, opts?: MutationOptions) => {
    const opKey = opts?.idempotencyKey || newOperationKey();
    await mutate('adjustBalance', opts?.idempotencyKey || fingerprint(accountId, type, amount, description), store =>
      adjustAccountBalance(store, actor, { accountId, type, amount, description }, opKey)
    );
  };

  // =========================================================================
  // PETTY CASH & CUSTODIES
  // =========================================================================
  const issueCustody = async (
    orgId: string,
    employeeId: string,
    employeeName: string,
    employeePhone: string | undefined,
    amount: number,
    sourceAccountId: string,
    notes?: string,
    opts?: MutationOptions
  ): Promise<{ success: boolean; message?: string }> => {
    try {
      const opKey = opts?.idempotencyKey || newOperationKey();
      const res = await mutate('issueCustody', opts?.idempotencyKey || fingerprint(orgId, employeeId, amount, sourceAccountId), store =>
        issueCustodyOp(store, actor, { orgId, orgName: orgById(orgId)?.name, employeeId, employeeName, employeePhone, amount, sourceAccountId, notes }, opKey)
      );
      return {
        success: true,
        message: res.changed ? `تم صرف العهدة بنجاح برقم ${res.value.custodyNumber}` : `تم إصدار العهدة مسبقاً بنجاح برقم ${res.value.custodyNumber}`,
      };
    } catch (err) {
      return { success: false, message: toUserError(err).message };
    }
  };

  const settleCustodyItem = async (
    custodyId: string,
    amount: number,
    description: string,
    serviceCategoryId?: string,
    vendorName?: string,
    invoiceNumber?: string,
    invoiceDate?: string,
    receiptUrl?: string,
    opts?: MutationOptions
  ): Promise<{ success: boolean; message?: string }> => {
    try {
      const custody = rawCustodies.find(c => c.id === custodyId);
      const opKey = opts?.idempotencyKey || newOperationKey();
      const res = await mutate('settleCustody', opts?.idempotencyKey || fingerprint(custodyId, amount, invoiceNumber, invoiceDate, description), store =>
        settleCustodyItemOp(store, actor, {
          custodyId,
          amount,
          description,
          serviceCategoryId,
          serviceCategoryName: rawServices.find(s => s.id === serviceCategoryId)?.name || '',
          vendorName,
          invoiceNumber,
          invoiceDate,
          receiptUrl,
          orgName: orgById(custody?.orgId)?.name,
        }, opKey)
      );
      return { success: true, message: `تم تسجيل فاتورة التصفية بنجاح بمبلغ ${res.value.amount} ${res.value.currency}` };
    } catch (err) {
      return { success: false, message: toUserError(err).message };
    }
  };

  const replenishCustody = async (
    custodyId: string,
    amount: number,
    sourceAccountId: string,
    notes?: string,
    opts?: MutationOptions
  ): Promise<{ success: boolean; message?: string }> => {
    try {
      const custody = rawCustodies.find(c => c.id === custodyId);
      const opKey = opts?.idempotencyKey || newOperationKey();
      const res = await mutate('replenishCustody', opts?.idempotencyKey || fingerprint(custodyId, amount, sourceAccountId, notes), store =>
        replenishCustodyOp(store, actor, { custodyId, amount, sourceAccountId, notes, orgName: orgById(custody?.orgId)?.name }, opKey)
      );
      return { success: true, message: `تمت استعاضة العهدة بنجاح بمبلغ ${amount} ${res.value.currency}` };
    } catch (err) {
      return { success: false, message: toUserError(err).message };
    }
  };

  // =========================================================================
  // EXPENSE REQUESTS
  // =========================================================================
  const createRequest = async (data: CreateRequestData): Promise<ExpenseRequest> => {
    const service = rawServices.find(s => s.id === data.serviceCategoryId);
    const provider = rawProviders.find(p => p.id === data.providerId);

    const targetOrgId =
      data.orgId || (effectiveOrgId && effectiveOrgId !== 'all' ? effectiveOrgId : '') || userMemberRecord?.orgId || '';
    if (!targetOrgId) throw new Error('يرجى تحديد الشركة أو المؤسسة التابع لها الموظف لتقديم طلب الصرف.');

    const opKey = data.idempotencyKey || newOperationKey();
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 16);
    let attachments: RequestAttachment[] = data.attachments && data.attachments.length > 0
      ? [...data.attachments]
      : (data.attachmentNames || []).map((name, i) => ({ id: `att-${opKey}-${i}`, name, size: '1.2 MB', type: 'pdf', uploadedAt: ts }));
    const extra = [data.invoiceAttachment, data.visaDocumentAttachment, data.installmentTransferAttachment, data.walletTransferAttachment];
    extra.forEach((att, i) => {
      if (att && !attachments.some(a => a.id === att.id)) attachments = i === 0 ? [att, ...attachments] : [...attachments, att];
    });

    const isIncome = data.requestType === 'income';
    let resolvedTargetAccountId = data.targetAccountId;
    if (!resolvedTargetAccountId && isIncome) {
      const method = data.preferredPaymentMethod || 'cash';
      const targetType = method === 'instapay' ? 'instapay' : method === 'digital_wallet' ? 'wallet' : method === 'bank_transfer' ? 'bank' : 'cash';
      resolvedTargetAccountId = rawPaymentAccounts.find(a => a.orgId === targetOrgId && a.type === targetType)?.id;
    }

    const draft: RequestDraft = {
      orgId: targetOrgId,
      requesterDepartment: currentUser.role === 'org_admin' ? 'الإدارة العامة' : (userMemberRecord?.department || 'العمليات والتوريد'),
      requesterPhone: currentUser.phone || userMemberRecord?.phone,
      preferredPaymentMethod: data.preferredPaymentMethod || (isIncome ? 'cash' : 'instapay'),
      paymentAccountDetails: data.paymentAccountDetails || '',
      beneficiaryName: data.beneficiaryName,
      serviceCategoryId: isIncome ? (data.serviceCategoryId || 'srv-income-general') : data.serviceCategoryId,
      serviceCategoryName: isIncome ? (service?.name || data.serviceCategoryName || 'توريدات ومتحصلات نقدية') : (service?.name || data.serviceCategoryName || 'خدمة عامة'),
      providerId: isIncome ? (data.providerId || 'prov-income-general') : data.providerId,
      providerName: isIncome
        ? (provider?.name || data.providerName || (data.paymentAccountDetails ? `المودع: ${data.paymentAccountDetails}` : 'توريد مباشر / عميل'))
        : (provider?.name || data.providerName || 'مورد عام'),
      title: isIncome ? (data.title || `توريد مالي (+ IN) - ${data.amount.toLocaleString()} ${data.currency || 'EGP'}`) : data.title,
      description: isIncome ? (data.description || `توريد وتحصيل مالي مباشر لخزينة وحساب الشركة بمبلغ ${data.amount.toLocaleString()} ${data.currency || 'EGP'}`) : data.description,
      justification: isIncome ? (data.justification || 'إيداع وتوريد مالي مباشر') : data.justification,
      amount: data.amount,
      currency: data.currency,
      urgency: data.urgency || 'medium',
      requestType: data.requestType || 'expense',
      targetAccountId: resolvedTargetAccountId,
      itemsDetail: data.itemsDetail,
      isPrepaidByRequester: data.isPrepaidByRequester,
      invoiceNumber: data.invoiceNumber,
      invoiceDate: data.invoiceDate,
      invoiceAttachment: data.invoiceAttachment,
      visaDocumentAttachment: data.visaDocumentAttachment,
      installmentTransferAttachment: data.installmentTransferAttachment,
      installmentDeviceType: data.installmentDeviceType,
      installmentDeviceDescription: data.installmentDeviceDescription,
      walletTransferAttachment: data.walletTransferAttachment,
      attachments,
    };

    const { idempotencyKey: _ignored, ...fingerprintable } = data;
    const res = await mutate('createRequest', data.idempotencyKey || fingerprint(fingerprintable), store =>
      createExpenseRequest(store, actor, draft, opKey, notifyFor(targetOrgId))
    );
    dispatchEvents(res.outboxEventIds);
    return res.value;
  };

  const updateRequest = async (requestId: string, updatedFields: Partial<ExpenseRequest>, opts?: MutationOptions) => {
    const opKey = opts?.idempotencyKey || newOperationKey();
    await mutate('updateRequest', opts?.idempotencyKey || fingerprint(requestId, updatedFields), store =>
      updateExpenseRequest(store, actor, requestId, updatedFields, opKey)
    );
  };

  const runTransition = async (
    requestId: string,
    action: Parameters<typeof transitionExpenseRequest>[3],
    opts?: MutationOptions
  ) => {
    const req = rawRequests.find(r => r.id === requestId);
    const opKey = opts?.idempotencyKey || newOperationKey();
    // Flight key = request + action: two concurrent approvals of the same request
    // collapse into one call; the transaction then makes later ones no-ops.
    const res = await mutate('transition', `${requestId}:${action.type}`, store =>
      transitionExpenseRequest(store, actor, requestId, action, opKey, notifyFor(req?.orgId || effectiveOrgId))
    );
    dispatchEvents(res.outboxEventIds);
  };

  const approveRequest = (requestId: string, note?: string, opts?: MutationOptions) =>
    runTransition(requestId, { type: 'approve', note }, opts);
  const rejectRequest = (requestId: string, reason: string, opts?: MutationOptions) =>
    runTransition(requestId, { type: 'reject', reason }, opts);
  const requestClarification = (requestId: string, question: string, opts?: MutationOptions) =>
    runTransition(requestId, { type: 'clarify', question }, opts);
  const replyClarification = (requestId: string, replyText: string, attachmentName?: string, opts?: MutationOptions) =>
    runTransition(requestId, { type: 'reply', replyText, attachmentName }, opts);

  const disburseRequest = async (
    requestId: string,
    details: Omit<DisbursementDetails, 'disbursedAt' | 'disbursedBy'>,
    opts?: DisburseOptions
  ): Promise<DisburseOutcome> => {
    const req = rawRequests.find(r => r.id === requestId);
    if (!req) throw new Error('عفواً، لم يتم العثور على طلب الصرف.');

    // Resolve the source account (same organization only).
    const orgAccounts = rawPaymentAccounts.filter(a => a.orgId === req.orgId);
    let accountId = details.accountId || req.targetAccountId || '';
    if (!accountId && details.bankName) {
      accountId = orgAccounts.find(a => details.bankName?.includes(a.name) || details.bankName?.includes(a.accountIdentifier))?.id || '';
    }
    if (!accountId) {
      const method = details.paymentMethod || req.preferredPaymentMethod || (req.requestType === 'income' ? 'cash' : 'instapay');
      const expectedType = method === 'instapay' ? 'instapay' : method === 'digital_wallet' ? 'wallet' : method === 'bank_transfer' ? 'bank' : 'cash';
      accountId = orgAccounts.find(a => a.type === expectedType)?.id || '';
    }

    const opKey = opts?.idempotencyKey || newOperationKey();
    const res = await mutate('disburse', requestId, store =>
      disburseExpenseRequest(store, actor, requestId, { ...details, accountId, batchId: opts?.batchId }, opKey, notifyFor(req.orgId))
    );
    dispatchEvents(res.outboxEventIds);
    return { changed: res.changed, reason: res.reason, request: res.value };
  };

  // =========================================================================
  // VISA ISSUANCE & EXPENSE MANAGEMENT
  // =========================================================================
  const createVisaRequest = async (
    data: Omit<VisaRequest, 'id' | 'requestNumber' | 'status' | 'paidAmount' | 'remainingBalance' | 'payments' | 'createdAt' | 'updatedAt'>,
    opts?: MutationOptions
  ): Promise<VisaRequest> => {
    const opKey = opts?.idempotencyKey || newOperationKey();
    const res = await mutate('createVisa', opts?.idempotencyKey || fingerprint(data), store => createVisaRequestOp(store, actor, data, opKey));
    return res.value;
  };

  const updateVisaRequest = async (id: string, updates: Partial<VisaRequest>) => {
    await mutate('updateVisa', fingerprint(id, updates), store => updateVisaRequestOp(store, actor, id, updates));
  };

  const approveVisaRequest = async (id: string, approverName?: string) => {
    await mutate('decideVisa', `${id}:approve`, store =>
      decideVisaRequest(store, actor, id, { type: 'approve', approverName: approverName || currentUser.name }, newOperationKey())
    );
  };

  const rejectVisaRequest = async (id: string, reason: string, approverName?: string) => {
    await mutate('decideVisa', `${id}:reject`, store =>
      decideVisaRequest(store, actor, id, { type: 'reject', reason, approverName: approverName || currentUser.name }, newOperationKey())
    );
  };

  const addVisaPayment = async (
    visaId: string,
    paymentData: Omit<VisaPaymentRecord, 'id' | 'visaRequestId' | 'recordedBy' | 'recordedByName' | 'recordedAt'>,
    opts?: MutationOptions
  ) => {
    const opKey = opts?.idempotencyKey || newOperationKey();
    await mutate('visaPayment', opts?.idempotencyKey || fingerprint(visaId, paymentData), store =>
      addVisaPaymentOp(store, actor, visaId, paymentData, opKey)
    );
  };

  const deleteVisaRequest = async (id: string) => {
    await mutate('deleteVisa', id, store => deleteVisaRequestOp(store, actor, id, newOperationKey()));
  };

  // =========================================================================
  // EMAIL SETTINGS / TEST EMAIL
  // =========================================================================
  // Legacy per-browser settings are migrated once into the shared settings document.
  const migratedSettingsRef = useRef(false);
  useEffect(() => {
    if (!firebaseUser || !isSuperAdmin || migratedSettingsRef.current) return;
    const raw = readPref(LEGACY_EMAIL_SETTINGS_KEY);
    if (!raw) return;
    migratedSettingsRef.current = true;
    (async () => {
      try {
        const legacy = JSON.parse(raw) as Partial<EmailNotificationSettings>;
        const { directApiKey: _secret, ...shareable } = legacy;
        await getStore().runTransaction(async tx => {
          if (await tx.get('system_settings', 'email_notifications')) return; // never overwrite shared settings
          tx.set('system_settings', 'email_notifications', { ...DEFAULT_EMAIL_SETTINGS, ...shareable, directApiKey: '', migratedAt: new Date().toISOString() });
        });
        writePref(LEGACY_EMAIL_SETTINGS_KEY, null);
      } catch (err) {
        console.warn('[Email settings migration skipped]', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, isSuperAdmin]);

  const updateEmailSettings = async (partial: Partial<EmailNotificationSettings>) => {
    const updated = { ...emailSettings, ...partial };
    // API keys are server-side secrets (Vercel env) and are never stored in the database.
    const { directApiKey: _secret, ...shareable } = updated;
    await mutate('emailSettings', fingerprint(shareable), async () => {
      await setDoc(doc(getDb()!, 'system_settings', 'email_notifications'), sanitizeForFirestore({ ...shareable, directApiKey: '', updatedAt: new Date().toISOString() }), { merge: true });
    });
    setEmailSettings(updated);
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
    // Mirrors firestore.rules → outbox (isTestEvent): outside the platform team, a test
    // email may only go to the org's notification recipients or to yourself.
    const testOrgId = activeOrgId || rawOrganizations[0]?.id || '';
    if (!isSuperAdmin && ![...adminRecipientsFor(testOrgId), normalizeEmail(currentUser.email)].includes(normalizeEmail(recipientEmail))) {
      return { success: false, message: 'يمكن إرسال البريد التجريبي إلى بريدك أو إلى مديري الشركة المسجلين فقط.' };
    }
    try {
      const nowIso = new Date().toISOString();
      const eventId = `test_email__${newOperationKey()}`;
      const sample: ExpenseRequest = {
        id: 'req-test',
        requestNumber: 'REQ-TEST-000000',
        orgId: activeOrgId || rawOrganizations[0]?.id || '',
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
        justification: 'فحص الربط السحابي مع مزود البريد',
        amount: 2750,
        currency: 'EGP',
        status: 'pending',
        urgency: 'medium',
        attachments: [],
        comments: [],
        timeline: [],
        preferredPaymentMethod: 'instapay',
        paymentAccountDetails: 'finance@instapay',
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      const event = buildOutboxEvent({
        eventId,
        eventType: templateType,
        entityType: 'system',
        entityId: 'test',
        orgId: sample.orgId,
        recipients: [recipientEmail],
        details: {
          request: sample,
          org: activeOrg || rawOrganizations[0],
          actorName: currentUser.name,
          customSubject: '🧪 بريد اختباري من نظام مصروفي',
          customMessage: 'تم إرسال هذا البريد بنجاح لمعاينة قالب الإشعار البريدي والتحقق من الربط مع مزود البريد.',
          note: 'هذا إشعار اختباري للتأكد من وصول الرسائل بالشكل المطلوب للموظفين والمديرين.',
        },
        settings: emailSettings,
        actor,
        nowIso,
        force: true,
      });
      if (!event) return { success: false, message: 'عنوان البريد غير صالح.' };
      const { store, transport } = getDispatcher();
      await store.runTransaction(async tx => {
        tx.set(COL.outbox, event.id, event);
      });
      const result = await dispatchOutboxEvent(store, event.id, transport);
      if (result === 'sent') return { success: true, message: `تم إرسال البريد التجريبي إلى (${recipientEmail}) بنجاح!` };
      const snap = await getDoc(doc(getDb()!, 'outbox', event.id)).catch(() => null);
      const lastError = (snap?.data() as OutboxEvent | undefined)?.lastError;
      return { success: false, message: lastError || 'تعذر إرسال البريد التجريبي. يرجى التحقق من إعدادات ومفتاح مزود البريد.' };
    } catch (err: any) {
      return { success: false, message: toUserError(err).message };
    }
  };

  const clearEmailLogs = async () => {
    setEmailLogsClearedAt(new Date().toISOString());
  };

  // =========================================================================
  // AUTH & PROFILE
  // =========================================================================
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

  const handleResetPassword = async (email: string) => sendPasswordReset(email);

  const sendSuperAdminVerificationEmail = async (): Promise<{ success: boolean; message: string }> => {
    try {
      await singleFlight('verifyEmail', () => sendVerificationEmailToCurrentUser());
      return { success: true, message: `تم إرسال رابط التفعيل إلى ${firebaseUser?.email || 'بريدك'}. افتح الرسالة واضغط الرابط، ثم ارجع واضغط "تحقق الآن".` };
    } catch (err: any) {
      if (err?.code === 'auth/too-many-requests') {
        return { success: false, message: 'تم إرسال رابط مؤخراً. انتظر دقائق قليلة ثم أعد المحاولة، وتحقق من مجلد الرسائل غير المرغوب فيها (Spam).' };
      }
      return { success: false, message: err?.message || 'تعذر إرسال رابط التفعيل.' };
    }
  };

  /** Pick up a just-verified email without signing out, then resubscribe every listener. */
  const recheckSuperAdminVerification = async (): Promise<boolean> => {
    const verified = await refreshCurrentUserToken().catch(() => false);
    setEmailVerified(verified);
    setFirebaseSyncCounter(prev => prev + 1);
    return verified;
  };

  const handleLogoutUser = async () => {
    await logoutUser();
    setFirebaseUser(null);
    setActiveOrgIdState('');
    writePref(PREF_KEYS.ACTIVE_ORG, null);
    writePref(PREF_KEYS.ACTIVE_TAB, null);
  };

  const handleChangeCurrentUserPassword = async (currentPass: string, newPass: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await changeUserPassword(currentPass, newPass);
      return { success: true };
    } catch (err: any) {
      console.error('[ChangePassword Error]', err);
      const code = err?.code || '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') return { success: false, error: 'كلمة المرور الحالية غير صحيحة.' };
      if (code === 'auth/weak-password') return { success: false, error: 'كلمة المرور الجديدة ضعيفة. يجب أن تتكون من 6 خانات على الأقل.' };
      if (code === 'auth/too-many-requests') return { success: false, error: 'تم تجاوز عدد المحاولات مؤقتاً. يرجى الانتظار قليلاً.' };
      return { success: false, error: err?.message || 'تعذر تغيير كلمة المرور.' };
    }
  };

  const handleUpdateUserProfileInfo = async (
    dataOrDisplayName: string | {
      name: string;
      phone?: string;
      instapay?: string;
      wallet?: string;
      walletProvider?: string;
      bankName?: string;
      iban?: string;
      preferredPaymentMethod?: PaymentMethod;
    },
    maybePhone?: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!firebaseUser) return { success: false, error: 'يجب تسجيل الدخول أولاً.' };
    const data: Record<string, any> = typeof dataOrDisplayName === 'string' ? { name: dataOrDisplayName, phone: maybePhone } : dataOrDisplayName;
    const now = new Date().toISOString();
    // Only fields the caller actually provided are written, so saving name/phone from
    // one screen never wipes the payout profile saved from another.
    const profile: Record<string, string> = {};
    for (const key of ['name', 'phone', 'instapay', 'wallet', 'walletProvider', 'bankName', 'iban', 'preferredPaymentMethod']) {
      if (data[key] !== undefined && data[key] !== null) profile[key] = String(data[key]).trim();
    }
    if (!profile.name) return { success: false, error: 'يرجى إدخال الاسم.' };
    try {
      await mutate('updateProfile', firebaseUser.uid, async () => {
        const db = getDb()!;
        await updateUserProfile(profile.name).catch(() => {});
        // The profile document is required (it is what other screens read) — failures surface.
        await setDoc(doc(db, 'users', firebaseUser.uid), sanitizeForFirestore({ uid: firebaseUser.uid, ...profile, updatedAt: now }), { merge: true });
        if (userMemberRecord) {
          await setDoc(doc(db, 'members', userMemberRecord.id), sanitizeForFirestore({ userName: profile.name, ...profile, updatedAt: now }), { merge: true })
            .catch(err => console.warn('[UpdateProfile] membership copy not updated:', err?.message || err));
        }
        if (isSuperAdmin && userEmail) {
          await setDoc(doc(db, 'super_admins', userEmail), sanitizeForFirestore({ ...profile, updatedAt: now }), { merge: true }).catch(() => {});
        }
      });
      return { success: true };
    } catch (err: any) {
      console.error('[UpdateProfile Error]', err);
      return { success: false, error: toUserError(err).message };
    }
  };

  const resolveParentAccount = useCallback(
    (account: PaymentAccount | null | undefined): PaymentAccount | null => resolveParentBankAccount(account, rawPaymentAccounts),
    [rawPaymentAccounts]
  );

  return (
    <AppContext.Provider
      value={{
        organizations: scopedOrganizations,
        allOrganizations: rawOrganizations,
        activeOrgId: effectiveOrgId,
        activeOrg,
        effectiveOrgId,
        forceRefreshUserState,
        isAccountSuspended,
        superAdminNeedsVerification,
        sendSuperAdminVerificationEmail,
        recheckSuperAdminVerification,
        permissionDeniedSources,
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
        updateRequest,
        approveRequest,
        rejectRequest,
        requestClarification,
        replyClarification,
        disburseRequest,
        visaRequests: scopedVisaRequests,
        allVisaRequests: rawVisaRequests,
        createVisaRequest,
        updateVisaRequest,
        approveVisaRequest,
        rejectVisaRequest,
        addVisaPayment,
        deleteVisaRequest,
        paymentAccounts: scopedPaymentAccounts,
        allPaymentAccounts: rawPaymentAccounts,
        transactions: scopedTransactions,
        allTransactions: rawTransactions,
        addPaymentAccount,
        updatePaymentAccount,
        deletePaymentAccount,
        togglePaymentAccountStatus,
        recordManualAccountAdjustment,
        resolveParentBankAccount: resolveParentAccount,
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
