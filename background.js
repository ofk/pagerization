// const
const WEDATA_IMPORT_URL = 'http://wedata.net/databases/AutoPagerize/items_all.json';
const WEDATA_RULE_REQUIRED_KEYS = ['nextLink', 'pageElement', 'url'];
const MICROFORMATS = [
  {
    id: 'autopargerize-format',
    url: '^https?://.',
    nextLink: '//a[@rel="next"] | //link[@rel="next"]',
    insertBefore: '//*[contains(concat(" ",@class," "), " autopagerize_insert_before ")]',
    pageElement: '//*[contains(concat(" ",@class," "), " autopagerize_page_element ")]',
  },
];
const DEFAULT_OPTIONS = {
  debug: false, // for develop
  enable: true,
  detectURLChange: true,
  targetWindowName: '_blank',
  baseRemainHeight: 400,
  minRequestInterval: 2000,
};
const STATUS_COLORS = {
  enabled: '#0F9D58', // green
  loading: '#F4B400', // yellow
  error: '#DB4437', // red
  terminated: '#4285F4', // blue
  disabled: '#B3B3B3', // gray
};

// debug
function debug() {
  if (pagerOptions.getSync().debug) {
    // eslint-disable-next-line prefer-rest-params
    console.debug('[pagerization background]', ...arguments);
  }
}

// xhr wrapper
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.onload = () => {
      req.response ? resolve(req) : reject(req);
    };
    req.onerror = () => {
      reject(req);
    };
    req.responseType = 'json';
    req.open('GET', url, true);
    req.send(null);
  });
}

// icon generator
function generateIconContext(color, size, x, r, s) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const y = x;
  const w = size - x * 2;
  const h = size - y * 2;
  canvas.width = size;
  canvas.height = size;
  if (s) {
    const n = parseInt(color.slice(1), 16);
    ctx.shadowColor = `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, 0.2)`;
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = s;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
  return ctx;
}

// storage util
const storage = {
  getRawData(key) {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : null;
  },
  setRawData(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  },
  getSync(key, force) {
    let data = this.getRawData(key);
    if (!force && data && data.expire) {
      if (new Date(data.expire).getTime() <= Date.now()) {
        data = null;
      }
    }
    return data && ('value' in data) ? data.value : data;
  },
  setSync(key, value, expire) {
    const data = { value };
    if (expire) {
      if (expire instanceof Date) {
        data.expire = expire.toString();
      } else if (typeof expire === 'number') {
        data.expire = new Date(Date.now() + expire).toString();
      } else {
        throw new Error('invalid expire type');
      }
    }
    this.setRawData(key, data);
  },
  touch(key, expire) {
    const data = this.getSync(key, true);
    if (data) this.setSync(key, data, expire);
  },
};

// rules util
const pagerRules = {
  data: null,
  expire: 1000 * 60 * 60 * 24, // expire 1 day
  getSync() {
    if (!this.data) {
      const data = storage.getSync('wedataRules', true);
      this.setup(data && data.rules || []);
    }
    return this.data;
  },
  setup(rules) {
    // TODO: attach custom rules
    this.data = rules;
  },
  fetch(force) {
    if (!force && storage.getSync('wedataRules') !== null) return new Promise(() => {});

    debug('[fetch]', 'request');

    return fetchJSON(WEDATA_IMPORT_URL).then((req) => {
      debug('[fetch]', 'succeed to fetch rules');
      const rules = [];
      req.response.forEach((datum) => {
        const d = datum.data || datum;
        const r = {};
        for (const k of WEDATA_RULE_REQUIRED_KEYS) { // eslint-disable-line no-restricted-syntax
          if (d[k]) r[k] = d[k];
          if (!r[k]) return;
        }
        try {
          new RegExp(r.url); // eslint-disable-line no-new
        } catch (e) {
          debug('[fetch]', 'invalid url', r.url, r);
          return;
        }
        r.id = parseInt(datum.resource_url.match(/\d+$/), 10);
        rules.push(r);
      });
      rules.sort((a, b) => b.url.length - a.url.length);
      rules.push(...MICROFORMATS);
      storage.setSync('wedataRules', { rules }, this.expire); // expire 1 day
      this.setup(rules);
      return Promise.resolve(req);
    }, (req) => {
      debug('[fetch]', 'fail to fetch rules');
      storage.touch('wedataRules', this.expire);
      return Promise.reject(req);
    });
  },
};

// options util
const pagerOptions = {
  data: storage.getSync('options') || Object.assign({}, DEFAULT_OPTIONS),
  getSync() {
    return this.data;
  },
  setSync(data) {
    storage.setSync('options', data);
    this.data = data;
  },
};

// initialize
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  debug('[onMessage]', 'request', request);

  switch (request.action) {
    case 'Pagerization.initialize':
      const url = request.url;
      sendResponse({
        rules: url ? pagerRules.getSync().filter((rule) => new RegExp(rule.url).test(url)) : [],
        options: pagerOptions.getSync(),
      });
      break;

    case 'Pagerization.changeStatus':
      const tabId = sender.tab.id;
      const ctx = generateIconContext(STATUS_COLORS[request.status], 19, 3, 2);
      chrome.pageAction.setIcon({
        tabId,
        imageData: ctx.getImageData(0, 0, 19, 19),
      });
      chrome.pageAction.show(tabId);
      sendResponse({});
      break;

    case 'Pagerization.setOptions':
      pagerOptions.setSync(request.options);
      sendResponse({});
      break;

    case 'Pagerization.fetchRules':
      pagerRules.fetch(request.force).then(() => {
        sendResponse({ status: 'success' });
      }, () => {
        sendResponse({ status: 'failure' });
      });
      break;

    default:
      throw new Error(`invalid request action: ${request.action}`);
  }
  return true;
});

chrome.pageAction.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, {
    action: 'Pagerization.toggleStatus',
  });
});

pagerRules.fetch();
