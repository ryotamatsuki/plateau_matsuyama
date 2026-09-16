'use strict';

(function loadNavigationController(){
  if (document.querySelector('script[data-matsuyama-navigation]')) return;
  const script = document.createElement('script');
  script.src = 'navigation-controller.js';
  script.dataset.matsuyamaNavigation = '1';
  document.head.appendChild(script);
})();

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
