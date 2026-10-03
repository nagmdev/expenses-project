# 04 - Developer Onboarding & Extension Guide (دليل المطور والتوسعة)

> **تصنيف الأدلة البرمجية:**
> - [VERIFIED]: متوافق تماماً مع بيئة التطوير في ويندوز وإعدادات Vite / TypeScript / Tailwind الحالية.

---

## 1. المتطلبات الأساسية للتشغيل (Prerequisites)

- **Node.js:** الإصدار 18 فما فوق (تم التحقق والاختبار على `v24.19.0`).
- **NPM:** الإصدار 10 فما فوق (تم التحقق والاختبار على `11.17.0`).
- **نظام التشغيل:** Windows / macOS / Linux.

---

## 2. أوامر التشغيل والبناء السريعة (Commands)

```bash
# الانتقال لمجلد المشروع
cd C:\Users\HP\.gemini\antigravity\scratch\expense-system

# تثبيت الحزم
npm install

# تشغيل خادم التطوير المحلي
npm run dev

# تشغيل الخادم مع إمكانية الوصول من الشبكة المحلية (LAN Access)
npm run dev -- --host 0.0.0.0 --port 5173

# فحص وتدقيق الرموز البرمجية وبناء الإنتاج
npm run build

# معاينة حزمة الإنتاج
npm run preview
```

---

## 3. خريطة الملفات والمكونات (Source Tree Map)

```
src/
├── types/
│   └── index.ts                  # جميع الواجهات والأنواع (TypeScript Models)
├── data/
│   └── initialData.ts            # البيانات النموذجية الغنية باللغة العربية
├── context/
│   └── AppContext.tsx            # محرك الحالة وإدارة دورة حياة الطلبات والمزامنة
├── components/
│   ├── Header.tsx                # الشريط العلوي مع مبدل المؤسسات والأدوار
│   ├── Sidebar.tsx               # القائمة الجانبية: الصفحات المسموحة لكل دور (TAB_ACCESS في utils/permissions.ts)
│   ├── DashboardAnalytics.tsx    # لوحة التحليلات ومؤشرات الأداء والرسوم البيانية
│   ├── ExpenseRequestsList.tsx   # جدول سجل الطلبات مع الفلترة والبحث المتقدم
│   ├── RequesterTracker.tsx      # شاشة الموظف المستقلة مع شريط المراحل والردود
│   ├── RequestDetailModal.tsx    # نافذة تفاصيل الطلب وإجراءات الاعتماد/الرفض/الصرف
│   ├── NewRequestModal.tsx       # نافذة إنشاء وتقديم طلب صرف جديد
│   ├── ServicesManagement.tsx    # شاشة إدارة بنود الخدمات والميزانيات
│   ├── VendorsManagement.tsx     # شاشة إدارة مقدمي الخدمة والحسابات البنكية
│   └── OrganizationsManagement.tsx # شاشة إدارة المؤسسات والأعضاء
├── App.tsx                       # المكون الرئيسي وتنسيق الشاشات والنوافذ
├── index.css                     # ضبط اتجاه RTL وخط IBM Plex Sans Arabic و Tailwind
└── main.tsx                      # نقطة الدخول (Mount React Root)
```

---

## 4. نقاط التوسعة المستقبلية (Extension Points)

### أ. ربط قاعدة بيانات حقيقية (PostgreSQL / Supabase / Prisma):
حالياً، تدير `AppContext.tsx` العمليات عبر واجهات ومزامنة في `localStorage`.
للترقية لقاعدة بيانات:
- إنشاء مسارات API أو استدعاءات `fetch()` داخل نفس دوال السياق (`createRequest`, `approveRequest`, إلخ).
- نقل نماذج `src/types/index.ts` مباشرة إلى Prisma Schema أو جداول SQL.

### ب. ترقية مصفوفة الاعتمادات إلى مستويات متعددة (Multi-Level Approvals):
تم تصميم الكائن `timeline` و `comments` لدعم سلاسل الاعتماد بسهولة:
- إضافة حقل `approvalStep: number` أو `approvalMatrix` في `ExpenseRequest`.
- تفعيل شرط الصرف بحسب سقف المبلغ (مثال: أقل من 10,000 ريال يحتاج اعتماد المشرف فقط؛ أعلى من ذلك يحتاج اعتماد المدير العام).

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
