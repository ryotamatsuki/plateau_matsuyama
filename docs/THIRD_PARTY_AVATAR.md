# Walk avatar third-party asset

## RobotExpressive

Walk Mode uses the **RobotExpressive** GLB from the official three.js repository.

Pinned runtime source:

`https://raw.githubusercontent.com/mrdoob/three.js/eba30de865cfbf31ac736f792defd9a60ff28d57/examples/models/gltf/RobotExpressive/RobotExpressive.glb`

Model author: Tomás Laulhé. Modifications: Don McCurdy.

License: **CC0 1.0 Universal**.

The model contains distinct skeletal animation clips including `Idle`, `Walking`, and `Running`. Walk Mode maps those clips directly to locomotion states; it does not synthesize running by speeding up a walking clip.

The existing SVG billboard remains a runtime fallback if the GLB cannot load.

## Replaced W2.2 validation asset

W2.2 initially used Khronos glTF Sample Assets **Cesium Man** (CC BY 4.0) as an interoperability proof. It had only one locomotion animation and was not suitable as production character art. The production walk path no longer loads it.
