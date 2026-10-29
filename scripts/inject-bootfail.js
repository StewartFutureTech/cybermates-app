// Injected before any page script: simulate an in-app WKWebView where storage + WebCrypto reject with WebKit's UnknownError.
(() => { const MODE = globalThis.__cmFailMode || 'all'; // 'cryptokey-idb' = only storing a CryptoKey in IndexedDB fails (believed WKWebView culprit)
  const err = () => { try { return new DOMException('The operation failed for an operation-specific reason', 'UnknownError'); } catch { return new Error('UnknownError'); } };
  const rej = () => Promise.reject(err());
  if (MODE === 'cryptokey-idb') { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (v, k) { if (v instanceof CryptoKey) throw err(); return put.call(this, v, k); }; window.__cmInjected = true; return; }
  try { const open = () => { const r = { result: null, error: err(), onerror: null, onsuccess: null, onupgradeneeded: null, addEventListener() {} }; setTimeout(() => r.onerror?.({ target: r })); return r; };
    Object.defineProperty(IDBFactory.prototype, 'open', { value: open, configurable: true }); } catch {}
  try { for (const k of ['open', 'keys', 'match', 'has', 'delete']) Object.defineProperty(CacheStorage.prototype, k, { value: rej, configurable: true }); } catch {}
  try { if (globalThis.ServiceWorkerContainer) { Object.defineProperty(ServiceWorkerContainer.prototype, 'register', { value: rej, configurable: true }); Object.defineProperty(ServiceWorkerContainer.prototype, 'getRegistrations', { value: rej, configurable: true }); } } catch {}
  try { for (const k of ['generateKey', 'importKey', 'exportKey', 'sign', 'verify', 'encrypt', 'decrypt', 'digest', 'deriveKey', 'deriveBits', 'wrapKey', 'unwrapKey']) Object.defineProperty(SubtleCrypto.prototype, k, { value: rej, configurable: true }); } catch {}
  try { if (navigator.storage) navigator.storage.persist = rej; } catch {}
  window.__cmInjected = true;
})();
