(function () {
  function db() { return firebase.firestore(); }
  function clientRoot(clientId) { return db().collection('clients').doc(clientId); }
  const paths = {
    clientRoot,
    client: {
      workers(clientId) {
        if (!clientId) throw new Error('CLIENT_ID_MISSING');
        return clientRoot(clientId).collection('workers');
      },
    },
    users(clientId) { return clientRoot(clientId).collection('users'); },
    workers(clientId) { return paths.client.workers(clientId); },
    csvMappingCurrent(clientId) { return clientRoot(clientId).collection('csvMapping').doc('current'); },
    importBatches(clientId) { return clientRoot(clientId).collection('importBatches'); },
    inspectionWorks(clientId) { return clientRoot(clientId).collection('inspectionWorks'); },
    inspectionWork(clientId, workId) { return paths.inspectionWorks(clientId).doc(workId); },
    inspectionItems(clientId, workId) { return paths.inspectionWork(clientId, workId).collection('items'); },
    scanLogs(clientId) { return clientRoot(clientId).collection('scanLogs'); },
    operationLogs(clientId) { return clientRoot(clientId).collection('operationLogs'); },
  };
  window.firestorePaths = paths;
})();
