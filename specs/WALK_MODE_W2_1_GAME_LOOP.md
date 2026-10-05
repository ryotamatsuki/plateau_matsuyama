# Walk Mode 2.0 — W2.1 requestAnimationFrame game loop

## Goal

W2.1 replaces the legacy timer-driven walk control path with a single browser-frame-synchronized game loop while preserving the existing Cesium GIS, first/third-person controls, mobile sticks, terrain following, building collision behavior, and navigation ownership.

This stage intentionally does **not** introduce the final 3D avatar, footprint/capsule collider, spring camera, or LOD2 proximity streaming. Those remain W2.2–W2.5.

## Previous architecture

The previous walk implementation started:

```js
setInterval(controlTick, 1000 / 30)
```

from `walk-mode.js`.

Later, `navigation-controller.js` detected walk mode, cleared that interval, and created a second ownership path using its own `requestAnimationFrame` loop.

That produced two separate scheduling responsibilities:

- Walk owned input/state but initially scheduled a 30 Hz timer.
- Navigation later replaced the timer and became the RAF owner.

The effective runtime could be RAF after navigation initialized, but the architecture was timing-dependent and difficult to profile or extend into a real game loop.

## W2.1 architecture

`walk-mode.js` is now the only owner of character-control scheduling.

The loop is:

```
requestAnimationFrame
  -> compute frame dt
  -> input / look
  -> movement integration
  -> throttled collision sample
  -> avatar transform
  -> camera transform
  -> Cesium requestRender
```

Properties:

- scheduler: `requestAnimationFrame`;
- no walk `setInterval`;
- variable display-frame dt, capped at 1/30 s to prevent giant motion steps after stalls;
- loop stops immediately when walk mode stops;
- loop pauses when the document is hidden and restarts on visibility return;
- repeated `start()` calls cannot create duplicate RAF chains;
- `navigation-controller.js` coordinates camera ownership but no longer owns a second walk RAF loop.

## Collision budget in W2.1

The current PLATEAU collision method still uses `scene.pickFromRay()`. Replacing it with the planned footprint/capsule collider belongs to W2.3.

To keep W2.1 from doubling this expensive query when moving from 30 Hz toward display-rate control, collision sampling is explicitly rate-limited to 30 Hz and the latest result is reused between samples.

Therefore:

- input/camera/movement integration can run at display cadence;
- expensive 3D Tiles ray collision remains capped at approximately 30 samples/s;
- first collision query after loop start is immediate;
- collision state is cached only for the short sampling interval.

## Diagnostics

`window.MatsuyamaWalk.debug()` exposes:

- scheduler;
- RAF active state;
- frame count;
- control-step count;
- smoothed FPS;
- smoothed/max frame duration;
- collision-check count;
- collision sampling interval.

`window.MatsuyamaNavigation.debug()` continues exposing `rafActive` for compatibility, but it now reports the Walk-owned RAF state and additionally reports `walkScheduler`.

## Acceptance criteria

W2.1 is complete only when:

1. the legacy walk timer remains unused;
2. Walk owns exactly one RAF chain;
3. control-step count does not indicate a second navigation-owned loop;
4. start / stop / restart correctly create and destroy the RAF chain;
5. collision raycasts are decoupled from display-rate steps;
6. existing navigation, immersive, Stage 1, Stage 2.2 and thematic regressions remain green;
7. deployed Pages passes public E2E after merge.

## Deferred to later stages

- W2.2: GLB skinned avatar and idle/walk/run animation.
- W2.3: local footprint/capsule collision + terrain height cache.
- W2.4: TPS spring camera and pointer-lock tuning.
- W2.5: walk-specific LOD2 proximity streaming / render budget.
- W2.6: physical-device PC/iPhone performance gates.
