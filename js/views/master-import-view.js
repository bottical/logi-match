import { renderFrameView } from './frame-view.js';

export async function renderMasterImportView(container) {
  return renderFrameView(container, './master-import.html?shell=1', 'ピッキングマスター登録');
}
