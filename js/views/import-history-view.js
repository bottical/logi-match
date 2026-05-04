import { renderFrameView } from './frame-view.js';

export async function renderImportHistoryView(container) {
  return renderFrameView(container, './import-history.html?shell=1', 'マスター投入履歴');
}
