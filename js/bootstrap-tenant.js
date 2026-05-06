(function () {
  const DEFAULT_TENANT_ID = 'defaultTenant';
  const DEFAULT_TENANT_NAME = 'デフォルトテナント';

  function nowField() {
    return window.firebase.firestore.FieldValue.serverTimestamp();
  }

  window.bootstrapTenantIfNeeded = async function bootstrapTenantIfNeeded(user) {
    if (!window.db || !window.firebase?.firestore) throw new Error('Firestore is not initialized.');
    if (!user?.uid) throw new Error('AUTH_USER_MISSING');

    const userTenantRef = window.db.collection('userTenants').doc(user.uid);
    const userTenantSnap = await userTenantRef.get();
    if (userTenantSnap.exists) return { created: false, tenantId: userTenantSnap.data()?.tenantId || null };

    const tenantId = DEFAULT_TENANT_ID;
    const tenantRef = window.db.collection('tenants').doc(tenantId);
    const memberRef = tenantRef.collection('members').doc(user.uid);
    const tenantSnap = await tenantRef.get();

    const batch = window.db.batch();
    const now = nowField();

    if (!tenantSnap.exists) {
      batch.set(tenantRef, {
        name: DEFAULT_TENANT_NAME,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        bootstrap: true,
        bootstrapByUid: user.uid,
        bootstrapByEmail: user.email || null
      });
    }

    const base = {
      tenantId,
      role: 'owner',
      active: true,
      email: user.email || null,
      displayName: user.displayName || user.email || '',
      createdAt: now,
      updatedAt: now
    };

    batch.set(userTenantRef, base);
    batch.set(memberRef, { uid: user.uid, ...base });
    await batch.commit();
    return { created: true, tenantId };
  };
})();
