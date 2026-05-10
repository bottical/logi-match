(function () {
  function createFirestorePaths(ctxOrDb, maybeClientId) {
    let db = window.db || firebase.firestore();
    let ctx = ctxOrDb;
    if (ctxOrDb && typeof ctxOrDb.collection === 'function') {
      db = ctxOrDb;
      ctx = { clientId: maybeClientId, tenantId: maybeClientId };
    }
    if (!ctx) throw new Error('[firestore-paths] ctx is required');
    const clientId = ctx.clientId || ctx.tenantId;
    if (!clientId) throw new Error('[firestore-paths] clientId is required for client data path');

    const clientRoot = db.collection('clients').doc(clientId);
    const csvMapping = clientRoot.collection('csvMapping').doc('current');
    const importBatches = clientRoot.collection('importBatches');
    const inspectionWorks = clientRoot.collection('inspectionWorks');
    const scanLogs = clientRoot.collection('scanLogs');
    const operationLogs = clientRoot.collection('operationLogs');
    const workers = clientRoot.collection('workers');

    return {
      clientId,
      clientRoot,
      csvMapping,
      importBatches,
      inspectionWorks,
      inspectionWork: (workId) => inspectionWorks.doc(workId),
      inspectionItems: (workId) => inspectionWorks.doc(workId).collection('items'),
      scanLogs,
      operationLogs,
      workers,
      // backward compatible aliases
      clientDoc: () => clientRoot,
      client: () => clientRoot,
      users: () => clientRoot.collection('users'),
      csvMappingCurrent: () => csvMapping,
      importBatchesCollection: () => importBatches,
      inspectionWorksCollection: () => inspectionWorks,
      scanLogsCollection: () => scanLogs,
      operationLogsCollection: () => operationLogs,
      workersCollection: () => workers,
      clientRootRef: () => clientRoot,
      importBatchesRef: () => importBatches,
      inspectionWorksRef: () => inspectionWorks,
      scanLogsRef: () => scanLogs,
      operationLogsRef: () => operationLogs,
      workersRef: () => workers,
      userTenant: (uid) => db.collection('userTenants').doc(uid),
      systemUser: (uid) => db.collection('systemUsers').doc(uid),
    };
  }

  function fromClientId(clientId) {
    return createFirestorePaths({ clientId, tenantId: clientId });
  }

  window.firestorePaths = {
    createFirestorePaths,
    clientRoot: (clientId) => fromClientId(clientId).clientRoot,
    client: Object.assign((clientId) => fromClientId(clientId).clientRoot, {
      workers: (clientId) => fromClientId(clientId).workers,
    }),
    users: (clientId) => fromClientId(clientId).users(),
    workers: (clientId) => fromClientId(clientId).workers,
    csvMappingCurrent: (clientId) => fromClientId(clientId).csvMapping,
    importBatches: (clientId) => fromClientId(clientId).importBatches,
    inspectionWorks: (clientId) => fromClientId(clientId).inspectionWorks,
    inspectionWork: (clientId, workId) => fromClientId(clientId).inspectionWork(workId),
    inspectionItems: (clientId, workId) => fromClientId(clientId).inspectionItems(workId),
    inspectionWorkItems: (clientId, workId) => fromClientId(clientId).inspectionItems(workId),
    scanLogs: (clientId) => fromClientId(clientId).scanLogs,
    operationLogs: (clientId) => fromClientId(clientId).operationLogs,
  };
})();
