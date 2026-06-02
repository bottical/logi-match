(function () {
  let readyPromise = null;

  function requireFn(owner, name, label) {
    if (!owner || typeof owner[name] !== 'function') {
      throw new Error(`${label}.${name} is not available`);
    }
    return owner[name].bind(owner);
  }

  async function ready(pageId) {
    if (!readyPromise) {
      readyPromise = (async () => {
        if (!window.firebase) throw new Error('[app-init] Firebase SDK is not loaded');
        if (!window.authApi || typeof window.authApi.waitForAuthUser !== 'function') throw new Error('[app-init] authApi.waitForAuthUser is not available');
        if (!window.tenantContext || typeof window.tenantContext.resolve !== 'function') throw new Error('[app-init] tenantContext.resolve is not available');
        if (!window.firestorePaths || typeof window.firestorePaths.createFirestorePaths !== 'function') throw new Error('[app-init] firestorePaths.createFirestorePaths is not available');

        const app = firebase.app();
        const db = firebase.firestore();
        const auth = firebase.auth();

        window.db = db;
        window.auth = auth;

        const user = await window.authApi.waitForAuthUser();
        if (!user) {
          location.href = './login.html';
          throw new Error('[app-init] unauthenticated');
        }

        const tenant = await window.tenantContext.resolve(user);
        const role = tenant.role || tenant.userRole || 'worker';
        const clientId = tenant.clientId || tenant.tenantId || null;
        const tenantId = tenant.tenantId || tenant.clientId || null;
        const isSystemOwner = role === 'systemOwner' || tenant.isSystemOwner === true;
        const paths = clientId ? window.firestorePaths.createFirestorePaths({ ...tenant, clientId, tenantId }) : null;

        window.appContext = {
          ...(window.appContext || {}),
          ...(tenant || {}),
          user,
          uid: user.uid,
          userId: user.uid,
          email: user.email || tenant.email || null,
          clientId,
          tenantId,
          role,
          isSystemOwner,
          db,
          auth,
          paths,
        };

        return {
          app,
          db,
          auth,
          user,
          uid: user.uid,
          userId: user.uid,
          tenant,
          tenantId,
          clientId,
          role,
          isSystemOwner,
          paths,
        };
      })();
    }

    const ctx = await readyPromise;
    if (window.checkPagePermission && pageId) window.checkPagePermission(pageId);
    return ctx;
  }

  window.requireAppContext = async function requireAppContext(pageId) {
    await ready(pageId);
    return window.appContext;
  };
  window.initializeAppContext = window.requireAppContext;

  window.appInit = { ready, requireFn };
})();
