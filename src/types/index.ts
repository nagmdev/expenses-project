export interface Organization {
  id: string;
  name: string;
  code: string;
  currency: string;
  budget: number;
  description: string;
  logo?: string;
  createdAt: string;
  updatedAt?: string;
  status?: 'active' | 'archived';
  archived?: boolean;
  archivedAt?: string;
}

export type Role = 'super_admin' | 'org_admin' | 'finance' | 'employee' | 'data_entry';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatar?: string;
  phone?: string;
  orgId?: string;
}

export interface OrganizationMember {
  id: string;
  orgId: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: Role;
  department: string;
  jobTitle: string;
  joinedAt: string;
  active: boolean;
  phone?: string;
  updatedAt?: string;
}

export type BudgetPeriod = 'monthly' | 'yearly' | 'per_request' | 'unlimited';
export type RecurringFrequency = 'on_demand' | 'monthly' | 'quarterly' | 'yearly';

export interface ServiceCategory {
  id: string;
  orgId: string;
  orgIds?: string[]; // Multi-company linkage support
  name: string;
  code: string;
  description: string;
  budgetLimit: number;
  budgetPeriod?: BudgetPeriod; // دورية سقف الميزانية (شهري، سنوي، لكل طلب، غير محدد)
  recurringFrequency?: RecurringFrequency; // دورية استحقاق البند
  spentAmount: number;
  color: string;
  iconName: string;
  fixedAccountRef?: string; // رقم العداد / كود المشترك / رقم الاشتراك الثابت
  vendorId?: string; // المورد / مقدم الخدمة المعتمد
  vendorName?: string;
  serviceNature?: string; // طبيعة الخدمة / النوع (مثل: عداد مسبق الدفع، اشتراك شهري، صيانة طارئة)
  defaultPaymentMethod?: PaymentMethod; // طريقة الصرف الافتراضية
  defaultAccountId?: string; // الخزينة أو الحساب المالي الافتراضي
  costCenter?: string; // مركز التكلفة / الفرع
}

export const isServiceMatchingOrg = (service: ServiceCategory, targetOrgId?: string): boolean => {
  if (!targetOrgId || targetOrgId === 'all') return true;
  if (service.orgIds && Array.isArray(service.orgIds) && service.orgIds.length > 0) {
    return service.orgIds.includes(targetOrgId);
  }
  return service.orgId === targetOrgId;
};

export interface ServiceProvider {
  id: string;
  orgId: string;
  name: string;
  serviceCategoryIds: string[];
  serviceCategoryNames: string[];
  contactPerson: string;
  phone: string;
  email: string;
  taxNumber: string;
  crNumber: string;
  bankName: string;
  iban: string;
  address: string;
  rating: number;
  notes?: string;
  totalPaid: number;
  active: boolean;
}

export type RequestStatus = 
  | 'pending'
  | 'clarification_requested'
  | 'approved'
  | 'rejected'
  | 'disbursed';

export interface RequestAttachment {
  id: string;
  name: string;
  size: string;
  type: string;
  url?: string;
  uploadedAt: string;
}

export interface RequestComment {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  content: string;
  type: 'clarification_request' | 'clarification_reply' | 'internal_note';
  createdAt: string;
  attachmentName?: string;
}

export interface TimelineEvent {
  id: string;
  status: RequestStatus | 'created' | 'clarification_answered';
  title: string;
  description: string;
  actorName: string;
  timestamp: string;
}

export type PaymentMethod = 'instapay' | 'bank_transfer' | 'digital_wallet' | 'cash' | 'cheque';

export type RequestType = 'expense' | 'income';

export interface DisbursementDetails {
  disbursedAt: string;
  disbursedBy: string;
  paymentMethod: PaymentMethod;
  referenceNumber: string;
  bankName?: string;
  accountId?: string;
  accountName?: string;
  receiptUrl?: string;
  notes?: string;
}

export interface ExpenseRequest {
  id: string;
  requestNumber: string;
  orgId: string;
  requesterId: string;
  requesterName: string;
  requesterDepartment: string;
  requesterEmail?: string;
  requesterPhone?: string;
  preferredPaymentMethod?: PaymentMethod;
  paymentAccountDetails?: string; // e.g. InstaPay IPA (user@instapay) or IBAN or Mobile Wallet #
  serviceCategoryId: string;
  serviceCategoryName: string;
  providerId: string;
  providerName: string;
  title: string;
  description: string;
  justification: string;
  amount: number;
  currency: string;
  status: RequestStatus;
  urgency: 'low' | 'medium' | 'high';
  requestType?: RequestType; // 'expense' (صرف - فلوس خارجة) أو 'income' (توريد / تحصيل مالي وارد)
  targetAccountId?: string; // الخزينة أو الحساب المالي المرتبط
  itemsDetail?: string; // تفاصيل البضاعة أو الأصناف (اسم الصنف، الكمية، السعر)
  attachments: RequestAttachment[];
  comments: RequestComment[];
  timeline: TimelineEvent[];
  disbursement?: DisbursementDetails;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CurrencyOption {
  code: string;
  nameAr: string;
  symbol: string;
  label: string;
}

export const SUPPORTED_CURRENCIES: CurrencyOption[] = [
  { code: 'EGP', nameAr: 'جنيه مصري', symbol: 'ج.م', label: 'EGP - جنيه مصري' },
  { code: 'SAR', nameAr: 'ريال سعودي', symbol: 'ر.س', label: 'SAR - ريال سعودي' },
  { code: 'USD', nameAr: 'دولار أمريكي', symbol: '$', label: 'USD - دولار أمريكي' },
  { code: 'EUR', nameAr: 'يورو أوروبي', symbol: '€', label: 'EUR - يورو أوروبي' },
  { code: 'AED', nameAr: 'درهم إماراتي', symbol: 'د.إ', label: 'AED - درهم إماراتي' },
  { code: 'GBP', nameAr: 'جنيه إسترليني', symbol: '£', label: 'GBP - جنيه إسترليني' },
  { code: 'KWD', nameAr: 'دينار كويتي', symbol: 'د.ك', label: 'KWD - دينار كويتي' },
  { code: 'QAR', nameAr: 'ريال قطري', symbol: 'ر.ق', label: 'QAR - ريال قطري' },
  { code: 'BHD', nameAr: 'دينار بحريني', symbol: 'د.ب', label: 'BHD - دينار بحريني' },
  { code: 'OMR', nameAr: 'ريال عماني', symbol: 'ر.ع', label: 'OMR - ريال عماني' },
  { code: 'JOD', nameAr: 'دينار أردني', symbol: 'د.أ', label: 'JOD - دينار أردني' },
];

export type AuditActionType = 
  | 'create' 
  | 'update' 
  | 'rename' 
  | 'delete' 
  | 'status_toggle' 
  | 'budget_change'
  | 'password_reset'
  | 'role_change';

export type AuditEntityType = 
  | 'organization' 
  | 'member' 
  | 'service' 
  | 'provider' 
  | 'vault' 
  | 'department' 
  | 'role'
  | 'request'
  | 'custody'
  | 'transaction';

export interface AuditLogEntry {
  id: string;
  actionType: AuditActionType;
  entityType: AuditEntityType;
  entityId: string;
  entityName: string;
  orgId?: string;
  orgName?: string;
  actorId: string;
  actorName: string;
  actorEmail: string;
  details: string;
  timestamp: string;
}

export type PaymentAccountType = 'bank' | 'instapay' | 'wallet' | 'cash' | 'other';

export interface PaymentAccount {
  id: string;
  orgId: string;
  name: string; // e.g. "حساب بنك CIB الرئيسي" أو "خزينة كاش المقر" أو "إنستاباي الإدارة"
  type: PaymentAccountType;
  accountIdentifier: string; // IBAN, IPA (name@instapay), Mobile #, or Account #
  bankName?: string;
  parentAccountId?: string; // معرف الحساب البنكي الرئيسي التابع له (للخصم المزدوج التلقائي)
  parentAccountName?: string; // اسم الحساب البنكي الرئيسي
  balance?: number; // legacy alias
  initialBalance?: number;
  currentBalance?: number;
  totalIn?: number;
  totalOut?: number;
  currency: string;
  active: boolean;
  description?: string;
  createdAt: string;
  updatedAt?: string;
}

export type TransactionType = 'in' | 'out';
export type TransactionReferenceType = 'request' | 'manual_adjustment' | 'initial' | 'custody';

export interface AccountTransaction {
  id: string;
  orgId: string;
  accountId: string;
  accountName: string;
  type: TransactionType; // 'in' (وارد / إيداع / تحصيل) أو 'out' (منصرف / سحب)
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceType: TransactionReferenceType;
  referenceId?: string; // e.g. requestId
  referenceNumber?: string; // e.g. REQ-2026-001 or bank ref #
  description: string;
  actorName: string;
  actorId?: string;
  createdAt: string;
}

export type CustodyStatus = 'active' | 'settled' | 'replenished';

export interface PettyCashCustody {
  id: string;
  orgId: string;
  custodyNumber: string; // e.g. CUS-001
  employeeId: string;
  employeeName: string;
  employeePhone?: string;
  totalAmount: number;
  remainingAmount: number;
  settledAmount: number;
  currency: string;
  sourceAccountId: string;
  sourceAccountName: string;
  status: CustodyStatus;
  issuedAt: string;
  settledAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CustodySettlementItem {
  id: string;
  custodyId: string;
  orgId: string;
  employeeId: string;
  employeeName: string;
  amount: number;
  currency: string;
  serviceCategoryId?: string;
  serviceCategoryName?: string;
  vendorName?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  description: string;
  receiptUrl?: string;
  status: 'approved' | 'pending' | 'rejected';
  createdAt: string;
}

export interface Department {
  id: string;
  orgId: string;
  name: string;
  code?: string;
  description?: string;
  managerName?: string;
  createdAt: string;
  updatedAt?: string;
}

export type EmailEventType = 
  | 'new_request' 
  | 'request_approved' 
  | 'request_paid' 
  | 'clarification_requested' 
  | 'clarification_replied' 
  | 'request_rejected'
  | 'test_email';

export interface EmailNotificationSettings {
  enabled: boolean;
  notifyOnNewRequest: boolean;
  notifyOnApproval: boolean;
  notifyOnDisbursement: boolean;
  notifyOnClarification: boolean;
  notifyOnRejection: boolean;
  senderName: string;
  senderEmail?: string;
  replyToEmail?: string;
  deliveryMethod: 'direct_api' | 'firestore_mail' | 'webhook';
  directProvider?: 'resend' | 'brevo' | 'gmail' | 'auto';
  directApiKey?: string;
  webhookUrl?: string;
  emailJsServiceId?: string;
  emailJsTemplateId?: string;
  emailJsPublicKey?: string;
}

export interface EmailLogEntry {
  id: string;
  eventType: EmailEventType;
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  snippet: string;
  requestId?: string;
  requestNumber?: string;
  amount?: number;
  currency?: string;
  status: 'sent' | 'pending' | 'failed';
  errorMessage?: string;
  timestamp: string;
}


