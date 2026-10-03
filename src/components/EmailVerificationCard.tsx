import React, { useState } from 'react';
import { Mail, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useSubmitGuard } from '../hooks/useSubmitGuard';

/**
 * Email verification status with "send link" / "check now". Being added to another company
 * by email (an invitation) opens only for a verified address (firestore.rules -> isInviteeOf,
 * users.verifiedEmail), and admin-provisioned password accounts start unverified. An invitation
 * grants through the profile, which stays in a company the person already works in: there the
 * platform owner re-adds the now-proven login (directory.ts -> invitationReplacedBy).
 */
export const EmailVerificationCard: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { emailVerified, sendSuperAdminVerificationEmail, recheckSuperAdminVerification } = useApp();
  const verifyGuard = useSubmitGuard();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  if (emailVerified) {
    return (
      <div className={`flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 ${className}`}>
        <ShieldCheck className="h-3.5 w-3.5" />
        <span>البريد مُفعَّل</span>
      </div>
    );
  }

  const handleSend = () => {
    void verifyGuard.run(async () => {
      const res = await sendSuperAdminVerificationEmail();
      setFeedback({ ok: res.success, text: res.message });
    });
  };
  const handleRecheck = () => {
    void verifyGuard.run(async () => {
      const res = await recheckSuperAdminVerification();
      setFeedback(res.error
        ? { ok: false, text: res.error }
        : res.verified
        ? { ok: true, text: 'تم تفعيل البريد بنجاح. ستظهر لك خلال لحظات أي شركة أُضفت إليها ببريدك. إن كنت تعمل بالفعل في شركة أخرى، اطلب من المشرف العام إعادة إضافتك إلى الشركة الجديدة لتظهر لك.' }
        : { ok: false, text: 'البريد لم يُفعَّل بعد. افتح رابط التفعيل في بريدك أولاً ثم اضغط "تحقق الآن".' });
    });
  };

  return (
    <div className={`p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2 ${className}`}>
      <p className="text-[11px] text-amber-900 leading-relaxed">
        البريد غير مُفعَّل. فعّله حتى تظهر لك أي شركة يضيفك إليها المدير ببريدك (إن كنت تعمل بالفعل في شركة أخرى، يعيد المشرف العام إضافتك بعد التفعيل).
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={verifyGuard.pending}
          onClick={handleSend}
          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-[11px] rounded-lg transition cursor-pointer flex items-center gap-1.5"
        >
          <Mail className="h-3.5 w-3.5" />
          <span>إرسال رابط التفعيل</span>
        </button>
        <button
          type="button"
          disabled={verifyGuard.pending}
          onClick={handleRecheck}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white font-bold text-[11px] rounded-lg transition cursor-pointer"
        >
          تحقق الآن
        </button>
      </div>
      {feedback && (
        <p role="status" className={`text-[11px] font-bold ${feedback.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
          {feedback.text}
        </p>
      )}
    </div>
  );
};
