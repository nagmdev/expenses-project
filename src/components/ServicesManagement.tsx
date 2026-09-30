import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { isArchivedOrg } from '../domain/common';
import { ServiceCategory, isServiceMatchingOrg, BudgetPeriod, RecurringFrequency, PaymentMethod } from '../types';
import {
  Layers,
  Plus,
  Edit3,
  Trash2,
  X,
  Truck,
  Building2,
  DollarSign,
  Calendar,
  Clock,
  Hash,
  MapPin,
  Tag,
  CreditCard,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Lock,
} from 'lucide-react';

import { sanitizeDigitsOnly, sanitizeCode, handleNumericKeyDown } from '../utils/validation';
import { useSubmitGuard, useKeyedSubmitGuard } from '../hooks/useSubmitGuard';
import { can } from '../utils/permissions';
import { fmtMoney } from '../utils/requestUi';
import { OrgMultiSelect } from './OrgMultiSelect';

const budgetPeriodLabels: Record<string, string> = {
  monthly: 'شهرياً',
  yearly: 'سنوياً',
  per_request: 'لكل طلب صرف',
  unlimited: 'سقف مفتوح',
};

const recurringFrequencyLabels: Record<string, string> = {
  on_demand: 'عند الطلب / طارئ',
  monthly: 'دوري شهرياً',
  quarterly: 'ربع سنوي',
  yearly: 'سنوي',
};

const paymentMethodLabels: Record<string, string> = {
  cash: 'نقداً / خزينة',
  instapay: 'إنستاباي',
  digital_wallet: 'محفظة إلكترونية',
  bank_transfer: 'تحويل بنكي',
  cheque: 'شيك مصرفي',
};

/** A deactivated record stays for history (policy: services in use are never hard-deleted). */
const isDeactivated = (entity: object) => (entity as { active?: unknown }).active === false;

const OWNER_ORG_REASON = 'الشركة المالكة للبند';

export const ServicesManagement: React.FC = () => {
  const {
    services,
    allServices,
    providers,
    allProviders,
    paymentAccounts,
    allPaymentAccounts,
    allRequests,
    allCustodySettlements,
    activeOrgId,
    activeOrg,
    organizations,
    allOrganizations,
    currentRole,
    addService,
    updateService,
    deleteService
  } = useApp();

  const isSuperAdmin = currentRole === 'super_admin';
  const orgList = isSuperAdmin ? allOrganizations : organizations;
  const targetServices = isSuperAdmin ? allServices : services;
  const targetVendors = isSuperAdmin ? allProviders : providers;
  const targetVaults = isSuperAdmin ? allPaymentAccounts : paymentAccounts;
  // New links only to active companies (an archived one refuses the whole operation).
  const creatableOrgs = useMemo(() => orgList.filter(o => !o.archived && o.status !== 'archived'), [orgList]);

  // Actions are shown only to the roles the domain and the rules accept (src/utils/permissions.ts).
  const canCreate = can(currentRole, 'createServices');
  const canEdit = can(currentRole, 'editServices');
  const canDelete = can(currentRole, 'deleteServices');
  // The rules check the role in the service's OWN company: a service another company shares
  // with this one is read-only here.
  const ownsService = (srv: ServiceCategory) => isSuperAdmin || srv.orgId === activeOrgId;

  // A service used by a request or a custody settlement, already spent on, or shared with other
  // companies is deactivated instead of deleted: the context decides and reports it; this
  // preview (same checks) only words the confirmation.
  const serviceUsage = (srv: ServiceCategory) => {
    const requestCount = allRequests.filter(r => r.serviceCategoryId === srv.id).length;
    const settlementCount = allCustodySettlements.filter(s => s.serviceCategoryId === srv.id).length;
    const spent = Number(srv.spentAmount || 0) !== 0;
    const shared = (srv.orgIds || []).some(orgId => orgId !== srv.orgId);
    return {
      requests: requestCount,
      settlements: settlementCount,
      spent,
      shared,
      inUse: requestCount + settlementCount > 0 || spent || shared,
    };
  };

  const [selectedOrgFilter, setSelectedOrgFilter] = useState<string>(
    activeOrgId && activeOrgId !== 'all' ? activeOrgId : 'all'
  );

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<ServiceCategory | null>(null);
  const saveGuard = useSubmitGuard();
  const serviceActions = useKeyedSubmitGuard();
  const [formError, setFormError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; tone: 'success' | 'warning' | 'error' } | null>(null);
  // Delete asks for confirmation first; an in-use service is deactivated instead.
  const [deletingService, setDeletingService] = useState<ServiceCategory | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 9000);
    return () => clearTimeout(timer);
  }, [feedback]);

  // Form State
  const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [budgetLimit, setBudgetLimit] = useState('');
  const [budgetPeriod, setBudgetPeriod] = useState<BudgetPeriod>('monthly');
  const [recurringFrequency, setRecurringFrequency] = useState<RecurringFrequency>('monthly');
  const [fixedAccountRef, setFixedAccountRef] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [serviceNature, setServiceNature] = useState('');
  const [defaultPaymentMethod, setDefaultPaymentMethod] = useState<PaymentMethod | ''>('');
  const [defaultAccountId, setDefaultAccountId] = useState('');
  const [costCenter, setCostCenter] = useState('');
  const [color, setColor] = useState('#10b981');

  const orgServices = targetServices.filter(s => selectedOrgFilter === 'all' || isServiceMatchingOrg(s, selectedOrgFilter));

  // Edit: the owning company always stays linked (the service document belongs to it).
  const ownerLock = useMemo<Record<string, string>>(
    () => (editingService?.orgId ? { [editingService.orgId]: OWNER_ORG_REASON } : {}),
    [editingService]
  );
  const formOrgIds = Array.from(new Set([...(editingService?.orgId ? [editingService.orgId] : []), ...selectedOrgIds]));
  const formHasListedOrg = formOrgIds.some(id => creatableOrgs.some(o => o.id === id)) || Boolean(editingService);
  // Offered for a new link: active providers / accounts of the service's own (active) companies —
  // a provider added to several companies is one record per company, so each company's copy is
  // listed only while that company is selected. The current link always stays listed.
  const linkableOrgIds = formOrgIds.filter(id => !orgList.some(o => o.id === id && isArchivedOrg(o)));
  const vendorOptions = targetVendors.filter(v =>
    v.id === editingService?.vendorId || (linkableOrgIds.includes(v.orgId) && !isDeactivated(v))
  );
  const accountOptions = targetVaults.filter(a =>
    a.id === editingService?.defaultAccountId || (linkableOrgIds.includes(a.orgId) && a.active !== false)
  );
  // With several companies selected, each option names its company (same-name copies stay apart).
  const optionOrgSuffix = (orgId: string) =>
    formOrgIds.length > 1 ? ` — ${orgList.find(o => o.id === orgId)?.name || orgId}` : '';

  const handleOpenAdd = () => {
    if (!canCreate) return;
    setName('');
    setCode(`SRV-${Math.floor(100 + Math.random() * 900)}`);
    setDescription('');
    setBudgetLimit('');
    setBudgetPeriod('monthly');
    setRecurringFrequency('monthly');
    setFixedAccountRef('');
    setVendorId('');
    setServiceNature('');
    setDefaultPaymentMethod('');
    setDefaultAccountId('');
    setCostCenter('');
    setColor('#10b981');
    setEditingService(null);
    setFormError(null);
    const isCreatable = (orgId?: string) => Boolean(orgId && orgId !== 'all' && creatableOrgs.some(o => o.id === orgId));
    const defaultOrg = isCreatable(selectedOrgFilter)
      ? selectedOrgFilter
      : isCreatable(activeOrgId)
      ? activeOrgId
      : (creatableOrgs[0]?.id || '');
    setSelectedOrgIds(defaultOrg ? [defaultOrg] : []);
    saveGuard.rotateKey();
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (srv: ServiceCategory) => {
    if (!canEdit || !ownsService(srv)) return;
    setEditingService(srv);
    setName(srv.name);
    setCode(srv.code);
    setDescription(srv.description || '');
    setBudgetLimit(String(srv.budgetLimit ?? ''));
    setBudgetPeriod(srv.budgetPeriod || 'monthly');
    setRecurringFrequency(srv.recurringFrequency || 'monthly');
    setFixedAccountRef(srv.fixedAccountRef || '');
    setVendorId(srv.vendorId || '');
    setServiceNature(srv.serviceNature || '');
    setDefaultPaymentMethod(srv.defaultPaymentMethod || '');
    setDefaultAccountId(srv.defaultAccountId || '');
    setCostCenter(srv.costCenter || '');
    setColor(srv.color || '#10b981');
    setFormError(null);
    setSelectedOrgIds(srv.orgIds && srv.orgIds.length > 0 ? srv.orgIds : (srv.orgId ? [srv.orgId] : []));
    setIsAddModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError('يرجى إدخال اسم الخدمة.');
      return;
    }
    // Create: the first selected active company owns the new service; edit: the owner never changes.
    const orgIds = editingService ? formOrgIds : selectedOrgIds.filter(id => creatableOrgs.some(o => o.id === id));
    const primaryOrgId = editingService ? editingService.orgId : orgIds[0];
    if (!primaryOrgId || orgIds.length === 0) {
      setFormError('يرجى تحديد شركة واحدة على الأقل لربط البند بها.');
      return;
    }
    setFormError(null);

    const finalCode = code.trim().toUpperCase() || (editingService ? editingService.code : `SRV-${Math.floor(100 + Math.random() * 900)}`);
    // Only what the form still offers is saved (a choice whose company was unselected is dropped).
    const chosenVendor = vendorOptions.find(v => v.id === vendorId);
    const vendorName = chosenVendor ? chosenVendor.name : undefined;
    const chosenAccountId = accountOptions.some(a => a.id === defaultAccountId) ? defaultAccountId : '';
    const details = {
      name: trimmedName,
      code: finalCode,
      description: description.trim(),
      budgetLimit: Number(budgetLimit) || 0,
      budgetPeriod,
      recurringFrequency,
      fixedAccountRef: fixedAccountRef.trim() || undefined,
      vendorId: chosenVendor ? chosenVendor.id : undefined,
      vendorName,
      serviceNature: serviceNature.trim() || undefined,
      defaultPaymentMethod: (defaultPaymentMethod as PaymentMethod) || undefined,
      defaultAccountId: chosenAccountId || undefined,
      costCenter: costCenter.trim() || undefined,
      color,
      orgId: primaryOrgId,
      orgIds,
    };

    await saveGuard.run(async (idempotencyKey) => {
      try {
        if (editingService) {
          await updateService({ ...editingService, ...details });
          setFeedback({ message: `تم حفظ تعديلات الخدمة "${trimmedName}".`, tone: 'success' });
        } else {
          await addService({ ...details, iconName: 'Layers' }, { idempotencyKey });
          saveGuard.rotateKey();
          setFeedback({ message: `تمت إضافة الخدمة "${trimmedName}".`, tone: 'success' });
        }
        setIsAddModalOpen(false);
      } catch (err: any) {
        setFormError(err?.message || 'تعذر حفظ الخدمة');
      }
    });
  };

  const openDeleteDialog = (srv: ServiceCategory) => {
    if (!canDelete || !ownsService(srv)) return;
    setDeleteError(null);
    setDeletingService(srv);
  };

  const handleConfirmDelete = async () => {
    const target = deletingService;
    if (!target || !canDelete) return;
    setDeleteError(null);
    await serviceActions.run(`delete:${target.id}`, async () => {
      try {
        // The context deactivates (never deletes) a service in use and says which happened.
        const removal = await deleteService(target.id);
        setDeletingService(null);
        setFeedback(removal === 'deactivated'
          ? { message: `الخدمة "${target.name}" مرتبطة بطلبات صرف أو تسويات عهد أو مصروفات سابقة أو بشركات أخرى، لذلك تم تعطيلها بدلاً من حذفها وتبقى في السجلات السابقة.`, tone: 'warning' }
          : { message: `تم حذف الخدمة "${target.name}" نهائياً.`, tone: 'success' });
      } catch (err: any) {
        setDeleteError(err?.message || 'تعذر حذف الخدمة');
      }
    });
  };

  const handleReactivate = async (srv: ServiceCategory) => {
    if (!canEdit || !canDelete || !ownsService(srv)) return; // reactivation undoes the admin's deactivation
    await serviceActions.run(`reactivate:${srv.id}`, async () => {
      try {
        await updateService({ ...srv, active: true });
        setFeedback({ message: `تمت إعادة تفعيل الخدمة "${srv.name}".`, tone: 'success' });
      } catch (err: any) {
        setFeedback({ message: err?.message || 'تعذر إعادة تفعيل الخدمة', tone: 'error' });
      }
    });
  };

  const deletingUsage = deletingService ? serviceUsage(deletingService) : null;
  const deletingInUse = Boolean(deletingUsage?.inUse);
  const isDeletePending = Boolean(deletingService) && serviceActions.isPending(`delete:${deletingService!.id}`);

  return (
    <div className="space-y-6 pb-12">

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">دليل الخدمات وبنود المصروفات</h1>
            <span className="text-xs bg-slate-100 text-slate-700 font-semibold px-2.5 py-0.5 rounded-full border border-slate-200">
              {orgServices.length} بند معتمد
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {canCreate || canEdit
              ? 'تعريف الخدمات والمراكز التكليفية وتحديد سقف الميزانية التقديرية لكل خدمة وربطها بالشركة'
              : 'بنود الخدمات ومراكز التكلفة المعتمدة في الشركة وسقف الميزانية لكل بند (للاطلاع فقط)'}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {orgList.length > 1 && (
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-slate-400" />
              <select
                value={selectedOrgFilter}
                onChange={(e) => setSelectedOrgFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 font-semibold outline-hidden cursor-pointer"
              >
                <option value="all">كل الشركات ({orgList.length})</option>
                {orgList.map(o => (
                  <option key={o.id} value={o.id}>{o.name} ({o.code})</option>
                ))}
              </select>
            </div>
          )}

          {canCreate && (
            <button
              type="button"
              onClick={handleOpenAdd}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-xs transition cursor-pointer self-start sm:self-auto"
            >
              <Plus className="h-4 w-4" />
              <span>إضافة خدمة جديدة</span>
            </button>
          )}
        </div>
      </div>

      {/* Save / delete feedback (deactivated instead of deleted, errors) */}
      {feedback && (
        <div
          role="status"
          className={`p-3.5 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 animate-in fade-in duration-150 ${
            feedback.tone === 'error'
              ? 'bg-rose-50 border border-rose-200 text-rose-800'
              : feedback.tone === 'warning'
              ? 'bg-amber-50 border border-amber-200 text-amber-900'
              : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
          }`}
        >
          <span>{feedback.message}</span>
          <button type="button" onClick={() => setFeedback(null)} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer shrink-0" title="إغلاق">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {orgServices.map((srv) => {
          const spent = srv.spentAmount || 0;
          const budget = srv.budgetLimit || 0;
          const percent = budget > 0
            ? Math.round((spent / budget) * 100)
            : 0;
          const progressWidth = Math.min(100, Math.max(0, percent));
          const parentOrg = orgList.find(o => o.id === srv.orgId);
          const currency = parentOrg?.currency || activeOrg?.currency || 'EGP';
          const deactivated = isDeactivated(srv);
          const owned = ownsService(srv);
          const showEdit = canEdit && owned;
          const showDelete = canDelete && owned && !deactivated;

          let budgetStatus: 'safe' | 'warning' | 'danger' = 'safe';
          let barColor = 'bg-emerald-500';
          if (budget > 0) {
            if (percent >= 100) {
              budgetStatus = 'danger';
              barColor = 'bg-rose-500';
            } else if (percent >= 80) {
              budgetStatus = 'warning';
              barColor = 'bg-amber-500';
            } else {
              budgetStatus = 'safe';
              barColor = 'bg-emerald-500';
            }
          }

          const vendor = targetVendors.find(v => v.id === srv.vendorId);
          const assignedVendorName = srv.vendorName || vendor?.name;

          return (
            <div
              key={srv.id}
              className={`bg-white rounded-2xl border p-5 shadow-xs hover:border-slate-300 transition flex flex-col justify-between ${
                deactivated ? 'border-slate-200 opacity-75' : 'border-slate-200/80'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="h-10 w-10 rounded-xl flex items-center justify-center text-white shadow-xs font-bold text-sm"
                      style={{ backgroundColor: srv.color }}
                    >
                      <Layers className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="font-bold text-slate-900 text-sm">{srv.name}</h3>
                        {deactivated && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200">معطل</span>
                        )}
                      </div>
                      <span className="font-mono text-[10px] text-slate-400">{srv.code}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {showEdit && canDelete && deactivated && (
                      <button
                        type="button"
                        onClick={() => handleReactivate(srv)}
                        disabled={serviceActions.isPending(`reactivate:${srv.id}`)}
                        className="p-1.5 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition cursor-pointer disabled:opacity-50"
                        title="إعادة تفعيل الخدمة"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {showEdit && (
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(srv)}
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                        title="تعديل الخدمة"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {showDelete && (
                      <button
                        type="button"
                        onClick={() => openDeleteDialog(srv)}
                        disabled={serviceActions.isPending(`delete:${srv.id}`)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer disabled:opacity-50"
                        title="حذف الخدمة"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {!owned && (canEdit || canDelete) && (
                      <span
                        className="p-1.5 text-slate-300"
                        title="بند مشترك تديره شركة أخرى: التعديل والحذف من الشركة المالكة فقط"
                      >
                        <Lock className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                </div>

                {/* Company connection badge (Multi-Company Support) */}
                <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                  {(() => {
                    const linkedOrgIds = srv.orgIds && srv.orgIds.length > 0 ? srv.orgIds : (srv.orgId ? [srv.orgId] : []);
                    const matchingOrgs = orgList.filter(o => linkedOrgIds.includes(o.id));
                    if (orgList.length > 1 && matchingOrgs.length >= orgList.length) {
                      return (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-purple-50 text-purple-800 border border-purple-200/80">
                          <Building2 className="h-3 w-3 text-purple-600" />
                          <span>🌐 متاح لجميع الشركات ({matchingOrgs.length})</span>
                        </span>
                      );
                    }
                    if (matchingOrgs.length === 0) {
                      return (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-slate-50 text-slate-500 border border-slate-200/80">
                          <Building2 className="h-3 w-3 text-slate-400" />
                          <span>شركة غير محددة</span>
                        </span>
                      );
                    }
                    return matchingOrgs.map(o => (
                      <span key={o.id} className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200/80">
                        <Building2 className="h-3 w-3 text-emerald-600" />
                        <span>{o.name}</span>
                      </span>
                    ));
                  })()}
                  {!owned && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg bg-slate-50 text-slate-600 border border-slate-200">
                      بند مشترك من شركة أخرى
                    </span>
                  )}
                </div>

                {/* Service Metadata Badges */}
                <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                  {srv.fixedAccountRef && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-sky-50 text-sky-800 border border-sky-200/80" title="رقم العداد / كود المشترك / رقم الاشتراك الثابت">
                      <Hash className="h-3 w-3 text-sky-600" />
                      <span>{srv.fixedAccountRef}</span>
                    </span>
                  )}

                  {assignedVendorName && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200/80" title="المورد / مقدم الخدمة المعتمد">
                      <Truck className="h-3 w-3 text-blue-600" />
                      <span>{assignedVendorName}</span>
                    </span>
                  )}

                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200/80" title="دورية سقف الميزانية">
                    <Calendar className="h-3 w-3 text-amber-600" />
                    <span>{budgetPeriodLabels[srv.budgetPeriod || 'monthly']}</span>
                  </span>

                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 border border-indigo-200/80" title="دورية الاستحقاق والتكرار">
                    <Clock className="h-3 w-3 text-indigo-600" />
                    <span>{recurringFrequencyLabels[srv.recurringFrequency || 'monthly']}</span>
                  </span>

                  {srv.costCenter && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-teal-50 text-teal-800 border border-teal-200/80" title="مركز التكلفة / الفرع">
                      <MapPin className="h-3 w-3 text-teal-600" />
                      <span>{srv.costCenter}</span>
                    </span>
                  )}

                  {srv.serviceNature && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200" title="طبيعة الخدمة">
                      <Tag className="h-3 w-3 text-slate-500" />
                      <span>{srv.serviceNature}</span>
                    </span>
                  )}

                  {srv.defaultPaymentMethod && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-purple-50 text-purple-800 border border-purple-200/80" title="طريقة الدفع الافتراضية">
                      <CreditCard className="h-3 w-3 text-purple-600" />
                      <span>{paymentMethodLabels[srv.defaultPaymentMethod] || srv.defaultPaymentMethod}</span>
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-500 mt-3 line-clamp-2 leading-relaxed">
                  {srv.description || 'لا يوجد وصف تفصيلي لهذه الخدمة.'}
                </p>
              </div>

              {/* Financial Progress & Visual Budget vs Actual */}
              <div className="mt-4 pt-3.5 border-t border-slate-100">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <div className="flex items-center gap-1.5 text-slate-600 font-medium">
                    <span>المصروف الفعلي:</span>
                    <span className="font-black text-slate-900 font-mono">
                      {fmtMoney(spent)} {currency}
                    </span>
                  </div>

                  {budgetStatus === 'danger' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-black animate-pulse">
                      <AlertCircle className="h-3 w-3" />
                      <span>تجاوز الميزانية ({percent}%)</span>
                    </span>
                  )}
                  {budgetStatus === 'warning' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-black">
                      <AlertTriangle className="h-3 w-3" />
                      <span>اقترب من السقف ({percent}%)</span>
                    </span>
                  )}
                  {budgetStatus === 'safe' && budget > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                      <CheckCircle2 className="h-3 w-3" />
                      <span>ضمن الميزانية ({percent}%)</span>
                    </span>
                  )}
                  {budget === 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">
                      <span>سقف غير محدد</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
                  <div className="flex items-center gap-1">
                    <span>سقف الميزانية:</span>
                    <span className="font-bold text-slate-700 font-mono">
                      {budget > 0 ? `${fmtMoney(budget)} ${currency}` : 'سقف مفتوح'}
                    </span>
                    <span className="text-[10px] text-slate-400">({budgetPeriodLabels[srv.budgetPeriod || 'monthly']})</span>
                  </div>
                  {budget > 0 && (
                    <span className="font-mono text-[10px] text-slate-500">
                      المتبقي: {fmtMoney(Math.max(0, budget - spent))} {currency}
                    </span>
                  )}
                </div>

                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden p-0.5">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                    style={{ width: `${progressWidth}%` }}
                  ></div>
                </div>
              </div>
            </div>
          );
        })}
        {orgServices.length === 0 && (
          <div className="col-span-full bg-white rounded-2xl border border-dashed border-slate-200 p-8 text-center">
            <Layers className="h-10 w-10 text-slate-300 mx-auto mb-2" />
            <h3 className="font-bold text-slate-800 text-sm">لا توجد بنود خدمات مسجلة بعد</h3>
            {canCreate ? (
              <>
                <p className="text-xs text-slate-400 mt-1 mb-4">أضف بنود الخدمات ومراكز التكلفة لتحديد ميزانية لكل بند وتتبع المصروفات بدقة</p>
                <button
                  type="button"
                  onClick={handleOpenAdd}
                  className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>إضافة أول بند خدمة الآن</span>
                </button>
              </>
            ) : (
              <p className="text-xs text-slate-400 mt-1">يضيف مدير الشركة بنود الخدمات ومراكز التكلفة المعتمدة.</p>
            )}
          </div>
        )}
      </div>

      {/* Delete confirmation (an in-use service is deactivated, never hard-deleted) */}
      {deletingService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div role="dialog" aria-modal="true" className="bg-white rounded-3xl max-w-sm w-full shadow-2xl p-6 border border-slate-100 text-center">
            <div className={`h-12 w-12 rounded-2xl flex items-center justify-center mx-auto mb-3 ${deletingInUse ? 'bg-amber-100 text-amber-600' : 'bg-rose-100 text-rose-600'}`}>
              {deletingInUse ? <AlertTriangle className="h-6 w-6" /> : <Trash2 className="h-6 w-6" />}
            </div>
            <h3 className="font-bold text-slate-900 text-sm">{deletingInUse ? 'تعطيل الخدمة' : 'حذف الخدمة'}</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              {deletingInUse ? (
                <>
                  الخدمة <strong>"{deletingService.name}"</strong> مرتبطة بـ{' '}
                  {[
                    deletingUsage!.requests > 0 ? `${deletingUsage!.requests} طلب صرف` : '',
                    deletingUsage!.settlements > 0 ? `${deletingUsage!.settlements} تسوية عهدة` : '',
                    deletingUsage!.spent ? 'مصروفات مسجلة' : '',
                    deletingUsage!.shared ? 'شركات أخرى مشتركة فيها' : '',
                  ].filter(Boolean).join(' و')}
                  ، لذلك لن تُحذف نهائياً بل سيتم تعطيلها وتبقى في السجلات السابقة.
                </>
              ) : (
                <>هل أنت متأكد من حذف الخدمة <strong>"{deletingService.name}"</strong> نهائياً؟ لا يمكن التراجع عن هذا الإجراء.</>
              )}
            </p>
            {deleteError && (
              <div role="alert" className="mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-start gap-2 text-right">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{deleteError}</span>
              </div>
            )}
            <div className="flex justify-center gap-2 mt-5">
              <button
                type="button"
                onClick={() => setDeletingService(null)}
                disabled={isDeletePending}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl cursor-pointer disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeletePending}
                className={`px-5 py-2 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-60 ${
                  deletingInUse ? 'bg-amber-600 hover:bg-amber-700' : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {isDeletePending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{isDeletePending ? 'جارٍ التنفيذ...' : deletingInUse ? 'نعم، تعطيل الخدمة' : 'نعم، حذف'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl p-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150 my-auto max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                  <Layers className="h-4 w-4" />
                </div>
                <div>
                  <span className="block">{editingService ? `تعديل بند الخدمة (${editingService.name})` : 'إضافة بند خدمة ومصروف جديد'}</span>
                  <span className="text-[11px] font-normal text-slate-400">تحديد سقف الميزانية، دورية الاستحقاق، المورد المعتمد، وبيانات السداد</span>
                </div>
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-xs overflow-y-auto pr-1 flex-1">
              {/* Company Multi-Selection (the owner of an existing service always stays linked) */}
              <OrgMultiSelect
                orgs={creatableOrgs}
                selected={editingService ? formOrgIds : selectedOrgIds}
                onChange={(ids) => { setSelectedOrgIds(ids); setFormError(null); }}
                label="الشركات والمؤسسات التابع لها البند (تحديد متعدد) *"
                locked={ownerLock}
                emptyHint={formHasListedOrg ? '' : '* يرجى تحديد شركة واحدة على الأقل لربط البند بها.'}
                disabled={saveGuard.pending}
              />

              {/* Basic Info & Budget Section */}
              <div className="bg-slate-50/70 p-3.5 rounded-2xl border border-slate-200/80 space-y-3">
                <h4 className="font-bold text-slate-800 text-[11px] flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5 text-emerald-600" />
                  <span>البيانات الأساسية وسقف الميزانية التقديرية</span>
                </h4>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">اسم الخدمة *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => { setName(e.target.value); setFormError(null); }}
                    placeholder="مثال: تسويق وإعلانات أو صيانة خوادم..."
                    className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden focus:border-emerald-500 transition"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">رمز الخدمة (اختياري)</label>
                    <input
                      type="text"
                      value={code}
                      onChange={(e) => setCode(sanitizeCode(e.target.value, 8))}
                      placeholder="SRV-01"
                      className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-xs font-mono uppercase text-slate-800 outline-hidden focus:border-emerald-500 transition"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">سقف الميزانية التقديرية (اختياري)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={budgetLimit}
                      onKeyDown={(e) => handleNumericKeyDown(e, false)}
                      onChange={(e) => setBudgetLimit(sanitizeDigitsOnly(e.target.value, 12))}
                      placeholder="50000"
                      className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-xs font-mono text-slate-800 outline-hidden focus:border-emerald-500 transition"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">دورية سقف الميزانية</label>
                    <select
                      value={budgetPeriod}
                      onChange={(e) => setBudgetPeriod(e.target.value as BudgetPeriod)}
                      className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden focus:border-emerald-500 transition cursor-pointer"
                    >
                      <option value="monthly">شهرياً</option>
                      <option value="yearly">سنوياً</option>
                      <option value="per_request">لكل طلب صرف</option>
                      <option value="unlimited">سقف مفتوح / غير محدد</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1.5">لون التمييز للبند</label>
                  <div className="flex items-center gap-2">
                    {['#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444', '#64748b'].map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        className={`h-6 w-6 rounded-full transition cursor-pointer ${color === c ? 'ring-2 ring-offset-2 ring-slate-800 scale-110' : 'hover:scale-105'}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Vendor & Operational Specs Section */}
              <div className="bg-slate-50/70 p-3.5 rounded-2xl border border-slate-200/80 space-y-3">
                <h4 className="font-bold text-slate-800 text-[11px] flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5 text-emerald-600" />
                  <span>المورد المعتمد وبيانات التعاقد والاشتراك</span>
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">المورد / مقدم الخدمة المعتمد</label>
                    <select
                      value={vendorId}
                      onChange={(e) => setVendorId(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden focus:border-emerald-500 transition cursor-pointer"
                    >
                      <option value="">بدون مورد محدد (غير مقيد بمورد)</option>
                      {vendorOptions.map(v => (
                        <option key={v.id} value={v.id}>
                          {v.name} {v.contactPerson ? `(${v.contactPerson})` : ''}{optionOrgSuffix(v.orgId)}{isDeactivated(v) ? ' — معطل' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      رقم العداد / كود المشترك / رقم الاشتراك الثابت
                    </label>
                    <input
                      type="text"
                      value={fixedAccountRef}
                      onChange={(e) => setFixedAccountRef(e.target.value)}
                      placeholder="مثال: عداد رقم 45802199 أو كود فوري 88392"
                      className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden focus:border-emerald-500 transition"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">دورية الاستحقاق / التكرار</label>
                    <select
                      value={recurringFrequency}
                      onChange={(e) => setRecurringFrequency(e.target.value as RecurringFrequency)}
                      className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden focus:border-emerald-500 transition cursor-pointer"
                    >
                      <option value="monthly">دوري شهرياً</option>
                      <option value="quarterly">ربع سنوي (كل 3 أشهر)</option>
                      <option value="yearly">سنوي</option>
                      <option value="on_demand">عند الطلب / طارئ</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">طبيعة الخدمة / النوع</label>
                    <input
                      type="text"
                      value={serviceNature}
                      onChange={(e) => setServiceNature(e.target.value)}
                      placeholder="مثال: عداد مسبق الدفع، فاتورة مؤجلة، اشتراك شهري"
                      className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden focus:border-emerald-500 transition"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">مركز التكلفة / الفرع</label>
                    <input
                      type="text"
                      value={costCenter}
                      onChange={(e) => setCostCenter(e.target.value)}
                      placeholder="مثال: مقر التجمع، فرع المعادي، إدارة العمليات"
                      className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden focus:border-emerald-500 transition"
                    />
                  </div>
                </div>
              </div>

              {/* Payment Defaults Section */}
              <div className="bg-slate-50/70 p-3.5 rounded-2xl border border-slate-200/80 space-y-3">
                <h4 className="font-bold text-slate-800 text-[11px] flex items-center gap-1.5">
                  <CreditCard className="h-3.5 w-3.5 text-emerald-600" />
                  <span>إعدادات الدفع والصرف الافتراضية</span>
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">طريقة الصرف الافتراضية</label>
                    <select
                      value={defaultPaymentMethod}
                      onChange={(e) => setDefaultPaymentMethod(e.target.value as PaymentMethod | '')}
                      className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden focus:border-emerald-500 transition cursor-pointer"
                    >
                      <option value="">بدون تحديد افتراضي (تحدد عند تقديم الطلب)</option>
                      <option value="cash">نقداً / الخزينة النقدية</option>
                      <option value="instapay">إنستاباي (InstaPay)</option>
                      <option value="digital_wallet">محفظة إلكترونية</option>
                      <option value="bank_transfer">تحويل بنكي</option>
                      <option value="cheque">شيك مصرفي</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">الخزينة / الحساب المالي الافتراضي</label>
                    <select
                      value={defaultAccountId}
                      onChange={(e) => setDefaultAccountId(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden focus:border-emerald-500 transition cursor-pointer"
                    >
                      <option value="">بدون حساب محدد (يحدد عند الصرف)</option>
                      {accountOptions.map(vault => (
                        <option key={vault.id} value={vault.id}>
                          {vault.name} ({vault.accountIdentifier || vault.type}){optionOrgSuffix(vault.orgId)}{vault.active === false ? ' — معطل' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Description & Notes */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">الوصف والملاحظات</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="وصف تفصيلي للبند وملاحظات الصرف..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 outline-hidden focus:border-emerald-500 transition resize-none"
                />
              </div>

              {formError && (
                <div role="alert" className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-semibold">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Actions Footer */}
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  disabled={saveGuard.pending}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer disabled:opacity-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saveGuard.pending || !formHasListedOrg}
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5 disabled:opacity-60"
                >
                  {saveGuard.pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>{saveGuard.pending ? 'جارٍ الحفظ...' : 'حفظ الخدمة'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
