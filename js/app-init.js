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
        const user = await window.authApi.waitForAuthUser();
        if (!user) {
          location.href = './login.html';
          throw new Error('[app-init] unauthenticated');
        }

        const tenant = await window.tenantContext.resolve(user);
        if (!tenant || !tenant.clientId) throw new Error('[app-init] tenant/clientId could not be resolved');

        const paths = window.firestorePaths.createFirestorePaths(db, tenant.clientId);
        const role = tenant.role || tenant.userRole || 'worker';

        window.db = db;
        window.auth = auth;
        window.appContext = {
          ...(window.appContext || {}),
          ...(tenant || {}),
          uid: user.uid,
          userId: user.uid,
          email: user.email || null,
          clientId: tenant.clientId,
          tenantId: tenant.tenantId || tenant.clientId,
          role,
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
          tenantId: tenant.tenantId || tenant.clientId,
          clientId: tenant.clientId,
          role,
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
