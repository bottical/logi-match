window.inspectionState = {
  work: {
    work_id: null,
    recipient_name: '',
    status: 'unstarted',
    current_worker_id: null,
    completed_flag: false
  },
  details: [],
  recentScan: null,
  syncStatus: 'idle',
  lock: { locked: false, reason: null, worker_id: null, started_at: null },
  qtyMode: { enabled: false, qty: 1 },
  currentWork: null,
  currentItems: [],
  scanIndex: new Map(),
  pendingWrites: [],
  isSyncBlocked: false
};
