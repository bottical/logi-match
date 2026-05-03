(function () {
  const DEFAULT_TENANT_ID = 'defaultTenant';
  const DEFAULT_TENANT_NAME = 'デフォルト倉庫';
  const DEFAULT_WORKER_ID = 'default-worker';

  function nowField() {
    return window.firebase.firestore.FieldValue.serverTimestamp();
  }

  window.bootstrapTenantIfNeeded = async function bootstrapTenantIfNeeded(user) {
    if (!window.db || !window.firebase?.firestore) {
      throw new Error('Firestore is not initialized.');
    }

    if (!user?.uid) {
      throw new Error('AUTH_USER_MISSING');
    }

    const userTenantRef = window.db.collection('userTenants').doc(user.uid);
    const userTenantSnap = await userTenantRef.get();

    if (userTenantSnap.exists) {
      return {
        created: false,
        tenantId: userTenantSnap.data()?.tenantId || null
      };
    }

    const tenantId = DEFAULT_TENANT_ID;
    const tenantRef = window.db.collection('tenants').doc(tenantId);
    const memberRef = tenantRef.collection('members').doc(user.uid);
    const workerRef = tenantRef.collection('workers').doc(DEFAULT_WORKER_ID);

    const [tenantSnap, workerSnap] = await Promise.all([
      tenantRef.get(),
      workerRef.get()
    ]);

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

    batch.set(userTenantRef, {
      tenantId,
      role: 'owner',
      displayName: user.displayName || user.email || '初期管理者',
      email: user.email || null,
      active: true,
      createdAt: now,
      updatedAt: now,
      bootstrap: true
    });

    batch.set(memberRef, {
      uid: user.uid,
      email: user.email || null,
      role: 'owner',
      displayName: user.displayName || user.email || '初期管理者',
      active: true,
      createdAt: now,
      updatedAt: now,
      bootstrap: true
    });

    if (!workerSnap.exists) {
      batch.set(workerRef, {
        workerCode: '001',
        workerName: '初期作業者',
        active: true,
        createdAt: now,
        updatedAt: now,
        bootstrap: true
      });
    }

    await batch.commit();

    return {
      created: true,
      tenantId
    };
  };
})();
