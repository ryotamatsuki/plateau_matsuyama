# Walk Mode 2.0 — W2.2 GLB avatar and locomotion state

## Goal

Replace the third-person SVG billboard as the primary avatar with a real skinned glTF/GLB model rendered as a Cesium `Model` primitive, while preserving W2.1's single requestAnimationFrame control loop.

## Runtime asset

W2.2 uses the Khronos glTF Sample Assets **Cesium Man** GLB, pinned to upstream commit `03251428e295f20d8c4a65ddbbd7dafe4f251c6d`.

- skinned human model;
- glTF animation data;
- ~479 KB upstream GLB;
- CC BY 4.0; attribution is recorded in `docs/THIRD_PARTY_AVATAR.md`.

The existing SVG billboard remains only as a fallback while the GLB is loading or if the external asset fails.

## Renderer

The avatar uses `Cesium.Model.fromGltfAsync()` and is added directly to `viewer.scene.primitives`.

Every character transform update writes a new `modelMatrix` derived from:

- current longitude / latitude / terrain height;
- current character heading;
- local east-north-up fixed frame.

This avoids using a dynamic Entity model as the high-frequency character transform path.

## Locomotion state

W2.2 introduces a stable locomotion contract:

- `idle`: no active locomotion clip;
- `walk`: animation clip at 1.0x;
- `run`: locomotion clip at 1.75x.

Cesium Man has one authored locomotion animation, so W2.2 uses the same clip at different playback rates for walk/run and the bind/rest pose for idle. The state contract is deliberately independent of the sample asset, allowing a later production avatar with separate Idle/Walk/Run clips to replace it without changing input or movement logic.

Only one glTF animation is active at a time.

## Visibility

- third person: GLB visible after successful load;
- first person: GLB hidden;
- walk stopped: GLB hidden;
- GLB unavailable/loading: SVG fallback visible;
- GLB ready: SVG fallback hidden.

## Acceptance criteria

1. W2.1 remains the only control scheduler.
2. GLB loads as a Cesium primitive.
3. glTF animation metadata is discovered.
4. idle -> walk -> run -> idle follows movement input.
5. first-person mode hides the body and third-person restores it.
6. SVG is not visible after the GLB is ready.
7. model-load failure leaves the walk mode usable through the SVG fallback.
8. existing immersive/navigation/Stage 1/Stage 2.2/thematic tests remain green.
9. deployed Pages passes W2.1 and W2.2 public E2E after merge.

## Deferred

W2.3 replaces per-frame/30 Hz 3D Tiles ray collision with local footprint/capsule collision and adds a local terrain height cache. W2.4 handles TPS spring camera/pointer-lock polish.
