// src/utils/constants.js
import {
    LayoutDashboard, BarChart2, Factory, Truck, ShoppingCart, Users, Settings,
    FileText, DollarSign, Banknote, Landmark, History, UserCheck, ShieldCheck, Bug, ScrollText,
    FilePlus, ClipboardCheck
} from 'lucide-react';
// Removed: TrendingUp, PackageCheck (from original warning list)

export const USER_ROLES = {
    ADMIN: 'Admin',
    FINANCE_LEAD: 'Finance Lead',
    MANAGER: 'Manager',
    CASHIER: 'Cashier',
};

export const EXPENSE_CATEGORIES = [
    'Logistics & Fuel',
    'Maintenance & Repairs',
    'Utilities (Electricity, Water)',
    'Salaries & Wages',
    'Office Supplies',
    'Marketing & Advertising',
    'Taxes & Levies',
    'Other',
];

export const NAV_ITEMS = [
    { id: 'Dashboard', icon: LayoutDashboard, label: 'Dashboard', module: 'Home', roles: [USER_ROLES.ADMIN, USER_ROLES.FINANCE_LEAD, USER_ROLES.MANAGER, USER_ROLES.CASHIER] },
    { id: 'FinancialStatements', icon: FileText, label: 'Financials', module: 'Finance', roles: [USER_ROLES.ADMIN, USER_ROLES.FINANCE_LEAD] },
    { id: 'RevenueAssurance', icon: Banknote, label: 'Revenue Assurance', module: 'Finance', roles: [USER_ROLES.ADMIN, USER_ROLES.FINANCE_LEAD] },
    { id: 'AssetAndLoan', icon: Landmark, label: 'Assets & Loans', module: 'Finance', roles: [USER_ROLES.ADMIN, USER_ROLES.FINANCE_LEAD] },
    { id: 'TaxCompliance', icon: DollarSign, label: 'Tax Compliance', module: 'Finance', roles: [USER_ROLES.ADMIN, USER_ROLES.FINANCE_LEAD] },
    { id: 'PlantStatus', icon: Factory, label: 'Plant Status', module: 'Operations', roles: [USER_ROLES.ADMIN, USER_ROLES.MANAGER] },
    { id: 'Inventory', icon: ShoppingCart, label: 'Inventory', module: 'Operations', roles: [USER_ROLES.ADMIN, USER_ROLES.MANAGER, USER_ROLES.CASHIER] },
    { id: 'Logistics', icon: Truck, label: 'Logistics', module: 'Operations', roles: [USER_ROLES.ADMIN, USER_ROLES.MANAGER] },
    { id: 'SalesAnalytics', icon: BarChart2, label: 'Sales Analytics', module: 'Sales', roles: [USER_ROLES.ADMIN, USER_ROLES.FINANCE_LEAD, USER_ROLES.MANAGER] },
    { id: 'CustomerHub', icon: UserCheck, label: 'Customer Hub', module: 'Sales', roles: [USER_ROLES.ADMIN, USER_ROLES.MANAGER] },
    { id: 'TransactionHistory', icon: ScrollText, label: 'Transaction History', module: 'Data Entry', roles: [USER_ROLES.ADMIN, USER_ROLES.FINANCE_LEAD, USER_ROLES.MANAGER] },
    { id: 'DailyLog', icon: FilePlus, label: 'Daily Transaction Log (POS)', module: 'Data Entry', roles: [USER_ROLES.ADMIN, USER_ROLES.CASHIER] },
    { id: 'ApprovalQueue', icon: ClipboardCheck, label: 'Approval Queue', module: 'Data Entry', roles: [USER_ROLES.ADMIN, USER_ROLES.MANAGER] },
    { id: 'UserManagement', icon: Users, label: 'User Management', module: 'Admin', roles: [USER_ROLES.ADMIN] },
    { id: 'Configuration', icon: Settings, label: 'Configuration', module: 'Admin', roles: [USER_ROLES.ADMIN] },
    { id: 'DataMigration', icon: History, label: 'Data Migration', module: 'Admin', roles: [USER_ROLES.ADMIN] },
    { id: 'AuditLog', icon: ShieldCheck, label: 'Audit Log', module: 'Admin', roles: [USER_ROLES.ADMIN] },
];