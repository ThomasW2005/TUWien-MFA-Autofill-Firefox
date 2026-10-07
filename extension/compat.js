/* Firefox's promise API and Chrome's callback-based message responses. */
(() => {
  if (typeof globalThis.browser !== 'undefined') return;
  const api = globalThis.chrome;
  globalThis.browser = {
    action: api.action,
    permissions: api.permissions,
    storage: api.storage,
    runtime: {
      openOptionsPage: () => api.runtime.openOptionsPage(),
      getManifest: () => api.runtime.getManifest(),
      sendMessage: message => api.runtime.sendMessage(message),
      onInstalled: api.runtime.onInstalled,
      onMessage: {
        addListener(listener) {
          api.runtime.onMessage.addListener((message, sender, sendResponse) => {
            const result = listener(message, sender);
            if (result === undefined) return false;
            Promise.resolve(result).then(sendResponse, () => sendResponse({error: 'Unable to prepare login. Check settings.'}));
            return true;
          });
        }
      }
    }
  };
})();
