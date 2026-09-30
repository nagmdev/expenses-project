import type { Role } from '../types';

/**
 * Who may do what — the single source the screens use to show or hide an action.
 * It mirrors the role checks of the domain layer (src/domain/*) and firestore.rules:
 * an action shown to a role the database refuses is a bug (the user waits, then it fails).
 * Change a permission here AND in the domain + rules together.
 */
const ADMINS: Role[] = ['super_admin', 'org_admin'];
const MONEY: Role[] = ['super_admin', 'org_admin', 'finance'];
const DIRECTORY_VIEW: Role[] = ['super_admin', 'org_admin', 'finance', 'data_entry'];

export const PERMISSIONS = {
  // Dashboards and company-wide lists
  viewDashboard: MONEY,
  viewAllRequests: MONEY,
  viewAuditLog: ADMINS,
  // Expense requests (transitionExpenseRequest / disburseExpenseRequest)
  approveRequests: MONEY,
  rejectRequests: MONEY,
  clarifyRequests: ADMINS,
  disburseRequests: MONEY,
  // Treasury (src/domain/treasury.ts)
  viewTreasury: MONEY,
  moveMoney: MONEY,
  createAccounts: ADMINS,
  editAccounts: MONEY,
  deleteAccounts: ADMINS,
  detachWallets: ADMINS,
  // Custodies: issue / replenish / return remainder; everyone else sees only their own
  issueCustody: MONEY,
  viewAllCustodies: MONEY,
  // Users and memberships
  viewUsers: ADMINS,
  manageUsers: ADMINS,
  // Directory: services, providers, departments (createEntity / updateEntity / deleteEntity + rules)
  viewServices: DIRECTORY_VIEW,
  createServices: ADMINS,
  editServices: MONEY,
  deleteServices: ADMINS,
  viewProviders: DIRECTORY_VIEW,
  createProviders: [...ADMINS, 'data_entry'] as Role[],
  editProviders: MONEY,
  deleteProviders: ADMINS,
  viewDepartments: DIRECTORY_VIEW,
  createDepartments: [...ADMINS, 'data_entry'] as Role[],
  editDepartments: ADMINS,
  deleteDepartments: ADMINS,
  // Platform
  manageCompanies: ['super_admin'] as Role[],
  platformSettings: ['super_admin'] as Role[],
  // A test email to the company's notification recipients or oneself, and the company's
  // email delivery log (rules → outbox: isTestEvent needs isOrgAdmin; AppContext.sendTestEmail).
  emailDiagnostics: ADMINS,
  // Visas (src/domain/visa.ts + rules): a requester files their own; staff decide, pay and edit
  decideVisas: MONEY,
  payVisas: MONEY,
  editVisas: MONEY,
  deleteVisas: ADMINS,
} satisfies Record<string, Role[]>;
// Note: a service another company shares with the active one (service.orgId !== active
// company) is usable but read-only there — edit / delete only where service.orgId matches
// (the domain refuses it, see assertActorCompany in src/domain/common.ts).

export type Permission = keyof typeof PERMISSIONS;

export const can = (role: Role | null | undefined, permission: Permission): boolean =>
  Boolean(role && (PERMISSIONS[permission] as Role[]).includes(role));

/**
 * The pages (activeTab ids in App.tsx) each role may open. The sidebar lists exactly
 * these, and AppContext sends a role away from any other page to its home page.
 * 'organizations' is the company hub: data entry reaches only its providers / departments sections.
 */
export const TAB_ACCESS: Record<Role, string[]> = {
  super_admin: ['dashboard', 'requests', 'my-requests', 'treasury', 'custody', 'visas', 'services', 'providers', 'organizations', 'users', 'audit', 'settings', 'profile'],
  org_admin: ['dashboard', 'requests', 'my-requests', 'treasury', 'custody', 'visas', 'services', 'providers', 'organizations', 'users', 'audit', 'settings', 'profile'],
  finance: ['dashboard', 'requests', 'my-requests', 'treasury', 'custody', 'visas', 'services', 'providers', 'profile'],
  data_entry: ['providers', 'services', 'organizations', 'my-requests', 'custody', 'visas', 'profile'],
  employee: ['my-requests', 'custody', 'visas', 'profile'],
};

export const HOME_TAB: Record<Role, string> = {
  super_admin: 'dashboard',
  org_admin: 'dashboard',
  finance: 'dashboard',
  data_entry: 'providers',
  employee: 'my-requests',
};

export const canOpenTab = (role: Role | null | undefined, tab: string): boolean => Boolean(role && TAB_ACCESS[role]?.includes(tab));
