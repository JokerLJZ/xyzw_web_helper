
// create by elishell <75950346@qq.com>
import type { App } from "vue";

const _timeout = 5 * 1000;

const [key, val, timeout, ok, reject, reslove, config] = [
  Symbol("key"),
  Symbol("val"),
  Symbol("timeout"),
  Symbol("ok"),
  Symbol("reject"),
  Symbol("reslove"),
  Symbol("config"),
];

class Content {
  constructor() {}
}

class CacheItem {
  constructor(_key, _val, _t = _timeout) {
    this[key] = _key;
    this[val] = _val;
    this[timeout] = +new Date() + _t;

    this[reject] = [];
    this[reslove] = [];
  }

  get reject() {
    return this[reject];
  }

  get reslove() {
    return this[reslove];
  }

  get timeout() {
    return this[timeout];
  }

  get key() {
    return this[key];
  }

  set val(data) {
    this[ok] = true;
    this[val] = data;
  }

  get val() {
    return this[val];
  }

  toJSON() {
    return {
      key: this[key],
      val: this[val],
      timeout: this[timeout],
    };
  }

  isTimeout() {
    return this[timeout] < +new Date();
  }

  isOk() {
    return this[ok];
  }
}

class Cache {
  constructor(name, { content = new Content(), timeout = _timeout }) {
    this.name = name;
    this.content = content;
    this[config] = {
      content,
      timeout,
    };
  }

  async get(key, callback, conf) {
    const item = this.content[key];
    // 没有 初始化
    if (item != null) {
      if (!item.isOk()) {
        return new Promise((reslove, reject) => {
          item.reslove.push(reslove);
          item.reject.push(reject);
        });
      }
      if (!item.isTimeout()) {
        return item.val;
      }
    }
    return this.feach(key, callback, {
      ...this[config],
      ...conf,
    });
  }

  async feach(key, callback, conf = this[config]) {
    const oldItem = this.content[key];
    const newItem = new CacheItem(key, null, conf.timeout);
    this.content[key] = newItem;
    try {
      const data = await (typeof callback === "function" ? callback(key, conf) : callback);
      newItem.val = data;
      for (const item of [oldItem, newItem]) item?.reslove.forEach((resolve) => resolve(data));
      return data;
    } catch (error) {
      if (this.content[key] === newItem) delete this.content[key];
      for (const item of [oldItem, newItem]) item?.reject.forEach((reject) => reject(error));
      throw error;
    } finally {
      for (const item of [oldItem, newItem]) {
        if (item) { item.reject.length = 0; item.reslove.length = 0; }
      }
    }
  }

  clean(content = new Content()) {
    this.content = content;
  }
}

class CacheManager {
  constructor(content = new Content(), timeout = _timeout) {
    this.content = content;
    this.timeout = timeout;
  }

  getCache(name, config) {
    let cache = this.content[name];
    if (cache == null) {
      this.content[name] = cache = new Cache(name, {
        timeout: this.timeout,
        ...config,
      });
    } else {
      config && (cache.timeout = config.timeout);
    }
    return cache;
  }

  delCache(name) {
    delete this.content[name];
  }

  clear() {
    this.content = new Content();
  }
}

const $CacheManager = new CacheManager();

const install = (vm:App, options:any) => {
  if (vm.version.startsWith("3.")) {
    vm.config.globalProperties.$CacheManager = $CacheManager;
  } else {
    vm.prototype.$CacheManager = $CacheManager;
  }
};

if (typeof window !== "undefined") window.$CacheManager = $CacheManager;

export { $CacheManager, Content, CacheManager, Cache, install };
