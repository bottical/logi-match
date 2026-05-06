(function(){
  const INTERNAL_ADMIN_EMAILS = ['maeda@there.co.jp'];

  function normalizeEmail(email){
    return String(email || '').trim().toLowerCase();
  }

  window.INTERNAL_ADMIN_EMAILS = INTERNAL_ADMIN_EMAILS;
  window.isInternalAdmin = function isInternalAdmin(ctx){
    const role = ctx?.role || null;
    const email = normalizeEmail(ctx?.email);
    return role === 'systemOwner' || INTERNAL_ADMIN_EMAILS.includes(email);
  };
})();
