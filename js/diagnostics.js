(function () {
  'use strict';

  const SAMPLE_LIMIT = 50;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const TTL_DAYS = 90;
  const TTL_DRIFT_TOLERANCE_MS = DAY_MS;
  const CURRENT_STATUSES = new Set(['unstarted', 'current', 'suspended']);
  const COLLECTIONS = ['inspectionWorks', 'workers', 'scanLogs'];
  const $ = (id) => document.getElementById(id);
  let authorizedContext = null;
  let latestResult = null;
  let latestMarkdown = '';

  function valueAt(data, path) {
    return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), data);
  }

  function firstValue(data, paths) {
    for (const path of paths) {
      const value = valueAt(data, path);
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
  }

  function exists(data, path) {
    return valueAt(data, path) !== undefined && valueAt(data, path) !== null;
  }

  function dateType(value) {
    if (value == null) return 'missing';
    if (typeof value?.toDate === 'function' && typeof value?.seconds === 'number') return 'Timestamp';
    if (value instanceof Date) return 'Date';
    if (typeof value === 'string') return 'string';
    return typeof value;
  }

  function toDate(value) {
    if (value == null) return null;
    if (typeof value?.toDate === 'function') return value.toDate();
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  function serializable(value) {
    if (value === undefined) return null;
    if (value === null) return null;
    if (typeof value?.toDate === 'function') return { type: 'Timestamp', value: value.toDate().toISOString() };
    if (value instanceof Date) return { type: 'Date', value: value.toISOString() };
    if (Array.isArray(value)) return value.map(serializable);
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializable(item)]));
    return value;
  }

  function pick(data, fields) {
    return Object.fromEntries(fields.map((field) => [field, serializable(valueAt(data, field))]));
  }

  function addSample(list, sample) {
    if (list.length < SAMPLE_LIMIT) list.push(sample);
  }

  function countTypes(rows, path) {
    return rows.reduce((counts, row) => {
      const type = dateType(valueAt(row.data, path));
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {});
  }

  function mixedDateTypes(types) {
    return Object.keys(types).filter((type) => type !== 'missing' && types[type] > 0).length > 1;
  }

  async function readCollectionPaged(ref, collectionName, maxDocs, pageSize, onProgress) {
    const rows = [];
    let cursor = null;
    let capped = false;
    while (rows.length < maxDocs) {
      const remaining = maxDocs - rows.length;
      let query = ref.orderBy(firebase.firestore.FieldPath.documentId()).limit(Math.min(pageSize, remaining));
      if (cursor) query = query.startAfter(cursor);
      const snap = await query.get();
      rows.push(...snap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} })));
      onProgress(collectionName, rows.length);
      if (snap.size < Math.min(pageSize, remaining)) break;
      cursor = snap.docs[snap.docs.length - 1];
      if (rows.length >= maxDocs) capped = true;
    }
    return { rows, capped, countLabel: capped ? `${rows.length}件以上（上限到達）` : `${rows.length}件` };
  }

  function workSample(row) {
    return {
      workId: row.id,
      ...pick(row.data, ['pickingNo', 'status', 'createdAt', 'created_at', 'importedAt', 'imported_at', 'import_date', 'work.import_date', 'completedAt', 'completed_at', 'work.completedAt', 'work.completed_at', 'updatedAt', 'updated_at', 'lastActivityAt']),
    };
  }

  function diagnoseWorks(source) {
    const rows = source.rows;
    const statusCounts = { unstarted: 0, current: 0, suspended: 0, completed: 0, other: 0 };
    const samples = { missingCreatedAt: [], completedMissingCompletedAt: [], incompleteMissingCreatedAt: [] };
    let createdAtPresent = 0;
    let completedAtPresent = 0;
    let incompleteMissingCreatedAt = 0;
    rows.forEach((row) => {
      const status = row.data.status;
      if (Object.prototype.hasOwnProperty.call(statusCounts, status)) statusCounts[status] += 1;
      else statusCounts.other += 1;
      if (exists(row.data, 'createdAt')) createdAtPresent += 1;
      else addSample(samples.missingCreatedAt, workSample(row));
      if (status === 'completed') {
        if (exists(row.data, 'completedAt')) completedAtPresent += 1;
        else addSample(samples.completedMissingCompletedAt, workSample(row));
      }
      if (CURRENT_STATUSES.has(status) && !exists(row.data, 'createdAt')) {
        incompleteMissingCreatedAt += 1;
        addSample(samples.incompleteMissingCreatedAt, workSample(row));
      }
    });
    const createdAtTypes = countTypes(rows, 'createdAt');
    const completedAtTypes = countTypes(rows.filter((row) => row.data.status === 'completed'), 'completedAt');
    return {
      scanned: rows.length, capped: source.capped, countLabel: source.countLabel, createdAtPresent, createdAtMissing: rows.length - createdAtPresent,
      statusCounts, completed: statusCounts.completed, completedAtPresent, completedAtMissing: statusCounts.completed - completedAtPresent,
      incompleteMissingCreatedAt, createdAtTypes, completedAtTypes,
      riskCounts: { unstartedListHidden: rows.filter((row) => row.data.status === 'unstarted' && !exists(row.data, 'createdAt')).length, completedListHidden: statusCounts.completed - completedAtPresent, completedAtOrderAffected: statusCounts.completed - completedAtPresent },
      mixedTypes: { createdAt: mixedDateTypes(createdAtTypes), completedAt: mixedDateTypes(completedAtTypes) }, samples,
    };
  }

  function effectiveCurrent(row) {
    return row.data.status === 'current' || valueAt(row.data, 'work.status') === 'current';
  }

  function currentWorkerId(data) {
    return firstValue(data, ['currentWorkerId', 'current_worker_id', 'work.current_worker_id', 'work.currentWorkerId']);
  }

  function currentStartedAt(data) {
    return firstValue(data, ['currentStartedAt', 'lockAcquiredAt', 'work.current_started_at', 'work.lock_acquired_at', 'startedAt', 'work.started_at', 'updatedAt', 'updated_at']);
  }

  function currentDeviceId(data) {
    return firstValue(data, ['currentDeviceId', 'current_device_id', 'work.current_device_id', 'work.currentDeviceId', 'deviceId']);
  }

  function consistencySample(workerRow, workRow, reason) {
    const worker = workerRow?.data || {};
    const work = workRow?.data || {};
    return {
      reason,
      workerId: workerRow?.id || currentWorkerId(work),
      workerName: firstValue(worker, ['workerName', 'name', 'displayName']) || firstValue(work, ['currentWorkerName', 'current_worker_name']),
      'worker.currentWorkId': worker.currentWorkId ?? null,
      workId: workRow?.id || worker.currentWorkId || null,
      pickingNo: work.pickingNo ?? valueAt(work, 'work.pickingNo') ?? null,
      'inspectionWork.status': work.status ?? null,
      'inspectionWork.work.status': valueAt(work, 'work.status') ?? null,
      currentWorkerId: work.currentWorkerId ?? null,
      current_worker_id: work.current_worker_id ?? null,
      'work.current_worker_id': valueAt(work, 'work.current_worker_id') ?? null,
      'currentStartedAt候補': serializable(currentStartedAt(work)),
      'currentDeviceId候補': currentDeviceId(work),
      lastActivityAt: serializable(work.lastActivityAt), updatedAt: serializable(work.updatedAt),
    };
  }

  function diagnoseWorkers(workSource, workerSource) {
    const works = workSource.rows;
    const workers = workerSource.rows;
    const workById = new Map(works.map((row) => [row.id, row]));
    const workerById = new Map(workers.map((row) => [row.id, row]));
    const currents = works.filter(effectiveCurrent);
    const currentByWorker = new Map();
    const samples = { currentWorkerEmpty: [], workerWorkNotCurrent: [], workerWorkMissing: [], multipleCurrentWorks: [], currentWorkWorkerMissing: [], workerIdMismatch: [] };
    let currentWithWorkerId = 0;
    let matches = 0;
    let mismatches = 0;
    let workerWorkNotCurrent = 0;
    let workerWorkMissing = 0;
    let multipleCurrentWorkerCount = 0;

    currents.forEach((workRow) => {
      const workerId = currentWorkerId(workRow.data);
      if (!workerId) {
        addSample(samples.currentWorkWorkerMissing, consistencySample(null, workRow, 'current inspectionWorkからworkerIdを取得できない'));
        mismatches += 1;
        return;
      }
      currentWithWorkerId += 1;
      const linked = currentByWorker.get(String(workerId)) || [];
      linked.push(workRow);
      currentByWorker.set(String(workerId), linked);
      const workerRow = workerById.get(String(workerId));
      if (!workerRow || !workerRow.data.currentWorkId) {
        addSample(samples.currentWorkerEmpty, consistencySample(workerRow, workRow, 'inspectionWorkはcurrentだがworkers.currentWorkIdが空またはworkerが取得範囲に存在しない'));
        mismatches += 1;
      } else if (String(workerRow.data.currentWorkId) !== workRow.id) {
        addSample(samples.workerIdMismatch, consistencySample(workerRow, workRow, 'workers.currentWorkIdとinspectionWorkのworkIdが一致しない'));
        mismatches += 1;
      } else {
        matches += 1;
      }
    });

    workers.filter((row) => row.data.currentWorkId).forEach((workerRow) => {
      const workRow = workById.get(String(workerRow.data.currentWorkId));
      if (!workRow) { workerWorkMissing += 1; addSample(samples.workerWorkMissing, consistencySample(workerRow, null, 'workers.currentWorkIdのinspectionWorkが取得範囲に存在しない')); }
      else if (!effectiveCurrent(workRow)) { workerWorkNotCurrent += 1; addSample(samples.workerWorkNotCurrent, consistencySample(workerRow, workRow, 'workers.currentWorkIdはあるがinspectionWorkがcurrentではない')); }
      else if (String(currentWorkerId(workRow.data) || '') !== workerRow.id) addSample(samples.workerIdMismatch, consistencySample(workerRow, workRow, 'workers.currentWorkIdは一致するがinspectionWork側workerIdが一致しない'));
    });
    currentByWorker.forEach((workRows, workerId) => {
      if (workRows.length > 1) { multipleCurrentWorkerCount += 1; workRows.forEach((workRow) => addSample(samples.multipleCurrentWorks, consistencySample(workerById.get(workerId), workRow, `1人のworkerにcurrent inspectionWorksが${workRows.length}件紐づく`))); }
    });
    const workersWithCurrentWorkId = workers.filter((row) => row.data.currentWorkId).length;
    return {
      scannedWorkers: workers.length, workersCapped: workerSource.capped, workersCountLabel: workerSource.countLabel,
      workersWithCurrentWorkId, topLevelCurrent: works.filter((row) => row.data.status === 'current').length,
      nestedCurrent: works.filter((row) => valueAt(row.data, 'work.status') === 'current').length, effectiveCurrent: currents.length,
      currentWithWorkerId, currentWithoutWorkerId: currents.length - currentWithWorkerId, matches, mismatches: mismatches + workerWorkNotCurrent + workerWorkMissing,
      currentSideMismatches: mismatches, workerWorkNotCurrent, workerWorkMissing, workerPointerIssues: workerWorkNotCurrent + workerWorkMissing, multipleCurrentWorkerCount,
      samples,
    };
  }

  function scanLogSample(row) {
    return { logId: row.id, ...pick(row.data, ['workId', 'pickingNo', 'scannedCode', 'result', 'scannedAt', 'createdAt', 'expiresAt', 'workerId', 'deviceId']) };
  }

  function diagnoseScanLogs(source) {
    const rows = source.rows;
    const samples = { missingExpiresAt: [], missingScannedAt: [], missingScannedAndCreatedAt: [], expired: [], nonTimestampExpiresAt: [] };
    let expiresAtPresent = 0, scannedAtPresent = 0, createdAtPresent = 0, noScanOrCreate = 0, drifted = 0, expired = 0;
    const now = Date.now();
    rows.forEach((row) => {
      const data = row.data;
      if (exists(data, 'expiresAt')) expiresAtPresent += 1; else addSample(samples.missingExpiresAt, scanLogSample(row));
      if (exists(data, 'scannedAt')) scannedAtPresent += 1; else addSample(samples.missingScannedAt, scanLogSample(row));
      if (exists(data, 'createdAt')) createdAtPresent += 1;
      if (!exists(data, 'scannedAt') && !exists(data, 'createdAt')) { noScanOrCreate += 1; addSample(samples.missingScannedAndCreatedAt, scanLogSample(row)); }
      const expires = toDate(data.expiresAt);
      const scanned = toDate(data.scannedAt);
      if (expires && scanned && Math.abs(expires.getTime() - scanned.getTime() - TTL_DAYS * DAY_MS) > TTL_DRIFT_TOLERANCE_MS) drifted += 1;
      if (expires && expires.getTime() < now) { expired += 1; addSample(samples.expired, scanLogSample(row)); }
      if (exists(data, 'expiresAt') && dateType(data.expiresAt) !== 'Timestamp') addSample(samples.nonTimestampExpiresAt, scanLogSample(row));
    });
    const expiresAtTypes = countTypes(rows, 'expiresAt');
    return { scanned: rows.length, capped: source.capped, countLabel: source.countLabel, expiresAtPresent, expiresAtMissing: rows.length - expiresAtPresent, scannedAtPresent, scannedAtMissing: rows.length - scannedAtPresent, createdAtPresent, noScanOrCreate, drifted, expired, expiresAtTypes, mixedExpiresAtTypes: mixedDateTypes(expiresAtTypes), samples };
  }

  function sampleSection(title, samples) {
    return `#### ${title}（最大${SAMPLE_LIMIT}件）\n\n\`\`\`json\n${JSON.stringify(samples, null, 2)}\n\`\`\``;
  }

  function riskLevel(count, capped) {
    if (count > 0) return '高';
    if (capped) return '中（取得上限到達のため全件断定不可）';
    return '低';
  }

  function buildMarkdown(result) {
    const w = result.inspectionWorks, c = result.workers, s = result.scanLogs;
    const limited = result.meta.anyCapped ? '\n> ⚠️ 取得上限に達したcollectionがあります。件数は全件数ではなく、取得範囲内の診断結果です。\n' : '';
    return `# 本番Firestore診断レポート\n\n- 実行日時: ${result.meta.executedAt}\n- clientId: ${result.meta.clientId}\n- dry-run/read-only: true\n- 最大取得件数/collection: ${result.meta.maxDocs}\n- ページサイズ: ${result.meta.pageSize}\n- 読み取りcollection: ${COLLECTIONS.join(', ')}\n${limited}\n## 1. inspectionWorks 日付フィールド診断\n\n### 集計結果\n\n- inspectionWorks 総件数: ${w.countLabel}\n- createdAtあり / なし: ${w.createdAtPresent} / ${w.createdAtMissing}\n- status別: unstarted=${w.statusCounts.unstarted}, current=${w.statusCounts.current}, suspended=${w.statusCounts.suspended}, completed=${w.statusCounts.completed}, その他=${w.statusCounts.other}\n- completed件数: ${w.completed}\n- completedのcompletedAtあり / なし: ${w.completedAtPresent} / ${w.completedAtMissing}\n- 未完了系でcreatedAtなし: ${w.incompleteMissingCreatedAt}\n- createdAt型: ${JSON.stringify(w.createdAtTypes)}（混在=${w.mixedTypes.createdAt}）\n- completedAt型: ${JSON.stringify(w.completedAtTypes)}（混在=${w.mixedTypes.completedAt}）\n\n### 欠落・不整合サンプル\n\n${sampleSection('createdAtがないinspectionWorks', w.samples.missingCreatedAt)}\n\n${sampleSection('completedだがcompletedAtがないinspectionWorks', w.samples.completedMissingCompletedAt)}\n\n${sampleSection('未完了系だがcreatedAtがないinspectionWorks', w.samples.incompleteMissingCreatedAt)}\n\n### リスク判定\n- 高: 未着手一覧で非表示になる可能性=${w.riskCounts.unstartedListHidden}件、完了一覧で非表示になる可能性=${w.riskCounts.completedListHidden}件、completedAt降順表示への影響=${w.riskCounts.completedAtOrderAffected}件\n- 中: createdAt型混在=${w.mixedTypes.createdAt}、completedAt型混在=${w.mixedTypes.completedAt}\n- 低: 欠落・型混在が0件かつ全件取得済みの場合のみ\n- 総合: ${riskLevel(w.createdAtMissing + w.completedAtMissing, w.capped)}\n\n## 2. workers current状態診断\n\n### 集計結果\n\n- workers 総件数: ${c.workersCountLabel}\n- workers.currentWorkIdあり: ${c.workersWithCurrentWorkId}\n- inspectionWorks.status == current: ${c.topLevelCurrent}\n- inspectionWorks.work.status == current: ${c.nestedCurrent}\n- current作業（いずれかがcurrent）: ${c.effectiveCurrent}\n- current作業でworkerIdあり / なし: ${c.currentWithWorkerId} / ${c.currentWithoutWorkerId}\n- workers.currentWorkIdとinspectionWorks側current状態が一致 / 不一致: ${c.matches} / ${c.mismatches}
- workers.currentWorkId参照先が非current / 存在しない・取得範囲外: ${c.workerWorkNotCurrent} / ${c.workerWorkMissing}
- 複数current作業が紐づくworker: ${c.multipleCurrentWorkerCount}\n\n### 不整合サンプル\n\n${sampleSection('inspectionWorksはcurrentだがworkers.currentWorkIdが空', c.samples.currentWorkerEmpty)}\n\n${sampleSection('workers.currentWorkIdはあるが該当workがcurrentではない', c.samples.workerWorkNotCurrent)}\n\n${sampleSection('workers.currentWorkIdの該当workが存在しない/取得範囲外', c.samples.workerWorkMissing)}\n\n${sampleSection('1人のworkerに複数current作業', c.samples.multipleCurrentWorks)}\n\n${sampleSection('current作業だがworkerIdなし', c.samples.currentWorkWorkerMissing)}\n\n${sampleSection('workersとinspectionWorksのworkerId不一致', c.samples.workerIdMismatch)}\n\n### リスク判定\n- 高: current不一致=${c.mismatches}件（うちworker参照先問題=${c.workerPointerIssues}件）、複数current作業worker=${c.multipleCurrentWorkerCount}件\n- 中: inspectionWorksまたはworkersが取得上限到達の場合、取得範囲外参照は存在しないdocと断定不可\n- 低: 不整合0件かつ全件取得済みの場合のみ\n- 総合: ${riskLevel(c.mismatches + c.multipleCurrentWorkerCount, result.meta.anyCapped)}\n\n## 3. scanLogs TTL診断\n\n### 集計結果\n\n- scanLogs 総件数: ${s.countLabel}\n- expiresAtあり / なし: ${s.expiresAtPresent} / ${s.expiresAtMissing}\n- scannedAtあり / なし: ${s.scannedAtPresent} / ${s.scannedAtMissing}\n- createdAtあり: ${s.createdAtPresent}\n- scannedAtもcreatedAtもなし: ${s.noScanOrCreate}\n- expiresAtがscannedAt + ${TTL_DAYS}日から${TTL_DRIFT_TOLERANCE_MS / DAY_MS}日超ズレる可能性: ${s.drifted}\n- expiresAtが過去日: ${s.expired}\n- expiresAt型: ${JSON.stringify(s.expiresAtTypes)}（混在=${s.mixedExpiresAtTypes}）\n\n### 欠落・不整合サンプル\n\n${sampleSection('expiresAtなし', s.samples.missingExpiresAt)}\n\n${sampleSection('scannedAtなし', s.samples.missingScannedAt)}\n\n${sampleSection('scannedAtもcreatedAtもなし', s.samples.missingScannedAndCreatedAt)}\n\n${sampleSection('expiresAtが過去日', s.samples.expired)}\n\n${sampleSection('expiresAtがTimestamp以外', s.samples.nonTimestampExpiresAt)}\n\n### リスク判定\n- 高: expiresAtなし=${s.expiresAtMissing}件、scannedAtもcreatedAtもなし=${s.noScanOrCreate}件\n- 中: TTL基準から大幅ズレ=${s.drifted}件、expiresAt型混在=${s.mixedExpiresAtTypes}\n- 低: 欠落・ズレ・型混在が0件かつ全件取得済みの場合のみ\n- 総合: ${riskLevel(s.expiresAtMissing + s.noScanOrCreate + s.drifted, s.capped)}\n\n## 4. index確認\n\nコード上の実クエリとの照合結果:\n\n- 必要: inspectionWorks: status Asc, completedAt Asc（結果ダウンロードのcompletedAt昇順クエリ）\n- 必要: inspectionWorks: status Asc, completedAt Desc（完了一覧のcompletedAt降順クエリ）\n- 必要: inspectionWorks: status Asc, createdAt Desc（未着手一覧のcreatedAt降順クエリ）\n- Firestore Consoleで報告された3 indexが上記の向きと一致するか確認してください。同名表示だけでは Asc / Desc を判定できません。\n- index作成・変更操作は実施していません。\n\n## 5. 推奨対応\n\n### 即時対応すべきもの\n- 高リスク件数のdoc IDと業務影響を確認してください。診断機能は補正を行っていません。\n- 取得上限到達時は、上限を段階的に増やして再診断し、全件結果と誤認しないでください。\n\n### 補正前に確認すべきもの\n- 日付補完元の優先順位と、string値をTimestampへ変換するルールを業務担当者と合意してください。\n- current不整合は、現場端末の稼働有無とcurrent開始日時候補を確認してから補正方針を決めてください。\n- scanLogs TTLの正規基準がscannedAtかcreatedAtかを確認してください。\n\n### 後続対応でよいもの\n- Firestore Consoleで3つの複合indexの方向を最終確認してください。\n- 補正を行う場合は、この診断とは別の承認済み手順・dry-run・バックアップを用意してください。`;
  }

  function setStatus(message, type) {
    $('runStatus').textContent = message;
    $('runStatus').className = `diagnostics-status${type ? ` is-${type}` : ''}`;
  }

  function updateControls() {
    const clientId = $('clientId').value.trim();
    const maxDocs = Number($('maxDocs').value);
    $('estimate').textContent = `対象: clients/${clientId || '{clientId}'}/{inspectionWorks,workers,scanLogs} / 最大推定read: ${maxDocs * COLLECTIONS.length} docs（各collectionが上限以上の場合。認証・context確認readを除く）`;
    $('runDiagnostics').disabled = !authorizedContext || !clientId || !$('dryRun').checked || $('clientIdConfirm').value.trim() !== clientId;
  }

  async function run() {
    const clientId = $('clientId').value.trim();
    const maxDocs = Number($('maxDocs').value);
    const pageSize = Number($('pageSize').value);
    if (!authorizedContext || !clientId || !$('dryRun').checked || $('clientIdConfirm').value.trim() !== clientId) throw new Error('実行条件を確認してください。');
    $('runDiagnostics').disabled = true;
    setStatus('read-only診断を開始します。');
    const paths = window.firestorePaths.createFirestorePaths(window.db, clientId);
    const progress = {};
    const onProgress = (name, count) => { progress[name] = count; setStatus(`read-only取得中: ${COLLECTIONS.map((key) => `${key}=${progress[key] || 0}`).join(', ')}`); };
    try {
      // Deliberately only get() queries are used. No write, batch, transaction, set, update, or delete API is called.
      const works = await readCollectionPaged(paths.inspectionWorks, 'inspectionWorks', maxDocs, pageSize, onProgress);
      const workers = await readCollectionPaged(paths.workers, 'workers', maxDocs, pageSize, onProgress);
      const scanLogs = await readCollectionPaged(paths.scanLogs, 'scanLogs', maxDocs, pageSize, onProgress);
      latestResult = {
        meta: { executedAt: new Date().toISOString(), clientId, dryRun: true, readOnly: true, maxDocs, pageSize, collections: COLLECTIONS, anyCapped: works.capped || workers.capped || scanLogs.capped },
        inspectionWorks: diagnoseWorks(works), workers: diagnoseWorkers(works, workers), scanLogs: diagnoseScanLogs(scanLogs),
      };
      latestMarkdown = buildMarkdown(latestResult);
      $('reportOutput').textContent = latestMarkdown;
      ['copyMarkdown', 'copyJson', 'downloadJson'].forEach((id) => { $(id).disabled = false; });
      console.info('[firestore-diagnostics] read-only result', latestResult);
      console.info('[firestore-diagnostics] markdown report\n' + latestMarkdown);
      setStatus(`診断完了: inspectionWorks=${works.countLabel}, workers=${workers.countLabel}, scanLogs=${scanLogs.countLabel}`, 'success');
    } catch (error) {
      console.error('[firestore-diagnostics] failed', error);
      setStatus(`診断に失敗しました: ${error?.message || error}\nFirestoreルールとclientIdを確認してください。書き込みは実行されていません。`, 'error');
    } finally {
      updateControls();
    }
  }

  async function copyText(text, label) {
    await navigator.clipboard.writeText(text);
    setStatus(`${label}をクリップボードへコピーしました。`, 'success');
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(latestResult, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `firestore-diagnostics-${latestResult.meta.clientId}-${latestResult.meta.executedAt.replace(/[:.]/g, '-')}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function init() {
    try {
      const ctx = await window.appInit.ready(document.body.dataset.page);
      if (!window.isInternalAdmin?.(ctx) && !window.permissions?.isInternalAdmin?.(ctx)) throw new Error('systemOwnerまたはinternal管理者のみ利用できます。');
      authorizedContext = ctx;
      $('clientId').value = ctx.clientId || ctx.tenantId || '';
      $('authStatus').textContent = `権限確認済み: ${ctx.email || ctx.uid} (${ctx.role})`;
      $('authStatus').className = 'diagnostics-status is-success';
    } catch (error) {
      $('authStatus').textContent = `利用不可: ${error?.message || error}`;
      $('authStatus').className = 'diagnostics-status is-error';
    }
    updateControls();
  }

  ['clientId', 'clientIdConfirm', 'dryRun', 'maxDocs', 'pageSize'].forEach((id) => $(id).addEventListener('input', updateControls));
  $('runDiagnostics').addEventListener('click', () => run().catch((error) => setStatus(error.message, 'error')));
  $('copyMarkdown').addEventListener('click', () => copyText(latestMarkdown, 'Markdown').catch((error) => setStatus(error.message, 'error')));
  $('copyJson').addEventListener('click', () => copyText(JSON.stringify(latestResult, null, 2), 'JSON').catch((error) => setStatus(error.message, 'error')));
  $('downloadJson').addEventListener('click', downloadJson);
  init();
})();
