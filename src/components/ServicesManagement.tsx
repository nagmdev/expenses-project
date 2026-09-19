import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ServiceCategory, isServiceMatchingOrg, BudgetPeriod, RecurringFrequency, PaymentMethod } from '../types';
import { 
  Layers, 
  Plus, 
  Edit3, 
  Trash2, 
  TrendingUp, 
  X, 
  Check, 
  Cloud, 
  Megaphone, 
  Wrench, 
  Package, 
  Truck, 
  Warehouse,
  Building2,
  DollarSign,
  Calendar,
  Clock,
  Hash,
  MapPin,
  Tag,
  CreditCard,
  Wallet,
  AlertTriangle,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';

import { sanitizeDigitsOnly, sanitizeCode, handleNumericKeyDown } from '../utils/validation';

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

export const ServicesManagement: React.FC = () => {
  const { 
    services, 
    allServices,
    providers,
    allProviders,
    paymentAccounts,
    allPaymentAccounts,
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

  const [selectedOrgFilter, setSelectedOrgFilter] = useState<string>(
    activeOrgId && activeOrgId !== 'all' ? activeOrgId : 'all'
  );

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<ServiceCategory | null>(null);

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

  const handleOpenAdd = () => {
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
    const defaultOrg = selectedOrgFilter !== 'all' 
      ? selectedOrgFilter 
      : (activeOrgId && activeOrgId !== 'all' ? activeOrgId : (orgList[0]?.id || ''));
    setSelectedOrgIds(defaultOrg ? [defaultOrg] : (orgList.length > 0 ? [orgList[0].id] : []));
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (srv: ServiceCategory) => {
    setEditingService(srv);
    setName(srv.name);
    setCode(srv.code);
    setDescription(srv.description || '');
    setBudgetLimit(srv.budgetLimit.toString());
    setBudgetPeriod(srv.budgetPeriod || 'monthly');
    setRecurringFrequency(srv.recurringFrequency || 'monthly');
    setFixedAccountRef(srv.fixedAccountRef || '');
    setVendorId(srv.vendorId || '');
    setServiceNature(srv.serviceNature || '');
    setDefaultPaymentMethod(srv.defaultPaymentMethod || '');
    setDefaultAccountId(srv.defaultAccountId || '');
    setCostCenter(srv.costCenter || '');
    setColor(srv.color || '#10b981');
    const initialOrgs = srv.orgIds && srv.orgIds.length > 0
      ? srv.orgIds
      : (srv.orgId ? [srv.orgId] : (orgList[0]?.id ? [orgList[0].id] : []));
    setSelectedOrgIds(initialOrgs);
    setIsAddModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || selectedOrgIds.length === 0) return;

    const finalCode = code.trim().toUpperCase() || (editingService ? editingService.code : `SRV-${Math.floor(100 + Math.random() * 900)}`);
    const primaryOrgId = selectedOrgIds[0] || orgList[0]?.id || '';
    const chosenVendor = targetVendors.find(v => v.id === vendorId);
    const vendorName = chosenVendor ? chosenVendor.name : undefined;

    if (editingService) {
      await updateService({
        ...editingService,
        name: name.trim(),
        code: finalCode,
        description: description.trim(),
        budgetLimit: Number(budgetLimit) || 0,
        budgetPeriod,
        recurringFrequency,
        fixedAccountRef: fixedAccountRef.trim() || undefined,
        vendorId: vendorId || undefined,
        vendorName: vendorName,
        serviceNature: serviceNature.trim() || undefined,
        defaultPaymentMethod: (defaultPaymentMethod as PaymentMethod) || undefined,
        defaultAccountId: defaultAccountId || undefined,
        costCenter: costCenter.trim() || undefined,
        color,
        orgId: primaryOrgId,
        orgIds: selectedOrgIds,
      });
    } else {
      await addService({
        orgId: primaryOrgId,
        orgIds: selectedOrgIds,
        name: name.trim(),
        code: finalCode,
        description: description.trim(),
        budgetLimit: Number(budgetLimit) || 0,
        budgetPeriod,
        recurringFrequency,
        fixedAccountRef: fixedAccountRef.trim() || undefined,
        vendorId: vendorId || undefined,
        vendorName: vendorName,
        serviceNature: serviceNature.trim() || undefined,
        defaultPaymentMethod: (defaultPaymentMethod as PaymentMethod) || undefined,
        defaultAccountId: defaultAccountId || undefined,
        costCenter: costCenter.trim() || undefined,
        color,
        iconName: 'Layers',
      });
    }

    setIsAddModalOpen(false);
  };

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
            تعريف الخدمات والمراكز التكليفية وتحديد سقف الميزانية التقديرية لكل خدمة وربطها بالشركة
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
            <span>إضافة خدمة جديدة</span>
          </button>
        </div>
      </div>

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
              className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs hover:border-slate-300 transition flex flex-col justify-between"
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
                      <h3 className="font-bold text-slate-900 text-sm">{srv.name}</h3>
                      <span className="font-mono text-[10px] text-slate-400">{srv.code}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(srv)}
                      className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                      title="تعديل الخدمة"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteService(srv.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                      title="حذف الخدمة"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
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
                      {spent.toLocaleString()} {currency}
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
                      {budget > 0 ? `${budget.toLocaleString()} ${currency}` : 'سقف مفتوح'}
                    </span>
                    <span className="text-[10px] text-slate-400">({budgetPeriodLabels[srv.budgetPeriod || 'monthly']})</span>
                  </div>
                  {budget > 0 && (
                    <span className="font-mono text-[10px] text-slate-500">
                      المتبقي: {Math.max(0, budget - spent).toLocaleString()} {currency}
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
            <p className="text-xs text-slate-400 mt-1 mb-4">أضف بنود الخدمات ومراكز التكلفة لتحديد ميزانية لكل بند وتتبع المصروفات بدقة</p>
            <button
              type="button"
              onClick={handleOpenAdd}
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>إضافة أول بند خدمة الآن</span>
            </button>
          </div>
        )}
      </div>

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
              {/* Company Multi-Selection */}
              <div className="bg-slate-50/70 p-3.5 rounded-2xl border border-slate-200/80">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block font-bold text-slate-700 flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-emerald-600" />
                    <span>الشركات والمؤسسات التابع لها البند (تحديد متعدد) *</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedOrgIds.length === orgList.length) {
                        setSelectedOrgIds([]);
                      } else {
                        setSelectedOrgIds(orgList.map(o => o.id));
                      }
                    }}
                    className="text-[11px] text-emerald-700 hover:text-emerald-800 font-bold hover:underline cursor-pointer"
                  >
                    {selectedOrgIds.length === orgList.length ? 'إلغاء تحديد الكل' : 'تحديد كل الشركات'}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto p-2 bg-white border border-slate-200 rounded-xl">
                  {orgList.map(org => {
                    const isSelected = selectedOrgIds.includes(org.id);
                    return (
                      <label 
                        key={org.id} 
                        className={`flex items-center gap-2 p-2 rounded-lg border text-xs font-semibold cursor-pointer transition ${
                          isSelected 
                            ? 'bg-emerald-50 border-emerald-400 text-emerald-950 font-bold shadow-xs' 
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100/70'
                        }`}
                      >
                        <input 
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedOrgIds(prev => [...prev, org.id]);
                            } else {
                              setSelectedOrgIds(prev => prev.filter(id => id !== org.id));
                            }
                          }}
                          className="h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="truncate">{org.name}</div>
                          <span className="text-[10px] text-slate-400 font-normal">{org.code} ({org.currency})</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {selectedOrgIds.length === 0 && (
                  <p className="mt-1.5 text-[11px] text-rose-600 font-bold">
                    * يرجى تحديد شركة واحدة على الأقل لربط البند بها.
                  </p>
                )}
              </div>

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
                    onChange={(e) => setName(e.target.value)}
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
                      <option value="monthly">شهرياً (Monthly)</option>
                      <option value="yearly">سنوياً (Yearly)</option>
                      <option value="per_request">لكل طلب صرف (Per Request)</option>
                      <option value="unlimited">سقف مفتوح / غير محدد (Unlimited)</option>
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
                      {targetVendors.map(v => (
                        <option key={v.id} value={v.id}>{v.name} {v.contactPerson ? `(${v.contactPerson})` : ''}</option>
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
                      <option value="cash">نقداً / الخزينة النقدية (Cash)</option>
                      <option value="instapay">إنستاباي (InstaPay)</option>
                      <option value="digital_wallet">محفظة إلكترونية (Digital Wallet)</option>
                      <option value="bank_transfer">تحويل بنكي (Bank Transfer)</option>
                      <option value="cheque">شيك مصرفي (Cheque)</option>
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
                      {targetVaults.map(vault => (
                        <option key={vault.id} value={vault.id}>
                          {vault.name} ({vault.accountIdentifier || vault.type})
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

              {/* Actions Footer */}
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer"
                >
                  حفظ الخدمة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
