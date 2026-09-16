'use strict';

(function loadNavigationController(){
  if (!document.querySelector('script[data-matsuyama-navigation]')) {
    const script = document.createElement('script');
    script.src = 'navigation-controller.js';
    script.dataset.matsuyamaNavigation = '1';
    document.head.appendChild(script);
  }
  if (!document.querySelector('script[data-matsuyama-walk-ux]')) {
    const ux = document.createElement('script');
    ux.src = 'walk-landing-ux.js';
    ux.dataset.matsuyamaWalkUx = '1';
    document.head.appendChild(ux);
  }
  if (!document.getElementById('landingSelectorLayoutFix')) {
    const style = document.createElement('style');
    style.id = 'landingSelectorLayoutFix';
    style.textContent = `
      body .landing-selector-card{left:50%;right:auto;top:max(80px,calc(env(safe-area-inset-top) + 64px));transform:translateX(-50%);width:min(520px,calc(100% - 30px))}
      @media(max-width:700px),(pointer:coarse){body .landing-selector-card{left:12px;right:12px;top:max(118px,calc(env(safe-area-inset-top) + 110px));transform:none;width:auto}}
    `;
    document.head.appendChild(style);
  }
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