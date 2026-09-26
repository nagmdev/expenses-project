import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Users, 
  Search, 
  X, 
  RotateCcw, 
  Trash2, 
  KeyRound, 
  Edit3, 
  Crown, 
  CheckCircle2, 
  Building2, 
  Plus, 
  ShieldCheck, 
  Loader2, 
  Phone,
  AlertTriangle
} from 'lucide-react';
import { OrganizationMember, Role, SUPPORTED_CURRENCIES } from '../types';
import { isValidEmail, sanitizePhone } from '../utils/validation';

export const UsersManagement: React.FC = () => {
  const {
    allMembers,
    members,
    allOrganizations,
    organizations,
    superAdminEmails,
    addSuperAdminEmail,
    removeSuperAdminEmail,
    addMember,
    updateMember,
    removeMember,
    adminResetUserPassword,
    activeOrgId,
    currentRole,
    currentUser,
  } = useApp();

  // Search and Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrgFilter, setSelectedOrgFilter] = useState('all');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState('all');
  const [selectedRankFilter, setSelectedRankFilter] = useState('all');

  // Modal States
  const [editingMember, setEditingMember] = useState<OrganizationMember | null>(null);
  const [editMemberName, setEditMemberName] = useState('');
  const [editMemberRole, setEditMemberRole] = useState<Role | 'super_admin'>('employee');
  const [editMemberDept, setEditMemberDept] = useState('');
  const [editMemberTitle, setEditMemberTitle] = useState('');
  const [editMemberPhone, setEditMemberPhone] = useState('');
  const [editMemberOrgId, setEditMemberOrgId] = useState('');
  const [editMemberStatus, setEditMemberStatus] = useState<'active' | 'inactive'>('active');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Provision Modal States
  const [isProvisionModalOpen, setIsProvisionModalOpen] = useState(false);
  const [provName, setProvName] = useState('');
  const [provEmail, setProvEmail] = useState('');
  const [provRole, setProvRole] = useState<Role | 'super_admin'>('employee');
  const [provOrgId, setProvOrgId] = useState('');
  const [provDept, setProvDept] = useState('الإدارة العامة');
  const [provTitle, setProvTitle] = useState('');
  const [provPhone, setProvPhone] = useState('');
  const [provError, setProvError] = useState('');
  const [isProvisioning, setIsProvisioning] = useState(false);

  // Deletion Confirmation
  const [deletingMember, setDeletingMember] = useState<OrganizationMember | null>(null);

  // Reset Password State
  const [resettingPasswordEmail, setResettingPasswordEmail] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{ message: string; isError: boolean } | null>(null);

  const displayMembers = currentRole === 'super_admin' ? allMembers : members;
  const displayOrgs = currentRole === 'super_admin' ? allOrganizations : organizations;

  // Compute Metrics
  const totalUsersCount = displayMembers.length;
  const activeUsersCount = displayMembers.filter(m => m.active !== false).length;
  const disabledUsersCount = displayMembers.filter(m => m.active === false).length;
  const companyManagersCount = displayMembers.filter(m => m.role === 'org_admin').length;
  const employeesCount = displayMembers.filter(m => m.role === 'employee').length;

  // Filter Members
  const filteredMembers = useMemo(() => {
    return displayMembers.filter(mem => {
      // 1. Text Search
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = (mem.userName || '').toLowerCase().includes(query);
        const matchesEmail = (mem.userEmail || '').toLowerCase().includes(query);
        const matchesTitle = (mem.jobTitle || '').toLowerCase().includes(query);
        const matchesDept = (mem.department || '').toLowerCase().includes(query);
        const matchesPhone = (mem.phone || '').includes(query);
        if (!matchesName && !matchesEmail && !matchesTitle && !matchesDept && !matchesPhone) {
          return false;
        }
      }

      // 2. Org Filter
      if (selectedOrgFilter !== 'all' && mem.orgId !== selectedOrgFilter) {
        return false;
      }

      // 3. Role Filter
      if (selectedRoleFilter !== 'all') {
        const isSuperAdmin = superAdminEmails.some(e => e.toLowerCase().trim() === mem.userEmail?.toLowerCase().trim()) || mem.role === 'super_admin';
        if (selectedRoleFilter === 'super_admin' && !isSuperAdmin) return false;
        if (selectedRoleFilter !== 'super_admin' && (isSuperAdmin || mem.role !== selectedRoleFilter)) return false;
      }

      // 4. Rank Filter (all ranks and roles)
      if (selectedRankFilter !== 'all') {
        if (selectedRankFilter === 'admin_only' && mem.role !== 'org_admin') return false;
        if (selectedRankFilter === 'employee_only' && mem.role !== 'employee') return false;
      }

      return true;
    });
  }, [displayMembers, searchQuery, selectedOrgFilter, selectedRoleFilter, selectedRankFilter, superAdminEmails]);

  // Reset all filters
  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedOrgFilter('all');
    setSelectedRoleFilter('all');
    setSelectedRankFilter('all');
  };

  // Password Reset Handler
  const handleResetPassword = async (email: string) => {
    if (!email) return;
    setResettingPasswordEmail(email);
    setFeedbackMessage(null);
    try {
      const res = await adminResetUserPassword(email);
      setFeedbackMessage({ message: res.message || 'تم إرسال رابط إعادة تعيين كلمة المرور', isError: !res.success });
    } catch (err: any) {
      setFeedbackMessage({ message: err?.message || 'تعذر إرسال رابط التعيين', isError: true });
    } finally {
      setResettingPasswordEmail(null);
      setTimeout(() => setFeedbackMessage(null), 6000);
    }
  };

  // Super Admin Promotion / Demotion
  const handleToggleSuperAdmin = async (email: string) => {
    if (!email || currentRole !== 'super_admin') return;
    const isAlreadySuper = superAdminEmails.some(e => e.toLowerCase().trim() === email.toLowerCase().trim());
    try {
      if (isAlreadySuper) {
        if (confirm(`هل أنت متأكد من سحب صلاحيات السوبر أدمن من ${email}؟`)) {
          await removeSuperAdminEmail(email);
          setFeedbackMessage({ message: `تم سحب صلاحيات السوبر أدمن من ${email}`, isError: false });
        }
      } else {
        if (confirm(`هل تريد ترقية ${email} إلى سوبر أدمن (مشرف عام على كامل النظام والشركات)؟`)) {
          await addSuperAdminEmail(email);
          setFeedbackMessage({ message: `تمت ترقية ${email} إلى سوبر أدمن بنجاح 👑`, isError: false });
        }
      }
    } catch (err: any) {
      setFeedbackMessage({ message: err?.message || 'فشلت عملية تغيير الصلاحية', isError: true });
    } finally {
      setTimeout(() => setFeedbackMessage(null), 5000);
    }
  };

  // Open Edit Modal
  const handleStartEdit = (member: OrganizationMember) => {
    setEditingMember(member);
    setEditMemberName(member.userName || '');
    const isSuper = superAdminEmails.some(e => e.toLowerCase().trim() === member.userEmail?.toLowerCase().trim()) || member.role === 'super_admin';
    setEditMemberRole(isSuper ? 'super_admin' : member.role);
    setEditMemberDept(member.department || 'الإدارة العامة');
    setEditMemberTitle(member.jobTitle || '');
    setEditMemberPhone(member.phone || '');
    setEditMemberOrgId(member.orgId || '');
    setEditMemberStatus(member.active === false ? 'inactive' : 'active');
    setIsEditModalOpen(true);
  };

  // Save Edit
  const handleSaveEdit = async () => {
    if (!editingMember) return;
    const isCurrentlySuper = superAdminEmails.some(e => e.toLowerCase().trim() === editingMember.userEmail?.toLowerCase().trim());
    
    // Role change handling for Super Admin
    if (editMemberRole === 'super_admin' && !isCurrentlySuper && editingMember.userEmail) {
      await addSuperAdminEmail(editingMember.userEmail);
    } else if (isCurrentlySuper && editMemberRole !== 'super_admin' && editingMember.userEmail) {
      await removeSuperAdminEmail(editingMember.userEmail);
    }

    const targetRole: Role = editMemberRole === 'super_admin' ? 'org_admin' : editMemberRole;
    await updateMember(editingMember.id, {
      userName: editMemberName,
      role: targetRole,
      department: editMemberDept,
      jobTitle: editMemberTitle,
      phone: editMemberPhone,
      orgId: editMemberOrgId || editingMember.orgId,
      active: editMemberStatus === 'active',
    });

    setIsEditModalOpen(false);
    setEditingMember(null);
    setFeedbackMessage({ message: `تم حفظ تعديلات المستخدم ${editMemberName} بنجاح`, isError: false });
    setTimeout(() => setFeedbackMessage(null), 4000);
  };

  // Provision New User
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setProvError('');
    if (!provName.trim()) {
      setProvError('يرجى إدخال اسم الموظف بالكامل');
      return;
    }
    if (!provEmail.trim() || !isValidEmail(provEmail)) {
      setProvError('يرجى إدخال بريد إلكتروني صحيح');
      return;
    }
    const targetOrgId = provOrgId || activeOrgId || (displayOrgs[0]?.id || '');
    if (!targetOrgId) {
      setProvError('يرجى اختيار الشركة التابع لها الموظف');
      return;
    }

    // 🔴 FIX: Duplicate email check — prevent adding the same email twice
    const normalizedEmail = provEmail.trim().toLowerCase();
    const existingMember = members.find(m => 
      m.userEmail?.toLowerCase().trim() === normalizedEmail && m.orgId === targetOrgId
    );
    if (existingMember) {
      setProvError(`هذا البريد الإلكتروني (${provEmail}) مسجل بالفعل باسم "${existingMember.userName}" في هذه المؤسسة. لا يمكن إضافته مرة أخرى.`);
      return;
    }
    // Also check across ALL orgs for awareness
    const existingAnywhere = members.find(m => 
      m.userEmail?.toLowerCase().trim() === normalizedEmail && m.orgId !== targetOrgId
    );
    if (existingAnywhere) {
      // Allow but warn — user might belong to multiple orgs
      console.warn(`[Users] Email ${normalizedEmail} exists in another org (${existingAnywhere.orgId}), adding to ${targetOrgId}`);
    }

    setIsProvisioning(true);
    try {
      const isSuper = provRole === 'super_admin';
      const effectiveRole: Role = isSuper ? 'org_admin' : provRole;

      await addMember({
        orgId: targetOrgId,
        userId: 'temp_' + Date.now(),
        userName: provName.trim(),
        userEmail: provEmail.trim().toLowerCase(),
        role: effectiveRole,
        department: provDept.trim() || 'الإدارة العامة',
        jobTitle: provTitle.trim() || 'موظف',
        phone: provPhone.trim(),
        active: true,
      });

      if (isSuper) {
        await addSuperAdminEmail(provEmail.trim().toLowerCase());
      }

      setIsProvisionModalOpen(false);
      setProvName('');
      setProvEmail('');
      setProvTitle('');
      setProvPhone('');
      setFeedbackMessage({ message: `تمت إضافة الموظف ${provName} بنجاح`, isError: false });
    } catch (err: any) {
      setProvError(err?.message || 'فشلت إضافة الموظف');
    } finally {
      setIsProvisioning(false);
      setTimeout(() => setFeedbackMessage(null), 5000);
    }
  };

  // Delete Member
  const handleConfirmDelete = async () => {
    if (!deletingMember) return;
    try {
      await removeMember(deletingMember.id);
      if (deletingMember.userEmail) {
        await removeSuperAdminEmail(deletingMember.userEmail).catch(() => {});
      }
      setFeedbackMessage({ message: `تم حذف حساب ${deletingMember.userName} نهائياً`, isError: false });
    } catch (err: any) {
      setFeedbackMessage({ message: err?.message || 'تعذر حذف الحساب', isError: true });
    } finally {
      setDeletingMember(null);
      setTimeout(() => setFeedbackMessage(null), 4000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Title */}
      <div className="text-center">
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">المستخدمون والموظفين</h1>
        <p className="text-sm font-semibold text-slate-500 mt-1">المستخدمون والموظفين</p>
      </div>

      {/* 5 KPI Metric Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs text-center flex flex-col items-center justify-center">
          <span className="text-xs font-semibold text-slate-500 block mb-1">Total Users</span>
          <span className="text-3xl font-black font-mono text-slate-900">{totalUsersCount}</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs text-center flex flex-col items-center justify-center">
          <span className="text-xs font-semibold text-slate-500 block mb-1">Active Accounts</span>
          <span className="text-3xl font-black font-mono text-emerald-600">{activeUsersCount}</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs text-center flex flex-col items-center justify-center">
          <span className="text-xs font-semibold text-slate-500 block mb-1">Disabled Accounts</span>
          <span className="text-3xl font-black font-mono text-rose-600">{disabledUsersCount}</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs text-center flex flex-col items-center justify-center">
          <span className="text-xs font-semibold text-slate-500 block mb-1">Company Managers</span>
          <span className="text-3xl font-black font-mono text-blue-600">{companyManagersCount}</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs text-center flex flex-col items-center justify-center">
          <span className="text-xs font-semibold text-slate-500 block mb-1">Employees</span>
          <span className="text-3xl font-black font-mono text-slate-800">{employeesCount}</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
        {/* Search Input on Right (in RTL) */}
        <div className="flex items-center gap-2 flex-1 min-w-[260px] bg-slate-50 border border-slate-200/80 rounded-xl px-3 py-2">
          <Search className="h-4 w-4 text-slate-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث بالاسم، البريد، المسمى الوظيفي..."
            className="w-full text-xs bg-transparent outline-hidden text-slate-800 font-medium"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Dropdown Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Company Filter */}
          <select
            value={selectedOrgFilter}
            onChange={(e) => setSelectedOrgFilter(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 font-bold outline-hidden cursor-pointer"
          >
            <option value="all">شركة</option>
            {displayOrgs.map(org => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>

          {/* Role Filter */}
          <select
            value={selectedRoleFilter}
            onChange={(e) => setSelectedRoleFilter(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 font-bold outline-hidden cursor-pointer"
          >
            <option value="all">الدور</option>
            <option value="super_admin">👑 مشرف عام (Super Admin)</option>
            <option value="org_admin">مدير شركة (Admin)</option>
            <option value="finance">مسؤول مالي (Finance)</option>
            <option value="employee">موظف (Employee)</option>
            <option value="data_entry">مدخل بيانات (Data Entry)</option>
          </select>

          {/* All Roles & Ranks Dropdown */}
          <select
            value={selectedRankFilter}
            onChange={(e) => setSelectedRankFilter(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 font-bold outline-hidden cursor-pointer"
          >
            <option value="all">كل الرتب والأدوار</option>
            <option value="admin_only">المدراء فقط</option>
            <option value="employee_only">الموظفون فقط</option>
          </select>

          {/* Reset Filters Button */}
          <button
            type="button"
            onClick={handleResetFilters}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>إعادة ضبط الفلاتر</span>
          </button>

          {/* Add User Action */}
          <button
            type="button"
            onClick={() => setIsProvisionModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>+ مستخدم جديد</span>
          </button>
        </div>
      </div>

      {/* Global Feedback Message */}
      {feedbackMessage && (
        <div className={`p-3.5 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 animate-in fade-in duration-150 ${
          feedbackMessage.isError ? 'bg-rose-50 border border-rose-200 text-rose-800' : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
        }`}>
          <span>{feedbackMessage.message}</span>
          <button onClick={() => setFeedbackMessage(null)} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Users & Employees Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-bold">
                <th className="py-3.5 px-4">المستخدم</th>
                <th className="py-3.5 px-4">الشركة التابعة</th>
                <th className="py-3.5 px-4">المسمى والقسم</th>
                <th className="py-3.5 px-4">الدور</th>
                <th className="py-3.5 px-4">الحالة</th>
                <th className="py-3.5 px-4 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredMembers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <Users className="h-10 w-10 mx-auto text-slate-300 mb-2 stroke-[1.5]" />
                    <p className="font-semibold text-sm">لا يوجد مستخدمون يطابقون خيارات البحث والفلاتر</p>
                  </td>
                </tr>
              ) : (
                filteredMembers.map((mem) => {
                  const org = displayOrgs.find(o => o.id === mem.orgId);
                  const isThisSuperAdmin = superAdminEmails.some(e => e.toLowerCase().trim() === mem.userEmail?.toLowerCase().trim()) || mem.role === 'super_admin';
                  const isResetting = resettingPasswordEmail === mem.userEmail;

                  return (
                    <tr key={mem.id} className="hover:bg-slate-50/70 transition">
                      {/* 1. User Column */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-slate-100 border border-slate-200 text-indigo-700 font-bold flex items-center justify-center text-sm shrink-0">
                            {mem.userName ? mem.userName.slice(0, 1) : 'م'}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-900 text-sm">{mem.userName}</span>
                              {isThisSuperAdmin && (
                                <span className="bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0.5 rounded-md font-bold flex items-center gap-0.5">
                                  <Crown className="h-2.5 w-2.5" />
                                  مشرف عام
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-400 font-mono block">{mem.userEmail}</span>
                            {mem.phone && (
                              <span className="text-[10px] text-slate-500 font-mono block">{mem.phone}</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 2. Company Column */}
                      <td className="py-3.5 px-4">
                        {org ? (
                          <div>
                            <span className="font-bold text-slate-800 block text-xs">{org.name}</span>
                            <span className="text-[10px] text-slate-400 font-mono uppercase block">{org.code || 'TEGY'}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs">غير محدد</span>
                        )}
                      </td>

                      {/* 3. Job Title & Department */}
                      <td className="py-3.5 px-4">
                        <div>
                          <span className="font-bold text-slate-800 block text-xs">{mem.jobTitle || 'موظف'}</span>
                          <span className="text-[11px] text-slate-400 block">{mem.department || 'الإدارة العامة'}</span>
                        </div>
                      </td>

                      {/* 4. Role Badge */}
                      <td className="py-3.5 px-4">
                        {isThisSuperAdmin ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                            <Crown className="h-3 w-3" />
                            مشرف عام
                          </span>
                        ) : mem.role === 'org_admin' ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200">
                            مدير شركة
                          </span>
                        ) : mem.role === 'finance' ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                            مسؤول مالي
                          </span>
                        ) : mem.role === 'data_entry' ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-teal-50 text-teal-700 border border-teal-200">
                            مدخل بيانات
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
                            موظف
                          </span>
                        )}
                      </td>

                      {/* 5. Status Badge */}
                      <td className="py-3.5 px-4">
                        {mem.active === false ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            معطل
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="h-3 w-3" />
                            نشط
                          </span>
                        )}
                      </td>

                      {/* 6. Action Buttons */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center justify-center gap-2">
                          {/* 1. Edit User Button */}
                          <button
                            type="button"
                            onClick={() => handleStartEdit(mem)}
                            title="تعديل بيانات المستخدم"
                            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition cursor-pointer"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>

                          {/* 2. Reset Password Key Button */}
                          <button
                            type="button"
                            disabled={isResetting || !mem.userEmail}
                            onClick={() => handleResetPassword(mem.userEmail)}
                            title="إرسال رابط تعيين كلمة المرور عبر البريد"
                            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition cursor-pointer disabled:opacity-50"
                          >
                            {isResetting ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
                            ) : (
                              <KeyRound className="h-3.5 w-3.5" />
                            )}
                          </button>

                          {/* 3. Delete User Button */}
                          <button
                            type="button"
                            onClick={() => setDeletingMember(mem)}
                            title="حذف المستخدم نهائياً"
                            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>

                          {/* 4. Super Admin Elevation Crown Button */}
                          {currentRole === 'super_admin' && (
                            <button
                              type="button"
                              onClick={() => handleToggleSuperAdmin(mem.userEmail)}
                              title={isThisSuperAdmin ? "سحب صلاحيات السوبر أدمن" : "ترقية لسوبر أدمن 👑"}
                              className={`p-1.5 rounded-lg border transition cursor-pointer ${
                                isThisSuperAdmin 
                                  ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200' 
                                  : 'bg-white text-slate-400 border-slate-200 hover:text-amber-600 hover:bg-amber-50'
                              }`}
                            >
                              <Crown className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Member Modal */}
      {isEditModalOpen && editingMember && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Edit3 className="h-5 w-5 text-indigo-600" />
                <span>تعديل بيانات المستخدم: {editingMember.userName}</span>
              </h3>
              <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">الاسم الكامل</label>
                <input
                  type="text"
                  value={editMemberName}
                  onChange={(e) => setEditMemberName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-800"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">البريد الإلكتروني (ثابت)</label>
                <input
                  type="text"
                  disabled
                  value={editingMember.userEmail}
                  className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 font-mono text-slate-500 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">الدور الوظيفي والصلاحيات</label>
                <select
                  value={editMemberRole}
                  onChange={(e) => setEditMemberRole(e.target.value as any)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800"
                >
                  {currentRole === 'super_admin' && (
                    <option value="super_admin">👑 مشرف عام على المنصة (Super Admin)</option>
                  )}
                  <option value="org_admin">مدير مؤسسة (Company Admin)</option>
                  <option value="finance">مسؤول الصرف والخزينة (Finance)</option>
                  <option value="employee">موظف (Employee)</option>
                  <option value="data_entry">مدخل بيانات (Data Entry)</option>
                </select>
              </div>

              {currentRole === 'super_admin' && (
                <div>
                  <label className="font-bold text-slate-700 block mb-1">الشركة التابع لها</label>
                  <select
                    value={editMemberOrgId}
                    onChange={(e) => setEditMemberOrgId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-800"
                  >
                    {displayOrgs.map(org => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">القسم</label>
                  <input
                    type="text"
                    value={editMemberDept}
                    onChange={(e) => setEditMemberDept(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-800"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">المسمى الوظيفي</label>
                  <input
                    type="text"
                    value={editMemberTitle}
                    onChange={(e) => setEditMemberTitle(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-800"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">رقم الهاتف</label>
                  <input
                    type="text"
                    value={editMemberPhone}
                    onChange={(e) => setEditMemberPhone(sanitizePhone(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono text-slate-800"
                    placeholder="01011112222"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">حالة الحساب</label>
                  <select
                    value={editMemberStatus}
                    onChange={(e) => setEditMemberStatus(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800"
                  >
                    <option value="active">نشط</option>
                    <option value="inactive">معطل</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs"
              >
                حفظ التعديلات
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Provision New User Modal */}
      {isProvisionModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Plus className="h-5 w-5 text-emerald-600" />
                <span>إضافة مستخدم جديد للنظام</span>
              </h3>
              <button onClick={() => setIsProvisionModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="h-5 w-5" />
              </button>
            </div>

            {provError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-semibold">
                {provError}
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">اسم الموظف بالكامل *</label>
                <input
                  type="text"
                  required
                  value={provName}
                  onChange={(e) => setProvName(e.target.value)}
                  placeholder="مثال: أحمد عبد الله"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-800"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">البريد الإلكتروني للعمل *</label>
                <input
                  type="email"
                  required
                  value={provEmail}
                  onChange={(e) => setProvEmail(e.target.value)}
                  placeholder="employee@company.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">الدور الوظيفي</label>
                  <select
                    value={provRole}
                    onChange={(e) => setProvRole(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800"
                  >
                    {currentRole === 'super_admin' && (
                      <option value="super_admin">👑 مشرف عام (Super Admin)</option>
                    )}
                    <option value="employee">موظف (Employee)</option>
                    <option value="finance">مسؤول مالي (Finance)</option>
                    <option value="org_admin">مدير مؤسسة (Admin)</option>
                    <option value="data_entry">مدخل بيانات</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">الشركة التابعة *</label>
                  <select
                    value={provOrgId || activeOrgId}
                    onChange={(e) => setProvOrgId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-800"
                  >
                    {displayOrgs.map(org => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">القسم</label>
                  <input
                    type="text"
                    value={provDept}
                    onChange={(e) => setProvDept(e.target.value)}
                    placeholder="الإدارة العامة"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-800"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">المسمى الوظيفي</label>
                  <input
                    type="text"
                    value={provTitle}
                    onChange={(e) => setProvTitle(e.target.value)}
                    placeholder="أخصائي عمليات"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">رقم الهاتف (اختياري)</label>
                <input
                  type="text"
                  value={provPhone}
                  onChange={(e) => setProvPhone(sanitizePhone(e.target.value))}
                  placeholder="01012345678"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono text-slate-800"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsProvisionModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isProvisioning}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isProvisioning ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>جاري الإضافة...</span>
                    </>
                  ) : (
                    <span>+ إضافة المستخدم</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingMember && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 text-center space-y-4">
            <div className="h-12 w-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto border border-rose-200">
              <Trash2 className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">حذف المستخدم نهائياً</h3>
              <p className="text-xs text-slate-500 mt-1">
                هل أنت متأكد من حذف حساب <strong>{deletingMember.userName}</strong> ({deletingMember.userEmail})؟ لن يتمكن من تسجيل الدخول للنظام بعد ذلك.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingMember(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                تراجع
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                تأكيد الحذف
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
