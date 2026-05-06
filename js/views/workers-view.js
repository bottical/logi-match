export async function renderWorkersView(content) {
  content.innerHTML = `<iframe class="page-frame" src="./workers.html?shell=1" title="workers"></iframe>`;
}
