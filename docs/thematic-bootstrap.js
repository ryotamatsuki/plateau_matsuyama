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
  if (!document.querySelector('script[data-walk-minimap]')) {
    const script = document.createElement('script');
    script.src = 'walk-minimap.js';
    script.dataset.walkMinimap = 'true';
    document.head.appendChild(script);
  }
  window.dispatchEvent(new CustomEvent('matsuyama-viewer-ready'));
})();
