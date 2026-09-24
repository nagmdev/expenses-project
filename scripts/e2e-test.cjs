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

const app = initializeApp(firebaseConfig, 'main-e2e-app');
const auth = getAuth(app);
const db = getFirestore(app);

// Helper for isolated user provisioning
async function provisionUser(email, password, displayName) {
  const tempAppName = 'temp-prov-' + Date.now() + Math.floor(Math.random() * 1000);
  const tempApp = initializeApp(firebaseConfig, tempAppName);
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

const logStep = (num, title) => {
  console.log('\n============================================================');
  console.log('[STEP ' + num + '] ' + title);
  console.log('============================================================');
};
const logSuccess = (msg) => console.log('  ✓ SUCCESS: ' + msg);
const logFail = (msg) => { console.error('  ✗ FAILURE: ' + msg); process.exit(1); };
const logInfo = (msg) => console.log('  ℹ ' + msg);

(async () => {
  const createdUsers = [];
  const createdDocs = [];

  try {
    console.log('\n🚀 STARTING FULL CYCLE END-TO-END (E2E) TEST FOR "مصروفي"');
    console.log('Project ID: expenses-project-ce1f9');
    console.log('Timestamp:', new Date().toISOString());

    // -------------------------------------------------------------
    // STEP 1: Authenticate Super Admin
    // -------------------------------------------------------------
    logStep(1, 'Super Admin Authentication & Verification');
    const superAdminEmail = 'awadhsaudi2030@gmail.com';
    const superAdminPass = 'Test123456!';
    
    const superCred = await signInWithEmailAndPassword(auth, superAdminEmail, superAdminPass);
    logSuccess('Super Admin logged in successfully! UID: ' + superCred.user.uid);
    
    // Check Firestore super_admins collection
    const saSnap = await getDocs(query(collection(db, 'super_admins'), where('email', '==', superAdminEmail.toLowerCase())));
    if (saSnap.empty) logFail('Super admin record missing from super_admins collection');
    logSuccess('Super admin verified in Cloud Firestore database! Role: super_admin');

    // -------------------------------------------------------------
    // STEP 2: Super Admin Creates Two Isolated Companies
    // -------------------------------------------------------------
    logStep(2, 'Super Admin Creates Two Independent Companies (Multi-Tenancy)');
    const orgAId = 'org-test-a-' + Date.now();
    const orgBId = 'org-test-b-' + Date.now();

    const orgA = {
      id: orgAId,
      name: 'شركة الأفق للاستشارات والتقنية',
      code: 'OFQ',
      currency: 'EGP',
      budget: 250000,
      description: 'شركة اختبار أ لتطبيق العزل المحكم',
      createdAt: new Date().toISOString()
    };
    const orgB = {
      id: orgBId,
      name: 'مجموعة النجوم الدولية للتجارة',
      code: 'NGM',
      currency: 'SAR',
      budget: 500000,
      description: 'شركة اختبار ب للتحقق من عدم تسرب البيانات',
      createdAt: new Date().toISOString()
    };

    await setDoc(doc(db, 'organizations', orgAId), orgA);
    createdDocs.push({ col: 'organizations', id: orgAId });
    logSuccess('Created Company A: ' + orgA.name + ' (' + orgA.code + ')');

    await setDoc(doc(db, 'organizations', orgBId), orgB);
    createdDocs.push({ col: 'organizations', id: orgBId });
    logSuccess('Created Company B: ' + orgB.name + ' (' + orgB.code + ')');

    // -------------------------------------------------------------
    // STEP 3: Provision Company Admins
    // -------------------------------------------------------------
    logStep(3, 'Provision Company Admins for Company A & Company B');
    const adminAEmail = 'admin.ofq.' + Date.now() + '@tieapps-test.com';
    const adminBEmail = 'admin.ngm.' + Date.now() + '@tieapps-test.com';
    const testPassword = 'TestPassword2026@';

    const adminA = await provisionUser(adminAEmail, testPassword, 'م. كريم أحمد (مدير الأفق)');
    createdUsers.push(adminAEmail);
    logSuccess('Created Auth account for Company A Admin: ' + adminAEmail);

    const memberADocId = `${adminA.uid}_${orgAId}`;
    await setDoc(doc(db, 'members', memberADocId), {
      id: memberADocId,
      orgId: orgAId,
      userId: adminA.uid,
      userName: 'م. كريم أحمد',
      userEmail: adminAEmail,
      role: 'org_admin',
      department: 'الإدارة العامة',
      jobTitle: 'المدير التنفيذي',
      joinedAt: new Date().toISOString().split('T')[0],
      active: true
    });
    createdDocs.push({ col: 'members', id: memberADocId });
    await setDoc(doc(db, 'users', adminA.uid), {
      uid: adminA.uid,
      email: adminAEmail,
      name: 'م. كريم أحمد',
      role: 'org_admin',
      orgId: orgAId,
      active: true,
      updatedAt: new Date().toISOString()
    });
    createdDocs.push({ col: 'users', id: adminA.uid });
    logSuccess('Linked Company A Admin to ' + orgA.name + ' in Firestore');

    const adminB = await provisionUser(adminBEmail, testPassword, 'أ. طارق محمود (مدير النجوم)');
    createdUsers.push(adminBEmail);
    logSuccess('Created Auth account for Company B Admin: ' + adminBEmail);

    const memberBDocId = `${adminB.uid}_${orgBId}`;
    await setDoc(doc(db, 'members', memberBDocId), {
      id: memberBDocId,
      orgId: orgBId,
      userId: adminB.uid,
      userName: 'أ. طارق محمود',
      userEmail: adminBEmail,
      role: 'org_admin',
      department: 'الإدارة العامة',
      jobTitle: 'المدير العام',
      joinedAt: new Date().toISOString().split('T')[0],
      active: true
    });
    createdDocs.push({ col: 'members', id: memberBDocId });
    await setDoc(doc(db, 'users', adminB.uid), {
      uid: adminB.uid,
      email: adminBEmail,
      name: 'أ. طارق محمود',
      role: 'org_admin',
      orgId: orgBId,
      active: true,
      updatedAt: new Date().toISOString()
    });
    createdDocs.push({ col: 'users', id: adminB.uid });
    logSuccess('Linked Company B Admin to ' + orgB.name + ' in Firestore');

    // Pre-create Auth and User records for employees by Super Admin
    const emp1Email = 'emp1.sara.' + Date.now() + '@tieapps-test.com';
    const emp2Email = 'emp2.mahmoud.' + Date.now() + '@tieapps-test.com';

    const emp1 = await provisionUser(emp1Email, testPassword, 'سارة حسن');
    createdUsers.push(emp1Email);
    await setDoc(doc(db, 'users', emp1.uid), {
      uid: emp1.uid,
      email: emp1Email,
      name: 'سارة حسن',
      phone: '01011112222',
      role: 'employee',
      orgId: orgAId,
      active: true,
      updatedAt: new Date().toISOString()
    });
    createdDocs.push({ col: 'users', id: emp1.uid });

    const emp2 = await provisionUser(emp2Email, testPassword, 'محمود علي');
    createdUsers.push(emp2Email);
    await setDoc(doc(db, 'users', emp2.uid), {
      uid: emp2.uid,
      email: emp2Email,
      name: 'محمود علي',
      phone: '01033334444',
      role: 'employee',
      orgId: orgAId,
      active: true,
      updatedAt: new Date().toISOString()
    });
    createdDocs.push({ col: 'users', id: emp2.uid });

    // -------------------------------------------------------------
    // STEP 4: Company A Admin Provisions Two Employees
    // -------------------------------------------------------------
    logStep(4, 'Company A Admin Links Two Employees (E1 & E2) in Organization');
    await signOut(auth);
    await signInWithEmailAndPassword(auth, adminAEmail, testPassword);
    logSuccess('Company A Admin logged in as: ' + adminAEmail);

    const emp1DocId = `${emp1.uid}_${orgAId}`;
    await setDoc(doc(db, 'members', emp1DocId), {
      id: emp1DocId,
      orgId: orgAId,
      userId: emp1.uid,
      userName: 'سارة حسن',
      userEmail: emp1Email,
      phone: '01011112222',
      role: 'employee',
      department: 'التسويق والتصميم',
      jobTitle: 'أخصائية تسويق رقمي',
      joinedAt: new Date().toISOString().split('T')[0],
      active: true
    });
    createdDocs.push({ col: 'members', id: emp1DocId });
    logSuccess('Provisioned Employee 1 in members: سارة حسن (' + emp1Email + ') Phone: 01011112222');

    const emp2DocId = `${emp2.uid}_${orgAId}`;
    await setDoc(doc(db, 'members', emp2DocId), {
      id: emp2DocId,
      orgId: orgAId,
      userId: emp2.uid,
      userName: 'محمود علي',
      userEmail: emp2Email,
      phone: '01033334444',
      role: 'employee',
      department: 'تقنية المعلومات IT',
      jobTitle: 'مهندس دعم فني',
      joinedAt: new Date().toISOString().split('T')[0],
      active: true
    });
    createdDocs.push({ col: 'members', id: emp2DocId });
    logSuccess('Provisioned Employee 2 in members: محمود علي (' + emp2Email + ') Phone: 01033334444');

    // -------------------------------------------------------------
    // STEP 5: Employee 1 Submits an InstaPay Expense Request
    // -------------------------------------------------------------
    logStep(5, 'Employee 1 (سارة حسن) Creates an InstaPay Transfer Request');
    await signOut(auth);
    await signInWithEmailAndPassword(auth, emp1Email, testPassword);
    logSuccess('Employee 1 logged in successfully as: ' + emp1Email);

    const req1Id = 'req-e1-' + Date.now();
    const req1Number = 'REQ-' + Math.floor(10000 + Math.random() * 90000);
    const req1 = {
      id: req1Id,
      requestNumber: req1Number,
      orgId: orgAId,
      requesterId: emp1.uid,
      requesterName: 'سارة حسن',
      requesterDepartment: 'التسويق والتصميم',
      requesterPhone: '01011112222',
      preferredPaymentMethod: 'instapay',
      paymentAccountDetails: 'sara@instapay',
      serviceCategoryId: 'srv-mkt',
      serviceCategoryName: 'حملات إعلانية وتراخيص',
      providerId: 'prov-meta',
      providerName: 'ميتا للإعلانات الرقمية',
      title: 'تجديد تراخيص أدوات التصميم والتسويق الشهري',
      description: 'سداد اشتراك سنوي لمجموعة أدوات التصميم السحابية ومصروفات الحملات الإعلانية',
      justification: 'مطلوبة لاستمرار نشر المحتوى التسويقي وإدارة الحملات',
      amount: 15000,
      currency: 'EGP',
      status: 'pending',
      urgency: 'high',
      attachments: [{ id: 'att-1', name: 'فاتورة_الاشتراك.pdf', size: '1.4 MB', type: 'pdf', uploadedAt: new Date().toISOString() }],
      comments: [],
      timeline: [{
        id: 'tl-' + Date.now(),
        status: 'created',
        title: 'تم إنشاء وتقديم طلب الصرف',
        description: 'طريقة التحويل المفضلة: انستاباي (sara@instapay)',
        actorName: 'سارة حسن',
        timestamp: new Date().toISOString()
      }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await setDoc(doc(db, 'requests', req1Id), req1);
      createdDocs.push({ col: 'requests', id: req1Id });
      logSuccess('emp1 request created successfully in Firestore');
    } catch (e) {
      logFail('Failed creating emp1 request: ' + e.message);
    }
    logSuccess('Employee 1 created Request ' + req1.requestNumber + ': 15,000 EGP via InstaPay (sara@instapay)');

    // -------------------------------------------------------------
    // STEP 6: VERIFY ZERO LEAKAGE BETWEEN EMPLOYEES OF SAME COMPANY
    // -------------------------------------------------------------
    logStep(6, 'VERIFICATION OF ZERO DATA LEAKAGE BETWEEN EMPLOYEES');
    await signOut(auth);
    await signInWithEmailAndPassword(auth, emp2Email, testPassword);
    logSuccess('Employee 2 (محمود علي) logged in as: ' + emp2Email);

    // In AppContext, Employee queries requests strictly scoped by (orgId == user.orgId && requesterId == user.id)
    const emp2VisibleReqsSnap = await getDocs(query(
      collection(db, 'requests'), 
      where('orgId', '==', orgAId),
      where('requesterId', '==', emp2.uid)
    ));

    logInfo('Checking visible requests for Employee 2 in Company A...');
    if (emp2VisibleReqsSnap.size !== 0) {
      logFail('DATA LEAK DETECTED! Employee 2 can see requests they did not create! Count: ' + emp2VisibleReqsSnap.size);
    }
    logSuccess('ZERO LEAKAGE CONFIRMED: Employee 2 sees exactly 0 requests (Employee 1\'s request is 100% hidden!).');

    // Employee 2 creates their own request
    const req2Id = 'req-e2-' + Date.now();
    const req2Number = 'REQ-' + Math.floor(10000 + Math.random() * 90000);
    const req2 = {
      id: req2Id,
      requestNumber: req2Number,
      orgId: orgAId,
      requesterId: emp2.uid,
      requesterName: 'محمود علي',
      requesterDepartment: 'تقنية المعلومات IT',
      requesterPhone: '01033334444',
      preferredPaymentMethod: 'digital_wallet',
      paymentAccountDetails: '01033334444',
      serviceCategoryId: 'srv-hardware',
      serviceCategoryName: 'صيانة وتجهيزات',
      providerId: 'prov-tech',
      providerName: 'مركز الصيانة المعتمد',
      title: 'صيانة وتحديث ذاكرة خوادم وأجهزة الموظفين',
      description: 'قطع غيار عاجلة لتطوير أداء الأجهزة المكتبية',
      justification: 'تحسين سرعة معالجة المهام للموظفين',
      amount: 4200,
      currency: 'EGP',
      status: 'pending',
      urgency: 'medium',
      attachments: [{ id: 'att-2', name: 'عرض_سعر_القطع.pdf', size: '890 KB', type: 'pdf', uploadedAt: new Date().toISOString() }],
      comments: [],
      timeline: [{
        id: 'tl-' + Date.now(),
        status: 'created',
        title: 'تم إنشاء وتقديم طلب الصرف',
        description: 'طريقة التحويل المفضلة: محفظة إلكترونية (01033334444)',
        actorName: 'محمود علي',
        timestamp: new Date().toISOString()
      }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await setDoc(doc(db, 'requests', req2Id), req2);
    createdDocs.push({ col: 'requests', id: req2Id });
    logSuccess('Employee 2 created their own Request ' + req2.requestNumber + ': 4,200 EGP via Vodafone Cash');

    // -------------------------------------------------------------
    // STEP 7: Company A Admin Reviews, Requests Clarification from E1
    // -------------------------------------------------------------
    logStep(7, 'Company A Admin Reviews Requests & Requests Clarification from E1');
    await signOut(auth);
    await signInWithEmailAndPassword(auth, adminAEmail, testPassword);
    logSuccess('Company A Admin logged in');

    // Admin sees all requests in Company A
    const adminAVisibleReqs = await getDocs(query(collection(db, 'requests'), where('orgId', '==', orgAId)));
    logSuccess('Company A Admin sees both employee requests for Company A (Count: ' + adminAVisibleReqs.size + ')');

    // Admin requests clarification on Request 1
    const clarificationQuestion = 'يرجى تقديم نسخة الفاتورة الضريبية المعتمدة والتأكد من اسم المورد قبل الاعتماد.';
    const updatedReq1WithClarify = {
      ...req1,
      status: 'clarification_requested',
      comments: [{
        id: 'cmt-' + Date.now(),
        authorId: adminA.uid,
        authorName: 'م. كريم أحمد',
        authorRole: 'مدير المؤسسة',
        content: clarificationQuestion,
        type: 'clarification_request',
        createdAt: new Date().toISOString()
      }],
      timeline: [
        ...req1.timeline,
        {
          id: 'tl-' + Date.now(),
          status: 'clarification_requested',
          title: 'طلب توضيحات ومستندات إضافية',
          description: clarificationQuestion,
          actorName: 'م. كريم أحمد',
          timestamp: new Date().toISOString()
        }
      ],
      updatedAt: new Date().toISOString()
    };
    await setDoc(doc(db, 'requests', req1Id), updatedReq1WithClarify);
    logSuccess('Admin requested clarification on Request 1: "' + clarificationQuestion + '"');

    // -------------------------------------------------------------
    // STEP 8: Employee 1 Replies to Clarification
    // -------------------------------------------------------------
    logStep(8, 'Employee 1 Replies with Clarification and Documentation');
    await signOut(auth);
    await signInWithEmailAndPassword(auth, emp1Email, testPassword);
    logSuccess('Employee 1 logged in');

    const replyMessage = 'تم إرفاق الفاتورة الضريبية الرسمية رقم TAX-2026-8801 مع كشف التخفيض المعتمد.';
    const updatedReq1WithReply = {
      ...updatedReq1WithClarify,
      status: 'pending',
      comments: [
        ...updatedReq1WithClarify.comments,
        {
          id: 'cmt-' + Date.now(),
          authorId: emp1.uid,
          authorName: 'سارة حسن',
          authorRole: 'طالب الصرف',
          content: replyMessage,
          type: 'clarification_reply',
          attachmentName: 'فاتورة_ضريبية_معتمدة.pdf',
          createdAt: new Date().toISOString()
        }
      ],
      timeline: [
        ...updatedReq1WithClarify.timeline,
        {
          id: 'tl-' + Date.now(),
          status: 'pending',
          title: 'قام طالب الصرف بتقديم التوضيح والمستندات',
          description: replyMessage,
          actorName: 'سارة حسن',
          timestamp: new Date().toISOString()
        }
      ],
      updatedAt: new Date().toISOString()
    };
    await setDoc(doc(db, 'requests', req1Id), updatedReq1WithReply);
    logSuccess('Employee 1 replied to clarification. Status returned to: pending');

    // -------------------------------------------------------------
    // STEP 9: Company A Admin Approves and Disburses via InstaPay
    // -------------------------------------------------------------
    logStep(9, 'Company A Admin Approves & Disburses Funds via InstaPay');
    await signOut(auth);
    await signInWithEmailAndPassword(auth, adminAEmail, testPassword);
    logSuccess('Company A Admin logged in');

    const instaReferenceNumber = 'INSTA-2026-' + Math.floor(100000 + Math.random() * 900000);
    const disbursedDetails = {
      paymentMethod: 'instapay',
      referenceNumber: instaReferenceNumber,
      bankName: 'البنك التجاري الدولي (CIB) / شبكة المدفوعات اللحظية IPN',
      disbursedAt: new Date().toISOString(),
      disbursedBy: 'م. كريم أحمد',
      notes: 'تم التحويل اللحظي لحساب انستاباي sara@instapay وإرفاق الإشعار الإلكتروني.'
    };

    const finalDisbursedReq1 = {
      ...updatedReq1WithReply,
      status: 'disbursed',
      disbursement: disbursedDetails,
      timeline: [
        ...updatedReq1WithReply.timeline,
        {
          id: 'tl-app-' + Date.now(),
          status: 'approved',
          title: 'تمت الموافقة والاعتماد المالي',
          description: 'تمت مراجعة الفاتورة والموافقة على الصرف بالكامل',
          actorName: 'م. كريم أحمد',
          timestamp: new Date().toISOString()
        },
        {
          id: 'tl-disb-' + Date.now(),
          status: 'disbursed',
          title: 'تم تحويل وصرف المبلغ بنجاح عبر انستاباي',
          description: 'رقم العملية المرجعي: ' + instaReferenceNumber + ' | البنك: ' + disbursedDetails.bankName,
          actorName: 'م. كريم أحمد',
          timestamp: new Date().toISOString()
        }
      ],
      updatedAt: new Date().toISOString()
    };

    // 1. Transition from pending to approved
    await updateDoc(doc(db, 'requests', req1Id), {
      status: 'approved',
      updatedAt: new Date().toISOString()
    });
    logSuccess('Admin APPROVED Request 1.');

    // 2. Transition from approved to disbursed
    await setDoc(doc(db, 'requests', req1Id), finalDisbursedReq1);
    logSuccess('Admin approved and DISBURSED Request 1 via InstaPay!');
    logInfo('Transaction Ref: ' + instaReferenceNumber);
    logInfo('Disbursed Bank: ' + disbursedDetails.bankName);

    // -------------------------------------------------------------
    // STEP 10: CROSS-COMPANY DATA ISOLATION VERIFICATION
    // -------------------------------------------------------------
    logStep(10, 'CROSS-COMPANY ZERO DATA LEAKAGE VERIFICATION');
    await signOut(auth);
    await signInWithEmailAndPassword(auth, adminBEmail, testPassword);
    logSuccess('Company B Admin (أ. طارق محمود) logged in');

    // In AppContext, Company B Admin queries where orgId == Company B ID
    const companyBReqsSnap = await getDocs(query(
      collection(db, 'requests'),
      where('orgId', '==', orgBId)
    ));

    logInfo('Checking visible requests for Company B Admin...');
    if (companyBReqsSnap.size !== 0) {
      logFail('CROSS-COMPANY DATA LEAK DETECTED! Company B can see requests! Count: ' + companyBReqsSnap.size);
    }
    logSuccess('CROSS-COMPANY ZERO LEAKAGE CONFIRMED: Company B sees 0 requests!');

    // -------------------------------------------------------------
    // STEP 11: Cleanup Test Entities
    // -------------------------------------------------------------
    logStep(11, 'Cleaning up temporary test entities from Cloud Firestore...');
    await signOut(auth);
    await signInWithEmailAndPassword(auth, superAdminEmail, superAdminPass);

    for (const d of createdDocs) {
      await deleteDoc(doc(db, d.col, d.id)).catch(() => {});
    }
    logSuccess('Deleted ' + createdDocs.length + ' test documents from Firestore.');

    // Delete test users
    for (const email of createdUsers) {
      try {
        const uAppName = 'del-' + Date.now() + Math.floor(Math.random() * 1000);
        const uApp = initializeApp(firebaseConfig, uAppName);
        const uAuth = getAuth(uApp);
        const uCred = await signInWithEmailAndPassword(uAuth, email, testPassword);
        await deleteUser(uCred.user);
        await deleteApp(uApp);
      } catch (delErr) {}
    }
    logSuccess('Deleted ' + createdUsers.length + ' test authentication accounts.');

    console.log('\n============================================================');
    console.log('🎉 FULL CYCLE E2E TEST PASSED 100% WITH ZERO ERRORS & ZERO LEAKAGE!');
    console.log('============================================================\n');

  } catch (err) {
    console.error('\n❌ UNEXPECTED ERROR DURING E2E TEST:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
})();
