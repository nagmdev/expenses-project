import React, { useState, useEffect } from 'react';
import { 
  X, 
  Flame, 
  CheckCircle2, 
  AlertTriangle, 
  Copy, 
  Check, 
  ExternalLink, 
  Trash2, 
  Server, 
  ShieldCheck, 
  Layers, 
  Sparkles,
  Loader2
} from 'lucide-react';
import { 
  getFirebaseConfig, 
  saveFirebaseConfig, 
  testFirebaseConnection, 
  resetFirebaseApp,
  initFirebase,
  FirebaseConfig 
} from '../lib/firebase';

interface FirebaseConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigSaved?: () => void;
}

export const FirebaseConfigModal: React.FC<FirebaseConfigModalProps> = ({
  isOpen,
  onClose,
  onConfigSaved,
}) => {
  const [activeTab, setActiveTab] = useState<'config' | 'rules' | 'guide'>('config');
  const [rawSnippet, setRawSnippet] = useState('');
  const [apiKey, setApiKey] = useState(() => getFirebaseConfig()?.apiKey || '');
  const [authDomain, setAuthDomain] = useState(() => getFirebaseConfig()?.authDomain || '');
  const [projectId, setProjectId] = useState(() => getFirebaseConfig()?.projectId || '');
  const [storageBucket, setStorageBucket] = useState(() => getFirebaseConfig()?.storageBucket || '');
  const [messagingSenderId, setMessagingSenderId] = useState(() => getFirebaseConfig()?.messagingSenderId || '');
  const [appId, setAppId] = useState(() => getFirebaseConfig()?.appId || '');
  
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [copiedVar, setCopiedVar] = useState<string | null>(null);

  // Sync state whenever modal is opened
  useEffect(() => {
    if (!isOpen) return;
    const cfg = getFirebaseConfig();
    if (cfg) {
      setApiKey(cfg.apiKey || '');
      setAuthDomain(cfg.authDomain || '');
      setProjectId(cfg.projectId || '');
      setStorageBucket(cfg.storageBucket || '');
      setMessagingSenderId(cfg.messagingSenderId || '');
      setAppId(cfg.appId || '');
    }
  }, [isOpen]);


  if (!isOpen) return null;

  // Intelligent parser for Firebase snippet
  const handleParseSnippet = (text: string) => {
    setRawSnippet(text);
    if (!text.trim()) return;

    try {
      // 1. Try standard JSON first
      const cleaned = text.trim();
      if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
        const json = JSON.parse(cleaned);
        if (json.apiKey) setApiKey(json.apiKey);
        if (json.authDomain) setAuthDomain(json.authDomain);
        if (json.projectId) setProjectId(json.projectId);
        if (json.storageBucket) setStorageBucket(json.storageBucket);
        if (json.messagingSenderId) setMessagingSenderId(json.messagingSenderId);
        if (json.appId) setAppId(json.appId);
        return;
      }
    } catch {
      // Not strict JSON, continue to regex parser
    }

    // 2. Regex matching for JavaScript / TypeScript / JSON formats
    const extract = (key: string) => {
      const regex = new RegExp(`${key}['"\\s]*:['"\\s]*([^'",;\\n}]+)`, 'i');
      const match = text.match(regex);
      return match ? match[1].trim().replace(/['"]/g, '') : null;
    };

    const foundApiKey = extract('apiKey');
    const foundAuthDomain = extract('authDomain');
    const foundProjectId = extract('projectId');
    const foundStorageBucket = extract('storageBucket');
    const foundMessagingSenderId = extract('messagingSenderId');
    const foundAppId = extract('appId');

    if (foundApiKey) setApiKey(foundApiKey);
    if (foundAuthDomain) setAuthDomain(foundAuthDomain);
    if (foundProjectId) setProjectId(foundProjectId);
    if (foundStorageBucket) setStorageBucket(foundStorageBucket);
    if (foundMessagingSenderId) setMessagingSenderId(foundMessagingSenderId);
    if (foundAppId) setAppId(foundAppId);
  };

  const handleTestAndSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!apiKey.trim() || !projectId.trim()) {
      setTestResult({
        success: false,
        message: 'يرجى إدخال API Key و Project ID كحد أدنى للمتابعة.',
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    const config: FirebaseConfig = {
      apiKey: apiKey.trim(),
      authDomain: authDomain.trim(),
      projectId: projectId.trim(),
      storageBucket: storageBucket.trim(),
      messagingSenderId: messagingSenderId.trim(),
      appId: appId.trim(),
    };

    try {
      const result = await testFirebaseConnection(config);
      setTestResult(result);

      if (result.success) {
        // Save to localStorage
        saveFirebaseConfig(config);
        // Reset and re-initialize singleton
        await resetFirebaseApp();
        initFirebase();

        if (onConfigSaved) {
          onConfigSaved();
        }

        // Close after a short delay on success
        setTimeout(() => {
          onClose();
        }, 1200);
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err?.message || 'حدث خطأ غير متوقع أثناء فحص الاتصال.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleDisconnect = async () => {
    if (window.confirm('هل أنت متأكد من قطع الاتصال بقاعدة بيانات Firebase والعودة للتخزين المحلي؟')) {
      saveFirebaseConfig(null);
      await resetFirebaseApp();
      setApiKey('');
      setAuthDomain('');
      setProjectId('');
      setStorageBucket('');
      setMessagingSenderId('');
      setAppId('');
      setRawSnippet('');
      setTestResult({
        success: true,
        message: 'تم قطع الاتصال بنجاح والعودة للتخزين المحلي.',
      });
      if (onConfigSaved) {
        onConfigSaved();
      }
      setTimeout(() => {
        onClose();
      }, 1000);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedVar(label);
    setTimeout(() => setCopiedVar(null), 2000);
  };

  const vercelEnvVars = [
    { key: 'VITE_FIREBASE_API_KEY', val: apiKey || 'AIzaSy...', desc: 'مفتاح الويب API' },
    { key: 'VITE_FIREBASE_AUTH_DOMAIN', val: authDomain || `${projectId || 'project-id'}.firebaseapp.com`, desc: 'نطاق المصادقة' },
    { key: 'VITE_FIREBASE_PROJECT_ID', val: projectId || 'my-expenses-project', desc: 'معرّف المشروع' },
    { key: 'VITE_FIREBASE_STORAGE_BUCKET', val: storageBucket || `${projectId || 'project-id'}.firebasestorage.app`, desc: 'حاوية التخزين' },
    { key: 'VITE_FIREBASE_MESSAGING_SENDER_ID', val: messagingSenderId || '1234567890', desc: 'معرّف المراسلة' },
    { key: 'VITE_FIREBASE_APP_ID', val: appId || '1:12345:web:abcdef', desc: 'معرّف التطبيق' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-8">
        
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-emerald-600 p-6 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center shadow-inner">
              <Flame className="h-7 w-7 text-white fill-white/80" />
            </div>
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                <span>الربط السحابي مع Google Cloud Firestore</span>
                <span className="text-[11px] bg-white/20 px-2 py-0.5 rounded-full font-mono">Realtime DB</span>
              </h2>
              <p className="text-xs text-amber-50 mt-0.5">
                مزامنة فورية متعددة الأجهزة والمستخدمين لبيانات المؤسسات والمصروفات
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6 pt-3 gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('config')}
            className={`pb-3 px-4 text-xs font-bold transition border-b-2 flex items-center gap-2 cursor-pointer whitespace-nowrap ${
              activeTab === 'config'
                ? 'border-orange-500 text-orange-600 bg-white rounded-t-xl shadow-xs'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Server className="h-4 w-4" />
            <span>بيانات الاتصال المباشر (Config)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('rules')}
            className={`pb-3 px-4 text-xs font-bold transition border-b-2 flex items-center gap-2 cursor-pointer whitespace-nowrap ${
              activeTab === 'rules'
                ? 'border-amber-500 text-amber-700 bg-white rounded-t-xl shadow-xs'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShieldCheck className="h-4 w-4 text-amber-600" />
            <span>قواعد الأمان (Firestore Rules)</span>
          </button>
          
          <button
            type="button"
            onClick={() => setActiveTab('guide')}
            className={`pb-3 px-4 text-xs font-bold transition border-b-2 flex items-center gap-2 cursor-pointer whitespace-nowrap ${
              activeTab === 'guide'
                ? 'border-emerald-600 text-emerald-700 bg-white rounded-t-xl shadow-xs'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Layers className="h-4 w-4" />
            <span>متغيرات Vercel</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6">
          {activeTab === 'config' ? (
            <form onSubmit={handleTestAndSave} className="space-y-4">
              
              {/* Quick Paste Snippet Area */}
              <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-amber-600" />
                    <span>لصق تلقائي ذكي لإعدادات Firebase (Paste Config Object):</span>
                  </span>
                  <span className="text-[11px] text-amber-700 font-medium">
                    يدعم كود JavaScript أو JSON من Firebase Console
                  </span>
                </div>
                <textarea
                  rows={2}
                  value={rawSnippet}
                  onChange={(e) => handleParseSnippet(e.target.value)}
                  placeholder={`الصق كود الإعدادات هنا:\nconst firebaseConfig = { apiKey: "AIza...", authDomain: "...", projectId: "..." };`}
                  className="w-full text-xs font-mono p-2.5 bg-white border border-amber-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-hidden dir-ltr text-left"
                />
              </div>

              {/* Individual Fields Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    API Key * <span className="text-slate-400 font-normal">(مفتاح الويب)</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="AIzaSyA..."
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden dir-ltr"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Project ID * <span className="text-slate-400 font-normal">(معرّف المشروع)</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    placeholder="expense-management-xxxx"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden dir-ltr"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Auth Domain <span className="text-slate-400 font-normal">(اختياري)</span>
                  </label>
                  <input
                    type="text"
                    value={authDomain}
                    onChange={(e) => setAuthDomain(e.target.value)}
                    placeholder="project-id.firebaseapp.com"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden dir-ltr"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Storage Bucket <span className="text-slate-400 font-normal">(اختياري)</span>
                  </label>
                  <input
                    type="text"
                    value={storageBucket}
                    onChange={(e) => setStorageBucket(e.target.value)}
                    placeholder="project-id.firebasestorage.app"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden dir-ltr"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Messaging Sender ID <span className="text-slate-400 font-normal">(اختياري)</span>
                  </label>
                  <input
                    type="text"
                    value={messagingSenderId}
                    onChange={(e) => setMessagingSenderId(e.target.value)}
                    placeholder="1234567890"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden dir-ltr"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    App ID <span className="text-slate-400 font-normal">(اختياري)</span>
                  </label>
                  <input
                    type="text"
                    value={appId}
                    onChange={(e) => setAppId(e.target.value)}
                    placeholder="1:1234567890:web:abcdef..."
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden dir-ltr"
                  />
                </div>
              </div>

              {/* Status or Error Banner */}
              {testResult && (
                <div
                  className={`p-3.5 rounded-2xl flex items-start gap-2.5 text-xs animate-in fade-in duration-200 ${
                    testResult.success
                      ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                      : 'bg-rose-50 border border-rose-200 text-rose-800'
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <div className="leading-relaxed">
                    <p className="font-bold">{testResult.success ? 'نجاح التحقق والتخزين:' : 'تنبيه الاتصال:'}</p>
                    <p>{testResult.message}</p>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
                <div>
                  {projectId && (
                    <button
                      type="button"
                      onClick={handleDisconnect}
                      className="px-3.5 py-2 text-rose-600 hover:bg-rose-50 rounded-xl font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>قطع الاتصال والعودة للتخزين المحلي</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl text-xs font-semibold transition cursor-pointer"
                  >
                    إلغاء
                  </button>

                  <button
                    type="submit"
                    disabled={isTesting}
                    className="px-6 py-2.5 bg-gradient-to-r from-orange-500 to-emerald-600 hover:from-orange-600 hover:to-emerald-700 text-white font-bold text-xs rounded-xl shadow-md shadow-orange-500/20 flex items-center gap-2 transition cursor-pointer disabled:opacity-50"
                  >
                    {isTesting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>جاري فحص الاتصال بـ Firestore...</span>
                      </>
                    ) : (
                      <>
                        <Flame className="h-4 w-4" />
                        <span>اختبار وحفظ الاتصال السحابي</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          ) : activeTab === 'rules' ? (
            /* Rules Tab */
            <div className="space-y-4 text-xs">
              <div className="bg-amber-50/80 border border-amber-200 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-bold text-amber-900 text-sm flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-amber-600" />
                    <span>تفعيل صلاحيات القراءة والكتابة (Firestore Security Rules):</span>
                  </h4>
                  <a
                    href="https://console.firebase.google.com/project/expenses-project-ce1f9/firestore/rules"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-xs shadow-xs transition"
                  >
                    <span>فتح صفحة القواعد في Firebase Console</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                <p className="text-amber-800 leading-relaxed text-xs mb-3">
                  افتراضياً، ينشئ Firebase قواعد حظر تمنع أي قراءة أو كتابة (Permission Denied). لتفعيل الاتصال والمزامنة الفورية، انسخ الكود التالي وضعه في صفحة القواعد:
                </p>

                <div className="relative">
                  <pre className="p-4 bg-slate-900 text-emerald-400 font-mono text-xs rounded-xl overflow-x-auto text-left dir-ltr leading-relaxed shadow-inner">
{`rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}`}
                  </pre>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(`rules_version = '2';\n\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{document=**} {\n      allow read, write: if true;\n    }\n  }\n}`, 'rules_main')}
                    className="absolute top-3 right-3 bg-slate-800/90 hover:bg-slate-700 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                  >
                    {copiedVar === 'rules_main' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedVar === 'rules_main' ? 'تم النسخ!' : 'نسخ القواعد'}</span>
                  </button>
                </div>

                <div className="mt-4 pt-3 border-t border-amber-200/60 space-y-1.5 text-amber-900">
                  <div className="font-bold text-xs">خطوات التطبيق (تستغرق 10 ثوانٍ):</div>
                  <ol className="list-decimal list-inside space-y-1 text-xs text-amber-800">
                    <li>اضغط على زر <strong>"فتح صفحة القواعد في Firebase Console"</strong> بالأعلى.</li>
                    <li>حدد النص الموجود في محرر القواعد واستبدله بالكود المنسوخ أعلاه.</li>
                    <li>اضغط على زر <strong>Publish (نشر)</strong> الأزرق في أعلى صفحة Firebase.</li>
                    <li>عد إلى هنا واضغط على زر "اختبار وحفظ الاتصال" أو أعد تحميل الصفحة ليتم الاتصال فورياً!</li>
                  </ol>
                </div>
              </div>
            </div>
          ) : (
            /* Guide Tab for Vercel */
            <div className="space-y-4 text-xs">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Layers className="h-4 w-4 text-emerald-600" />
                    <span>متغيرات البيئة في Vercel (Vercel Environment Variables):</span>
                  </h4>
                  <a
                    href="https://vercel.com/dashboard"
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-700 hover:underline flex items-center gap-1 text-[11px] font-bold"
                  >
                    <span>لوحة تحكم Vercel</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <p className="text-slate-500 leading-relaxed mb-3">
                  لجعل التطبيق يتصل تلقائياً وبأمان في الإنتاج دون الحاجة لإدخال الإعدادات يدوياً في المتصفح، أضف المتغيرات التالية في:
                  <span className="font-mono text-[11px] bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded-sm mx-1">
                    Project Settings → Environment Variables
                  </span>
                </p>

                <div className="space-y-2">
                  {vercelEnvVars.map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center justify-between p-2 bg-white rounded-xl border border-slate-200 text-[11px]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-800 dir-ltr">{item.key}</span>
                        <span className="text-slate-400">({item.desc})</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(item.key, item.key)}
                        className="p-1 text-slate-400 hover:text-emerald-600 transition flex items-center gap-1"
                        title="نسخ اسم المتغير"
                      >
                        {copiedVar === item.key ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        <span className="text-[10px]">{copiedVar === item.key ? 'تم النسخ' : 'نسخ'}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Firestore Security Rules Guide */}
              <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4">
                <h4 className="font-bold text-emerald-900 flex items-center gap-1.5 mb-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <span>تفعيل قواعد Firestore (Security Rules):</span>
                </h4>
                <p className="text-emerald-800 leading-relaxed mb-2 text-[11px]">
                  تأكد من تفعيل وضع القراءة والكتابة في تبويب <span className="font-mono font-bold">Firestore Database → Rules</span> بلوحة تحكم Firebase:
                </p>
                <div className="relative">
                  <pre className="p-3 bg-slate-900 text-emerald-400 font-mono text-[11px] rounded-xl overflow-x-auto text-left dir-ltr">
{`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}`}
                  </pre>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(`rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{document=**} {\n      allow read, write: if true;\n    }\n  }\n}`, 'rules')}
                    className="absolute top-2 right-2 bg-slate-800/90 hover:bg-slate-700 text-white text-[10px] px-2 py-1 rounded-md flex items-center gap-1"
                  >
                    {copiedVar === 'rules' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedVar === 'rules' ? 'تم النسخ' : 'نسخ القواعد'}</span>
                  </button>
                </div>
              </div>

            </div>
          )}
        </div>

      </div>
    </div>
  );
};
