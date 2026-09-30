import React, { useState, useMemo, useRef, useEffect } from 'react';
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
  Plus,
  Loader2,
  AlertTriangle,
  Lock
} from 'lucide-react';
import { OrganizationMember, Role } from '../types';
import { isValidEmail, sanitizePhone } from '../utils/validation';
import { normalizeEmail, type Actor } from '../domain/common';
// The platform owner is the ONLY super admin (same list as AppContext and the rules). Nobody else can be promoted here.
import { isPlatformOwnerEmail as isPlatformOwner, membershipProtection } from '../domain/directory';
import { useSubmitGuard, useKeyedSubmitGuard } from '../hooks/useSubmitGuard';
import { can } from '../utils/permissions';
import { OrgMultiSelect } from './OrgMultiSelect';

/** Roles that can be assigned here. Platform super admin is never grantable from the UI. */
type AssignableRole = Exclude<Role, 'super_admin'>;
/** Edit-form role: an assignable role, or keep a leftover legacy super-admin grant untouched. */
type EditRoleChoice = AssignableRole | 'keep_super_admin';

const ALREADY_MEMBER_REASON = 'مسجل بالفعل';

const ROLE_LABELS: Record<AssignableRole, string> = {
  org_admin: 'مدير مؤسسة',
  finance: 'مسؤول الصرف والخزينة',
  employee: 'موظف',
  data_entry: 'مدخل بيانات',
};

/** email -> the companies where that email already has a membership. */
type MembershipIndex = Map<string, Set<string>>;

/** Companies the email cannot be added to again (already a member), with the reason shown on the chip. */
const unavailableOrgsFor = (index: MembershipIndex, email: string): Record<string, string> => {
  const out: Record<string, string> = {};
  index.get(normalizeEmail(email))?.forEach(orgId => { out[orgId] = ALREADY_MEMBER_REASON; });
  return out;
};

/** The membership's own role, never 'super_admin' (platform access is not a membership role). */
const membershipRoleOf = (member: OrganizationMember, isSuper: boolean): AssignableRole =>
  member.role === 'super_admin' ? (isSuper ? 'org_admin' : 'employee') : member.role;

export const UsersManagement: React.FC = () => {
  const {
    allMembers,
    members,
    allOrganizations,
    organizations,
    superAdminEmails,
    removeSuperAdminEmail,
    addMemberToOrgs,
    updateMember,
    removeMember,
    adminResetUserPassword,
    activeOrgId,
    currentRole,
    currentUser,
  } = useApp();

  // What this role may do here (src/utils/permissions.ts mirrors the domain and the rules).
  const canViewUsers = can(currentRole, 'viewUsers');
  const canManageUsers = can(currentRole, 'manageUsers');

  // Policy (same check as the domain, membershipProtection): a company admin never deletes,
  // suspends or re-roles the platform owner's membership nor their own. Those rows keep
  // contact edits only.
  const myEmail = normalizeEmail(currentUser.email);
  const viewer: Actor = { id: currentUser.id, name: currentUser.name, email: currentUser.email, role: currentRole };
  const isProtectedMembership = (m: OrganizationMember) => membershipProtection(viewer, m) !== null;
  const protectedReason = (m: OrganizationMember) =>
    membershipProtection(viewer, m) === 'self'
      ? 'هذا حسابك: لا يمكنك حذفه أو تعطيله أو تغيير دورك بنفسك.'
      : 'حساب مالك المنصة محمي: لا يمكن حذفه أو تعطيله أو تغيير دوره.';

  // Search and Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrgFilter, setSelectedOrgFilter] = useState('all');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState('all');
  const [selectedRankFilter, setSelectedRankFilter] = useState('all');

  // Modal States
  const [editingMember, setEditingMember] = useState<OrganizationMember | null>(null);
  const [editMemberName, setEditMemberName] = useState('');
  const [editMemberRole, setEditMemberRole] = useState<EditRoleChoice>('employee');
  const [editMemberDept, setEditMemberDept] = useState('');
  const [editMemberTitle, setEditMemberTitle] = useState('');
  const [editMemberPhone, setEditMemberPhone] = useState('');
  const [editMemberOrgId, setEditMemberOrgId] = useState('');
  const [editMemberStatus, setEditMemberStatus] = useState<'active' | 'inactive'>('active');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editError, setEditError] = useState('');
  const editGuard = useSubmitGuard();
  const isSavingEdit = editGuard.pending;

  // Provision Modal States
  const [isProvisionModalOpen, setIsProvisionModalOpen] = useState(false);
  const [provName, setProvName] = useState('');
  const [provEmail, setProvEmail] = useState('');
  const [provRole, setProvRole] = useState<AssignableRole>('employee');
  const [provOrgIds, setProvOrgIds] = useState<string[]>([]);
  const [provDept, setProvDept] = useState('الإدارة العامة');
  const [provTitle, setProvTitle] = useState('');
  const [provPhone, setProvPhone] = useState('');
  const [provError, setProvError] = useState('');
  const provisionGuard = useSubmitGuard();
  const isProvisioning = provisionGuard.pending;

  // Deletion Confirmation
  const [deletingMember, setDeletingMember] = useState<OrganizationMember | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const memberActions = useKeyedSubmitGuard();

  const openDeleteDialog = (member: OrganizationMember) => {
    if (!canManageUsers || isProtectedMembership(member)) return;
    setDeleteError('');
    setDeletingMember(member);
  };

  // Reset Password State
  const [resettingPasswordEmail, setResettingPasswordEmail] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{ message: string; isError: boolean } | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (feedbackTimer.current) clearTimeout(feedbackTimer.current); }, []);
  /** Shows a banner message; a newer message is never cleared early by an older message's timer. */
  const showFeedback = (message: string, isError = false, ms = 5000) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedbackMessage({ message, isError });
    feedbackTimer.current = setTimeout(() => setFeedbackMessage(null), ms);
  };

  const canManageSuperAdmins = currentRole === 'super_admin';
  const displayMembers = currentRole === 'super_admin' ? allMembers : members;
  const displayOrgs = currentRole === 'super_admin' ? allOrganizations : organizations;
  // A new user can only join companies that are still active (an archived one refuses the whole operation).
  const provisionOrgs = useMemo(
    () => displayOrgs.filter(o => !o.archived && o.status !== 'archived'),
    [displayOrgs]
  );

  const superAdminSet = useMemo(() => new Set(superAdminEmails.map(e => normalizeEmail(e))), [superAdminEmails]);
  const isSuperAdminEmail = (email?: string | null) => Boolean(email) && superAdminSet.has(normalizeEmail(email));

  // Every known membership, by email (case-insensitive): drives "مسجل بالفعل" in the company pickers.
  const membershipIndex = useMemo<MembershipIndex>(() => {
    const index: MembershipIndex = new Map();
    for (const m of [...allMembers, ...members]) {
      const email = normalizeEmail(m.userEmail);
      if (!email || !m.orgId) continue;
      if (!index.has(email)) index.set(email, new Set());
      index.get(email)!.add(m.orgId);
    }
    return index;
  }, [allMembers, members]);

  const orgNameOf = (orgId: string) =>
    displayOrgs.find(o => o.id === orgId)?.name || allOrganizations.find(o => o.id === orgId)?.name || orgId;

  // Add-user company selection: companies where the typed email is already a member are never selectable.
  const provUnavailable = useMemo(() => unavailableOrgsFor(membershipIndex, provEmail), [membershipIndex, provEmail]);
  const provSelectedOrgIds = useMemo(
    () => provOrgIds.filter(id => !provUnavailable[id] && provisionOrgs.some(o => o.id === id)),
    [provOrgIds, provUnavailable, provisionOrgs]
  );

  /** Default companies for a new user: the active company, else the only one, else none. */
  const defaultProvisionOrgIds = (): string[] => {
    if (activeOrgId && activeOrgId !== 'all' && provisionOrgs.some(o => o.id === activeOrgId)) return [activeOrgId];
    if (provisionOrgs.length === 1) return [provisionOrgs[0].id];
    return [];
  };

  const openProvisionModal = () => {
    if (!canManageUsers) return;
    provisionGuard.rotateKey();
    setProvError('');
    setProvOrgIds(defaultProvisionOrgIds().filter(id => !provUnavailable[id]));
    setIsProvisionModalOpen(true);
  };

  const handleProvEmailChange = (value: string) => {
    setProvEmail(value);
    // Live: a company where this email is already registered drops out of the selection.
    const blocked = unavailableOrgsFor(membershipIndex, value);
    setProvOrgIds(prev => prev.filter(id => !blocked[id]));
  };

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
        const isSuperAdmin = superAdminSet.has(normalizeEmail(mem.userEmail));
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
  }, [displayMembers, searchQuery, selectedOrgFilter, selectedRoleFilter, selectedRankFilter, superAdminSet]);

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
      showFeedback(res.message || 'تم إرسال رابط إعادة تعيين كلمة المرور', !res.success, 6000);
    } catch (err: any) {
      showFeedback(err?.message || 'تعذر إرسال رابط التعيين', true, 6000);
    } finally {
      setResettingPasswordEmail(null);
    }
  };

  // Super admin can only be REMOVED here (from a leftover legacy grant). The platform owner is the
  // only super admin: nobody can be promoted, and the owner can never be demoted.
  const handleDemoteSuperAdmin = async (email: string) => {
    if (!email || !canManageSuperAdmins || isPlatformOwner(email) || !isSuperAdminEmail(email)) return;
    if (normalizeEmail(email) === myEmail) return; // never one's own access
    await memberActions.run(`superadmin:${normalizeEmail(email)}`, async () => {
      if (!confirm(`هل أنت متأكد من سحب صلاحيات المشرف العام من ${email}؟\nلا يمكن منحها مرة أخرى: مالك المنصة هو المشرف العام الوحيد.`)) return;
      try {
        await removeSuperAdminEmail(email);
        showFeedback(`تم سحب صلاحيات المشرف العام من ${email}`);
      } catch (err: any) {
        showFeedback(err?.message || 'فشلت عملية سحب الصلاحية', true);
      }
    });
  };

  // Open Edit Modal
  const handleStartEdit = (member: OrganizationMember) => {
    if (!canManageUsers) return;
    setEditError('');
    setEditingMember(member);
    setEditMemberName(member.userName || '');
    // Only a real grant counts; a stale member role of 'super_admin' is shown as employee so
    // saving the form can never silently re-grant platform-wide access. A leftover legacy grant
    // (not the owner) starts as "keep as is"; picking another role removes it.
    const isSuper = isSuperAdminEmail(member.userEmail);
    const legacySuper = isSuper && !isPlatformOwner(member.userEmail);
    setEditMemberRole(legacySuper ? 'keep_super_admin' : membershipRoleOf(member, isSuper));
    setEditMemberDept(member.department || 'الإدارة العامة');
    setEditMemberTitle(member.jobTitle || '');
    setEditMemberPhone(member.phone || '');
    setEditMemberOrgId(member.orgId || '');
    setEditMemberStatus(member.active === false ? 'inactive' : 'active');
    setIsEditModalOpen(true);
  };

  // Save Edit
  const handleSaveEdit = async () => {
    if (!editingMember || !canManageUsers) return;
    const name = editMemberName.trim();
    if (!name) {
      setEditError('يرجى إدخال اسم المستخدم؛ لا يمكن حفظ اسم فارغ.');
      return;
    }
    setEditError('');
    const target = editingMember;
    // Own / platform-owner membership: contact details only, role / company / status are never sent.
    const locked = isProtectedMembership(target);
    await editGuard.run(async () => {
    try {
    const email = target.userEmail;
    const isCurrentlySuper = isSuperAdminEmail(email);

    // Super admin is never granted here. The only change allowed is removing a leftover legacy
    // grant (not the owner, who is always a locked row): picking a regular role demotes them.
    const demoteLegacySuper = !locked && canManageSuperAdmins && isCurrentlySuper && editMemberRole !== 'keep_super_admin';
    if (demoteLegacySuper && email) {
      await removeSuperAdminEmail(email);
    }

    const updates: Partial<OrganizationMember> = {
      userName: name,
      department: editMemberDept.trim(),
      jobTitle: editMemberTitle.trim(),
      phone: editMemberPhone.trim(),
    };
    if (!locked) {
      // The membership keeps a regular role; 'super_admin' is never written to a membership.
      const targetRole: AssignableRole =
        editMemberRole === 'keep_super_admin' ? membershipRoleOf(target, isCurrentlySuper) : editMemberRole;
      const active = editMemberStatus === 'active';
      // Only what actually changed is sent.
      if (targetRole !== target.role) updates.role = targetRole;
      if (active !== (target.active !== false)) updates.active = active;
      if (editMemberOrgId && editMemberOrgId !== target.orgId) updates.orgId = editMemberOrgId;
    }
    await updateMember(target.id, updates);

    setIsEditModalOpen(false);
    setEditingMember(null);
    showFeedback(
      demoteLegacySuper
        ? `تم حفظ تعديلات المستخدم ${name} وسحب صلاحيات المشرف العام منه`
        : `تم حفظ تعديلات المستخدم ${name} بنجاح`,
      false,
      4000
    );
    } catch (err: any) {
      setEditError(err?.message || 'تعذر حفظ التعديلات');
    }
    });
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
    const email = normalizeEmail(provEmail);
    const orgIds = provSelectedOrgIds;
    if (orgIds.length === 0) {
      const registeredEverywhere = provisionOrgs.length > 0 && provisionOrgs.every(o => provUnavailable[o.id]);
      setProvError(
        registeredEverywhere
          ? `هذا البريد الإلكتروني (${email}) مسجل بالفعل في كل الشركات المتاحة لك.`
          : 'يرجى اختيار شركة واحدة على الأقل ليُضاف إليها المستخدم.'
      );
      return;
    }

    const name = provName.trim();
    await provisionGuard.run(async (idempotencyKey) => {
    try {
      // One membership per selected company, all in one transaction. Companies where this
      // email is already registered are skipped (and reported), never failing the others.
      const result = await addMemberToOrgs({
        userId: '',
        userName: name,
        userEmail: email,
        role: provRole,
        department: provDept.trim() || 'الإدارة العامة',
        jobTitle: provTitle.trim() || 'موظف',
        phone: provPhone.trim(),
        active: true,
      }, orgIds, { idempotencyKey });

      provisionGuard.rotateKey();
      setIsProvisionModalOpen(false);
      setProvName('');
      setProvEmail('');
      setProvTitle('');
      setProvPhone('');
      setProvOrgIds([]);

      const added = result.addedOrgIds.map(orgNameOf);
      const skipped = result.skipped.map(s => {
        const why = s.reason === 'already_member' ? ALREADY_MEMBER_REASON : 'مكرر';
        return `${orgNameOf(s.orgId)} (${why}${s.existingName ? ` باسم "${s.existingName}"` : ''})`;
      });
      let message = added.length > 0
        ? `تمت إضافة الموظف ${name} إلى: ${added.join('، ')}.`
        : `الموظف ${name} مضاف بالفعل إلى الشركات المختارة.`;
      if (skipped.length > 0) message += ` لم تتم إضافته إلى: ${skipped.join('، ')}.`;
      showFeedback(message, false, skipped.length > 0 ? 9000 : 5000);
    } catch (err: any) {
      setProvError(err?.message || 'فشلت إضافة الموظف');
    }
    });
  };

  // Other companies the member being deleted still belongs to (same email).
  const deletingOtherOrgIds = useMemo(() => {
    if (!deletingMember) return [];
    const email = normalizeEmail(deletingMember.userEmail);
    if (!email) return [];
    return Array.from(membershipIndex.get(email) || []).filter(orgId => orgId !== deletingMember.orgId);
  }, [deletingMember, membershipIndex]);

  // Edit modal: the owner's role is fixed; a leftover legacy grant can only be kept or removed.
  const editingIsOwner = Boolean(editingMember) && isPlatformOwner(editingMember?.userEmail);
  // Own / owner membership: role, company and status are shown read-only and never sent.
  const editingIsLocked = Boolean(editingMember) && isProtectedMembership(editingMember!);
  const editingIsLegacySuper = Boolean(editingMember) && !editingIsOwner && isSuperAdminEmail(editingMember?.userEmail);
  // Companies where the edited person already has a membership (the edit stays single-company).
  const editTakenOrgIds = useMemo(
    () => new Set<string>(editingMember ? membershipIndex.get(normalizeEmail(editingMember.userEmail)) || [] : []),
    [editingMember, membershipIndex]
  );

  // Delete Member (one company's membership)
  const handleConfirmDelete = async () => {
    if (!deletingMember || !canManageUsers || isProtectedMembership(deletingMember)) return;
    const stillMemberElsewhere = deletingOtherOrgIds.length > 0;
    setDeleteError('');
    await memberActions.run(`delete:${deletingMember.id}`, async () => {
    try {
      await removeMember(deletingMember.id);
      // Removing the person's LAST membership also removes a leftover legacy super-admin grant.
      // Never the owner, and never when they still belong to another company.
      const email = deletingMember.userEmail;
      if (canManageSuperAdmins && email && !stillMemberElsewhere && isSuperAdminEmail(email) && !isPlatformOwner(email)) {
        await removeSuperAdminEmail(email).catch(err => console.warn('[Users] super admin grant not removed:', err?.message || err));
      }
      setDeletingMember(null);
      showFeedback(
        stillMemberElsewhere
          ? `تم حذف ${deletingMember.userName} من ${orgNameOf(deletingMember.orgId)}`
          : `تم حذف حساب ${deletingMember.userName} نهائياً`,
        false,
        4000
      );
    } catch (err: any) {
      setDeleteError(err?.message || 'تعذر حذف الحساب');
    }
    });
  };

  // The users screen belongs to company admins (TAB_ACCESS); any other role only gets a notice.
  if (!canViewUsers) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-xs">
        <Lock className="h-10 w-10 text-slate-300 mx-auto mb-2" />
        <h2 className="font-bold text-slate-800 text-sm">إدارة المستخدمين متاحة لمدير الشركة فقط</h2>
        <p className="text-xs text-slate-500 mt-1">يمكنك تعديل اسمك ورقم هاتفك وبيانات حسابك من صفحة "بياناتي وحساباتي البنكية".</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header Title */}
      <div className="text-center">
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">المستخدمون والموظفون</h1>
        <p className="text-sm font-semibold text-slate-500 mt-1">حسابات المستخدمين وأدوارهم في الشركات</p>
      </div>

      {/* 5 KPI Metric Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs text-center flex flex-col items-center justify-center">
          <span className="text-xs font-semibold text-slate-500 block mb-1">إجمالي المستخدمين</span>
          <span className="text-3xl font-black font-mono text-slate-900">{totalUsersCount}</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs text-center flex flex-col items-center justify-center">
          <span className="text-xs font-semibold text-slate-500 block mb-1">الحسابات النشطة</span>
          <span className="text-3xl font-black font-mono text-emerald-600">{activeUsersCount}</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs text-center flex flex-col items-center justify-center">
          <span className="text-xs font-semibold text-slate-500 block mb-1">الحسابات المعطلة</span>
          <span className="text-3xl font-black font-mono text-rose-600">{disabledUsersCount}</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs text-center flex flex-col items-center justify-center">
          <span className="text-xs font-semibold text-slate-500 block mb-1">مدراء الشركات</span>
          <span className="text-3xl font-black font-mono text-blue-600">{companyManagersCount}</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs text-center flex flex-col items-center justify-center">
          <span className="text-xs font-semibold text-slate-500 block mb-1">الموظفون</span>
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

          {/* Add User Action (company admins only) */}
          {canManageUsers && (
            <button
              type="button"
              onClick={openProvisionModal}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>+ مستخدم جديد</span>
            </button>
          )}
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
                    {displayMembers.length === 0 ? (
                      <p className="font-semibold text-sm">لا يوجد مستخدمون مسجلون في هذه الشركة بعد</p>
                    ) : (
                      <>
                        <p className="font-semibold text-sm">
                          {searchQuery.trim()
                            ? `لا توجد نتائج مطابقة للبحث "${searchQuery.trim()}"`
                            : 'لا يوجد مستخدمون يطابقون الفلاتر المختارة'}
                        </p>
                        <button
                          type="button"
                          onClick={handleResetFilters}
                          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          <span>إعادة ضبط البحث والفلاتر</span>
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ) : (
                filteredMembers.map((mem) => {
                  const org = displayOrgs.find(o => o.id === mem.orgId);
                  const isThisSuperAdmin = isSuperAdminEmail(mem.userEmail);
                  const isThisOwner = isPlatformOwner(mem.userEmail);
                  const isResetting = resettingPasswordEmail === mem.userEmail;
                  const isProtectedRow = isProtectedMembership(mem);

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
                                  {isThisOwner ? 'مالك المنصة' : 'مشرف عام'}
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
                          {!canManageUsers && <span className="text-[11px] text-slate-400">—</span>}

                          {/* 1. Edit User Button (a protected row keeps contact edits only) */}
                          {canManageUsers && (
                            <button
                              type="button"
                              onClick={() => handleStartEdit(mem)}
                              title={isProtectedRow ? 'تعديل الاسم وبيانات التواصل فقط' : 'تعديل بيانات المستخدم'}
                              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition cursor-pointer"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                          )}

                          {/* 2. Reset Password Key Button */}
                          {canManageUsers && (
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
                          )}

                          {/* 3. Delete User Button — never on one's own or the platform owner's membership */}
                          {canManageUsers && !isProtectedRow && (
                            <button
                              type="button"
                              onClick={() => openDeleteDialog(mem)}
                              title="حذف المستخدم نهائياً"
                              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canManageUsers && isProtectedRow && (
                            <span
                              title={protectedReason(mem)}
                              className="p-1.5 rounded-lg border border-slate-100 bg-slate-50 text-slate-400"
                            >
                              <Lock className="h-3.5 w-3.5" />
                            </span>
                          )}

                          {/* 4. Remove a leftover legacy super-admin grant (never promote; never the owner or oneself) */}
                          {canManageSuperAdmins && isThisSuperAdmin && !isThisOwner && normalizeEmail(mem.userEmail) !== myEmail && (
                            <button
                              type="button"
                              onClick={() => handleDemoteSuperAdmin(mem.userEmail)}
                              disabled={memberActions.isPending(`superadmin:${normalizeEmail(mem.userEmail)}`)}
                              title="سحب صلاحيات المشرف العام (مالك المنصة هو المشرف العام الوحيد)"
                              className="p-1.5 rounded-lg border transition cursor-pointer bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200 disabled:opacity-50"
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
          <div className="bg-white rounded-3xl max-w-md w-full max-h-[92vh] overflow-y-auto p-6 shadow-2xl border border-slate-200 space-y-4">
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
              {editError && (
                <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-semibold flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{editError}</span>
                </div>
              )}
              {editingIsLocked && (
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600 font-semibold flex items-start gap-1.5">
                  <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" />
                  <span>{protectedReason(editingMember)} يمكن تعديل الاسم والقسم والمسمى والهاتف فقط.</span>
                </div>
              )}
              <div>
                <label className="font-bold text-slate-700 block mb-1">الاسم الكامل *</label>
                <input
                  type="text"
                  required
                  value={editMemberName}
                  onChange={(e) => { setEditMemberName(e.target.value); if (editError) setEditError(''); }}
                  className={`w-full bg-slate-50 border rounded-xl px-3 py-2 font-medium text-slate-800 ${
                    editError && !editMemberName.trim() ? 'border-rose-400' : 'border-slate-200'
                  }`}
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
                {editingIsOwner ? (
                  <div className="w-full bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 font-bold text-amber-800 flex items-center gap-1.5">
                    <Crown className="h-3.5 w-3.5 shrink-0" />
                    <span>👑 مشرف عام (مالك المنصة)</span>
                  </div>
                ) : editingIsLocked ? (
                  <div className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-600 flex items-center gap-1.5">
                    <Lock className="h-3.5 w-3.5 shrink-0" />
                    <span>{ROLE_LABELS[membershipRoleOf(editingMember, isSuperAdminEmail(editingMember.userEmail))]} (لا يمكن تغيير دورك بنفسك)</span>
                  </div>
                ) : editingIsLegacySuper && !canManageSuperAdmins ? (
                  <div className="w-full bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 font-bold text-amber-800 flex items-center gap-1.5">
                    <Crown className="h-3.5 w-3.5 shrink-0" />
                    <span>👑 مشرف عام (لا يمكن تغيير دوره من هنا)</span>
                  </div>
                ) : (
                  <select
                    value={editMemberRole}
                    onChange={(e) => setEditMemberRole(e.target.value as EditRoleChoice)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800"
                  >
                    {editingIsLegacySuper && (
                      <option value="keep_super_admin">👑 مشرف عام حالياً (صلاحية قديمة، بدون تغيير)</option>
                    )}
                    <option value="org_admin">مدير مؤسسة (Company Admin)</option>
                    <option value="finance">مسؤول الصرف والخزينة (Finance)</option>
                    <option value="employee">موظف (Employee)</option>
                    <option value="data_entry">مدخل بيانات (Data Entry)</option>
                  </select>
                )}
                {editingIsLegacySuper && canManageSuperAdmins && (
                  <p className="mt-1 text-[11px] text-amber-700 font-semibold flex items-start gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                    <span>مالك المنصة هو المشرف العام الوحيد. اختيار دور آخر يسحب صلاحية المشرف العام من هذا الحساب ولا يمكن منحها مرة أخرى.</span>
                  </p>
                )}
              </div>

              {currentRole === 'super_admin' && !editingIsLocked && (
                <div>
                  <label className="font-bold text-slate-700 block mb-1">الشركة التابع لها</label>
                  <select
                    value={editMemberOrgId}
                    onChange={(e) => setEditMemberOrgId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-800"
                  >
                    {displayOrgs.map(org => {
                      // One membership per company: a company where this email is already
                      // registered (another membership) cannot be chosen.
                      const taken = org.id !== editingMember.orgId && editTakenOrgIds.has(org.id);
                      return (
                        <option key={org.id} value={org.id} disabled={taken}>
                          {org.name}{taken ? ` (${ALREADY_MEMBER_REASON})` : ''}
                        </option>
                      );
                    })}
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
                  {editingIsLocked ? (
                    <div className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-600 flex items-center gap-1.5">
                      <Lock className="h-3 w-3 shrink-0" />
                      <span>{editMemberStatus === 'active' ? 'نشط' : 'معطل'}</span>
                    </div>
                  ) : (
                    <select
                      value={editMemberStatus}
                      onChange={(e) => setEditMemberStatus(e.target.value as 'active' | 'inactive')}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800"
                    >
                      <option value="active">نشط</option>
                      <option value="inactive">معطل</option>
                    </select>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                disabled={isSavingEdit}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={isSavingEdit}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 disabled:opacity-60"
              >
                {isSavingEdit && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{isSavingEdit ? 'جاري الحفظ...' : 'حفظ التعديلات'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Provision New User Modal */}
      {isProvisionModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full max-h-[92vh] overflow-y-auto p-6 shadow-2xl border border-slate-200 space-y-4">
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
                  onChange={(e) => handleProvEmailChange(e.target.value)}
                  placeholder="employee@company.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono text-slate-800"
                />
              </div>

              <OrgMultiSelect
                orgs={provisionOrgs}
                selected={provSelectedOrgIds}
                onChange={setProvOrgIds}
                label="الشركة التابعة (تحديد متعدد) *"
                unavailable={provUnavailable}
                emptyHint={
                  provisionOrgs.length > 0 && provisionOrgs.every(o => provUnavailable[o.id])
                    ? '* هذا البريد مسجل بالفعل في كل الشركات المتاحة.'
                    : '* يرجى تحديد شركة واحدة على الأقل.'
                }
                disabled={isProvisioning}
              />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">الدور الوظيفي</label>
                  <select
                    value={provRole}
                    onChange={(e) => setProvRole(e.target.value as AssignableRole)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800"
                  >
                    <option value="employee">موظف (Employee)</option>
                    <option value="finance">مسؤول مالي (Finance)</option>
                    <option value="org_admin">مدير مؤسسة (Admin)</option>
                    <option value="data_entry">مدخل بيانات</option>
                  </select>
                  {provSelectedOrgIds.length > 1 && (
                    <p className="mt-1 text-[10px] text-slate-500 font-semibold">نفس الدور في كل الشركات المختارة</p>
                  )}
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
                  disabled={isProvisioning || provSelectedOrgIds.length === 0}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isProvisioning ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>جاري الإضافة...</span>
                    </>
                  ) : (
                    <span>
                      {provSelectedOrgIds.length > 1
                        ? `+ إضافة المستخدم إلى ${provSelectedOrgIds.length} شركات`
                        : '+ إضافة المستخدم'}
                    </span>
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
              <h3 className="text-base font-bold text-slate-900">
                {deletingOtherOrgIds.length > 0 ? 'حذف المستخدم من هذه الشركة' : 'حذف المستخدم نهائياً'}
              </h3>
              {deletingOtherOrgIds.length > 0 ? (
                <p className="text-xs text-slate-500 mt-1">
                  هل أنت متأكد من حذف <strong>{deletingMember.userName}</strong> ({deletingMember.userEmail}) من <strong>{orgNameOf(deletingMember.orgId)}</strong>؟ سيظل عضواً في: {deletingOtherOrgIds.map(orgNameOf).join('، ')}.
                </p>
              ) : (
                <p className="text-xs text-slate-500 mt-1">
                  هل أنت متأكد من حذف حساب <strong>{deletingMember.userName}</strong> ({deletingMember.userEmail})؟ لن يتمكن من تسجيل الدخول للنظام بعد ذلك.
                </p>
              )}
            </div>
            {deleteError && (
              <div role="alert" className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-start gap-2 text-right">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{deleteError}</span>
              </div>
            )}
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingMember(null)}
                disabled={memberActions.isPending(`delete:${deletingMember.id}`)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
              >
                تراجع
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={memberActions.isPending(`delete:${deletingMember.id}`)}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-60"
              >
                {memberActions.isPending(`delete:${deletingMember.id}`) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{memberActions.isPending(`delete:${deletingMember.id}`) ? 'جاري الحذف...' : 'تأكيد الحذف'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
