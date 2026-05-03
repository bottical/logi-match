(function(){
  const ctx = { uid:null,email:null,tenantId:null,role:null,displayName:null,tenantName:null };
  window.appContext = ctx;

  window.loadTenantContext = async function loadTenantContext(user){
    if(!window.db) throw new Error('DB_UNAVAILABLE');
    const snap = await window.db.collection('userTenants').doc(user.uid).get();
    if(!snap.exists) throw new Error('TENANT_NOT_FOUND');
    const data=snap.data()||{};
    if(data.active!==true) throw new Error('TENANT_INACTIVE');
    Object.assign(ctx,{ uid:user.uid,email:user.email||null,tenantId:data.tenantId||null,role:data.role||null,displayName:data.displayName||null });
    if(!ctx.tenantId) throw new Error('TENANT_NOT_FOUND');
    const tenantSnap = await window.db.collection('tenants').doc(ctx.tenantId).get();
    ctx.tenantName = tenantSnap.exists ? (tenantSnap.data()?.name||null) : null;
    return ctx;
  };

  const pagePermissions = {
    inspection:['owner','admin','operator'], 'master-import':['owner','admin'], 'import-history':['owner','admin'], 'unstarted-list':['owner','admin','operator'], 'completed-list':['owner','admin'], 'result-download':['owner','admin']
  };
  window.checkPagePermission = function(pageId){
    const allowed = pagePermissions[pageId] || ['owner','admin','operator'];
    if(!allowed.includes(ctx.role)) throw new Error('PERMISSION_DENIED');
  };
})();
