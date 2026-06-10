(function () {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const TTL_DAYS = 90;
  const SAMPLE_LIMIT = 50;
  const BATCH_LIMIT = 400;
  const UPDATE_PHRASE = 'UPDATE_EXPIRES_AT';
  const $ = (id) => document.getElementById(id);
  let authorizedContext = null;
  let running = false;
  let latestResult = null;
  let latestMarkdown = '';

  function hasOwn(data, field) {
    return Object.prototype.hasOwnProperty.call(data, field);
  }

  function toDate(value) {
    if (value == null) return null;
    if (typeof value?.toDate === 'function') {
      const converted = value.toDate();
      return converted && typeof converted.getTime === 'function' && !Number.isNaN(converted.getTime()) ? new Date(converted.getTime()) : null;
    }
    if (value instanceof Date || Object.prototype.toString.call(value) === '[object Date]') return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
    if (typeof value === 'string' || typeof value === 'number') {
      const converted = new Date(value);
      return Number.isNaN(converted.getTime()) ? null : converted;
    }
    return null;
  }

  function displayValue(value) {
    const date = toDate(value);
    if (date) return date.toISOString();
    if (value === undefined) return null;
    if (value === null) return null;
    if (typeof value === 'object') {
      try { return JSON.stringify(value); } catch (_) { return String(value); }
    }
    return value;
  }

  function addSample(list, sample) {
    if (list.length < SAMPLE_LIMIT) list.push(sample);
  }

  function candidateSample(doc, data, expiresAt, baseField) {
    return {
      logId: doc.id,
      workId: data.workId ?? null,
      pickingNo: data.pickingNo ?? null,
      scannedAt: displayValue(data.scannedAt),
      createdAt: displayValue(data.createdAt),
      computedExpiresAt: expiresAt.toISOString(),
      baseField,
      workerId: data.workerId ?? null,
      deviceId: data.deviceId ?? null,
      result: data.result ?? null,
    };
  }

  function skipSample(doc, data, reason) {
    return {
      logId: doc.id,
      reason,
      scannedAt: displayValue(data.scannedAt),
      createdAt: displayValue(data.createdAt),
      expiresAt: displayValue(data.expiresAt),
    };
  }

  function analyzeDoc(doc) {
    const data = doc.data() || {};
    if (hasOwn(data, 'expiresAt')) return { kind: 'present', data };
    const scannedAtExists = hasOwn(data, 'scannedAt') && data.scannedAt != null;
    const createdAtExists = hasOwn(data, 'createdAt') && data.createdAt != null;
    if (!scannedAtExists && !createdAtExists) return { kind: 'skip', data, reason: 'scannedAtとcreatedAtが存在しない' };
    const baseField = scannedAtExists ? 'scannedAt' : 'createdAt';
    const baseDate = toDate(data[baseField]);
    if (!baseDate) return { kind: 'skip', data, reason: `${baseField}をDateとして解釈できない` };
    return { kind: 'candidate', data, baseField, expiresAt: new Date(baseDate.getTime() + TTL_DAYS * DAY_MS) };
  }

  function readForm() {
    return {
      clientId: $('clientId').value.trim(),
      dryRun: $('dryRun').checked,
      maxDocs: Number($('maxDocs').value),
      maxUpdates: Number($('maxUpdates').value),
      pageSize: Number($('pageSize').value),
    };
  }

  function guardSatisfied() {
    const form = readForm();
    return Boolean(
      authorizedContext && !running && form.clientId && $('clientIdConfirm').value.trim() === form.clientId
      && $('safetyConfirm').checked && $('executeConfirm').checked
      && (form.dryRun || $('updatePhrase').value === UPDATE_PHRASE)
    );
  }

  function updateControls() {
    const form = readForm();
    const mode = form.dryRun ? 'dry-run（writeなし）' : '本更新';
    $('liveUpdateGuard').hidden = form.dryRun;
    $('runMigration').textContent = form.dryRun ? 'dry-runを実行' : '本更新を実行';
    $('estimate').textContent = `対象: clients/${form.clientId || '{clientId}'}/scanLogs / モード: ${mode} / 最大推定read: ${form.maxDocs} docs / 最大推定write: ${form.dryRun ? 0 : form.maxUpdates} docs（認証・context確認readを除く）`;
    $('runMigration').disabled = !guardSatisfied();
  }

  function setStatus(message, type) {
    $('runStatus').textContent = message;
    $('runStatus').className = `diagnostics-status${type ? ` is-${type}` : ''}`;
  }

  function createResult(form) {
    return {
      meta: {
        executedAt: new Date().toISOString(), clientId: form.clientId, dryRun: form.dryRun,
        maxDocs: form.maxDocs, maxUpdates: form.maxUpdates, pageSize: form.pageSize,
        targetPath: `clients/${form.clientId}/scanLogs`, ttlPolicyEnabledByThisTool: false,
      },
      summary: {
        scanLogsRead: 0, expiresAtPresent: 0, expiresAtMissing: 0, updateCandidates: 0,
        actualUpdates: 0, skipped: 0, errors: 0, readLimitReached: false, updateLimitReached: false,
      },
      samples: { updateCandidates: [], skipped: [], errors: [] },
    };
  }

  async function scan(form, result) {
    const collectionRef = window.db.collection('clients').doc(form.clientId).collection('scanLogs');
    const updates = [];
    let lastDoc = null;

    while (result.summary.scanLogsRead < form.maxDocs && updates.length < form.maxUpdates) {
      const remaining = form.maxDocs - result.summary.scanLogsRead;
      const queryLimit = Math.min(form.pageSize, remaining);
      let query = collectionRef.orderBy(firebase.firestore.FieldPath.documentId()).limit(queryLimit);
      if (lastDoc) query = query.startAfter(lastDoc);
      const snapshot = await query.get();
      if (snapshot.empty) break;

      for (const doc of snapshot.docs) {
        result.summary.scanLogsRead += 1;
        try {
          const analysis = analyzeDoc(doc);
          if (analysis.kind === 'present') {
            result.summary.expiresAtPresent += 1;
            continue;
          }
          result.summary.expiresAtMissing += 1;
          if (analysis.kind === 'skip') {
            result.summary.skipped += 1;
            addSample(result.samples.skipped, skipSample(doc, analysis.data, analysis.reason));
            continue;
          }
          result.summary.updateCandidates += 1;
          addSample(result.samples.updateCandidates, candidateSample(doc, analysis.data, analysis.expiresAt, analysis.baseField));
          if (updates.length < form.maxUpdates) updates.push({ ref: doc.ref, logId: doc.id, expiresAt: analysis.expiresAt });
        } catch (error) {
          result.summary.errors += 1;
          addSample(result.samples.errors, { logId: doc.id, errorMessage: error?.message || String(error) });
        }
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      setStatus(`取得中: read=${result.summary.scanLogsRead}/${form.maxDocs}, 更新対象選択=${updates.length}/${form.maxUpdates}`);
      if (snapshot.size < queryLimit) break;
    }

    result.summary.readLimitReached = result.summary.scanLogsRead >= form.maxDocs;
    result.summary.updateLimitReached = updates.length >= form.maxUpdates;
    return updates;
  }

  async function commitUpdates(updates, result) {
    for (let offset = 0; offset < updates.length; offset += BATCH_LIMIT) {
      const chunk = updates.slice(offset, offset + BATCH_LIMIT);
      const batch = window.db.batch();
      chunk.forEach((update) => batch.update(update.ref, { expiresAt: update.expiresAt }));
      try {
        await batch.commit();
        result.summary.actualUpdates += chunk.length;
        setStatus(`本更新中: ${result.summary.actualUpdates}/${updates.length}件を更新済み`);
      } catch (error) {
        result.summary.errors += chunk.length;
        chunk.forEach((update) => addSample(result.samples.errors, { logId: update.logId, errorMessage: `batch commit失敗: ${error?.message || error}` }));
        console.error('[scanlog-ttl-migration] batch commit failed', { offset, size: chunk.length, error });
      }
    }
  }

  function sampleSection(title, samples) {
    return `## ${title}\n\n\`\`\`json\n${JSON.stringify(samples, null, 2)}\n\`\`\``;
  }

  function buildMarkdown(result) {
    const m = result.meta, s = result.summary;
    return `# scanLogs expiresAt補正レポート\n\n## 実行条件\n\n- 実行日時: ${m.executedAt}\n- clientId: ${m.clientId}\n- dry-run: ${m.dryRun}\n- 最大取得件数: ${m.maxDocs}\n- 最大更新件数: ${m.maxUpdates}\n- ページサイズ: ${m.pageSize}\n- 対象パス: ${m.targetPath}\n- TTL policy有効化: 実施しない\n\n## 集計結果\n\n- 取得件数: ${s.scanLogsRead}\n- expiresAtあり: ${s.expiresAtPresent}\n- expiresAtなし: ${s.expiresAtMissing}\n- 更新候補: ${s.updateCandidates}\n- 実更新: ${s.actualUpdates}\n- skip: ${s.skipped}\n- error: ${s.errors}\n- 取得上限到達: ${s.readLimitReached}\n- 更新上限到達: ${s.updateLimitReached}\n\n${sampleSection('更新候補サンプル', result.samples.updateCandidates)}\n\n${sampleSection('skipサンプル', result.samples.skipped)}\n\n${sampleSection('errorサンプル', result.samples.errors)}\n\n## 判定\n\n${m.dryRun ? '- dry-runの場合:\n  - 本更新前に候補サンプルを確認してください。' : '- 本更新の場合:\n  - 更新後に diagnostics.html を再実行し、expiresAtなし件数が減っていることを確認してください。'}`;
  }

  async function run() {
    const form = readForm();
    if (!guardSatisfied()) throw new Error('実行条件を確認してください。');
    if (!authorizedContext?.isSystemOwner || authorizedContext.role !== 'systemOwner') throw new Error('systemOwnerのみ実行できます。');
    running = true;
    updateControls();
    setStatus(`${form.dryRun ? 'dry-run' : '本更新'}を開始します。`);
    const result = createResult(form);
    try {
      const updates = await scan(form, result);
      // dry-runではbatch生成・commitを含むFirestore write処理へ一切進まない。
      if (!form.dryRun) await commitUpdates(updates, result);
      latestResult = result;
      latestMarkdown = buildMarkdown(result);
      $('reportOutput').textContent = latestMarkdown;
      ['copyMarkdown', 'copyJson', 'downloadMarkdown', 'downloadJson'].forEach((id) => { $(id).disabled = false; });
      console.info('[scanlog-ttl-migration] result', result);
      console.info('[scanlog-ttl-migration] markdown report\n' + latestMarkdown);
      setStatus(`${form.dryRun ? 'dry-run' : '本更新'}完了: read=${result.summary.scanLogsRead}, 候補=${result.summary.updateCandidates}, 実更新=${result.summary.actualUpdates}, skip=${result.summary.skipped}, error=${result.summary.errors}`, result.summary.errors ? 'error' : 'success');
    } catch (error) {
      console.error('[scanlog-ttl-migration] failed', error);
      setStatus(`実行に失敗しました: ${error?.message || error}`, 'error');
      throw error;
    } finally {
      running = false;
      updateControls();
    }
  }

  async function copyText(text, label) {
    await navigator.clipboard.writeText(text);
    setStatus(`${label}をクリップボードへコピーしました。`, 'success');
  }

  function download(text, type, extension) {
    const blob = new Blob([text], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `scanlog-ttl-migration-${latestResult.meta.clientId}-${latestResult.meta.executedAt.replace(/[:.]/g, '-')}.${extension}`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function init() {
    try {
      const ctx = await window.appInit.ready(document.body.dataset.page);
      if (!ctx.isSystemOwner || ctx.role !== 'systemOwner' || !window.permissions?.isSystemOwner?.(ctx)) throw new Error('systemOwnerのみ利用できます。internalは実行できません。');
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

  ['clientId', 'clientIdConfirm', 'dryRun', 'safetyConfirm', 'executeConfirm', 'updatePhrase', 'maxDocs', 'maxUpdates', 'pageSize'].forEach((id) => $(id).addEventListener('input', updateControls));
  $('runMigration').addEventListener('click', () => run().catch(() => {}));
  $('copyMarkdown').addEventListener('click', () => copyText(latestMarkdown, 'Markdown').catch((error) => setStatus(error.message, 'error')));
  $('copyJson').addEventListener('click', () => copyText(JSON.stringify(latestResult, null, 2), 'JSON').catch((error) => setStatus(error.message, 'error')));
  $('downloadMarkdown').addEventListener('click', () => download(latestMarkdown, 'text/markdown;charset=utf-8', 'md'));
  $('downloadJson').addEventListener('click', () => download(JSON.stringify(latestResult, null, 2), 'application/json', 'json'));
  init();
})();
