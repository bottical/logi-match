(function () {
  function createFirestorePaths(ctx) {
    if (!ctx) throw new Error('[firestore-paths] ctx is required');
    const db = window.db || firebase.firestore();
    function requireClientId() {
      const clientId = ctx.clientId || ctx.tenantId;
      if (!clientId) throw new Error('[firestore-paths] clientId is required for client data path');
      return clientId;
    }
    function clientDoc(clientId = requireClientId()) { return db.collection('clients').doc(clientId); }
    function clientCollection(name, clientId = requireClientId()) { return clientDoc(clientId).collection(name); }

    return {
      clientId: ctx.clientId || ctx.tenantId || null,
      clientDoc,
      client: clientDoc,
      clientRoot: clientDoc,
      users: (clientId) => clientCollection('users', clientId),
      workers: (clientId) => clientCollection('workers', clientId),
      csvMappingCurrent: (clientId) => clientDoc(clientId || requireClientId()).collection('csvMapping').doc('current'),
      importBatches: (clientId) => clientCollection('importBatches', clientId),
      inspectionWorks: (clientId) => clientCollection('inspectionWorks', clientId),
      inspectionWork: (workId, clientId) => clientCollection('inspectionWorks', clientId).doc(workId),
      inspectionItems: (workId, clientId) => clientCollection('inspectionWorks', clientId).doc(workId).collection('items'),
      scanLogs: (clientId) => clientCollection('scanLogs', clientId),
      operationLogs: (clientId) => clientCollection('operationLogs', clientId),
      userTenant: (uid) => db.collection('userTenants').doc(uid),
      systemUser: (uid) => db.collection('systemUsers').doc(uid),
    };
  }

  function fromClientId(clientId) {
    return createFirestorePaths({ clientId, tenantId: clientId });
  }

  window.firestorePaths = {
    createFirestorePaths,
    clientRoot: (clientId) => fromClientId(clientId).clientRoot(),
    client: Object.assign((clientId) => fromClientId(clientId).client(), {
      workers: (clientId) => fromClientId(clientId).workers(),
    }),
    users: (clientId) => fromClientId(clientId).users(),
    workers: (clientId) => fromClientId(clientId).workers(),
    csvMappingCurrent: (clientId) => fromClientId(clientId).csvMappingCurrent(),
    importBatches: (clientId) => fromClientId(clientId).importBatches(),
    inspectionWorks: (clientId) => fromClientId(clientId).inspectionWorks(),
    inspectionWork: (clientId, workId) => fromClientId(clientId).inspectionWork(workId),
    inspectionItems: (clientId, workId) => fromClientId(clientId).inspectionItems(workId),
    scanLogs: (clientId) => fromClientId(clientId).scanLogs(),
    operationLogs: (clientId) => fromClientId(clientId).operationLogs(),
  };
})();
