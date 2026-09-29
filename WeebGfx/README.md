# WeebGfx

Backend-agnostic graphics architecture and hardware rendering engine.

---

## Overview

WeebGfx separates graphics primitives into two foundational layers:

1. **Hardware-Agnostic Core**: Pure CPU representations and abstract GPU resource interfaces for geometry, textures, shaders, skeletons, and draw units.
2. **Subsystems**: Dedicated modules for backend implementations, asset loading, and future rendering architectures.

Detailed subsystem documentation is maintained in dedicated directories:
- **WebGPU Backend**: [wgpu/README.md](./wgpu/README.md)
- **Model Loader**: [loader/README.md](./loader/README.md)
- **Shader Graph**: [wgpu/shadergraph/README.md](./wgpu/shadergraph/README.md)

---

## Core Primitives

### Resource Base Inheritance

WeebGfx structures graphics resources as paired CPU data definitions and hardware GPU implementations.

```
MeshCPU    ---> MeshGPU    (e.g. MeshWGPU)
TextureCPU ---> TextureGPU (e.g. TextureWGPU)
                ShaderGPU  (e.g. ShaderWGPU)
```

#### Geometry: `MeshCPU` & `MeshGPU`

- `MeshCPU`: Pure memory container storing raw vertex binary buffers (`vertexBytes`), optional index buffers (`indexBytes`), vertex layout descriptors, and submesh slice ranges.
- `MeshGPU`: Base class for hardware geometry wrappers storing GPU buffer handles and submesh slice descriptors.

```typescript
import { MeshCPU, type Submesh, type VertexLayout } from "@asciiz/weebgfx";

const layout: VertexLayout = {
    arrayStride: 24,
    attributes: [
        { name: "position", format: "float32x3", offset: 0, shaderLocation: 0 },
        { name: "normal", format: "float32x3", offset: 12, shaderLocation: 1 },
    ],
};

const submeshes: Submesh[] = [
    { firstIndex: 0, indexCount: 36, materialIndex: 0 },
];

const cpuMesh = new MeshCPU(layout, submeshes, vertexBytes, indexBytes);
```

#### Textures: `TextureCPU` & `TextureGPU`

- `TextureCPU`: Uncompressed CPU pixel buffer (`width`, `height`, `format`, `data: Uint8Array`).
- `TextureGPU`: Base class for hardware texture representations.

```typescript
import { TextureCPU } from "@asciiz/weebgfx";

const cpuTexture = new TextureCPU(
    512,
    512,
    "rgba8unorm",
    pixelBytes
);
```

#### Shaders: `ShaderGPU`

Abstract base class for compiled hardware pipelines. Exposes reflection metadata (`ShaderMeta`), default parameters, and disposal hooks.

---

### Actor

`Actor` is the atomic draw item in WeebGfx. It pairs a hardware mesh with shader pass buckets, instance matrices, and skeletal skinning data.

Instancing is the default model: a single object is represented as 1 instance.

```typescript
import { Actor } from "@asciiz/weebgfx";

// Single object (1 instance):
const actor = new Actor(gpuMesh, gpuShader, worldMatrix);

// Multi-instance batch (N instances):
const batchActor = new Actor(gpuMesh, gpuShader)
    .setInstances(flatMatricesFloat32Array, 100);

// Multi-pass shader (e.g. base material + outline pass):
actor.addPass(outlineShader, undefined, outlineParams);
```

#### Properties

- `mesh`: Target `MeshGPU` instance.
- `passes`: Array of `ActorPass` buckets. Each pass holds a `shader`, `submeshIndices`, and `params`.
- `instances`: Unified `InstanceData` holding contiguous `Float32Array` matrices and active count.
- `transform`: World transformation matrix of the primary instance (index 0).
- `normalMatrix`: Normal transformation matrix of the primary instance (index 0).
- `skin`: Optional skeletal skinning joint matrices (`Float32Array`) and joint count.

#### Methods

- `addPass(shader, submeshIndices?, params?)`: Adds or appends a pass bucket for specified submeshes with optional parameters. Targets all submeshes if omitted.
- `setPass(shader, submeshIndices?, params?)`: Replaces all passes with the specified shader pass.
- `getPass(shader)`: Retrieves the pass matching the given shader.
- `removePass(shader)`: Removes the pass matching the given shader.
- `clearPasses()`: Removes all passes from the actor.
- `setPassParams(shader, params, submeshIndex?)`: Sets parameter overrides on a pass.
- `setSubmeshVisible(submeshIndex, visible)`: Toggles visibility for a submesh index across passes.
- `isSubmeshVisible(submeshIndex)`: Checks if a submesh index is present in any pass.
- `setTransform(world, normal?)`: Sets primary instance transform matrix and optional normal matrix.
- `setInstances(matrices, count?, normalMatrices?)`: Sets contiguous buffer of instance world matrices and active count.
- `setSkin(joints, jointCount?)`: Sets joint matrices for skeletal animation.

---

### SkeletonCPU

`SkeletonCPU` maintains parent-child joint hierarchies, local transform matrices, and inverse bind matrices. It evaluates forward kinematics using Alm (`@asciiz/atoolkit/alm`), outputting flat joint matrix streams for skeletal skinning.

```typescript
import { SkeletonCPU } from "@asciiz/weebgfx";

const skeleton = new SkeletonCPU();
const root = skeleton.addJoint("root", -1, rootLocalMat, rootInvBind);
const spine = skeleton.addJoint("spine", root, spineLocalMat, spineInvBind);

// Evaluate forward kinematics: JointMatrix = WorldMatrix * InverseBindMatrix
const jointMatrices = skeleton.computeJointMatrices();
actor.setSkin(jointMatrices, skeleton.jointCount);
```

---

### Camera

`Camera` manages perspective and orthographic projection parameters, view matrices, and uniform buffer packing.

```typescript
import { Camera } from "@asciiz/weebgfx";

const camera = new Camera(Math.PI / 4, 16 / 9, 0.1, 1000.0);
camera.lookAt([0, 5, 10], [0, 0, 0], [0, 1, 0]);

const uniformData = camera.getUniformData(); // 52 floats (208 bytes)
```

Uniform data layout (52 floats / 208 bytes):
- `0..15`: View matrix (`mat4x4<f32>`).
- `16..31`: Projection matrix (`mat4x4<f32>`).
- `32..47`: Combined view-projection matrix (`mat4x4<f32>`).
- `48..50`: Camera world position (`vec3<f32>`).
- `51`: Alignment padding.

---
        
## Subsystems

### WebGPU Backend (`wgpu/`)

Native WebGPU rendering implementation built on `@asciiz/atoolkit/awgpu`.

- **Hardware Resources**: `MeshWGPU`, `TextureWGPU`, `ShaderWGPU`.
- **Render Dispatcher**: `MeshRendererWGPU` executing a four-frequency bind group model (Frame, Batch, Instance, Joint), dynamic offset instancing, and state sorting by pipeline and mesh.
- **Shader Compiler**: `ShaderGraphWGPU` compiling node graphs into WGSL and GPU pipelines.

See [wgpu/README.md](./wgpu/README.md) and [wgpu/shadergraph/README.md](./wgpu/shadergraph/README.md).

### Model Loader (`loader/`)

Decoupled 3D model loading system supporting GLTF 2.0 and binary GLB containers.

- Parses asset geometry into unified `MeshCPU` instances with submesh slices.
- Bakes static node hierarchies into vertex positions.
- Decodes image formats into `TextureCPU` buffers.
- Bridges data to `ModelWGPU` for hardware allocation and `Actor` stamping.
- Enforces strict explicit shader assignment with zero default shader generation.

See [loader/README.md](./loader/README.md).

### Future Roadmap

- **WebGL2 Backend (`wgl2/`)**: Hardware fallback implementation for environments without WebGPU support.
- **Entity Component System (`ecs/`)**: High-performance data-oriented ECS module for scene and actor management.
