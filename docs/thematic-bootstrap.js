'use strict';

(function waitForViewer() {
  const viewer = window.__matsuyamaViewer;
  if (!viewer || viewer.isDestroyed?.()) {
    setTimeout(waitForViewer, 80);
    return;
  }
  if (!window.MatsuyamaApp) {
    window.MatsuyamaApp = {
      viewer,
      render: () => viewer.scene.requestRender()
    };
  }
  window.dispatchEvent(new CustomEvent('matsuyama-viewer-ready'));
})();
