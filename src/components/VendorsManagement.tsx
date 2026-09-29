import React, { useEffect, useMemo, useState } from 'react';
import { useApp, type MultiOrgSkip } from '../context/AppContext';
import { ServiceProvider, isServiceMatchingOrg } from '../types';
import { normalizeKeyValue } from '../domain/common';
import { OrgMultiSelect } from './OrgMultiSelect';
import { 
  Building, 
  Building2,
  Plus, 
  Phone, 
  Mail,
  Star,
  Edit3, 
  Trash2, 
  X, 
  Search,
  AlertCircle,
} from 'lucide-react';

import { 
  sanitizePhone, 
  sanitizeTaxOrCR, 
  sanitizeIBAN, 
  handleNumericKeyDown
} from '../utils/validation';
import { useSubmitGuard, useKeyedSubmitGuard } from '../hooks/useSubmitGuard';

export const VendorsManagement: React.FC = () => {
  const { 
    providers, 
    allProviders,
    services, 
    allServices,
    activeOrgId, 
    activeOrg, 
    organizations, 
    allOrganizations,
    currentRole,
    addProviderToOrgs,
    updateProvider,
    deleteProvider
  } = useApp();

  const isSuperAdmin = currentRole === 'super_admin';
  const orgList = isSuperAdmin ? allOrganizations : organizations;
  const targetProviders = isSuperAdmin ? allProviders : providers;
  const targetServices = isSuperAdmin ? allServices : services;
  // A new provider can only be attached to companies that are still active.
  const creatableOrgs = useMemo(
    () => orgList.filter(o => !o.archived && o.status !== 'archived'),
    [orgList]
  );

  const [selectedOrgFilter, setSelectedOrgFilter] = useState<string>(
    activeOrgId && activeOrgId !== 'all' ? activeOrgId : 'all'
  );

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ServiceProvider | null>(null);
  const saveGuard = useSubmitGuard();
  const providerActions = useKeyedSubmitGuard();
  const [search, setSearch] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; tone: 'success' | 'warning' } | null>(null);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 9000);
    return () => clearTimeout(timer);
  }, [feedback]);

  // Form states
  // Create mode: every company the new provider is added to (one provider record per company).
  const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [crNumber, setCrNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [iban, setIban] = useState('');
  const [address, setAddress] = useState('');
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [rating, setRating] = useState(5.0);
  const [notes, setNotes] = useState('');

  const orgProviders = targetProviders.filter(p => selectedOrgFilter === 'all' || p.orgId === selectedOrgFilter);

  const filteredProviders = orgProviders.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.contactPerson && p.contactPerson.toLowerCase().includes(search.toLowerCase())) ||
    (p.phone && p.phone.includes(search))
  );

  const orgLabel = (orgId: string) => {
    const org = orgList.find(o => o.id === orgId);
    return org ? `${org.name} (${org.code})` : orgId;
  };

  // Companies that already have a provider with the typed name (same normalization as the
  // domain's unique name key) cannot be picked: the save would skip them anyway.
  const typedNameKey = normalizeKeyValue(name);
  const unavailableOrgs = useMemo(() => {
    const result: Record<string, string> = {};
    if (!typedNameKey) return result;
    for (const org of creatableOrgs) {
      if (targetProviders.some(p => p.orgId === org.id && normalizeKeyValue(p.name) === typedNameKey)) {
        result[org.id] = 'يوجد مورد بنفس الاسم';
      }
    }
    return result;
  }, [creatableOrgs, targetProviders, typedNameKey]);

  // Create mode: the companies that will actually receive the provider.
  const effectiveOrgIds = selectedOrgIds.filter(id => !unavailableOrgs[id] && creatableOrgs.some(o => o.id === id));
  const effectiveOrgs = creatableOrgs.filter(o => effectiveOrgIds.includes(o.id));
  const blockedByNameOnly = selectedOrgIds.length > 0 && effectiveOrgIds.length === 0 && selectedOrgIds.some(id => unavailableOrgs[id]);

  // Services offered in the checklist: those of the provider's company (edit) or of ANY selected company (create).
  const serviceOrgIds = editingProvider ? [editingProvider.orgId] : effectiveOrgIds;
  const availableServices = targetServices.filter(s => serviceOrgIds.some(orgId => isServiceMatchingOrg(s, orgId)));

  const handleOrgSelectionChange = (orgIds: string[]) => {
    setSelectedOrgIds(orgIds);
    setFormError(null);
    // Drop service links that no longer belong to any of the selected companies.
    setSelectedServices(prev => prev.filter(serviceId => {
      const srv = targetServices.find(s => s.id === serviceId);
      return srv ? orgIds.some(orgId => isServiceMatchingOrg(srv, orgId)) : false;
    }));
  };

  const handleOpenAdd = () => {
    setEditingProvider(null);
    setName('');
    setContactPerson('');
    setPhone('');
    setEmail('');
    setTaxNumber('');
    setCrNumber('');
    setBankName('');
    setIban('');
    setAddress('');
    const isCreatable = (orgId?: string) => Boolean(orgId && orgId !== 'all' && creatableOrgs.some(o => o.id === orgId));
    const defaultOrg = isCreatable(selectedOrgFilter)
      ? selectedOrgFilter
      : isCreatable(activeOrgId)
      ? activeOrgId
      : creatableOrgs.length === 1
      ? creatableOrgs[0].id
      : '';
    setSelectedOrgIds(defaultOrg ? [defaultOrg] : []);
    const initialOrgServices = defaultOrg ? targetServices.filter(s => isServiceMatchingOrg(s, defaultOrg)) : [];
    setSelectedServices(initialOrgServices.length > 0 ? [initialOrgServices[0].id] : []);
    setRating(5.0);
    setNotes('');
    setFormError(null);
    saveGuard.rotateKey();
    setIsModalOpen(true);
  };

  const handleOpenEdit = (prov: ServiceProvider) => {
    setEditingProvider(prov);
    setName(prov.name);
    setContactPerson(prov.contactPerson || '');
    setPhone(prov.phone || '');
    setEmail(prov.email || '');
    setTaxNumber(prov.taxNumber || '');
    setCrNumber(prov.crNumber || '');
    setBankName(prov.bankName || '');
    setIban(prov.iban || '');
    setAddress(prov.address || '');
    setSelectedOrgIds([]);
    setSelectedServices(prov.serviceCategoryIds || []);
    setRating(prov.rating || 5.0);
    setNotes(prov.notes || '');
    setFormError(null);
    setIsModalOpen(true);
  };

  const buildSuccessFeedback = (providerName: string, addedOrgIds: string[], skipped: MultiOrgSkip[]) => {
    const parts: string[] = [];
    if (addedOrgIds.length > 0) {
      parts.push(`تمت إضافة المورد "${providerName}" بنجاح في: ${addedOrgIds.map(orgLabel).join('، ')}.`);
    } else {
      parts.push(`المورد "${providerName}" محفوظ بالفعل من محاولة سابقة، ولم تتم إضافة سجلات جديدة.`);
    }
    if (skipped.length > 0) {
      const skippedText = skipped
        .map(s => `${orgLabel(s.orgId)} (${s.reason === 'already_member' ? 'مسجل بالفعل' : 'يوجد مورد بنفس الاسم'}${s.existingName ? `: "${s.existingName}"` : ''})`)
        .join('، ');
      parts.push(`تم تخطي: ${skippedText}.`);
    }
    return { message: parts.join(' '), tone: skipped.length > 0 ? 'warning' as const : 'success' as const };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setFormError(null);

    const details = {
      name: trimmedName,
      contactPerson: contactPerson.trim(),
      phone: phone.trim(),
      email: email.trim(),
      taxNumber: taxNumber.trim(),
      crNumber: crNumber.trim(),
      bankName: bankName.trim(),
      iban: iban.trim(),
      address: address.trim(),
      rating,
      notes: notes.trim(),
    };

    if (!editingProvider && effectiveOrgIds.length === 0) {
      setFormError(blockedByNameOnly
        ? 'يوجد مورد بنفس الاسم في كل الشركات المحددة. غيّر الاسم أو اختر شركة أخرى.'
        : 'يرجى تحديد شركة واحدة على الأقل لإضافة المورد إليها.');
      return;
    }

    await saveGuard.run(async (idempotencyKey) => {
      try {
        if (editingProvider) {
          // The company of an existing provider never changes (one provider record per company).
          const matchedServiceNames = availableServices
            .filter(s => selectedServices.includes(s.id))
            .map(s => s.name);
          await updateProvider({
            ...editingProvider,
            ...details,
            serviceCategoryIds: selectedServices,
            serviceCategoryNames: matchedServiceNames,
          });
          setIsModalOpen(false);
          return;
        }

        // Each company keeps only the services that belong to it (filtered per company by the context).
        const chosenServices = availableServices.filter(s => selectedServices.includes(s.id));
        const result = await addProviderToOrgs({
          ...details,
          serviceCategoryIds: chosenServices.map(s => s.id),
          serviceCategoryNames: chosenServices.map(s => s.name),
          active: true,
        }, effectiveOrgIds, { idempotencyKey });
        saveGuard.rotateKey();
        setIsModalOpen(false);
        setFeedback(buildSuccessFeedback(trimmedName, result.addedOrgIds, result.skipped));
      } catch (err: any) {
        setFormError(err?.message || 'تعذر تنفيذ العملية');
      }
    });
  };

  return (
    <div className="space-y-6 pb-12">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">سجل مقدمي الخدمة والموردين</h1>
            <span className="text-xs bg-slate-100 text-slate-700 font-semibold px-2.5 py-0.5 rounded-full border border-slate-200">
              {orgProviders.length} مقدم خدمة معتمد
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            إدارة بيانات الموردين، الحسابات البنكية والآيبان، والأرقام الضريبية وتاريخ التعاملات وربطهم بالشركات
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

          <button
            type="button"
            onClick={handleOpenAdd}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-xs transition cursor-pointer self-start sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            <span>إضافة مقدم خدمة جديد</span>
          </button>
        </div>
      </div>

      {/* Save Feedback (added companies / skipped companies) */}
      {feedback && (
        <div
          role="status"
          className={`p-3.5 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 animate-in fade-in duration-150 ${
            feedback.tone === 'warning' ? 'bg-amber-50 border border-amber-200 text-amber-900' : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
          }`}
        >
          <span>{feedback.message}</span>
          <button type="button" onClick={() => setFeedback(null)} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer shrink-0">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Search Bar */}
      <div className="max-w-md relative">
        <Search className="h-4 w-4 text-slate-400 absolute right-3 top-2.5" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث باسم الشركة، الشخص المسؤول، أو رقم الهاتف..."
          className="w-full pl-3 pr-9 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
        />
      </div>

      {/* Vendors Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredProviders.map((prov) => {
          const parentOrg = orgList.find(o => o.id === prov.orgId);
          const currency = parentOrg?.currency || activeOrg?.currency || 'EGP';

          return (
            <div 
              key={prov.id} 
              className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs hover:border-slate-300 transition flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold">
                      <Building className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm">{prov.name}</h3>
                      <div className="flex items-center gap-1 text-[11px] text-amber-500 font-bold mt-0.5">
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                        <span>{prov.rating}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(prov)}
                      className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                      title="تعديل المورد"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => providerActions.run(`delete:${prov.id}`, async () => {
                        try {
                          await deleteProvider(prov.id);
                        } catch (err: any) {
                          alert(err?.message || 'تعذر تنفيذ العملية');
                        }
                      })}
                      disabled={providerActions.isPending(`delete:${prov.id}`)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                      title="حذف المورد"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Company connection and service categories badges */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-sky-50 text-sky-800 border border-sky-200/80">
                    <Building2 className="h-3 w-3 text-sky-600" />
                    <span>{parentOrg ? parentOrg.name : 'شركة غير محددة'}</span>
                  </span>
                  {prov.serviceCategoryNames && prov.serviceCategoryNames.map((cat, idx) => (
                    <span key={idx} className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                      {cat}
                    </span>
                  ))}
                </div>

                {/* Details */}
                <div className="mt-4 space-y-2 text-xs text-slate-600">
                  {prov.contactPerson && (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">المسؤول:</span>
                      <span className="font-semibold text-slate-800">{prov.contactPerson}</span>
                    </div>
                  )}

                  {prov.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 text-slate-400" />
                      <span className="font-mono text-slate-700">{prov.phone}</span>
                    </div>
                  )}

                  {prov.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 text-slate-400" />
                      <span className="text-slate-700 truncate">{prov.email}</span>
                    </div>
                  )}

                  {(prov.taxNumber || prov.iban || prov.bankName) && (
                    <div className="pt-2 border-t border-slate-100 space-y-1 text-[11px]">
                      {prov.taxNumber && (
                        <div>
                          <span className="text-slate-400">الرقم الضريبي: </span>
                          <span className="font-mono font-bold text-slate-700">{prov.taxNumber}</span>
                        </div>
                      )}
                      {(prov.bankName || prov.iban) && (
                        <div>
                          <span className="text-slate-400">البنك والآيبان: </span>
                          {prov.bankName && <span className="font-bold text-slate-800 ml-1">{prov.bankName}</span>}
                          {prov.iban && <span className="font-mono text-slate-500 block truncate">{prov.iban}</span>}
                        </div>
                      )}
                    </div>
                  )}

                  {prov.notes && (
                    <p className="text-[11px] text-slate-500 bg-slate-50 p-2 rounded-lg mt-2 italic">
                      {prov.notes}
                    </p>
                  )}
                </div>
              </div>

              {/* Total Paid Summary */}
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <span className="text-slate-400">إجمالي المبالغ المصروفة:</span>
                <span className="font-black text-emerald-700">
                  {prov.totalPaid.toLocaleString()} {currency}
                </span>
              </div>
            </div>
          );
        })}
        {filteredProviders.length === 0 && (
          <div className="col-span-full bg-white rounded-2xl border border-dashed border-slate-200 p-8 text-center">
            <Building className="h-10 w-10 text-slate-300 mx-auto mb-2" />
            <h3 className="font-bold text-slate-800 text-sm">لا يوجد موردون أو مقدمو خدمات مسجلين</h3>
            <p className="text-xs text-slate-400 mt-1 mb-4">أضف مقدمي الخدمات والشركات المتعامل معها وحساباتهم البنكية لتسهيل أوامر الصرف</p>
            <button
              type="button"
              onClick={handleOpenAdd}
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>إضافة أول مقدم خدمة الآن</span>
            </button>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl p-6 border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm">
                {editingProvider ? 'تعديل بيانات مقدم الخدمة' : 'إضافة مقدم خدمة جديد'}
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-3 text-xs">
              {/* Company Selection: multi-select on create, read-only on edit */}
              {editingProvider ? (
                <div>
                  <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-emerald-600" />
                    <span>الشركة أو المؤسسة التابع لها المورد</span>
                  </label>
                  <div className="w-full p-2.5 bg-slate-100 border border-slate-200 rounded-xl font-semibold text-slate-700">
                    {editingProvider.orgId ? orgLabel(editingProvider.orgId) : 'شركة غير محددة'}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    لا يمكن نقل المورد إلى شركة أخرى. لإضافته لشركة أخرى استخدم "إضافة مقدم خدمة جديد".
                  </p>
                </div>
              ) : (
                <div>
                  <OrgMultiSelect
                    orgs={creatableOrgs}
                    selected={effectiveOrgIds}
                    onChange={handleOrgSelectionChange}
                    label="الشركات أو المؤسسات التابع لها المورد (تحديد متعدد) *"
                    unavailable={unavailableOrgs}
                    emptyHint={blockedByNameOnly
                      ? '* يوجد مورد بنفس الاسم في الشركات المحددة. غيّر الاسم أو اختر شركة أخرى.'
                      : '* يرجى تحديد شركة واحدة على الأقل.'}
                    disabled={saveGuard.pending}
                  />
                  {effectiveOrgIds.length > 1 && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      سيتم إنشاء سجل مستقل للمورد في كل شركة محددة (بإجمالي مصروفات منفصل لكل شركة).
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم المؤسسة / مقدم الخدمة *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => { setName(e.target.value); setFormError(null); }}
                  placeholder="مثال: شركة سحابة الخليج للتقنية..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              {/* Connected Services Checklist */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {!editingProvider && effectiveOrgs.length > 1
                    ? 'بنود ومراكز الصرف المرتبطة بهذا المورد في الشركات المحددة (اختياري)'
                    : 'بنود ومراكز الصرف المرتبطة بهذا المورد في الشركة (اختياري)'}
                </label>
                {!editingProvider && effectiveOrgIds.length === 0 ? (
                  <p className="text-[11px] text-slate-400 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                    اختر شركة واحدة على الأقل لعرض بنود الصرف الخاصة بها.
                  </p>
                ) : availableServices.length === 0 ? (
                  <p className="text-[11px] text-slate-400 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                    {!editingProvider && effectiveOrgs.length > 1
                      ? 'لا توجد بنود صرف مسجلة للشركات المحددة بعد. يمكنك حفظ المورد الآن وربطه بالبنود لاحقاً.'
                      : 'لا توجد بنود صرف مسجلة لهذه الشركة بعد. يمكنك حفظ المورد الآن وربطه بالبنود لاحقاً.'}
                  </p>
                ) : (
                  <div className="max-h-32 overflow-y-auto space-y-1.5 p-2 bg-slate-50 border border-slate-200 rounded-xl">
                    {availableServices.map(srv => {
                      const isChecked = selectedServices.includes(srv.id);
                      const srvOrgs = !editingProvider && effectiveOrgs.length > 1
                        ? effectiveOrgs.filter(o => isServiceMatchingOrg(srv, o.id))
                        : [];
                      return (
                        <label key={srv.id} className="flex items-center gap-2 p-1.5 hover:bg-white rounded-lg cursor-pointer transition">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              if (isChecked) {
                                setSelectedServices(selectedServices.filter(id => id !== srv.id));
                              } else {
                                setSelectedServices([...selectedServices, srv.id]);
                              }
                            }}
                            className="rounded text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className="text-xs font-semibold text-slate-700">{srv.name}</span>
                          <span className="text-[10px] text-slate-400 font-mono">({srv.code})</span>
                          {srvOrgs.length > 0 && (
                            <span className="mr-auto flex flex-wrap items-center gap-1">
                              {srvOrgs.map(o => (
                                <span key={o.id} title={o.name} className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-800 border border-sky-200/80">
                                  {o.code || o.name}
                                </span>
                              ))}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">الشخص المسؤول (اختياري)</label>
                  <input
                    type="text"
                    value={contactPerson}
                    onChange={(e) => setContactPerson(e.target.value)}
                    placeholder="اسم مسؤول المبيعات..."
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">رقم الهاتف (اختياري)</label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onKeyDown={(e) => handleNumericKeyDown(e, false)}
                    onChange={(e) => setPhone(sanitizePhone(e.target.value))}
                    placeholder="+966 50... أو 010..."
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">البريد الإلكتروني</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value.trim().toLowerCase())}
                    placeholder="billing@provider.com"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">العنوان / المدينة</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">الرقم الضريبي (أرقام فقط)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={taxNumber}
                    onKeyDown={(e) => handleNumericKeyDown(e, false)}
                    onChange={(e) => setTaxNumber(sanitizeTaxOrCR(e.target.value, 15))}
                    placeholder="300000000000003"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">رقم السجل التجاري (أرقام فقط)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={crNumber}
                    onKeyDown={(e) => handleNumericKeyDown(e, false)}
                    onChange={(e) => setCrNumber(sanitizeTaxOrCR(e.target.value, 10))}
                    placeholder="1010000000"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">اسم البنك المعتمد</label>
                  <input
                    type="text"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">رقم الآيبان (IBAN)</label>
                  <input
                    type="text"
                    value={iban}
                    onChange={(e) => setIban(sanitizeIBAN(e.target.value))}
                    placeholder="SA..."
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono uppercase"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">ملاحظات وتقييم</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ملاحظات حول الأسعار وجودة الخدمة..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              {formError && (
                <div role="alert" className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-semibold">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saveGuard.pending || (!editingProvider && effectiveOrgIds.length === 0)}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saveGuard.pending
                    ? 'جارٍ الحفظ...'
                    : !editingProvider && effectiveOrgIds.length > 1
                    ? `حفظ المورد في ${effectiveOrgIds.length} شركات`
                    : 'حفظ مقدم الخدمة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
