import { Mat4 } from "@asciiz/atoolkit/alm/index.js";
import { MeshCPU } from "../mesh.js";
import { TextureCPU } from "../texture.js";
import { SkeletonCPU } from "../skeleton.js";
import type { VertexLayout, VertexAttribute, Submesh } from "../types.js";
import type { ModelCPU, MaterialData } from "./model.js";

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_TYPE_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_TYPE_BIN = 0x004e4942; // 'BIN\0'

export type GLTFBufferMap = Record<string, ArrayBuffer> | ArrayBuffer[];

export interface GLTFParseOptions {
    /** Additional external binary buffers mapped by index or URI. */
    buffers?: GLTFBufferMap;
    /** Custom buffer resolver for external references. */
    bufferResolver?: (uri: string) => Promise<ArrayBuffer> | ArrayBuffer;
    /** Custom image resolver decoding image data into TextureCPU. */
    imageResolver?: (image: any, bufferData?: Uint8Array) => Promise<TextureCPU> | TextureCPU;
}

export interface GLTFLoadOptions extends GLTFParseOptions {
    /** Base path for resolving relative URIs. */
    basePath?: string;
}

const TYPE_COUNTS: Record<string, number> = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT2: 4,
    MAT3: 9,
    MAT4: 16,
};

const COMPONENT_SIZES: Record<number, number> = {
    5120: 1, // BYTE
    5121: 1, // UNSIGNED_BYTE
    5122: 2, // SHORT
    5123: 2, // UNSIGNED_SHORT
    5125: 4, // UNSIGNED_INT
    5126: 4, // FLOAT
};

/**
 * Decodes base64 string to Uint8Array.
 */
function decodeBase64(base64: string): Uint8Array {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const lookup = new Uint8Array(256);
    for (let i = 0; i < chars.length; i++) {
        lookup[chars.charCodeAt(i)] = i;
    }

    let len = base64.length;
    while (len > 0 && base64[len - 1] === "=") {
        len--;
    }

    const byteLen = Math.floor((len * 3) / 4);
    const bytes = new Uint8Array(byteLen);
    let p = 0;

    for (let i = 0; i < len; i += 4) {
        const c0 = lookup[base64.charCodeAt(i)];
        const c1 = lookup[base64.charCodeAt(i + 1)];
        const c2 = i + 2 < len ? lookup[base64.charCodeAt(i + 2)] : 0;
        const c3 = i + 3 < len ? lookup[base64.charCodeAt(i + 3)] : 0;

        const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;

        if (p < byteLen) bytes[p++] = (triple >> 16) & 0xff;
        if (p < byteLen) bytes[p++] = (triple >> 8) & 0xff;
        if (p < byteLen) bytes[p++] = triple & 0xff;
    }

    return bytes;
}

/**
 * Decodes data URI into Uint8Array.
 */
function decodeDataUri(uri: string): Uint8Array {
    const comma = uri.indexOf(",");
    const base64 = uri.substring(comma + 1).replace(/\s/g, "");
    const g = globalThis as any;
    if (typeof g.atob === "function") {
        const binary = g.atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }
    if (g.Buffer && typeof g.Buffer.from === "function") {
        return new Uint8Array(g.Buffer.from(base64, "base64"));
    }
    return decodeBase64(base64);
}


interface DecodedAccessor {
    count: number;
    numComponents: number;
    componentType: number;
    normalized: boolean;
    get: (index: number, component: number) => number;
}

/**
 * Creates fast accessor reader with direct typed array or strided fallback access.
 */
function createAccessorReader(
    gltf: any,
    accessorIndex: number,
    resolvedBuffers: ArrayBuffer[]
): DecodedAccessor {
    const accessor = gltf.accessors[accessorIndex];
    if (!accessor) {
        throw new Error(`[GLTF] Accessor index ${accessorIndex} not found.`);
    }

    const count = accessor.count;
    const numComponents = TYPE_COUNTS[accessor.type] ?? 1;
    const componentType = accessor.componentType;
    const componentSize = COMPONENT_SIZES[componentType] ?? 4;
    const normalized = !!accessor.normalized;
    const elementByteSize = numComponents * componentSize;

    if (accessor.bufferView === undefined) {
        return {
            count,
            numComponents,
            componentType,
            normalized,
            get: () => 0,
        };
    }

    const bufferView = gltf.bufferViews[accessor.bufferView];
    const buffer = resolvedBuffers[bufferView.buffer];
    if (!buffer) {
        throw new Error(`[GLTF] Buffer ${bufferView.buffer} not resolved.`);
    }

    const byteOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const stride = bufferView.byteStride ?? elementByteSize;

    // Fast path: tightly packed array aligned to element size
    if (stride === elementByteSize) {
        const totalElements = count * numComponents;
        if (componentType === 5126) { // FLOAT
            let arr: Float32Array;
            if (byteOffset % 4 === 0) {
                arr = new Float32Array(buffer, byteOffset, totalElements);
            } else {
                arr = new Float32Array(buffer.slice(byteOffset, byteOffset + totalElements * 4));
            }
            return {
                count,
                numComponents,
                componentType,
                normalized,
                get: (i, c) => arr[i * numComponents + c],
            };
        }

        if (componentType === 5123) { // UNSIGNED_SHORT
            let arr: Uint16Array;
            if (byteOffset % 2 === 0) {
                arr = new Uint16Array(buffer, byteOffset, totalElements);
            } else {
                arr = new Uint16Array(buffer.slice(byteOffset, byteOffset + totalElements * 2));
            }
            if (normalized) {
                return {
                    count,
                    numComponents,
                    componentType,
                    normalized,
                    get: (i, c) => arr[i * numComponents + c] / 65535,
                };
            }
            return {
                count,
                numComponents,
                componentType,
                normalized,
                get: (i, c) => arr[i * numComponents + c],
            };
        }

        if (componentType === 5125) { // UNSIGNED_INT
            let arr: Uint32Array;
            if (byteOffset % 4 === 0) {
                arr = new Uint32Array(buffer, byteOffset, totalElements);
            } else {
                arr = new Uint32Array(buffer.slice(byteOffset, byteOffset + totalElements * 4));
            }
            return {
                count,
                numComponents,
                componentType,
                normalized,
                get: (i, c) => arr[i * numComponents + c],
            };
        }

        if (componentType === 5121) { // UNSIGNED_BYTE
            const arr = new Uint8Array(buffer, byteOffset, totalElements);
            if (normalized) {
                return {
                    count,
                    numComponents,
                    componentType,
                    normalized,
                    get: (i, c) => arr[i * numComponents + c] / 255,
                };
            }
            return {
                count,
                numComponents,
                componentType,
                normalized,
                get: (i, c) => arr[i * numComponents + c],
            };
        }
    }

    // Strided or non-standard format path via DataView
    const view = new DataView(buffer, byteOffset);
    return {
        count,
        numComponents,
        componentType,
        normalized,
        get: (i, c) => {
            const pos = i * stride + c * componentSize;
            let val = 0;
            switch (componentType) {
                case 5120: val = view.getInt8(pos); break;
                case 5121: val = view.getUint8(pos); break;
                case 5122: val = view.getInt16(pos, true); break;
                case 5123: val = view.getUint16(pos, true); break;
                case 5125: val = view.getUint32(pos, true); break;
                case 5126: val = view.getFloat32(pos, true); break;
                default: val = 0;
            }
            if (normalized) {
                switch (componentType) {
                    case 5120: return Math.max(val / 127, -1);
                    case 5121: return val / 255;
                    case 5122: return Math.max(val / 32767, -1);
                    case 5123: return val / 65535;
                }
            }
            return val;
        },
    };
}

/**
 * Parses binary GLB container into JSON metadata and embedded binary chunk.
 */
export function unpackGLB(buffer: ArrayBuffer | Uint8Array): { json: any; binChunk?: ArrayBuffer } {
    const rawBuffer = buffer instanceof Uint8Array ? buffer.buffer : buffer;
    const rawByteOffset = buffer instanceof Uint8Array ? buffer.byteOffset : 0;
    const view = new DataView(rawBuffer, rawByteOffset);

    const magic = view.getUint32(0, true);
    if (magic !== GLB_MAGIC) {
        throw new Error("[GLTF] Invalid GLB magic identifier: expected 0x46546C67 ('glTF').");
    }

    const version = view.getUint32(4, true);
    if (version !== 2) {
        throw new Error(`[GLTF] Unsupported GLB version ${version}. Only GLTF 2.0 is supported.`);
    }

    const totalLength = view.getUint32(8, true);
    let offset = 12;
    let json: any = null;
    let binChunk: ArrayBuffer | undefined = undefined;

    while (offset < totalLength) {
        const chunkLength = view.getUint32(offset, true);
        const chunkType = view.getUint32(offset + 4, true);
        const chunkStart = rawByteOffset + offset + 8;

        if (chunkType === CHUNK_TYPE_JSON) {
            const jsonBytes = new Uint8Array(rawBuffer, chunkStart, chunkLength);
            const decoder = new TextDecoder("utf-8");
            json = JSON.parse(decoder.decode(jsonBytes));
        } else if (chunkType === CHUNK_TYPE_BIN) {
            binChunk = rawBuffer.slice(chunkStart, chunkStart + chunkLength) as ArrayBuffer;
        }


        offset += 8 + chunkLength;
    }

    if (!json) {
        throw new Error("[GLTF] GLB container did not contain JSON chunk.");
    }

    return { json, binChunk };
}

/**
 * Resolves GLTF buffers from container chunk, data URIs, or options map.
 */
function resolveBuffers(gltf: any, binChunk?: ArrayBuffer, options?: GLTFParseOptions): ArrayBuffer[] {
    const buffers: ArrayBuffer[] = [];
    const gltfBuffers = gltf.buffers ?? [];

    for (let i = 0; i < gltfBuffers.length; i++) {
        const bufDesc = gltfBuffers[i];
        if (i === 0 && binChunk) {
            buffers.push(binChunk);
            continue;
        }

        if (options?.buffers) {
            if (Array.isArray(options.buffers)) {
                if (options.buffers[i]) {
                    buffers.push(options.buffers[i]);
                    continue;
                }
            } else if (bufDesc.uri && options.buffers[bufDesc.uri]) {
                buffers.push(options.buffers[bufDesc.uri]);
                continue;
            }
        }

        if (bufDesc.uri) {
            if (bufDesc.uri.startsWith("data:")) {
                const bytes = decodeDataUri(bufDesc.uri);
                buffers.push(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
                continue;
            }
        }

        throw new Error(`[GLTF] Buffer ${i} (${bufDesc.uri ?? "unnamed"}) could not be resolved synchronously.`);
    }


    return buffers;
}

interface PrimitiveCollection {
    primitive: any;
    worldTransform: Mat4;
    normalTransform: Mat4;
    isSkinned: boolean;
}

/**
 * Traverses GLTF node hierarchy, accumulating world transforms and collecting primitives.
 */
function collectScenePrimitives(gltf: any): {
    primitives: PrimitiveCollection[];
    hasSkinning: boolean;
} {
    const primitives: PrimitiveCollection[] = [];
    let hasSkinning = false;

    const parentMap = new Map<number, number>();
    const nodes = gltf.nodes ?? [];
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.children) {
            for (const child of n.children) {
                parentMap.set(child, i);
            }
        }
    }

    const sceneIndex = gltf.scene ?? 0;
    const scene = gltf.scenes?.[sceneIndex];
    let rootNodes: number[] = [];

    if (scene && scene.nodes) {
        rootNodes = scene.nodes;
    } else {
        // Collect all nodes without parents
        for (let i = 0; i < nodes.length; i++) {
            if (!parentMap.has(i)) {
                rootNodes.push(i);
            }
        }
    }

    function traverseNode(nodeIndex: number, parentWorld?: Mat4): void {
        const node = nodes[nodeIndex];
        if (!node) return;

        let local: Mat4;
        if (node.matrix) {
            local = new Mat4(node.matrix);
        } else {
            const pos = node.translation ?? [0, 0, 0];
            const rot = node.rotation ?? [0, 0, 0, 1];
            const scl = node.scale ?? [1, 1, 1];
            local = Mat4.fromTRS(pos, rot, scl);
        }

        const world = parentWorld ? parentWorld.mul(local, new Mat4()) : local;
        const norm = world.clone().normalMatrix() ?? Mat4.identity();

        const isNodeSkinned = node.skin !== undefined;
        if (node.mesh !== undefined) {
            const mesh = gltf.meshes?.[node.mesh];
            if (mesh && mesh.primitives) {
                for (const prim of mesh.primitives) {
                    const isPrimSkinned = isNodeSkinned || prim.attributes?.JOINTS_0 !== undefined;
                    if (isPrimSkinned) {
                        hasSkinning = true;
                    }
                    primitives.push({
                        primitive: prim,
                        worldTransform: world,
                        normalTransform: norm,
                        isSkinned: isPrimSkinned,
                    });
                }
            }
        }

        if (node.children) {
            for (const child of node.children) {
                traverseNode(child, world);
            }
        }
    }

    for (const root of rootNodes) {
        traverseNode(root);
    }

    return { primitives, hasSkinning };
}

/**
 * Constructs SkeletonCPU from GLTF skin definition and node hierarchy.
 */
function extractSkeleton(gltf: any, resolvedBuffers: ArrayBuffer[]): SkeletonCPU | undefined {
    if (!gltf.skins || gltf.skins.length === 0) {
        return undefined;
    }

    const skin = gltf.skins[0];
    const jointNodeIndices: number[] = skin.joints ?? [];
    if (jointNodeIndices.length === 0) {
        return undefined;
    }

    const nodeToJoint = new Map<number, number>();
    for (let j = 0; j < jointNodeIndices.length; j++) {
        nodeToJoint.set(jointNodeIndices[j], j);
    }

    // Build parent map across entire node set
    const parentMap = new Map<number, number>();
    const nodes = gltf.nodes ?? [];
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.children) {
            for (const child of n.children) {
                parentMap.set(child, i);
            }
        }
    }

    let invBindReader: DecodedAccessor | undefined;
    if (skin.inverseBindMatrices !== undefined) {
        invBindReader = createAccessorReader(gltf, skin.inverseBindMatrices, resolvedBuffers);
    }

    const skeleton = new SkeletonCPU();
    const tempInvMat = new Float32Array(16);

    for (let j = 0; j < jointNodeIndices.length; j++) {
        const nodeIndex = jointNodeIndices[j];
        const node = nodes[nodeIndex];
        const name = node?.name ?? `joint_${j}`;

        // Find parent joint in skin
        let parentJointIndex = -1;
        let curr = parentMap.get(nodeIndex);
        while (curr !== undefined) {
            if (nodeToJoint.has(curr)) {
                parentJointIndex = nodeToJoint.get(curr)!;
                break;
            }
            curr = parentMap.get(curr);
        }

        // Local matrix
        let localMat: Float32Array;
        if (node?.matrix) {
            localMat = new Float32Array(node.matrix);
        } else if (node) {
            const pos = node.translation ?? [0, 0, 0];
            const rot = node.rotation ?? [0, 0, 0, 1];
            const scl = node.scale ?? [1, 1, 1];
            localMat = Mat4.fromTRS(pos, rot, scl);
        } else {
            localMat = Mat4.identity();
        }

        // Inverse bind matrix
        if (invBindReader && j < invBindReader.count) {
            for (let k = 0; k < 16; k++) {
                tempInvMat[k] = invBindReader.get(j, k);
            }
        } else {
            tempInvMat.set(Mat4.IDENTITY);
        }

        skeleton.addJoint(name, parentJointIndex, localMat, tempInvMat);
    }

    return skeleton;
}

/**
 * Parses GLTF JSON structure and resolved buffers into unified ModelCPU.
 */
export function parseGLTFJson(
    gltf: any,
    resolvedBuffers: ArrayBuffer[],
    options?: GLTFParseOptions
): ModelCPU {
    const { primitives, hasSkinning } = collectScenePrimitives(gltf);
    const skeleton = hasSkinning ? extractSkeleton(gltf, resolvedBuffers) : undefined;
    const isSkinned = hasSkinning && skeleton !== undefined;

    // Define vertex layout
    const attributes: VertexAttribute[] = [
        { name: "position", format: "float32x3", offset: 0, shaderLocation: 0 },
        { name: "normal", format: "float32x3", offset: 12, shaderLocation: 1 },
        { name: "uv", format: "float32x2", offset: 24, shaderLocation: 2 },
    ];
    if (isSkinned) {
        attributes.push({ name: "joints", format: "uint32x4", offset: 32, shaderLocation: 3 });
        attributes.push({ name: "weights", format: "float32x4", offset: 48, shaderLocation: 4 });
    }

    const floatsPerVertex = isSkinned ? 16 : 8;
    const arrayStride = floatsPerVertex * 4;
    const vertexLayout: VertexLayout = { arrayStride, attributes, stepMode: "vertex" };

    // Pass 1: Count total vertices and indices
    let totalVertices = 0;
    let totalIndices = 0;

    for (const item of primitives) {
        const prim = item.primitive;
        const posAccessorIdx = prim.attributes?.POSITION;
        if (posAccessorIdx === undefined) continue;
        const posAccessor = gltf.accessors[posAccessorIdx];
        const vCount = posAccessor.count;
        totalVertices += vCount;

        if (prim.indices !== undefined) {
            const idxAccessor = gltf.accessors[prim.indices];
            totalIndices += idxAccessor.count;
        } else {
            totalIndices += vCount;
        }
    }

    if (totalVertices === 0) {
        throw new Error("[GLTF] No geometry primitives found in scene.");
    }

    const vertexFloatBuffer = new Float32Array(totalVertices * floatsPerVertex);
    const vertexUintView = new Uint32Array(vertexFloatBuffer.buffer);

    const useUint32Indices = totalVertices > 65535;
    const indexArray = useUint32Indices
        ? new Uint32Array(totalIndices)
        : new Uint16Array(totalIndices);

    const submeshes: Submesh[] = [];
    let currentVertex = 0;
    let currentIndex = 0;

    for (const item of primitives) {
        const prim = item.primitive;
        const posAccessorIdx = prim.attributes?.POSITION;
        if (posAccessorIdx === undefined) continue;

        const posReader = createAccessorReader(gltf, posAccessorIdx, resolvedBuffers);
        const normAccessorIdx = prim.attributes?.NORMAL;
        const normReader = normAccessorIdx !== undefined
            ? createAccessorReader(gltf, normAccessorIdx, resolvedBuffers)
            : undefined;

        const uvAccessorIdx = prim.attributes?.TEXCOORD_0;
        const uvReader = uvAccessorIdx !== undefined
            ? createAccessorReader(gltf, uvAccessorIdx, resolvedBuffers)
            : undefined;

        const jointsAccessorIdx = prim.attributes?.JOINTS_0;
        const jointsReader = (isSkinned && jointsAccessorIdx !== undefined)
            ? createAccessorReader(gltf, jointsAccessorIdx, resolvedBuffers)
            : undefined;

        const weightsAccessorIdx = prim.attributes?.WEIGHTS_0;
        const weightsReader = (isSkinned && weightsAccessorIdx !== undefined)
            ? createAccessorReader(gltf, weightsAccessorIdx, resolvedBuffers)
            : undefined;

        const vCount = posReader.count;
        const baseVertexOffset = currentVertex;
        const world = item.worldTransform;
        const normMat = item.normalTransform;
        const bakeTransform = !item.isSkinned;

        // Populate vertices
        for (let i = 0; i < vCount; i++) {
            const vIdx = currentVertex + i;
            const fOffset = vIdx * floatsPerVertex;

            // Position
            let px = posReader.get(i, 0);
            let py = posReader.get(i, 1);
            let pz = posReader.get(i, 2);

            if (bakeTransform) {
                const tx = world[0] * px + world[4] * py + world[8] * pz + world[12];
                const ty = world[1] * px + world[5] * py + world[9] * pz + world[13];
                const tz = world[2] * px + world[6] * py + world[10] * pz + world[14];
                px = tx;
                py = ty;
                pz = tz;
            }

            vertexFloatBuffer[fOffset + 0] = px;
            vertexFloatBuffer[fOffset + 1] = py;
            vertexFloatBuffer[fOffset + 2] = pz;

            // Normal
            let nx = normReader ? normReader.get(i, 0) : 0;
            let ny = normReader ? normReader.get(i, 1) : 1;
            let nz = normReader ? normReader.get(i, 2) : 0;

            if (bakeTransform && normReader) {
                const tnx = normMat[0] * nx + normMat[4] * ny + normMat[8] * nz;
                const tny = normMat[1] * nx + normMat[5] * ny + normMat[9] * nz;
                const tnz = normMat[2] * nx + normMat[6] * ny + normMat[10] * nz;
                const len = Math.hypot(tnx, tny, tnz);
                if (len > 0.000001) {
                    nx = tnx / len;
                    ny = tny / len;
                    nz = tnz / len;
                }
            }

            vertexFloatBuffer[fOffset + 3] = nx;
            vertexFloatBuffer[fOffset + 4] = ny;
            vertexFloatBuffer[fOffset + 5] = nz;

            // UV
            const u = uvReader ? uvReader.get(i, 0) : 0;
            const v = uvReader ? uvReader.get(i, 1) : 0;
            vertexFloatBuffer[fOffset + 6] = u;
            vertexFloatBuffer[fOffset + 7] = v;

            // Joints & Weights if skinned
            if (isSkinned) {
                const j0 = jointsReader ? Math.round(jointsReader.get(i, 0)) : 0;
                const j1 = jointsReader ? Math.round(jointsReader.get(i, 1)) : 0;
                const j2 = jointsReader ? Math.round(jointsReader.get(i, 2)) : 0;
                const j3 = jointsReader ? Math.round(jointsReader.get(i, 3)) : 0;

                vertexUintView[fOffset + 8] = j0;
                vertexUintView[fOffset + 9] = j1;
                vertexUintView[fOffset + 10] = j2;
                vertexUintView[fOffset + 11] = j3;

                let w0 = weightsReader ? weightsReader.get(i, 0) : 1;
                let w1 = weightsReader ? weightsReader.get(i, 1) : 0;
                let w2 = weightsReader ? weightsReader.get(i, 2) : 0;
                let w3 = weightsReader ? weightsReader.get(i, 3) : 0;

                const sum = w0 + w1 + w2 + w3;
                if (sum > 0.000001) {
                    w0 /= sum;
                    w1 /= sum;
                    w2 /= sum;
                    w3 /= sum;
                }

                vertexFloatBuffer[fOffset + 12] = w0;
                vertexFloatBuffer[fOffset + 13] = w1;
                vertexFloatBuffer[fOffset + 14] = w2;
                vertexFloatBuffer[fOffset + 15] = w3;
            }
        }

        // Indices
        const firstIndex = currentIndex;
        let indexCount = 0;

        if (prim.indices !== undefined) {
            const idxReader = createAccessorReader(gltf, prim.indices, resolvedBuffers);
            indexCount = idxReader.count;
            for (let i = 0; i < indexCount; i++) {
                indexArray[currentIndex++] = baseVertexOffset + idxReader.get(i, 0);
            }
        } else {
            indexCount = vCount;
            for (let i = 0; i < indexCount; i++) {
                indexArray[currentIndex++] = baseVertexOffset + i;
            }
        }

        // Compute face normals if normal attribute was absent
        if (!normReader && indexCount >= 3) {
            for (let i = 0; i < indexCount; i += 3) {
                const i0 = indexArray[firstIndex + i];
                const i1 = indexArray[firstIndex + i + 1];
                const i2 = indexArray[firstIndex + i + 2];

                const f0 = i0 * floatsPerVertex;
                const f1 = i1 * floatsPerVertex;
                const f2 = i2 * floatsPerVertex;

                const ax = vertexFloatBuffer[f1] - vertexFloatBuffer[f0];
                const ay = vertexFloatBuffer[f1 + 1] - vertexFloatBuffer[f0 + 1];
                const az = vertexFloatBuffer[f1 + 2] - vertexFloatBuffer[f0 + 2];

                const bx = vertexFloatBuffer[f2] - vertexFloatBuffer[f0];
                const by = vertexFloatBuffer[f2 + 1] - vertexFloatBuffer[f0 + 1];
                const bz = vertexFloatBuffer[f2 + 2] - vertexFloatBuffer[f0 + 2];

                const cx = ay * bz - az * by;
                const cy = az * bx - ax * bz;
                const cz = ax * by - ay * bx;

                vertexFloatBuffer[f0 + 3] += cx;
                vertexFloatBuffer[f0 + 4] += cy;
                vertexFloatBuffer[f0 + 5] += cz;

                vertexFloatBuffer[f1 + 3] += cx;
                vertexFloatBuffer[f1 + 4] += cy;
                vertexFloatBuffer[f1 + 5] += cz;

                vertexFloatBuffer[f2 + 3] += cx;
                vertexFloatBuffer[f2 + 4] += cy;
                vertexFloatBuffer[f2 + 5] += cz;
            }

            for (let i = 0; i < vCount; i++) {
                const fOffset = (currentVertex + i) * floatsPerVertex;
                const nx = vertexFloatBuffer[fOffset + 3];
                const ny = vertexFloatBuffer[fOffset + 4];
                const nz = vertexFloatBuffer[fOffset + 5];
                const len = Math.hypot(nx, ny, nz);
                if (len > 0.000001) {
                    vertexFloatBuffer[fOffset + 3] = nx / len;
                    vertexFloatBuffer[fOffset + 4] = ny / len;
                    vertexFloatBuffer[fOffset + 5] = nz / len;
                }
            }
        }

        submeshes.push({
            firstIndex,
            indexCount,
            baseVertex: 0,
            materialIndex: prim.material ?? 0,
        });

        currentVertex += vCount;
    }

    const mesh = new MeshCPU(
        vertexLayout,
        submeshes,
        vertexFloatBuffer.buffer,
        indexArray
    );

    // Materials
    const materials: MaterialData[] = [];
    if (gltf.materials && gltf.materials.length > 0) {
        for (const m of gltf.materials) {
            const pbr = m.pbrMetallicRoughness;
            materials.push({
                name: m.name,
                baseColorFactor: pbr?.baseColorFactor ?? [1, 1, 1, 1],
                baseColorTextureIndex: pbr?.baseColorTexture?.index,
                metallicFactor: pbr?.metallicFactor ?? 1.0,
                roughnessFactor: pbr?.roughnessFactor ?? 1.0,
                metallicRoughnessTextureIndex: pbr?.metallicRoughnessTexture?.index,
                normalTextureIndex: m.normalTexture?.index,
                normalTextureScale: m.normalTexture?.scale ?? 1.0,
                occlusionTextureIndex: m.occlusionTexture?.index,
                occlusionTextureStrength: m.occlusionTexture?.strength ?? 1.0,
                emissiveFactor: m.emissiveFactor ?? [0, 0, 0],
                emissiveTextureIndex: m.emissiveTexture?.index,
                alphaMode: m.alphaMode ?? "OPAQUE",
                alphaCutoff: m.alphaCutoff ?? 0.5,
                doubleSided: m.doubleSided ?? false,
            });
        }
    } else {
        materials.push({
            name: "DefaultMaterial",
            baseColorFactor: [1, 1, 1, 1],
            metallicFactor: 1.0,
            roughnessFactor: 1.0,
        });
    }

    // Textures & Images
    const textures: TextureCPU[] = [];
    if (gltf.textures && gltf.textures.length > 0) {
        for (let t = 0; t < gltf.textures.length; t++) {
            const texDesc = gltf.textures[t];
            const imgIdx = texDesc.source ?? t;
            const imgDesc = gltf.images?.[imgIdx];

            let texCpu: TextureCPU | undefined;
            if (imgDesc && options?.imageResolver) {
                let imgData: Uint8Array | undefined;
                if (imgDesc.bufferView !== undefined) {
                    const bv = gltf.bufferViews[imgDesc.bufferView];
                    const buf = resolvedBuffers[bv.buffer];
                    const offset = bv.byteOffset ?? 0;
                    imgData = new Uint8Array(buf, offset, bv.byteLength);
                } else if (imgDesc.uri?.startsWith("data:")) {
                    imgData = decodeDataUri(imgDesc.uri);
                }
                const res = options.imageResolver(imgDesc, imgData);
                if (res instanceof TextureCPU) {
                    texCpu = res;
                }
            }

            // Fallback 1x1 white texture if unparsed
            if (!texCpu) {
                texCpu = new TextureCPU(
                    1,
                    1,
                    "rgba8unorm",
                    new Uint8Array([255, 255, 255, 255])
                );
            }
            textures.push(texCpu);
        }
    } else {
        // Fallback texture for material slot 0
        textures.push(
            new TextureCPU(
                1,
                1,
                "rgba8unorm",
                new Uint8Array([255, 255, 255, 255])
            )
        );
    }

    return {
        name: gltf.asset?.generator ?? "ModelCPU",
        mesh,
        textures,
        materials,
        skeleton,
    };
}

/**
 * Parses binary GLB buffer into pure ModelCPU.
 */
export function parseGLB(buffer: ArrayBuffer | Uint8Array, options?: GLTFParseOptions): ModelCPU {
    const { json, binChunk } = unpackGLB(buffer);
    const resolvedBuffers = resolveBuffers(json, binChunk, options);
    return parseGLTFJson(json, resolvedBuffers, options);
}

/**
 * Parses GLTF JSON object or string into pure ModelCPU.
 */
export function parseGLTF(gltfOrJson: string | object, options?: GLTFParseOptions): ModelCPU {
    const json = typeof gltfOrJson === "string" ? JSON.parse(gltfOrJson) : gltfOrJson;
    const resolvedBuffers = resolveBuffers(json, undefined, options);
    return parseGLTFJson(json, resolvedBuffers, options);
}

/**
 * Asynchronously loads GLTF or GLB model from path, URL, or buffer.
 */
export async function loadGLTF(
    source: string | ArrayBuffer | Uint8Array,
    options?: GLTFLoadOptions
): Promise<ModelCPU> {
    if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
        const rawBuf = source instanceof Uint8Array ? source.buffer : source;
        const view = new DataView(rawBuf, source instanceof Uint8Array ? source.byteOffset : 0);
        if (view.getUint32(0, true) === GLB_MAGIC) {
            return parseGLB(source, options);
        }
        const text = new TextDecoder().decode(source);
        return parseGLTF(text, options);
    }

    if (typeof source === "string") {
        let arrayBuffer: ArrayBuffer;

        if (typeof fetch === "function") {
            try {
                const res = await fetch(source);
                if (res.ok) {
                    arrayBuffer = await res.arrayBuffer();
                    const view = new DataView(arrayBuffer);
                    if (view.getUint32(0, true) === GLB_MAGIC) {
                        return parseGLB(arrayBuffer, options);
                    }
                    const text = new TextDecoder().decode(arrayBuffer);
                    return parseGLTF(text, options);
                }
            } catch {}
        }

        const g = globalThis as any;
        if (g.process && g.process.versions?.node) {
            try {
                const fsMod = "fs/promises";
                const fs = await import(/* @vite-ignore */ fsMod);
                const buf = await fs.readFile(source);
                arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
                const view = new DataView(arrayBuffer);
                if (view.getUint32(0, true) === GLB_MAGIC) {
                    return parseGLB(arrayBuffer, options);
                }
                const text = new TextDecoder().decode(arrayBuffer);
                return parseGLTF(text, options);
            } catch {}
        }


        throw new Error(`[GLTF] Unable to load resource from: ${source}`);
    }

    throw new Error("[GLTF] Unsupported source type provided to loadGLTF.");
}
