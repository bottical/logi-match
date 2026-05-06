(function(){
  window.workerContext = { workers:[], selectedWorker:null };
  function key(tid){ return `logimatch:selectedWorker:${tid||'default'}`; }
  window.setWorkerList = function(workers){
    window.workerContext.workers = Array.isArray(workers) ? workers : [];
  };
  window.loadWorkers = async function(tenantId){
    const clientId = window.appContext?.clientId || tenantId;
    const snap = await window.firestorePaths.workers(clientId).get();
    const workers = snap.docs.map(d=>({workerId:d.id,...d.data()})).filter((w)=>w.isActive!==false && w.active!==false);
    window.setWorkerList(workers);
    return window.workerContext.workers;
  };
  window.restoreSelectedWorker = function(tenantId){
    try{
      const raw=localStorage.getItem(key(tenantId));
      if(!raw) return null;
      const saved=JSON.parse(raw);
      const w=window.workerContext.workers.find(x=>String(x.workerId)===String(saved?.workerId))||null;
      if(!w){
        localStorage.removeItem(key(tenantId));
        window.workerContext.selectedWorker=null;
        return null;
      }
      window.workerContext.selectedWorker=w;
      return w;
    }catch(e){
      console.warn('[workerContext] restore failed',e);
      localStorage.removeItem(key(tenantId));
      window.workerContext.selectedWorker=null;
      return null;
    }
  };
  window.selectWorker = function(tenantId,workerId){
    const w=window.workerContext.workers.find(x=>String(x.workerId)===String(workerId))||null;
    window.workerContext.selectedWorker=w;
    if(w){
      localStorage.setItem(key(tenantId),JSON.stringify({
        workerId:w.workerId,
        workerName:w.workerName||'',
        workerCode:w.workerCode||''
      }));
    }else{
      localStorage.removeItem(key(tenantId));
    }
    return w;
  };
})();
