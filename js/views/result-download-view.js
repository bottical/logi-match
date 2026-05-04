import { renderFrameView } from './frame-view.js';

export async function renderResultDownloadView(container) {
  return renderFrameView(container, './result-download.html?shell=1', '検品実績DL');
}
