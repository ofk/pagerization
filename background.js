// const
var WEDATA_IMPORT_URL = 'http://wedata.net/databases/AutoPagerize/items_all.json',
    WEDATA_RULE_REQUIRED_KEYS = ['nextLink', 'pageElement', 'url'],
    MICROFORMATS = [
      {
        id: 'autopargerize-format',
        url: '^https?://.',
        nextLink: '//a[@rel="next"] | //link[@rel="next"]',
        insertBefore: '//*[contains(concat(" ",@class," "), " autopagerize_insert_before ")]',
        pageElement: '//*[contains(concat(" ",@class," "), " autopagerize_page_element ")]'
      }
    ],
    DEFAULT_OPTIONS = {
      debug: false, // for develop
      enable: true,
      detectURLChange: true,
      targetWindowName: '_blank',
      baseRemainHeight: 400,
      minRequestInterval: 2000
    },
    STATUS_COLORS = {
      enabled:    '#0F9D58', // green
      loading:    '#F4B400', // yellow
      error:      '#DB4437', // red
      terminated: '#4285F4', // blue
      disabled:   '#B3B3B3'  // gray
    };

// xhr wrapper
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    var req = new XMLHttpRequest;
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
  var canvas = document.createElement('canvas'),
      ctx = canvas.getContext('2d'),
      y = x, w = size - x * 2, h = size - y * 2;
  canvas.width = canvas.height = size;
  if (s) {
    var n = parseInt('#0F9D58'.slice(1), 16);
    ctx.shadowColor = 'rgba(' + (n >> 16) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', 0.2)';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = s;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
  ctx.fill();
  return ctx;
}

// storage util
var storage = {
  getData(key) {
    var val = localStorage.getItem(key);
    return val ? JSON.parse(val) : null;
  },
  setData(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  },
  get(key, force) {
    var data = this.getData(key);
    if (!force && data && data.expire) {
      if (new Date(data.expire).getTime() <= Date.now()){
        data = null;
      }
    }
    return data && data.hasOwnProperty('value') ? data.value : data;
  },
  set(key, value, expire) {
    var data = { value };
    if (expire) {
      if (expire instanceof Date) {
        data.expire = expire.toString();
      } else if (typeof expire === 'number') {
        data.expire = new Date(Date.now() + expire).toString();
      } else {
        throw new Error('invalid expire type');
      }
    }
    this.setData(key, data);
  },
  has(key, force) {
    if (!(key in localStorage)) return false;
    return this.get(key, force) !== null;
  },
  touch(key, expire) {
    var data = this.get(key, true);
    if (data) this.set(key, data, expire);
  }
};

// rules util
var pagerRules = {
  data: null,
  expire: 1000 * 60 * 60 * 24, // expire 1 day
  get() {
    if (!this.data) {
      var data = storage.get('wedataRules', true);
      this.setup(data && data.rules || []);
    }
    return this.data;
  },
  setup(rules) {
    // TODO: attach custom rules
    this.data = rules;
  },
  update(force) {
    if (!force && storage.has('wedataRules')) return new Promise(()=>{});

    return fetchJSON(WEDATA_IMPORT_URL).then((req) => {
      console.debug('succeed to update rules');
      var rules = [];
      req.response.forEach((datum) => {
        var d = datum.data || datum, r = {}, k;
        for (k of WEDATA_RULE_REQUIRED_KEYS) {
          if (d[k]) r[k] = d[k];
          if (!r[k]) return;
        }
        try {
          new RegExp(r.url);
        } catch (e) {
          return;
        }
        r.id = parseInt(datum.resource_url.match(/\d+$/), 10);
        rules.push(r);
      });
      rules.sort((a, b) => b.url.length - a.url.length);
      rules.push(...MICROFORMATS);
      storage.set('wedataRules', { rules }, this.expire); // expire 1 day
      this.setup(rules);
      return Promise.resolve(arguments[0]);
    }, () => {
      console.debug('fail to update rules');
      storage.touch('wedataRules', this.expire);
      return Promise.reject(arguments[0]);
    });
  }
};

// options util
var pagerOptions = {
  data: storage.get('options') || Object.assign({}, DEFAULT_OPTIONS),
  get() {
    return this.data;
  },
  set(data) {
    storage.set('options', data);
    this.data = data;
  }
};

// initialize
chrome.extension.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
  case 'Pagerization.initialize':
    var url = request.url;
    if (!url) return;
    sendResponse({
      rules: pagerRules.get().filter((rule) => !rule.disabled && new RegExp(rule.url).test(url)),
      options: pagerOptions.get()
    });
    break;

  case 'Pagerization.changeStatus':
    var tabId = sender.tab.id;
    var ctx = generateIconContext(STATUS_COLORS[request.status], 19, 3, 2);
    chrome.pageAction.setIcon({
      tabId: tabId,
      imageData: ctx.getImageData(0, 0, 19, 19)
    });
    chrome.pageAction.show(tabId);
    sendResponse({});
    break;

  default:
    throw new Error(`invalid request action: ${request.action}`);
  }
});

chrome.pageAction.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, {
    action: 'Pagerization.toggleStatus'
  });
});

pagerRules.update();
