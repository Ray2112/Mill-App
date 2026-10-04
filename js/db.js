/* Armazenamento local no telemóvel (IndexedDB) — funciona sem rede.
   Local on-device storage (IndexedDB) — works offline. */
(function (root) {
  'use strict';
  const DB_NAME = 'moagem-app';
  const DB_VERSION = 1;
  const STORES = ['lots', 'events', 'settings'];
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains('lots')) db.createObjectStore('lots', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'seq', autoIncrement: true });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let result;
        Promise.resolve(fn(s)).then(function (r) { result = r; });
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }
  function reqP(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }

  const DB = {
    all: function (store) { return tx(store, 'readonly', function (s) { return reqP(s.getAll()); }); },
    put: function (store, obj) { return tx(store, 'readwrite', function (s) { return reqP(s.put(obj)); }); },
    add: function (store, obj) { return tx(store, 'readwrite', function (s) { return reqP(s.add(obj)); }); },
    get: function (store, key) { return tx(store, 'readonly', function (s) { return reqP(s.get(key)); }); },
    getSetting: function (key, dflt) { return DB.get('settings', key).then(function (r) { return r ? r.value : dflt; }); },
    setSetting: function (key, value) { return DB.put('settings', { key: key, value: value }); },
    exportAll: function () {
      return Promise.all(STORES.map(DB.all)).then(function (r) {
        return { app: 'moagem-app', format: 1, exportedAt: new Date().toISOString(), lots: r[0], events: r[1], settings: r[2] };
      });
    },
    // Restaurar cópia de segurança: substitui tudo / Restore backup: replaces everything
    importAll: function (data) {
      if (!data || data.app !== 'moagem-app' || data.format !== 1) return Promise.reject(new Error('bad-backup'));
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          const t = db.transaction(STORES, 'readwrite');
          STORES.forEach(function (name) {
            const s = t.objectStore(name);
            s.clear();
            (data[name] || []).forEach(function (o) { s.put(o); });
          });
          t.oncomplete = resolve; t.onerror = function () { reject(t.error); };
        });
      });
    },
    persist: function () {
      if (navigator.storage && navigator.storage.persist) return navigator.storage.persist();
      return Promise.resolve(false);
    }
  };
  root.DB = DB;
})(this);
