/**
 * Test accounts of the LOCAL end-to-end environment (Firebase Auth emulator, demo project
 * "demo-expenses-e2e"). They exist only in the emulator started by `npm run e2e:emulators`
 * and are recreated by `npm run e2e:seed`; they have nothing to do with production.
 * Each role signs in on its own *.localhost origin so sessions never mix in one browser.
 */
export const E2E_PROJECT = 'demo-expenses-e2e';
export const E2E_PASSWORD = 'E2e-Local-Only-2026!';

export const ORG_TANTA = 'org-tegy';
export const ORG_CAIRO = 'org-hcai';
export const ORG_RIYADH = 'org-ryd';

export interface E2EAccount {
  key: string;
  email: string;
  name: string;
  role: 'super_admin' | 'org_admin' | 'finance' | 'data_entry' | 'employee';
  orgId: string;
  /** Where this role is tested: http://<host>:5173 */
  host: string;
}

export const E2E_ACCOUNTS: E2EAccount[] = [
  { key: 'owner', email: 'mahmoud@tieapps.com', name: 'محمود (مالك المنصة)', role: 'super_admin', orgId: ORG_TANTA, host: 'owner.localhost' },
  { key: 'admin', email: 'admin.tanta@e2e.test', name: 'مدير طنطا', role: 'org_admin', orgId: ORG_TANTA, host: 'admin.localhost' },
  { key: 'finance', email: 'finance.tanta@e2e.test', name: 'مالية طنطا', role: 'finance', orgId: ORG_TANTA, host: 'finance.localhost' },
  { key: 'dataentry', email: 'dataentry.tanta@e2e.test', name: 'مدخل بيانات طنطا', role: 'data_entry', orgId: ORG_TANTA, host: 'dataentry.localhost' },
  { key: 'employee', email: 'emp.tanta@e2e.test', name: 'سارة موظفة طنطا', role: 'employee', orgId: ORG_TANTA, host: 'employee.localhost' },
  { key: 'admin2', email: 'admin.cairo@e2e.test', name: 'مدير القاهرة', role: 'org_admin', orgId: ORG_CAIRO, host: 'admin2.localhost' },
  { key: 'employee2', email: 'emp.cairo@e2e.test', name: 'علي موظف القاهرة', role: 'employee', orgId: ORG_CAIRO, host: 'employee2.localhost' },
];
