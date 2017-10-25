const f = document.getElementById('f');

f.update_rules.addEventListener('click', (event) => {
  chrome.runtime.sendMessage({ action: 'Pagerization.fetchRules', force: true }, (response) => {
    f.update_rules.nextElementSibling.textContent = response.status;
  });
  event.preventDefault();
});

function onChange(node, fn) {
  node.addEventListener('change', (event) => {
    const options = fn(event.target);
    chrome.runtime.sendMessage({ action: 'Pagerization.setOptions', options });
  });
  return node;
}

chrome.runtime.sendMessage({ action: 'Pagerization.initialize' }, (response) => {
  const options = response.options;
  onChange(f.debug, (node) => Object.assign(options, { debug: node.checked })).checked = options.debug;
  onChange(f.enable, (node) => Object.assign(options, { enable: node.checked })).checked = options.enable;
  onChange(f.detect_url_change, (node) => Object.assign(options, { detectURLChange: node.checked })).checked = options.detectURLChange;
  onChange(f.open_new_window, (node) => Object.assign(options, { targetWindowName: node.checked ? '_blank' : null })).checked = !options.targetWindowName;
  onChange(f.forced_image_loading, (node) => Object.assign(options, { imageLoading: node.checked })).checked = options.imageLoading;
  onChange(f.base_remain_height, (node) => Object.assign(options, { baseRemainHeight: +node.value })).value = options.baseRemainHeight;
  onChange(f.min_request_interval, (node) => Object.assign(options, { minRequestInterval: +node.value })).value = options.minRequestInterval;
});
