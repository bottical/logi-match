(function () {
  const pagePermissions = {
    inspection: ['admin', 'worker'],
    'master-import': ['admin'],
    'import-history': ['admin'],
    'unstarted-list': ['admin', 'worker'],
    'completed-list': ['admin'],
    'result-download': ['admin'],
    workers: ['admin'],
    'csv-mapping': ['admin'],
    'internal-users': ['systemOwner'],
    'internal-workers': ['systemOwner'],
  };

  function normalizeRole(value) {
    if (!value) return null;
    const role = String(value).trim();
    if (role === 'operator') return 'worker';
    if (role === 'owner') return 'admin';
    if (['admin', 'worker', 'systemOwner'].includes(role)) return role;
    return null;
  }

  function hasPageAccess(pageId, role) {
    const normalized = normalizeRole(role);
    const allowed = pagePermissions[pageId] || [];
    return allowed.includes(normalized);
  }

  function isAdmin(ctx) {
    return normalizeRole(ctx?.role) === 'admin';
  }

  function isSystemOwner(ctx) {
    return normalizeRole(ctx?.role) === 'systemOwner';
  }

  window.permissions = {
    pagePermissions,
    normalizeRole,
    hasPageAccess,
    isAdmin,
    isSystemOwner,
    canViewAdminMenu: isAdmin,
    canDownloadResults: isAdmin,
    canUnlockCurrent: isAdmin,
    canResetCompleted: isAdmin,
    canEditCsvMapping: isAdmin,
  };
})();
