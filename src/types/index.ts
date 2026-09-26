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
  // Financial Payout Profile (بيانات استلام المستحقات المالية للموظف)
  instapay?: string; // عنوان إنستاباي IPA (مثال: name@instapay أو رقم الهاتف)
  wallet?: string; // رقم المحفظة الإلكترونية (فودافون كاش / أورنج / اتصالات / وي)
  walletProvider?: string; // مزود المحفظة (فودافون كاش، اتصالات كاش، أورنج، وي باي، إلخ)
  bankName?: string; // اسم البنك (CIB، الأهلي، بنك مصر، إلخ)
  iban?: string; // رقم الحساب المصرفي أو الآيبان الدولي IBAN
  preferredPaymentMethod?: PaymentMethod; // طريقة الاستلام المفضلة تلقائياً
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
  // Financial Payout Profile
  instapay?: string;
  wallet?: string;
  walletProvider?: string;
  bankName?: string;
  iban?: string;
  preferredPaymentMethod?: PaymentMethod;
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

export type PaymentMethod = 'instapay' | 'bank_transfer' | 'digital_wallet' | 'cash' | 'cheque' | 'wallet';

export type RequestType = 'expense' | 'income' | 'advance';

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
  requestType?: RequestType; // 'expense' (صرف) أو 'income' (توريد) أو 'advance' (سلفة)
  targetAccountId?: string; // الخزينة أو الحساب المالي المرتبط
  itemsDetail?: string; // تفاصيل البضاعة أو الأصناف (اسم الصنف، الكمية، السعر)
  isPrepaidByRequester?: boolean; // هل تم سداد المبلغ من الجيب الخاص مسبقاً (استرداد مصروفات / دفع شخصي)
  invoiceNumber?: string; // رقم الفاتورة أو الإيصال
  invoiceDate?: string; // تاريخ الفاتورة
  invoiceAttachment?: RequestAttachment; // المرفق الرئيسي للفاتورة أو إيصال السداد
  // Loan & Advance specifics
  installmentsCount?: number;
  installmentAmount?: number;
  settledAmount?: number;
  attachments: RequestAttachment[];
  comments: RequestComment[];
  timeline: TimelineEvent[];
  disbursement?: DisbursementDetails;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

// ==========================================
// VISA ISSUANCE & EXPENSE MODULE TYPES
// ==========================================

export type VisaType = 'tourist' | 'umrah_barcode' | 'external_umrah';

export const VISA_TYPE_LABELS: Record<VisaType, string> = {
  tourist: 'سياحية (Tourist)',
  umrah_barcode: 'عمرة باركود (Umrah Barcode)',
  external_umrah: 'عمرة خارجي (External Umrah)',
};

export type VisaStatus = 'pending' | 'approved' | 'partially_paid' | 'paid' | 'rejected';

export const VISA_STATUS_LABELS: Record<VisaStatus, { label: string; color: string; bg: string }> = {
  pending: { label: 'قيد الاعتماد', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  approved: { label: 'معتمد (بانتظار السداد)', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  partially_paid: { label: 'مسدد جزئياً', color: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-200' },
  paid: { label: 'تم السداد بالكامل', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
  rejected: { label: 'مرفوض', color: 'text-rose-700', bg: 'bg-rose-50 border-rose-200' },
};

export interface VisaPaymentRecord {
  id: string;
  visaRequestId: string;
  amount: number;
  currency: string;
  date: string;
  paymentMethod: PaymentMethod;
  accountId?: string;
  accountName?: string;
  receiptReference?: string;
  receiptUrl?: string;
  receiptFileName?: string;
  notes?: string;
  recordedBy: string;
  recordedByName?: string;
  recordedAt: string;
}

export interface VisaRequest {
  id: string;
  requestNumber: string; // e.g. VISA-2026-0001
  orgId: string;
  requestDate: string; // System Timestamp / Read-only
  
  // Passenger / Traveler Information
  travelerName: string;
  passportNumber: string;
  hasTraveledBefore: boolean;
  expectedTravelDate: string; // YYYY-MM-DD (must be in future)
  visaType: VisaType;
  
  // Service Provider & Processing
  visaAttachmentUrl?: string;
  visaAttachmentName?: string;
  visaAttachmentSize?: number;
  serviceProviderId: string;
  serviceProviderName: string;
  
  // Approval Workflow
  status: VisaStatus;
  assignedApprover: string; // Assigned to "Mahmoud"
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  rejectionReason?: string;
  
  // Expense & Financial Processing
  totalAmount: number;
  currency: string;
  paymentMode: 'full' | 'installments';
  paidAmount: number;
  remainingBalance: number;
  payments: VisaPaymentRecord[];
  
  // Metadata & Audit
  requesterId: string;
  requesterName: string;
  requesterEmail?: string;
  notes?: string;
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


