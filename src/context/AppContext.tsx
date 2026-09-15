import React, { createContext, useContext, useState, useEffect } from 'react';
import { 
  Organization, 
  User, 
  OrganizationMember, 
  ServiceCategory, 
  ServiceProvider, 
  ExpenseRequest, 
  DisbursementDetails
} from '../types';

interface AppContextType {
  organizations: Organization[];
  activeOrgId: string;
  activeOrg?: Organization;
  users: User[];
  currentUser: User;
  currentRole: 'org_admin' | 'employee';
  members: OrganizationMember[];
  services: ServiceCategory[];
  providers: ServiceProvider[];
  requests: ExpenseRequest[];
  activeTab: string;
  loading: boolean;
  
  setActiveOrgId: (id: string) => void;
  setCurrentRole: (role: 'org_admin' | 'employee') => void;
  setActiveTab: (tab: string) => void;
  
  // Organizations
  addOrganization: (org: Omit<Organization, 'id' | 'createdAt'>) => Promise<void>;
  
  // Members
  addMember: (member: Omit<OrganizationMember, 'id' | 'joinedAt'>) => Promise<void>;
  removeMember: (memberId: string) => Promise<void>;
  
  // Services
  addService: (service: Omit<ServiceCategory, 'id' | 'spentAmount'>) => Promise<void>;
  updateService: (service: ServiceCategory) => Promise<void>;
  deleteService: (serviceId: string) => Promise<void>;
  
  // Providers
  addProvider: (provider: Omit<ServiceProvider, 'id' | 'totalPaid'>) => Promise<void>;
  updateProvider: (provider: ServiceProvider) => Promise<void>;
  deleteProvider: (providerId: string) => Promise<void>;
  
  // Expense Requests & Workflow
  createRequest: (data: {
    title: string;
    description: string;
    justification: string;
    amount: number;
    currency: string;
    serviceCategoryId: string;
    providerId: string;
    urgency: 'low' | 'medium' | 'high';
    attachmentNames?: string[];
  }) => Promise<void>;
  
  approveRequest: (requestId: string, note?: string) => Promise<void>;
  rejectRequest: (requestId: string, reason: string) => Promise<void>;
  requestClarification: (requestId: string, question: string) => Promise<void>;
  replyClarification: (requestId: string, replyText: string, attachmentName?: string) => Promise<void>;
  disburseRequest: (requestId: string, details: Omit<DisbursementDetails, 'disbursedAt' | 'disbursedBy'>) => Promise<void>;
  
  refreshData: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string>('all');
  const [currentRole, setCurrentRole] = useState<'org_admin' | 'employee'>('org_admin');
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [services, setServices] = useState<ServiceCategory[]>([]);
  const [providers, setProviders] = useState<ServiceProvider[]>([]);
  const [requests, setRequests] = useState<ExpenseRequest[]>([]);
  const [loading, setLoading] = useState(true);

  // Dynamic user derived from active organization and role
  const activeOrg = organizations.find(o => o.id === activeOrgId);
  const activeOrgMembers = members.filter(m => activeOrgId === 'all' || m.orgId === activeOrgId);
  
  const currentMember = activeOrgMembers.find(m => m.role === currentRole) || activeOrgMembers[0];
  const currentUser: User = {
    id: currentMember?.userId || (currentRole === 'org_admin' ? 'user-admin' : 'user-emp'),
    name: currentMember?.userName || (currentRole === 'org_admin' ? 'مدير المؤسسة' : 'الموظف (طالب الصرف)'),
    email: currentMember?.userEmail || (currentRole === 'org_admin' ? 'admin@tieapps.com' : 'employee@tieapps.com'),
    role: currentRole,
    phone: '+966 50 000 0000',
  };

  const users: User[] = [
    { id: 'user-admin', name: 'مدير المؤسسة', email: 'admin@tieapps.com', role: 'org_admin' },
    { id: 'user-emp', name: 'الموظف (طالب الصرف)', email: 'employee@tieapps.com', role: 'employee' }
  ];

  const refreshData = async () => {
    try {
      setLoading(true);
      const [orgsRes, memsRes, srvsRes, provsRes, reqsRes] = await Promise.all([
        fetch('/api/organizations'),
        fetch('/api/members'),
        fetch('/api/services'),
        fetch('/api/providers'),
        fetch('/api/requests'),
      ]);

      if (orgsRes.ok) {
        const orgsData = await orgsRes.json();
        setOrganizations(orgsData);
        if (orgsData.length > 0 && activeOrgId === 'all') {
          setActiveOrgId(orgsData[0].id);
        }
      }
      if (memsRes.ok) setMembers(await memsRes.json());
      if (srvsRes.ok) setServices(await srvsRes.json());
      if (provsRes.ok) setProviders(await provsRes.json());
      if (reqsRes.ok) setRequests(await reqsRes.json());
    } catch (err) {
      console.warn('Backend API not responding yet, using local fallback:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  // Handlers
  const addOrganization = async (orgData: Omit<Organization, 'id' | 'createdAt'>) => {
    try {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orgData),
      });
      if (res.ok) {
        const newOrg = await res.json();
        setOrganizations(prev => [newOrg, ...prev]);
        setActiveOrgId(newOrg.id);
        await refreshData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const addMember = async (memberData: Omit<OrganizationMember, 'id' | 'joinedAt'>) => {
    try {
      const res = await fetch('/api/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(memberData),
      });
      if (res.ok) {
        const newMember = await res.json();
        setMembers(prev => [newMember, ...prev]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const removeMember = async (memberId: string) => {
    try {
      const res = await fetch(`/api/members/${memberId}`, { method: 'DELETE' });
      if (res.ok) {
        setMembers(prev => prev.filter(m => m.id !== memberId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const addService = async (serviceData: Omit<ServiceCategory, 'id' | 'spentAmount'>) => {
    try {
      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serviceData),
      });
      if (res.ok) {
        const newSrv = await res.json();
        setServices(prev => [...prev, newSrv]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const updateService = async (updatedService: ServiceCategory) => {
    try {
      const res = await fetch(`/api/services/${updatedService.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedService),
      });
      if (res.ok) {
        const saved = await res.json();
        setServices(prev => prev.map(s => s.id === saved.id ? saved : s));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const deleteService = async (serviceId: string) => {
    try {
      const res = await fetch(`/api/services/${serviceId}`, { method: 'DELETE' });
      if (res.ok) {
        setServices(prev => prev.filter(s => s.id !== serviceId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const addProvider = async (providerData: Omit<ServiceProvider, 'id' | 'totalPaid'>) => {
    try {
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(providerData),
      });
      if (res.ok) {
        const newProv = await res.json();
        setProviders(prev => [...prev, newProv]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const updateProvider = async (updatedProvider: ServiceProvider) => {
    try {
      const res = await fetch(`/api/providers/${updatedProvider.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedProvider),
      });
      if (res.ok) {
        const saved = await res.json();
        setProviders(prev => prev.map(p => p.id === saved.id ? saved : p));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const deleteProvider = async (providerId: string) => {
    try {
      const res = await fetch(`/api/providers/${providerId}`, { method: 'DELETE' });
      if (res.ok) {
        setProviders(prev => prev.filter(p => p.id !== providerId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Workflow Handlers
  const createRequest = async (data: {
    title: string;
    description: string;
    justification: string;
    amount: number;
    currency: string;
    serviceCategoryId: string;
    providerId: string;
    urgency: 'low' | 'medium' | 'high';
    attachmentNames?: string[];
  }) => {
    const service = services.find(s => s.id === data.serviceCategoryId);
    const provider = providers.find(p => p.id === data.providerId);

    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: activeOrgId === 'all' ? (organizations[0]?.id || 'org-1') : activeOrgId,
          requesterId: currentUser.id,
          requesterName: currentUser.name,
          requesterDepartment: currentRole === 'org_admin' ? 'الإدارة العامة' : 'العمليات والتوريد',
          serviceCategoryId: data.serviceCategoryId,
          serviceCategoryName: service?.name || 'خدمة عامة',
          providerId: data.providerId,
          providerName: provider?.name || 'مورد عام',
          title: data.title,
          description: data.description,
          justification: data.justification,
          amount: data.amount,
          currency: data.currency,
          urgency: data.urgency,
          attachmentNames: data.attachmentNames,
        }),
      });

      if (res.ok) {
        const newReq = await res.json();
        setRequests(prev => [newReq, ...prev]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const approveRequest = async (requestId: string, note?: string) => {
    try {
      const res = await fetch(`/api/requests/${requestId}/approve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note, actorName: currentUser.name }),
      });
      if (res.ok) {
        const updated = await res.json();
        setRequests(prev => prev.map(r => r.id === updated.id ? updated : r));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const rejectRequest = async (requestId: string, reason: string) => {
    try {
      const res = await fetch(`/api/requests/${requestId}/reject`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, actorName: currentUser.name }),
      });
      if (res.ok) {
        const updated = await res.json();
        setRequests(prev => prev.map(r => r.id === updated.id ? updated : r));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const requestClarification = async (requestId: string, question: string) => {
    try {
      const res = await fetch(`/api/requests/${requestId}/clarify`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, actorName: currentUser.name }),
      });
      if (res.ok) {
        const updated = await res.json();
        setRequests(prev => prev.map(r => r.id === updated.id ? updated : r));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const replyClarification = async (requestId: string, replyText: string, attachmentName?: string) => {
    try {
      const res = await fetch(`/api/requests/${requestId}/reply`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replyText, attachmentName, actorName: currentUser.name }),
      });
      if (res.ok) {
        const updated = await res.json();
        setRequests(prev => prev.map(r => r.id === updated.id ? updated : r));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const disburseRequest = async (
    requestId: string, 
    details: Omit<DisbursementDetails, 'disbursedAt' | 'disbursedBy'>
  ) => {
    try {
      const res = await fetch(`/api/requests/${requestId}/disburse`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...details, actorName: currentUser.name }),
      });
      if (res.ok) {
        const updated = await res.json();
        setRequests(prev => prev.map(r => r.id === updated.id ? updated : r));
        await refreshData(); // Refresh services & providers balances
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <AppContext.Provider
      value={{
        organizations,
        activeOrgId,
        activeOrg,
        users,
        currentUser,
        currentRole,
        members,
        services,
        providers,
        requests,
        activeTab,
        loading,
        setActiveOrgId,
        setCurrentRole,
        setActiveTab,
        addOrganization,
        addMember,
        removeMember,
        addService,
        updateService,
        deleteService,
        addProvider,
        updateProvider,
        deleteProvider,
        createRequest,
        approveRequest,
        rejectRequest,
        requestClarification,
        replyClarification,
        disburseRequest,
        refreshData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
