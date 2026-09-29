# WeebGfx Shader Graph

Node-based shader authoring system for WebGPU. Compiles directed graphs of mathematical, geometric, and sampling operations into WGSL shader code and native GPU pipelines.

---

## Overview

`ShaderGraphWGPU` constructs vertex and fragment shader stages through connected nodes. The compiler analyzes data dependencies, routes cross-stage variables (varyings), binds uniform and texture parameters into WebGPU layout groups, and produces a `ShaderWGPU` pipeline.

```typescript
import {
    ShaderGraphWGPU,
    InputVertexNode,
    WorldTransformNode,
    CameraNode,
    MultiplyNode,
    OutputVertexNode,
    OutputFragmentNode,
    Vec4Node,
} from "@asciiz/weebgfx";

const graph = new ShaderGraphWGPU();

// 1. Inputs
const inPos = new InputVertexNode("in_pos", "position", "float32x3");
graph.chainVertexInputs(inPos);

// 2. Transformations
const worldTx = new WorldTransformNode("world_tx");
const cam = new CameraNode("cam");
const mvp = new MultiplyNode("mvp", "vec4<f32>");

// 3. Outputs
const outV = new OutputVertexNode("out_v");
const outF = new OutputFragmentNode("out_f");
const color = new Vec4Node("u_color", [1, 0, 0, 1], true, "baseColor");

graph.addNode(worldTx);
graph.addNode(cam);
graph.addNode(mvp);
graph.addNode(outV);
graph.addNode(color);
graph.addNode(outF);

// Wire vertex stage
graph.connect("in_pos", "data", "world_tx", "in_position");
graph.connect("cam", "viewProj", "mvp", "a");
graph.connect("world_tx", "out_position", "mvp", "b");
graph.connect("mvp", "res", "out_v", "clipPosition");

// Wire fragment stage
graph.connect("u_color", "value", "out_f", "color");

// Compile to WebGPU pipeline
const shader = graph.compile(device, {
    targetFormat: "bgra8unorm",
    depthFormat: "depth24plus",
    cullMode: "back",
});
```

---

## Compilation

The graph compilation workflow operates in four stages:

1. **Topological Sorting**: Traverses connections starting from `OutputVertexNode` and `OutputFragmentNode` to establish evaluation order. Unconnected nodes are ignored.
2. **Auto-Varying Routing**: Detects when a node evaluated in the vertex stage connects to an input socket in the fragment stage. The compiler synthesizes a varying struct field, assigns an available `@location(n)` slot, and writes the value in the vertex shader.
3. **Bind Group Layout Building**: Scans active parameter nodes and maps them into standard frequency bind groups:
   - Slot 0 (PerFrame): Camera uniforms (`CameraNode`, `UniformMatrixNode`).
   - Slot 1 (PerBatch): Material uniforms (`FloatNode`, `Vec2Node`, `Vec3Node`, `Vec4Node`), textures (`TextureNode`), and samplers (`SamplerNode`).
   - Slot 2 (PerInstance): Instance storage buffer (`WorldTransformNode`).
   - Slot 3 (PerInstance): Skeletal joint uniform buffer (`SkinTransformNode`).
4. **WGSL Generation**: Emits complete, valid WGSL source code containing structs, uniform bindings, vertex entry point (`vs_main`), and fragment entry point (`fs_main`).

### Pipeline Configuration

`ShaderGraphWGPU` holds hardware rasterization settings configured directly on the graph prior to compilation:

- `cullMode`: Face culling mode (`"none" | "front" | "back"`). Defaults to `"back"`.
- `frontFace`: Vertex winding order (`"ccw" | "cw"`). Defaults to `"ccw"`.
- `topology`: Primitive topology (`"triangle-list" | "triangle-strip" | "line-list" | "line-strip" | "point-list"`). Defaults to `"triangle-list"`.
- `blend`: WebGPU blend state descriptor (`GPUBlendState`). Defaults to `undefined`.
- `depthWriteEnabled`: Depth buffer write state (`boolean`). Defaults to `true`.
- `depthCompare`: Depth comparison function (`GPUCompareFunction`). Defaults to `"greater-equal"`.
- `order`: Global bucket sort index for the mesh renderer (`number`). Defaults to `0`.

Properties can be initialized in the constructor, assigned directly, or chained via fluent setters:

```typescript
const outlineGraph = new ShaderGraphWGPU({
    cullMode: "front",
    order: 10,
});

// Or via properties:
outlineGraph.cullMode = "front";
outlineGraph.order = 10;

// Or via chainable setters:
outlineGraph.setCullMode("front").setOrder(10);
```

### Methods

#### `compile(device, options)`

Compiles the node graph into WGSL and instantiates a native `ShaderWGPU` pipeline. Uses graph-level pipeline settings by default, with optional per-compilation overrides.

- `device`: Target `GPUDevice`.
- `options.targetFormat`: Color format of render target (`GPUTextureFormat`). Defaults to `"bgra8unorm"`.
- `options.depthFormat`: Optional depth attachment format (`GPUTextureFormat`). If supplied, enables depth testing and writes.
- `options.cullMode`: Overrides graph `cullMode`.
- `options.frontFace`: Overrides graph `frontFace`.
- `options.topology`: Overrides graph `topology`.
- `options.blend`: Overrides graph `blend`.
- `options.depthWriteEnabled`: Overrides graph `depthWriteEnabled`.
- `options.depthCompare`: Overrides graph `depthCompare`.
- `options.order`: Overrides graph `order`.
- Returns: `ShaderWGPU` containing compiled pipeline, bind layouts, parameter metadata, and baked `pipelineConfig`.

#### `generateShaderSource()`

Generates WGSL source code, vertex layout, and parameter reflection data without allocating GPU hardware resources.

- Returns: `ShaderSourceWGPU` object with `wgslCode`, `vertexLayout`, `defaultParams`, `paramBindings`, and `meta`.

#### `chainVertexInputs(...nodes)`

Links sequential `InputVertexNode` instances, assigning contiguous byte offsets and vertex attribute locations. Calculates total `arrayStride`.

---

## Node Catalog

### Input and Output Nodes

#### `InputVertexNode`

Declares a single vertex buffer attribute in the vertex layout chain and exposes its typed value.

```typescript
const inPos = new InputVertexNode(id, attributeName, format, dataType?);
```

- `id`: Unique node identifier.
- `attributeName`: Attribute name matching mesh definition (e.g. `"position"`, `"normal"`, `"uv"`).
- `format`: Binary vertex format (`VertexFormat`, e.g. `"float32x3"`, `"float32x2"`, `"uint32x4"`).
- `dataType`: WGSL data type override. Defaults to format standard mapping (`"vec3<f32>"`, `"vec2<f32>"`).
- Outputs:
  - `data`: Typed attribute value.

#### `OutputVertexNode`

Terminates the vertex stage. Writes the clip-space position required by the rasterizer.

```typescript
const outV = new OutputVertexNode(id);
```

- Inputs:
  - `clipPosition`: Projected 4D position (`vec4<f32>`).

#### `OutputFragmentNode`

Terminates the fragment stage. Writes the final pixel color to the render target.

```typescript
const outF = new OutputFragmentNode(id);
```

- Inputs:
  - `color`: 4D output color vector (`vec4<f32>`).

---

### Transformation Nodes

#### `WorldTransformNode`

Transforms local vertex position and normal vectors into world space using per-instance matrices stored in Slot 2. Supports single-draw and multi-instance dispatches identically via `@builtin(instance_index)`.

```typescript
const worldTx = new WorldTransformNode(id);
```

- Inputs:
  - `in_position`: Local vertex position (`vec3<f32>`).
  - `in_normal`: Local vertex normal (`vec3<f32>`).
- Outputs:
  - `out_position`: World-space vertex position (`vec3<f32>`).
  - `out_normal`: Normalized world-space normal (`vec3<f32>`).

`EntityTransformNode` is an alias for `WorldTransformNode`.

#### `SkinTransformNode`

Deforms local vertex position and normal vectors using weighted skeletal joint matrices from Slot 3. Evaluates 4-bone linear blend skinning.

```typescript
const skinTx = new SkinTransformNode(id);
```

- Inputs:
  - `in_position`: Local vertex position (`vec3<f32>`).
  - `in_normal`: Local vertex normal (`vec3<f32>`).
  - `in_joints`: Joint index vector (`vec4<u32>`).
  - `in_weights`: Joint influence weight vector (`vec4<f32>`).
- Outputs:
  - `out_position`: Skinned world-space position (`vec3<f32>`).
  - `out_normal`: Skinned world-space normal (`vec3<f32>`).

---

### Camera Nodes

#### `CameraNode`

Provides access to camera projection parameters bound in Slot 0.

```typescript
const cam = new CameraNode(id);
```

- Outputs:
  - `view`: Camera view matrix (`mat4x4<f32>`).
  - `proj`: Camera projection matrix (`mat4x4<f32>`).
  - `viewProj`: Combined view-projection matrix (`mat4x4<f32>`).
  - `position`: Camera world-space position (`vec3<f32>`).

#### `UniformMatrixNode`

Binds an arbitrary 4x4 uniform matrix from Slot 0.

```typescript
const mat = new UniformMatrixNode(id, paramName);
```

- `paramName`: Uniform buffer field name.
- Outputs:
  - `matrix`: 4x4 matrix (`mat4x4<f32>`).

---

### Value and Parameter Nodes

Value nodes expose constant data or uniform material parameters located in Slot 1. When `isParam` is set to `true`, the value is registered in `ShaderMeta` and can be overridden at runtime via `Actor.params`.

#### `FloatNode`

```typescript
const f = new FloatNode(id, defaultValue?, isParam?, paramName?);
```

- `defaultValue`: Initial scalar number (default `0.0`).
- `isParam`: If `true`, registers parameter in Slot 1 uniform block.
- Outputs:
  - `value`: Scalar float (`f32`).

#### `Vec2Node`

```typescript
const v2 = new Vec2Node(id, defaultValue?, isParam?, paramName?);
```

- `defaultValue`: 2-element array `[x, y]` (default `[0, 0]`).
- Outputs:
  - `value`: 2D vector (`vec2<f32>`).

#### `Vec3Node`

```typescript
const v3 = new Vec3Node(id, defaultValue?, isParam?, paramName?);
```

- `defaultValue`: 3-element array `[x, y, z]` (default `[0, 0, 0]`).
- Outputs:
  - `value`: 3D vector (`vec3<f32>`).

#### `Vec4Node`

```typescript
const v4 = new Vec4Node(id, defaultValue?, isParam?, paramName?);
```

- `defaultValue`: 4-element array `[x, y, z, w]` (default `[0, 0, 0, 0]`).
- Outputs:
  - `value`: 4D vector or color (`vec4<f32>`).

---

### Math Nodes

#### `AddNode`

Performs component-wise addition between two vectors or scalars of matching type.

```typescript
const add = new AddNode(id, dataType?);
```

- `dataType`: WGSL type (`"f32"`, `"vec2<f32>"`, `"vec3<f32>"`, `"vec4<f32>"`). Defaults to `"vec3<f32>"`.
- Inputs:
  - `a`: First operand.
  - `b`: Second operand.
- Outputs:
  - `res`: Sum result (`a + b`).

#### `MultiplyNode`

Performs component-wise multiplication, scalar-vector scaling, or matrix-vector transformation.

```typescript
const mul = new MultiplyNode(id, dataType?);
```

- `dataType`: Output WGSL type. Defaults to `"vec4<f32>"`.
- Inputs:
  - `a`: Left operand (`mat4x4<f32>`, vector, or scalar).
  - `b`: Right operand (vector or scalar).
- Outputs:
  - `res`: Product result (`a * b`).

---

### Texture Nodes

#### `TextureNode`

Registers a 2D texture binding in Slot 1.

```typescript
const tex = new TextureNode(id, defaultValue?, paramName?, isParam?);
```

- `defaultValue`: Optional fallback `TextureGPU` reference.
- `paramName`: Material parameter key used in `Actor.params.textures`.
- Outputs:
  - `texture`: 2D texture handle (`texture_2d<f32>`).

#### `SamplerNode`

Registers a texture sampler binding in Slot 1.

```typescript
const smp = new SamplerNode(id, defaultValue?, paramName?, isParam?);
```

- `defaultValue`: Optional fallback sampler descriptor or `GPUSampler`.
- `paramName`: Material parameter key used in `Actor.params.samplers`.
- Outputs:
  - `sampler`: Sampler handle (`sampler`).

#### `SampleTextureNode`

Samples a texture using UV coordinates. When called in the vertex stage, automatically generates `textureSampleLevel(..., 0.0)` for mip level 0.

```typescript
const sample = new SampleTextureNode(id);
```

- Inputs:
  - `texture`: Texture handle (`texture_2d<f32>`).
  - `sampler`: Sampler handle (`sampler`).
  - `uv`: 2D texture coordinate (`vec2<f32>`).
- Outputs:
  - `color`: Sampled 4D color vector (`vec4<f32>`).

#### `TextureFetchNode`

Fetches an unnormalized texel by integer coordinate without filtering via `textureLoad`.

```typescript
const fetch = new TextureFetchNode(id);
```

- Inputs:
  - `texture`: Texture handle (`texture_2d<f32>`).
  - `coords`: Integer pixel coordinate (`vec2<i32>`).
  - `level`: Mip level (`i32`). Defaults to 0.
- Outputs:
  - `color`: Raw texel value (`vec4<f32>`).
