// src/config/rolePermissions.js
// Central access-control catalogue for PrimeJet OS.
// Keep this file dependency-free so it can be safely imported by models, services and middleware.

const ROLE_OPTIONS = [
  'super_admin',
  'admin',
  'owner',
  'investor',
  'finance_lead',
  'accountant',
  'operations_manager',
  'plant_manager',
  'manager',
  'cashier',
  'inventory_officer',
  'sales_agent',
  'support_agent',
  'auditor',
  'driver',
  'customer',
];

const BRANCH_SCOPE_OPTIONS = ['all', 'selected', 'own', 'none'];

const ROLE_META = {
  super_admin: { label: 'Super Admin', description: 'Full system control, including users, configuration, posting and diagnostics.' },
  admin: { label: 'Admin', description: 'Legacy full-access administrator role retained for backward compatibility.' },
  owner: { label: 'Owner / Executive', description: 'Executive read-only visibility across business performance.' },
  investor: { label: 'Investor', description: 'Read-only investor visibility by assigned branch scope.' },
  finance_lead: { label: 'Finance Lead', description: 'Finance control, GL, reporting, reversals and period controls.' },
  accountant: { label: 'Accountant', description: 'Finance reporting and review access with limited posting authority.' },
  operations_manager: { label: 'Operations Manager', description: 'Operational oversight across stock, plant, close and branch controls.' },
  plant_manager: { label: 'Plant Manager', description: 'Branch/plant-level supervision and approvals.' },
  manager: { label: 'Manager', description: 'Legacy manager role retained for existing operational routes.' },
  cashier: { label: 'Cashier', description: 'Point-of-sale capture and own close workspace only.' },
  inventory_officer: { label: 'Inventory Officer', description: 'Stock-in, stock movement and inventory-control access.' },
  sales_agent: { label: 'Sales / CRM Agent', description: 'Sales, customer and CRM access.' },
  support_agent: { label: 'Support Agent', description: 'Support desk, live chat and WhatsApp customer support.' },
  auditor: { label: 'Auditor', description: 'Read-only audit, control and report access.' },
  driver: { label: 'Driver', description: 'Driver/mobile execution role.' },
  customer: { label: 'Customer', description: 'Customer/mobile ordering role.' },
};

const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard.view',
  DASHBOARD_EXECUTIVE: 'dashboard.executive.view',

  INVESTOR_VIEW: 'investor.view',

  ANALYTICS_VIEW: 'analytics.view',
  ANALYTICS_BI_VIEW: 'analytics.bi.view',
  ANALYTICS_FLEET_VIEW: 'analytics.fleet.view',
  ANALYTICS_FLEET_MANAGE: 'analytics.fleet.manage',

  OPERATIONS_VIEW: 'operations.view',
  OPERATIONS_PLANT_VIEW: 'operations.plant.view',
  OPERATIONS_PLANT_MANAGE: 'operations.plant.manage',
  OPERATIONS_PRICING_VIEW: 'operations.pricing.view',
  OPERATIONS_PRICING_MANAGE: 'operations.pricing.manage',

  STOCK_VIEW: 'stock.view',
  STOCK_MANAGE: 'stock.manage',
  STOCK_ADJUST: 'stock.adjust',
  STOCK_VARIANCE_APPROVE: 'stock.variance.approve',

  FINANCE_VIEW: 'finance.view',
  FINANCE_REPORT_EXPORT: 'finance.report.export',
  FINANCE_GL_VIEW: 'finance.gl.view',
  FINANCE_GL_POST: 'finance.gl.post',
  FINANCE_GL_REBUILD: 'finance.gl.rebuild',
  FINANCE_GL_RETRY: 'finance.gl.retry',
  FINANCE_GL_REVERSE_REQUEST: 'finance.gl.reverse.request',
  FINANCE_GL_REVERSE_APPROVE: 'finance.gl.reverse.approve',
  FINANCE_PERIOD_LOCK: 'finance.period.lock',
  FINANCE_OPENING_BALANCE: 'finance.opening-balance.manage',
  FINANCE_SETTLEMENT_MANAGE: 'finance.settlement.manage',
  FINANCE_TAX_VIEW: 'finance.tax.view',
  FINANCE_ASSET_LOAN_VIEW: 'finance.asset-loan.view',
  FINANCE_UNIT_ECONOMICS_VIEW: 'finance.unit-economics.view',
  FINANCE_REVENUE_ASSURANCE_VIEW: 'finance.revenue-assurance.view',

  POS_VIEW: 'pos.view',
  POS_SALE_CREATE: 'pos.sale.create',
  POS_EXPENSE_CREATE: 'pos.expense.create',
  POS_CLOSE_SUBMIT: 'pos.close.submit',
  POS_CLOSE_APPROVE: 'pos.close.approve',
  POS_REVERSE_REQUEST: 'pos.reverse.request',
  POS_REVERSE_APPROVE: 'pos.reverse.approve',
  POS_HISTORY_VIEW: 'pos.history.view',

  SALES_VIEW: 'sales.view',
  SALES_MANAGE: 'sales.manage',
  SALES_CORPORATE_VIEW: 'sales.corporate.view',
  SALES_CORPORATE_MANAGE: 'sales.corporate.manage',
  CUSTOMER_VIEW: 'customer.view',
  CUSTOMER_MANAGE: 'customer.manage',
  SUPPORT_VIEW: 'support.view',
  WHATSAPP_VIEW: 'whatsapp.view',
  WHATSAPP_MANAGE: 'whatsapp.manage',

  MIGRATION_VIEW: 'migration.view',
  MIGRATION_UPLOAD: 'migration.upload',
  MIGRATION_VALIDATE: 'migration.validate',
  MIGRATION_IMPORT: 'migration.import',

  ADMIN_VIEW: 'admin.view',
  ADMIN_USERS_VIEW: 'admin.users.view',
  ADMIN_USERS_CREATE: 'admin.users.create',
  ADMIN_USERS_UPDATE: 'admin.users.update',
  ADMIN_USERS_DELETE: 'admin.users.delete',
  ADMIN_ROLES_MANAGE: 'admin.roles.manage',
  ADMIN_CONFIG_MANAGE: 'admin.config.manage',
  ADMIN_AUDIT_VIEW: 'admin.audit.view',
  ADMIN_DIAGNOSTICS_VIEW: 'admin.diagnostics.view',
  ADMIN_REFERENCE_MANAGE: 'admin.reference.manage',
  ADMIN_REPORTS_VIEW: 'admin.reports.view',
  ADMIN_BACKUP_EXPORT: 'admin.backup.export',
  ADMIN_INTEGRATIONS_MANAGE: 'admin.integrations.manage',
  ADMIN_NOTIFICATIONS_MANAGE: 'admin.notifications.manage',
  ADMIN_DATA_QUALITY_VIEW: 'admin.data-quality.view',
  ADMIN_APPROVAL_MATRIX_MANAGE: 'admin.approval-matrix.manage',
};

const VIEWER_PERMISSIONS = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.DASHBOARD_EXECUTIVE,
  PERMISSIONS.ANALYTICS_VIEW,
  PERMISSIONS.OPERATIONS_VIEW,
  PERMISSIONS.OPERATIONS_PLANT_VIEW,
  PERMISSIONS.STOCK_VIEW,
  PERMISSIONS.FINANCE_VIEW,
  PERMISSIONS.FINANCE_GL_VIEW,
  PERMISSIONS.FINANCE_UNIT_ECONOMICS_VIEW,
  PERMISSIONS.FINANCE_ASSET_LOAN_VIEW,
  PERMISSIONS.FINANCE_REPORT_EXPORT,
  PERMISSIONS.SALES_VIEW,
  PERMISSIONS.SALES_CORPORATE_VIEW,
  PERMISSIONS.CUSTOMER_VIEW,
  PERMISSIONS.ADMIN_REPORTS_VIEW,
];

const ROLE_PERMISSIONS = {
  super_admin: ['*'],
  admin: ['*'],
  owner: [
    ...VIEWER_PERMISSIONS,
    PERMISSIONS.FINANCE_REVENUE_ASSURANCE_VIEW,
    PERMISSIONS.FINANCE_TAX_VIEW,
    PERMISSIONS.ANALYTICS_BI_VIEW,
    PERMISSIONS.ANALYTICS_FLEET_VIEW,
  ],
  investor: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.DASHBOARD_EXECUTIVE,
    PERMISSIONS.INVESTOR_VIEW,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ANALYTICS_FLEET_VIEW,
    PERMISSIONS.OPERATIONS_VIEW,
    PERMISSIONS.OPERATIONS_PLANT_VIEW,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.FINANCE_VIEW,
    PERMISSIONS.FINANCE_GL_VIEW,
    PERMISSIONS.FINANCE_UNIT_ECONOMICS_VIEW,
    PERMISSIONS.FINANCE_ASSET_LOAN_VIEW,
    PERMISSIONS.FINANCE_REPORT_EXPORT,
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.ADMIN_REPORTS_VIEW,
  ],
  finance_lead: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.DASHBOARD_EXECUTIVE,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.OPERATIONS_VIEW,
    PERMISSIONS.OPERATIONS_PLANT_VIEW,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.FINANCE_VIEW,
    PERMISSIONS.FINANCE_REPORT_EXPORT,
    PERMISSIONS.FINANCE_GL_VIEW,
    PERMISSIONS.FINANCE_GL_POST,
    PERMISSIONS.FINANCE_GL_REBUILD,
    PERMISSIONS.FINANCE_GL_RETRY,
    PERMISSIONS.FINANCE_GL_REVERSE_REQUEST,
    PERMISSIONS.FINANCE_GL_REVERSE_APPROVE,
    PERMISSIONS.FINANCE_PERIOD_LOCK,
    PERMISSIONS.FINANCE_OPENING_BALANCE,
    PERMISSIONS.FINANCE_SETTLEMENT_MANAGE,
    PERMISSIONS.FINANCE_TAX_VIEW,
    PERMISSIONS.FINANCE_ASSET_LOAN_VIEW,
    PERMISSIONS.FINANCE_UNIT_ECONOMICS_VIEW,
    PERMISSIONS.ANALYTICS_FLEET_VIEW,
    PERMISSIONS.ANALYTICS_FLEET_MANAGE,
    PERMISSIONS.FINANCE_REVENUE_ASSURANCE_VIEW,
    PERMISSIONS.SALES_CORPORATE_VIEW,
    PERMISSIONS.POS_CLOSE_APPROVE,
    PERMISSIONS.POS_REVERSE_APPROVE,
    PERMISSIONS.POS_HISTORY_VIEW,
    PERMISSIONS.MIGRATION_VIEW,
    PERMISSIONS.MIGRATION_VALIDATE,
    PERMISSIONS.MIGRATION_IMPORT,
    PERMISSIONS.ADMIN_REPORTS_VIEW,
    PERMISSIONS.ADMIN_DATA_QUALITY_VIEW,
  ],
  accountant: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.ANALYTICS_FLEET_VIEW,
    PERMISSIONS.OPERATIONS_VIEW,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.FINANCE_VIEW,
    PERMISSIONS.FINANCE_REPORT_EXPORT,
    PERMISSIONS.FINANCE_GL_VIEW,
    PERMISSIONS.FINANCE_GL_RETRY,
    PERMISSIONS.FINANCE_GL_REVERSE_REQUEST,
    PERMISSIONS.FINANCE_SETTLEMENT_MANAGE,
    PERMISSIONS.FINANCE_TAX_VIEW,
    PERMISSIONS.FINANCE_ASSET_LOAN_VIEW,
    PERMISSIONS.FINANCE_UNIT_ECONOMICS_VIEW,
    PERMISSIONS.FINANCE_REVENUE_ASSURANCE_VIEW,
    PERMISSIONS.SALES_CORPORATE_VIEW,
    PERMISSIONS.POS_HISTORY_VIEW,
    PERMISSIONS.MIGRATION_VIEW,
    PERMISSIONS.ADMIN_REPORTS_VIEW,
    PERMISSIONS.ADMIN_DATA_QUALITY_VIEW,
  ],
  operations_manager: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ANALYTICS_FLEET_VIEW,
    PERMISSIONS.ANALYTICS_FLEET_MANAGE,
    PERMISSIONS.OPERATIONS_VIEW,
    PERMISSIONS.OPERATIONS_PLANT_VIEW,
    PERMISSIONS.OPERATIONS_PLANT_MANAGE,
    PERMISSIONS.OPERATIONS_PRICING_VIEW,
    PERMISSIONS.OPERATIONS_PRICING_MANAGE,
    PERMISSIONS.ANALYTICS_FLEET_VIEW,
    PERMISSIONS.ANALYTICS_FLEET_MANAGE,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.STOCK_MANAGE,
    PERMISSIONS.STOCK_ADJUST,
    PERMISSIONS.STOCK_VARIANCE_APPROVE,
    PERMISSIONS.POS_VIEW,
    PERMISSIONS.POS_CLOSE_APPROVE,
    PERMISSIONS.POS_REVERSE_REQUEST,
    PERMISSIONS.POS_REVERSE_APPROVE,
    PERMISSIONS.POS_HISTORY_VIEW,
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.SALES_CORPORATE_VIEW,
    PERMISSIONS.SALES_CORPORATE_MANAGE,
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.ADMIN_REPORTS_VIEW,
  ],
  plant_manager: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.ANALYTICS_FLEET_VIEW,
    PERMISSIONS.ANALYTICS_FLEET_MANAGE,
    PERMISSIONS.OPERATIONS_VIEW,
    PERMISSIONS.OPERATIONS_PLANT_VIEW,
    PERMISSIONS.OPERATIONS_PLANT_MANAGE,
    PERMISSIONS.OPERATIONS_PRICING_VIEW,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.STOCK_MANAGE,
    PERMISSIONS.POS_VIEW,
    PERMISSIONS.POS_CLOSE_APPROVE,
    PERMISSIONS.POS_REVERSE_REQUEST,
    PERMISSIONS.POS_HISTORY_VIEW,
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.SALES_CORPORATE_VIEW,
    PERMISSIONS.SALES_CORPORATE_MANAGE,
    PERMISSIONS.CUSTOMER_VIEW,
  ],
  manager: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ANALYTICS_FLEET_VIEW,
    PERMISSIONS.ANALYTICS_FLEET_MANAGE,
    PERMISSIONS.OPERATIONS_VIEW,
    PERMISSIONS.OPERATIONS_PLANT_VIEW,
    PERMISSIONS.OPERATIONS_PLANT_MANAGE,
    PERMISSIONS.OPERATIONS_PRICING_VIEW,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.STOCK_MANAGE,
    PERMISSIONS.POS_VIEW,
    PERMISSIONS.POS_CLOSE_APPROVE,
    PERMISSIONS.POS_REVERSE_REQUEST,
    PERMISSIONS.POS_REVERSE_APPROVE,
    PERMISSIONS.POS_HISTORY_VIEW,
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.SALES_CORPORATE_VIEW,
    PERMISSIONS.SALES_CORPORATE_MANAGE,
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.SUPPORT_VIEW,
    PERMISSIONS.FINANCE_VIEW,
    PERMISSIONS.FINANCE_GL_VIEW,
    PERMISSIONS.FINANCE_UNIT_ECONOMICS_VIEW,
    PERMISSIONS.ADMIN_REPORTS_VIEW,
  ],
  cashier: [
    PERMISSIONS.POS_VIEW,
    PERMISSIONS.POS_SALE_CREATE,
    PERMISSIONS.POS_EXPENSE_CREATE,
    PERMISSIONS.POS_CLOSE_SUBMIT,
    PERMISSIONS.POS_HISTORY_VIEW,
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.CUSTOMER_MANAGE,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.OPERATIONS_PRICING_VIEW,
  ],
  inventory_officer: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.ANALYTICS_FLEET_VIEW,
    PERMISSIONS.ANALYTICS_FLEET_MANAGE,
    PERMISSIONS.OPERATIONS_VIEW,
    PERMISSIONS.OPERATIONS_PLANT_VIEW,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.STOCK_MANAGE,
    PERMISSIONS.STOCK_ADJUST,
    PERMISSIONS.OPERATIONS_PRICING_VIEW,
    PERMISSIONS.ADMIN_REPORTS_VIEW,
  ],
  sales_agent: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.SALES_MANAGE,
    PERMISSIONS.SALES_CORPORATE_VIEW,
    PERMISSIONS.SALES_CORPORATE_MANAGE,
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.CUSTOMER_MANAGE,
    PERMISSIONS.SUPPORT_VIEW,
    PERMISSIONS.WHATSAPP_VIEW,
    PERMISSIONS.ANALYTICS_VIEW,
  ],
  support_agent: [
    PERMISSIONS.SUPPORT_VIEW,
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.CUSTOMER_MANAGE,
    PERMISSIONS.WHATSAPP_VIEW,
  ],
  auditor: [
    ...VIEWER_PERMISSIONS,
    PERMISSIONS.FINANCE_REVENUE_ASSURANCE_VIEW,
    PERMISSIONS.FINANCE_TAX_VIEW,
    PERMISSIONS.POS_HISTORY_VIEW,
    PERMISSIONS.MIGRATION_VIEW,
    PERMISSIONS.ADMIN_AUDIT_VIEW,
    PERMISSIONS.ADMIN_DATA_QUALITY_VIEW,
  ],
  driver: [PERMISSIONS.OPERATIONS_VIEW],
  customer: [],
};

const ALL_PERMISSION_NAMES = Object.values(PERMISSIONS);

const normalizeRole = (role) => ROLE_OPTIONS.includes(role) ? role : 'customer';

const dedupe = (items) => Array.from(new Set((items || []).filter(Boolean)));

const getBasePermissions = (role) => {
  const normalizedRole = normalizeRole(role);
  const base = ROLE_PERMISSIONS[normalizedRole] || [];
  if (base.includes('*')) return ['*', ...ALL_PERMISSION_NAMES];
  return dedupe(base);
};

const getEffectivePermissions = (user = {}) => {
  const role = normalizeRole(user.role);
  const basePermissions = getBasePermissions(role);
  if (basePermissions.includes('*')) return ['*', ...ALL_PERMISSION_NAMES];

  const directPermissions = Array.isArray(user.permissions) ? user.permissions : [];
  const overrideAdd = Array.isArray(user.permissionOverrides?.add) ? user.permissionOverrides.add : [];
  const overrideRemove = Array.isArray(user.permissionOverrides?.remove) ? user.permissionOverrides.remove : [];

  const merged = new Set([...basePermissions, ...directPermissions, ...overrideAdd]);
  overrideRemove.forEach((permission) => merged.delete(permission));
  return Array.from(merged).filter(Boolean).sort();
};

const hasPermission = (user, permission) => {
  if (!permission) return true;
  const effectivePermissions = getEffectivePermissions(user);
  return effectivePermissions.includes('*') || effectivePermissions.includes(permission);
};

const hasAnyPermission = (user, permissions = []) => {
  if (!permissions || permissions.length === 0) return true;
  const effectivePermissions = getEffectivePermissions(user);
  if (effectivePermissions.includes('*')) return true;
  return permissions.some((permission) => effectivePermissions.includes(permission));
};

const canManageUsers = (user) => hasAnyPermission(user, [PERMISSIONS.ADMIN_USERS_CREATE, PERMISSIONS.ADMIN_USERS_UPDATE, PERMISSIONS.ADMIN_ROLES_MANAGE]);

module.exports = {
  ROLE_OPTIONS,
  BRANCH_SCOPE_OPTIONS,
  ROLE_META,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ALL_PERMISSION_NAMES,
  normalizeRole,
  getBasePermissions,
  getEffectivePermissions,
  hasPermission,
  hasAnyPermission,
  canManageUsers,
};
