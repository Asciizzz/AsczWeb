# WeebGfx WebGPU Backend

WebGPU hardware rendering implementation built on `@asciiz/atoolkit/awgpu`.

---

## Overview

The `wgpu` subsystem provides native WebGPU implementations of graphics resources (`MeshWGPU`, `TextureWGPU`, `ShaderWGPU`), a multi-frequency draw dispatcher (`MeshRendererWGPU`), and node-based WGSL shader compilation (`ShaderGraphWGPU`).

---

## Hardware Resources

### `MeshWGPU`

Allocates native GPU vertex and index buffers from a `MeshCPU` definition.

```typescript
import { MeshWGPU } from "@asciiz/weebgfx";

const mesh = MeshWGPU.create(device, cpuMesh);
```

- `create(device, cpuMesh)`: Allocates `GPUBuffer` instances for vertex data and optional index data. Preserves submesh slice descriptors.
- `vertexBuffer`: Native GPU vertex buffer handle.
- `indexBuffer`: Optional native GPU index buffer handle.
- `submeshes`: Array of `Submesh` slice ranges (`firstIndex`, `indexCount`, `baseVertex`, `materialIndex`).
- `destroy()`: Releases vertex and index buffers on the device.

### `TextureWGPU`

Allocates native `GPUTexture`, `GPUTextureView`, and `GPUSampler` instances.

```typescript
import { TextureWGPU } from "@asciiz/weebgfx";

// From CPU raw pixels:
const texture = TextureWGPU.create(device, cpuTexture, samplerDescriptor?);

// Solid 1x1 color placeholder:
const white1x1 = TextureWGPU.create1x1(device, 255, 255, 255, 255);
```

- `create(device, cpuTexture, samplerDescriptor?)`: Allocates a `GPUTexture` with `TEXTURE_BINDING | COPY_DST`, uploads image bytes, and builds an associated `GPUSampler`.
- `create1x1(device, r, g, b, a)`: Creates a 1x1 RGBA8 solid color texture. Used internally by `MeshRendererWGPU` to satisfy unbound texture slots.
- `fromGPU(device, texture, samplerDescriptor?)`: Wraps an existing native `GPUTexture`.
- `texture`: Native `GPUTexture`.
- `view`: Primary `GPUTextureView`.
- `sampler`: Native `GPUSampler`.
- `destroy()`: Disposes the underlying texture.

### `ShaderWGPU`

Encapsulates a compiled WebGPU `RasterPipeline`, bind group layout array, and reflection metadata.

- `pipeline`: Native pipeline wrapper.
- `bindGroupLayouts`: Array of `BindLayout` descriptors across frequency slots.
- `meta`: Parameter reflection (`ShaderMeta`) detailing camera, instance, material, and skinning requirements.
- `defaultParams`: Default uniform values and fallback textures defined during graph compilation.
- `destroy()`: Disposes pipeline handles.

---

## Mesh Renderer

`MeshRendererWGPU` dispatches draw calls inside caller-provided WebGPU render passes. It implements a four-frequency bind group model, dynamic offset instancing, and state sorting.

### Frequency-Slotted Binding Model

Pipelines adhere to a four-slot layout:

```
Slot 0 [PerFrame]    -> Camera uniforms (view, projection, viewProj, position)
Slot 1 [PerBatch]    -> Material parameters (floats, vectors, textures, samplers)
Slot 2 [PerInstance] -> Instance transform storage buffer (256-byte dynamic offsets)
Slot 3 [PerInstance] -> Skeletal joint matrix array (array<mat4x4<f32>, 64>)
```

1. **Slot 0 (PerFrame)**: Bound once per camera pass or when a pipeline requires camera uniforms. Shared across all matching pipelines.
2. **Slot 1 (PerBatch)**: Holds material uniform values, textures, and samplers. Cached through an internal `BindTableCache`.
3. **Slot 2 (PerInstance)**: Read-only storage buffer containing packed instance transformation and normal matrices. Indexed in shaders via `@builtin(instance_index)` with 256-byte aligned dynamic offsets.
4. **Slot 3 (PerInstance)**: Uniform buffer holding skeletal joint matrices for skinned meshes.

### Submission Modes

#### Deferred Submission (Recommended)

Batches actors and sorts draws to minimize pipeline and mesh switches:

```typescript
const renderer = new MeshRendererWGPU(device);

// 1. Submit actors to deferred queue
renderer.submit(heroActor);
renderer.submitBatch(enemiesIterable);

// 2. Flush queue in active render pass
renderer.flush(pass, camera);
// or: renderer.flush({ pass, camera });
```

- `submit(actor)`: Appends actor to internal queue without recording GPU commands.
- `submitBatch(actors)`: Appends an iterable of actors to internal queue.
- `flush(pass, camera)`: Executes state sorting, dynamic offset calculation, buffer transfers, and draw commands, then clears the queue. Also accepts `RenderTarget` object `{ pass, camera }`.

#### Direct Execution

```typescript
// Batch of actors:
renderer.render(pass, camera, [actorA, actorB]);
// or: renderer.render({ pass, camera }, [actorA, actorB]);

// Single actor:
renderer.draw(pass, camera, actorA);
// or: renderer.draw({ pass, camera }, actorA);
```

- `render(pass, camera, actors)`: Executes an explicit collection of actors immediately without touching the deferred queue. Also accepts `RenderTarget`.
- `draw(pass, camera, actor)`: Executes draw calls for a single actor immediately. Also accepts `RenderTarget`.

#### Single Mesh Execution

```typescript
renderer.drawMesh({
    pass,
    camera,
    mesh: meshWgpu,
    shader: shaderWgpu,
    worldMatrix: transformMat4,
    params: materialParams,
});
```

- `drawMesh(options)`: Binds vertex/index buffers and executes draw calls for an individual mesh directly.

### State Sorting

During `flush()` and `render()`, actors are sorted by:
1. `pipelineId`: Groups draws using the same render pipeline together, minimizing pipeline switches.
2. `meshId`: Groups draws using the same vertex and index buffers together, minimizing vertex buffer switches.

### Zero Default Shader Rule

WeebGfx enforces explicit shader bindings:
- Submeshes without an assigned shader (or where shader is `null`) are skipped during rendering.
- No draw commands are issued for unassigned submesh indices.
- Fallback shaders are not fabricated.

---

## Shader Graph

The WebGPU backend includes a node-based shader graph compiler (`ShaderGraphWGPU`) that generates WGSL code and native raster pipelines.

See [shadergraph/README.md](./shadergraph/README.md) for complete node documentation and compilation workflows.
