import { renderFrameView } from './frame-view.js';

export function renderInternalUsersView(container) {
  return renderFrameView(container, './internal-users.html?shell=1', 'ユーザー管理（弊社専用）');
}
