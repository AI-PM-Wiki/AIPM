(function () {
  if (window !== top) return;
  window.__aipmBlockedUploads = [];
  function blocked(url, method, channel) {
    var target = new URL(url, location.href);
    if (["127.0.0.1", "localhost"].includes(target.hostname) || ["GET", "HEAD"].includes(method.toUpperCase())) return false;
    window.__aipmBlockedUploads.push({ channel: channel, origin: target.origin, path: target.pathname, method: method });
    return true;
  }
  var originalFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = input instanceof Request ? input.url : String(input);
    var method = (init && init.method) || (input instanceof Request ? input.method : "GET");
    if (blocked(url, method, "fetch")) return Promise.reject(new DOMException("External upload blocked by test", "NetworkError"));
    return originalFetch.apply(this, arguments);
  };
  var originalBeacon = navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = function (url, body) {
    if (blocked(String(url), "POST", "sendBeacon")) return false;
    return originalBeacon(url, body);
  };
  var requests = new WeakMap();
  var originalOpen = XMLHttpRequest.prototype.open;
  var originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    requests.set(this, { method: method, url: String(url) });
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    var request = requests.get(this);
    if (request && blocked(request.url, request.method, "XHR")) { this.abort(); return; }
    return originalSend.apply(this, arguments);
  };
})();
