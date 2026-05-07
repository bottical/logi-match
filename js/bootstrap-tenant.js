(function () {
  // Legacy bootstrap is disabled in clientId-centric architecture.
  // Initial records (clients, userTenants, client users, systemUsers) are managed by internal tools/manual ops.
  window.bootstrapTenantIfNeeded = async function bootstrapTenantIfNeeded() {
    return { created: false, disabled: true };
  };
})();
