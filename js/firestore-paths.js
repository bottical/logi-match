(function () {
  function assertClientId(clientId) {
    if (!clientId || typeof clientId !== 'string') {
      throw new Error('[firestore-paths] clientId is required');
    }
  }

  function createFirestorePaths(db, clientId) {
    if (!db) throw new Error('[firestore-paths] db is required');
    assertClientId(clientId);

    const clientRef = db.collection('clients').doc(clientId);

    return {
      client: () => clientRef,
      users: () => clientRef.collection('users'),
      workers: () => clientRef.collection('workers'),
      csvMappingCurrent: () => clientRef.collection('csvMapping').doc('current'),
      importBatches: () => clientRef.collection('importBatches'),
      inspectionWorks: () => clientRef.collection('inspectionWorks'),
      inspectionWork: (workId) => clientRef.collection('inspectionWorks').doc(workId),
      inspectionItems: (workId) => clientRef.collection('inspectionWorks').doc(workId).collection('items'),
      scanLogs: () => clientRef.collection('scanLogs'),
      operationLogs: () => clientRef.collection('operationLogs'),
    };
  }


  function byClientId(name, db, clientId, ...args) {
    const fn = createFirestorePaths(db || firebase.firestore(), clientId)[name];
    return fn(...args);
  }

  window.firestorePaths = {
    createFirestorePaths,
    users: (clientId) => byClientId('users', null, clientId),
    workers: (clientId) => byClientId('workers', null, clientId),
    csvMappingCurrent: (clientId) => byClientId('csvMappingCurrent', null, clientId),
    importBatches: (clientId) => byClientId('importBatches', null, clientId),
    inspectionWorks: (clientId) => byClientId('inspectionWorks', null, clientId),
    inspectionWork: (clientId, workId) => byClientId('inspectionWork', null, clientId, workId),
    inspectionItems: (clientId, workId) => byClientId('inspectionItems', null, clientId, workId),
    scanLogs: (clientId) => byClientId('scanLogs', null, clientId),
    operationLogs: (clientId) => byClientId('operationLogs', null, clientId),
  };
})();
