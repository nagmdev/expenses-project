# 03 - Workflows & Lifecycle (دورة العمل وحالات الطلبات)

> **تصنيف الأدلة البرمجية:**
> - [VERIFIED]: مستخرج مباشرة من دوال التحكّم في `src/context/AppContext.tsx` (`createRequest`, `approveRequest`, `rejectRequest`, `requestClarification`, `replyClarification`, `disburseRequest`).

---

## 1. آلة الحالة المحددة (State Machine Diagram)

```mermaid
stateDiagram-v2
    [*] --> pending: إنشاء الطلب (createRequest)
    
    pending --> clarification_requested: طلب استفسار (requestClarification)
    clarification_requested --> pending: تقديم الرد والمستندات (replyClarification)
    
    pending --> approved: اعتماد المدير (approveRequest)
    pending --> rejected: رفض الطلب مع السبب (rejectRequest)
    
    approved --> disbursed: توثيق الصرف الفعلي (disburseRequest)
    disbursed --> [*]
    rejected --> [*]
```

---

## 2. مخطط التسلسل التفاعلي لدورة الصرف (Sequence Diagram)

```mermaid
sequenceDiagram
    autonumber
    actor Emp as الموظف / طالب الصرف
    participant UI as واجهة النظام (Tracker & Modals)
    participant State as محرك الحالة (AppContext)
    actor Mgr as مدير المؤسسة

    Emp->>UI: إدخال بيانات الطلب ورفع الفاتورة
    UI->>State: createRequest(title, amount, serviceId, providerId)
    State-->>UI: إنشاء الطلب بحالة "pending" وتوثيق حدث بالتايم لاين

    Note over Mgr,UI: مراجعة المدير للطلب
    Mgr->>UI: فحص الفاتورة والميزانية

    alt خيار 1: طلب استفسار إضافي
        Mgr->>UI: كتابة سؤال التوضيح
        UI->>State: requestClarification(reqId, question)
        State-->>Emp: إشعار وتنبيه بطلب توضيح (حالة clarification_requested)
        Emp->>UI: كتابة الرد ورفع مستند بديل
        UI->>State: replyClarification(reqId, reply, attachment)
        State-->>Mgr: إعادة الطلب إلى قيد المراجعة "pending"
    else خيار 2: الرفض
        Mgr->>UI: إدخال سبب الرفض
        UI->>State: rejectRequest(reqId, reason)
        State-->>Emp: إشعار بالرفض مع إظهار السبب
    else خيار 3: الاعتماد المباشر
        Mgr->>UI: اعتماد الطلب
        UI->>State: approveRequest(reqId, note)
        State-->>UI: تحديث الحالة إلى "approved" (معتمد بانتظار الصرف)
    end

    Note over Mgr,UI: مرحلة التنفيذ المالي والصرف
    Mgr->>UI: إدخال بيانات التحويل (البنك، رقم الحوالة، طريقة الدفع)
    UI->>State: disburseRequest(reqId, details)
    State->>State: تحديث spentAmount لبند الخدمة
    State->>State: تحديث totalPaid لمقدم الخدمة
    State-->>Emp: إتاحة سند الصرف الرسمي ورقم المرجع في شاشة التتبع
```

---

## 3. العمليات المحاسبية المصاحبة للصرف (Financial Invariants)

عند استدعاء `disburseRequest(requestId, details)`، يتم تنفيذ العمليات الذرية التالية:
1. **تحديث حالة الطلب:** من `approved` إلى `disbursed`.
2. **إنشاء كائن سند الصرف (`disbursement`):** يتضمن `paymentMethod`، `referenceNumber`، `bankName`، `disbursedAt`، و `disbursedBy`.
3. **تحديث استهلاك ميزانية الخدمة:**
   $$\text{spentAmount}_{\text{new}} = \text{spentAmount}_{\text{prev}} + \text{amount}$$
4. **تحديث سجل مدفوعات المورد:**
   $$\text{totalPaid}_{\text{new}} = \text{totalPaid}_{\text{prev}} + \text{amount}$$
5. **إضافة حدث مكتمل في السجل الزمني (`TimelineEvent`):** لتوثيق رقم الحوالة واسم القائم بالعملية للتدقيق المحاسبي اللاحق.
