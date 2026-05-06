(function(){
  const ctx = { uid:null,email:null,tenantId:null,clientId:null,role:null,displayName:null,tenantName:null,clientName:null };
  window.appContext = ctx;

  function normalizeRole(role) {
    if (role === 'operator') return 'worker';
    return role || null;
  }

  window.loadTenantContext = async function loadTenantContext(user){
    if(!window.db) throw new Error('DB_UNAVAILABLE');

    const userTenantRef = window.db.collection('userTenants').doc(user.uid);
    let userTenantSnap = await userTenantRef.get();
    if(!userTenantSnap.exists && typeof window.bootstrapTenantIfNeeded === 'function') {
      await window.bootstrapTenantIfNeeded(user);
      userTenantSnap = await userTenantRef.get();
    }
    if(!userTenantSnap.exists) throw new Error('USER_NOT_REGISTERED');

    const userTenant = userTenantSnap.data() || {};
    if(userTenant.active!==true) throw new Error('USER_INACTIVE');

    const tenantId = userTenant.tenantId || null;
    if(!tenantId) throw new Error('CLIENT_ID_MISSING');

    const memberRef = window.db.collection('tenants').doc(tenantId).collection('members').doc(user.uid);
    const memberSnap = await memberRef.get();
    let member = memberSnap.data() || null;
    if(member?.active===false) throw new Error('USER_INACTIVE');

    if(!memberSnap.exists){
      const now = window.firebase.firestore.FieldValue.serverTimestamp();
      member = {
        uid: user.uid,
        tenantId,
        role: userTenant.role || 'owner',
        active: true,
        email: user.email || null,
        displayName: user.displayName || user.email || '',
        createdAt: now,
        updatedAt: now
      };
      await memberRef.set(member);
    }

    const resolvedRole = normalizeRole(member?.role || userTenant.role || null);
    if(!resolvedRole) throw new Error('ROLE_MISSING');
    if(!['admin','worker','owner','systemOwner'].includes(resolvedRole)) throw new Error('ROLE_MISSING');
    Object.assign(ctx,{ uid:user.uid,email:user.email||null,tenantId,clientId:tenantId,role:resolvedRole,displayName:userTenant.displayName||member?.displayName||null });
    const tenantSnap = await window.db.collection('tenants').doc(ctx.tenantId).get();
    if (!tenantSnap.exists) throw new Error('CLIENT_NOT_FOUND');
    if (tenantSnap.data()?.status === 'inactive' || tenantSnap.data()?.isActive === false) throw new Error('CLIENT_INACTIVE');
    ctx.tenantName = tenantSnap.exists ? (tenantSnap.data()?.name||null) : null;
    ctx.clientId = tenantSnap.exists ? (tenantSnap.data()?.clientId || tenantId) : tenantId;
    ctx.clientName = tenantSnap.exists ? (tenantSnap.data()?.clientName || ctx.tenantName) : ctx.tenantName;
    return ctx;
  };

  const pagePermissions = {
    inspection:['owner','admin','worker'], 'master-import':['owner','admin'], 'import-history':['owner','admin'], 'unstarted-list':['owner','admin','worker'], 'completed-list':['owner','admin'], 'result-download':['owner','admin'], 'internal-users':['systemOwner']
  };
  window.checkPagePermission = function(pageId){
    if (pageId === 'internal-users' && typeof window.isInternalAdmin === 'function') {
      if (!window.isInternalAdmin(ctx)) throw new Error('PERMISSION_DENIED');
      return;
    }
    const allowed = pagePermissions[pageId] || ['owner','admin','worker'];
    if(!allowed.includes(ctx.role)) throw new Error('PERMISSION_DENIED');
  };
})();
