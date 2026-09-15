import { 
  Organization, 
  OrganizationMember, 
  ServiceCategory, 
  ServiceProvider, 
  ExpenseRequest 
} from '../types';

// Zero fake/hardcoded data. All data is managed dynamically via Firebase Cloud Firestore or user input.
export const initialOrganizations: Organization[] = [];
export const initialMembers: OrganizationMember[] = [];
export const initialServices: ServiceCategory[] = [];
export const initialProviders: ServiceProvider[] = [];
export const initialRequests: ExpenseRequest[] = [];
