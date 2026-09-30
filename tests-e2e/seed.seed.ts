/**
 * Seeds the LOCAL end-to-end environment (Firebase emulators, demo project) with a realistic
 * data set built through the app's own domain functions, so every screen has something to
 * show and every flow has something to act on. Run with the emulators up:
 *   npm run e2e:emulators   (other terminal)
 *   npm run e2e:seed
 * Wipes the emulator data first; never touches production.
 */
import { readFileSync } from 'fs';
import { it } from 'vitest';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, type Firestore } from 'firebase/firestore';
import { createFirestoreStore } from '../src/domain/firestoreStore';
import { createOrganization, createEntity, createEntityInOrgs, createMember } from '../src/domain/directory';
import { adjustAccountBalance, issueCustody, settleCustodyItem } from '../src/domain/treasury';
import { createExpenseRequest, transitionExpenseRequest, type RequestDraft } from '../src/domain/requests';
import { createVisaRequest, decideVisaRequest } from '../src/domain/visa';
import { DEFAULT_EMAIL_SETTINGS } from '../src/services/emailTemplates';
import type { Actor } from '../src/domain/common';
import type { Department, ServiceCategory, ServiceProvider } from '../src/types';
import { E2E_ACCOUNTS, E2E_PASSWORD, E2E_PROJECT, ORG_CAIRO, ORG_RIYADH, ORG_TANTA, type E2EAccount } from './accounts';

const AUTH = 'http://127.0.0.1:9099';
const ADMIN_HEADERS = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' };
let seq = 0;
const k = (label: string) => `seed-${label}-${String(++seq).padStart(4, '0')}`;

async function resetAuth() {
  const res = await fetch(`${AUTH}/emulator/v1/projects/${E2E_PROJECT}/accounts`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`auth emulator reset failed: ${res.status} ${await res.text()}`);
}

/** Creates a verified email/password account in the Auth emulator and returns its uid. */
async function createAuthUser(a: E2EAccount): Promise<string> {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${E2E_PROJECT}/accounts`, {
    method: 'POST',
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ email: a.email, password: E2E_PASSWORD, displayName: a.name, emailVerified: true }),
  });
  const body = await res.json();
  if (!res.ok || !body.localId) throw new Error(`auth create failed for ${a.email}: ${JSON.stringify(body)}`);
  return body.localId as string;
}

it('seeds the local end-to-end environment', { timeout: 120_000 }, async () => {
  await resetAuth();
  const uid: Record<string, string> = {};
  for (const a of E2E_ACCOUNTS) uid[a.key] = await createAuthUser(a);
  const actor = (key: string): Actor => {
    const a = E2E_ACCOUNTS.find(x => x.key === key)!;
    return { id: uid[key], name: a.name, email: a.email, role: a.role };
  };
  const owner = actor('owner');
  const notify = { settings: { ...DEFAULT_EMAIL_SETTINGS, enabled: false } };

  const env = await initializeTestEnvironment({
    projectId: E2E_PROJECT,
    firestore: { host: '127.0.0.1', port: 8085, rules: readFileSync('firestore.rules', 'utf8') },
  });
  await env.clearFirestore();

  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore() as unknown as Firestore;
    const store = createFirestoreStore(db);

    // Settings: notifications off (no mail relay in the local environment)
    await setDoc(doc(db, 'system_settings', 'email_notifications'), { ...DEFAULT_EMAIL_SETTINGS, enabled: false });
    await setDoc(doc(db, 'system_settings', 'notification_recipients'), { emails: ['mahmoud@tieapps.com'], updatedAt: new Date().toISOString() });

    // Companies (each gets its 4 standard accounts: bank, cash, InstaPay->bank, standalone wallet)
    await createOrganization(store, owner, { name: 'Tie-Tanta', code: 'TEGY', currency: 'EGP', budget: 500_000, description: 'فرع طنطا' } as any, k('org'));
    await createOrganization(store, owner, { name: 'Home-Cairo', code: 'HCAI', currency: 'EGP', budget: 300_000, description: 'فرع القاهرة' } as any, k('org'));
    await createOrganization(store, owner, { name: 'Riyadh Branch', code: 'RYD', currency: 'SAR', budget: 200_000, description: 'فرع الرياض' } as any, k('org'));

    // Memberships (+ users/{uid} profiles) for every account
    for (const a of E2E_ACCOUNTS) {
      await createMember(store, owner, {
        orgId: a.orgId,
        userId: uid[a.key],
        userName: a.name,
        userEmail: a.email,
        role: a.role === 'super_admin' ? 'org_admin' : a.role,
        department: a.role === 'employee' ? 'التسويق' : 'الإدارة العامة',
        jobTitle: a.role === 'super_admin' ? 'CEO' : a.role === 'employee' ? 'أخصائي' : 'مسؤول',
        phone: '01000000000',
        active: true,
      } as any, k('member'), { writeUserProfile: a.role !== 'super_admin' });
    }

    // Services (one shared by Tanta + Cairo)
    const service = (id: string, orgIds: string[], name: string, code: string, color: string): ServiceCategory => ({
      id, orgId: orgIds[0], orgIds, name, code, description: `بند ${name}`, budgetLimit: 50_000, spentAmount: 0, color, iconName: 'Briefcase',
    });
    const srv: Record<string, string> = {};
    for (const [name, code, orgIds, color] of [
      ['Catering', 'SRV-508', [ORG_TANTA], '#10b981'],
      ['WE Internet', 'SRV-272', [ORG_TANTA, ORG_CAIRO], '#6366f1'],
      ['Saudi Arabia VISA', 'SRV-376', [ORG_TANTA, ORG_CAIRO], '#f59e0b'],
      ['Office Rent', 'SRV-900', [ORG_RIYADH], '#ef4444'],
    ] as Array<[string, string, string[], string]>) {
      const res = await createEntity<ServiceCategory>(store, owner, 'service', id => service(id, orgIds, name, code, color), s => `بند جديد ${s.name}`, k('service'));
      srv[name] = res.value.id;
    }

    // Providers (multi-company) and departments
    const provider = (name: string, services: string[]) => (id: string, orgId: string): ServiceProvider => ({
      id, orgId, name, serviceCategoryIds: services.map(s => srv[s]), serviceCategoryNames: services,
      contactPerson: 'أحمد', phone: '01011112222', email: '', taxNumber: '', crNumber: '', bankName: 'CIB', iban: '', address: 'طنطا',
      rating: 5, totalPaid: 0, active: true,
    } as ServiceProvider);
    const provs = await createEntityInOrgs(store, owner, 'provider', [ORG_TANTA, ORG_CAIRO], provider('Vodafone Business', ['WE Internet']), p => `مورد ${p.name}`, k('prov'));
    const visaProvs = await createEntityInOrgs(store, owner, 'provider', [ORG_TANTA, ORG_CAIRO], provider('Saudi Visa Center', ['Saudi Arabia VISA']), p => `مورد ${p.name}`, k('prov'));
    await createEntityInOrgs(store, owner, 'provider', [ORG_TANTA], provider('Cairo Catering', ['Catering']), p => `مورد ${p.name}`, k('prov'));
    for (const name of ['الإدارة العامة', 'التسويق', 'تقنية المعلومات IT']) {
      await createEntityInOrgs<Department>(store, owner, 'department', [ORG_TANTA, ORG_CAIRO], (id, orgId, nowIso) => ({ id, orgId, name, createdAt: nowIso } as Department), d => `قسم ${d.name}`, k('dept'));
    }

    // Money: fund each company's bank and cash box
    for (const org of [ORG_TANTA, ORG_CAIRO, ORG_RIYADH]) {
      await adjustAccountBalance(store, owner, { accountId: `vault-bank-${org}`, type: 'in', amount: 200_000, description: 'رصيد اختبار' }, k('fund'));
      await adjustAccountBalance(store, owner, { accountId: `vault-cash-${org}`, type: 'in', amount: 30_000, description: 'رصيد اختبار' }, k('fund'));
      await adjustAccountBalance(store, owner, { accountId: `vault-wallet-${org}`, type: 'in', amount: 5_000, description: 'شحن المحفظة للاختبار' }, k('fund'));
    }
    // A pre-standalone wallet still linked (mirrored) to Tanta's bank — for "فصل المحفظة عن البنك"
    await setDoc(doc(db, 'paymentAccounts', 'vault-legacy-wallet-org-tegy'), {
      id: 'vault-legacy-wallet-org-tegy', orgId: ORG_TANTA, name: 'فودافون كاش (قديمة)', type: 'wallet', accountIdentifier: '01099998888',
      parentAccountId: `vault-bank-${ORG_TANTA}`, parentAccountName: 'حساب بنكي رئيسي (Tie-Tanta)',
      currency: 'EGP', active: true, initialBalance: 1000, balance: 2500, currentBalance: 2500, totalIn: 2000, totalOut: 500,
      description: 'محفظة من الإعداد القديم', createdAt: '2026-01-01T00:00:00.000Z',
    });

    // Expense requests: pending, approved (ready to disburse), clarification requested
    const tantaProv = provs.value.created.find(p => p.orgId === ORG_TANTA)!;
    const draft = (title: string, amount: number): RequestDraft => ({
      orgId: ORG_TANTA, requesterDepartment: 'التسويق', serviceCategoryId: srv['WE Internet'], serviceCategoryName: 'WE Internet',
      providerId: tantaProv.id, providerName: tantaProv.name, title, description: `${title} - تفاصيل`, justification: 'ضروري للعمل',
      amount, currency: 'EGP', urgency: 'medium', requestType: 'expense', attachments: [],
    } as unknown as RequestDraft);
    const emp = actor('employee');
    await createExpenseRequest(store, emp, draft('اشتراك إنترنت شهر أكتوبر', 1500), k('req'), notify);
    const approved = await createExpenseRequest(store, emp, draft('باقة إنترنت إضافية', 2500), k('req'), notify);
    await transitionExpenseRequest(store, actor('admin'), approved.value.id, { type: 'approve' } as any, k('approve'), notify);
    const clarify = await createExpenseRequest(store, emp, draft('راوتر جديد للمكتب', 4200), k('req'), notify);
    await transitionExpenseRequest(store, actor('admin'), clarify.value.id, { type: 'clarify', question: 'يرجى إرفاق عرض السعر' } as any, k('clarify'), notify);

    // Custodies: one fresh, one partly settled by invoices
    const fin = actor('finance');
    await issueCustody(store, fin, { orgId: ORG_TANTA, employeeId: uid.employee, employeeName: 'سارة موظفة طنطا', amount: 3000, sourceAccountId: `vault-cash-${ORG_TANTA}`, notes: 'عهدة مشتريات' }, k('cus'));
    const c2 = await issueCustody(store, fin, { orgId: ORG_TANTA, employeeId: uid.dataentry, employeeName: 'مدخل بيانات طنطا', amount: 2000, sourceAccountId: `vault-bank-${ORG_TANTA}`, notes: 'عهدة صيانة' }, k('cus'));
    await settleCustodyItem(store, fin, { custodyId: c2.value.id, amount: 750, description: 'فاتورة صيانة' }, k('stl'));
    // Kept for the employee's own invoice flow (the two above are for finance's return flows)
    await issueCustody(store, fin, { orgId: ORG_TANTA, employeeId: uid.employee, employeeName: 'سارة موظفة طنطا', amount: 1000, sourceAccountId: `vault-wallet-${ORG_TANTA}`, notes: 'عهدة نثريات للموظفة' }, k('cus'));

    // Visa requests: pending, and approved (for payments)
    const tantaVisaProv = visaProvs.value.created.find(p => p.orgId === ORG_TANTA)!;
    const visaInput = (traveler: string, passport: string) => ({
      orgId: ORG_TANTA, requestDate: new Date().toISOString(), travelerName: traveler, passportNumber: passport, destinationCountry: 'المملكة العربية السعودية',
      hasTraveledBefore: false, expectedTravelDate: '2026-12-15', visaType: 'tourist' as const, serviceProviderId: tantaVisaProv.id,
      serviceProviderName: tantaVisaProv.name, assignedApprover: 'محمود', totalAmount: 6000, initialPayment: 2000, currency: 'EGP',
      paymentMode: 'installments' as const, requesterId: emp.id, requesterName: emp.name, requesterEmail: emp.email,
    });
    await createVisaRequest(store, emp, visaInput('فاروق حلاوة', 'A1234567'), k('visa'));
    const visa2 = await createVisaRequest(store, emp, visaInput('منى سعيد', 'B7654321'), k('visa'));
    await decideVisaRequest(store, actor('admin'), visa2.value.id, { type: 'approve', approverName: 'مدير طنطا' }, k('visa-approve'));
  });

  await env.cleanup();
  console.log('[e2e seed] accounts:', E2E_ACCOUNTS.map(a => `${a.key}=${a.email} @ http://${a.host}:5173`).join(' | '));
});
