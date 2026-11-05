/** Permission catalog + default role grants. Seeded into Role/Permission tables; checked from DB at runtime. */
export const P = {
  // platform
  PLATFORM_TENANTS: 'platform.tenants.manage',
  PLATFORM_PLANS: 'platform.plans.manage',
  PLATFORM_READ_ALL: 'platform.read_all',
  PLATFORM_REFUNDS: 'platform.refunds.manage',
  PLATFORM_SETTINGS: 'platform.settings.manage',
  PLATFORM_AUDIT: 'platform.audit.read',
  // tenant
  TENANT_SETTINGS: 'tenant.settings.manage',
  TENANT_STAFF: 'tenant.staff.manage',
  TENANT_BILLING: 'tenant.billing.manage',
  FACILITY_MANAGE: 'facility.manage',
  FACILITY_READ: 'facility.read',
  RATES_MANAGE: 'rates.manage',
  SESSION_READ: 'session.read',
  SESSION_ENTRY: 'session.entry',
  SESSION_EXIT: 'session.exit',
  PAYMENT_COLLECT_CASH: 'payment.collect_cash',
  PAYMENT_READ: 'payment.read',
  REFUND_REQUEST: 'refund.request',
  RESERVATION_MANAGE: 'reservation.manage',
  PASS_MANAGE: 'pass.manage',
  SHIFT_OWN: 'shift.own',
  SHIFT_RECONCILE: 'shift.reconcile',
  OVERRIDE_REQUEST: 'override.request',
  OVERRIDE_APPROVE: 'override.approve',
  HARDWARE_MANAGE: 'hardware.manage',
  HARDWARE_READ: 'hardware.read',
  ANPR_REVIEW: 'anpr.review',
  VALET_OPERATE: 'valet.operate',
  INCIDENT_REPORT: 'incident.report',
  INCIDENT_MANAGE: 'incident.manage',
  REPORTS_READ: 'reports.read',
  CORPORATE_MANAGE: 'corporate.manage',
} as const;

export type PermissionKey = (typeof P)[keyof typeof P];

const all = Object.values(P);
const tenantAll = all.filter((p) => !p.startsWith('platform.'));

export const DEFAULT_ROLES: { key: string; name: string; scope: 'PLATFORM' | 'TENANT'; permissions: PermissionKey[] }[] = [
  { key: 'PLATFORM_ADMIN', name: 'Super Admin', scope: 'PLATFORM', permissions: all },
  {
    key: 'PLATFORM_SUPPORT',
    name: 'Platform Support',
    scope: 'PLATFORM',
    permissions: [P.PLATFORM_READ_ALL, P.PLATFORM_AUDIT, P.FACILITY_READ, P.SESSION_READ, P.PAYMENT_READ, P.REPORTS_READ],
  },
  { key: 'TENANT_OWNER', name: 'Owner', scope: 'TENANT', permissions: tenantAll },
  {
    key: 'FACILITY_MANAGER',
    name: 'Facility Manager',
    scope: 'TENANT',
    permissions: tenantAll.filter((p) => p !== P.TENANT_BILLING && p !== P.TENANT_SETTINGS),
  },
  {
    key: 'SUPERVISOR',
    name: 'Supervisor',
    scope: 'TENANT',
    permissions: [
      P.FACILITY_READ, P.SESSION_READ, P.SESSION_ENTRY, P.SESSION_EXIT, P.PAYMENT_COLLECT_CASH, P.PAYMENT_READ,
      P.SHIFT_OWN, P.SHIFT_RECONCILE, P.OVERRIDE_REQUEST, P.OVERRIDE_APPROVE, P.ANPR_REVIEW, P.HARDWARE_READ,
      P.INCIDENT_REPORT, P.INCIDENT_MANAGE, P.RESERVATION_MANAGE, P.VALET_OPERATE, P.REPORTS_READ, P.REFUND_REQUEST,
    ],
  },
  {
    key: 'CASHIER',
    name: 'Cashier',
    scope: 'TENANT',
    permissions: [P.FACILITY_READ, P.SESSION_READ, P.SESSION_EXIT, P.PAYMENT_COLLECT_CASH, P.SHIFT_OWN, P.OVERRIDE_REQUEST, P.INCIDENT_REPORT],
  },
  {
    key: 'GATE_ATTENDANT',
    name: 'Gate Attendant',
    scope: 'TENANT',
    permissions: [
      P.FACILITY_READ, P.SESSION_READ, P.SESSION_ENTRY, P.SESSION_EXIT, P.PAYMENT_COLLECT_CASH, P.SHIFT_OWN,
      P.OVERRIDE_REQUEST, P.INCIDENT_REPORT, P.HARDWARE_READ,
    ],
  },
  {
    key: 'VALET_DRIVER',
    name: 'Valet Driver',
    scope: 'TENANT',
    permissions: [P.FACILITY_READ, P.SESSION_READ, P.VALET_OPERATE, P.INCIDENT_REPORT, P.SHIFT_OWN],
  },
];
