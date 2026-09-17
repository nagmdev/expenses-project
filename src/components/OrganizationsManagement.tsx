import React, { useState, useMemo } from 'react';
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
  KeyRound,
  Edit,
  UserCheck,
  UserX,
  Search,
  Filter,
  Briefcase,
  AlertTriangle,
  RefreshCw,
  Building,
  DollarSign
} from 'lucide-react';
import { Role, Organization, OrganizationMember, SUPPORTED_CURRENCIES } from '../types';
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
    updateOrganization,
    deleteOrganization,
    removeMember,
    updateMember,
    toggleMemberStatus,
    adminResetUserPassword,
    createCompanyUser,
    superAdminEmails,
    addSuperAdminEmail,
    currentRole,
    requests
  } = useApp();

  const isSuperAdmin = currentRole === 'super_admin';
  const canManageOrgs = isSuperAdmin || currentRole === 'data_entry';
  const displayOrgs = canManageOrgs ? allOrganizations : organizations;

  // Active View Tab: 'companies' or 'users'
  const [activeSection, setActiveSection] = useState<'companies' | 'users'>('companies');

  // ==========================================
  // 1. COMPANY MODALS & STATES
  // ==========================================
  const [isOrgModalOpen, setIsOrgModalOpen] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [orgCode, setOrgCode] = useState('');
  const [orgCurrency, setOrgCurrency] = useState('EGP');
  const [orgBudget, setOrgBudget] = useState('500000');
  const [orgDescription, setOrgDescription] = useState('');

  // Edit Company State
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [editOrgName, setEditOrgName] = useState('');
  const [editOrgCode, setEditOrgCode] = useState('');
  const [editOrgCurrency, setEditOrgCurrency] = useState('EGP');
  const [editOrgBudget, setEditOrgBudget] = useState('');
  const [editOrgDescription, setEditOrgDescription] = useState('');

  // Delete Company Confirmation
  const [deletingOrg, setDeletingOrg] = useState<Organization | null>(null);
  const [deleteOrgLoading, setDeleteOrgLoading] = useState(false);

  // Search Companies
  const [orgSearch, setOrgSearch] = useState('');

  // ==========================================
  // 2. USER MODALS & STATES
  // ==========================================
  const [isProvisionModalOpen, setIsProvisionModalOpen] = useState(false);
  const [selectedOrgForMember, setSelectedOrgForMember] = useState(
    activeOrgId && activeOrgId !== 'all' ? activeOrgId : (displayOrgs[0]?.id || '')
  );
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberPassword, setMemberPassword] = useState('');
  const [memberPhone, setMemberPhone] = useState('');
  const [memberRole, setMemberRole] = useState<Role>('employee');
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

  // Edit User State
  const [editingMember, setEditingMember] = useState<OrganizationMember | null>(null);
  const [editMemberName, setEditMemberName] = useState('');
  const [editMemberPhone, setEditMemberPhone] = useState('');
  const [editMemberOrgId, setEditMemberOrgId] = useState('');
  const [editMemberRole, setEditMemberRole] = useState<Role>('employee');
  const [editMemberDept, setEditMemberDept] = useState('');
  const [editMemberJob, setEditMemberJob] = useState('');
  const [editMemberActive, setEditMemberActive] = useState(true);
  const [editMemberLoading, setEditMemberLoading] = useState(false);

  // Delete User Confirmation
  const [deletingMember, setDeletingMember] = useState<OrganizationMember | null>(null);

  // Password Reset Notification
  const [resetFeedback, setResetFeedback] = useState<{ email: string; message: string; isError?: boolean } | null>(null);
  const [resettingPasswordEmail, setResettingPasswordEmail] = useState<string | null>(null);

  // Search & Filter for Users
  const [userSearch, setUserSearch] = useState('');
  const [userOrgFilter, setUserOrgFilter] = useState('all');
  const [userRoleFilter, setUserRoleFilter] = useState('all');
  const [userStatusFilter, setUserStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Super Admin Management Modal
  const [isSuperAdminModalOpen, setIsSuperAdminModalOpen] = useState(false);
  const [newSuperAdminEmail, setNewSuperAdminEmail] = useState('');
  const [superAdminAddSuccess, setSuperAdminAddSuccess] = useState(false);

  // Keep selectedOrgForMember updated
  React.useEffect(() => {
    if ((!selectedOrgForMember || selectedOrgForMember === 'all') && displayOrgs.length > 0) {
      setSelectedOrgForMember(displayOrgs[0].id);
    }
  }, [displayOrgs, selectedOrgForMember]);

  // ==========================================
  // HANDLERS: COMPANIES
  // ==========================================
  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim()) return;

    const codeToUse = orgCode.trim().toUpperCase() || orgName.trim().slice(0, 3).toUpperCase() || `ORG${Date.now().toString().slice(-3)}`;

    await addOrganization({
      name: orgName.trim(),
      code: codeToUse,
      currency: orgCurrency,
      budget: Number(orgBudget) || 0,
      description: orgDescription.trim(),
    });

    setOrgName('');
    setOrgCode('');
    setOrgDescription('');
    setIsOrgModalOpen(false);
  };

  const handleOpenEditOrg = (org: Organization) => {
    setEditingOrg(org);
    setEditOrgName(org.name);
    setEditOrgCode(org.code);
    setEditOrgCurrency(org.currency);
    setEditOrgBudget(org.budget.toString());
    setEditOrgDescription(org.description || '');
  };

  const handleSaveEditOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrg || !editOrgName.trim()) return;

    await updateOrganization(editingOrg.id, {
      name: editOrgName.trim(),
      code: editOrgCode.trim().toUpperCase() || editingOrg.code,
      currency: editOrgCurrency,
      budget: Number(editOrgBudget) || 0,
      description: editOrgDescription.trim(),
    });

    setEditingOrg(null);
  };

  const handleConfirmDeleteOrg = async () => {
    if (!deletingOrg) return;
    setDeleteOrgLoading(true);
    try {
      await deleteOrganization(deletingOrg.id);
      setDeletingOrg(null);
    } finally {
      setDeleteOrgLoading(false);
    }
  };

  // ==========================================
  // HANDLERS: USERS
  // ==========================================
  const handleProvisionUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberName.trim()) return;

    if (memberEmail.trim() && !isValidEmail(memberEmail.trim())) {
      setProvisionError('يرجى إدخال بريد إلكتروني مهني صحيح (مثال: user@company.com).');
      return;
    }

    if (memberPassword.trim() && memberPassword.trim().length < 6) {
      setProvisionError('يجب أن تتكون كلمة المرور من 6 خانات على الأقل.');
      return;
    }

    setProvisionError(null);
    setProvisionLoading(true);

    const targetOrg = displayOrgs.find(o => o.id === selectedOrgForMember) || displayOrgs[0];
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

    if (res.success && res.credentials) {
      setCreatedCredentials({
        name: memberName.trim(),
        email: res.credentials.email,
        password: res.credentials.password,
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

  const handleOpenEditMember = (mem: OrganizationMember) => {
    setEditingMember(mem);
    setEditMemberName(mem.userName);
    setEditMemberPhone(mem.phone || '');
    setEditMemberOrgId(mem.orgId);
    setEditMemberRole(mem.role);
    setEditMemberDept(mem.department || '');
    setEditMemberJob(mem.jobTitle || '');
    setEditMemberActive(mem.active !== false);
  };

  const handleSaveEditMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember || !editMemberName.trim()) return;

    setEditMemberLoading(true);
    try {
      await updateMember(editingMember.id, {
        userName: editMemberName.trim(),
        phone: editMemberPhone.trim(),
        orgId: isSuperAdmin ? editMemberOrgId : editingMember.orgId,
        role: editMemberRole,
        department: editMemberDept.trim(),
        jobTitle: editMemberJob.trim(),
        active: editMemberActive,
      });
      setEditingMember(null);
    } finally {
      setEditMemberLoading(false);
    }
  };

  const handleToggleStatus = async (mem: OrganizationMember) => {
    const newStatus = !mem.active;
    await toggleMemberStatus(mem.id, newStatus);
  };

  const handleResetPassword = async (email: string) => {
    if (!email) return;
    setResettingPasswordEmail(email);
    const res = await adminResetUserPassword(email);
    setResettingPasswordEmail(null);
    setResetFeedback({
      email,
      message: res.message || (res.success ? 'تم إرسال الرابط' : 'تعذر الإرسال'),
      isError: !res.success
    });
    setTimeout(() => {
      setResetFeedback(null);
    }, 4000);
  };

  const handleConfirmDeleteMember = async () => {
    if (!deletingMember) return;
    await removeMember(deletingMember.id);
    setDeletingMember(null);
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

  // ==========================================
  // FILTERED DATA
  // ==========================================
  const filteredOrgs = useMemo(() => {
    return displayOrgs.filter(org => {
      const matchSearch = 
        org.name.toLowerCase().includes(orgSearch.toLowerCase()) ||
        org.code.toLowerCase().includes(orgSearch.toLowerCase());
      return matchSearch;
    });
  }, [displayOrgs, orgSearch]);

  const filteredMembers = useMemo(() => {
    return members.filter(mem => {
      // 1. Search Query
      const q = userSearch.toLowerCase().trim();
      const matchSearch = !q || 
        mem.userName.toLowerCase().includes(q) ||
        mem.userEmail.toLowerCase().includes(q) ||
        (mem.phone && mem.phone.includes(q)) ||
        mem.jobTitle.toLowerCase().includes(q) ||
        mem.department.toLowerCase().includes(q);

      // 2. Org Filter
      const matchOrg = userOrgFilter === 'all' || mem.orgId === userOrgFilter;

      // 3. Role Filter
      const matchRole = userRoleFilter === 'all' || mem.role === userRoleFilter;

      // 4. Status Filter
      const matchStatus = 
        userStatusFilter === 'all' || 
        (userStatusFilter === 'active' && mem.active !== false) ||
        (userStatusFilter === 'inactive' && mem.active === false);

      return matchSearch && matchOrg && matchRole && matchStatus;
    });
  }, [members, userSearch, userOrgFilter, userRoleFilter, userStatusFilter]);

  // User Stats
  const totalUsersCount = members.length;
  const activeUsersCount = members.filter(m => m.active !== false).length;
  const inactiveUsersCount = members.filter(m => m.active === false).length;
  const orgAdminsCount = members.filter(m => m.role === 'org_admin').length;
  const employeesCount = members.filter(m => m.role === 'employee').length;

  return (
    <div className="space-y-8 pb-16">
      
      {/* Super Admin Top Control Banner */}
      {isSuperAdmin && (
        <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-300/40 rounded-3xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
          <div className="flex items-center gap-3.5">
            <div className="h-11 w-11 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-md shadow-amber-500/20">
              <Crown className="h-6 w-6" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 text-sm">لوحة إدارة السوبر أدمن والشركات (Super Admin Portal)</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                إدارة شاملة لجميع الكيانات المستقلة، تعيين الصلاحيات، وعزل البيانات بنسبة 100%.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsSuperAdminModalOpen(true)}
              className="px-3.5 py-2 bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100 font-bold text-xs rounded-xl shadow-2xs transition cursor-pointer"
            >
              قائمة السوبر أدمن ({superAdminEmails.length})
            </button>
            <button
              type="button"
              onClick={() => setIsOrgModalOpen(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              <span>إضافة شركة جديدة</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Navigation Tabs: Companies vs Users */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveSection('companies')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeSection === 'companies'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/20'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Building2 className="h-4 w-4" />
            <span>🏢 إدارة الشركات والمؤسسات ({displayOrgs.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('users')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeSection === 'users'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Users className="h-4 w-4" />
            <span>👥 إدارة المستخدمين والموظفين ({members.length})</span>
          </button>
        </div>

        {activeSection === 'companies' && canManageOrgs && (
          <button
            type="button"
            onClick={() => setIsOrgModalOpen(true)}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3.5 py-2 rounded-xl shadow-xs transition cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>إضافة شركة</span>
          </button>
        )}

        {activeSection === 'users' && (
          <button
            type="button"
            onClick={() => {
              setCreatedCredentials(null);
              setProvisionError(null);
              setIsProvisionModalOpen(true);
            }}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-3.5 py-2 rounded-xl shadow-xs transition cursor-pointer"
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>تعيين مستخدم جديد</span>
          </button>
        )}
      </div>

      {/* =========================================================================
          SECTION 1: COMPANIES MANAGEMENT
          ========================================================================= */}
      {activeSection === 'companies' && (
        <div className="space-y-5">
          
          {/* Company Search Bar */}
          {canManageOrgs && displayOrgs.length > 2 && (
            <div className="flex items-center gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-xs max-w-md">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={orgSearch}
                onChange={(e) => setOrgSearch(e.target.value)}
                placeholder="ابحث عن شركة بالاسم أو الرمز المالي..."
                className="w-full text-xs bg-transparent outline-hidden text-slate-800"
              />
              {orgSearch && (
                <button onClick={() => setOrgSearch('')} className="text-slate-400 hover:text-slate-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Companies Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {filteredOrgs.map((org) => {
              const orgMembersCount = members.filter(m => m.orgId === org.id).length;
              const orgTotalDisbursed = requests
                .filter(r => r.orgId === org.id && r.status === 'disbursed')
                .reduce((sum, r) => sum + r.amount, 0);

              const isCurrentActive = activeOrgId === org.id;
              const remainingBudget = Math.max(0, org.budget - orgTotalDisbursed);
              const percentageSpent = org.budget > 0 ? Math.min(100, Math.round((orgTotalDisbursed / org.budget) * 100)) : 0;

              return (
                <div 
                  key={org.id} 
                  className={`bg-white rounded-2xl border p-5 shadow-xs transition relative overflow-hidden ${
                    isCurrentActive 
                      ? 'border-emerald-500 ring-2 ring-emerald-500/20' 
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {/* Top Row: Icon, Name, Code, Badges & Actions */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-2xl bg-emerald-50 text-emerald-700 font-extrabold flex items-center justify-center border border-emerald-100 text-sm shadow-xs">
                        {org.code.slice(0, 3)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-extrabold text-slate-900 text-base">{org.name}</h3>
                          {isCurrentActive && (
                            <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Check className="h-3 w-3" />
                              <span>المؤسسة النشطة</span>
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                          <span className="font-mono font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                            {org.code}
                          </span>
                          <span>• العملة: <strong>{org.currency}</strong></span>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons for Company */}
                    <div className="flex items-center gap-1">
                      {isSuperAdmin && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleOpenEditOrg(org)}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                            title="تعديل بيانات الشركة"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingOrg(org)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                            title="حذف الشركة"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          {!isCurrentActive && (
                            <button
                              type="button"
                              onClick={() => setActiveOrgId(org.id)}
                              className="mr-1 text-[11px] font-bold text-slate-600 hover:text-emerald-700 bg-slate-100 hover:bg-emerald-50 px-2.5 py-1 rounded-lg transition cursor-pointer"
                            >
                              تفعيل
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-slate-500 mt-3 line-clamp-2">
                    {org.description || 'شركة ومؤسسة معتمدة في المنصة المصرفية.'}
                  </p>

                  {/* Financial Progress Bar */}
                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-slate-500 text-[11px]">نسبة استهلاك الميزانية:</span>
                      <span className="font-bold font-mono text-slate-800">{percentageSpent}%</span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-300 ${
                          percentageSpent > 90 ? 'bg-rose-500' : percentageSpent > 70 ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${percentageSpent}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Live Financial Metrics */}
                  <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-slate-100 text-xs">
                    <div className="bg-slate-50 p-2 rounded-xl text-center">
                      <span className="text-slate-400 block text-[10px]">الميزانية</span>
                      <span className="font-bold text-slate-800 text-[11px] truncate block">
                        {org.budget.toLocaleString()} {org.currency}
                      </span>
                    </div>
                    <div className="bg-slate-50 p-2 rounded-xl text-center">
                      <span className="text-slate-400 block text-[10px]">المنصرف</span>
                      <span className="font-bold text-emerald-700 text-[11px] truncate block">
                        {orgTotalDisbursed.toLocaleString()} {org.currency}
                      </span>
                    </div>
                    <div className="bg-slate-50 p-2 rounded-xl text-center">
                      <span className="text-slate-400 block text-[10px]">المتبقي</span>
                      <span className="font-bold text-slate-700 text-[11px] truncate block">
                        {remainingBudget.toLocaleString()} {org.currency}
                      </span>
                    </div>
                    <div className="bg-slate-50 p-2 rounded-xl text-center">
                      <span className="text-slate-400 block text-[10px]">فريق العمل</span>
                      <span className="font-bold text-indigo-700 text-[11px]">
                        {orgMembersCount} عضو
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            {filteredOrgs.length === 0 && (
              <div className="col-span-full bg-white rounded-3xl border border-slate-200 p-12 text-center text-slate-400">
                <Building className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                <p className="font-bold text-sm text-slate-700">لم يتم العثور على أي شركات مطابقة للبحث</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          SECTION 2: USERS & EMPLOYEES MANAGEMENT
          ========================================================================= */}
      {activeSection === 'users' && (
        <div className="space-y-6">
          
          {/* User Stats Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-slate-400 text-xs block">إجمالي المستخدمين</span>
              <span className="text-xl font-extrabold text-slate-900 mt-1 block">{totalUsersCount}</span>
            </div>
            <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-emerald-600 text-xs block font-bold">الحسابات النشطة</span>
              <span className="text-xl font-extrabold text-emerald-700 mt-1 block">{activeUsersCount}</span>
            </div>
            <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-rose-500 text-xs block font-bold">الحسابات المعطلة</span>
              <span className="text-xl font-extrabold text-rose-600 mt-1 block">{inactiveUsersCount}</span>
            </div>
            <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-indigo-600 text-xs block font-bold">مدراء الشركات</span>
              <span className="text-xl font-extrabold text-indigo-700 mt-1 block">{orgAdminsCount}</span>
            </div>
            <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs col-span-2 sm:col-span-1">
              <span className="text-slate-500 text-xs block font-bold">الموظفون (طالب صرف)</span>
              <span className="text-xl font-extrabold text-slate-800 mt-1 block">{employeesCount}</span>
            </div>
          </div>

          {/* Feedback banner for Password Reset */}
          {resetFeedback && (
            <div className={`p-4 rounded-2xl text-xs flex items-center justify-between gap-3 shadow-xs animate-in fade-in duration-200 ${
              resetFeedback.isError 
                ? 'bg-rose-50 border border-rose-200 text-rose-900' 
                : 'bg-emerald-50 border border-emerald-200 text-emerald-900'
            }`}>
              <div className="flex items-center gap-2">
                {resetFeedback.isError ? <AlertCircle className="h-4 w-4 text-rose-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                <span className="font-semibold">{resetFeedback.message}</span>
              </div>
              <button onClick={() => setResetFeedback(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Users Control & Filter Bar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              
              {/* Search */}
              <div className="relative md:col-span-2">
                <Search className="h-4 w-4 text-slate-400 absolute right-3 top-3" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="ابحث بالاسم، البريد، الهاتف، أو المسمى الوظيفي..."
                  className="w-full text-xs pr-9 pl-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:border-indigo-500 outline-hidden transition"
                />
              </div>

              {/* Company Filter (For Super Admin) */}
              {canManageOrgs ? (
                <div>
                  <select
                    value={userOrgFilter}
                    onChange={(e) => setUserOrgFilter(e.target.value)}
                    className="w-full text-xs px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:border-indigo-500 outline-hidden transition cursor-pointer font-medium"
                  >
                    <option value="all">🏢 جميع الشركات</option>
                    {displayOrgs.map(o => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="flex items-center px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs font-bold text-slate-700">
                  <Building2 className="h-3.5 w-3.5 text-emerald-600 ml-1.5" />
                  <span>{displayOrgs[0]?.name || 'شركتك'}</span>
                </div>
              )}

              {/* Role Filter */}
              <div>
                <select
                  value={userRoleFilter}
                  onChange={(e) => setUserRoleFilter(e.target.value)}
                  className="w-full text-xs px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:border-indigo-500 outline-hidden transition cursor-pointer font-medium"
                >
                  <option value="all">🎭 جميع الأدوار</option>
                  <option value="super_admin">سوبر أدمن</option>
                  <option value="org_admin">مدير شركة</option>
                  <option value="employee">موظف (طالب صرف)</option>
                  <option value="data_entry">مدخل بيانات</option>
                </select>
              </div>
            </div>

            {/* Sub-Filters: Status & Active Filters summary */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-[11px]">حالة الحساب:</span>
                <button
                  type="button"
                  onClick={() => setUserStatusFilter('all')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition ${
                    userStatusFilter === 'all' ? 'bg-indigo-50 text-indigo-800' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  الكل ({members.length})
                </button>
                <button
                  type="button"
                  onClick={() => setUserStatusFilter('active')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition ${
                    userStatusFilter === 'active' ? 'bg-emerald-50 text-emerald-800' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  النشط ({activeUsersCount})
                </button>
                <button
                  type="button"
                  onClick={() => setUserStatusFilter('inactive')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition ${
                    userStatusFilter === 'inactive' ? 'bg-rose-50 text-rose-800' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  المعطل ({inactiveUsersCount})
                </button>
              </div>

              <span className="text-slate-400 text-[11px]">
                المعروض: <strong>{filteredMembers.length}</strong> مستخدم
              </span>
            </div>
          </div>

          {/* Full Users Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                  <tr>
                    <th className="p-4">المستخدم</th>
                    <th className="p-4">الهاتف</th>
                    <th className="p-4">الشركة</th>
                    <th className="p-4">القسم والمسمى</th>
                    <th className="p-4">الصلاحية</th>
                    <th className="p-4">حالة الحساب</th>
                    <th className="p-4 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMembers.map((mem) => {
                    const memberOrg = displayOrgs.find(o => o.id === mem.orgId);
                    const isUserActive = mem.active !== false;

                    return (
                      <tr key={mem.id} className={`hover:bg-slate-50/80 transition ${!isUserActive ? 'opacity-60 bg-slate-50/50' : ''}`}>
                        
                        {/* User Name & Email */}
                        <td className="p-4">
                          <div className="flex items-center gap-2.5">
                            <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs text-white ${
                              mem.role === 'super_admin' ? 'bg-amber-500' : mem.role === 'org_admin' ? 'bg-indigo-600' : 'bg-emerald-600'
                            }`}>
                              {(mem.userName || mem.userEmail || 'U').slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                <span>{mem.userName}</span>
                                {!isUserActive && (
                                  <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 rounded font-medium">معطل</span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-400 font-mono">{mem.userEmail}</div>
                            </div>
                          </div>
                        </td>

                        {/* Phone */}
                        <td className="p-4">
                          <span className="font-mono text-slate-700">{mem.phone || '—'}</span>
                        </td>

                        {/* Organization */}
                        <td className="p-4">
                          <span className="font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                            {memberOrg?.name || 'غير محدد'}
                          </span>
                        </td>

                        {/* Department & Job */}
                        <td className="p-4">
                          <div className="font-medium text-slate-800">{mem.jobTitle || 'موظف'}</div>
                          <div className="text-[10px] text-slate-400">{mem.department || 'العمليات'}</div>
                        </td>

                        {/* Role */}
                        <td className="p-4">
                          {mem.role === 'super_admin' ? (
                            <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-900 border border-amber-200 px-2.5 py-0.5 rounded-full font-bold text-[11px]">
                              <Crown className="h-3 w-3 text-amber-600" />
                              <span>سوبر أدمن</span>
                            </span>
                          ) : mem.role === 'org_admin' ? (
                            <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-900 border border-indigo-200 px-2.5 py-0.5 rounded-full font-bold text-[11px]">
                              <ShieldCheck className="h-3 w-3 text-indigo-600" />
                              <span>مدير الشركة</span>
                            </span>
                          ) : mem.role === 'data_entry' ? (
                            <span className="inline-flex items-center gap-1 bg-sky-50 text-sky-900 border border-sky-200 px-2.5 py-0.5 rounded-full font-bold text-[11px]">
                              <span>✍️ مدخل بيانات</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-0.5 rounded-full font-semibold text-[11px]">
                              <span>موظف (طالب صرف)</span>
                            </span>
                          )}
                        </td>

                        {/* Account Status Toggle */}
                        <td className="p-4">
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(mem)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold transition cursor-pointer ${
                              isUserActive 
                                ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200' 
                                : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                            }`}
                            title="انقر لتغيير حالة الحساب (تفعيل / تعطيل)"
                          >
                            {isUserActive ? (
                              <>
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                <span>نشط ومفعل</span>
                              </>
                            ) : (
                              <>
                                <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
                                <span>معطل مؤقتاً</span>
                              </>
                            )}
                          </button>
                        </td>

                        {/* Action Buttons */}
                        <td className="p-4 text-center">
                          <div className="flex items-center justify-center gap-1">
                            
                            {/* Reset Password */}
                            <button
                              type="button"
                              onClick={() => handleResetPassword(mem.userEmail)}
                              disabled={resettingPasswordEmail === mem.userEmail}
                              className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition cursor-pointer"
                              title="إرسال رابط استعادة وتعيين كلمة المرور"
                            >
                              {resettingPasswordEmail === mem.userEmail ? (
                                <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
                              ) : (
                                <KeyRound className="h-4 w-4" />
                              )}
                            </button>

                            {/* Edit User */}
                            <button
                              type="button"
                              onClick={() => handleOpenEditMember(mem)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                              title="تعديل بيانات المستخدم"
                            >
                              <Edit className="h-4 w-4" />
                            </button>

                            {/* Delete User */}
                            <button
                              type="button"
                              onClick={() => setDeletingMember(mem)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                              title="حذف المستخدم نهائياً"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredMembers.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-10 text-center text-slate-400">
                        <Users className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                        <p className="font-bold text-xs text-slate-700">لا يوجد مستخدمون مطابقون لمعايير البحث والفلترة</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">يمكنك إضافة موظف جديد أو تعديل خيارات التصفية بالأعلى</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODALS
          ========================================================================= */}

      {/* 1. Add Company Modal (Super Admin) */}
      {isOrgModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl p-6 border border-slate-100 text-xs animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                <Building2 className="h-4 w-4 text-emerald-600" />
                <span>إضافة شركة / مؤسسة جديدة</span>
              </h3>
              <button onClick={() => setIsOrgModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateOrg} className="mt-4 space-y-3.5">
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم المؤسسة أو الشركة *</label>
                <input
                  type="text"
                  required
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="مثال: شركة الرواد للتجارة والمقاولات..."
                  className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-emerald-500 outline-hidden font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">الرمز المالي (الكود) *</label>
                  <input
                    type="text"
                    value={orgCode}
                    onChange={(e) => setOrgCode(sanitizeCode(e.target.value))}
                    placeholder="مثال: RWD"
                    className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-emerald-500 outline-hidden font-mono uppercase font-bold"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">العملة المعتمدة *</label>
                  <select
                    value={orgCurrency}
                    onChange={(e) => setOrgCurrency(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-emerald-500 outline-hidden font-medium"
                  >
                    {SUPPORTED_CURRENCIES.map(c => (
                      <option key={c.code} value={c.code}>{c.nameAr} ({c.code})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">الميزانية السنوية التقديرية *</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={orgBudget}
                  onKeyDown={handleNumericKeyDown}
                  onChange={(e) => setOrgBudget(sanitizeDigitsOnly(e.target.value))}
                  placeholder="500000"
                  className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-emerald-500 outline-hidden font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">نبذة عن نشاط الشركة</label>
                <textarea
                  rows={2}
                  value={orgDescription}
                  onChange={(e) => setOrgDescription(e.target.value)}
                  placeholder="اكتب وصفاً مختصراً لمجال عمل الشركة..."
                  className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-emerald-500 outline-hidden"
                ></textarea>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsOrgModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl font-bold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-xs cursor-pointer"
                >
                  حفظ وتأسيس الشركة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Edit Company Modal */}
      {editingOrg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl p-6 border border-slate-100 text-xs animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                <Edit className="h-4 w-4 text-indigo-600" />
                <span>تعديل بيانات الشركة: {editingOrg.name}</span>
              </h3>
              <button onClick={() => setEditingOrg(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditOrg} className="mt-4 space-y-3.5">
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم المؤسسة أو الشركة *</label>
                <input
                  type="text"
                  required
                  value={editOrgName}
                  onChange={(e) => setEditOrgName(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 outline-hidden font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">الرمز المالي (الكود) *</label>
                  <input
                    type="text"
                    value={editOrgCode}
                    onChange={(e) => setEditOrgCode(sanitizeCode(e.target.value))}
                    className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 outline-hidden font-mono uppercase font-bold"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">العملة المعتمدة *</label>
                  <select
                    value={editOrgCurrency}
                    onChange={(e) => setEditOrgCurrency(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 outline-hidden font-medium"
                  >
                    {SUPPORTED_CURRENCIES.map(c => (
                      <option key={c.code} value={c.code}>{c.nameAr} ({c.code})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">الميزانية السنوية التقديرية *</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={editOrgBudget}
                  onKeyDown={handleNumericKeyDown}
                  onChange={(e) => setEditOrgBudget(sanitizeDigitsOnly(e.target.value))}
                  className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 outline-hidden font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">نبذة عن نشاط الشركة</label>
                <textarea
                  rows={2}
                  value={editOrgDescription}
                  onChange={(e) => setEditOrgDescription(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 outline-hidden"
                ></textarea>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingOrg(null)}
                  className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl font-bold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-xs cursor-pointer"
                >
                  حفظ التعديلات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Delete Company Confirmation Modal */}
      {deletingOrg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full shadow-2xl p-6 border border-slate-100 text-xs text-center animate-in fade-in zoom-in-95 duration-150">
            <div className="h-12 w-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-3">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h3 className="font-extrabold text-slate-900 text-sm">تأكيد حذف الشركة</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              هل أنت متأكد من رغبتك في حذف شركة <strong className="text-slate-900 font-bold">{deletingOrg.name}</strong>؟
              سيتم إزالة السجل من قاعدة البيانات.
            </p>

            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={() => setDeletingOrg(null)}
                className="flex-1 py-2.5 bg-slate-100 text-slate-700 font-bold rounded-xl cursor-pointer"
              >
                تراجع
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteOrg}
                disabled={deleteOrgLoading}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
              >
                {deleteOrgLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>نعم، احذف الشركة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Provision User Modal */}
      {isProvisionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl p-6 border border-slate-100 text-xs animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                  <UserPlus className="h-4 w-4" />
                </div>
                <h3 className="font-bold text-slate-900 text-sm">تعيين حساب مستخدم / موظف رسمي جديد</h3>
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
                    يمكن للموظف الآن تسجيل الدخول مباشرة بالبريد الإلكتروني وكلمة المرور التالية:
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
                    <Copy className="h-4 w-4" />
                    <span>{copiedLink ? 'تم النسخ بنجاح! ✓' : 'نسخ بيانات الدخول لمشاركتها'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatedCredentials(null)}
                    className="px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl cursor-pointer"
                  >
                    إضافة آخر
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleProvisionUser} className="mt-4 space-y-3.5">
                
                {provisionError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                    <span>{provisionError}</span>
                  </div>
                )}

                {/* Company Selection (Super Admin only) */}
                {isSuperAdmin && (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">الشركة التابع لها الموظف *</label>
                    <select
                      value={selectedOrgForMember}
                      onChange={(e) => setSelectedOrgForMember(e.target.value)}
                      className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 outline-hidden font-medium"
                    >
                      {displayOrgs.map(o => (
                        <option key={o.id} value={o.id}>{o.name} ({o.code})</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Name & Role */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">اسم الموظف الكامل *</label>
                    <input
                      type="text"
                      required
                      value={memberName}
                      onChange={(e) => setMemberName(e.target.value)}
                      placeholder="مثال: أحمد عبد الله..."
                      className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">الدور والصلاحية *</label>
                    <select
                      value={memberRole}
                      onChange={(e) => setMemberRole(e.target.value as Role)}
                      className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 outline-hidden font-medium"
                    >
                      <option value="employee">👤 موظف (طالب صرف)</option>
                      <option value="org_admin">🏢 مدير شركة (اعتماد وصرف)</option>
                      <option value="data_entry">✍️ مدخل بيانات</option>
                      {isSuperAdmin && <option value="super_admin">🛡️ سوبر أدمن</option>}
                    </select>
                  </div>
                </div>

                {/* Email & Password */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">البريد الإلكتروني المهني</label>
                    <input
                      type="email"
                      value={memberEmail}
                      onChange={(e) => setMemberEmail(e.target.value)}
                      placeholder="user@company.com"
                      className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 outline-hidden font-mono"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">كلمة المرور المبدئية</label>
                    <input
                      type="text"
                      value={memberPassword}
                      onChange={(e) => setMemberPassword(e.target.value)}
                      placeholder="123456"
                      className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 outline-hidden font-mono"
                    />
                  </div>
                </div>

                {/* Phone & Department */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">رقم الهاتف المحمول</label>
                    <input
                      type="text"
                      value={memberPhone}
                      onChange={(e) => setMemberPhone(sanitizePhone(e.target.value))}
                      placeholder="01012345678 أو 0501234567"
                      className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 outline-hidden font-mono"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">القسم</label>
                    <input
                      type="text"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      placeholder="مثال: المبيعات، العمليات..."
                      className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 outline-hidden"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">المسمى الوظيفي</label>
                  <input
                    type="text"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder="مثال: مسؤول مبيعات، مهندس مشتريات..."
                    className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 outline-hidden"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsProvisionModalOpen(false)}
                    className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl font-bold cursor-pointer"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={provisionLoading}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-xs cursor-pointer flex items-center gap-2"
                  >
                    {provisionLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <span>إنشاء الحساب وتفعيله</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* 5. Edit User Modal */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl p-6 border border-slate-100 text-xs animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                <Edit className="h-4 w-4 text-indigo-600" />
                <span>تعديل بيانات المستخدم: {editingMember.userName}</span>
              </h3>
              <button onClick={() => setEditingMember(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditMember} className="mt-4 space-y-3.5">
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم الموظف الكامل *</label>
                <input
                  type="text"
                  required
                  value={editMemberName}
                  onChange={(e) => setEditMemberName(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 outline-hidden font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">البريد الإلكتروني (للعرض فقط)</label>
                  <input
                    type="email"
                    disabled
                    value={editingMember.userEmail}
                    className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-100 text-slate-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">رقم الهاتف</label>
                  <input
                    type="text"
                    value={editMemberPhone}
                    onChange={(e) => setEditMemberPhone(sanitizePhone(e.target.value))}
                    className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 outline-hidden font-mono"
                  />
                </div>
              </div>

              {/* Org & Role */}
              <div className="grid grid-cols-2 gap-3">
                {isSuperAdmin && (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">الشركة التابع لها</label>
                    <select
                      value={editMemberOrgId}
                      onChange={(e) => setEditMemberOrgId(e.target.value)}
                      className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 outline-hidden font-medium"
                    >
                      {displayOrgs.map(o => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className={!isSuperAdmin ? 'col-span-2' : ''}>
                  <label className="block font-bold text-slate-700 mb-1">الدور والصلاحية *</label>
                  <select
                    value={editMemberRole}
                    onChange={(e) => setEditMemberRole(e.target.value as Role)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 outline-hidden font-medium"
                  >
                    <option value="employee">👤 موظف (طالب صرف)</option>
                    <option value="org_admin">🏢 مدير شركة</option>
                    <option value="data_entry">✍️ مدخل بيانات</option>
                    {isSuperAdmin && <option value="super_admin">🛡️ سوبر أدمن</option>}
                  </select>
                </div>
              </div>

              {/* Dept & Job */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">القسم</label>
                  <input
                    type="text"
                    value={editMemberDept}
                    onChange={(e) => setEditMemberDept(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 outline-hidden"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">المسمى الوظيفي</label>
                  <input
                    type="text"
                    value={editMemberJob}
                    onChange={(e) => setEditMemberJob(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 outline-hidden"
                  />
                </div>
              </div>

              {/* Status Toggle in Edit Form */}
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="editMemberActiveCheck"
                  checked={editMemberActive}
                  onChange={(e) => setEditMemberActive(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <label htmlFor="editMemberActiveCheck" className="text-xs font-bold text-slate-700 cursor-pointer">
                  تفعيل حساب المستخدم (السماح بتسجيل الدخول)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingMember(null)}
                  className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl font-bold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={editMemberLoading}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-xs cursor-pointer flex items-center gap-2"
                >
                  {editMemberLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>حفظ التعديلات</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. Delete User Confirmation Modal */}
      {deletingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full shadow-2xl p-6 border border-slate-100 text-xs text-center animate-in fade-in zoom-in-95 duration-150">
            <div className="h-12 w-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-3">
              <Trash2 className="h-6 w-6" />
            </div>
            <h3 className="font-extrabold text-slate-900 text-sm">تأكيد حذف المستخدم</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              هل أنت متأكد من رغبتك في حذف حساب <strong className="text-slate-900 font-bold">{deletingMember.userName}</strong> ({deletingMember.userEmail})؟
            </p>

            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={() => setDeletingMember(null)}
                className="flex-1 py-2.5 bg-slate-100 text-slate-700 font-bold rounded-xl cursor-pointer"
              >
                تراجع
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteMember}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-xs cursor-pointer"
              >
                نعم، احذف الحساب
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Super Admin Management Modal */}
      {isSuperAdminModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl p-6 border border-slate-100 text-xs animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                <Crown className="h-4 w-4 text-amber-600" />
                <span>إدارة حسابات السوبر أدمن (Super Admins)</span>
              </h3>
              <button onClick={() => setIsSuperAdminModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <p className="text-xs text-slate-500">
                أصحاب هذه العناوين لديهم صلاحية كاملة على كل المؤسسات والتحليلات دون قيود:
              </p>

              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-200 max-h-48 overflow-y-auto divide-y divide-slate-200/60 font-mono text-xs">
                {superAdminEmails.map((email) => (
                  <div key={email} className="py-2 flex items-center justify-between">
                    <span className="text-slate-800 font-bold">{email}</span>
                    <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-sans font-bold">نشط</span>
                  </div>
                ))}
              </div>

              {superAdminAddSuccess && (
                <div className="p-2.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-center font-bold">
                  تمت إضافة السوبر أدمن بنجاح!
                </div>
              )}

              <form onSubmit={handleAddSuperAdmin} className="space-y-2 pt-2">
                <label className="block font-bold text-slate-700">إضافة بريد سوبر أدمن جديد:</label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    required
                    value={newSuperAdminEmail}
                    onChange={(e) => setNewSuperAdminEmail(e.target.value)}
                    placeholder="admin@example.com"
                    className="flex-1 p-2.5 rounded-xl border border-slate-200 focus:border-amber-500 outline-hidden font-mono"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold shadow-xs cursor-pointer"
                  >
                    إضافة
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
