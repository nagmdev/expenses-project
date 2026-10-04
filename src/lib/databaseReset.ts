import {
  collection,
  doc,
  getDocsFromServer,
  limit,
  query,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { counterIds } from './backupExport';

export interface ResetStepProgress {
  collection: string;
  label: string;
  deletedCount: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  error?: string;
}

export interface ResetSummary {
  success: boolean;
  totalDeleted: number;
  steps: ResetStepProgress[];
  error?: string;
}

/**
 * Collections to completely wipe when resetting the platform.
 * NOTE: 'users', 'super_admins', 'members', and 'system_settings' are strictly EXCLUDED
 * to preserve user logins, authentication, roles, and platform settings.
 */
export const RESET_COLLECTIONS = [
  { name: 'organizations', label: 'الشركات والمؤسسات' },
  { name: 'paymentAccounts', label: 'الخزائن والحسابات المالية' },
  { name: 'accountTransactions', label: 'حركات الحسابات والقيود' },
  { name: 'requests', label: 'طلبات الصرف' },
  { name: 'visaRequests', label: 'طلبات التأشيرات' },
  { name: 'custodies', label: 'العهد المالية' },
  { name: 'pettyCashCustodies', label: 'العهد القديمة' },
  { name: 'custodySettlements', label: 'تسويات العهد' },
  { name: 'services', label: 'البنود والخدمات' },
  { name: 'providers', label: 'الموردون ومزودو الخدمة' },
  { name: 'departments', label: 'الأقسام الإدارية' },
  { name: 'auditLogs', label: 'سجل التدقيق والعمليات' },
  { name: 'outbox', label: 'صندوق الإشعارات' },
  { name: 'email_logs', label: 'سجل البريد الإلكتروني' },
  { name: 'mail', label: 'رسائل البريد المجدولة' },
  { name: 'legacyRestores', label: 'سجلات الاستعادة' },
  { name: 'uniqueKeys', label: 'مفاتيح منع التكرار' },
  { name: 'attachmentTombstones', label: 'شواهد المرفقات المحذوفة' },
  { name: 'attachments', label: 'المرفقات والملفات' },
  { name: 'counters', label: 'عدادات الأرقام التسلسلية' },
] as const;

export async function resetDatabaseCollections(
  db: Firestore,
  onProgress?: (steps: ResetStepProgress[], currentCollection: string) => void,
  signal?: AbortSignal
): Promise<ResetSummary> {
  const steps: ResetStepProgress[] = RESET_COLLECTIONS.map(c => ({
    collection: c.name,
    label: c.label,
    deletedCount: 0,
    status: 'pending',
  }));

  let totalDeleted = 0;

  for (let i = 0; i < steps.length; i++) {
    if (signal?.aborted) {
      throw new Error('تم إلغاء عملية التصفير من قِبل المستخدم.');
    }

    const step = steps[i];
    step.status = 'in_progress';
    onProgress?.([...steps], step.collection);

    try {
      if (step.collection === 'attachments') {
        // Special handling for attachments: clean up subcollection 'chunks' then the document
        let hasMore = true;
        while (hasMore) {
          if (signal?.aborted) throw new Error('تم إلغاء العملية.');
          const snap = await getDocsFromServer(query(collection(db, 'attachments'), limit(50)));
          if (snap.empty) {
            hasMore = false;
            break;
          }

          for (const attDoc of snap.docs) {
            if (signal?.aborted) throw new Error('تم إلغاء العملية.');
            // Delete chunks of this attachment if any
            try {
              const chunksSnap = await getDocsFromServer(collection(db, 'attachments', attDoc.id, 'chunks'));
              if (!chunksSnap.empty) {
                const chunkBatch = writeBatch(db);
                chunksSnap.docs.forEach(cd => chunkBatch.delete(cd.ref));
                await chunkBatch.commit();
              }
            } catch {
              // Ignore chunk lookup errors
            }

            // Delete metadata document
            const batch = writeBatch(db);
            batch.delete(attDoc.ref);
            await batch.commit();
            step.deletedCount++;
            totalDeleted++;
            onProgress?.([...steps], step.collection);
          }
        }
      } else if (step.collection === 'counters') {
        // Attempt listing first (if allowed by rules)
        let listed = false;
        try {
          let hasMore = true;
          while (hasMore) {
            if (signal?.aborted) throw new Error('تم إلغاء العملية.');
            const snap = await getDocsFromServer(query(collection(db, 'counters'), limit(100)));
            if (snap.empty) {
              hasMore = false;
              break;
            }
            listed = true;
            const batch = writeBatch(db);
            snap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
            step.deletedCount += snap.size;
            totalDeleted += snap.size;
            onProgress?.([...steps], step.collection);

            if (snap.size < 100) {
              hasMore = false;
            }
          }
        } catch {
          // If listing fails, fallback to known counter IDs
        }

        if (!listed) {
          // Fallback to deleting known counter IDs
          const ids = counterIds(new Date());
          for (const cId of ids) {
            if (signal?.aborted) throw new Error('تم إلغاء العملية.');
            try {
              const batch = writeBatch(db);
              batch.delete(doc(db, 'counters', cId));
              await batch.commit();
              step.deletedCount++;
              totalDeleted++;
            } catch {
              // Document might not exist, ignore
            }
          }
          onProgress?.([...steps], step.collection);
        }
      } else {
        // Standard collection batch deletion (batches of 100)
        let hasMore = true;
        const BATCH_SIZE = 100;
        while (hasMore) {
          if (signal?.aborted) throw new Error('تم إلغاء العملية.');
          const snap = await getDocsFromServer(query(collection(db, step.collection), limit(BATCH_SIZE)));
          if (snap.empty) {
            hasMore = false;
            break;
          }

          const batch = writeBatch(db);
          snap.docs.forEach(d => batch.delete(d.ref));
          await batch.commit();
          step.deletedCount += snap.size;
          totalDeleted += snap.size;
          onProgress?.([...steps], step.collection);

          if (snap.size < BATCH_SIZE) {
            hasMore = false;
          }
        }
      }

      step.status = 'completed';
      onProgress?.([...steps], step.collection);
    } catch (err: unknown) {
      step.status = 'failed';
      step.error = err instanceof Error ? err.message : String(err);
      onProgress?.([...steps], step.collection);
      return {
        success: false,
        totalDeleted,
        steps,
        error: `فشل تصفير مجموعة ${step.label} (${step.collection}): ${step.error}`,
      };
    }
  }

  // Clear legacy local storage caches and active org to prevent resurrecting old state
  try {
    localStorage.removeItem('expenses_active_org_id_v3');
    const legacyKeys = [
      'expenses_organizations_v3',
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
    ];
    legacyKeys.forEach(k => {
      try {
        localStorage.removeItem(k);
      } catch {}
    });
  } catch {}

  return {
    success: true,
    totalDeleted,
    steps,
  };
}
