(function () {
  function parseLocalDate(value) { const [y,m,d]=String(value||'').split('-').map(Number); if(!y||!m||!d) return null; return new Date(y,m-1,d,0,0,0,0); }
  function formatDate(v){return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;}
  function buildDateRange(fromValue,toValue){ if(!fromValue&&!toValue) throw new Error('日付を指定してください。全期間の出力はできません。'); const start=parseLocalDate(fromValue||toValue); const to=parseLocalDate(toValue||fromValue); if(!start||!to) throw new Error('日付の指定が不正です。'); if(start.getTime()>to.getTime()) throw new Error('開始日は終了日以前で指定してください。'); const endExclusive=new Date(to); endExclusive.setDate(endExclusive.getDate()+1); return {start,endExclusive,days:Math.round((endExclusive-start)/86400000),from:formatDate(start),to:formatDate(to)}; }
  const maxDaysByType = { completed: 31, details: 31, scan: 7 };
  function assertRange(range, type){ const max=maxDaysByType[type]; if(!max) throw new Error(`未知の出力種別です: ${type}`); if(range.days>max) throw new Error(type==='scan'?'スキャンログはデータ量が多いため、7日以内で指定してください。':'完了日範囲は31日以内で指定してください。'); }
  window.dateRangePolicy={buildDateRange,assertRange};
})();
