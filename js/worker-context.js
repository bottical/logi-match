(function(){
  window.workerContext = { workers:[], selectedWorker:null };
  function key(tid){ return `logimatch:selectedWorker:${tid||'default'}`; }
  window.setWorkerList = function(workers){
    window.workerContext.workers = Array.isArray(workers) ? workers : [];
  };
  window.loadWorkers = async function loadWorkers(tenantId){
    const clientId = window.appContext?.clientId || window.appContext?.tenantId || tenantId;
    if(!clientId){
      console.warn('[workers] clientId missing', window.appContext);
      throw new Error('CLIENT_ID_MISSING');
    }
    const workersRef =
      window.firestorePaths?.client?.workers?.(clientId) ||
      window.firestorePaths?.workers?.(clientId) ||
      window.db.collection('clients').doc(clientId).collection('workers');
    const snap = await workersRef.get();
    const workers = snap.docs
      .map(d=>({id:d.id,workerId:d.data().workerId||d.id,workerName:d.data().workerName||d.data().name||d.id,...d.data()}))
      .filter((w)=>w.isActive!==false && w.active!==false)
      .sort((a,b)=>{
        const sortA = Number(a.sortOrder ?? 999999);
        const sortB = Number(b.sortOrder ?? 999999);
        return sortA - sortB || String(a.workerName).localeCompare(String(b.workerName),'ja');
      });
    console.info('[workers] loaded',{
      clientId,
      count:workers.length,
      workers:workers.map(w=>w.workerName),
    });
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
