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

#### Fullscreen Blit Execution

```typescript
renderer.blit({
    pass,
    shader: postShaderWgpu,
    camera?: optionalCamera,
    params: {
        floats: { threshold: 1.0 },
        textures: { u_hdrScene: hdrTexture },
        samplers: { u_linearSmp: linearSampler },
    },
});
```

- `blit(options)`: Executes a screen-space fullscreen pass with 3 procedural vertices (`pass.draw(3, 1, 0, 0)`). Binds Slot 1 material parameters and optional Slot 0 camera uniforms without requiring vertex or index buffer allocations.

#### Frame Lifecycle Reset

```typescript
renderer.reset();
```

- `reset()`: Resets per-frame uniform buffer pools and instance byte offsets. Must be called once at the start of each frame before encoding render passes.

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

## Raw WGSL Shader Authoring

`ShaderWGPU.create(device, options)` compiles raw WGSL pipelines directly while mapping them to the engine's 4-slot bind group architecture.

This allows custom lighting, shadow passes, and post-processing pipelines to execute directly inside `MeshRendererWGPU` alongside node-graph shaders.

### Engine Bind Group Slots

Any raw WGSL shader used with `MeshRendererWGPU` must declare its resources across four standardized bind group indices:

| Slot | Group | Frequency | Purpose | Resource Type |
|---|---|---|---|---|
| Slot 0 | `@group(0)` | PerFrame | Camera matrices and eye position | Uniform Buffer (208 bytes) |
| Slot 1 | `@group(1)` | PerBatch | Material uniforms, textures, samplers | Uniform Buffer, Textures, Samplers |
| Slot 2 | `@group(2)` | PerInstance | Model and normal matrices | Storage Buffer (Dynamic Offset, 128B/inst) |
| Slot 3 | `@group(3)` | PerInstance | Skeletal bone joint matrices | Uniform Buffer (4096 bytes) |

---

### Slot 0: Camera Uniforms (`@group(0)`)

When a shader requires camera matrices or eye coordinates, declare:

```wgsl
struct CameraUniforms {
    viewMatrix: mat4x4<f32>,      // offset   0..63  (64 bytes)
    projMatrix: mat4x4<f32>,      // offset  64..127 (64 bytes)
    viewProjMatrix: mat4x4<f32>,  // offset 128..191 (64 bytes)
    cameraPosition: vec3<f32>,    // offset 192..203 (12 bytes)
    _pad: f32,                    // offset 204..207 (4 bytes)
};
@group(0) @binding(0) var<uniform> u_camera: CameraUniforms;
```

- Total size is exactly 208 bytes (52 floats).
- `_pad` is mandatory to satisfy WebGPU uniform buffer 16-byte struct alignment rules.
- If a pipeline does not access camera matrices, omit `@group(0)` entirely; the engine will bind an empty bind group layout.

---

### Slot 1: Material Uniforms, Textures, and Samplers (`@group(1)`)

Slot 1 contains batch-specific material parameters. Resources must follow a strict binding order:

1. **`@binding(0)`**: Material uniform buffer (if floats or vectors are defined).
2. **`@binding(1..N)`**: Sampled textures (`texture_2d<f32>` or `texture_depth_2d`).
3. **`@binding(N+1..M)`**: Samplers (`sampler` or `sampler_comparison`).

```wgsl
struct MaterialUniforms {
    u_tint: vec4<f32>,
    u_roughness: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};
@group(1) @binding(0) var<uniform> u_material: MaterialUniforms;
@group(1) @binding(1) var u_albedo: texture_2d<f32>;
@group(1) @binding(2) var u_shadowMap: texture_depth_2d;
@group(1) @binding(3) var u_albedoSmp: sampler;
@group(1) @binding(4) var u_shadowSmp: sampler_comparison;
```

#### Struct Packing Rules for `paramBindings`

In `paramBindings`, vectors and floats are packed in CPU memory as follows:
- All named `vectors` are packed first: 4 floats (16 bytes) per entry.
- All named `floats` are packed after the vectors: 1 float (4 bytes) per entry.
- Ensure the WGSL struct definition matches this packing order exactly.
- All textures MUST precede samplers in the binding indices.

---

### Slot 2: Instance Transform Storage Buffer (`@group(2)`)

When a shader renders 3D actors, transforms are fed via a dynamic storage buffer:

```wgsl
struct InstanceData {
    modelMatrix: mat4x4<f32>,   // 64 bytes
    normalMatrix: mat4x4<f32>,  // 64 bytes
};
@group(2) @binding(0) var<storage, read> u_instances: array<InstanceData>;

@vertex
fn vs_main(in: VertexInput, @builtin(instance_index) instance_idx: u32) -> VertexOutput {
    let model = u_instances[instance_idx].modelMatrix;
    let normalMat = u_instances[instance_idx].normalMatrix;
    let world_pos = (model * vec4<f32>(in.position, 1.0)).xyz;
    // ...
}
```

- Each instance requires exactly 128 bytes (32 floats).
- `MeshRendererWGPU` binds Slot 2 with a dynamic byte offset aligned to 256 bytes per actor.
- Always index `u_instances` using `@builtin(instance_index)`.

---

### Slot 3: Skeletal Skinning Uniforms (`@group(3)`)

Used for character mesh skinning:

```wgsl
struct SkinUniforms {
    joints: array<mat4x4<f32>, 64>, // 4096 bytes
};
@group(3) @binding(0) var<uniform> u_skin: SkinUniforms;
```

---

### Compiling Custom Shaders (`ShaderWGPU.create`)

```typescript
import { ShaderWGPU } from "@asciiz/weebgfx";

const sceneShader = ShaderWGPU.create(device, {
    label: "CustomScene_Shader",
    code: SCENE_WGSL_STRING,
    vertexLayout: {
        arrayStride: 32,
        attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" }, // position
            { shaderLocation: 1, offset: 12, format: "float32x3" }, // normal
            { shaderLocation: 2, offset: 24, format: "float32x2" }, // uv
        ],
    },
    targetFormat: "rgba16float",
    depthFormat: "depth24plus",
    depthCompare: "less",
    depthWriteEnabled: true,
    cullMode: "back",
    paramBindings: {
        hasMaterialUniform: true,
        floats: [],
        vectors: ["u_tint", "u_ambient"],
        textures: ["u_albedo", "u_shadowMap"],
        samplers: ["u_albedoSmp", "u_shadowSmp"],
        depthTextures: ["u_shadowMap"],             // Emits sampleType: "depth"
        comparisonSamplers: ["u_shadowSmp"],       // Emits comparison: true
    },
});
```

---

### Depth-Only Pipelines (Shadow Passes)

For shadow depth passes or depth prepasses, omit the fragment stage entirely by setting `hasFragment: false` and `targetFormat: null`:

```typescript
const shadowShader = ShaderWGPU.create(device, {
    label: "ShadowDepth_Shader",
    code: SHADOW_DEPTH_WGSL,
    vertexLayout: VERTEX_LAYOUT_3D,
    depthFormat: "depth32float",
    depthCompare: "less",
    depthWriteEnabled: true,
    cullMode: "back",
    hasFragment: false,
    targetFormat: null,
});
```

- The WGSL code must declare only `@vertex fn vs_main(...) -> VertexOutput`.
- `VertexOutput` requires only `@builtin(position) clipPosition: vec4<f32>`.
- The rasterizer writes hardware depth directly without fragment stage overhead.

---

### Screen-Space Blit Shaders (Post-Processing)

For fullscreen effects (tonemapping, blur, bloom isolation), generate a procedural triangle from `vertex_index` without allocating vertex buffers:

```wgsl
struct VertexOutput {
    @builtin(position) clipPosition: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_idx: u32) -> VertexOutput {
    var out: VertexOutput;
    let uv_raw = vec2<f32>(f32((vertex_idx << 1u) & 2u), f32(vertex_idx & 2u));
    out.clipPosition = vec4<f32>(uv_raw * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2<f32>(uv_raw.x, 1.0 - uv_raw.y);
    return out;
}
```

Compile with empty vertex buffer attributes:

```typescript
const blitShader = ShaderWGPU.create(device, {
    label: "Tonemap_Shader",
    code: TONEMAP_WGSL,
    vertexLayout: { arrayStride: 0, attributes: [] },
    targetFormat: canvasFormat,
    cullMode: "none",
    paramBindings: {
        hasMaterialUniform: true,
        floats: ["bloomIntensity"],
        vectors: [],
        textures: ["u_hdrScene"],
        samplers: ["u_linearSmp"],
    },
});
```

Dispatch using `renderer.blit(...)`:

```typescript
renderer.blit({
    pass: compositePass,
    shader: blitShader,
    params: {
        floats: { bloomIntensity: 1.4 },
        textures: { u_hdrScene: hdrTexture },
        samplers: { u_linearSmp: linearSampler },
    },
});
```

---

### Critical Safety Rules and Pitfalls

1. **Textures Must Precede Samplers in Slot 1**:
   WebGPU enforces exact bind group layout matching. In `paramBindings`, all `textures` must correspond to sequential bindings before `samplers`. Swapping the order triggers WebGPU pipeline layout validation errors.
2. **Uniform Struct 16-Byte Alignment**:
   In WGSL uniform buffers, `vec3<f32>` has an alignment of 16 bytes. If followed by an `f32`, ensure explicit padding or pack into `vec4<f32>`. Failure to pad results in silent variable misalignment.
3. **Shadow Frustum Projection Guard**:
   In perspective shadow maps, points behind the light have negative `clipPosition.w`. Dividing by negative `w` flips X and Y into `[0, 1]` UV coordinates, projecting backwards geometry into the shadow map. Always guard with `if (lightClip.w > 0.001)`.
4. **Multi-Pass Buffer Overwriting**:
   Never use persistent single uniform buffers across multiple render passes in the same frame. Always allocate per-pass camera buffers through `renderer.uniformPool.acquire(device, 256)` and reset at frame start with `renderer.reset()`.

---

## Shader Graph

The WebGPU backend includes a node-based shader graph compiler (`ShaderGraphWGPU`) that generates WGSL code and native raster pipelines.

See [shadergraph/README.md](./shadergraph/README.md) for complete node documentation and compilation workflows.
