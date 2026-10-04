import {
  collection,
  doc,
  getDocsFromServer,
  limit,
  query,
  updateDoc,
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
 * Ordered in reverse-dependency sequence (children and leaves first, parent organizations last).
 * NOTE: 'users', 'super_admins', and 'system_settings' are strictly EXCLUDED from deletion
 * to preserve user logins, authentication, credentials, and platform configurations.
 * 'members' is wiped because memberships belong to the deleted companies.
 */
export const RESET_COLLECTIONS = [
  // 1. Notifications, logs & mail
  { name: 'mail', label: 'رسائل البريد المجدولة' },
  { name: 'outbox', label: 'صندوق الإشعارات' },
  { name: 'email_logs', label: 'سجل البريد الإلكتروني' },
  { name: 'auditLogs', label: 'سجل التدقيق والعمليات' },
  { name: 'legacyRestores', label: 'سجلات الاستعادة' },
  // 2. Attachments & tombstones
  { name: 'attachmentTombstones', label: 'شواهد المرفقات المحذوفة' },
  { name: 'attachments', label: 'المرفقات والملفات' },
  // 3. Financial movements, settlements & requests
  { name: 'custodySettlements', label: 'تسويات العهد' },
  { name: 'pettyCashCustodies', label: 'العهد القديمة' },
  { name: 'custodies', label: 'العهد المالية' },
  { name: 'requests', label: 'طلبات الصرف' },
  { name: 'visaRequests', label: 'طلبات التأشيرات' },
  { name: 'accountTransactions', label: 'حركات الحسابات والقيود' },
  { name: 'paymentAccounts', label: 'الخزائن والحسابات المالية' },
  // 4. Directory & catalog
  { name: 'services', label: 'البنود والخدمات' },
  { name: 'providers', label: 'الموردون ومزودو الخدمة' },
  { name: 'departments', label: 'الأقسام الإدارية' },
  // 5. Unique keys & counters
  { name: 'uniqueKeys', label: 'مفاتيح منع التكرار' },
  { name: 'counters', label: 'عدادات الأرقام التسلسلية' },
  // 6. Members & organizations (deleted last so parent references remain valid during child deletion)
  { name: 'members', label: 'عضويات وصلاحيات الشركات السابقة' },
  { name: 'organizations', label: 'الشركات والمؤسسات' },
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

  // Extra step for unlinking users
  const userResetStep: ResetStepProgress = {
    collection: 'users_reset',
    label: 'إعادة ضبط الحسابات كمستخدمين عاديين غير منسوبين لشركة',
    deletedCount: 0,
    status: 'pending',
  };
  steps.push(userResetStep);

  let totalDeleted = 0;

  for (let i = 0; i < steps.length; i++) {
    if (signal?.aborted) {
      throw new Error('تم إلغاء عملية التصفير من قِبل المستخدم.');
    }

    const step = steps[i];
    step.status = 'in_progress';
    onProgress?.([...steps], step.collection);

    try {
      if (step.collection === 'users_reset') {
        // Reset users: detach them from deleted orgs, set role to employee (except super_admins)
        const snap = await getDocsFromServer(collection(db, 'users'));
        const nowIso = new Date().toISOString();
        let resetCount = 0;

        for (const userDoc of snap.docs) {
          if (signal?.aborted) throw new Error('تم إلغاء العملية.');
          const data = userDoc.data();
          const isSuperAdmin = data.role === 'super_admin';

          await updateDoc(userDoc.ref, {
            orgId: '',
            memberId: '',
            role: isSuperAdmin ? 'super_admin' : 'employee',
            updatedAt: nowIso,
          });
          resetCount++;
          step.deletedCount = resetCount;
          onProgress?.([...steps], step.collection);
        }
      } else if (step.collection === 'attachments') {
        // Special handling for attachments: clean up subcollection 'chunks', delete meta with tombstone
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

            try {
              const batch = writeBatch(db);
              batch.delete(attDoc.ref);
              const data = attDoc.data();
              batch.set(doc(db, 'attachmentTombstones', attDoc.id), {
                orgId: typeof data?.orgId === 'string' ? data.orgId : '',
                deletedBy: 'system_reset',
                deletedAt: new Date().toISOString(),
              });
              await batch.commit();
              step.deletedCount++;
              totalDeleted++;
            } catch {
              // Attachment might already be tombstoned or removed
            }
            onProgress?.([...steps], step.collection);
          }
        }
      } else if (step.collection === 'paymentAccounts') {
        // Payment accounts: accounts with history cannot be deleted (strict financial rules).
        // Try deleteDoc; if rules refuse because of history, archive/deactivate the account.
        try {
          const snap = await getDocsFromServer(collection(db, 'paymentAccounts'));
          for (const accDoc of snap.docs) {
            if (signal?.aborted) throw new Error('تم إلغاء العملية.');
            try {
              const batch = writeBatch(db);
              batch.delete(accDoc.ref);
              await batch.commit();
              step.deletedCount++;
              totalDeleted++;
            } catch {
              try {
                await updateDoc(accDoc.ref, {
                  active: false,
                  name: `[محذوف] ${accDoc.data().name || ''}`,
                  updatedAt: new Date().toISOString(),
                });
                step.deletedCount++;
                totalDeleted++;
              } catch {
                // Ignore if already deleted/updated
              }
            }
            onProgress?.([...steps], step.collection);
          }
        } catch {
          // If reading paymentAccounts fails, continue
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
              // Document might not exist or rules forbid delete, ignore
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
      const errMsg = err instanceof Error ? err.message : String(err);
      // If a collection cannot be enumerated or deleted due to Firestore security rules
      // (such as mail, legacyRestores, attachmentTombstones, uniqueKeys, counters):
      // Mark it as protected/completed and proceed so all other collections are wiped cleanly!
      step.status = 'completed';
      step.error = /permission|insufficient|missing/i.test(errMsg)
        ? 'محمية بنظام الأمان في قواعد البيانات'
        : errMsg;
      onProgress?.([...steps], step.collection);
      continue;
    }
  }

  // Clear legacy local storage caches and active org to prevent resurrecting old state
  try {
    localStorage.removeItem('expenses_active_org_id_v3');
    const legacyKeys = [
      'expenses_organizations_v3',
      'expenses_members_v3',
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
