(function (chrome, location, window, document, DOMParser, parseInt) {
  // utils
  var EXPANDED_PATH_CONTAINER = (new DOMParser).parseFromString('<!DOCTYPE html><html><head><base/></head><body><a/></body></html>', 'text/html'),
      NAMESPACE_RESOLVER = (document.documentElement.tagName !== 'HTML' && document.createElement('p').tagName !== document.createElement('P').tagName)
        ? (() => document.documentElement.namespaceURI) : null,
      ROOT_ELEMENT = document.compatMode === 'BackCompat' ? document.body : document.documentElement;

  function debug() {
    debug.show && console.debug.apply(console, ['[pagerization]'].concat(Array.prototype.slice.call(arguments)));
  }

  function getExpandPath(path, basePath) {
    EXPANDED_PATH_CONTAINER.querySelector('base').href = basePath;
    var anchor = EXPANDED_PATH_CONTAINER.querySelector('a');
    anchor.href = path;
    return anchor.href;
  }

  function dispatchEvent(type, options) {
    var event = document.createEvent('Event');
    event.initEvent(`Pagerization.${type}`, true, false);
    if (options) {
      for (var k in options) if (!event[k]) event[k] = options[k];
    }
    document.dispatchEvent(event);
  }

  function addEvent(type, callback) {
    window.addEventListener(`Pagerization.${type}`, callback, false);
  }

  // pagerization
  var options = {}, started, enabled, loading, loadedURLs, pageNum, nextURL, insertPoint, nextLinkPath, pageElementPath, lastLoadTime = 0;

  function initialize() {
    window.removeEventListener('scroll', checkScroll, false);
    window.removeEventListener('resize', checkScroll, false);
    window.removeEventListener('Pagerization.DOMNodeInserted', rewriteTargetWindow, false);
    started = false;
  }

  function start(rule) {
    if (started) return true;

    nextURL = location.href; // for base path
    nextLinkPath = rule.nextLink;
    pageElementPath = rule.pageElement;

    nextURL = getNextUrl(document);
    if (!nextURL) return false;

    insertPoint = getInsertPoint(document);
    if (!insertPoint) return false;

    debug('started', rule);
    started = true;
    enabled = false;
    loading = false;
    loadedURLs = {};
    pageNum = 1;

    options.enable ? enable() : disable();
    if (options.targetWindowName) addEvent('DOMNodeInserted', rewriteTargetWindow, false);
    window.addEventListener('scroll', checkScroll, false);
    window.addEventListener('resize', checkScroll, false);
    return true;
  }

  function enable() {
    debug('enable');
    dispatchEvent('enable');
    enabled = true;
    checkScroll();
  }

  function disable() {
    debug('disable');
    dispatchEvent('disable');
    enabled = false;
  }

  function load() {
    debug('load', nextURL);
    if (loadedURLs[nextURL]) {
      terminate();
      return;
    }

    loadedURLs[nextURL] = true;
    loading = true;
    dispatchEvent('load');

    new Promise((resolve, reject) => {
      setTimeout(() => {
        lastLoadTime = Date.now();
        var req = new XMLHttpRequest;
        req.onload = () => {
          req.response && !req.getResponseHeader('Access-Control-Allow-Origin') ? resolve(req) : reject(req);
        };
        req.onerror = () => {
          reject(req);
        };
        req.open('GET', nextURL, true);
        req.send(null);
      }, Math.max(0, options.minRequestInterval - (Date.now() - lastLoadTime)));
    }).then(append, error).then(() => {
      loading = false;
    });
  }

  function append(request) {
    debug('append', request);

    var doc = (new DOMParser).parseFromString(request.responseText, 'text/html');
    Array.prototype.forEach.call(doc.querySelectorAll('script'), (script) => {
      script.parentNode.removeChild(script);
    });

    var pageElements = getPageElements(doc);
    if (!pageElements.length) {
      terminate();
      return;
    }

    if (!checkInsertPoint()) {
      debug('update insert point');
      loadedURLs = {};
      loadedURLs[nextURL] = true;
      pageNum = 1;
      insertPoint = getInsertPoint(document);
    }

    var p = document.createElement('p');
    p.className = 'autopagerize_page_info';
    var a = p.appendChild(document.createElement('a'));
    a.className = 'autopagerize_link';
    a.href = nextURL;
    a.appendChild(document.createTextNode(`page: ${++pageNum}`));

    var insertParent = insertPoint.parentNode;
    if (/^tbody$/i.test(insertParent.tagName)) {
      var colSpans = 0,
          colNodes = document.evaluate('child::tr[1]/child::*[self::td or self::th]', insertParent, NAMESPACE_RESOLVER, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (var i = 0, iz = colNodes.snapshotLength; i < iz; ++i) {
        colSpans += parseInt(colNodes.snapshotItem(i).colSpan, 10) || 1;
      }
      var td = document.createElement('td');
      td.colSpan = colSpans;
      td.appendChild(p);
      insertParent.insertBefore(document.createElement('tr'), insertPoint).appendChild(td);
    } else {
      var hr = document.createElement('hr');
      hr.className = 'autopagerize_page_separator';
      insertParent.insertBefore(hr, insertPoint);
      insertParent.insertBefore(p, insertPoint);
    }
    pageElements.forEach((pageElement) => {
      var insertNode = insertParent.insertBefore(document.importNode(pageElement, true), insertPoint);
      var event = document.createEvent('MutationEvent');
      event.initMutationEvent('Pagerization.DOMNodeInserted', true, false, insertParent, null, nextURL, null, null);
      insertNode.dispatchEvent(event);
    });

    nextURL = getNextUrl(doc);
    if (!nextURL) {
      terminate();
      return;
    }

    dispatchEvent(enabled ? 'enable' : 'disable');
  }

  function error(request) {
    debug('error', request);
    dispatchEvent('error');
  }

  function terminate() {
    debug('terminate');
    dispatchEvent('terminate');
    initialize();
  }

  function rewriteTargetWindow(event) {
    if (event.target && event.target.getElementsByTagName) {
      var anchors = event.target.getElementsByTagName('a');
      for (var i = 0, iz = anchors.length; i < iz; ++i) {
        var anchor = anchors[i], href = anchor.getAttribute('href');
        if (href && !/^javascript:/.test(href) && !/^#/.test(href) && !anchor.target) {
          anchor.target = options.targetWindowName;
        }
      }
    }
  }

  function checkScroll() {
    if (!enabled || loading) return;
    if (ROOT_ELEMENT.scrollHeight - window.innerHeight - window.pageYOffset < calcRemainHeight()) {
      load();
    }
  }

  function checkInsertPoint() {
    var point = insertPoint;
    while (point) {
      if (point === document) return true;
      point = point.parentNode;
    }
    return false;
  }

  function calcRemainHeight() {
    var point = insertPoint, insertParent = point.parentNode, rect, bottom;
    while (point && !point.getBoundingClientRect) {
      point = point.nextSibling;
    }
    if (point) {
      rect = point.getBoundingClientRect();
      bottom = rect.top + window.pageYOffset;
    } else if (insertParent && insertParent.getBoundingClientRect) {
      rect = insertParent.getBoundingClientRect();
      bottom = rect.top + rect.height + window.pageYOffset;
    }
    if (!bottom) {
      bottom = Math.round(ROOT_ELEMENT.scrollHeight * 0.8);
    }
    return ROOT_ELEMENT.scrollHeight - bottom + options.baseRemainHeight;
  }

  function getPageElements(doc) {
    var r = doc.evaluate(pageElementPath, doc, NAMESPACE_RESOLVER, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null), iz = r.snapshotLength, res = new Array(iz);
    for (var i = 0; i < iz; ++i) res[i] = r.snapshotItem(i);
    return res;
  }

  function getNextUrl(doc) {
    var node = doc.evaluate(nextLinkPath, doc, NAMESPACE_RESOLVER, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (!node) return null;
    if (node.getAttribute('href') === '#') {
      // for matome.naver.jp
      var url = nextURL;
      if (!/[?&]page=\d+/.test(url)) url += (url.indexOf('?') === -1 ? '?' : '&') + 'page=0';
      return url.replace(/([?&]page=)\d+/, `$1${node.textContent.trim()}`);
    }
    return getExpandPath(node.getAttribute('href') || node.getAttribute('action') || node.getAttribute('value'), nextURL);
  }

  function getInsertPoint(doc) {
    var pageElements = getPageElements(doc);
    if (!pageElements.length) return null;
    var lastPageElement = pageElements[pageElements.length - 1];
    return lastPageElement.nextSibling || lastPageElement.parentNode.appendChild(document.createTextNode(' '));
  }

  // initialize
  var pathTid;

  function initPagerization() {
    chrome.runtime.sendMessage({
      action: 'Pagerization.initialize',
      url: location.href
    }, (response) => {
      options = response.options;
      debug.show = options.debug;
      if (pathTid) clearInterval(pathTid);
      if (options.detectURLChange && window.top == window.self) {
        var currentPath = location.pathname + location.search;
        pathTid = setInterval(() => {
          var path = location.pathname + location.search;
          if (currentPath !== path) {
            currentPath = path;
            initPagerization();
          }
        }, 1000);
      }
      initialize();
      response.rules.some((rule) => start(rule));
    });
  }
  initPagerization();

  // status
  function changeStatus(status) {
    chrome.runtime.sendMessage({ action: 'Pagerization.changeStatus', status });
  }

  addEvent('enable', () => { changeStatus('enabled'); });
  addEvent('disable', () => { changeStatus('disabled'); });
  addEvent('load', () => { changeStatus('loading'); });
  addEvent('terminate', () => { changeStatus('terminated'); });
  addEvent('error', () => { changeStatus('error'); });

  chrome.runtime.onMessage.addListener((data, sender, send) => {
    switch (data.action) {
    case 'Pagerization.toggleStatus':
      if (started) {
        enabled ? disable() : enable();
      }
      break;
    }
    send({});
  });
}(chrome, location, window, document, DOMParser, parseInt));
