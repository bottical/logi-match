(function(){
  const ctx = { uid:null,email:null,tenantId:null,clientId:null,role:null,displayName:null,tenantName:null,clientName:null };
  window.appContext = ctx;

  function normalizeRole(role) { return role === 'operator' ? 'worker' : (role || null); }

  async function resolve(user){
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
    if (!memberSnap.exists) {
      const now = window.firebase.firestore.FieldValue.serverTimestamp();
      member = {
        uid: user.uid,
        tenantId,
        role: userTenant.role || 'worker',
        active: true,
        email: user.email || null,
        displayName: user.displayName || user.email || '',
        createdAt: now,
        updatedAt: now,
      };
      await memberRef.set(member);
    } else if (member?.active === false) {
      throw new Error('USER_INACTIVE');
    }

    const resolvedRole = normalizeRole(member?.role || userTenant.role || null);
    if(!resolvedRole) throw new Error('ROLE_MISSING');

    const tenantSnap = await window.db.collection('tenants').doc(tenantId).get();
    if (!tenantSnap.exists) throw new Error('CLIENT_NOT_FOUND');
    const tenantData = tenantSnap.data() || {};
    if (tenantData.status === 'inactive' || tenantData.isActive === false) throw new Error('CLIENT_INACTIVE');

    const clientId = tenantData.clientId || tenantId;
    Object.assign(ctx,{ uid:user.uid,email:user.email||null,tenantId: tenantId || clientId,clientId: clientId || tenantId,role:resolvedRole,displayName:userTenant.displayName||member?.displayName||null,tenantName:tenantData.name||null,clientName:tenantData.clientName || tenantData.name || null });
    return { ...ctx, userRole: ctx.role, tenantId: ctx.tenantId || ctx.clientId, clientId: ctx.clientId || ctx.tenantId };
  }

  const pagePermissions = {
    inspection:['owner','admin','worker'], 'master-import':['owner','admin'], 'import-history':['owner','admin'], 'unstarted-list':['owner','admin','worker'], 'completed-list':['owner','admin'], 'result-download':['owner','admin'], 'workers':['owner','admin'], 'csv-mapping':['owner','admin'], 'internal-users':['systemOwner']
  };
  window.checkPagePermission = function(pageId){
    if (pageId === 'internal-users' && typeof window.isInternalAdmin === 'function') {
      if (!window.isInternalAdmin(ctx)) throw new Error('PERMISSION_DENIED');
      return;
    }
    const allowed = pagePermissions[pageId] || ['owner','admin','worker'];
    if(!allowed.includes(ctx.role)) throw new Error('PERMISSION_DENIED');
  };

  window.loadTenantContext = async function(user){ return resolve(user); };
  window.tenantContext = { resolve };
})();
