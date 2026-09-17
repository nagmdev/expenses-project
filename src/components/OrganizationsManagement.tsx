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
  Phone, 
  Copy, 
  Crown, 
  CheckCircle2, 
  AlertCircle, 
  Loader2,
  KeyRound,
  Edit,
  Search,
  AlertTriangle,
  Layers,
  Truck,
  Wallet,
  CreditCard,
  Landmark,
  FolderTree,
  History,
  DollarSign
} from 'lucide-react';
import { 
  Role, 
  Organization, 
  OrganizationMember, 
  ServiceCategory, 
  ServiceProvider, 
  PaymentAccount, 
  Department, 
  SUPPORTED_CURRENCIES 
} from '../types';
import { 
  sanitizeDigitsOnly, 
  sanitizePhone, 
  sanitizeCode, 
  sanitizeIBAN,
  sanitizeTaxOrCR,
  handleNumericKeyDown, 
  isValidEmail 
} from '../utils/validation';

export type AdminSection = 
  | 'companies' 
  | 'users' 
  | 'services' 
  | 'vendors' 
  | 'vaults' 
  | 'departments' 
  | 'super_admins' 
  | 'audit_log';

export const OrganizationsManagement: React.FC<{ initialSection?: AdminSection }> = ({ initialSection }) => {
  const { 
    organizations, 
    allOrganizations,
    activeOrgId, 
    setActiveOrgId, 
    activeOrg,
    members, 
    services,
    providers,
    paymentAccounts,
    departments,
    auditLogs,
    addOrganization, 
    updateOrganization,
    deleteOrganization,
    removeMember,
    updateMember,
    toggleMemberStatus,
    adminResetUserPassword,
    createCompanyUser,
    addService,
    updateService,
    deleteService,
    addProvider,
    updateProvider,
    deleteProvider,
    addPaymentAccount,
    updatePaymentAccount,
    deletePaymentAccount,
    togglePaymentAccountStatus,
    addDepartment,
    updateDepartment,
    deleteDepartment,
    superAdminEmails,
    addSuperAdminEmail,
    removeSuperAdminEmail,
    updateSuperAdminRole,
    currentRole,
    requests
  } = useApp();

  const isSuperAdmin = currentRole === 'super_admin';
  const canManageOrgs = isSuperAdmin;
  const displayOrgs = canManageOrgs ? allOrganizations : organizations;

  // Active View Tab
  const [activeSection, setActiveSection] = useState<AdminSection>(
    initialSection || (canManageOrgs ? 'companies' : 'users')
  );

  // =========================================================================
  // 1. COMPANIES STATE & MODALS
  // =========================================================================
  const [isOrgModalOpen, setIsOrgModalOpen] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [orgCode, setOrgCode] = useState('');
  const [orgCurrency, setOrgCurrency] = useState('EGP');
  const [orgBudget, setOrgBudget] = useState('500000');
  const [orgDescription, setOrgDescription] = useState('');
  const [isCreatingOrg, setIsCreatingOrg] = useState(false);
  const [orgFormError, setOrgFormError] = useState<string | null>(null);

  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [editOrgName, setEditOrgName] = useState('');
  const [editOrgCode, setEditOrgCode] = useState('');
  const [editOrgCurrency, setEditOrgCurrency] = useState('EGP');
  const [editOrgBudget, setEditOrgBudget] = useState('');
  const [editOrgDescription, setEditOrgDescription] = useState('');

  const [deletingOrg, setDeletingOrg] = useState<Organization | null>(null);
  const [deleteOrgLoading, setDeleteOrgLoading] = useState(false);
  const [orgSearch, setOrgSearch] = useState('');

  // =========================================================================
  // 2. USERS STATE & MODALS
  // =========================================================================
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

  const [editingMember, setEditingMember] = useState<OrganizationMember | null>(null);
  const [editMemberName, setEditMemberName] = useState('');
  const [editMemberPhone, setEditMemberPhone] = useState('');
  const [editMemberOrgId, setEditMemberOrgId] = useState('');
  const [editMemberRole, setEditMemberRole] = useState<Role>('employee');
  const [editMemberDept, setEditMemberDept] = useState('');
  const [editMemberJob, setEditMemberJob] = useState('');
  const [editMemberActive, setEditMemberActive] = useState(true);
  const [editMemberLoading, setEditMemberLoading] = useState(false);

  const [deletingMember, setDeletingMember] = useState<OrganizationMember | null>(null);
  const [resetFeedback, setResetFeedback] = useState<{ email: string; message: string; isError?: boolean } | null>(null);
  const [resettingPasswordEmail, setResettingPasswordEmail] = useState<string | null>(null);

  const [userSearch, setUserSearch] = useState('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>('all');
  const [selectedOrgFilter, setSelectedOrgFilter] = useState<string>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');

  // =========================================================================
  // 3. SERVICES (EXPENSE ITEMS) STATE & MODALS
  // =========================================================================
  const [isServiceModalOpen, setIsServiceModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<ServiceCategory | null>(null);
  const [serviceName, setServiceName] = useState('');
  const [serviceCode, setServiceCode] = useState('');
  const [serviceDescription, setServiceDescription] = useState('');
  const [serviceBudget, setServiceBudget] = useState('50000');
  const [serviceColor, setServiceColor] = useState('#10b981');
  const [serviceOrgId, setServiceOrgId] = useState(activeOrgId || displayOrgs[0]?.id || '');
  const [deletingService, setDeletingService] = useState<ServiceCategory | null>(null);
  const [serviceSearch, setServiceSearch] = useState('');

  // =========================================================================
  // 4. VENDORS & PROVIDERS STATE & MODALS
  // =========================================================================
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<ServiceProvider | null>(null);
  const [vendorName, setVendorName] = useState('');
  const [vendorContact, setVendorContact] = useState('');
  const [vendorPhone, setVendorPhone] = useState('');
  const [vendorEmail, setVendorEmail] = useState('');
  const [vendorTaxNumber, setVendorTaxNumber] = useState('');
  const [vendorCrNumber, setVendorCrNumber] = useState('');
  const [vendorBankName, setVendorBankName] = useState('');
  const [vendorIban, setVendorIban] = useState('');
  const [vendorAddress, setVendorAddress] = useState('');
  const [vendorOrgId, setVendorOrgId] = useState(activeOrgId || displayOrgs[0]?.id || '');
  const [deletingVendor, setDeletingVendor] = useState<ServiceProvider | null>(null);
  const [vendorSearch, setVendorSearch] = useState('');

  // =========================================================================
  // 5. PAYMENT VAULTS STATE & MODALS
  // =========================================================================
  const [isVaultModalOpen, setIsVaultModalOpen] = useState(false);
  const [editingVault, setEditingVault] = useState<PaymentAccount | null>(null);
  const [vaultName, setVaultName] = useState('');
  const [vaultType, setVaultType] = useState<PaymentAccount['type']>('bank');
  const [vaultIdentifier, setVaultIdentifier] = useState('');
  const [vaultBankName, setVaultBankName] = useState('');
  const [vaultCurrency, setVaultCurrency] = useState('EGP');
  const [vaultDescription, setVaultDescription] = useState('');
  const [vaultOrgId, setVaultOrgId] = useState(activeOrgId || displayOrgs[0]?.id || '');
  const [deletingVault, setDeletingVault] = useState<PaymentAccount | null>(null);
  const [vaultSearch, setVaultSearch] = useState('');

  // =========================================================================
  // 6. DEPARTMENTS STATE & MODALS
  // =========================================================================
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [deptName, setDeptName] = useState('');
  const [deptCode, setDeptCode] = useState('');
  const [deptDescription, setDeptDescription] = useState('');
  const [deptManager, setDeptManager] = useState('');
  const [deptOrgId, setDeptOrgId] = useState(activeOrgId || displayOrgs[0]?.id || '');
  const [deletingDept, setDeletingDept] = useState<Department | null>(null);
  const [deptSearch, setDeptSearch] = useState('');

  // =========================================================================
  // 7. SUPER ADMINS STATE
  // =========================================================================
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [adminSuccessMsg, setAdminSuccessMsg] = useState<string | null>(null);
  const [adminErrorMsg, setAdminErrorMsg] = useState<string | null>(null);
  const [isSuperAdminModalOpen, setIsSuperAdminModalOpen] = useState(false);
  const [editingSuperAdminEmail, setEditingSuperAdminEmail] = useState<string | null>(null);
  const [targetSuperAdminRole, setTargetSuperAdminRole] = useState<Role>('org_admin');
  const [targetSuperAdminOrgId, setTargetSuperAdminOrgId] = useState<string>('');
  const [superAdminActionLoading, setSuperAdminActionLoading] = useState(false);
  const [superAdminActionFeedback, setSuperAdminActionFeedback] = useState<{ msg: string; isError?: boolean } | null>(null);

  // =========================================================================
  // 8. AUDIT LOG STATE & FILTERS
  // =========================================================================
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState<string>('all');
  const [auditEntityFilter, setAuditEntityFilter] = useState<string>('all');

  // Sync selected organization for modal forms
  React.useEffect(() => {
    if ((!selectedOrgForMember || selectedOrgForMember === 'all') && displayOrgs.length > 0) {
      setSelectedOrgForMember(displayOrgs[0].id);
    }
  }, [displayOrgs, selectedOrgForMember]);

  // =========================================================================
  // HANDLERS: COMPANIES
  // =========================================================================
  const handleAddOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim() || isCreatingOrg) return;

    setOrgFormError(null);
    setIsCreatingOrg(true);

    try {
      const res = await addOrganization({
        name: orgName.trim(),
        code: orgCode.trim().toUpperCase() || orgName.trim().slice(0, 3).toUpperCase() || 'ORG',
        currency: orgCurrency,
        budget: Number(orgBudget) || 0,
        description: orgDescription.trim() || 'مؤسسة معتمدة في المنصة',
        status: 'active',
      });

      if (!res.success) {
        setOrgFormError(res.message || 'تعذر إضافة الشركة.');
        setIsCreatingOrg(false);
        return;
      }

      setOrgName('');
      setOrgCode('');
      setOrgDescription('');
      setOrgFormError(null);
      setIsOrgModalOpen(false);
    } catch {
      setOrgFormError('حدث خطأ غير متوقع أثناء إنشاء الشركة.');
    } finally {
      setIsCreatingOrg(false);
    }
  };

  const handleStartEditOrg = (org: Organization) => {
    setEditingOrg(org);
    setEditOrgName(org.name);
    setEditOrgCode(org.code);
    setEditOrgCurrency(org.currency || 'EGP');
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

  // =========================================================================
  // HANDLERS: USERS
  // =========================================================================
  const handleProvisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProvisionError(null);
    setProvisionLoading(true);

    const targetOrgId = selectedOrgForMember || (displayOrgs[0]?.id || '');
    const cleanEmail = memberEmail.trim().toLowerCase();
    const cleanPassword = memberPassword.trim();

    if (!cleanEmail || !cleanPassword) {
      setProvisionError('يرجى كتابة البريد الإلكتروني وكلمة المرور.');
      setProvisionLoading(false);
      return;
    }

    if (cleanPassword.length < 6) {
      setProvisionError('كلمة المرور يجب ألا تقل عن 6 أحرف أو أرقام.');
      setProvisionLoading(false);
      return;
    }

    const res = await createCompanyUser({
      name: memberName.trim(),
      email: cleanEmail,
      password: cleanPassword,
      phone: memberPhone.trim(),
      role: memberRole,
      department: department.trim(),
      jobTitle: jobTitle.trim(),
      orgId: targetOrgId,
    });

    setProvisionLoading(false);

    if (res.success && res.credentials) {
      const orgObj = displayOrgs.find(o => o.id === targetOrgId);
      setCreatedCredentials({
        name: memberName.trim(),
        email: res.credentials.email,
        password: res.credentials.password,
        phone: memberPhone.trim(),
        orgName: orgObj?.name || 'الشركة المحددة',
      });
      setMemberName('');
      setMemberEmail('');
      setMemberPassword('');
      setMemberPhone('');
    } else {
      setProvisionError(res.message || 'تعذر إضافة المستخدم.');
    }
  };

  const handleStartEditMember = (mem: OrganizationMember) => {
    setEditingMember(mem);
    setEditMemberName(mem.userName);
    setEditMemberPhone(mem.phone || '');
    setEditMemberOrgId(mem.orgId);
    setEditMemberRole(mem.role);
    setEditMemberDept(mem.department || 'العمليات والتشغيل');
    setEditMemberJob(mem.jobTitle || 'موظف');
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
        orgId: editMemberOrgId || editingMember.orgId,
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

  const handleTriggerPasswordReset = async (email: string) => {
    setResettingPasswordEmail(email);
    setResetFeedback(null);
    try {
      const res = await adminResetUserPassword(email);
      setResetFeedback({
        email,
        message: res.message || 'تم إرسال رابط إعادة تعيين كلمة المرور بنجاح.',
        isError: !res.success,
      });
    } catch {
      setResetFeedback({
        email,
        message: 'حدث خطأ غير متوقع أثناء إرسال البريد.',
        isError: true,
      });
    } finally {
      setResettingPasswordEmail(null);
    }
  };

  const handleConfirmDeleteMember = async () => {
    if (!deletingMember) return;
    await removeMember(deletingMember.id);
    setDeletingMember(null);
  };

  // =========================================================================
  // HANDLERS: SERVICES
  // =========================================================================
  const handleOpenAddService = () => {
    setEditingService(null);
    setServiceName('');
    setServiceCode(`SRV-${Math.floor(100 + Math.random() * 900)}`);
    setServiceDescription('');
    setServiceBudget('50000');
    setServiceColor('#10b981');
    setServiceOrgId(activeOrgId || displayOrgs[0]?.id || '');
    setIsServiceModalOpen(true);
  };

  const handleStartEditService = (srv: ServiceCategory) => {
    setEditingService(srv);
    setServiceName(srv.name);
    setServiceCode(srv.code);
    setServiceDescription(srv.description || '');
    setServiceBudget(srv.budgetLimit.toString());
    setServiceColor(srv.color || '#10b981');
    setServiceOrgId(srv.orgId);
    setIsServiceModalOpen(true);
  };

  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceName.trim()) return;

    if (editingService) {
      await updateService({
        ...editingService,
        name: serviceName.trim(),
        code: serviceCode.trim().toUpperCase() || editingService.code,
        description: serviceDescription.trim(),
        budgetLimit: Number(serviceBudget) || 0,
        color: serviceColor,
        orgId: serviceOrgId || editingService.orgId,
      });
    } else {
      await addService({
        name: serviceName.trim(),
        code: serviceCode.trim().toUpperCase() || `SRV-${Math.floor(100 + Math.random() * 900)}`,
        description: serviceDescription.trim(),
        budgetLimit: Number(serviceBudget) || 0,
        color: serviceColor,
        iconName: 'Layers',
        orgId: serviceOrgId || activeOrgId || displayOrgs[0]?.id || '',
      });
    }
    setIsServiceModalOpen(false);
  };

  const handleConfirmDeleteService = async () => {
    if (!deletingService) return;
    await deleteService(deletingService.id);
    setDeletingService(null);
  };

  // =========================================================================
  // HANDLERS: VENDORS
  // =========================================================================
  const handleOpenAddVendor = () => {
    setEditingVendor(null);
    setVendorName('');
    setVendorContact('');
    setVendorPhone('');
    setVendorEmail('');
    setVendorTaxNumber('');
    setVendorCrNumber('');
    setVendorBankName('البنك التجاري الدولي (CIB)');
    setVendorIban('');
    setVendorAddress('');
    setVendorOrgId(activeOrgId || displayOrgs[0]?.id || '');
    setIsVendorModalOpen(true);
  };

  const handleStartEditVendor = (prov: ServiceProvider) => {
    setEditingVendor(prov);
    setVendorName(prov.name);
    setVendorContact(prov.contactPerson || '');
    setVendorPhone(prov.phone || '');
    setVendorEmail(prov.email || '');
    setVendorTaxNumber(prov.taxNumber || '');
    setVendorCrNumber(prov.crNumber || '');
    setVendorBankName(prov.bankName || '');
    setVendorIban(prov.iban || '');
    setVendorAddress(prov.address || '');
    setVendorOrgId(prov.orgId);
    setIsVendorModalOpen(true);
  };

  const handleSaveVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendorName.trim()) return;

    if (editingVendor) {
      await updateProvider({
        ...editingVendor,
        name: vendorName.trim(),
        contactPerson: vendorContact.trim(),
        phone: vendorPhone.trim(),
        email: vendorEmail.trim(),
        taxNumber: vendorTaxNumber.trim(),
        crNumber: vendorCrNumber.trim(),
        bankName: vendorBankName.trim(),
        iban: vendorIban.trim().toUpperCase(),
        address: vendorAddress.trim(),
        orgId: vendorOrgId || editingVendor.orgId,
      });
    } else {
      await addProvider({
        name: vendorName.trim(),
        contactPerson: vendorContact.trim(),
        phone: vendorPhone.trim(),
        email: vendorEmail.trim(),
        taxNumber: vendorTaxNumber.trim(),
        crNumber: vendorCrNumber.trim(),
        bankName: vendorBankName.trim(),
        iban: vendorIban.trim().toUpperCase(),
        address: vendorAddress.trim(),
        orgId: vendorOrgId || activeOrgId || displayOrgs[0]?.id || '',
        serviceCategoryIds: [],
        serviceCategoryNames: [],
        rating: 5,
        active: true,
      });
    }
    setIsVendorModalOpen(false);
  };

  const handleConfirmDeleteVendor = async () => {
    if (!deletingVendor) return;
    await deleteProvider(deletingVendor.id);
    setDeletingVendor(null);
  };

  // =========================================================================
  // HANDLERS: VAULTS & PAYMENT ACCOUNTS
  // =========================================================================
  const handleOpenAddVault = () => {
    setEditingVault(null);
    setVaultName('');
    setVaultType('bank');
    setVaultIdentifier('');
    setVaultBankName('');
    setVaultCurrency(activeOrg?.currency || 'EGP');
    setVaultDescription('');
    setVaultOrgId(activeOrgId || displayOrgs[0]?.id || '');
    setIsVaultModalOpen(true);
  };

  const handleStartEditVault = (vault: PaymentAccount) => {
    setEditingVault(vault);
    setVaultName(vault.name);
    setVaultType(vault.type);
    setVaultIdentifier(vault.accountIdentifier);
    setVaultBankName(vault.bankName || '');
    setVaultCurrency(vault.currency || 'EGP');
    setVaultDescription(vault.description || '');
    setVaultOrgId(vault.orgId);
    setIsVaultModalOpen(true);
  };

  const handleSaveVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultName.trim() || !vaultIdentifier.trim()) return;

    if (editingVault) {
      await updatePaymentAccount(editingVault.id, {
        name: vaultName.trim(),
        type: vaultType,
        accountIdentifier: vaultIdentifier.trim(),
        bankName: vaultBankName.trim(),
        currency: vaultCurrency,
        description: vaultDescription.trim(),
        orgId: vaultOrgId || editingVault.orgId,
      });
    } else {
      await addPaymentAccount({
        name: vaultName.trim(),
        type: vaultType,
        accountIdentifier: vaultIdentifier.trim(),
        bankName: vaultBankName.trim(),
        currency: vaultCurrency,
        description: vaultDescription.trim(),
        orgId: vaultOrgId || activeOrgId || displayOrgs[0]?.id || '',
        active: true,
      });
    }
    setIsVaultModalOpen(false);
  };

  const handleConfirmDeleteVault = async () => {
    if (!deletingVault) return;
    await deletePaymentAccount(deletingVault.id);
    setDeletingVault(null);
  };

  // =========================================================================
  // HANDLERS: DEPARTMENTS
  // =========================================================================
  const handleOpenAddDept = () => {
    setEditingDept(null);
    setDeptName('');
    setDeptCode(`DEP-${Math.floor(10 + Math.random() * 90)}`);
    setDeptDescription('');
    setDeptManager('');
    setDeptOrgId(activeOrgId || displayOrgs[0]?.id || '');
    setIsDeptModalOpen(true);
  };

  const handleStartEditDept = (dept: Department) => {
    setEditingDept(dept);
    setDeptName(dept.name);
    setDeptCode(dept.code || '');
    setDeptDescription(dept.description || '');
    setDeptManager(dept.managerName || '');
    setDeptOrgId(dept.orgId);
    setIsDeptModalOpen(true);
  };

  const handleSaveDept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptName.trim()) return;

    if (editingDept) {
      await updateDepartment(editingDept.id, {
        name: deptName.trim(),
        code: deptCode.trim().toUpperCase() || editingDept.code,
        description: deptDescription.trim(),
        managerName: deptManager.trim(),
        orgId: deptOrgId || editingDept.orgId,
      });
    } else {
      await addDepartment({
        name: deptName.trim(),
        code: deptCode.trim().toUpperCase() || `DEP-${Math.floor(10 + Math.random() * 90)}`,
        description: deptDescription.trim(),
        managerName: deptManager.trim(),
        orgId: deptOrgId || activeOrgId || displayOrgs[0]?.id || '',
      });
    }
    setIsDeptModalOpen(false);
  };

  const handleConfirmDeleteDept = async () => {
    if (!deletingDept) return;
    await deleteDepartment(deletingDept.id);
    setDeletingDept(null);
  };

  // =========================================================================
  // HANDLERS: SUPER ADMINS
  // =========================================================================
  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminSuccessMsg(null);
    setAdminErrorMsg(null);

    const email = newAdminEmail.trim().toLowerCase();
    if (!email || !isValidEmail(email)) {
      setAdminErrorMsg('يرجى إدخال بريد إلكتروني صالح.');
      return;
    }

    if (superAdminEmails.includes(email)) {
      setAdminErrorMsg('هذا البريد مسجل بالفعل كمشرف عام.');
      return;
    }

    try {
      await addSuperAdminEmail(email);
      setAdminSuccessMsg(`تمت ترقية الحساب (${email}) كمشرف عام للمنصة.`);
      setNewAdminEmail('');
    } catch {
      setAdminErrorMsg('حدث خطأ أثناء حفظ المشرف العام.');
    }
  };

  const handleRemoveSuperAdmin = async (email: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (cleanEmail === 'mahmoud@tieapps.com') {
      alert('لا يمكن إزالة الحساب الرئيسي لمشرف المنصة الأساسي.');
      return;
    }

    if (!window.confirm(`هل أنت متأكد من رغبتك في سحب صلاحيات السوبر أدمن عن الحساب (${cleanEmail})؟`)) {
      return;
    }

    try {
      setSuperAdminActionLoading(true);
      await removeSuperAdminEmail(cleanEmail);
      setSuperAdminActionFeedback({ msg: `تم سحب صلاحيات السوبر أدمن عن (${cleanEmail}) بنجاح.` });
    } catch {
      setSuperAdminActionFeedback({ msg: 'حدث خطأ أثناء إزالة صلاحيات السوبر أدمن.', isError: true });
    } finally {
      setSuperAdminActionLoading(false);
    }
  };

  const handleOpenEditSuperAdminRole = (email: string) => {
    setEditingSuperAdminEmail(email);
    const existingMember = members.find(m => m.userEmail?.toLowerCase().trim() === email.toLowerCase().trim());
    setTargetSuperAdminRole(existingMember?.role === 'super_admin' ? 'org_admin' : existingMember?.role || 'org_admin');
    setTargetSuperAdminOrgId(existingMember?.orgId || displayOrgs[0]?.id || '');
    setSuperAdminActionFeedback(null);
  };

  const handleSaveSuperAdminRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSuperAdminEmail) return;

    if (
      editingSuperAdminEmail === 'mahmoud@tieapps.com' && 
      targetSuperAdminRole !== 'super_admin'
    ) {
      alert('لا يمكن تغيير رتبة المشرف الأساسي للمنصة.');
      return;
    }

    try {
      setSuperAdminActionLoading(true);
      await updateSuperAdminRole(editingSuperAdminEmail, targetSuperAdminRole, targetSuperAdminOrgId);
      setSuperAdminActionFeedback({ msg: `تم تحديث دور الحساب (${editingSuperAdminEmail}) إلى (${targetSuperAdminRole}) بنجاح.` });
      setEditingSuperAdminEmail(null);
    } catch {
      setSuperAdminActionFeedback({ msg: 'حدث خطأ أثناء تعديل الصلاحية.', isError: true });
    } finally {
      setSuperAdminActionLoading(false);
    }
  };

  // =========================================================================
  // FILTERED DATASETS
  // =========================================================================
  const filteredOrgs = useMemo(() => {
    if (!orgSearch.trim()) return displayOrgs;
    const q = orgSearch.toLowerCase().trim();
    return displayOrgs.filter(o => 
      o.name.toLowerCase().includes(q) || 
      o.code.toLowerCase().includes(q) ||
      (o.description && o.description.toLowerCase().includes(q))
    );
  }, [displayOrgs, orgSearch]);

  const filteredMembers = useMemo(() => {
    return members.filter(m => {
      if (selectedOrgFilter !== 'all' && m.orgId !== selectedOrgFilter) return false;
      if (selectedRoleFilter !== 'all' && m.role !== selectedRoleFilter) return false;
      if (selectedStatusFilter === 'active' && m.active === false) return false;
      if (selectedStatusFilter === 'inactive' && m.active !== false) return false;

      if (!userSearch.trim()) return true;
      const q = userSearch.toLowerCase().trim();
      return (
        m.userName.toLowerCase().includes(q) ||
        m.userEmail.toLowerCase().includes(q) ||
        (m.phone && m.phone.includes(q)) ||
        (m.jobTitle && m.jobTitle.toLowerCase().includes(q)) ||
        (m.department && m.department.toLowerCase().includes(q))
      );
    });
  }, [members, selectedOrgFilter, selectedRoleFilter, selectedStatusFilter, userSearch]);

  const filteredServices = useMemo(() => {
    const orgFiltered = services.filter(s => activeOrgId === 'all' || !activeOrgId || s.orgId === activeOrgId);
    if (!serviceSearch.trim()) return orgFiltered;
    const q = serviceSearch.toLowerCase().trim();
    return orgFiltered.filter(s => 
      s.name.toLowerCase().includes(q) || 
      s.code.toLowerCase().includes(q) ||
      (s.description && s.description.toLowerCase().includes(q))
    );
  }, [services, activeOrgId, serviceSearch]);

  const filteredVendors = useMemo(() => {
    const orgFiltered = providers.filter(p => activeOrgId === 'all' || !activeOrgId || p.orgId === activeOrgId);
    if (!vendorSearch.trim()) return orgFiltered;
    const q = vendorSearch.toLowerCase().trim();
    return orgFiltered.filter(p => 
      p.name.toLowerCase().includes(q) || 
      p.contactPerson.toLowerCase().includes(q) ||
      p.phone.includes(q) ||
      p.email.toLowerCase().includes(q) ||
      p.taxNumber.includes(q)
    );
  }, [providers, activeOrgId, vendorSearch]);

  const filteredVaults = useMemo(() => {
    const orgFiltered = paymentAccounts.filter(a => activeOrgId === 'all' || !activeOrgId || a.orgId === activeOrgId);
    if (!vaultSearch.trim()) return orgFiltered;
    const q = vaultSearch.toLowerCase().trim();
    return orgFiltered.filter(a => 
      a.name.toLowerCase().includes(q) || 
      a.accountIdentifier.toLowerCase().includes(q) ||
      (a.bankName && a.bankName.toLowerCase().includes(q))
    );
  }, [paymentAccounts, activeOrgId, vaultSearch]);

  const filteredDepartments = useMemo(() => {
    const orgFiltered = departments.filter(d => activeOrgId === 'all' || !activeOrgId || d.orgId === activeOrgId);
    if (!deptSearch.trim()) return orgFiltered;
    const q = deptSearch.toLowerCase().trim();
    return orgFiltered.filter(d => 
      d.name.toLowerCase().includes(q) || 
      (d.code && d.code.toLowerCase().includes(q)) ||
      (d.managerName && d.managerName.toLowerCase().includes(q))
    );
  }, [departments, activeOrgId, deptSearch]);

  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter(log => {
      if (auditActionFilter !== 'all' && log.actionType !== auditActionFilter) return false;
      if (auditEntityFilter !== 'all' && log.entityType !== auditEntityFilter) return false;

      if (!auditSearch.trim()) return true;
      const q = auditSearch.toLowerCase().trim();
      return (
        log.actorName.toLowerCase().includes(q) ||
        log.actorEmail.toLowerCase().includes(q) ||
        log.entityName.toLowerCase().includes(q) ||
        log.details.toLowerCase().includes(q)
      );
    });
  }, [auditLogs, auditActionFilter, auditEntityFilter, auditSearch]);

  // Global KPI numbers
  const totalUsersCount = members.length;
  const activeUsersCount = members.filter(m => m.active !== false).length;
  const suspendedUsersCount = members.filter(m => m.active === false).length;

  return (
    <div className="space-y-6 pb-16 animate-in fade-in duration-200">
      
      {/* =========================================================================
          TOP COMMAND HEADER
          ========================================================================= */}
      <div className="bg-white rounded-3xl border border-slate-200/80 p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900">مركز الإدارة والتحكم الشامل</h1>
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                  Enterprise Control Hub
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                إدارة متكاملة للشركات، الموظفين، بنود ومراكز الصرف، الموردين، الخزائن، وسجل التدقيق الإداري
              </p>
            </div>
          </div>
        </div>

        {/* Action button based on active section */}
        <div className="flex items-center gap-2 flex-wrap">
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => setIsSuperAdminModalOpen(true)}
              className="px-4 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5"
            >
              <Crown className="h-4 w-4" />
              <span>إدارة السوبر أدمن (Super Admins)</span>
            </button>
          )}

          {activeSection === 'companies' && canManageOrgs && (
            <button
              type="button"
              onClick={() => setIsOrgModalOpen(true)}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              <span>إضافة شركة جديدة</span>
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
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5"
            >
              <UserPlus className="h-4 w-4" />
              <span>تعيين موظف جديد</span>
            </button>
          )}

          {activeSection === 'services' && (
            <button
              type="button"
              onClick={handleOpenAddService}
              className="px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              <span>إضافة بند صرف</span>
            </button>
          )}

          {activeSection === 'vendors' && (
            <button
              type="button"
              onClick={handleOpenAddVendor}
              className="px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              <span>تسجيل مورد جديد</span>
            </button>
          )}

          {activeSection === 'vaults' && (
            <button
              type="button"
              onClick={handleOpenAddVault}
              className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              <span>إضافة خزينة / حساب دفع</span>
            </button>
          )}

          {activeSection === 'departments' && (
            <button
              type="button"
              onClick={handleOpenAddDept}
              className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              <span>إضافة قسم جديد</span>
            </button>
          )}
        </div>
      </div>

      {/* =========================================================================
          ADMIN MODULES TAB SWITCHER
          ========================================================================= */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveSection('companies')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeSection === 'companies'
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/20'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Building2 className="h-3.5 w-3.5" />
          <span>🏢 الشركات والمؤسسات ({displayOrgs.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('users')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeSection === 'users'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          <span>👥 المستخدمين والموظفين ({members.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('services')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeSection === 'services'
              ? 'bg-teal-600 text-white shadow-md shadow-teal-500/20'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          <span>📂 بنود ومراكز الصرف ({filteredServices.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('vendors')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeSection === 'vendors'
              ? 'bg-sky-600 text-white shadow-md shadow-sky-500/20'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Truck className="h-3.5 w-3.5" />
          <span>🚚 الموردين ومقدمي الخدمات ({filteredVendors.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('vaults')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeSection === 'vaults'
              ? 'bg-amber-600 text-white shadow-md shadow-amber-500/20'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Wallet className="h-3.5 w-3.5" />
          <span>💳 الخزائن وحسابات الدفع ({filteredVaults.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('departments')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeSection === 'departments'
              ? 'bg-purple-600 text-white shadow-md shadow-purple-500/20'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <FolderTree className="h-3.5 w-3.5" />
          <span>🏷️ الأقسام والهيكل ({filteredDepartments.length})</span>
        </button>

        {isSuperAdmin && (
          <button
            type="button"
            onClick={() => setActiveSection('super_admins')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              activeSection === 'super_admins'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-500/20'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>🛡️ المشرفين والصلاحيات ({superAdminEmails.length})</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveSection('audit_log')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeSection === 'audit_log'
              ? 'bg-slate-900 text-white shadow-md shadow-slate-900/20'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <History className="h-3.5 w-3.5" />
          <span>📜 سجل العمليات والتعديلات ({filteredAuditLogs.length})</span>
        </button>
      </div>

      {/* =========================================================================
          SECTION 1: COMPANIES MANAGEMENT
          ========================================================================= */}
      {activeSection === 'companies' && (
        <div className="space-y-5">
          {/* Search Bar */}
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

          {/* Grid */}
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
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-slate-900 to-slate-800 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                        {org.code.slice(0, 3)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-slate-900 text-sm">{org.name}</h3>
                          {isCurrentActive && (
                            <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                              الشركة النشطة
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] font-mono text-slate-400">كود مالي: {org.code}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      {canManageOrgs && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleStartEditOrg(org)}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                            title="تعديل وإعادة تسمية الشركة"
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
                          {!isCurrentActive && isSuperAdmin && (
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
          </div>
        </div>
      )}

      {/* =========================================================================
          SECTION 2: USERS & PERSONNEL
          ========================================================================= */}
      {activeSection === 'users' && (
        <div className="space-y-5">
          {/* Counters */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-xs text-slate-500 block">إجمالي المستخدمين</span>
              <span className="text-2xl font-bold font-mono text-slate-900 mt-1 block">{totalUsersCount}</span>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-xs text-slate-500 block">الحسابات النشطة</span>
              <span className="text-2xl font-bold font-mono text-emerald-600 mt-1 block">{activeUsersCount}</span>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-xs text-slate-500 block">الحسابات المعطلة</span>
              <span className="text-2xl font-bold font-mono text-rose-600 mt-1 block">{suspendedUsersCount}</span>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-xs text-slate-500 block">مدراء الشركات</span>
              <span className="text-2xl font-bold font-mono text-indigo-600 mt-1 block">
                {members.filter(m => m.role === 'org_admin').length}
              </span>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-xs text-slate-500 block">الموظفين</span>
              <span className="text-2xl font-bold font-mono text-slate-700 mt-1 block">
                {members.filter(m => m.role === 'employee').length}
              </span>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-[240px]">
              <Search className="h-4 w-4 text-slate-400 shrink-0" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="ابحث بالاسم، البريد، المسمى الوظيفي، أو الهاتف..."
                className="w-full text-xs bg-transparent outline-hidden text-slate-800"
              />
              {userSearch && (
                <button onClick={() => setUserSearch('')} className="text-slate-400 hover:text-slate-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap text-xs">
              {canManageOrgs && (
                <select
                  value={selectedOrgFilter}
                  onChange={(e) => setSelectedOrgFilter(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-700 font-semibold outline-hidden"
                >
                  <option value="all">كل الشركات ({displayOrgs.length})</option>
                  {displayOrgs.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              )}

              <select
                value={selectedRoleFilter}
                onChange={(e) => setSelectedRoleFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-700 font-semibold outline-hidden"
              >
                <option value="all">كل الرتب والأدوار</option>
                <option value="org_admin">مدير مؤسسة (Admin)</option>
                <option value="finance">مسؤول الصرف والخزينة (Finance)</option>
                <option value="employee">موظف (Employee)</option>
                <option value="data_entry">مدخل بيانات (Data Entry)</option>
              </select>

              <select
                value={selectedStatusFilter}
                onChange={(e) => setSelectedStatusFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-700 font-semibold outline-hidden"
              >
                <option value="all">كل الحالات</option>
                <option value="active">نشط فقط</option>
                <option value="inactive">معطل فقط</option>
              </select>
            </div>
          </div>

          {/* Reset feedback message */}
          {resetFeedback && (
            <div className={`p-3 rounded-xl text-xs flex items-center justify-between gap-2 ${
              resetFeedback.isError ? 'bg-rose-50 border border-rose-200 text-rose-800' : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
            }`}>
              <span>{resetFeedback.message}</span>
              <button onClick={() => setResetFeedback(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Users Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500">
                    <th className="py-3 px-4 font-bold">المستخدم</th>
                    <th className="py-3 px-4 font-bold">الشركة التابعة</th>
                    <th className="py-3 px-4 font-bold">المسمى والقسم</th>
                    <th className="py-3 px-4 font-bold">الدور</th>
                    <th className="py-3 px-4 font-bold">الحالة</th>
                    <th className="py-3 px-4 font-bold text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMembers.map((mem) => {
                    const orgObj = displayOrgs.find(o => o.id === mem.orgId);
                    const isResetting = resettingPasswordEmail === mem.userEmail;

                    return (
                      <tr key={mem.id} className="hover:bg-slate-50/60 transition">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <div className="h-8 w-8 rounded-full bg-indigo-50 text-indigo-700 font-bold flex items-center justify-center text-xs shrink-0">
                              {mem.userName.slice(0, 1)}
                            </div>
                            <div>
                              <span className="font-bold text-slate-900 block">{mem.userName}</span>
                              <span className="text-[11px] text-slate-400 font-mono block">{mem.userEmail}</span>
                              {mem.phone && <span className="text-[10px] text-slate-500 font-mono block">{mem.phone}</span>}
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <span className="font-semibold text-slate-700 block">{orgObj?.name || 'غير محدد'}</span>
                          <span className="text-[10px] text-slate-400 font-mono block">{orgObj?.code || '-'}</span>
                        </td>

                        <td className="py-3 px-4">
                          <span className="font-semibold text-slate-800 block">{mem.jobTitle || 'موظف'}</span>
                          <span className="text-[11px] text-slate-500 block">{mem.department || 'العمليات'}</span>
                        </td>

                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            mem.role === 'org_admin'
                              ? 'bg-purple-100 text-purple-800'
                              : mem.role === 'finance'
                              ? 'bg-emerald-100 text-emerald-800'
                              : mem.role === 'data_entry'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}>
                            {mem.role === 'org_admin' ? 'مدير شركة' : mem.role === 'finance' ? 'مسؤول الصرف والخزينة' : mem.role === 'data_entry' ? 'مدخل بيانات' : 'موظف'}
                          </span>
                        </td>

                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => toggleMemberStatus(mem.id, mem.active === false)}
                            className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full cursor-pointer transition ${
                              mem.active !== false 
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100' 
                                : 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                            }`}
                            title="اضغط للتبديل بين التفعيل والتعطيل"
                          >
                            {mem.active !== false ? (
                              <>
                                <CheckCircle2 className="h-3 w-3" />
                                <span>نشط</span>
                              </>
                            ) : (
                              <>
                                <AlertTriangle className="h-3 w-3" />
                                <span>معطل</span>
                              </>
                            )}
                          </button>
                        </td>

                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleStartEditMember(mem)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                              title="تعديل وإعادة تسمية الموظف"
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleTriggerPasswordReset(mem.userEmail)}
                              disabled={isResetting}
                              className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition cursor-pointer disabled:opacity-50"
                              title="إرسال رابط استعادة كلمة المرور"
                            >
                              {isResetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                            </button>

                            <button
                              type="button"
                              onClick={() => setDeletingMember(mem)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                              title="حذف المستخدم نهائياً"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          SECTION 3: SERVICES & EXPENSE CATEGORIES
          ========================================================================= */}
      {activeSection === 'services' && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-xs max-w-md">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={serviceSearch}
              onChange={(e) => setServiceSearch(e.target.value)}
              placeholder="ابحث عن بند صرف بالاسم أو الرمز المحاسبي..."
              className="w-full text-xs bg-transparent outline-hidden text-slate-800"
            />
            {serviceSearch && (
              <button onClick={() => setServiceSearch('')} className="text-slate-400 hover:text-slate-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredServices.map((srv) => {
              const spent = srv.spentAmount || 0;
              const limit = srv.budgetLimit || 1;
              const percent = Math.min(100, Math.round((spent / limit) * 100));

              return (
                <div key={srv.id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs hover:border-slate-300 transition">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div 
                        className="h-9 w-9 rounded-xl flex items-center justify-center text-white text-xs font-bold shadow-xs"
                        style={{ backgroundColor: srv.color || '#10b981' }}
                      >
                        <Layers className="h-4 w-4" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 text-xs">{srv.name}</h4>
                        <span className="text-[10px] text-slate-400 font-mono block">كود: {srv.code}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleStartEditService(srv)}
                        className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                        title="تعديل وإعادة تسمية البند"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingService(srv)}
                        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                        title="حذف البند"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 mt-2 line-clamp-2">
                    {srv.description || 'بند ومصروف معتمد للشركة.'}
                  </p>

                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-slate-400">سقف الميزانية:</span>
                      <span className="font-bold font-mono text-slate-800">{srv.budgetLimit.toLocaleString()} ج.م</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-teal-500 rounded-full" style={{ width: `${percent}%` }}></div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =========================================================================
          SECTION 4: VENDORS & PROVIDERS
          ========================================================================= */}
      {activeSection === 'vendors' && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-xs max-w-md">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={vendorSearch}
              onChange={(e) => setVendorSearch(e.target.value)}
              placeholder="ابحث عن مورد، مسؤول الاتصال، الهاتف، أو الرقم الضريبي..."
              className="w-full text-xs bg-transparent outline-hidden text-slate-800"
            />
            {vendorSearch && (
              <button onClick={() => setVendorSearch('')} className="text-slate-400 hover:text-slate-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredVendors.map((prov) => (
              <div key={prov.id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs hover:border-slate-300 transition">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-xl bg-sky-50 text-sky-700 flex items-center justify-center text-xs font-bold">
                      <Truck className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 text-xs">{prov.name}</h4>
                      <span className="text-[10px] text-slate-500 block">المسؤول: {prov.contactPerson || '-'}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleStartEditVendor(prov)}
                      className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                      title="تعديل وتسمية المورد"
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingVendor(prov)}
                      className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                      title="حذف المورد"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-100 space-y-1 text-[11px] text-slate-600">
                  {prov.phone && <div className="flex items-center gap-1.5"><Phone className="h-3 w-3 text-slate-400" /><span className="font-mono">{prov.phone}</span></div>}
                  {prov.bankName && <div className="flex items-center gap-1.5"><Landmark className="h-3 w-3 text-slate-400" /><span>{prov.bankName}</span></div>}
                  {prov.iban && <div className="flex items-center gap-1.5"><CreditCard className="h-3 w-3 text-slate-400" /><span className="font-mono truncate">{prov.iban}</span></div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =========================================================================
          SECTION 5: PAYMENT VAULTS & ACCOUNTS
          ========================================================================= */}
      {activeSection === 'vaults' && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-xs max-w-md">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={vaultSearch}
              onChange={(e) => setVaultSearch(e.target.value)}
              placeholder="ابحث عن خزينة، حساب بنكي، أو إنستاباي..."
              className="w-full text-xs bg-transparent outline-hidden text-slate-800"
            />
            {vaultSearch && (
              <button onClick={() => setVaultSearch('')} className="text-slate-400 hover:text-slate-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredVaults.map((vault) => {
              const typeIcon = 
                vault.type === 'instapay' ? <Wallet className="h-4 w-4 text-emerald-600" /> :
                vault.type === 'bank' ? <Landmark className="h-4 w-4 text-indigo-600" /> :
                vault.type === 'cash' ? <DollarSign className="h-4 w-4 text-amber-600" /> :
                <CreditCard className="h-4 w-4 text-purple-600" />;

              const typeBadge = 
                vault.type === 'instapay' ? 'إنستاباي (InstaPay)' :
                vault.type === 'bank' ? 'حساب بنكي' :
                vault.type === 'cash' ? 'خزينة نقدية (Petty Cash)' : 'محفظة إلكترونية';

              return (
                <div key={vault.id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs hover:border-slate-300 transition">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="h-9 w-9 rounded-xl bg-slate-50 flex items-center justify-center text-xs font-bold border border-slate-100">
                        {typeIcon}
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 text-xs">{vault.name}</h4>
                        <span className="text-[10px] text-slate-500 block">{typeBadge}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleStartEditVault(vault)}
                        className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                        title="تعديل وتسمية الحساب"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingVault(vault)}
                        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                        title="حذف الحساب"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-100 space-y-1 text-[11px]">
                    <div className="text-slate-500 font-mono bg-slate-50 p-2 rounded-xl border border-slate-100 truncate">
                      المعرف: <span className="font-bold text-slate-800">{vault.accountIdentifier}</span>
                    </div>
                    {vault.bankName && <div className="text-slate-500 text-[10px] mt-1">المصرف: {vault.bankName}</div>}
                  </div>

                  <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => togglePaymentAccountStatus(vault.id, !vault.active)}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full cursor-pointer transition ${
                        vault.active ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                      }`}
                    >
                      {vault.active ? 'نشط للصرف' : 'معطل مؤقتاً'}
                    </button>
                    <span className="text-[10px] text-slate-400">{vault.currency || 'EGP'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =========================================================================
          SECTION 6: DEPARTMENTS & STRUCTURE
          ========================================================================= */}
      {activeSection === 'departments' && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-xs max-w-md">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={deptSearch}
              onChange={(e) => setDeptSearch(e.target.value)}
              placeholder="ابحث عن قسم أو مسؤول الإدارة..."
              className="w-full text-xs bg-transparent outline-hidden text-slate-800"
            />
            {deptSearch && (
              <button onClick={() => setDeptSearch('')} className="text-slate-400 hover:text-slate-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredDepartments.map((dept) => {
              const assignedCount = members.filter(m => m.department === dept.name).length;

              return (
                <div key={dept.id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs hover:border-slate-300 transition">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="h-9 w-9 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center text-xs font-bold">
                        <FolderTree className="h-4 w-4" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 text-xs">{dept.name}</h4>
                        {dept.code && <span className="text-[10px] text-slate-400 font-mono block">رمز: {dept.code}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleStartEditDept(dept)}
                        className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                        title="تعديل وإعادة تسمية القسم"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingDept(dept)}
                        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                        title="حذف القسم"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 mt-2 line-clamp-2">
                    {dept.description || 'قسم إداري معتمد بالهيكل المؤسسي.'}
                  </p>

                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">مسؤول القسم: <strong className="text-slate-700">{dept.managerName || 'غير محدد'}</strong></span>
                    <span className="text-purple-700 font-bold">{assignedCount} موظف</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =========================================================================
          SECTION 7: SUPER ADMINS & ROLES MATRIX
          ========================================================================= */}
      {activeSection === 'super_admins' && isSuperAdmin && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-3">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span>إضافة مشرف عام جديد (Super Admin)</span>
            </h3>

            <form onSubmit={handleAddAdmin} className="flex gap-2 max-w-md">
              <input
                type="email"
                required
                value={newAdminEmail}
                onChange={(e) => setNewAdminEmail(e.target.value)}
                placeholder="ادخل البريد الإلكتروني للمشرف..."
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 outline-hidden"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer"
              >
                إضافة مشرف
              </button>
            </form>

            {adminSuccessMsg && <p className="text-xs text-emerald-700 mt-2 font-semibold">{adminSuccessMsg}</p>}
            {adminErrorMsg && <p className="text-xs text-rose-700 mt-2 font-semibold">{adminErrorMsg}</p>}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-3">قائمة المشرفين العامين الحاليين</h3>
            {superAdminActionFeedback && (
              <div className={`p-3 rounded-xl mb-3 text-xs font-bold ${
                superAdminActionFeedback.isError ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              }`}>
                {superAdminActionFeedback.msg}
              </div>
            )}
            <div className="space-y-2">
              {superAdminEmails.map((email) => {
                const isRootAdmin = email === 'mahmoud@tieapps.com';
                return (
                  <div key={email} className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 text-xs gap-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
                        <Crown className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-800">{email}</span>
                          <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                            نشط
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400">سوبر أدمن المنصة • كامل الصلاحيات الإدارية</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleOpenEditSuperAdminRole(email)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg font-bold text-xs transition cursor-pointer"
                        title="تعديل الصلاحية أو النقل لشركة"
                      >
                        <Edit className="h-3.5 w-3.5" />
                        <span>تعديل الصلاحية</span>
                      </button>

                      {!isRootAdmin ? (
                        <button
                          type="button"
                          onClick={() => handleRemoveSuperAdmin(email)}
                          disabled={superAdminActionLoading}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg font-bold text-xs transition cursor-pointer disabled:opacity-50"
                          title="إزالة من السوبر أدمن"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>إزالة</span>
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-400 font-semibold px-2 py-1 bg-slate-100 rounded-lg">
                          مشرف أساسي محمي
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          SECTION 8: AUDIT TRAIL / ACTIVITY LOG
          ========================================================================= */}
      {activeSection === 'audit_log' && (
        <div className="space-y-5">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-[240px]">
              <Search className="h-4 w-4 text-slate-400 shrink-0" />
              <input
                type="text"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="ابحث في سجل العمليات باسم المنفذ أو الكيان أو التفاصيل..."
                className="w-full text-xs bg-transparent outline-hidden text-slate-800"
              />
              {auditSearch && (
                <button onClick={() => setAuditSearch('')} className="text-slate-400 hover:text-slate-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap text-xs">
              <select
                value={auditActionFilter}
                onChange={(e) => setAuditActionFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-700 font-semibold outline-hidden"
              >
                <option value="all">كل العمليات</option>
                <option value="create">إنشاء (Create)</option>
                <option value="rename">إعادة تسمية (Rename)</option>
                <option value="update">تعديل (Update)</option>
                <option value="delete">حذف (Delete)</option>
                <option value="status_toggle">تغيير حالة (Status)</option>
                <option value="budget_change">تعديل ميزانية (Budget)</option>
                <option value="password_reset">كلمة المرور (Password)</option>
              </select>

              <select
                value={auditEntityFilter}
                onChange={(e) => setAuditEntityFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-700 font-semibold outline-hidden"
              >
                <option value="all">كل الكيانات</option>
                <option value="organization">شركات</option>
                <option value="member">مستخدمين</option>
                <option value="service">بنود صرف</option>
                <option value="provider">موردين</option>
                <option value="vault">خزائن وحسابات</option>
                <option value="department">أقسام</option>
              </select>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500">
                    <th className="py-3 px-4 font-bold">التوقيت</th>
                    <th className="py-3 px-4 font-bold">نوع العملية</th>
                    <th className="py-3 px-4 font-bold">الكيان المتأثر</th>
                    <th className="py-3 px-4 font-bold">المسؤول المنفذ</th>
                    <th className="py-3 px-4 font-bold">تفاصيل التعديل والتسمية</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAuditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-slate-400">
                        لا توجد حركات مسجلة تطابق خيارات البحث الحالية.
                      </td>
                    </tr>
                  ) : (
                    filteredAuditLogs.map((log) => {
                      const badgeColor = 
                        log.actionType === 'create' ? 'bg-emerald-100 text-emerald-800' :
                        log.actionType === 'rename' ? 'bg-purple-100 text-purple-800' :
                        log.actionType === 'delete' ? 'bg-rose-100 text-rose-800' :
                        log.actionType === 'budget_change' ? 'bg-amber-100 text-amber-800' :
                        log.actionType === 'password_reset' ? 'bg-blue-100 text-blue-800' :
                        'bg-slate-100 text-slate-800';

                      const actionLabel = 
                        log.actionType === 'create' ? 'إنشاء' :
                        log.actionType === 'rename' ? 'إعادة تسمية' :
                        log.actionType === 'delete' ? 'حذف' :
                        log.actionType === 'budget_change' ? 'تعديل ميزانية' :
                        log.actionType === 'password_reset' ? 'إعادة تعيين كلمة مرور' :
                        log.actionType === 'status_toggle' ? 'تغيير حالة' : 'تحديث بيانات';

                      return (
                        <tr key={log.id} className="hover:bg-slate-50/60 transition">
                          <td className="py-3 px-4 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                            {new Date(log.timestamp).toLocaleString('ar-EG')}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeColor}`}>
                              {actionLabel}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-bold text-slate-800">
                            {log.entityName}
                            <span className="text-[10px] text-slate-400 block font-normal">{log.entityType}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-semibold text-slate-800 block">{log.actorName}</span>
                            <span className="text-[10px] text-slate-400 font-mono block">{log.actorEmail}</span>
                          </td>
                          <td className="py-3 px-4 text-slate-600 leading-relaxed max-w-md">
                            {log.details}
                          </td>
                        </tr>
                      );
                    })
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
      
      {/* 1. Add Organization Modal */}
      {isOrgModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl p-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Building2 className="h-4 w-4 text-emerald-600" />
                <span>إضافة شركة / مؤسسة جديدة</span>
              </h3>
              <button onClick={() => setIsOrgModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAddOrg} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم المؤسسة أو الشركة *</label>
                <input
                  type="text"
                  required
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="مثال: شركة تاي الدولية"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">كود مالي (Alphanumeric)</label>
                  <input
                    type="text"
                    value={orgCode}
                    onChange={(e) => setOrgCode(sanitizeCode(e.target.value, 6))}
                    placeholder="مثال: TIE"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-mono uppercase text-slate-800 outline-hidden"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">العملة الأساسية</label>
                  <select
                    value={orgCurrency}
                    onChange={(e) => setOrgCurrency(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden font-semibold"
                  >
                    {SUPPORTED_CURRENCIES.map(c => (
                      <option key={c.code} value={c.code}>{c.nameAr} ({c.code})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">سقف الميزانية التقديرية</label>
                <input
                  type="text"
                  inputMode="numeric"
                  onKeyDown={handleNumericKeyDown}
                  value={orgBudget}
                  onChange={(e) => setOrgBudget(sanitizeDigitsOnly(e.target.value))}
                  placeholder="500000"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-mono text-slate-800 outline-hidden"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">وصف الشركة / النشاط</label>
                <textarea
                  rows={2}
                  value={orgDescription}
                  onChange={(e) => setOrgDescription(e.target.value)}
                  placeholder="وصف مختصر للشركة ونشاطها..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden resize-none"
                ></textarea>
              </div>

              {orgFormError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 font-bold rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>{orgFormError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsOrgModalOpen(false)}
                  disabled={isCreatingOrg}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isCreatingOrg}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isCreatingOrg && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span>{isCreatingOrg ? 'جاري التحقق والإنشاء...' : 'حفظ وإنشاء الشركة'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Edit Organization Modal */}
      {editingOrg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl p-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Edit className="h-4 w-4 text-indigo-600" />
                <span>تعديل وإعادة تسمية الشركة ({editingOrg.name})</span>
              </h3>
              <button onClick={() => setEditingOrg(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditOrg} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم المؤسسة أو الشركة *</label>
                <input
                  type="text"
                  required
                  value={editOrgName}
                  onChange={(e) => setEditOrgName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">الكود المالي</label>
                  <input
                    type="text"
                    value={editOrgCode}
                    onChange={(e) => setEditOrgCode(sanitizeCode(e.target.value, 6))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-mono uppercase text-slate-800 outline-hidden"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">العملة</label>
                  <select
                    value={editOrgCurrency}
                    onChange={(e) => setEditOrgCurrency(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden font-semibold"
                  >
                    {SUPPORTED_CURRENCIES.map(c => (
                      <option key={c.code} value={c.code}>{c.nameAr} ({c.code})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">الميزانية التقديرية</label>
                <input
                  type="text"
                  inputMode="numeric"
                  onKeyDown={handleNumericKeyDown}
                  value={editOrgBudget}
                  onChange={(e) => setEditOrgBudget(sanitizeDigitsOnly(e.target.value))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-mono text-slate-800 outline-hidden"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">الوصف والنشاط</label>
                <textarea
                  rows={2}
                  value={editOrgDescription}
                  onChange={(e) => setEditOrgDescription(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden resize-none"
                ></textarea>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingOrg(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs"
                >
                  حفظ التعديلات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Delete Organization Modal */}
      {deletingOrg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full shadow-2xl p-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150 text-center">
            <div className="h-12 w-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-3">
              <Trash2 className="h-6 w-6" />
            </div>
            <h3 className="font-bold text-slate-900 text-sm">حذف الشركة نهائياً</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              هل أنت متأكد من رغبتك في حذف شركة <strong>"{deletingOrg.name}"</strong>؟
            </p>

            <div className="flex justify-center gap-2 mt-5">
              <button
                type="button"
                onClick={() => setDeletingOrg(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={deleteOrgLoading}
                onClick={handleConfirmDeleteOrg}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs"
              >
                {deleteOrgLoading ? 'جاري الحذف...' : 'نعم، حذف الشركة'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Provision User Modal */}
      {isProvisionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl p-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-indigo-600" />
                <span>تعيين موظف جديد وإنشاء حسابه</span>
              </h3>
              <button onClick={() => setIsProvisionModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            {createdCredentials ? (
              <div className="mt-4 space-y-3 text-center">
                <div className="h-12 w-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                  <Check className="h-6 w-6" />
                </div>
                <h4 className="font-bold text-slate-900 text-sm">تم إنشاء حساب الموظف بنجاح!</h4>
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 text-right space-y-1.5 text-xs">
                  <div><strong>الاسم:</strong> {createdCredentials.name}</div>
                  <div><strong>البريد:</strong> <span className="font-mono">{createdCredentials.email}</span></div>
                  <div><strong>كلمة المرور:</strong> <span className="font-mono bg-amber-50 text-amber-900 px-1.5 py-0.5 rounded font-bold">{createdCredentials.password}</span></div>
                  <div><strong>الشركة:</strong> {createdCredentials.orgName}</div>
                </div>

                <div className="flex gap-2 justify-center pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(`بيانات دخول منصة المصروفات:\nالبريد: ${createdCredentials.email}\nكلمة المرور: ${createdCredentials.password}`);
                      setCopiedLink(true);
                      setTimeout(() => setCopiedLink(false), 2000);
                    }}
                    className="px-4 py-2 bg-slate-900 text-white font-bold text-xs rounded-xl flex items-center gap-1.5"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>{copiedLink ? 'تم النسخ!' : 'نسخ بيانات الدخول'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreatedCredentials(null);
                      setIsProvisionModalOpen(false);
                    }}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
                  >
                    إغلاق
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleProvisionSubmit} className="mt-4 space-y-3 text-xs">
                {provisionError && (
                  <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2.5 rounded-xl text-xs flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{provisionError}</span>
                  </div>
                )}

                {canManageOrgs && (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">الشركة أو المؤسسة التابع لها *</label>
                    <select
                      value={selectedOrgForMember}
                      onChange={(e) => setSelectedOrgForMember(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden font-semibold"
                    >
                      {displayOrgs.map(o => (
                        <option key={o.id} value={o.id}>{o.name} ({o.code})</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block font-bold text-slate-700 mb-1">اسم الموظف بالكامل *</label>
                  <input
                    type="text"
                    required
                    value={memberName}
                    onChange={(e) => setMemberName(e.target.value)}
                    placeholder="مثال: أحمد محمود"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">البريد الإلكتروني *</label>
                    <input
                      type="email"
                      required
                      value={memberEmail}
                      onChange={(e) => setMemberEmail(e.target.value)}
                      placeholder="user@company.com"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">كلمة المرور *</label>
                    <input
                      type="text"
                      required
                      value={memberPassword}
                      onChange={(e) => setMemberPassword(e.target.value)}
                      placeholder="123456"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">رقم الهاتف</label>
                    <input
                      type="tel"
                      value={memberPhone}
                      onChange={(e) => setMemberPhone(sanitizePhone(e.target.value))}
                      placeholder="+201012345678"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">الدور الوظيفي *</label>
                    <select
                      value={memberRole}
                      onChange={(e) => setMemberRole(e.target.value as Role)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden font-semibold"
                    >
                      <option value="employee">موظف (Employee)</option>
                      <option value="finance">مسؤول الصرف والخزينة (Finance / Disburser)</option>
                      <option value="org_admin">مدير مؤسسة (Admin)</option>
                      <option value="data_entry">مدخل بيانات (Data Entry)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">المسمى الوظيفي</label>
                    <input
                      type="text"
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                      placeholder="مثال: مسؤول مبيعات"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">القسم / الإدارة</label>
                    <input
                      type="text"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      placeholder="مثال: المالية"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsProvisionModalOpen(false)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={provisionLoading}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs"
                  >
                    {provisionLoading ? 'جاري الإنشاء...' : 'حفظ وإنشاء الحساب'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* 5. Edit Member Modal */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl p-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Edit className="h-4 w-4 text-indigo-600" />
                <span>تعديل وإعادة تسمية الموظف ({editingMember.userName})</span>
              </h3>
              <button onClick={() => setEditingMember(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditMember} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم الموظف *</label>
                <input
                  type="text"
                  required
                  value={editMemberName}
                  onChange={(e) => setEditMemberName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">رقم الهاتف</label>
                  <input
                    type="tel"
                    value={editMemberPhone}
                    onChange={(e) => setEditMemberPhone(sanitizePhone(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">الدور الوظيفي</label>
                  <select
                    value={editMemberRole}
                    onChange={(e) => setEditMemberRole(e.target.value as Role)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden font-semibold"
                  >
                    <option value="employee">موظف (Employee)</option>
                    <option value="finance">مسؤول الصرف والخزينة (Finance / Disburser)</option>
                    <option value="org_admin">مدير مؤسسة (Admin)</option>
                    <option value="data_entry">مدخل بيانات (Data Entry)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">المسمى الوظيفي</label>
                  <input
                    type="text"
                    value={editMemberJob}
                    onChange={(e) => setEditMemberJob(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">القسم / الإدارة</label>
                  <input
                    type="text"
                    value={editMemberDept}
                    onChange={(e) => setEditMemberDept(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden"
                  />
                </div>
              </div>

              {canManageOrgs && (
                <div>
                  <label className="block font-bold text-slate-700 mb-1">نقل إلى شركة أخرى</label>
                  <select
                    value={editMemberOrgId}
                    onChange={(e) => setEditMemberOrgId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden font-semibold"
                  >
                    {displayOrgs.map(o => (
                      <option key={o.id} value={o.id}>{o.name} ({o.code})</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editMemberActive}
                    onChange={(e) => setEditMemberActive(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="font-bold text-slate-700">الحساب نشط ويحق له تسجيل الدخول</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingMember(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={editMemberLoading}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs"
                >
                  {editMemberLoading ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. Delete Member Modal */}
      {deletingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full shadow-2xl p-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150 text-center">
            <div className="h-12 w-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-3">
              <Trash2 className="h-6 w-6" />
            </div>
            <h3 className="font-bold text-slate-900 text-sm">حذف حساب الموظف</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              هل أنت متأكد من رغبتك في حذف <strong>"{deletingMember.userName}"</strong> ({deletingMember.userEmail}) من النظام نهائياً؟
            </p>

            <div className="flex justify-center gap-2 mt-5">
              <button
                type="button"
                onClick={() => setDeletingMember(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteMember}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs"
              >
                نعم، حذف الحساب
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Service Modal (Add / Edit) */}
      {isServiceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl p-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Layers className="h-4 w-4 text-teal-600" />
                <span>{editingService ? `تعديل وإعادة تسمية البند (${editingService.name})` : 'إضافة بند صرف وتكلفة جديد'}</span>
              </h3>
              <button onClick={() => setIsServiceModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveService} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم بند الصرف *</label>
                <input
                  type="text"
                  required
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                  placeholder="مثال: خدمات سحابية واستضافة"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">الرمز المحاسبي</label>
                  <input
                    type="text"
                    value={serviceCode}
                    onChange={(e) => setServiceCode(sanitizeCode(e.target.value, 8))}
                    placeholder="SRV-101"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-mono uppercase text-slate-800 outline-hidden"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">سقف الميزانية التقديرية</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    onKeyDown={handleNumericKeyDown}
                    value={serviceBudget}
                    onChange={(e) => setServiceBudget(sanitizeDigitsOnly(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-mono text-slate-800 outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">الوصف</label>
                <textarea
                  rows={2}
                  value={serviceDescription}
                  onChange={(e) => setServiceDescription(e.target.value)}
                  placeholder="ملاحظات وتفاصيل هذا البند..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden resize-none"
                ></textarea>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsServiceModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs"
                >
                  حفظ البند
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 8. Delete Service Modal */}
      {deletingService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full shadow-2xl p-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150 text-center">
            <div className="h-12 w-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-3">
              <Trash2 className="h-6 w-6" />
            </div>
            <h3 className="font-bold text-slate-900 text-sm">حذف بند الصرف</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              هل أنت متأكد من حذف البند <strong>"{deletingService.name}"</strong>؟
            </p>

            <div className="flex justify-center gap-2 mt-5">
              <button
                type="button"
                onClick={() => setDeletingService(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteService}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs"
              >
                نعم، حذف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. Vendor Modal (Add / Edit) */}
      {isVendorModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl p-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Truck className="h-4 w-4 text-sky-600" />
                <span>{editingVendor ? `تعديل وتسمية المورد (${editingVendor.name})` : 'تسجيل مورد جديد'}</span>
              </h3>
              <button onClick={() => setIsVendorModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveVendor} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم المورد / الشركة *</label>
                <input
                  type="text"
                  required
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  placeholder="مثال: شركة أمازون ويب سيرفسز"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">مسؤول الاتصال</label>
                  <input
                    type="text"
                    value={vendorContact}
                    onChange={(e) => setVendorContact(e.target.value)}
                    placeholder="الاسم"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">رقم الهاتف</label>
                  <input
                    type="tel"
                    value={vendorPhone}
                    onChange={(e) => setVendorPhone(sanitizePhone(e.target.value))}
                    placeholder="+201..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">الرقم الضريبي</label>
                  <input
                    type="text"
                    value={vendorTaxNumber}
                    onChange={(e) => setVendorTaxNumber(sanitizeTaxOrCR(e.target.value))}
                    placeholder="300..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">السجل التجاري</label>
                  <input
                    type="text"
                    value={vendorCrNumber}
                    onChange={(e) => setVendorCrNumber(sanitizeTaxOrCR(e.target.value))}
                    placeholder="101..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">اسم البنك</label>
                  <input
                    type="text"
                    value={vendorBankName}
                    onChange={(e) => setVendorBankName(e.target.value)}
                    placeholder="CIB / الأهلي"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">الآيبان (IBAN)</label>
                  <input
                    type="text"
                    value={vendorIban}
                    onChange={(e) => setVendorIban(sanitizeIBAN(e.target.value))}
                    placeholder="EG..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden font-mono uppercase"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsVendorModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs rounded-xl shadow-xs"
                >
                  حفظ المورد
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 10. Delete Vendor Modal */}
      {deletingVendor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full shadow-2xl p-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150 text-center">
            <div className="h-12 w-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-3">
              <Trash2 className="h-6 w-6" />
            </div>
            <h3 className="font-bold text-slate-900 text-sm">حذف المورد</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              هل أنت متأكد من حذف المورد <strong>"{deletingVendor.name}"</strong>؟
            </p>

            <div className="flex justify-center gap-2 mt-5">
              <button
                type="button"
                onClick={() => setDeletingVendor(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteVendor}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs"
              >
                نعم، حذف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 11. Vault Modal (Add / Edit) */}
      {isVaultModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl p-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Wallet className="h-4 w-4 text-amber-600" />
                <span>{editingVault ? `تعديل وإعادة تسمية الخزينة (${editingVault.name})` : 'إضافة خزينة / حساب دفع جديد'}</span>
              </h3>
              <button onClick={() => setIsVaultModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveVault} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم الخزينة أو الحساب *</label>
                <input
                  type="text"
                  required
                  value={vaultName}
                  onChange={(e) => setVaultName(e.target.value)}
                  placeholder="مثال: حساب CIB الرئيسي أو إنستاباي الإدارة"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">نوع الحساب / الخزينة</label>
                  <select
                    value={vaultType}
                    onChange={(e) => setVaultType(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden font-semibold"
                  >
                    <option value="bank">حساب بنكي</option>
                    <option value="instapay">حساب إنستاباي (InstaPay)</option>
                    <option value="cash">خزينة نقدية (Petty Cash)</option>
                    <option value="wallet">محفظة إلكترونية</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">العملة</label>
                  <select
                    value={vaultCurrency}
                    onChange={(e) => setVaultCurrency(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden font-semibold"
                  >
                    {SUPPORTED_CURRENCIES.map(c => (
                      <option key={c.code} value={c.code}>{c.nameAr} ({c.code})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">معرف الحساب / الآيبان / IPA *</label>
                <input
                  type="text"
                  required
                  value={vaultIdentifier}
                  onChange={(e) => setVaultIdentifier(e.target.value)}
                  placeholder="مثال: company@instapay أو EG38..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم البنك / جهة الصرف</label>
                <input
                  type="text"
                  value={vaultBankName}
                  onChange={(e) => setVaultBankName(e.target.value)}
                  placeholder="مثال: البنك التجاري الدولي"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsVaultModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs"
                >
                  حفظ الخزينة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 12. Delete Vault Modal */}
      {deletingVault && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full shadow-2xl p-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150 text-center">
            <div className="h-12 w-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-3">
              <Trash2 className="h-6 w-6" />
            </div>
            <h3 className="font-bold text-slate-900 text-sm">حذف خزينة / وسيلة الدفع</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              هل أنت متأكد من حذف الحساب <strong>"{deletingVault.name}"</strong>؟
            </p>

            <div className="flex justify-center gap-2 mt-5">
              <button
                type="button"
                onClick={() => setDeletingVault(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteVault}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs"
              >
                نعم، حذف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 13. Department Modal (Add / Edit) */}
      {isDeptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl p-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <FolderTree className="h-4 w-4 text-purple-600" />
                <span>{editingDept ? `تعديل وإعادة تسمية القسم (${editingDept.name})` : 'إضافة قسم إداري جديد'}</span>
              </h3>
              <button onClick={() => setIsDeptModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveDept} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم القسم / الإدارة *</label>
                <input
                  type="text"
                  required
                  value={deptName}
                  onChange={(e) => setDeptName(e.target.value)}
                  placeholder="مثال: الإدارة المالية والمحاسبة"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">رمز القسم</label>
                  <input
                    type="text"
                    value={deptCode}
                    onChange={(e) => setDeptCode(sanitizeCode(e.target.value, 6))}
                    placeholder="DEP-01"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-mono uppercase text-slate-800 outline-hidden"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">مسؤول / مدير القسم</label>
                  <input
                    type="text"
                    value={deptManager}
                    onChange={(e) => setDeptManager(e.target.value)}
                    placeholder="الاسم"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">الوصف</label>
                <textarea
                  rows={2}
                  value={deptDescription}
                  onChange={(e) => setDeptDescription(e.target.value)}
                  placeholder="مهام واختصاصات هذا القسم..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden resize-none"
                ></textarea>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsDeptModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl shadow-xs"
                >
                  حفظ القسم
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 14. Delete Department Modal */}
      {deletingDept && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full shadow-2xl p-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150 text-center">
            <div className="h-12 w-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-3">
              <Trash2 className="h-6 w-6" />
            </div>
            <h3 className="font-bold text-slate-900 text-sm">حذف القسم الإداري</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              هل أنت متأكد من حذف قسم <strong>"{deletingDept.name}"</strong>؟
            </p>

            <div className="flex justify-center gap-2 mt-5">
              <button
                type="button"
                onClick={() => setDeletingDept(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteDept}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs"
              >
                نعم، حذف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 15. Super Admin Management Modal (Dedicated Popup) */}
      {isSuperAdminModalOpen && isSuperAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl p-6 border border-slate-100 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Crown className="h-4 w-4 text-amber-600" />
                <span>إدارة حسابات السوبر أدمن (Super Admins) 👑</span>
              </h3>
              <button 
                onClick={() => setIsSuperAdminModalOpen(false)} 
                className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <form onSubmit={handleAddAdmin} className="space-y-2">
                <label className="block font-bold text-slate-700">إضافة بريد سوبر أدمن جديد للمنصة:</label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    required
                    value={newAdminEmail}
                    onChange={(e) => setNewAdminEmail(e.target.value)}
                    placeholder="admin@domain.com"
                    className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-800 outline-hidden focus:border-amber-500"
                  />
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-xs transition cursor-pointer"
                  >
                    إضافة
                  </button>
                </div>
                {adminSuccessMsg && <p className="text-xs text-emerald-700 font-bold mt-1">{adminSuccessMsg}</p>}
                {adminErrorMsg && <p className="text-xs text-rose-700 font-bold mt-1">{adminErrorMsg}</p>}
              </form>

              {superAdminActionFeedback && (
                <div className={`p-3 rounded-xl text-xs font-bold ${
                  superAdminActionFeedback.isError ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                }`}>
                  {superAdminActionFeedback.msg}
                </div>
              )}

              <div>
                <h4 className="font-bold text-slate-700 mb-2">قائمة السوبر أدمن المعتمدين حالياً:</h4>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {superAdminEmails.map((email) => {
                    const isRootAdmin = email === 'mahmoud@tieapps.com';
                    return (
                      <div 
                        key={email} 
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-amber-50/50 rounded-xl border border-amber-200/60 text-xs gap-2"
                      >
                        <div className="flex items-center gap-2.5">
                          <Crown className="h-4 w-4 text-amber-600 shrink-0" />
                          <span className="font-mono font-bold text-slate-900 truncate max-w-[200px]">{email}</span>
                          <span className="bg-amber-100 text-amber-900 font-bold text-[10px] px-2 py-0.5 rounded-full shrink-0">
                            نشط
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 justify-end">
                          <button
                            type="button"
                            onClick={() => handleOpenEditSuperAdminRole(email)}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg font-bold text-[11px] transition cursor-pointer"
                            title="تعديل الصلاحية والدور"
                          >
                            <Edit className="h-3 w-3" />
                            <span>تعديل الدور</span>
                          </button>

                          {!isRootAdmin ? (
                            <button
                              type="button"
                              onClick={() => handleRemoveSuperAdmin(email)}
                              disabled={superAdminActionLoading}
                              className="flex items-center gap-1 px-2 py-1.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded-lg font-bold text-[11px] transition cursor-pointer disabled:opacity-50"
                              title="إزالة من السوبر أدمن"
                            >
                              <Trash2 className="h-3 w-3" />
                              <span>إزالة</span>
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-400 font-semibold px-2 py-1 bg-slate-100/70 rounded-lg">
                              أساسي
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 16. Super Admin Edit Role Modal */}
      {editingSuperAdminEmail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 animate-in fade-in zoom-in-95 duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl p-6 border border-slate-100 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-indigo-600" />
                <span>تعديل رتبة وصلاحيات المشرف</span>
              </h3>
              <button 
                onClick={() => setEditingSuperAdminEmail(null)} 
                className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSuperAdminRole} className="mt-4 space-y-4">
              <div>
                <label className="block font-bold text-slate-500 mb-1">البريد الإلكتروني:</label>
                <div className="p-2.5 bg-slate-100 rounded-xl font-mono text-slate-800 font-bold">
                  {editingSuperAdminEmail}
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">الدور والصلاحية الجديدة:</label>
                <select
                  value={targetSuperAdminRole}
                  onChange={(e) => setTargetSuperAdminRole(e.target.value as Role)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs"
                >
                  <option value="super_admin">🛡️ سوبر أدمن المنصة (Super Admin)</option>
                  <option value="org_admin">🏢 مدير شركة (Company Admin)</option>
                  <option value="finance">💸 مسؤول الصرف والخزينة (Finance)</option>
                  <option value="data_entry">✍️ مدخل بيانات (Data Entry)</option>
                  <option value="employee">👤 موظف (Employee)</option>
                </select>
              </div>

              {targetSuperAdminRole !== 'super_admin' && (
                <div>
                  <label className="block font-bold text-slate-700 mb-1">تعيين في شركة:</label>
                  <select
                    value={targetSuperAdminOrgId}
                    onChange={(e) => setTargetSuperAdminOrgId(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs"
                  >
                    {displayOrgs.map(o => (
                      <option key={o.id} value={o.id}>{o.name} ({o.code})</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingSuperAdminEmail(null)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-bold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={superAdminActionLoading}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {superAdminActionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span>حفظ وتطبيق الدور</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
