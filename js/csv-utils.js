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

  function decodeCsvArrayBuffer(buffer) {
    const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    const replacementCount = (utf8.match(/\uFFFD/g) || []).length;
    if (replacementCount > 0) {
      try {
        return { text: new TextDecoder('shift-jis', { fatal: false }).decode(buffer), encoding: 'shift-jis', warnings: ['文字コードを確認してください（Shift-JISとして読み込み）'] };
      } catch (_) {}
    }
    return { text: utf8, encoding: 'utf-8', warnings: [] };
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

  window.csvUtils = { HEADER_ALIASES, decodeCsvArrayBuffer, parseCsv };
})();
