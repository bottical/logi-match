(function(){
  window.workerContext = { workers:[], selectedWorker:null };
  function key(tid){ return `selectedWorkerId:${tid}`; }
  window.loadWorkers = async function(tenantId){
    const snap = await window.db.collection('tenants').doc(tenantId).collection('workers').where('active','==',true).get();
    window.workerContext.workers = snap.docs.map(d=>({workerId:d.id,...d.data()}));
    return window.workerContext.workers;
  };
  window.restoreSelectedWorker = function(tenantId){
    const id=localStorage.getItem(key(tenantId));
    if(!id) return null;
    const w=window.workerContext.workers.find(x=>x.workerId===id);
    window.workerContext.selectedWorker=w||null;
    return w||null;
  };
  window.selectWorker = function(tenantId,workerId){
    const w=window.workerContext.workers.find(x=>x.workerId===workerId)||null;
    window.workerContext.selectedWorker=w;
    if(w) localStorage.setItem(key(tenantId),workerId); else localStorage.removeItem(key(tenantId));
    return w;
  };
})();
