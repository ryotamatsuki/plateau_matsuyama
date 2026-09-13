'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  let initialized = false;

  function init() {
    if (initialized || !window.MatsuyamaApp || !window.Cesium) return;
    initialized = true;

    const C = Cesium;
    const viewer = window.MatsuyamaApp.viewer;
    const render = window.MatsuyamaApp.render || (() => viewer.scene.requestRender());
    let thematicLayer = null;
    let rainLayer = null;
    let shelterSeq = 0;
    let shelterTileKey = '';
    const shelterSource = new C.CustomDataSource('designated-shelters');
    viewer.dataSources.add(shelterSource);

    const thematicDefs = {
      geology: {
        label: '地質図｜産総研 20万分の1日本シームレス地質図V2',
        url: 'https://gbank.gsj.jp/seamless/v2/api/1.3/tiles/{z}/{y}/{x}.png?layer=g&type=level2',
        min: 3,
        max: 13,
        credit: '<a href="https://gbank.gsj.jp/seamless/" target="_blank">産総研地質調査総合センター</a>'
      },
      fault: {
        label: '断層・撓曲｜産総研 20万分の1日本シームレス地質図V2',
        url: 'https://gbank.gsj.jp/seamless/v2/api/1.3/tiles/{z}/{y}/{x}.png?layer=f',
        min: 10,
        max: 13,
        credit: '<a href="https://gbank.gsj.jp/seamless/" target="_blank">産総研地質調査総合センター</a>'
      },
      forest: {
        label: '森林計画対象森林｜林野庁 2025',
        url: 'https://rinya-tiles.geospatial.jp/fr_layer_webp_2025/{z}/{x}/{y}.webp',
        min: 5,
        max: 16,
        credit: '<a href="https://www.geospatial.jp/ckan/dataset/layer" target="_blank">林野庁 森林計画対象森林レイヤ</a>'
      },
      did2020: {
        label: '人口集中地区｜令和2年国勢調査',
        url: 'https://cyberjapandata.gsi.go.jp/xyz/did2020/{z}/{x}/{y}.png',
        min: 5,
        max: 18,
        credit: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル／人口集中地区</a>'
      }
    };

    function setStatus(text) {
      const el = $('thematicStatus');
      if (el) el.textContent = text;
    }

    function centerLonLat() {
      const canvas = viewer.canvas;
      const ray = viewer.camera.getPickRay(new C.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
      const point = ray ? viewer.scene.globe.pick(ray, viewer.scene) : null;
      const carto = point ? C.Cartographic.fromCartesian(point) : viewer.camera.positionCartographic;
      return {
        lon: C.Math.toDegrees(carto.longitude),
        lat: C.Math.toDegrees(carto.latitude)
      };
    }

    async function updateGeologyInfo() {
      const selected = $('thematicLayer')?.value;
      if (selected !== 'geology' && selected !== 'fault') return;
      const { lon, lat } = centerLonLat();
      try {
        const r = await fetch(`https://gbank.gsj.jp/seamless/v2/api/1.3/legend.json?point=${lat.toFixed(6)},${lon.toFixed(6)}`);
        if (!r.ok) throw new Error(String(r.status));
        const g = await r.json();
        const age = g.formationAge_ja || '年代不明';
        const lith = g.lithology_ja || g.group_ja || '岩相不明';
        setStatus(`${thematicDefs[selected].label}｜中心地点: ${age} / ${lith}`);
      } catch (_) {
        setStatus(`${thematicDefs[selected].label}｜中心地点の地質属性を取得できませんでした。`);
      }
    }

    function setThematic() {
      if (thematicLayer) {
        viewer.imageryLayers.remove(thematicLayer, true);
        thematicLayer = null;
      }
      const key = $('thematicLayer')?.value || 'none';
      const def = thematicDefs[key];
      if (!def) {
        setStatus('追加主題図は非表示です。');
        render();
        return;
      }
      const provider = new C.UrlTemplateImageryProvider({
        url: def.url,
        minimumLevel: def.min,
        maximumLevel: def.max,
        credit: new C.Credit(def.credit)
      });
      thematicLayer = viewer.imageryLayers.addImageryProvider(provider);
      thematicLayer.alpha = Number($('thematicOpacity')?.value || 55) / 100;
      provider.errorEvent.addEventListener(() => {
        setStatus(`${def.label}｜一部タイルを取得できません。配信元の提供範囲・通信状況を確認してください。`);
      });
      setStatus(def.label);
      if (key === 'geology' || key === 'fault') updateGeologyInfo();
      render();
    }

    function setThematicOpacity() {
      const value = Number($('thematicOpacity')?.value || 55);
      if ($('thematicOpacityValue')) $('thematicOpacityValue').textContent = `${value}%`;
      if (thematicLayer) thematicLayer.alpha = value / 100;
      render();
    }

    function xyz(lon, lat, z) {
      const n = 2 ** z;
      const x = Math.floor((lon + 180) / 360 * n);
      const rad = C.Math.toRadians(Math.max(-85.0511, Math.min(85.0511, lat)));
      const y = Math.floor((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2 * n);
      return { x, y };
    }

    function shelterFeatureName(p) {
      return p.name || p['名称'] || p['施設名称'] || p['指定避難所名称'] || p['避難所名'] || '指定避難所';
    }

    async function refreshShelters(force = false) {
      if (!$('sheltersEnabled')?.checked) {
        shelterSource.entities.removeAll();
        shelterTileKey = '';
        if ($('shelterStatus')) $('shelterStatus').textContent = '指定避難所は非表示です。';
        render();
        return;
      }
      const { lon, lat } = centerLonLat();
      const z = 10;
      const center = xyz(lon, lat, z);
      const key = `${center.x}/${center.y}`;
      if (!force && key === shelterTileKey) return;
      const seq = ++shelterSeq;
      if ($('shelterStatus')) $('shelterStatus').textContent = '指定避難所を読み込み中…';
      const urls = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const type of ['sih', 'sfh']) {
            urls.push({
              type,
              url: `https://cyberjapandata.gsi.go.jp/xyz/${type}/${z}/${center.x + dx}/${center.y + dy}.geojson`
            });
          }
        }
      }
      const results = await Promise.all(urls.map(async (item) => {
        try {
          const r = await fetch(item.url);
          if (!r.ok) return [];
          const json = await r.json();
          return (json.features || []).map((f) => ({ type: item.type, feature: f }));
        } catch (_) {
          return [];
        }
      }));
      if (seq !== shelterSeq || !$('sheltersEnabled')?.checked) return;
      const dedupe = new Set();
      const next = [];
      for (const list of results) {
        for (const item of list) {
          const f = item.feature;
          if (!f?.geometry || f.geometry.type !== 'Point') continue;
          const [flon, flat] = f.geometry.coordinates || [];
          if (!Number.isFinite(flon) || !Number.isFinite(flat)) continue;
          const p = f.properties || {};
          const name = shelterFeatureName(p);
          const id = `${item.type}:${name}:${Number(flon).toFixed(6)}:${Number(flat).toFixed(6)}`;
          if (dedupe.has(id)) continue;
          dedupe.add(id);
          next.push({ type: item.type, lon: flon, lat: flat, name, props: p });
        }
      }
      shelterSource.entities.removeAll();
      for (const s of next) {
        const welfare = s.type === 'sfh';
        shelterSource.entities.add({
          id: `shelter:${s.type}:${s.lon}:${s.lat}:${s.name}`,
          name: s.name,
          position: C.Cartesian3.fromDegrees(s.lon, s.lat, 2),
          point: {
            pixelSize: welfare ? 10 : 9,
            color: welfare ? C.Color.fromCssColorString('#8e44ad') : C.Color.fromCssColorString('#1877d2'),
            outlineColor: C.Color.WHITE,
            outlineWidth: 2,
            heightReference: C.HeightReference.RELATIVE_TO_GROUND,
            disableDepthTestDistance: 4000
          },
          label: {
            text: s.name,
            font: '12px sans-serif',
            fillColor: C.Color.WHITE,
            showBackground: true,
            backgroundColor: C.Color.fromCssColorString('#152838').withAlpha(0.82),
            pixelOffset: new C.Cartesian2(0, -18),
            distanceDisplayCondition: new C.DistanceDisplayCondition(0, 3500),
            heightReference: C.HeightReference.RELATIVE_TO_GROUND,
            disableDepthTestDistance: 4000
          }
        });
      }
      shelterTileKey = key;
      if ($('shelterStatus')) $('shelterStatus').textContent = `指定避難所 ${next.length}件を表示｜青:一般、紫:福祉（地理院タイル）`;
      render();
    }

    function formatJmaTime(s) {
      if (!/^\d{14}$/.test(String(s || ''))) return String(s || '');
      return `${s.slice(0,4)}/${s.slice(4,6)}/${s.slice(6,8)} ${s.slice(8,10)}:${s.slice(10,12)} JST`;
    }

    async function refreshRain() {
      if (rainLayer) {
        viewer.imageryLayers.remove(rainLayer, true);
        rainLayer = null;
      }
      if (!$('rainEnabled')?.checked) {
        if ($('rainStatus')) $('rainStatus').textContent = '気象庁の雨雲実況は非表示です。';
        render();
        return;
      }
      if ($('rainStatus')) $('rainStatus').textContent = '気象庁の最新雨雲時刻を取得中…';
      try {
        const r = await fetch('https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const times = await r.json();
        const t = times.find((x) => Array.isArray(x.elements) && x.elements.includes('hrpns')) || times[0];
        if (!t) throw new Error('no target time');
        const url = `https://www.jma.go.jp/bosai/jmatile/data/nowc/${t.basetime}/none/${t.validtime}/surf/hrpns/{z}/{x}/{y}.png`;
        const provider = new C.UrlTemplateImageryProvider({
          url,
          minimumLevel: 4,
          maximumLevel: 10,
          credit: new C.Credit('<a href="https://www.jma.go.jp/bosai/nowc/" target="_blank">気象庁 高解像度降水ナウキャスト</a>')
        });
        rainLayer = viewer.imageryLayers.addImageryProvider(provider);
        rainLayer.alpha = 0.62;
        if ($('rainStatus')) $('rainStatus').textContent = `雨雲実況 ${formatJmaTime(t.validtime)}｜気象庁`; 
        render();
      } catch (_) {
        if ($('rainStatus')) $('rainStatus').textContent = '雨雲実況を取得できません。気象庁「今後の雨」を確認してください。';
      }
    }

    function compass(deg) {
      const names = ['北','北北東','北東','東北東','東','東南東','南東','南南東','南','南南西','南西','西南西','西','西北西','北西','北北西'];
      const d = ((Number(deg) % 360) + 360) % 360;
      return names[Math.round(d / 22.5) % 16];
    }

    async function refreshWeather() {
      const { lon, lat } = centerLonLat();
      const status = $('weatherStatus');
      if (status) status.textContent = '表示中心の風向・風速を取得中…';
      try {
        const q = new URLSearchParams({
          latitude: lat.toFixed(5),
          longitude: lon.toFixed(5),
          current: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation',
          wind_speed_unit: 'ms',
          timezone: 'Asia/Tokyo'
        });
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
        if (!r.ok) throw new Error(String(r.status));
        const data = await r.json();
        const c = data.current || {};
        const speed = Number(c.wind_speed_10m);
        const dir = Number(c.wind_direction_10m);
        const gust = Number(c.wind_gusts_10m);
        const rain = Number(c.precipitation);
        if (status) status.textContent = `中心 ${lat.toFixed(4)}, ${lon.toFixed(4)}｜風 ${compass(dir)} ${Number.isFinite(speed)?speed.toFixed(1):'-'} m/s（最大瞬間 ${Number.isFinite(gust)?gust.toFixed(1):'-'} m/s）｜降水 ${Number.isFinite(rain)?rain.toFixed(1):'-'} mm｜${c.time || ''} Open-Meteo`;
      } catch (_) {
        if (status) status.textContent = '風向・風速を取得できません。';
      }
    }

    $('thematicLayer')?.addEventListener('change', setThematic);
    $('thematicOpacity')?.addEventListener('input', setThematicOpacity);
    $('sheltersEnabled')?.addEventListener('change', () => refreshShelters(true));
    $('rainEnabled')?.addEventListener('change', refreshRain);
    $('weatherRefresh')?.addEventListener('click', () => { refreshWeather(); if ($('rainEnabled')?.checked) refreshRain(); });

    let moveTimer = null;
    viewer.camera.moveEnd.addEventListener(() => {
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => {
        if ($('sheltersEnabled')?.checked) refreshShelters(false);
        const selected = $('thematicLayer')?.value;
        if (selected === 'geology' || selected === 'fault') updateGeologyInfo();
      }, 180);
    });

    setThematicOpacity();
    setThematic();
    refreshWeather();
    if ($('sheltersEnabled')?.checked) refreshShelters(true);
    if ($('rainEnabled')?.checked) refreshRain();

    window.MatsuyamaThematic = {
      refreshWeather,
      refreshRain,
      refreshShelters: () => refreshShelters(true),
      setThematic
    };
  }

  if (window.MatsuyamaApp) init();
  else window.addEventListener('matsuyama-viewer-ready', init, { once: true });
})();
