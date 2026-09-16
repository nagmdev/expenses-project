import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Building2, 
  Plus, 
  Users, 
  UserPlus, 
  ShieldCheck, 
  Trash2, 
  Check, 
  X, 
  Lock, 
  Phone, 
  Mail, 
  Copy, 
  Crown, 
  CheckCircle2, 
  AlertCircle, 
  Loader2,
  ExternalLink,
  KeyRound
} from 'lucide-react';
import { Role } from '../types';
import { 
  sanitizeDigitsOnly, 
  sanitizePhone, 
  sanitizeCode, 
  handleNumericKeyDown, 
  isValidEmail 
} from '../utils/validation';

export const OrganizationsManagement: React.FC = () => {
  const { 
    organizations, 
    allOrganizations,
    activeOrgId, 
    setActiveOrgId, 
    members, 
    addOrganization, 
    removeMember,
    createCompanyUser,
    superAdminEmails,
    addSuperAdminEmail,
    currentRole,
    currentUser,
    requests,
    services 
  } = useApp();

  const isSuperAdmin = currentRole === 'super_admin';

  // New Org Form (Super Admin only)
  const [isOrgModalOpen, setIsOrgModalOpen] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [orgCode, setOrgCode] = useState('');
  const [orgCurrency, setOrgCurrency] = useState('SAR');
  const [orgBudget, setOrgBudget] = useState('500000');
  const [orgDescription, setOrgDescription] = useState('');

  // Super Admin Management Modal
  const [isSuperAdminModalOpen, setIsSuperAdminModalOpen] = useState(false);
  const [newSuperAdminEmail, setNewSuperAdminEmail] = useState('');
  const [superAdminAddSuccess, setSuperAdminAddSuccess] = useState(false);

  // New Employee Provision Form (Email + Password + Phone)
  const [isProvisionModalOpen, setIsProvisionModalOpen] = useState(false);
  const [selectedOrgForMember, setSelectedOrgForMember] = useState(
    activeOrgId && activeOrgId !== 'all' ? activeOrgId : (organizations[0]?.id || '')
  );
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberPassword, setMemberPassword] = useState('');
  const [memberPhone, setMemberPhone] = useState('');
  const [memberRole, setMemberRole] = useState<'org_admin' | 'employee'>('employee');
  const [department, setDepartment] = useState('العمليات والتشغيل');
  const [jobTitle, setJobTitle] = useState('موظف');
  
  const [provisionLoading, setProvisionLoading] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{
    name: string;
    email: string;
    password: string;
    phone: string;
    orgName: string;
  } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  React.useEffect(() => {
    if ((!selectedOrgForMember || selectedOrgForMember === 'all') && organizations.length > 0) {
      setSelectedOrgForMember(organizations[0].id);
    }
  }, [organizations, selectedOrgForMember]);

  const handleCreateOrg = (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim()) return;

    addOrganization({
      name: orgName.trim(),
      code: orgCode.trim() || 'ORG',
      currency: orgCurrency,
      budget: Number(orgBudget) || 0,
      description: orgDescription.trim(),
    });

    setOrgName('');
    setOrgCode('');
    setOrgDescription('');
    setIsOrgModalOpen(false);
  };

  const handleProvisionUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberName.trim() || !memberEmail.trim() || !memberPassword.trim()) return;

    if (!isValidEmail(memberEmail.trim())) {
      setProvisionError('يرجى إدخال بريد إلكتروني مهني صحيح (مثال: user@company.com).');
      return;
    }

    if (memberPassword.trim().length < 6) {
      setProvisionError('يجب أن تتكون كلمة المرور من 6 خانات على الأقل.');
      return;
    }

    setProvisionError(null);
    setProvisionLoading(true);

    const targetOrg = organizations.find(o => o.id === selectedOrgForMember) || organizations[0];
    const targetOrgName = targetOrg?.name || 'الشركة';

    const res = await createCompanyUser({
      name: memberName.trim(),
      email: memberEmail.trim(),
      password: memberPassword.trim(),
      phone: memberPhone.trim(),
      role: memberRole,
      department: department.trim(),
      jobTitle: jobTitle.trim(),
      orgId: targetOrg?.id,
    });

    setProvisionLoading(false);

    if (res.success) {
      setCreatedCredentials({
        name: memberName.trim(),
        email: memberEmail.trim(),
        password: memberPassword.trim(),
        phone: memberPhone.trim(),
        orgName: targetOrgName,
      });
      setMemberName('');
      setMemberEmail('');
      setMemberPassword('');
      setMemberPhone('');
    } else {
      setProvisionError(res.message || 'تعذر إنشاء الحساب');
    }
  };

  const handleAddSuperAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSuperAdminEmail.trim()) return;

    await addSuperAdminEmail(newSuperAdminEmail.trim());
    setNewSuperAdminEmail('');
    setSuperAdminAddSuccess(true);
    setTimeout(() => {
      setSuperAdminAddSuccess(false);
      setIsSuperAdminModalOpen(false);
    }, 2000);
  };

  const copyCredentialsText = () => {
    if (!createdCredentials) return;
    const loginUrl = window.location.origin;
    const text = `مرحباً بك في نظام إدارة المصروفات (مصروفي) بشركة ${createdCredentials.orgName}.\n\nبيانات تسجيل الدخول الخاصة بك:\n- رابط المنصة: ${loginUrl}\n- البريد الإلكتروني: ${createdCredentials.email}\n- كلمة المرور: ${createdCredentials.password}\n\nيرجى الدخول وتغيير كلمة المرور في حال رغبت بذلك.`;
    navigator.clipboard.writeText(text);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  // Organizations to display (Super admin sees all; Org admin sees strictly their company)
  const displayOrgs = isSuperAdmin ? allOrganizations : organizations;
  const filteredMembers = members;

  return (
    <div className="space-y-8 pb-12">
      
      {/* Super Admin Control Bar (if super admin) */}
      {isSuperAdmin && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-3xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-md">
              <Crown className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-amber-950 text-sm">لوحة إدارة السوبر أدمن (Super Admin Portal)</h3>
              <p className="text-xs text-amber-800 mt-0.5">
                لديك الصلاحية لإنشاء الشركات المستقلة وتعيين مدراء النظام.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsSuperAdminModalOpen(true)}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer"
            >
              إدارة السوبر أدمن ({superAdminEmails.length})
            </button>
            <button
              type="button"
              onClick={() => setIsOrgModalOpen(true)}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              <span>+ إضافة شركة جديدة</span>
            </button>
          </div>
        </div>
      )}

      {/* Companies Section */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs mb-5">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-emerald-600" />
              <span>{isSuperAdmin ? 'إدارة كافة الشركات والمؤسسات' : 'بيانات الشركة التابع لها'}</span>
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              {isSuperAdmin 
                ? 'فصل وعزل تام بين كل شركة؛ لا يمكن لشركة الاطلاع على بيانات أو موظفي أو طلبات أي شركة أخرى.' 
                : 'نظام عزل مشفر بنسبة 100% يمنع أي شركة أو موظف خارجي من الاطلاع على بياناتك.'}
            </p>
          </div>

          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => setIsOrgModalOpen(true)}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-xs transition cursor-pointer self-start sm:self-auto"
            >
              <Plus className="h-4 w-4" />
              <span>إضافة شركة جديدة</span>
            </button>
          )}
        </div>

        {/* Organizations Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {displayOrgs.map((org) => {
            const orgMembersCount = members.filter(m => m.orgId === org.id).length;
            const orgServicesCount = services.filter(s => s.orgId === org.id).length;
            const orgTotalDisbursed = requests
              .filter(r => r.orgId === org.id && r.status === 'disbursed')
              .reduce((sum, r) => sum + r.amount, 0);

            const isCurrentActive = activeOrgId === org.id;

            return (
              <div 
                key={org.id} 
                className={`bg-white rounded-2xl border p-5 shadow-xs transition ${
                  isCurrentActive 
                    ? 'border-emerald-500 ring-2 ring-emerald-500/20' 
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-xl bg-emerald-50 text-emerald-700 font-bold flex items-center justify-center border border-emerald-100 text-lg">
                      {org.code.slice(0, 3)}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 text-base">{org.name}</h3>
                      <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                        <span className="font-mono font-bold text-slate-600">{org.code}</span>
                        <span>• العملة: {org.currency}</span>
                      </div>
                    </div>
                  </div>

                  {isSuperAdmin && (
                    isCurrentActive ? (
                      <span className="bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                        <Check className="h-3 w-3" />
                        <span>المؤسسة النشطة</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setActiveOrgId(org.id)}
                        className="text-xs font-bold text-slate-600 hover:text-emerald-700 bg-slate-100 hover:bg-emerald-50 px-3 py-1.5 rounded-lg transition cursor-pointer"
                      >
                        تحديد كنشطة
                      </button>
                    )
                  )}
                </div>

                <p className="text-xs text-slate-500 mt-3 leading-relaxed">
                  {org.description || 'شركة معتمدة في المنصة المصرفية.'}
                </p>

                {/* Metrics */}
                <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-slate-100 text-xs">
                  <div className="bg-slate-50 p-2.5 rounded-xl text-center">
                    <span className="text-slate-400 block text-[10px]">الميزانية</span>
                    <span className="font-bold text-slate-800">
                      {org.budget.toLocaleString()} {org.currency}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded-xl text-center">
                    <span className="text-slate-400 block text-[10px]">المنصرف الفعلي</span>
                    <span className="font-bold text-emerald-700">
                      {orgTotalDisbursed.toLocaleString()} {org.currency}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded-xl text-center">
                    <span className="text-slate-400 block text-[10px]">الموظفون المسجلون</span>
                    <span className="font-bold text-slate-800">
                      {orgMembersCount} موظف
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Employees Section (Provisioning & Management) */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs mb-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Users className="h-5 w-5 text-indigo-600" />
              <span>موظفو وفريق عمل الشركة</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              تعيين حسابات الموظفين (الاسم، البريد، كلمة المرور، رقم الهاتف). كل موظف يرى طلباته الخاصة فقط.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setCreatedCredentials(null);
              setProvisionError(null);
              setIsProvisionModalOpen(true);
            }}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-xs transition cursor-pointer self-start sm:self-auto"
          >
            <UserPlus className="h-4 w-4" />
            <span>+ تعيين حساب موظف جديد</span>
          </button>
        </div>

        {/* Employees Table */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                <tr>
                  <th className="p-4">الموظف</th>
                  <th className="p-4">الهاتف المحمول</th>
                  <th className="p-4">الشركة</th>
                  <th className="p-4">المسمى الوظيفي والقسم</th>
                  <th className="p-4">الصلاحية</th>
                  <th className="p-4">تاريخ الانضمام</th>
                  <th className="p-4 text-center">حذف</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMembers.map((mem) => {
                  const memberOrg = displayOrgs.find(o => o.id === mem.orgId);

                  return (
                    <tr key={mem.id} className="hover:bg-slate-50/80 transition">
                      <td className="p-4">
                        <div className="font-bold text-slate-900">{mem.userName}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{mem.userEmail}</div>
                      </td>
                      <td className="p-4">
                        <span className="font-mono text-slate-700">{mem.phone || 'غير مسجل'}</span>
                      </td>
                      <td className="p-4">
                        <span className="font-semibold text-slate-700">{memberOrg?.name || 'الشركة الحالية'}</span>
                      </td>
                      <td className="p-4">
                        <div className="font-medium text-slate-800">{mem.jobTitle}</div>
                        <div className="text-[10px] text-slate-400">{mem.department}</div>
                      </td>
                      <td className="p-4">
                        {mem.role === 'super_admin' ? (
                          <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-0.5 rounded-full font-bold text-[11px]">
                            <Crown className="h-3 w-3" />
                            <span>سوبر أدمن</span>
                          </span>
                        ) : mem.role === 'org_admin' ? (
                          <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-0.5 rounded-full font-bold text-[11px]">
                            <ShieldCheck className="h-3 w-3" />
                            <span>مدير الشركة</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-0.5 rounded-full font-semibold text-[11px]">
                            <span>موظف (طالب صرف)</span>
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-slate-500 font-mono">
                        {mem.joinedAt}
                      </td>
                      <td className="p-4 text-center">
                        <button
                          type="button"
                          onClick={() => removeMember(mem.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                          title="حذف حساب الموظف من الشركة"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredMembers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400">
                      <Users className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                      <p className="font-bold text-xs text-slate-700">لا يوجد موظفون مسجلون في شركتك حتى الآن</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">انقر على "تعيين حساب موظف جديد" لإنشاء بيانات الدخول وإرسالها للموظف</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Provision Employee Modal (Admin / Super Admin) */}
      {isProvisionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl p-6 border border-slate-100 text-xs animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                  <UserPlus className="h-4 w-4" />
                </div>
                <h3 className="font-bold text-slate-900 text-sm">تعيين حساب موظف رسمي جديد</h3>
              </div>
              <button 
                onClick={() => setIsProvisionModalOpen(false)} 
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {createdCredentials ? (
              /* Success & Credentials Copy Card */
              <div className="mt-4 space-y-4">
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-emerald-950">
                  <div className="flex items-center gap-2 font-bold mb-1 text-sm">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    <span>تم إنشاء الحساب بنجاح في المنصة!</span>
                  </div>
                  <p className="text-xs text-emerald-800 leading-relaxed">
                    يمكن للموظف الآن تسجيل الدخول مباشرة برقم الهاتف/البريد وكلمة المرور التالية:
                  </p>

                  <div className="mt-3 bg-white/90 p-3 rounded-xl border border-emerald-200 font-mono space-y-1 text-xs">
                    <div><span className="text-slate-400 font-sans">الاسم:</span> <strong className="font-sans">{createdCredentials.name}</strong></div>
                    <div><span className="text-slate-400 font-sans">البريد الإلكتروني:</span> <strong>{createdCredentials.email}</strong></div>
                    <div><span className="text-slate-400 font-sans">كلمة المرور:</span> <strong className="text-emerald-700">{createdCredentials.password}</strong></div>
                    {createdCredentials.phone && (
                      <div><span className="text-slate-400 font-sans">رقم الهاتف:</span> <strong>{createdCredentials.phone}</strong></div>
                    )}
                    <div><span className="text-slate-400 font-sans">الشركة:</span> <strong className="font-sans">{createdCredentials.orgName}</strong></div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={copyCredentialsText}
                    className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                  >
                    {copiedLink ? (
                      <>
                        <Check className="h-4 w-4" />
                        <span>تم نسخ رسالة الدخول للموظف!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" />
                        <span>نسخ بيانات الدخول ورابط المنصة</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreatedCredentials(null);
                      setIsProvisionModalOpen(false);
                    }}
                    className="px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl"
                  >
                    إغلاق
                  </button>
                </div>
              </div>
            ) : (
              /* Creation Form */
              <form onSubmit={handleProvisionUser} className="mt-4 space-y-3">
                {provisionError && (
                  <div className="bg-rose-50 border border-rose-200 p-3 rounded-xl text-rose-800 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>{provisionError}</span>
                  </div>
                )}

                {isSuperAdmin && (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">الشركة التابع لها الموظف *</label>
                    <select
                      value={selectedOrgForMember}
                      onChange={(e) => setSelectedOrgForMember(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                    >
                      {displayOrgs.map(o => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block font-bold text-slate-700 mb-1">الاسم الكامل للموظف *</label>
                  <input
                    type="text"
                    required
                    value={memberName}
                    onChange={(e) => setMemberName(e.target.value)}
                    placeholder="مثال: أحمد مصطفى"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">البريد الإلكتروني المهني *</label>
                    <input
                      type="email"
                      required
                      value={memberEmail}
                      onChange={(e) => setMemberEmail(e.target.value)}
                      placeholder="ahmed@company.com"
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">رقم الهاتف المحمول (أرقام فقط)</label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={memberPhone}
                      onKeyDown={(e) => handleNumericKeyDown(e, false)}
                      onChange={(e) => setMemberPhone(sanitizePhone(e.target.value))}
                      placeholder="010xxxxxxxx أو 05xxxxxxxx"
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">كلمة المرور الأولية للحساب *</label>
                    <input
                      type="text"
                      required
                      minLength={6}
                      value={memberPassword}
                      onChange={(e) => setMemberPassword(e.target.value)}
                      placeholder="كلمة مرور مكونة من 6 خانات أو أكثر"
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">الدور والصلاحية</label>
                    <select
                      value={memberRole}
                      onChange={(e: any) => setMemberRole(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                    >
                      <option value="employee">موظف عادي (طالب صرف)</option>
                      <option value="org_admin">مدير معتمد للشركة</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">القسم</label>
                    <input
                      type="text"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">المسمى الوظيفي</label>
                    <input
                      type="text"
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsProvisionModalOpen(false)}
                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={provisionLoading}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    {provisionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                    <span>تأكيد إنشاء وتفعيل الحساب</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Super Admin Management Modal */}
      {isSuperAdminModalOpen && isSuperAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl p-6 border border-slate-100 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Crown className="h-4 w-4 text-amber-600" />
                <span>إدارة حسابات السوبر أدمن (Super Admins)</span>
              </h3>
              <button onClick={() => setIsSuperAdminModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <form onSubmit={handleAddSuperAdmin} className="space-y-2">
                <label className="block font-bold text-slate-700">إضافة بريد سوبر أدمن جديد للمنصة:</label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    required
                    value={newSuperAdminEmail}
                    onChange={(e) => setNewSuperAdminEmail(e.target.value)}
                    placeholder="admin@domain.com"
                    className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl"
                  >
                    إضافة
                  </button>
                </div>
                {superAdminAddSuccess && (
                  <p className="text-emerald-600 text-xs font-bold">تمت إضافة السوبر أدمن بنجاح!</p>
                )}
              </form>

              <div>
                <span className="block font-bold text-slate-700 mb-2">قائمة السوبر أدمن المعتمدين حالياً:</span>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {superAdminEmails.map((email) => (
                    <div key={email} className="p-2.5 bg-amber-50/60 border border-amber-200/80 rounded-xl flex items-center justify-between font-mono text-xs">
                      <span>{email}</span>
                      <span className="text-[10px] bg-amber-200/60 text-amber-900 font-bold px-2 py-0.5 rounded-full">نشط</span>
                    </div>
                  ))}
                  {superAdminEmails.length === 0 && (
                    <p className="text-slate-400 text-center py-3">لا توجد إيميلات مضافة بعد. أضف أول إيميل أعلاه.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Org Modal (Super Admin only) */}
      {isOrgModalOpen && isSuperAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl p-6 border border-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm">إنشاء شركة / مؤسسة جديدة في المنصة</h3>
              <button onClick={() => setIsOrgModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateOrg} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم المؤسسة أو الشركة *</label>
                <input
                  type="text"
                  required
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="مثال: شركة التطوير اللوجستي..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">كود الشركة (3-5 أحرف)</label>
                  <input
                    type="text"
                    required
                    value={orgCode}
                    onChange={(e) => setOrgCode(sanitizeCode(e.target.value, 5))}
                    placeholder="LOG"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono uppercase"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">العملة الأساسية</label>
                  <select
                    value={orgCurrency}
                    onChange={(e) => setOrgCurrency(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <option value="SAR">SAR (ريال سعودي)</option>
                    <option value="EGP">EGP (جنيه مصري)</option>
                    <option value="AED">AED (درهم إماراتي)</option>
                    <option value="USD">USD (دولار أمريكي)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">الميزانية السنوية التقديرية (أرقام فقط)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={orgBudget}
                  onKeyDown={(e) => handleNumericKeyDown(e, false)}
                  onChange={(e) => setOrgBudget(sanitizeDigitsOnly(e.target.value, 12))}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">نبذة عن النشاط</label>
                <textarea
                  rows={2}
                  value={orgDescription}
                  onChange={(e) => setOrgDescription(e.target.value)}
                  placeholder="مجال عمل الشركة..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsOrgModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl"
                >
                  حفظ وإنشاء الشركة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
