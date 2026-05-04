import { renderFrameView } from './frame-view.js';

export async function renderCompletedListView(container) {
  return renderFrameView(container, './completed-list.html?shell=1', '検品完了一覧');
}
