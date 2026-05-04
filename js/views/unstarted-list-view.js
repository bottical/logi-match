import { renderFrameView } from './frame-view.js';

export async function renderUnstartedListView(container) {
  return renderFrameView(container, './unstarted-list.html?shell=1', '検品未着手一覧');
}
