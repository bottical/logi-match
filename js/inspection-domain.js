(function () {
  const WorkStatus = Object.freeze({ unstarted: 'unstarted', current: 'current', suspended: 'suspended', completed: 'completed' });
  const normalize = (v) => String(v || '').trim();
  const getTargetQty = (d) => Number(d?.target_qty ?? d?.targetQty ?? 0);
  const getActualQty = (d) => Number(d?.actual_qty ?? d?.actualQty ?? 0);
  const isExcluded = (d) => d?.inspectionRequired === false || d?.inspection_required === false || getTargetQty(d) === 0;
  const isCompleted = (work) => (work?.status === WorkStatus.completed) || work?.completed_flag === true || work?.completedFlag === true;
  function isDetailCompleted(d) { return d?.completed_flag === true || d?.completedFlag === true; }
  function calculateSkuProgress(details = []) { const active = details.filter((d) => !isExcluded(d)); return { done: active.filter((d) => isDetailCompleted(d)).length, total: active.length }; }
  function calculateQtyProgress(details = []) { const active = details.filter((d) => !isExcluded(d)); return { actual: active.reduce((n, d) => n + getActualQty(d), 0), target: active.reduce((n, d) => n + getTargetQty(d), 0) }; }
  function validateScanQty(beforeQty, qty, targetQty) { return Number.isInteger(qty) && qty > 0 && beforeQty + qty <= targetQty; }
  function validateScanDetailQty(item, scanQty) { const plannedQty = Number(item?.targetQty ?? item?.target_qty ?? item?.quantity ?? 0); const actualQty = Number(item?.actualQty ?? item?.actual_qty ?? item?.scannedQty ?? item?.scanned_count ?? 0); const remainingQty = plannedQty - actualQty; if (!Number.isInteger(scanQty) || scanQty < 1) return { ok: false, code: 'INVALID_SCAN_QTY', message: '読取数量を確認してください' }; if (scanQty > remainingQty) return { ok: false, code: 'SCAN_QTY_EXCEEDS_REMAINING', message: `読取数量が残数を超えています。残数: ${remainingQty}` }; return { ok: true, plannedQty, actualQty, remainingQty }; }
  function matchScanCode(details, code, options = {}) { const c = normalize(code); const includeSlipNo = options.includeSlipNo === true; for (const d of details || []) { if (isExcluded(d)) continue; const keys = [ { type: 'jan', value: d.main_barcode || d.scan_code || d.jan }, { type: 'alternative', value: d.alt_code || d.alternativeCode }]; if (includeSlipNo) keys.push({ type: 'slipNo', value: d.slipNo || d.slip_no }); for (const k of keys) if (normalize(k.value) === c) return { detail: d, matchedType: k.type }; } return null; }
  function applyScanQty(detail, qty) { const beforeActualQty = getActualQty(detail); const plannedQty = getTargetQty(detail); const afterActualQty = beforeActualQty + qty; detail.actual_qty = afterActualQty; detail.actualQty = afterActualQty; detail.completed_flag = afterActualQty >= plannedQty; detail.completedFlag = detail.completed_flag; detail.itemStatus = detail.completed_flag ? 'completed' : (afterActualQty > 0 ? 'partial' : 'unstarted'); return { beforeActualQty, afterActualQty, plannedQty }; }
  function shouldCompleteWork(details = []) { return details.filter((d) => !isExcluded(d)).every((d) => isDetailCompleted(d)); }
  function assertAllowedTransition(from, to) { const allowed = { unstarted: ['current', 'suspended'], current: ['suspended', 'completed', 'unstarted'], suspended: ['current', 'unstarted'], completed: ['unstarted'] }; if (!(allowed[from] || []).includes(to)) throw new Error(`INVALID_STATUS_TRANSITION:${from}->${to}`); }
  const canStartInspection = (status) => [WorkStatus.unstarted, WorkStatus.suspended].includes(status);
  const canPauseInspection = (status) => status === WorkStatus.current;
  const canResetInspection = (status) => [WorkStatus.unstarted, WorkStatus.current, WorkStatus.suspended].includes(status);
  const canResetCompleted = (status, ctx) => status === WorkStatus.completed && !!window.permissions?.hasPermission?.('reset_completed', ctx || window.appContext || {});
  const canForceUnlock = (role) => role === 'admin' || role === 'systemOwner';
  window.inspectionDomain = { WorkStatus, canStartInspection, canPauseInspection, canResetInspection, canResetCompleted, canForceUnlock, isCompleted, calculateSkuProgress, calculateQtyProgress, validateScanQty, validateScanDetailQty, matchScanCode, applyScanQty, shouldCompleteWork, assertAllowedTransition };
})();
