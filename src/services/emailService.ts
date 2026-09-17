import { 
  EmailEventType, 
  EmailNotificationSettings, 
  EmailLogEntry, 
  ExpenseRequest, 
  Organization 
} from '../types';
import { getDb, isFirebaseConfigured, setFirestoreDoc } from '../lib/firebase';

export const DEFAULT_EMAIL_SETTINGS: EmailNotificationSettings = {
  enabled: true,
  notifyOnNewRequest: true,
  notifyOnApproval: true,
  notifyOnDisbursement: true,
  notifyOnClarification: true,
  notifyOnRejection: true,
  senderName: 'نظام مصروفي',
  replyToEmail: 'noreply@expenses-project.com',
  deliveryMethod: 'direct_api',
  directProvider: 'auto',
  directApiKey: '',
  webhookUrl: '',
};

export interface EmailDispatchDetails {
  request?: ExpenseRequest;
  org?: Organization;
  note?: string;
  disbursedVaultName?: string;
  transactionRef?: string;
  clarificationQuestion?: string;
  rejectionReason?: string;
  actorName?: string;
  customSubject?: string;
  customMessage?: string;
}

/**
 * Generate formatted, responsive HTML email content with Arabic RTL layout
 */
export function generateEmailContent(
  eventType: EmailEventType,
  details: EmailDispatchDetails
): { subject: string; html: string; text: string; snippet: string } {
  const req = details.request;
  const orgName = details.org?.name || 'الشركة';
  const reqNumber = req?.requestNumber || 'طلب صرف';
  const amountStr = req ? `${req.amount.toLocaleString()} ${req.currency}` : '';

  let subject = '';
  let badgeTitle = '';
  let badgeColor = '#059669'; // default emerald
  let badgeBg = '#ecfdf5';
  let messageIntro = '';
  let highlightNote = '';

  switch (eventType) {
    case 'new_request':
      subject = `🔔 طلب صرف جديد بانتظار الاعتماد (${reqNumber}) - ${amountStr}`;
      badgeTitle = 'طلب صرف جديد للاعتماد';
      badgeColor = '#d97706';
      badgeBg = '#fffbeb';
      messageIntro = `قام الموظف <strong>${req?.requesterName || 'أحد الموظفين'}</strong> بتقديم طلب صرف جديد بحاجة إلى المراجعة والاعتماد المالي.`;
      if (details.note) highlightNote = details.note;
      break;

    case 'request_approved':
      subject = `✅ تمت الموافقة واعتماد طلبك (${reqNumber}) - ${amountStr}`;
      badgeTitle = 'تم الاعتماد المالي بنجاح';
      badgeColor = '#059669';
      badgeBg = '#ecfdf5';
      messageIntro = `يسرنا إبلاغك بأنه تمت الموافقة والاعتماد المالي على طلب الصرف الخاص بك من قبل <strong>${details.actorName || 'الإدارة'}</strong>، وتم تحويله للخزينة للصرف.`;
      if (details.note) highlightNote = `ملاحظات الاعتماد: ${details.note}`;
      break;

    case 'request_paid':
      subject = `💰 تم صرف المبلغ وإنهاء الطلب (${reqNumber}) - ${amountStr}`;
      badgeTitle = 'تم الصرف والتحويل بنجاح';
      badgeColor = '#0284c7';
      badgeBg = '#f0f9ff';
      messageIntro = `تم تحويل وصرف مبلغ طلب الصرف بالكامل عبر <strong>${req?.preferredPaymentMethod === 'instapay' ? 'إنستاباي' : req?.preferredPaymentMethod === 'bank_transfer' ? 'تحويل بنكي' : 'الخزينة النقدية'}</strong>.`;
      highlightNote = [
        details.disbursedVaultName ? `الخزينة / الحساب المصدر: ${details.disbursedVaultName}` : '',
        details.transactionRef ? `رقم الإيصال / المعاملة: ${details.transactionRef}` : '',
        details.note ? `ملاحظات الصرف: ${details.note}` : ''
      ].filter(Boolean).join('<br/>');
      break;

    case 'clarification_requested':
      subject = `💬 مطلوب مراجعة وتوضيح بخصوص طلب الصرف (${reqNumber})`;
      badgeTitle = 'مطلوب توضيح ومراجعة';
      badgeColor = '#4f46e5';
      badgeBg = '#eef2ff';
      messageIntro = `تمت مراجعة طلبك من قبل <strong>${details.actorName || 'مدير المؤسسة'}</strong> ويرجى الرد على الاستفسار أدناه لاستكمال الإجراءات:`;
      highlightNote = details.clarificationQuestion || details.note || 'يرجى مراجعة تفاصيل الفاتورة أو المستندات المرفقة.';
      break;

    case 'clarification_replied':
      subject = `↩️ تم الرد على استفسار طلب الصرف (${reqNumber})`;
      badgeTitle = 'تم تقديم إيضاح جديد';
      badgeColor = '#0d9488';
      badgeBg = '#f0fdfa';
      messageIntro = `قام الموظف <strong>${req?.requesterName || 'مقدم الطلب'}</strong> بالرد على استفسار المراجعة. الطلب جاهز لإعادة الفحص.`;
      if (details.note) highlightNote = details.note;
      break;

    case 'request_rejected':
      subject = `❌ تم رفض طلب الصرف (${reqNumber}) - ${amountStr}`;
      badgeTitle = 'تم رفض الطلب';
      badgeColor = '#e11d48';
      badgeBg = '#fff1f2';
      messageIntro = `نحيطك علماً بأنه تم رفض طلب الصرف المقدم من قبلك.`;
      highlightNote = details.rejectionReason || details.note ? `سبب الرفض: ${details.rejectionReason || details.note}` : 'لم يتم توضيح سبب الرفض.';
      break;

    case 'test_email':
    default:
      subject = details.customSubject || `🧪 رسالة اختبار إشعارات نظام مصروفي`;
      badgeTitle = 'بريد اختباري ناجح';
      badgeColor = '#7c3aed';
      badgeBg = '#f5f3ff';
      messageIntro = details.customMessage || `هذه رسالة اختبارية لتأكيد عمل محرك الإشعارات البريدية وتوافقه مع منصة مصروفي وFirebase بنجاح تام.`;
      highlightNote = `تم إرسال هذا البريد التجريبي في: ${new Date().toLocaleString('ar-EG')}`;
      break;
  }

  const appUrl = 'https://expenses-project-xi.vercel.app/';

  const detailsRows = req ? `
    <table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 13px; text-align: right;">
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 8px 12px; color: #64748b; font-weight: bold; width: 35%;">رقم الطلب:</td>
        <td style="padding: 8px 12px; color: #0f172a; font-family: monospace; font-weight: bold;">${req.requestNumber}</td>
      </tr>
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 8px 12px; color: #64748b; font-weight: bold;">المؤسسة / الشركة:</td>
        <td style="padding: 8px 12px; color: #0f172a; font-weight: 600;">${orgName}</td>
      </tr>
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 8px 12px; color: #64748b; font-weight: bold;">مقدم الطلب:</td>
        <td style="padding: 8px 12px; color: #0f172a;">${req.requesterName} (${req.requesterEmail || 'بدون إيميل'})</td>
      </tr>
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 8px 12px; color: #64748b; font-weight: bold;">بند الصرف والخدمة:</td>
        <td style="padding: 8px 12px; color: #0f172a;">${req.serviceCategoryName || 'عام'} - ${req.title}</td>
      </tr>
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 8px 12px; color: #64748b; font-weight: bold;">المبلغ المطلوب:</td>
        <td style="padding: 8px 12px; color: #059669; font-size: 15px; font-weight: 800;">${amountStr}</td>
      </tr>
      ${req.preferredPaymentMethod ? `
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 8px 12px; color: #64748b; font-weight: bold;">بيانات التحويل المفضلة:</td>
        <td style="padding: 8px 12px; color: #334155;">
          ${req.preferredPaymentMethod === 'instapay' ? 'إنستاباي' : req.preferredPaymentMethod === 'bank_transfer' ? 'بنكي' : 'نقدي'} 
          ${req.paymentAccountDetails ? `(${req.paymentAccountDetails})` : ''}
        </td>
      </tr>` : ''}
    </table>
  ` : '';

  const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; direction: rtl; text-align: right; color: #1e293b;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f8fafc; padding: 25px 0;">
    <tr>
      <td align="center">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03); border: 1px solid #e2e8f0;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #059669 0%, #0d9488 100%); padding: 28px 30px; text-align: center;">
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center">
                    <div style="display: inline-block; background-color: rgba(255, 255, 255, 0.2); padding: 8px 16px; border-radius: 12px; backdrop-filter: blur(4px); margin-bottom: 10px;">
                      <span style="color: #ffffff; font-size: 20px; font-weight: 900; letter-spacing: -0.5px;">مصروفي</span>
                      <span style="color: #d1fae5; font-size: 11px; margin-right: 6px;">| نظام المصروفات والعهد</span>
                    </div>
                    <div style="color: #ffffff; font-size: 16px; font-weight: 700; margin-top: 4px;">
                      ${details.org?.name || 'إشعار إداري فوري'}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 32px 30px;">
              
              <!-- Status Badge -->
              <div style="display: inline-block; background-color: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeColor}33; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 800; margin-bottom: 18px;">
                ${badgeTitle}
              </div>

              <!-- Message Text -->
              <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #334155;">
                ${messageIntro}
              </p>

              <!-- Optional Highlight Box (Notes, Reasons, Questions) -->
              ${highlightNote ? `
              <div style="background-color: #f1f5f9; border-right: 4px solid ${badgeColor}; padding: 14px 18px; border-radius: 8px; margin: 20px 0; font-size: 13px; line-height: 1.5; color: #1e293b;">
                ${highlightNote}
              </div>` : ''}

              <!-- Request Details Table -->
              ${detailsRows ? `
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; margin: 22px 0;">
                <div style="font-size: 13px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 6px;">
                  📋 تفاصيل طلب الصرف المالي
                </div>
                ${detailsRows}
              </div>` : ''}

              <!-- Call To Action Button -->
              <div style="text-align: center; margin: 30px 0 10px 0;">
                <a href="${appUrl}" target="_blank" style="display: inline-block; background-color: #059669; color: #ffffff; text-decoration: none; font-weight: bold; font-size: 14px; padding: 12px 28px; border-radius: 10px; box-shadow: 0 4px 6px -1px rgba(5, 150, 105, 0.25);">
                  عرض ومتابعة الطلب في النظام 🚀
                </a>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 30px; text-align: center; font-size: 11px; color: #94a3b8; line-height: 1.5;">
              تم إرسال هذا الإشعار تلقائياً من منصة مصروفي لإدارة المصروفات.<br/>
              لأي استفسار يرجى مراجعة إدارة الحسابات في شركتك.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const text = `${subject}\n\n${messageIntro}\n${highlightNote ? `\nملاحظات: ${highlightNote}\n` : ''}${req ? `\nرقم الطلب: ${req.requestNumber}\nالمبلغ: ${amountStr}\nالمقدم: ${req.requesterName}` : ''}\n\nرابط النظام: ${appUrl}`;

  const snippet = `${badgeTitle}: ${req ? `${req.requestNumber} (${amountStr})` : messageIntro}`;

  return { subject, html, text, snippet };
}

/**
 * Sends notification email via Firestore 'mail' collection (Trigger Email extension)
 * or via custom Webhook, and records an entry in the email logs.
 */
export async function sendNotificationEmail(
  eventType: EmailEventType,
  recipientEmails: string | string[],
  details: EmailDispatchDetails,
  settings: EmailNotificationSettings = DEFAULT_EMAIL_SETTINGS
): Promise<EmailLogEntry[]> {
  const recipients = (Array.isArray(recipientEmails) ? recipientEmails : [recipientEmails])
    .map(e => (e || '').trim().toLowerCase())
    .filter(e => e && e.includes('@'));

  if (recipients.length === 0) {
    return [];
  }

  // Check event enabled toggles
  if (!settings.enabled) {
    console.log('[EmailService] Notifications are globally disabled. Skipping dispatch.');
    return [];
  }

  if (eventType === 'new_request' && !settings.notifyOnNewRequest) return [];
  if (eventType === 'request_approved' && !settings.notifyOnApproval) return [];
  if (eventType === 'request_paid' && !settings.notifyOnDisbursement) return [];
  if (eventType === 'clarification_requested' && !settings.notifyOnClarification) return [];
  if (eventType === 'request_rejected' && !settings.notifyOnRejection) return [];

  const { subject, html, text, snippet } = generateEmailContent(eventType, details);
  const now = new Date().toISOString();
  const logEntries: EmailLogEntry[] = [];

  for (const recipient of recipients) {
    const logId = `email-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    let status: 'sent' | 'pending' | 'failed' = 'sent';
    let errorMessage: string | undefined = undefined;

    try {
      // 1. Direct Serverless API Delivery (Vercel + Resend/Brevo)
      if (
        (settings.deliveryMethod === 'direct_api' || !settings.deliveryMethod) &&
        settings.directApiKey &&
        settings.directApiKey.trim().length > 0
      ) {
        try {
          const apiRes = await fetch('/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: recipient,
              subject,
              html,
              text,
              senderName: settings.senderName || 'نظام مصروفي',
              replyTo: settings.replyToEmail,
              provider: settings.directProvider || 'auto',
              apiKey: settings.directApiKey,
            }),
          });
          const apiData = await apiRes.json().catch(() => null);
          if (apiRes.ok && apiData?.success) {
            console.log('[EmailService] Email sent directly via /api/send-email:', apiData);
            status = 'sent';
          } else if (apiData && !apiData.success && !apiData.skipped) {
            console.warn('[EmailService] Direct API notice:', apiData);
            errorMessage = apiData.message || (typeof apiData.error === 'string' ? apiData.error : undefined);
          }
        } catch (err: any) {
          console.warn('[EmailService] Direct API fetch warning:', err);
        }
      }

      // 2. Secondary Firestore Trigger Email collection (and archive)
      if (isFirebaseConfigured() && getDb()) {
        const mailDocId = `mail-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        await setFirestoreDoc('mail', mailDocId, {
          to: [recipient],
          message: {
            subject,
            html,
            text,
          },
          from: settings.senderName ? `"${settings.senderName}" <${settings.replyToEmail || 'noreply@expenses-project.com'}>` : undefined,
          replyTo: settings.replyToEmail || undefined,
          metadata: {
            eventType,
            requestId: details.request?.id,
            requestNumber: details.request?.requestNumber,
            orgId: details.org?.id || details.request?.orgId,
            createdAt: now,
          }
        });
      }

      // 3. Custom Webhook if configured
      if (settings.deliveryMethod === 'webhook' && settings.webhookUrl) {
        await fetch(settings.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient,
            subject,
            html,
            text,
            eventType,
            request: details.request,
            timestamp: now,
          })
        }).catch(err => {
          console.warn('[EmailService] Webhook dispatch warning:', err);
        });
      }

    } catch (err: any) {
      console.error('[EmailService] Dispatch failed for', recipient, err);
      status = 'failed';
      errorMessage = err?.message || 'خطأ أثناء الإرسال';
    }

    const logEntry: EmailLogEntry = {
      id: logId,
      eventType,
      recipientEmail: recipient,
      recipientName: details.request?.requesterName,
      subject,
      snippet,
      requestId: details.request?.id,
      requestNumber: details.request?.requestNumber,
      amount: details.request?.amount,
      currency: details.request?.currency,
      status,
      errorMessage,
      timestamp: now,
    };

    logEntries.push(logEntry);

    // Save log to Firestore 'email_logs' collection for audit and outbox inspection
    if (isFirebaseConfigured() && getDb()) {
      setFirestoreDoc('email_logs', logId, logEntry).catch(() => {});
    }
  }

  return logEntries;
}
