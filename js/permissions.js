(function () {
  const INTERNAL_ADMIN_ROLES = ['systemOwner', 'internal'];

  const pagePermissions = {
    inspection: ['admin', 'worker'],
    'master-import': ['admin'],
    'import-history': ['admin'],
    'unstarted-list': ['admin', 'worker'],
    'completed-list': ['admin'],
    'result-download': ['admin'],
    workers: ['admin'],
    'csv-mapping': ['admin'],
    'internal-users': INTERNAL_ADMIN_ROLES,
    'internal-workers': INTERNAL_ADMIN_ROLES,
  };

  function normalizeRole(value) {
    if (!value) return null;
    const role = String(value).trim();
    if (role === 'operator') return 'worker';
    if (role === 'owner') return 'admin';
    if (['admin', 'worker', 'systemOwner', 'internal'].includes(role)) return role;
    return null;
  }
  function hasPageAccess(pageId, role) { return (pagePermissions[pageId] || []).includes(normalizeRole(role)); }
  function isAdmin(ctx) { return normalizeRole(ctx?.role) === 'admin'; }
  function isSystemOwner(ctx) { return normalizeRole(ctx?.role) === 'systemOwner'; }
  function isInternalAdmin(ctx) { return INTERNAL_ADMIN_ROLES.includes(normalizeRole(ctx?.role)) || ctx?.isSystemOwner === true; }
  function hasPermission(permission, ctx) {
    const role = normalizeRole((ctx || window.appContext || {}).role);
    const map = {
      view_inspection: ['admin', 'worker'], import_master: ['admin'], download_results: ['admin'], reset_completed: ['admin'],
      force_unlock_work: ['admin', 'systemOwner'], manage_workers_internal: INTERNAL_ADMIN_ROLES, manage_login_users_internal: INTERNAL_ADMIN_ROLES, update_csv_mapping: ['admin'],
    };
    return (map[permission] || []).includes(role);
  }
  window.permissions = {
    pagePermissions, normalizeRole, hasPageAccess, isAdmin, isSystemOwner, isInternalAdmin, hasPermission,
    canViewAdminMenu: isAdmin,
    canDownloadResults: (ctx) => hasPermission('download_results', ctx),
    canUnlockCurrent: (ctx) => hasPermission('force_unlock_work', ctx),
    canResetCompleted: (ctx) => hasPermission('reset_completed', ctx),
    canEditCsvMapping: (ctx) => hasPermission('update_csv_mapping', ctx),
  };
})();
