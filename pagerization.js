(function (chrome, window, document, URL, parseInt) {
  // utils
  const IS_XHTML = (document.documentElement.tagName !== 'HTML' && document.createElement('p').tagName !== document.createElement('P').tagName);
  const NAMESPACE_RESOLVER = IS_XHTML ? (() => document.documentElement.namespaceURI) : null;
  const ROOT_ELEMENT = document.compatMode === 'BackCompat' ? document.body : document.documentElement;
  const location = window.location;

  function debug() {
    debug.show && console.debug(...['[pagerization]'].concat(Array.from(arguments))); // eslint-disable-line prefer-rest-params
  }

  function dispatchEvent(type, options) {
    const event = document.createEvent('Event');
    event.initEvent(`Pagerization.${type}`, true, false);
    if (options) {
      for (const k in options) if (!event[k]) event[k] = options[k]; // eslint-disable-line no-restricted-syntax
    }
    document.dispatchEvent(event);
  }

  function addEvent(type, callback) {
    window.addEventListener(`Pagerization.${type}`, callback, false);
  }

  function safetyEvaluate(exp, root, type) {
    const context = root.ownerDocument || root;
    try {
      return context.evaluate(exp, root, NAMESPACE_RESOLVER, type, null);
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  function isSafetyResponse(req) {
    if (req.response) {
      if (!req.getResponseHeader('Access-Control-Allow-Origin')) return true;
      if ('responseURL' in req && location.host === new URL(req.responseURL).host) return true;
    }
    return false;
  }

  // pagerization
  let options = {};
  let started;
  let enabled;
  let loading;
  let loadedURLs;
  let pageNum;
  let nextURL;
  let insertPoint;
  let nextLinkPath;
  let pageElementPath;
  let lastLoadTime = 0;

  const BEFORE_LOAD_RULES = {
    'togetter.com': () => {
      const moreButton = document.querySelector('.more_tweet_box > .btn');
      if (moreButton) {
        moreButton.click();
        insertPoint = getInsertPoint(document);
      }
      return !!moreButton;
    },
  };

  function initialize() {
    window.removeEventListener('scroll', checkScroll, false);
    window.removeEventListener('resize', checkScroll, false);
    window.removeEventListener('Pagerization.DOMNodeInserted', rewriteTargetWindow, false);
    started = false;
  }

  function start(rule) {
    if (started) return true;

    const url = location.href; // for base path
    nextURL = url;
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
    loadedURLs[url] = true;
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
    checkLoad();
  }

  function disable() {
    debug('disable');
    dispatchEvent('disable');
    enabled = false;
  }

  function load() {
    const beforeLoad = BEFORE_LOAD_RULES[location.host];
    if (beforeLoad && beforeLoad()) return;

    if (!checkInsertPoint()) {
      debug('update insert point');
      insertPoint = getInsertPoint(document);
      loadedURLs = {};
      loadedURLs[location.href] = true;
      pageNum = 1;
      nextURL = getNextUrl(document);
      if (!nextURL) {
        terminate();
        return;
      }
    }

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
        const req = new XMLHttpRequest();
        req.onload = () => {
          isSafetyResponse(req) ? resolve(req) : reject(req);
        };
        req.onerror = () => {
          reject(req);
        };
        req.responseType = 'document';
        req.open('GET', nextURL, true);
        req.send(null);
      }, Math.max(0, options.minRequestInterval - (Date.now() - lastLoadTime)));
    }).then((req) => {
      append(req);
      loading = false;
      checkLoad();
    }, (req) => {
      error(req);
      loading = false;
    });
  }

  function append(request) {
    debug('append', request);

    const doc = request.response;
    doc.querySelectorAll('script').forEach((script) => {
      script.parentNode.removeChild(script);
    });
    if (options.imageLoading) {
      doc.querySelectorAll('img').forEach((img) => {
        const attrs = img.attributes;
        for (let i = 0, iz = attrs.length; i < iz; ++i) {
          const name = attrs[i].name;
          if (/^data-.*src$/.test(name)) {
            img.setAttribute('src', img.getAttribute(name));
            break;
          }
        }
      });
    }

    const pageElements = getPageElements(doc);
    if (!pageElements.length) {
      terminate();
      return;
    }

    const p = document.createElement('p');
    p.className = 'autopagerize_page_info';
    const a = p.appendChild(document.createElement('a'));
    a.className = 'autopagerize_link';
    a.href = nextURL;
    a.appendChild(document.createTextNode(`page: ${++pageNum}`));

    const insertParent = insertPoint.parentNode;
    if (/^tbody$/i.test(insertParent.tagName)) {
      let colSpans = 0;
      const colNodes = safetyEvaluate('child::tr[1]/child::*[self::td or self::th]', insertParent, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE);
      for (let i = 0, iz = colNodes.snapshotLength; i < iz; ++i) {
        colSpans += parseInt(colNodes.snapshotItem(i).colSpan, 10) || 1;
      }
      const td = document.createElement('td');
      td.colSpan = colSpans;
      td.appendChild(p);
      insertParent.insertBefore(document.createElement('tr'), insertPoint).appendChild(td);
    } else if (/^ul$/i.test(insertParent.tagName)) {
      const li = document.createElement('li');
      li.appendChild(p);
      const itemNode = safetyEvaluate('child::li[1]', insertParent, XPathResult.FIRST_ORDERED_NODE_TYPE).singleNodeValue;
      if (itemNode) {
        const cssFloat = window.getComputedStyle(itemNode).float;
        if (cssFloat) {
          li.style.clear = cssFloat;
          li.style.cssFloat = 'none';
        }
      }
      insertParent.insertBefore(li, insertPoint);
    } else {
      const hr = document.createElement('hr');
      hr.className = 'autopagerize_page_separator';
      insertParent.insertBefore(hr, insertPoint);
      insertParent.insertBefore(p, insertPoint);
    }
    pageElements.forEach((pageElement) => {
      const insertNode = insertParent.insertBefore(document.importNode(pageElement, true), insertPoint);
      const event = document.createEvent('MutationEvent');
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
      const anchors = event.target.getElementsByTagName('a');
      for (let i = 0, iz = anchors.length; i < iz; ++i) {
        const anchor = anchors[i];
        const href = anchor.getAttribute('href');
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

  function checkLoad() {
    if (ROOT_ELEMENT.scrollHeight < window.innerHeight) {
      checkScroll();
    }
  }

  function checkInsertPoint() {
    let point = insertPoint;
    while (point) {
      if (point === document) return true;
      point = point.parentNode;
    }
    return false;
  }

  function calcRemainHeight() {
    let point = insertPoint;
    const insertParent = point.parentNode;
    let rect;
    let bottom;
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
    const r = safetyEvaluate(pageElementPath, doc, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE);
    if (!r) return [];
    const iz = r.snapshotLength;
    const res = new Array(iz);
    for (let i = 0; i < iz; ++i) res[i] = r.snapshotItem(i);
    return res;
  }

  function getNextUrl(doc) {
    const r = safetyEvaluate(nextLinkPath, doc, XPathResult.FIRST_ORDERED_NODE_TYPE);
    if (!r) return null;
    const node = r.singleNodeValue;
    if (!node) return null;
    if (node.getAttribute('href') === '#') {
      // for matome.naver.jp
      let url = nextURL;
      if (!/[?&]page=\d+/.test(url)) url += `${url.indexOf('?') === -1 ? '?' : '&'}page=0`;
      return url.replace(/([?&]page=)\d+/, `$1${node.textContent.trim()}`);
    }
    return (new URL(node.getAttribute('href') || node.getAttribute('action') || node.getAttribute('value'), nextURL)).href;
  }

  function getInsertPoint(doc) {
    const pageElements = getPageElements(doc);
    if (!pageElements.length) return null;
    const lastPageElement = pageElements[pageElements.length - 1];
    return lastPageElement.nextSibling || lastPageElement.parentNode.appendChild(document.createTextNode(' '));
  }

  // initialize
  let pathTid;

  function initPagerization() {
    chrome.runtime.sendMessage({
      action: 'Pagerization.initialize',
      url: location.href,
    }, (response) => {
      options = response.options;
      debug.show = options.debug;
      if (pathTid) clearInterval(pathTid);
      if (options.detectURLChange && window.top == window.self) { // eslint-disable-line eqeqeq
        let currentPath = location.pathname + location.search;
        pathTid = setInterval(() => {
          const path = location.pathname + location.search;
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
}(chrome, window, document, URL, parseInt));
