(function () {
  function getDb(db) {
    if (db) return db;
    if (window.db) return window.db;
    if (window.firebase) return firebase.firestore();
    throw new Error('[firestore-paths] db is required');
  }

  function assertClientId(clientId) {
    if (!clientId || typeof clientId !== 'string') {
      throw new Error('[firestore-paths] clientId is required');
    }
  }

  function assertWorkId(workId) {
    if (!workId || typeof workId !== 'string') {
      throw new Error('[firestore-paths] workId is required');
    }
  }

  function clientRoot(clientId, db) {
    assertClientId(clientId);
    return getDb(db).collection('clients').doc(clientId);
  }

  function createFirestorePaths(db, clientId) {
    const clientRef = clientRoot(clientId, db);

    return {
      client: () => clientRef,
      clientRoot: () => clientRef,
      users: () => clientRef.collection('users'),
      workers: () => clientRef.collection('workers'),
      csvMappingCurrent: () => clientRef.collection('csvMapping').doc('current'),
      importBatches: () => clientRef.collection('importBatches'),
      inspectionWorks: () => clientRef.collection('inspectionWorks'),
      inspectionWork: (workId) => {
        assertWorkId(workId);
        return clientRef.collection('inspectionWorks').doc(workId);
      },
      inspectionItems: (workId) => {
        assertWorkId(workId);
        return clientRef.collection('inspectionWorks').doc(workId).collection('items');
      },
      scanLogs: () => clientRef.collection('scanLogs'),
      operationLogs: () => clientRef.collection('operationLogs'),
    };
  }

  function users(clientId) {
    return clientRoot(clientId).collection('users');
  }
  function workers(clientId) {
    return clientRoot(clientId).collection('workers');
  }
  function csvMappingCurrent(clientId) {
    return clientRoot(clientId).collection('csvMapping').doc('current');
  }
  function importBatches(clientId) {
    return clientRoot(clientId).collection('importBatches');
  }
  function inspectionWorks(clientId) {
    return clientRoot(clientId).collection('inspectionWorks');
  }
  function inspectionWork(clientId, workId) {
    assertWorkId(workId);
    return inspectionWorks(clientId).doc(workId);
  }
  function inspectionItems(clientId, workId) {
    assertWorkId(workId);
    return inspectionWork(clientId, workId).collection('items');
  }
  function scanLogs(clientId) {
    return clientRoot(clientId).collection('scanLogs');
  }
  function operationLogs(clientId) {
    return clientRoot(clientId).collection('operationLogs');
  }

  window.firestorePaths = {
    createFirestorePaths,

    // Legacy compatibility
    clientRoot,
    client: {
      workers,
    },

    users,
    workers,
    csvMappingCurrent,
    importBatches,
    inspectionWorks,
    inspectionWork,
    inspectionItems,
    scanLogs,
    operationLogs,
  };
})();
