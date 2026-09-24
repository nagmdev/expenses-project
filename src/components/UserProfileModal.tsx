import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { 
  User, 
  Lock, 
  KeyRound, 
  Eye, 
  EyeOff, 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  X, 
  Crown, 
  Building2, 
  Phone, 
  Mail, 
  Save, 
  Check
} from 'lucide-react';
import { sanitizePhone, handleNumericKeyDown } from '../utils/validation';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({ isOpen, onClose }) => {
  const { 
    currentUser, 
    firebaseUser, 
    currentRole, 
    activeOrg, 
    updateUserProfileInfo, 
    changeCurrentUserPassword 
  } = useApp();

  const [activeTab, setActiveTab] = useState<'profile' | 'security'>('profile');

  // Profile Form States
  const [displayName, setDisplayName] = useState(currentUser.name || '');
  const [phone, setPhone] = useState(currentUser.phone || '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Security / Password Form States
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Close on Escape key press for accessibility
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Handle Save Profile
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;

    setProfileError(null);
    setProfileSuccess(false);
    setProfileSaving(true);

    const res = await updateUserProfileInfo(displayName.trim(), phone.trim());
    setProfileSaving(false);

    if (res.success) {
      setProfileSuccess(true);
      setTimeout(() => setProfileSuccess(false), 3500);
    } else {
      setProfileError(res.error || 'تعذر تحديث البيانات');
    }
  };

  // Handle Change Password
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    if (!currentPassword) {
      setPasswordError('يرجى إدخال كلمة المرور الحالية.');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('كلمة المرور الجديدة يجب أن تتكون من 6 خانات على الأقل.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('كلمة المرور الجديدة غير متطابقة مع تأكيد كلمة المرور.');
      return;
    }

    setPasswordSaving(true);
    const res = await changeCurrentUserPassword(currentPassword, newPassword);
    setPasswordSaving(false);

    if (res.success) {
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(false), 5000);
    } else {
      setPasswordError(res.error || 'تعذر تغيير كلمة المرور.');
    }
  };

  // Password strength calculation
  const getPasswordStrength = (pass: string) => {
    if (!pass) return 0;
    let score = 0;
    if (pass.length >= 6) score += 1;
    if (pass.length >= 8) score += 1;
    if (/[A-Z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^A-Za-z0-9]/.test(pass)) score += 1;
    return Math.min(score, 4);
  };

  const strength = getPasswordStrength(newPassword);

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-150 overflow-y-auto overscroll-contain"
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-profile-title"
    >
      <div 
        className="bg-white rounded-3xl max-w-lg w-full shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh] my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 text-white relative">
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق النافذة"
            className="absolute top-5 left-5 p-1.5 text-slate-400 hover:text-white bg-white/10 hover:bg-white/20 rounded-xl transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-black text-2xl shadow-xl shadow-emerald-900/40 shrink-0">
              {(currentUser.name || 'U').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 id="user-profile-title" className="text-lg font-black">{currentUser.name}</h3>
                {currentRole === 'super_admin' && (
                  <span className="flex items-center gap-1 text-[11px] bg-amber-400/20 text-amber-300 border border-amber-400/30 px-2 py-0.5 rounded-full font-bold">
                    <Crown className="h-3 w-3 text-amber-400" />
                    سوبر أدمن
                  </span>
                )}
                {currentRole === 'org_admin' && (
                  <span className="text-[11px] bg-indigo-400/20 text-indigo-300 border border-indigo-400/30 px-2 py-0.5 rounded-full font-bold">
                    مدير الشركة
                  </span>
                )}
                {currentRole === 'finance' && (
                  <span className="text-[11px] bg-purple-400/20 text-purple-300 border border-purple-400/30 px-2 py-0.5 rounded-full font-bold">
                    💸 مسؤول الصرف والخزينة
                  </span>
                )}
                {currentRole === 'employee' && (
                  <span className="text-[11px] bg-emerald-400/20 text-emerald-300 border border-emerald-400/30 px-2 py-0.5 rounded-full font-bold">
                    موظف
                  </span>
                )}
                {currentRole === 'data_entry' && (
                  <span className="text-[11px] bg-sky-400/20 text-sky-300 border border-sky-400/30 px-2 py-0.5 rounded-full font-bold">
                    مدخل بيانات
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300 font-mono mt-0.5 flex items-center gap-1">
                <Mail className="h-3 w-3 text-slate-400" />
                {firebaseUser?.email || currentUser.email}
              </p>
              {activeOrg && (
                <p className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1 font-medium">
                  <Building2 className="h-3 w-3" />
                  {activeOrg.name} ({activeOrg.code})
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-100 bg-slate-50/70 px-6 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`flex items-center gap-2 pb-3 px-3 text-xs font-bold transition border-b-2 cursor-pointer ${
              activeTab === 'profile'
                ? 'border-emerald-600 text-emerald-700 font-black'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <User className="h-4 w-4" />
            <span>البيانات الشخصية</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('security')}
            className={`flex items-center gap-2 pb-3 px-3 text-xs font-bold transition border-b-2 cursor-pointer ${
              activeTab === 'security'
                ? 'border-emerald-600 text-emerald-700 font-black'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Lock className="h-4 w-4" />
            <span>تغيير كلمة المرور والأمان</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {activeTab === 'profile' ? (
            /* TAB 1: Profile Information */
            <form onSubmit={handleSaveProfile} className="space-y-4 text-xs">
              {profileSuccess && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-2xl flex items-center gap-2 font-bold animate-in fade-in">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>تم حفظ وتحديث بيانات الملف الشخصي بنجاح!</span>
                </div>
              )}

              {profileError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-2xl flex items-center gap-2 font-bold">
                  <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                  <span>{profileError}</span>
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-700 mb-1">الاسم بالكامل *</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="اكتب اسمك الكامل..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-900 font-bold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">البريد الإلكتروني المعتمد</label>
                <div className="flex items-center gap-2 w-full p-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-600 font-mono text-xs">
                  <Mail className="h-4 w-4 text-slate-400 shrink-0" />
                  <span>{firebaseUser?.email || currentUser.email}</span>
                  <span className="mr-auto text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">موثق ومؤمن</span>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">رقم الهاتف المحمول (أرقام فقط)</label>
                <div className="relative">
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onKeyDown={(e) => handleNumericKeyDown(e, false)}
                    onChange={(e) => setPhone(sanitizePhone(e.target.value))}
                    placeholder="010xxxxxxxx أو 05xxxxxxxx"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                  <Phone className="h-4 w-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={profileSaving}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {profileSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>جاري الحفظ...</span>
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      <span>حفظ التعديلات</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            /* TAB 2: Change Password & Security */
            <form onSubmit={handleChangePassword} className="space-y-4 text-xs">
              {passwordSuccess && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-2xl flex items-center gap-2 font-bold animate-in fade-in">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>تم تغيير كلمة المرور بنجاح! تم تحديث بيانات الدخول.</span>
                </div>
              )}

              {passwordError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-2xl flex items-center gap-2 font-bold">
                  <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                  <span>{passwordError}</span>
                </div>
              )}

              {/* Current Password */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">كلمة المرور الحالية *</label>
                <div className="relative">
                  <input
                    type={showCurrentPass ? 'text' : 'password'}
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="أدخل كلمة مرورك الحالية للتأكيد"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPass(!showCurrentPass)}
                    className="absolute left-3 top-3 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showCurrentPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">كلمة المرور الجديدة *</label>
                <div className="relative">
                  <input
                    type={showNewPass ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="6 خانات على الأقل (يفضل أحرف وأرقام)"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPass(!showNewPass)}
                    className="absolute left-3 top-3 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showNewPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                {/* Strength Meter */}
                {newPassword.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span>قوة كلمة المرور:</span>
                      <span className={strength <= 1 ? 'text-rose-600 font-bold' : strength <= 2 ? 'text-amber-600 font-bold' : 'text-emerald-600 font-bold'}>
                        {strength <= 1 ? 'ضعيفة' : strength <= 2 ? 'متوسطة' : strength === 3 ? 'جيدة' : 'قوية جداً'}
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden flex gap-1">
                      <div className={`h-full flex-1 rounded-full transition-all ${strength >= 1 ? (strength <= 1 ? 'bg-rose-500' : strength <= 2 ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-slate-200'}`}></div>
                      <div className={`h-full flex-1 rounded-full transition-all ${strength >= 2 ? (strength <= 2 ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-slate-200'}`}></div>
                      <div className={`h-full flex-1 rounded-full transition-all ${strength >= 3 ? 'bg-emerald-500' : 'bg-slate-200'}`}></div>
                      <div className={`h-full flex-1 rounded-full transition-all ${strength >= 4 ? 'bg-emerald-600' : 'bg-slate-200'}`}></div>
                    </div>
                  </div>
                )}
              </div>

              {/* Confirm New Password */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">تأكيد كلمة المرور الجديدة *</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="أعد كتابة كلمة المرور الجديدة"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={passwordSaving}
                  className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow-md transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {passwordSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>جاري تحديث كلمة المرور...</span>
                    </>
                  ) : (
                    <>
                      <KeyRound className="h-4 w-4 text-emerald-400" />
                      <span>تحديث كلمة المرور الآن</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
