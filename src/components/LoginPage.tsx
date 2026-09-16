import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Lock, 
  Mail, 
  KeyRound, 
  Eye, 
  EyeOff, 
  ShieldCheck, 
  Building2, 
  AlertCircle, 
  CheckCircle2, 
  Loader2,
  Wallet
} from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { loginWithEmail, signInWithGoogle, resetPassword } = useApp();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Forgot password modal
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setError(null);
    setIsLoading(true);

    try {
      await loginWithEmail(email.trim(), password);
    } catch (err: any) {
      console.error('[Login Error]', err);
      const code = err?.code || '';
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        setError('البريد الإلكتروني أو كلمة المرور غير صحيحة. يرجى التحقق وإعادة المحاولة.');
      } else if (code === 'auth/invalid-email') {
        setError('صيغة البريد الإلكتروني غير صالحة.');
      } else if (code === 'auth/user-disabled') {
        setError('تم إيقاف هذا الحساب. يرجى التواصل مع مدير شركتك.');
      } else if (code === 'auth/too-many-requests') {
        setError('تم تقييد المحاولات مؤقتاً بسبب تكرار المحاولات الخاطئة. يرجى الانتظار بضع دقائق.');
      } else {
        setError(err?.message || 'تعذر تسجيل الدخول، يرجى المحاولة مرة أخرى.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setIsLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        console.error('[Google Login Error]', err);
        setError('تعذر تسجيل الدخول عبر Google. يرجى التحقق من اتصالك والمحاولة مجدداً.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail.trim()) return;

    setResetError(null);
    setResetLoading(true);

    try {
      await resetPassword(resetEmail.trim());
      setResetSuccess(true);
    } catch (err: any) {
      console.error('[Reset Password Error]', err);
      if (err?.code === 'auth/user-not-found') {
        setResetError('لم يتم العثور على حساب مسجل بهذا البريد الإلكتروني.');
      } else {
        setResetError('تعذر إرسال رابط إعادة التعيين. تأكد من صحة البريد والمحاولة ثانية.');
      }
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950 text-slate-100 flex flex-col justify-center items-center p-4 selection:bg-emerald-500 selection:text-white antialiased relative overflow-hidden">
      
      {/* Ambient background glow effects */}
      <div className="absolute top-1/4 -right-24 w-96 h-96 bg-emerald-600/15 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-1/4 -left-24 w-96 h-96 bg-teal-600/15 rounded-full blur-3xl pointer-events-none"></div>

      {/* Main Login Card */}
      <div className="max-w-md w-full relative z-10 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-slate-950 shadow-xl shadow-emerald-500/20 mb-3.5">
            <Wallet className="h-8 w-8 stroke-[2.5]" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center justify-center gap-2">
            <span>مصروفي</span>
            <span className="text-[10px] bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 font-bold px-2 py-0.5 rounded-full">
              بوابة الشركات
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            نظام إدارة المصروفات والعهد متعدد الشركات — تسجيل الدخول الآمن
          </p>
        </div>

        {/* Card Box */}
        <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-7 shadow-2xl shadow-black/50">
          
          {error && (
            <div className="mb-5 bg-rose-950/60 border border-rose-800/80 rounded-2xl p-3.5 flex items-start gap-2.5 text-xs text-rose-200 animate-in fade-in duration-150">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          {/* Email / Password Form */}
          <form onSubmit={handleEmailLogin} className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-300 font-bold mb-1.5">
                البريد الإلكتروني المهني
              </label>
              <div className="relative">
                <Mail className="h-4 w-4 text-slate-500 absolute right-3.5 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full pl-4 pr-10 py-2.5 bg-slate-950/70 border border-slate-800 rounded-xl text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition font-mono text-xs"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-slate-300 font-bold">
                  كلمة المرور
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setResetEmail(email);
                    setResetSuccess(false);
                    setResetError(null);
                    setIsResetModalOpen(true);
                  }}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 transition"
                >
                  نسيت كلمة المرور؟
                </button>
              </div>

              <div className="relative">
                <KeyRound className="h-4 w-4 text-slate-500 absolute right-3.5 top-3" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-950/70 border border-slate-800 rounded-xl text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3 top-3 text-slate-500 hover:text-slate-300 transition cursor-pointer"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold rounded-xl shadow-lg shadow-emerald-600/25 transition cursor-pointer flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50 mt-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>جاري تسجيل الدخول والتحقق...</span>
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" />
                  <span>تسجيل الدخول الآمن</span>
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-800"></div>
            </div>
            <div className="relative flex justify-center text-[11px]">
              <span className="bg-slate-900 px-3 text-slate-500 font-medium">
                أو المتابعة السريعة
              </span>
            </div>
          </div>

          {/* Google Sign In */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full py-2.5 bg-slate-950 hover:bg-slate-800/80 border border-slate-700/80 text-slate-200 font-bold rounded-xl shadow-xs transition cursor-pointer flex items-center justify-center gap-2.5 text-xs active:scale-98 disabled:opacity-50"
          >
            <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            <span>الدخول عبر حساب Google</span>
          </button>

          {/* Privacy & Security Guarantee */}
          <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-center gap-2 text-[11px] text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            <span>نظام عزل بيانات مشفر ومصرفي 100%</span>
          </div>

        </div>

        {/* Notice for Employees */}
        <div className="mt-4 text-center text-xs text-slate-500 px-4">
          حسابات الموظفين يتم إنشاؤها وتفعيلها عبر مدير الشركة المسجل. تواصل مع إدارتك لاستلام بيانات الدخول.
        </div>

      </div>

      {/* Forgot Password Modal */}
      {isResetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl text-xs text-slate-200">
            <h3 className="font-bold text-base text-white mb-2">استعادة كلمة المرور</h3>
            <p className="text-slate-400 mb-4 leading-relaxed">
              أدخل بريدك الإلكتروني وسنرسل لك رابطاً رسمياً وآمناً من Firebase لتعيين كلمة مرور جديدة.
            </p>

            {resetSuccess ? (
              <div className="bg-emerald-950/70 border border-emerald-800 text-emerald-200 p-4 rounded-xl text-center space-y-2">
                <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto" />
                <p className="font-bold">تم إرسال رابط التعيين بنجاح!</p>
                <p className="text-[11px] text-emerald-300">
                  يرجى مراجعة صندوق الوارد (أو البريد غير الهام Junk/Spam) واتباع التعليمات.
                </p>
                <button
                  type="button"
                  onClick={() => setIsResetModalOpen(false)}
                  className="mt-3 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold w-full"
                >
                  العودة لتسجيل الدخول
                </button>
              </div>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-3">
                {resetError && (
                  <div className="p-2.5 bg-rose-950/70 border border-rose-800 text-rose-200 rounded-lg">
                    {resetError}
                  </div>
                )}
                <div>
                  <label className="block text-slate-300 font-bold mb-1">البريد الإلكتروني</label>
                  <input
                    type="email"
                    required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-mono text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsResetModalOpen(false)}
                    className="px-4 py-2 text-slate-400 hover:bg-slate-800 rounded-xl"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl flex items-center gap-1.5"
                  >
                    {resetLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <span>إرسال الرابط</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

    </div>
  );
};
