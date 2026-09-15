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
  DollarSign, 
  Calendar,
  Briefcase
} from 'lucide-react';
import { Organization, OrganizationMember } from '../types';

interface OrganizationsManagementProps {
  onOpenNewOrgModal?: () => void;
}

export const OrganizationsManagement: React.FC<OrganizationsManagementProps> = () => {
  const { 
    organizations, 
    activeOrgId, 
    setActiveOrgId, 
    members, 
    addOrganization, 
    addMember, 
    removeMember,
    requests,
    services 
  } = useApp();

  const [isOrgModalOpen, setIsOrgModalOpen] = useState(false);
  const [isMemberModalOpen, setIsMemberModalOpen] = useState(false);

  // New Org Form
  const [orgName, setOrgName] = useState('');
  const [orgCode, setOrgCode] = useState('');
  const [orgCurrency, setOrgCurrency] = useState('SAR');
  const [orgBudget, setOrgBudget] = useState('500000');
  const [orgDescription, setOrgDescription] = useState('');

  // New Member Form
  const [selectedOrgForMember, setSelectedOrgForMember] = useState(
    activeOrgId && activeOrgId !== 'all' ? activeOrgId : (organizations[0]?.id || '')
  );
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<'org_admin' | 'employee'>('employee');
  const [department, setDepartment] = useState('الشؤون المالية والإدارية');
  const [jobTitle, setJobTitle] = useState('محاسب ومسؤول عهد');

  React.useEffect(() => {
    if ((!selectedOrgForMember || selectedOrgForMember === 'org-1') && organizations.length > 0) {
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

  const handleCreateMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberName.trim() || !memberEmail.trim()) return;

    addMember({
      orgId: selectedOrgForMember,
      userId: `user-${Date.now()}`,
      userName: memberName.trim(),
      userEmail: memberEmail.trim(),
      role: memberRole,
      department: department.trim(),
      jobTitle: jobTitle.trim(),
      active: true,
    });

    setMemberName('');
    setMemberEmail('');
    setIsMemberModalOpen(false);
  };

  // Filter members by activeOrgId if not all
  const filteredMembers = members.filter(m => activeOrgId === 'all' || m.orgId === activeOrgId);

  return (
    <div className="space-y-8 pb-12">
      
      {/* Organizations Section */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs mb-5">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-emerald-600" />
              <span>المؤسسات والكيانات التابعة</span>
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              إدارة المؤسسات المنفصلة وتخصيص ميزانية ومصروفات مستقلة لكل مؤسسة
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsOrgModalOpen(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-xs transition cursor-pointer self-start sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            <span>إضافة مؤسسة جديدة</span>
          </button>
        </div>

        {/* Organizations Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {organizations.map((org) => {
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

                  {isCurrentActive ? (
                    <span className="bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                      <Check className="h-3 w-3" />
                      <span>المؤسسة النشطة</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActiveOrgId(org.id)}
                      className="text-xs font-bold text-slate-600 hover:text-emerald-700 bg-slate-100 hover:bg-emerald-50 px-3 py-1.5 rounded-lg transition"
                    >
                      تحديد كنشطة
                    </button>
                  )}
                </div>

                <p className="text-xs text-slate-500 mt-3 leading-relaxed">
                  {org.description || 'مؤسسة مسجلة في نظام إدارة المصروفات.'}
                </p>

                {/* Metrics */}
                <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-slate-100 text-xs">
                  <div className="bg-slate-50 p-2.5 rounded-xl text-center">
                    <span className="text-slate-400 block text-[10px]">الميزانية السنوية</span>
                    <span className="font-bold text-slate-800">
                      {org.budget.toLocaleString()} {org.currency}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded-xl text-center">
                    <span className="text-slate-400 block text-[10px]">المصروف الفعلي</span>
                    <span className="font-bold text-emerald-700">
                      {orgTotalDisbursed.toLocaleString()} {org.currency}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded-xl text-center">
                    <span className="text-slate-400 block text-[10px]">الأعضاء والخدمات</span>
                    <span className="font-bold text-slate-800">
                      {orgMembersCount} عضو / {orgServicesCount} خدمة
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          {organizations.length === 0 && (
            <div className="col-span-full bg-white rounded-2xl border border-dashed border-slate-200 p-8 text-center">
              <Building2 className="h-10 w-10 text-slate-300 mx-auto mb-2" />
              <h3 className="font-bold text-slate-800 text-sm">لا توجد مؤسسات مضافة بعد</h3>
              <p className="text-xs text-slate-400 mt-1 mb-4">أضف مؤسستك الأولى لتبدأ بإدارة الميزانيات وتتبع طلبات الصرف</p>
              <button
                type="button"
                onClick={() => setIsOrgModalOpen(true)}
                className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>إضافة أول مؤسسة الآن</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Members Section */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs mb-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Users className="h-5 w-5 text-indigo-600" />
              <span>أعضاء المؤسسة والصلاحيات</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              إضافة أعضاء وموظفين وتحديد أدوارهم (مدير مؤسسة / طالب صرف وموظف)
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsMemberModalOpen(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-xs transition cursor-pointer self-start sm:self-auto"
          >
            <UserPlus className="h-4 w-4" />
            <span>إضافة عضو جديد</span>
          </button>
        </div>

        {/* Members Table */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                <tr>
                  <th className="p-4">العضو / الموظف</th>
                  <th className="p-4">المؤسسة التابع لها</th>
                  <th className="p-4">المسمى الوظيفي والقسم</th>
                  <th className="p-4">الدور والصلاحية</th>
                  <th className="p-4">تاريخ الانضمام</th>
                  <th className="p-4 text-center">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMembers.map((mem) => {
                  const memberOrg = organizations.find(o => o.id === mem.orgId);

                  return (
                    <tr key={mem.id} className="hover:bg-slate-50/80 transition">
                      <td className="p-4">
                        <div className="font-bold text-slate-900">{mem.userName}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{mem.userEmail}</div>
                      </td>
                      <td className="p-4">
                        <span className="font-semibold text-slate-700">{memberOrg?.name || 'مؤسسة غير معروفة'}</span>
                      </td>
                      <td className="p-4">
                        <div className="font-medium text-slate-800">{mem.jobTitle}</div>
                        <div className="text-[10px] text-slate-400">{mem.department}</div>
                      </td>
                      <td className="p-4">
                        {mem.role === 'org_admin' ? (
                          <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-0.5 rounded-full font-bold text-[11px]">
                            <ShieldCheck className="h-3 w-3" />
                            <span>مدير المؤسسة</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-0.5 rounded-full font-semibold text-[11px]">
                            <span>طالب صرف / موظف</span>
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
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                          title="حذف العضو"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredMembers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      <Users className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                      <p className="font-medium text-xs">لا يوجد أعضاء مسجلين حالياً</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">انقر على "إضافة عضو جديد" لإسناد الموظفين والصلاحيات</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add Org Modal */}
      {isOrgModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl p-6 border border-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm">إضافة مؤسسة جديدة للنظام</h3>
              <button onClick={() => setIsOrgModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateOrg} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم المؤسسة / الشركة *</label>
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
                  <label className="block font-bold text-slate-700 mb-1">كود المؤسسة (3-4 أحرف)</label>
                  <input
                    type="text"
                    required
                    value={orgCode}
                    onChange={(e) => setOrgCode(e.target.value.toUpperCase())}
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
                    <option value="AED">AED (درهم إماراتي)</option>
                    <option value="EGP">EGP (جنيه مصري)</option>
                    <option value="USD">USD (دولار أمريكي)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">الميزانية السنوية التقديرية</label>
                <input
                  type="number"
                  min="0"
                  value={orgBudget}
                  onChange={(e) => setOrgBudget(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">نبذة عن النشاط</label>
                <textarea
                  rows={2}
                  value={orgDescription}
                  onChange={(e) => setOrgDescription(e.target.value)}
                  placeholder="مجال عمل المؤسسة..."
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
                  إنشاء المؤسسة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Member Modal */}
      {isMemberModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl p-6 border border-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm">إضافة عضو جديد للمؤسسة</h3>
              <button onClick={() => setIsMemberModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateMember} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">المؤسسة التابع لها *</label>
                <select
                  value={selectedOrgForMember}
                  onChange={(e) => setSelectedOrgForMember(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                >
                  {organizations.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">الاسم الكامل للعضو *</label>
                <input
                  type="text"
                  required
                  value={memberName}
                  onChange={(e) => setMemberName(e.target.value)}
                  placeholder="مثال: م. عمر الحربي..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">البريد الإلكتروني *</label>
                <input
                  type="email"
                  required
                  value={memberEmail}
                  onChange={(e) => setMemberEmail(e.target.value)}
                  placeholder="omar@company.com"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">الدور والصلاحية</label>
                  <select
                    value={memberRole}
                    onChange={(e: any) => setMemberRole(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                  >
                    <option value="employee">طالب صرف / موظف</option>
                    <option value="org_admin">مدير المؤسسة</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">القسم</label>
                  <input
                    type="text"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
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

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsMemberModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl"
                >
                  إضافة العضو
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
