chrome.runtime.getBackgroundPage((background) => {
  var options = background.pagerOptions.get(),
      f = document.getElementById('f');

  f.update_rules.addEventListener('click', (event) => {
    background.pagerRules.update(true).then(() => {
      f.update_rules.nextElementSibling.textContent = 'success';
    }, () => {
      f.update_rules.nextElementSibling.textContent = 'failure';
    });
    event.preventDefault();
  });

  function onChange(node, fn) {
    node.addEventListener('change', (event) => {
      fn(event.target);
      background.pagerOptions.set(options);
    });
    return node;
  }

  onChange(f.debug, (node) => { options.debug = node.checked; }).checked = options.debug;
  onChange(f.enable, (node) => { options.enable = node.checked; }).checked = options.enable;
  onChange(f.detect_url_change, (node) => { options.detectURLChange = node.checked; }).checked = options.detectURLChange;
  onChange(f.open_new_window, (node) => { options.targetWindowName = node.checked ? '_blank' : null; }).checked = !options.targetWindowName;
  onChange(f.base_remain_height, (node) => { options.baseRemainHeight = +node.value; }).value = options.baseRemainHeight;
  onChange(f.min_request_interval, (node) => { options.minRequestInterval = +node.value; }).value = options.minRequestInterval;
});
