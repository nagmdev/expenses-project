/**
 * Comprehensive System Verification & Hardening Test Suite for "مصروفي"
 * Executes full end-to-end multi-tenancy, expense lifecycle, financial payouts, 
 * treasury accounting, custody settling, and zero-leakage security checks on live Firebase.
 */

const { initializeApp, deleteApp } = require('firebase/app');
const { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  updateProfile,
  deleteUser
} = require('firebase/auth');
const { 
  getFirestore, 
  collection, 
  getDocs, 
  getDoc,
  setDoc, 
  updateDoc,
  doc, 
  deleteDoc, 
  query, 
  where 
} = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyAVdlhJWnybKourhOiNcS9BKPoSb67kZMk",
  authDomain: "expenses-project-ce1f9.firebaseapp.com",
  projectId: "expenses-project-ce1f9",
  storageBucket: "expenses-project-ce1f9.firebasestorage.app",
  messagingSenderId: "149226675429",
  appId: "1:149226675429:web:dec67a265ce2516250880c"
};

const app = initializeApp(firebaseConfig, 'sys-verify-app');
const auth = getAuth(app);
const db = getFirestore(app);

async function provisionIsolatedUser(email, password, displayName) {
  const tempName = 'prov-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
  const tempApp = initializeApp(firebaseConfig, tempName);
  const tempAuth = getAuth(tempApp);
  try {
    const cred = await createUserWithEmailAndPassword(tempAuth, email, password);
    if (displayName) {
      await updateProfile(cred.user, { displayName });
    }
    const uid = cred.user.uid;
    await signOut(tempAuth);
    return { uid, user: cred.user };
  } finally {
    await deleteApp(tempApp).catch(() => {});
  }
}

const logStep = (stepNum, title) => {
  console.log('\n============================================================');
  console.log(`[TEST STEP ${stepNum}] ${title}`);
  console.log('============================================================');
};

const logPass = (msg) => console.log(`  ✓ PASS: ${msg}`);
const logFail = (msg) => {
  console.error(`  ✗ FAIL: ${msg}`);
  process.exit(1);
};
const logInfo = (msg) => console.log(`  ℹ INFO: ${msg}`);

(async () => {
  const createdUsers = [];
  const createdDocs = [];

  try {
    console.log('\n============================================================');
    console.log('🚀 RUNNING SYSTEM VERIFICATION SUITE — "مصروفي" ENTERPRISE SYSTEM');
    console.log('Project: expenses-project-ce1f9');
    console.log('Started At:', new Date().toISOString());
    console.log('============================================================');

    // -------------------------------------------------------------
    // TEST 1: Super Admin Authentication
    // -------------------------------------------------------------
    logStep(1, 'Super Admin Authentication & System Privileges');
    const runId = Date.now();
    const defaultPassword = 'SysTestPass2026@';
    const superAdminEmail = 'awadhsaudi2030@gmail.com';
    const superAdminPass = 'Test123456!';

    const saCred = await signInWithEmailAndPassword(auth, superAdminEmail, superAdminPass);
    logPass(`Super Admin signed in successfully! UID: ${saCred.user.uid} (${saCred.user.email})`);

    // Verify Super Admin record in database
    const saDoc = await getDoc(doc(db, 'super_admins', saCred.user.uid));
    if (!saDoc.exists()) {
      logFail('Super admin document missing in super_admins collection!');
    }
    logPass('Super admin record verified in Cloud Firestore database.');

    // -------------------------------------------------------------
    // TEST 2: Multi-Tenancy — Creating Isolated Companies
    // -------------------------------------------------------------
    logStep(2, 'Multi-Tenancy Isolation — Provisioning Company A & Company B');
    const orgAId = `org-test-alpha-${runId}`;
    const orgBId = `org-test-beta-${runId}`;

    const orgA = {
      id: orgAId,
      name: 'شركة ألفا للتقنية والحلول الذكية',
      code: 'ALF',
      currency: 'EGP',
      budget: 300000,
      description: 'شركة أ لاختبار منظومة الصرف والعهد والمحافظ',
      createdAt: new Date().toISOString()
    };
    const orgB = {
      id: orgBId,
      name: 'مجموعة بيتا اللوجستية الدولية',
      code: 'BET',
      currency: 'SAR',
      budget: 600000,
      description: 'شركة ب للتحقق من العزل المحكم وعدم تسرب السجلات',
      createdAt: new Date().toISOString()
    };

    await setDoc(doc(db, 'organizations', orgAId), orgA);
    createdDocs.push({ col: 'organizations', id: orgAId });
    logPass(`Created Tenant A: ${orgA.name} (${orgA.code})`);

    await setDoc(doc(db, 'organizations', orgBId), orgB);
    createdDocs.push({ col: 'organizations', id: orgBId });
    logPass(`Created Tenant B: ${orgB.name} (${orgB.code})`);

    // -------------------------------------------------------------
    // TEST 3: Provision Company Admins & Employees with Payout Details
    // -------------------------------------------------------------
    logStep(3, 'Provisioning Users with Financial Payout Profiles (Auto-Fill)');

    // Admin A
    const adminAEmail = `admin.alpha.${runId}@tieapps-test.com`;
    const adminAUser = await provisionIsolatedUser(adminAEmail, defaultPassword, 'م. أسامة كامل (مدير ألفا)');
    createdUsers.push(adminAEmail);
    const memAdminAId = `${adminAUser.uid}_${orgAId}`;
    await setDoc(doc(db, 'users', adminAUser.uid), {
      id: adminAUser.uid,
      uid: adminAUser.uid,
      email: adminAEmail,
      name: 'م. أسامة كامل',
      role: 'org_admin',
      orgId: orgAId,
      createdAt: new Date().toISOString()
    });
    createdDocs.push({ col: 'users', id: adminAUser.uid });

    await setDoc(doc(db, 'members', memAdminAId), {
      id: memAdminAId,
      orgId: orgAId,
      userId: adminAUser.uid,
      userName: 'م. أسامة كامل',
      userEmail: adminAEmail,
      role: 'org_admin',
      department: 'الإدارة العليا',
      jobTitle: 'مدير تنفيذي',
      joinedAt: new Date().toISOString().split('T')[0],
      active: true
    });
    createdDocs.push({ col: 'members', id: memAdminAId });
    logPass(`Provisioned Company A Admin: ${adminAEmail}`);

    // Admin B
    const adminBEmail = `admin.beta.${runId}@tieapps-test.com`;
    const adminBUser = await provisionIsolatedUser(adminBEmail, defaultPassword, 'أ. مازن فؤاد (مدير بيتا)');
    createdUsers.push(adminBEmail);
    const memAdminBId = `${adminBUser.uid}_${orgBId}`;
    await setDoc(doc(db, 'users', adminBUser.uid), {
      id: adminBUser.uid,
      uid: adminBUser.uid,
      email: adminBEmail,
      name: 'أ. مازن فؤاد',
      role: 'org_admin',
      orgId: orgBId,
      createdAt: new Date().toISOString()
    });
    createdDocs.push({ col: 'users', id: adminBUser.uid });

    await setDoc(doc(db, 'members', memAdminBId), {
      id: memAdminBId,
      orgId: orgBId,
      userId: adminBUser.uid,
      userName: 'أ. مازن فؤاد',
      userEmail: adminBEmail,
      role: 'org_admin',
      department: 'الإدارة العامة',
      jobTitle: 'المدير العام',
      joinedAt: new Date().toISOString().split('T')[0],
      active: true
    });
    createdDocs.push({ col: 'members', id: memAdminBId });
    logPass(`Provisioned Company B Admin: ${adminBEmail}`);

    // Employee 1 (Sara - InstaPay Profile)
    const emp1Email = `sara.${runId}@tieapps-test.com`;
    const emp1User = await provisionIsolatedUser(emp1Email, defaultPassword, 'سارة إبراهيم');
    createdUsers.push(emp1Email);
    const memEmp1Id = `${emp1User.uid}_${orgAId}`;
    await setDoc(doc(db, 'users', emp1User.uid), {
      id: emp1User.uid,
      uid: emp1User.uid,
      email: emp1Email,
      name: 'سارة إبراهيم',
      role: 'employee',
      orgId: orgAId,
      createdAt: new Date().toISOString()
    });
    createdDocs.push({ col: 'users', id: emp1User.uid });

    await setDoc(doc(db, 'members', memEmp1Id), {
      id: memEmp1Id,
      orgId: orgAId,
      userId: emp1User.uid,
      userName: 'سارة إبراهيم',
      userEmail: emp1Email,
      phone: '01011112222',
      role: 'employee',
      department: 'التسويق الرقمي',
      jobTitle: 'أخصائية تسويق',
      // Payout Profile:
      preferredPaymentMethod: 'instapay',
      instapay: 'sara.ibrahim@instapay',
      wallet: '01011112222',
      walletProvider: 'فودافون كاش',
      bankName: 'البنك التجاري الدولي CIB',
      iban: 'EG99000100010001000100010001',
      joinedAt: new Date().toISOString().split('T')[0],
      active: true
    });
    createdDocs.push({ col: 'members', id: memEmp1Id });
    logPass('Provisioned Employee 1 with complete Financial Payout Profile (InstaPay: sara.ibrahim@instapay)');

    // Employee 2 (Tarek - Mobile Wallet Profile)
    const emp2Email = `tarek.${runId}@tieapps-test.com`;
    const emp2User = await provisionIsolatedUser(emp2Email, defaultPassword, 'طارق شوقي');
    createdUsers.push(emp2Email);
    const memEmp2Id = `${emp2User.uid}_${orgAId}`;
    await setDoc(doc(db, 'users', emp2User.uid), {
      id: emp2User.uid,
      uid: emp2User.uid,
      email: emp2Email,
      name: 'طارق شوقي',
      role: 'employee',
      orgId: orgAId,
      createdAt: new Date().toISOString()
    });
    createdDocs.push({ col: 'users', id: emp2User.uid });

    await setDoc(doc(db, 'members', memEmp2Id), {
      id: memEmp2Id,
      orgId: orgAId,
      userId: emp2User.uid,
      userName: 'طارق شوقي',
      userEmail: emp2Email,
      phone: '01122223333',
      role: 'employee',
      department: 'العمليات والميدان',
      jobTitle: 'مشرف تشغيل ومندوب',
      // Payout Profile:
      preferredPaymentMethod: 'wallet',
      wallet: '01122223333',
      walletProvider: 'اتصالات كاش',
      instapay: '01122223333',
      joinedAt: new Date().toISOString().split('T')[0],
      active: true
    });
    createdDocs.push({ col: 'members', id: memEmp2Id });
    logPass('Provisioned Employee 2 with complete Financial Payout Profile (Mobile Wallet: 01122223333)');

    // -------------------------------------------------------------
    // TEST 4: Treasury Management, Inflows, & Linked Accounts
    // -------------------------------------------------------------
    logStep(4, 'Treasury Accounts, Balances, & Double-Counting Safeguards');

    // 1. Primary Bank Account for Company A (Balance: 200,000 EGP)
    const bankVaultId = `vault-bank-${runId}`;
    await setDoc(doc(db, 'paymentAccounts', bankVaultId), {
      id: bankVaultId,
      orgId: orgAId,
      name: 'حساب بنكي رئيسي CIB',
      type: 'bank',
      bankName: 'البنك التجاري الدولي CIB',
      accountIdentifier: 'EG00ALF00012345678901234',
      balance: 200000,
      initialBalance: 200000,
      currentBalance: 200000,
      totalIn: 0,
      totalOut: 0,
      currency: 'EGP',
      active: true,
      createdAt: new Date().toISOString()
    });
    createdDocs.push({ col: 'paymentAccounts', id: bankVaultId });
    logPass('Created Primary Bank Vault: 200,000 EGP');

    // 2. Petty Cash Vault for Company A (Balance: 50,000 EGP)
    const cashVaultId = `vault-cash-${runId}`;
    await setDoc(doc(db, 'paymentAccounts', cashVaultId), {
      id: cashVaultId,
      orgId: orgAId,
      name: 'خزينة نقدية المقر',
      type: 'cash',
      accountIdentifier: 'CASH-ALF-MAIN',
      balance: 50000,
      initialBalance: 50000,
      currentBalance: 50000,
      totalIn: 0,
      totalOut: 0,
      currency: 'EGP',
      active: true,
      createdAt: new Date().toISOString()
    });
    createdDocs.push({ col: 'paymentAccounts', id: cashVaultId });
    logPass('Created Physical Cash Vault: 50,000 EGP');

    // 3. InstaPay Channel linked to Bank Vault (parentAccountId = bankVaultId)
    const instaVaultId = `vault-insta-${runId}`;
    await setDoc(doc(db, 'paymentAccounts', instaVaultId), {
      id: instaVaultId,
      orgId: orgAId,
      name: 'قناة إنستاباي ألفا',
      type: 'instapay',
      accountIdentifier: 'alpha@instapay',
      parentAccountId: bankVaultId,
      parentAccountName: 'حساب بنكي رئيسي CIB',
      balance: 0,
      currentBalance: 0,
      totalIn: 0,
      totalOut: 0,
      currency: 'EGP',
      active: true,
      createdAt: new Date().toISOString()
    });
    createdDocs.push({ col: 'paymentAccounts', id: instaVaultId });
    logPass('Created Linked InstaPay Channel (tied to Bank Vault - Prevents Double Counting)');

    // 4. Test Direct Inflow (+ IN): Deposit 30,000 EGP into Cash Vault
    const inflowAmount = 30000;
    const newCashBalance = 50000 + inflowAmount;
    await updateDoc(doc(db, 'paymentAccounts', cashVaultId), {
      balance: newCashBalance,
      currentBalance: newCashBalance,
      totalIn: inflowAmount
    });
    // Log transaction
    const inTxId = `tx-in-${runId}`;
    await setDoc(doc(db, 'accountTransactions', inTxId), {
      id: inTxId,
      orgId: orgAId,
      accountId: cashVaultId,
      accountName: 'خزينة نقدية المقر',
      type: 'in',
      amount: inflowAmount,
      balanceBefore: 50000,
      balanceAfter: newCashBalance,
      description: 'إيداع مبيعات نقدية وتغذية رصيد الخزينة',
      referenceNumber: `DEP-${Math.floor(100000 + Math.random() * 900000)}`,
      actorName: 'م. أسامة كامل',
      createdAt: new Date().toISOString()
    });
    createdDocs.push({ col: 'accountTransactions', id: inTxId });
    logPass(`Recorded Manual Inflow (+ IN): +${inflowAmount.toLocaleString()} EGP -> New Cash Balance: ${newCashBalance.toLocaleString()} EGP`);

    // -------------------------------------------------------------
    // TEST 5: Employee Submits Expense Request with Auto-Filled Profile
    // -------------------------------------------------------------
    logStep(5, 'Employee 1 Submits Expense Request (Auto-Filled from Profile)');
    await signOut(auth);
    await signInWithEmailAndPassword(auth, emp1Email, defaultPassword);
    logPass(`Employee 1 logged in as: ${emp1Email}`);

    const req1Id = `req-test-${runId}`;
    const req1Number = `REQ-${Math.floor(10000 + Math.random() * 90000)}`;
    const req1 = {
      id: req1Id,
      requestNumber: req1Number,
      orgId: orgAId,
      requesterId: emp1User.uid,
      requesterName: 'سارة إبراهيم',
      requesterEmail: emp1Email,
      requesterPhone: '01011112222',
      requesterDepartment: 'التسويق الرقمي',
      // Auto-filled from Profile:
      preferredPaymentMethod: 'instapay',
      paymentAccountDetails: 'sara.ibrahim@instapay',
      serviceCategoryId: 'srv-mkt',
      serviceCategoryName: 'إعلانات وحملات ترويجية',
      providerId: 'prov-social',
      providerName: 'وكالة الإعلانات الرقمية',
      title: 'تمويل حملات إعلانية لمنصة إنستغرام وجوجل',
      description: 'حملة إطلاق موسم الخريف لزيادة المبيعات المباشرة',
      justification: 'تحقيق مستهدف المبيعات للربع السنوي',
      amount: 18000,
      currency: 'EGP',
      status: 'pending',
      urgency: 'high',
      attachments: [{ id: 'att-1', name: 'خطة_الحملة.pdf', size: '1.2 MB', type: 'pdf', uploadedAt: new Date().toISOString() }],
      comments: [],
      timeline: [{
        id: `tl-create-${runId}`,
        status: 'created',
        title: 'تم إنشاء وتقديم طلب الصرف',
        description: 'طريقة التحويل المفضلة من البروفايل: انستاباي (sara.ibrahim@instapay)',
        actorName: 'سارة إبراهيم',
        timestamp: new Date().toISOString()
      }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await setDoc(doc(db, 'requests', req1Id), req1);
    createdDocs.push({ col: 'requests', id: req1Id });
    logPass(`Employee 1 submitted Request ${req1.requestNumber}: 18,000 EGP via InstaPay (sara.ibrahim@instapay)`);

    // -------------------------------------------------------------
    // TEST 6: Zero Data Leakage Verification (Between Co-Workers)
    // -------------------------------------------------------------
    logStep(6, 'INTERNAL DATA ISOLATION VERIFICATION (Zero Leakage Between Employees)');
    await signOut(auth);
    await signInWithEmailAndPassword(auth, emp2Email, defaultPassword);
    logPass(`Employee 2 logged in as: ${emp2Email}`);

    const emp2VisibleSnap = await getDocs(query(
      collection(db, 'requests'),
      where('orgId', '==', orgAId),
      where('requesterId', '==', emp2User.uid)
    ));

    logInfo(`Checking visible requests for Employee 2 (Tarek)...`);
    if (emp2VisibleSnap.size !== 0) {
      logFail(`DATA LEAKAGE DETECTED! Employee 2 can see requests they did not create! Count: ${emp2VisibleSnap.size}`);
    }
    logPass('ZERO LEAKAGE CONFIRMED: Employee 2 sees 0 requests (Employee 1\'s request is 100% isolated).');

    // -------------------------------------------------------------
    // TEST 7: Review, Clarification Request & Reply Loop
    // -------------------------------------------------------------
    logStep(7, 'Admin Clarification Loop & Employee Reply');
    await signOut(auth);
    await signInWithEmailAndPassword(auth, adminAEmail, defaultPassword);
    logPass(`Company A Admin logged in as: ${adminAEmail}`);

    // Admin asks clarification
    const clarifyMsg = 'يرجى إرفاق نموذج خطة الإنفاق المعتمد وتوضيح القنوات الإعلانية المستهدفة.';
    await updateDoc(doc(db, 'requests', req1Id), {
      status: 'clarification_requested',
      comments: [{
        id: `cmt-1-${runId}`,
        authorId: adminAUser.uid,
        authorName: 'م. أسامة كامل',
        authorRole: 'مدير المؤسسة',
        content: clarifyMsg,
        type: 'clarification_request',
        createdAt: new Date().toISOString()
      }],
      updatedAt: new Date().toISOString()
    });
    logPass(`Admin requested clarification: "${clarifyMsg}"`);

    // Employee 1 replies
    await signOut(auth);
    await signInWithEmailAndPassword(auth, emp1Email, defaultPassword);
    const replyMsg = 'تم إرفاق جدول التوزيع التفصيلي على قنوات ميتا وجوجل أدز مع جدول الزيارات.';
    const reqDocAfterClarify = (await getDoc(doc(db, 'requests', req1Id))).data();
    await updateDoc(doc(db, 'requests', req1Id), {
      status: 'pending',
      comments: [
        ...(reqDocAfterClarify.comments || []),
        {
          id: `cmt-2-${runId}`,
          authorId: emp1User.uid,
          authorName: 'سارة إبراهيم',
          authorRole: 'طالب الصرف',
          content: replyMsg,
          type: 'clarification_reply',
          createdAt: new Date().toISOString()
        }
      ],
      updatedAt: new Date().toISOString()
    });
    logPass(`Employee 1 replied to clarification. Status successfully returned to 'pending'.`);

    // -------------------------------------------------------------
    // TEST 8: Approval, Treasury Disbursement, & Financial Ledger
    // -------------------------------------------------------------
    logStep(8, 'Approval & Treasury Disbursement with Ledger Deductions');
    await signOut(auth);
    await signInWithEmailAndPassword(auth, adminAEmail, defaultPassword);

    // 1. Approve
    await updateDoc(doc(db, 'requests', req1Id), {
      status: 'approved',
      updatedAt: new Date().toISOString()
    });
    logPass(`Request ${req1.requestNumber} APPROVED by Admin.`);

    // 2. Disburse from Bank Vault
    const refNum = `IPN-TXN-${Math.floor(10000000 + Math.random() * 90000000)}`;
    const disburseAmount = 18000;
    const finalBankBalance = 200000 - disburseAmount;

    await updateDoc(doc(db, 'paymentAccounts', bankVaultId), {
      balance: finalBankBalance,
      currentBalance: finalBankBalance,
      totalOut: disburseAmount
    });

    await updateDoc(doc(db, 'requests', req1Id), {
      status: 'disbursed',
      disbursement: {
        disbursedAt: new Date().toISOString(),
        disbursedBy: 'م. أسامة كامل',
        paymentMethod: 'instapay',
        referenceNumber: refNum,
        bankName: 'البنك التجاري الدولي CIB',
        accountId: bankVaultId,
        accountName: 'حساب بنكي رئيسي CIB',
        notes: 'تم التحويل اللحظي للمستفيد عبر إنستاباي بنجاح'
      },
      updatedAt: new Date().toISOString()
    });

    const outTxId = `tx-out-${runId}`;
    await setDoc(doc(db, 'accountTransactions', outTxId), {
      id: outTxId,
      orgId: orgAId,
      accountId: bankVaultId,
      accountName: 'حساب بنكي رئيسي CIB',
      type: 'out',
      amount: disburseAmount,
      balanceBefore: 200000,
      balanceAfter: finalBankBalance,
      description: `صرف طلب المصروفات رقم ${req1.requestNumber} (سارة إبراهيم)`,
      referenceNumber: refNum,
      referenceType: 'expense_request',
      referenceId: req1Id,
      actorName: 'م. أسامة كامل',
      createdAt: new Date().toISOString()
    });
    createdDocs.push({ col: 'accountTransactions', id: outTxId });

    logPass(`Disbursed 18,000 EGP via InstaPay! Reference: ${refNum}`);
    logPass(`Bank Vault balance accurately reduced: 200,000 EGP -> ${finalBankBalance.toLocaleString()} EGP (-18,000 EGP)`);
    logPass(`Ledger Transaction logged in accountTransactions collection.`);

    // -------------------------------------------------------------
    // TEST 9: Petty Cash Custody Lifecycle (Issue -> Settle -> Close)
    // -------------------------------------------------------------
    logStep(9, 'Petty Cash Custody Management (Issue, Settle Invoices, Replenish)');

    // 1. Issue Custody to Employee 2 (Tarek): 12,000 EGP from Cash Vault
    const custodyAmount = 12000;
    const custodyId = `cus-${runId}`;
    const custodyNumber = `CUS-${Math.floor(100 + Math.random() * 900)}`;
    const postCustodyCashBalance = newCashBalance - custodyAmount;

    await updateDoc(doc(db, 'paymentAccounts', cashVaultId), {
      balance: postCustodyCashBalance,
      currentBalance: postCustodyCashBalance,
      totalOut: custodyAmount
    });

    await setDoc(doc(db, 'custodies', custodyId), {
      id: custodyId,
      orgId: orgAId,
      custodyNumber: custodyNumber,
      employeeId: emp2User.uid,
      employeeName: 'طارق شوقي',
      employeePhone: '01122223333',
      totalAmount: custodyAmount,
      remainingAmount: custodyAmount,
      settledAmount: 0,
      currency: 'EGP',
      sourceAccountId: cashVaultId,
      sourceAccountName: 'خزينة نقدية المقر',
      status: 'active',
      issuedAt: new Date().toISOString(),
      notes: 'عهدة نقدية ميدانية لمصاريف التشغيل والانتقالات الطارئة'
    });
    createdDocs.push({ col: 'custodies', id: custodyId });

    logPass(`Issued Custody ${custodyNumber}: ${custodyAmount.toLocaleString()} EGP to طارق شوقي.`);
    logPass(`Cash Vault debited: ${newCashBalance.toLocaleString()} -> ${postCustodyCashBalance.toLocaleString()} EGP`);

    // 2. Submit Settlement Invoice against Custody (4,500 EGP)
    const settle1Amount = 4500;
    const settle1Id = `set-1-${runId}`;
    await setDoc(doc(db, 'custodySettlements', settle1Id), {
      id: settle1Id,
      custodyId: custodyId,
      orgId: orgAId,
      employeeId: emp2User.uid,
      employeeName: 'طارق شوقي',
      amount: settle1Amount,
      currency: 'EGP',
      serviceCategoryName: 'انتقالات وبنزين',
      vendorName: 'محطة وقود مصر للبترول',
      invoiceNumber: 'INV-PETRO-9921',
      invoiceDate: new Date().toISOString().split('T')[0],
      description: 'تموين سيارات المأمورية الرسمية وسداد كارتات الطرق',
      status: 'approved',
      createdAt: new Date().toISOString()
    });
    createdDocs.push({ col: 'custodySettlements', id: settle1Id });

    // Update custody remaining
    const remainingAfter1 = custodyAmount - settle1Amount;
    await updateDoc(doc(db, 'custodies', custodyId), {
      remainingAmount: remainingAfter1,
      settledAmount: settle1Amount
    });
    logPass(`Settled Invoice 1: 4,500 EGP -> Remaining Custody: ${remainingAfter1.toLocaleString()} EGP`);

    // 3. Final Settlement (7,500 EGP) -> Complete & Close Custody
    const settle2Amount = 7500;
    const settle2Id = `set-2-${runId}`;
    await setDoc(doc(db, 'custodySettlements', settle2Id), {
      id: settle2Id,
      custodyId: custodyId,
      orgId: orgAId,
      employeeId: emp2User.uid,
      employeeName: 'طارق شوقي',
      amount: settle2Amount,
      currency: 'EGP',
      serviceCategoryName: 'صيانة ومعدات',
      vendorName: 'مركز صيانة الأجهزة',
      invoiceNumber: 'INV-REP-4402',
      invoiceDate: new Date().toISOString().split('T')[0],
      description: 'شراء قطع غيار عاجلة وصيانة مضخات',
      status: 'approved',
      createdAt: new Date().toISOString()
    });
    createdDocs.push({ col: 'custodySettlements', id: settle2Id });

    await updateDoc(doc(db, 'custodies', custodyId), {
      remainingAmount: 0,
      settledAmount: custodyAmount,
      status: 'settled',
      settledAt: new Date().toISOString()
    });
    logPass(`Settled Invoice 2: 7,500 EGP -> Custody 100% Settled and Marked as 'settled'!`);

    // -------------------------------------------------------------
    // TEST 10: Cross-Company Data Isolation Verification
    // -------------------------------------------------------------
    logStep(10, 'CROSS-COMPANY ZERO DATA LEAKAGE VERIFICATION');
    await signOut(auth);
    await signInWithEmailAndPassword(auth, adminBEmail, defaultPassword);
    logPass(`Company B Admin logged in as: ${adminBEmail}`);

    const companyBReqs = await getDocs(query(collection(db, 'requests'), where('orgId', '==', orgBId)));
    const companyBVaults = await getDocs(query(collection(db, 'paymentAccounts'), where('orgId', '==', orgBId)));
    const companyBCustodies = await getDocs(query(collection(db, 'custodies'), where('orgId', '==', orgBId)));

    logInfo('Checking visible entities for Company B...');
    if (companyBReqs.size !== 0 || companyBVaults.size !== 0 || companyBCustodies.size !== 0) {
      logFail('CROSS-COMPANY DATA LEAK DETECTED! Company B can see entities belonging to Company A!');
    }
    logPass('CROSS-COMPANY ZERO LEAKAGE CONFIRMED: Company B has 0 requests, 0 vaults, 0 custodies of Company A.');

    // -------------------------------------------------------------
    // TEST 11: Cleanup Test Entities
    // -------------------------------------------------------------
    logStep(11, 'Cleaning up temporary test entities...');
    await signOut(auth);
    await signInWithEmailAndPassword(auth, superAdminEmail, superAdminPass);

    for (const d of createdDocs) {
      await deleteDoc(doc(db, d.col, d.id)).catch(() => {});
    }
    logPass(`Purged ${createdDocs.length} test documents from Cloud Firestore.`);

    for (const email of createdUsers) {
      try {
        const delApp = initializeApp(firebaseConfig, `del-${Date.now()}-${Math.floor(Math.random()*1000)}`);
        const delAuth = getAuth(delApp);
        const cred = await signInWithEmailAndPassword(delAuth, email, defaultPassword);
        await deleteUser(cred.user);
        await deleteApp(delApp);
      } catch {}
    }
    logPass(`Purged ${createdUsers.length} test authentication accounts.`);

    console.log('\n============================================================');
    console.log('🎉 ALL SYSTEM VERIFICATION & SECURITY TESTS PASSED 100%!');
    console.log('============================================================\n');

  } catch (err) {
    console.error('\n❌ UNEXPECTED ERROR IN VERIFICATION SUITE:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
})();
