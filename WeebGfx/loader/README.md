# WeebGfx Model Loading Subsystem

Decoupled model loading pipeline separating pure CPU asset parsing from GPU hardware allocation.

---

## Overview

The `loader` subsystem parses 3D file formats (GLTF 2.0 and binary GLB) into runtime CPU data structures (`ModelCPU`), and bridges them to GPU hardware backends (`ModelGPU` / `ModelWGPU`).

Geometry hierarchies are flattened into unified meshes with submesh ranges, static non-skeletal node transforms are baked into vertex attributes, and skeletal joint hierarchies are extracted into `SkeletonCPU`.

```typescript
import { loadGLTF, ModelWGPU } from "@asciiz/weebgfx";

// 1. Pure CPU parsing (runs in browser, worker, or server)
const modelCpu = await loadGLTF("assets/character.glb");

// 2. WebGPU hardware allocation
const modelGpu = ModelWGPU.create(device, modelCpu, {
    shaders: characterShader,
});

// 3. Stamp independent Actors
const actorA = modelGpu.createActor();
const actorB = modelGpu.createActor().setTransform(secondaryTransformMatrix);
```

---

## Core Contracts

### `ModelCPU`

Pure CPU representation of a loaded 3D asset. Contains no WebGPU or hardware dependencies.

- `name`: Model identifier string.
- `mesh`: `MeshCPU` containing unified vertex buffer, index buffer, vertex layout, and submesh descriptors.
- `textures`: Array of `TextureCPU` instances holding decoded pixel buffers.
- `materials`: Array of `MaterialData` descriptors.
- `skeleton`: Optional `SkeletonCPU` joint hierarchy.

### `ModelGPU`

Abstract base class for hardware-accelerated models.

- `mesh`: Hardware `MeshGPU` instance.
- `textures`: Array of hardware `TextureGPU` instances.
- `materials`: Array of `MaterialData` descriptors.
- `skeleton`: Optional `SkeletonCPU` joint hierarchy.
- `createActor(shaders?)`: Factory stamping independent `Actor` units.
- `destroy()`: Disposes underlying hardware buffers and textures.

### `MaterialData`

CPU material metadata parsed from asset definitions:

- `name`: Material name.
- `baseColorFactor`: 4-element RGBA factor (`[r, g, b, a]`).
- `baseColorTextureIndex`: Index into `model.textures` for diffuse/albedo texture.
- `metallicFactor`: PBR metallic factor.
- `roughnessFactor`: PBR roughness factor.
- `metallicRoughnessTextureIndex`: Index into `model.textures` for PBR roughness-metallic map.
- `normalTextureIndex`: Index into `model.textures` for normal map.
- `normalTextureScale`: Normal map strength scale.
- `occlusionTextureIndex`: Index into `model.textures` for ambient occlusion map.
- `emissiveFactor`: 3-element RGB emissive factor.
- `alphaMode`: Transparency mode (`"OPAQUE"`, `"MASK"`, or `"BLEND"`).
- `alphaCutoff`: Alpha testing threshold.
- `doubleSided`: Boolean indicating whether backfaces should be rendered.

---

## GLTF & GLB Pipeline

### Methods

#### `loadGLTF(uriOrBuffer, options?)`

Loads and parses a GLTF or GLB asset asynchronously. Resolves external binary buffers and image textures.

- `uriOrBuffer`: Asset file URL string, or binary `ArrayBuffer` / `Uint8Array`.
- `options.basePath`: Base URI used for resolving relative buffer and texture references.
- `options.imageResolver`: Custom image decoding handler.
- Returns: `Promise<ModelCPU>`.

#### `parseGLB(buffer, options?)`

Unpacks a binary GLB container (validating 12-byte header, JSON chunk, and binary chunk) and parses it into `ModelCPU`.

- Returns: `ModelCPU`.

#### `parseGLTF(gltfOrJson, options?)`

Parses a GLTF JSON string or object and external buffers into `ModelCPU`.

- Returns: `ModelCPU`.

#### `parseGLTFJson(gltf, resolvedBuffers, options?)`

Low-level parser taking parsed GLTF JSON and pre-resolved binary buffer chunks. Flattens scenes, merges primitives, bakes node transforms, and builds `MeshCPU`.

---

## WebGPU Model: `ModelWGPU`

`ModelWGPU` implements `ModelGPU` for the WebGPU backend.

### `ModelWGPU.create(device, modelCpu, options?)`

Uploads geometry and textures to WebGPU hardware:
- Allocates `MeshWGPU` vertex and index buffers.
- Creates `TextureWGPU` instances for all asset textures.
- Maps submesh material indices to parameter collections (`ShaderParams`).
- Sets shaders per submesh based on `options.shaders`.

#### Zero Default Shader Contract

WeebGfx does not auto-generate default shaders during model loading. Callers provide custom shaders explicitly through `options.shaders`:
- If `options.shaders` is provided as a single `ShaderWGPU`, it is applied to all submeshes.
- If `options.shaders` is provided as an array, each submesh index `s` receives `options.shaders[s]`.
- If `options.shaders` is omitted, submesh shaders are set to `null`. Submeshes without shaders are omitted from rendering by `MeshRendererWGPU`.

### `createActor(shaders?)`

Stamps a new `Actor` instance sharing the model's mesh, shaders, and material parameters, while maintaining independent transform and instance data. Accepts optional override shaders (`ShadersInput`).

If the model contains a skeleton, `createActor()` evaluates the rest pose and sets initial skinning uniforms automatically.
