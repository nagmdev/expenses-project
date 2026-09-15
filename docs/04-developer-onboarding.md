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
│   ├── Navbar.tsx                # شريط التبويبات الرئيسي مع شارات التنبيه
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
