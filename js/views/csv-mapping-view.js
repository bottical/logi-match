export async function renderCsvMappingView(content) {
  content.innerHTML = `<iframe class="page-frame" src="./csv-mapping.html?shell=1" title="csv-mapping"></iframe>`;
}
