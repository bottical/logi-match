(function () {
  const HEADER_ALIASES = {
    work_id: ['作業ID', '作業Id', '作業id', '注文番号', '出荷番号', 'ピッキングNo', 'ピッキングNO'],
    product_id: ['商品ID', '商品Id', '商品id', 'SKU', 'sku', '品番'],
    product_name: ['商品名', '品名'],
    main_barcode: ['メインバーコード', 'JAN', 'jan', 'バーコード', '商品バーコード'],
    target_qty: ['指示数', '数量', '出荷数', '検品数'],
    recipient_name: ['お届け先名', '届け先名', '納品先名', '配送先名'],
    alt_code: ['代替コード', '代替バーコード'],
    shipment_date: ['出荷予定日', '出荷日'],
    excluded_flag: ['対象外フラグ', '検品対象外']
  };


  const UNSAFE_CHAR_REPLACEMENTS = [
    ['№', 'No.'], ['㎏', 'kg'], ['㌔', 'キロ'], ['ℓ', 'L'], ['㍑', 'リットル'],
    ['㎜', 'mm'], ['㎝', 'cm'], ['㎡', 'm2'], ['㈱', '(株)'], ['㈲', '(有)'],
    ['①', '1'], ['②', '2'], ['③', '3'], ['④', '4'], ['⑤', '5'],
    ['⑥', '6'], ['⑦', '7'], ['⑧', '8'], ['⑨', '9'], ['⑩', '10'],
    ['～', '-'], ['〜', '-'], ['－', '-'], ['―', '-'], ['−', '-'],
    ['“', '"'], ['”', '"'], ['‘', "'"], ['’', "'"]
  ];

  function replaceUnsafeChars(value) {
    let text = String(value ?? '');
    UNSAFE_CHAR_REPLACEMENTS.forEach(([from, to]) => { text = text.split(from).join(to); });
    return text.trim();
  }

  function normalizeKeyText(value) {
    return replaceUnsafeChars(String(value ?? '').normalize('NFKC'));
  }

  function normalizeDisplayText(value) {
    // 表示系項目は半角カナを維持するため、NFKCではなく個別置換のみ行う。
    return replaceUnsafeChars(value);
  }

  function normalizeQuantity(value) {
    return replaceUnsafeChars(String(value ?? '').normalize('NFKC')).replaceAll(',', '').trim();
  }

  function normalizeCsvValueByField(field, value) {
    if (['work_id', 'main_barcode', 'alt_code', 'slip_no', 'product_id', 'excluded_flag'].includes(field)) return normalizeKeyText(value);
    if (field === 'target_qty') return normalizeQuantity(value);
    return normalizeDisplayText(value);
  }

  function findUnsafeCharReplacements(rawValue, normalizedValue) {
    const raw = String(rawValue ?? '');
    return UNSAFE_CHAR_REPLACEMENTS
      .filter(([from]) => raw.includes(from))
      .map(([from, to]) => ({ from, to }));
  }

  function decodeCsvArrayBuffer(buffer) {
    const warnings = [];
    const stripBom = (text) => text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    const hasBom = new Uint8Array(buffer, 0, Math.min(3, buffer.byteLength)).join(',') === '239,187,191';
    if (hasBom) {
      return { text: stripBom(new TextDecoder('utf-8', { fatal: false }).decode(buffer)), encoding: 'utf-8-bom', warnings };
    }
    try {
      return { text: stripBom(new TextDecoder('utf-8', { fatal: true }).decode(buffer)), encoding: 'utf-8', warnings };
    } catch (_) {
      const text = new TextDecoder('shift-jis', { fatal: false }).decode(buffer);
      const replacementCount = (text.match(/\uFFFD/g) || []).length;
      if (replacementCount > 0) {
        warnings.push({
          severity: 'warning',
          rowNumber: null,
          pickingNo: '',
          columnName: '文字コード',
          rawValue: '',
          normalizedValue: '',
          reasonCode: 'ENCODING_REPLACEMENT_CHAR',
          message: `読み込み後のCSVに置換文字「�」が${replacementCount}件含まれています。文字コードまたは機種依存文字を確認してください。`
        });
      }
      return { text, encoding: 'windows-31j/shift-jis', warnings };
    }
  }

  function parseCsv(text) {
    const rows = []; let row=[]; let field=''; let inQ=false;
    for (let i=0;i<text.length;i++) {
      const c=text[i], n=text[i+1];
      if (c==='"') { if (inQ && n==='"') { field+='"'; i++; } else inQ=!inQ; continue; }
      if (!inQ && (c==='\n' || c==='\r')) { if (c==='\r' && n==='\n') i++; row.push(field); if (row.some(v=>String(v).trim()!=='') ) rows.push(row); row=[]; field=''; continue; }
      if (!inQ && c===',') { row.push(field); field=''; continue; }
      field+=c;
    }
    row.push(field); if (row.some(v=>String(v).trim()!=='')) rows.push(row);
    return rows;
  }

  window.csvUtils = { HEADER_ALIASES, UNSAFE_CHAR_REPLACEMENTS, decodeCsvArrayBuffer, parseCsv, replaceUnsafeChars, normalizeKeyText, normalizeDisplayText, normalizeQuantity, normalizeCsvValueByField, findUnsafeCharReplacements };
})();
