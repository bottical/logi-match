import { renderFrameView } from './frame-view.js';

export function renderInternalWorkersView(container) {
  return renderFrameView(container, './internal-workers.html?shell=1', '検品作業者管理（弊社専用）');
}
