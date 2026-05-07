(function () {
  function normalizeRole(role) {
    const value = String(role || '').trim();
    if (value === 'operator') return 'worker';
    return value;
  }

  function isAdmin(ctx) {
    return normalizeRole(ctx?.role) === 'admin';
  }

  function isSystemOwner(ctx) {
    return normalizeRole(ctx?.role) === 'systemOwner';
  }

  function canViewAdminMenu(ctx) { return isAdmin(ctx) || isSystemOwner(ctx); }
  function canDownloadResults(ctx) { return canViewAdminMenu(ctx); }
  function canUnlockCurrent(ctx) { return canViewAdminMenu(ctx); }
  function canResetCompleted(ctx) { return canViewAdminMenu(ctx); }
  function canEditCsvMapping(ctx) { return canViewAdminMenu(ctx); }

  window.permissions = {
    normalizeRole,
    isAdmin,
    isSystemOwner,
    canViewAdminMenu,
    canDownloadResults,
    canUnlockCurrent,
    canResetCompleted,
    canEditCsvMapping,
  };
})();
