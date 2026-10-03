# 04 - Developer Onboarding & Extension Guide (دليل المطور والتوسعة)

> **تصنيف الأدلة البرمجية:**
> - [VERIFIED]: متوافق مع `package.json` و`.github/workflows/ci.yml` و`firebase.json` و`vitest*.config.ts` الحالية.

---

## 1. المتطلبات الأساسية للتشغيل (Prerequisites)

- **Node.js:** الإصدار 24 (هو ما يستخدمه CI في `.github/workflows/ci.yml`) مع NPM المرافق له.
- **Java 21 فما فوق:** مطلوب فقط لاختبارات قواعد الأمان وبيئة الـ e2e المحلية (Firebase emulators؛ `firebase-tools@15` لا يدعم Java أقدم من 21).
- **نظام التشغيل:** Windows / macOS / Linux.
- لا يلزم أي إعداد لتشغيل الواجهة: إن لم تُضبط متغيرات `VITE_FIREBASE_*` يتصل التطبيق بمشروع Firebase الافتراضي `expenses-project-ce1f9` (`DEFAULT_FIREBASE_CONFIG` في `src/lib/firebase.ts`).

---

## 2. أوامر التشغيل والبناء السريعة (Commands)

```bash
# تثبيت الحزم (من جذر المستودع)
npm ci

# تشغيل خادم التطوير المحلي (يتصل بـ Firestore الحقيقي حسب الإعداد)
npm run dev

# الفحص الثابت (oxlint) — نفس خطوة CI
npm run lint

# فحص الأنواع (tsc -b) وبناء الإنتاج إلى dist/
npm run build

# اختبارات الوحدة (vitest: tests/**/*.test.ts، بدون emulator)
npm test

# اختبارات قواعد الأمان على Firestore emulator (Java 21+): tests-rules/**/*.test.ts
npm run test:rules

# معاينة حزمة الإنتاج
npm run preview
```

### بيئة e2e محلية (لا تلمس الإنتاج أبداً)
```bash
npm run e2e:emulators   # Auth + Firestore emulators تحت المشروع demo-expenses-e2e (نافذة منفصلة)
npm run e2e:seed        # بيانات واقعية عبر دوال الـ domain نفسها (tests-e2e/seed.seed.ts)
npm run dev:e2e         # الواجهة على الـ emulators (vite --mode e2e → .env.e2e)
```

### التكامل المستمر (CI)
كل push إلى `main` وكل Pull Request يشغّل في GitHub Actions:
1. `npm run lint`، ثم `npm run build` (فحص الأنواع + البناء)، ثم `npm test`.
2. وظيفة منفصلة: `npm run test:rules` على Firestore emulator (Java 21).

النشر على Vercel يتم تلقائياً من فرع `main`. قواعد `firestore.rules` **لا تُنشر تلقائياً**: ينشرها المالك يدوياً (انظر [06-security-rules-deploy.md](06-security-rules-deploy.md)).

---

## 3. خريطة الملفات والمكونات (Source Tree Map)

```
src/
├── types/index.ts                # جميع الواجهات والأنواع (TypeScript Models)
├── context/AppContext.tsx        # المستمعون (onSnapshot) ودوال التعديل التي تستدعي الـ domain
├── domain/                       # منطق الأعمال: كل عملية Transaction واحدة بمفتاح عملية
│   ├── store.ts                  # عقد DataStore / TxContext + مخزن الذاكرة للاختبارات
│   ├── firestoreStore.ts         # تنفيذ DataStore على Firestore (runTransaction)
│   ├── common.ts                 # المجموعات (COL)، العدّادات، مفاتيح التفرد، التدقيق، فحص الأدوار
│   ├── requests.ts               # إنشاء الطلبات وتعديلها وآلة الحالات والصرف
│   ├── treasury.ts               # الحسابات والحركات والعهد والتحويلات
│   ├── visa.ts                   # التأشيرات ودفعاتها
│   ├── directory.ts              # الشركات، الأعضاء، البنود، الموردون، الأقسام، ترحيل المفاتيح
│   ├── outbox.ts                 # أحداث الإشعارات وإرسالها وإعادة المحاولة
│   ├── analytics.ts              # مؤشرات لوحة التحليلات لكل عملة
│   └── legacyRecovery.ts         # استرجاع البيانات المحلية القديمة إلى Firestore
├── lib/
│   ├── firebase.ts               # تهيئة Firebase (Auth + Firestore بكاش IndexedDB) والإعداد
│   ├── attachments.ts            # رفع وقراءة المرفقات المقسَّمة في Firestore (fsattach://)
│   └── attachmentsCore.ts        # التقسيم والتحقق من النوع والحجم (بدون Firebase)
├── hooks/                        # useSubmitGuard، useAttachmentPreview، useAppNotifications …
├── services/                     # emailService (ناقل الـ outbox)، emailTemplates
├── utils/                        # permissions.ts (من يرى ماذا)، ids.ts (مفاتيح العمليات)، toast …
├── components/                   # الشاشات: لوحة التحليلات، الطلبات، الخزائن، العهد، التأشيرات،
│                                 # البنود، الموردون، الشركات، المستخدمون، الإعدادات، تسجيل الدخول …
├── data/initialData.ts           # مصفوفات فارغة (لا توجد بيانات نموذجية)
├── App.tsx                       # التخطيط وتحميل الشاشات عند الحاجة (lazy) حسب TAB_ACCESS
├── index.css                     # Tailwind v4 + اتجاه RTL
└── main.tsx                      # نقطة الدخول

api/send-email.ts                 # دالة Vercel: ترسل حدث outbox واحد لمستلم واحد بتوكن المستخدم
firestore.rules                   # الحارس الوحيد على الخادم (يُنشر يدوياً)
storage.rules                     # غير منشور (خطة Spark)؛ محفوظ لترقية Blaze مستقبلاً
tests/                            # اختبارات الوحدة (domain على مخزن الذاكرة، المرفقات، الـ outbox، Express)
tests-rules/                      # اختبارات القواعد على الـ emulator: rules / binding / attacks
tests-e2e/                        # بذر بيئة الـ e2e المحلية
server/                           # خادم Express + SQLite مرجعي مستقل (لا يستخدمه التطبيق)
vercel.json                       # ترويسات الأمان وإعادة التوجيه
```

---

## 4. نقاط التوسعة (Extension Points)

### أ. إضافة عملية مالية أو تعديل صلاحية
أي تغيير يمس المال أو الصلاحيات يتم في أربعة أماكن معاً:
1. **الـ domain** (`src/domain/*`): Transaction واحدة، كل القراءات قبل أي كتابة، معرّفات مشتقة من مفتاح العملية (`idFromKey`)،
   الرصيد يُحسب من القيمة المقروءة داخل الـ Transaction عبر `createMovementBatch` / `applyMovement`، وسجل تدقيق وحدث outbox عند الحاجة.
2. **`firestore.rules`**: كل تغيير في رصيد أو إجمالي يجب أن يكون مربوطاً في نفس الـ commit بما يفسّره (`lastLedgerId` / `lastSettlementId` / `lastDisbursedRequestId`).
   راجع حدود القواعد في رأس الملف (1000 تعبير و20 قراءة مستند لكل Transaction).
3. **`src/utils/permissions.ts`**: `PERMISSIONS` و`TAB_ACCESS`، ويتحقق `tests/policies.test.ts` من تطابقها مع الـ domain.
4. **الاختبارات**: اختبار وحدة في `tests/`، واختبار قواعد في `tests-rules/` (عملية مشروعة عبر دالة الـ domain الحقيقية + محاولة هجوم بالـ SDK مباشرة).
   تغيير القواعد يحتاج نشراً يدوياً من المالك.

### ب. ترقية مصفوفة الاعتمادات إلى مستويات متعددة (Multi-Level Approvals)
`timeline` و`comments` تُضاف فقط ولا تُعدَّل، فيمكن بناء سلاسل الاعتماد عليها:
- إضافة حقل `approvalStep: number` أو `approvalMatrix` في `ExpenseRequest`، وانتقال جديد في جدول `TRANSITIONS` (`src/domain/requests.ts`).
- تحديث قسم `match /requests` في القواعد بنفس الانتقال والأدوار، وإلا رفضته قاعدة البيانات.
- مثال: أقل من 10,000 يحتاج اعتماد المالية فقط؛ أعلى من ذلك يحتاج اعتماد مدير الشركة.

### ج. Cloud Storage (عند الترقية إلى خطة Blaze فقط)
المرفقات تعمل داخل Firestore. `VITE_USE_FIREBASE_STORAGE=true` يُفعّل Storage فقط لحذف ملفات رفعتها نسخ قديمة، ويتطلب نشر `storage.rules` (انظر 05، القسم 4.5).

---

## 5. اختبارات المتصفح الشاملة (Playwright E2E)

اختبارات حقيقية في متصفح Chromium (مجلد `tests-browser/`) تعمل على **البيئة المحلية فقط**: محاكيات Firebase (Auth + Firestore) للمشروع التجريبي `demo-expenses-e2e` — لا تتصل بالإنتاج أبداً. كل دور يسجل الدخول على نطاقه الخاص `http://<role>.localhost:5173`، والحسابات وكلمة المرور التجريبية في `tests-e2e/accounts.ts`.

**المتطلبات:** Node 24، و **Java 21** على الـ PATH (لمحاكي Firestore)، ثم مرة واحدة:

```bash
npm ci
npx playwright install chromium        # على Linux/CI: npx playwright install --with-deps chromium
```

**تشغيل كل شيء بأمر واحد** (يشغّل المحاكيات، يزرع البيانات `npm run e2e:seed`، يشغّل Vite بوضع e2e، ثم الاختبارات، ثم يطفئ كل شيء — حوالي 3 إلى 6 دقائق):

```bash
npm run test:e2e
```

**أثناء التطوير** (أسرع — المحاكيات تبقى شغالة):

```bash
npm run e2e:emulators                  # نافذة 1
npm run e2e:seed                       # مرة بعد تشغيل المحاكيات (يمسح ويعيد الزرع)
npx playwright test                    # يشغّل npm run dev:e2e تلقائياً أو يستخدم الشغال
npx playwright test tests-browser/04-custody.spec.ts --headed   # ملف واحد مع إظهار المتصفح
npx playwright show-report             # تقرير HTML (والـ trace لأي اختبار فشل)
```

> **تنبيه:** `npx playwright test` يستخدم أي خادم شغال على المنفذ 5173. لو كان `npm run dev` العادي (المتصل بـ Firebase الحقيقي) هو الشغال، يرفض `tests-browser/global-setup.ts` التشغيل قبل أي اختبار، وكذلك لو المحاكيات غير شغالة أو البيانات غير مزروعة. أوقف `npm run dev` وشغّل `npm run dev:e2e` أو `npm run test:e2e`.

**ما الذي تغطيه:** دورة طلب الصرف كاملة مع رفع صورة فاتورة ومعاينتها (موظف ← مدير ← مالية)، النقر المزدوج على الإرسال والصرف (طلب واحد وصرف واحد)، تبويبان لنفس المسؤول المالي يصرفان نفس الطلب (يُصرف مرة واحدة)، دورة العهدة بمبالغ عشرية مع رد المتبقي وكشف الحساب، التحويل بين الحسابات بكسور، منع تكرار اسم مورد عربي بالتطويل والمسافات، رسائل تسجيل الدخول ونسيت كلمة المرور (نفس الرسالة للبريد غير المسجل)، وصلاحيات الأدوار وعزل الشركات.

**قواعد كتابة الاختبارات:**
- الاختيار بالدور والنص العربي الظاهر (`getByRole`, `getByPlaceholder`, `getByText`) — لا تعتمد على أسماء كلاسات CSS. الدوال المساعدة في `tests-browser/helpers.ts` و `tests-browser/requests.ts`.
- لا انتظار ثابت (`waitForTimeout`): انتظر حالة الواجهة أو حالة Firestore (`expect.poll` مع `fsWhere` / `fsBalance` التي تقرأ من المحاكي للتحقق فقط).
- البيانات تُزرع مرة واحدة لكل تشغيل؛ كل اختبار ينشئ سجلاته بعناوين فريدة (`uniq()`) ويقارن الأرصدة بالفرق (قبل/بعد)، لذلك يمكن تكرار التشغيل على نفس البيانات دون إعادة الزرع. عامل واحد فقط (`workers: 1`) لأن الاختبارات تتشارك نفس الأرصدة.
- في CI تُرفع نتائج `playwright-report/` و `test-results/` (فيها الـ trace) عند الفشل.
