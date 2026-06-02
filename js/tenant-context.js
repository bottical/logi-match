(function(){
  const ctx = { uid:null,email:null,tenantId:null,clientId:null,role:null,displayName:null,tenantName:null,clientName:null,isSystemOwner:false };
  window.appContext = ctx;

  const INTERNAL_ADMIN_ROLES = ['systemOwner', 'internal'];

  function normalizeClientRole(value) {
    const role = String(value || '').trim();
    if (role === 'operator') return 'worker';
    if (role === 'owner') return 'admin';
    if (role === 'admin' || role === 'worker') return role;
    return null;
  }

  function normalizeSystemRole(value) {
    const role = String(value || '').trim();
    return INTERNAL_ADMIN_ROLES.includes(role) ? role : null;
  }

  async function resolve(user){
    if(!user || !user.uid) throw new Error('AUTH_USER_REQUIRED');
    if(!window.db) throw new Error('DB_UNAVAILABLE');

    const uid = user.uid;
    const systemUserSnap = await window.db.collection('systemUsers').doc(uid).get();
    const systemUser = systemUserSnap.exists ? (systemUserSnap.data() || {}) : null;
    const systemRole = normalizeSystemRole(systemUser?.role);
    if (systemUser && systemUser.isActive === true && systemRole) {
      const clientId = systemUser.clientId || systemUser.tenantId || null;
      Object.assign(ctx, {
        uid,
        email: user.email || systemUser.email || null,
        displayName: systemUser.displayName || user.displayName || user.email || '',
        clientId,
        tenantId: systemUser.tenantId || clientId,
        role: systemRole,
        isSystemOwner: systemRole === 'systemOwner',
        clientName: systemUser.clientName || systemUser.tenantName || null,
        tenantName: systemUser.tenantName || systemUser.clientName || null,
      });
      return { ...ctx };
    }

    const userTenantSnap = await window.db.collection('userTenants').doc(uid).get();
    if (!userTenantSnap.exists) throw new Error('USER_NOT_REGISTERED');
    const userTenant = userTenantSnap.data() || {};
    if (userTenant.active !== true) throw new Error('USER_TENANT_INACTIVE');
    const clientId = userTenant.clientId || userTenant.tenantId;
    if (!clientId) throw new Error('CLIENT_ID_MISSING');

    const clientSnap = await window.db.collection('clients').doc(clientId).get();
    if (!clientSnap.exists) throw new Error('CLIENT_NOT_FOUND');
    const client = clientSnap.data() || {};
    if (client.status === 'inactive' || client.isActive === false) throw new Error('CLIENT_INACTIVE');

    const clientUserSnap = await window.db.collection('clients').doc(clientId).collection('users').doc(uid).get();
    if (!clientUserSnap.exists) throw new Error('CLIENT_USER_NOT_FOUND');
    const clientUser = clientUserSnap.data() || {};
    if (clientUser.isActive === false) throw new Error('CLIENT_USER_INACTIVE');

    const role = normalizeClientRole(clientUser.role);
    if (!['admin', 'worker'].includes(role)) throw new Error('INVALID_CLIENT_ROLE');

    Object.assign(ctx, { uid, email: user.email || clientUser.email || null, displayName: clientUser.displayName || user.displayName || user.email || '', clientId, tenantId: clientId, role, isSystemOwner: false, clientName: client.clientName || client.name || null, tenantName: client.clientName || client.name || null });
    return { ...ctx };
  }

  window.checkPagePermission = function(pageId){
    if (!window.permissions?.hasPageAccess(pageId, ctx.role)) throw new Error('PERMISSION_DENIED');
  };
  window.loadTenantContext = async function(user){ return resolve(user); };
  window.tenantContext = { resolve };
})();
