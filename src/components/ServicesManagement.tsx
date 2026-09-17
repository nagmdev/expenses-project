import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ServiceCategory, isServiceMatchingOrg } from '../types';
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
  Building2
} from 'lucide-react';

import { sanitizeDigitsOnly, sanitizeCode, handleNumericKeyDown } from '../utils/validation';

export const ServicesManagement: React.FC = () => {
  const { 
    services, 
    allServices,
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
  const [color, setColor] = useState('#10b981');

  const orgServices = targetServices.filter(s => selectedOrgFilter === 'all' || isServiceMatchingOrg(s, selectedOrgFilter));

  const handleOpenAdd = () => {
    setName('');
    setCode(`SRV-${Math.floor(100 + Math.random() * 900)}`);
    setDescription('');
    setBudgetLimit('');
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
    setDescription(srv.description);
    setBudgetLimit(srv.budgetLimit.toString());
    setColor(srv.color);
    const initialOrgs = srv.orgIds && srv.orgIds.length > 0
      ? srv.orgIds
      : (srv.orgId ? [srv.orgId] : (orgList[0]?.id ? [orgList[0].id] : []));
    setSelectedOrgIds(initialOrgs);
    setIsAddModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || selectedOrgIds.length === 0) return;

    const finalCode = code.trim() || `SRV-${Math.floor(100 + Math.random() * 900)}`;
    const primaryOrgId = selectedOrgIds[0] || orgList[0]?.id || '';

    if (editingService) {
      await updateService({
        ...editingService,
        name: name.trim(),
        code: finalCode,
        description: description.trim(),
        budgetLimit: Number(budgetLimit) || 0,
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
          const percent = srv.budgetLimit > 0 
            ? Math.min(100, Math.round((srv.spentAmount / srv.budgetLimit) * 100))
            : 0;
          const parentOrg = orgList.find(o => o.id === srv.orgId);
          const currency = parentOrg?.currency || activeOrg?.currency || 'EGP';

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
                      className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                      title="تعديل الخدمة"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteService(srv.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
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

                <p className="text-xs text-slate-500 mt-3 line-clamp-2 leading-relaxed">
                  {srv.description || 'لا يوجد وصف تفصيلي لهذه الخدمة.'}
                </p>
              </div>

              {/* Financial Progress */}
              <div className="mt-5 pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-slate-500">المصروف الفعلي:</span>
                  <span className="font-black text-slate-900">
                    {srv.spentAmount.toLocaleString()} {currency}
                  </span>
                </div>
                
                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
                  <span>الميزانية المحددة:</span>
                  <span>{srv.budgetLimit.toLocaleString()} {currency} ({percent}%)</span>
                </div>

                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full transition-all duration-500"
                    style={{ 
                      width: `${percent}%`,
                      backgroundColor: percent > 85 ? '#ef4444' : srv.color 
                    }}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl p-6 border border-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm">
                {editingService ? 'تعديل بند الخدمة' : 'إضافة بند خدمة جديد'}
              </h3>
              <button 
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-3 text-xs">
              {/* Company Multi-Selection */}
              <div>
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
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
                  <p className="mt-1 text-[11px] text-rose-600 font-bold">
                    * يرجى تحديد شركة واحدة على الأقل لربط البند بها.
                  </p>
                )}
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم الخدمة *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: تسويق وإعلانات أو صيانة خوادم..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">رمز الخدمة (اختياري)</label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(sanitizeCode(e.target.value, 6))}
                    placeholder="SRV-01"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono uppercase"
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
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">لون التمييز</label>
                <div className="flex items-center gap-2">
                  {['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#6366f1'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`h-7 w-7 rounded-full transition ${color === c ? 'ring-2 ring-offset-2 ring-slate-900 scale-110' : ''}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">الوصف</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="وصف تفصيلي للبند..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl"
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
