import { renderFrameView } from './frame-view.js';

export async function renderInspectionView(container) {
  return renderFrameView(container, './inspection.html?shell=1', '検品実行');
}
