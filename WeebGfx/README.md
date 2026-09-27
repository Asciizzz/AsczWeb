# WeebGfx

Backend-agnostic graphics abstractions and WebGPU hardware rendering pipeline.

---

## Overview

WeebGfx provides two operational layers:
1. **Agnostic Primitives**: CPU and base GPU structures for geometry (`MeshCPU`, `MeshGPU`), textures (`TextureCPU`, `TextureGPU`), pipelines (`ShaderGPU`), cameras (`Camera`), and draw items (`Actor`).
2. **WebGPU Hardware Backend**: WebGPU implementations (`MeshWGPU`, `TextureWGPU`, `ShaderWGPU`, `MeshRendererWGPU`) and node-based WGSL shader compilation (`ShaderGraphWGPU`).

---

## Core Primitives

### Actor

`Actor` is the atomic draw item in WeebGfx. It holds hardware resources, transformation matrices, optional camera overrides, and skinning data.

```typescript
import { Actor } from "@asciiz/weebgfx";

const actor = new Actor({
    mesh: meshWgpu,
    shaders: shaderWgpu,
    transform: worldMatrix,
    camera: customCamera,
    instances: instanceMatrices,
});
```

- `mesh`: GPU mesh instance providing vertex and optional index buffers.
- `shaders`: Single shader applied across all submeshes, or array mapping to specific submesh indices.
- `params`: Material parameter collections (floats, vectors, textures, samplers).
- `transform`: 16-element Float32Array world transformation matrix.
- `normalMatrix`: Optional 16-element Float32Array normal transformation matrix.
- `camera`: Optional `Camera` override. When set, renderer switches camera uniforms for this actor's draw call.
- `skin`: Optional skeletal joint matrices (`Float32Array`) and joint count.
- `instances`: Optional continuous `Float32Array` of 4x4 instance matrices for GPU instancing.
- `instanceCount`: Number of instances to dispatch.

### Camera

`Camera` manages perspective and orthographic projection parameters, view matrices, and uniform buffer packing.

```typescript
import { Camera } from "@asciiz/weebgfx";

const camera = new Camera(Math.PI / 4, 16 / 9, 0.1, 1000.0);
camera.lookAt([0, 5, 10], [0, 0, 0], [0, 1, 0]);

const uniformData = camera.getUniformData(); // 52 floats (208 bytes)
```

The uniform buffer layout comprises 52 floats (208 bytes):
- `0..15`: View matrix (`mat4x4<f32>`, 64 bytes).
- `16..31`: Projection matrix (`mat4x4<f32>`, 64 bytes).
- `32..47`: Combined view-projection matrix (`mat4x4<f32>`, 64 bytes).
- `48..50`: Camera world position (`vec3<f32>`, 12 bytes).
- `51`: Padding float (4 bytes).

### Geometry

Geometry processing is split between CPU definitions and hardware GPU buffers.

```typescript
import { MeshCPU, MeshWGPU } from "@asciiz/weebgfx";

const cpuMesh = new MeshCPU(
    {
        arrayStride: 24,
        attributes: [
            { name: "position", format: "float32x3", offset: 0, shaderLocation: 0 },
            { name: "normal", format: "float32x3", offset: 12, shaderLocation: 1 },
        ],
    },
    [{ firstIndex: 0, indexCount: 36 }],
    vertexBytes,
    indexBytes
);

const gpuMesh = MeshWGPU.create(device, cpuMesh);
```

- `MeshCPU`: Holds raw binary buffers (`vertexBytes`, `indexBytes`), vertex layout descriptors, and submesh ranges.
- `MeshWGPU`: Allocates native GPU vertex and index buffers on a `GPUDevice`.

---

## WebGPU Renderer

`MeshRendererWGPU` executes draw calls inside a caller-provided render pass.

### Frequency-Slotted Binding Model

Pipelines adhere to a three-frequency WebGPU bind group layout:
- **Group 0 (PerFrame)**: Camera projection and view uniforms. Bound once per frame or when an actor overrides the camera.
- **Group 1 (PerBatch)**: Material uniforms, textures, and samplers. Cached through internal `BindTableCache`.
- **Group 2 (PerInstance)**: Dynamic transform uniforms with 256-byte dynamic offsets.

### Drawing Actors

```typescript
import { MeshRendererWGPU } from "@asciiz/weebgfx";

const renderer = new MeshRendererWGPU(device);

// Single actor draw:
renderer.draw({ pass, camera }, actor);

// Batch render:
renderer.render({ pass, camera }, [actor1, actor2, actor3]);
```

- `target.pass`: Active `GPURenderPassEncoder`.
- `target.camera`: Default camera used for draw calls unless overridden by `actor.camera`.
- `target.device`: Optional `GPUDevice` if not provided during renderer construction.

---

## Shader Graph

`ShaderGraphWGPU` compiles a directed graph of vertex and fragment nodes into WGSL shader code and initializes a WebGPU `RasterPipeline`.

```typescript
import {
    ShaderGraphWGPU,
    InputVertexNode,
    EntityTransformNode,
    CameraNode,
    MultiplyNode,
    OutputVertexNode,
    OutputFragmentNode,
} from "@asciiz/weebgfx";

const graph = new ShaderGraphWGPU();

const inPos = new InputVertexNode("in_pos", "position", "float32x3");
const inCol = new InputVertexNode("in_col", "color", "float32x4");
graph.chainVertexInputs(inPos, inCol);

const txNode = new EntityTransformNode("tx");
const camNode = new CameraNode("cam");
const mvpNode = new MultiplyNode("mvp", "vec4<f32>");
const outV = new OutputVertexNode("out_v");
const outF = new OutputFragmentNode("out_f");

graph.addNode(txNode);
graph.addNode(camNode);
graph.addNode(mvpNode);
graph.addNode(outV);
graph.addNode(outF);

// Wire vertex stage
graph.connect("in_pos", "data", "tx", "in_position");
graph.connect("cam", "viewProj", "mvp", "a");
graph.connect("tx", "out_position", "mvp", "b");
graph.connect("mvp", "res", "out_v", "clipPosition");

// Wire fragment stage
graph.connect("in_col", "data", "out_f", "color");

const shader = graph.compile(device, {
    targetFormat: "bgra8unorm",
    depthFormat: "depth24plus",
    cullMode: "back",
});
```

- `chainVertexInputs()`: Links sequential vertex inputs into a unified `VertexLayout` descriptor.
- `compile()`: Topologically sorts graph nodes, analyzes cross-stage data routing (auto-varyings), extracts uniform parameter bindings, compiles WGSL source, and allocates the underlying `RasterPipeline`.

---

## Quick Start Example

```typescript
import {
    MeshCPU,
    MeshWGPU,
    Camera,
    Actor,
    MeshRendererWGPU,
    ShaderGraphWGPU,
} from "@asciiz/weebgfx";

// 1. Setup camera and renderer
const camera = new Camera(Math.PI / 4, canvas.width / canvas.height, 0.1, 100);
camera.lookAt([0, 2, 5], [0, 0, 0]);

const renderer = new MeshRendererWGPU(device);

// 2. Prepare mesh and shader
const mesh = MeshWGPU.create(device, cpuMeshData);
const shader = graph.compile(device, { targetFormat: canvasFormat });

// 3. Create actor
const actor = new Actor({
    mesh,
    shaders: shader,
    transform: worldMatrix,
});

// 4. Render frame
function frame() {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass(renderPassDesc);

    renderer.draw({ pass, camera }, actor);

    pass.end();
    device.queue.submit([encoder.finish()]);
}
```
