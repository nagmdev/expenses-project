import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ServiceCategory } from '../types';
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
  Warehouse 
} from 'lucide-react';

export const ServicesManagement: React.FC = () => {
  const { services, activeOrgId, activeOrg, addService, updateService, deleteService } = useApp();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<ServiceCategory | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [budgetLimit, setBudgetLimit] = useState('');
  const [color, setColor] = useState('#10b981');

  const orgServices = services.filter(s => activeOrgId === 'all' || s.orgId === activeOrgId);

  const handleOpenAdd = () => {
    setName('');
    setCode(`SRV-${Math.floor(100 + Math.random() * 900)}`);
    setDescription('');
    setBudgetLimit('');
    setColor('#10b981');
    setEditingService(null);
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (srv: ServiceCategory) => {
    setEditingService(srv);
    setName(srv.name);
    setCode(srv.code);
    setDescription(srv.description);
    setBudgetLimit(srv.budgetLimit.toString());
    setColor(srv.color);
    setIsAddModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (editingService) {
      updateService({
        ...editingService,
        name: name.trim(),
        code: code.trim(),
        description: description.trim(),
        budgetLimit: Number(budgetLimit) || 0,
        color,
      });
    } else {
      addService({
        orgId: activeOrgId === 'all' ? 'org-1' : activeOrgId,
        name: name.trim(),
        code: code.trim(),
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
            تعريف الخدمات والمراكز التكليفية وتحديد سقف الميزانية التقديرية لكل خدمة
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenAdd}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-xs transition cursor-pointer self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          <span>إضافة خدمة جديدة</span>
        </button>
      </div>

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {orgServices.map((srv) => {
          const percent = srv.budgetLimit > 0 
            ? Math.min(100, Math.round((srv.spentAmount / srv.budgetLimit) * 100))
            : 0;
          const currency = activeOrg?.currency || 'SAR';

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
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteService(srv.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
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
                  <label className="block font-bold text-slate-700 mb-1">رمز الخدمة (Code)</label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">سقف الميزانية التقديرية</label>
                  <input
                    type="number"
                    min="0"
                    value={budgetLimit}
                    onChange={(e) => setBudgetLimit(e.target.value)}
                    placeholder="50,000"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
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
