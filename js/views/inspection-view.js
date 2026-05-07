import { getCurrentHashParams } from '../sidebar-shell.js';
import { renderFrameView } from './frame-view.js';

export async function renderInspectionView(container) {
  const params = getCurrentHashParams();
  const workId = params.get('work_id');

  const src = workId
    ? `./inspection.html?shell=1&v=20260507-4&work_id=${encodeURIComponent(workId)}`
    : './inspection.html?shell=1&v=20260507-4';

  return renderFrameView(container, src, '検品実行');
}
