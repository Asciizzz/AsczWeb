// ================================================================
//  Awgpu - Level 4: Hardware Pipelines (RasterPipeline, ComputePipeline)
// ================================================================

import { type Device, resolveDevice } from "./device.js";
import type { StreamSet } from "./stream.js";
import type { BindLayout } from "./binding.js";

export interface ShaderMessage {
    type: "error" | "warning" | "info";
    stage: "vertex" | "fragment" | "compute";
    message: string;
    lineNum: number;
    linePos: number;
    offset: number;
    length: number;
}

export interface RasterPipelineDesc {
    label?: string;
    vertex: {
        code: string;
        entryPoint?: string;
        buffers?: (GPUVertexBufferLayout | null)[];
    };
    fragment?: {
        code?: string;
        entryPoint?: string;
        targets: GPUColorTargetState[];
    };
    streamSet?: StreamSet;
    layouts?: (GPUBindGroupLayout | BindLayout | null)[];
    depthStencil?: GPUDepthStencilState;
    primitive?: GPUPrimitiveState;
    multisample?: GPUMultisampleState;
    onShaderMessage?: (msg: ShaderMessage) => void;
}

export interface ComputePipelineDesc {
    label?: string;
    code: string;
    entryPoint?: string;
    layouts?: (GPUBindGroupLayout | BindLayout | null)[];
    onShaderMessage?: (msg: ShaderMessage) => void;
}

function reportShaderMessages(
    module: GPUShaderModule,
    stage: "vertex" | "fragment" | "compute",
    onMessage?: (msg: ShaderMessage) => void
): void {
    if (!onMessage) return;
    module.getCompilationInfo().then((info) => {
        for (const msg of info.messages) {
            onMessage({
                type: msg.type as "error" | "warning" | "info",
                stage,
                message: msg.message,
                lineNum: msg.lineNum,
                linePos: msg.linePos,
                offset: msg.offset,
                length: msg.length,
            });
        }
    });
}

/**
 * WebGPU render pipeline wrapper for rasterization and depth prepasses.
 */
export class RasterPipeline {
    readonly native: GPURenderPipeline;
    readonly layout?: GPUPipelineLayout;
    readonly hasFragmentStage: boolean;
    readonly label: string;

    constructor(
        native: GPURenderPipeline,
        hasFragmentStage: boolean,
        layout?: GPUPipelineLayout,
        label = "RasterPipeline"
    ) {
        this.native = native;
        this.hasFragmentStage = hasFragmentStage;
        this.layout = layout;
        this.label = label;
    }

    private static _buildDescriptor(gpu: GPUDevice, desc: RasterPipelineDesc): {
        nativeDesc: GPURenderPipelineDescriptor;
        hasFragmentStage: boolean;
        pipelineLayout: GPUPipelineLayout | "auto";
        label: string;
    } {
        const label = desc.label ?? "RasterPipeline";

        // 1. Vertex Shader Module
        const vsModule = gpu.createShaderModule({
            label: `${label}_VS`,
            code: desc.vertex.code,
        });
        reportShaderMessages(vsModule, "vertex", desc.onShaderMessage);

        // 2. Vertex Buffer Layouts
        let vertexBuffers = desc.vertex.buffers ?? [];
        if (desc.streamSet) {
            vertexBuffers = desc.streamSet.deriveVertexLayouts();
        }

        // 3. Pipeline Layout with Automatic Empty Slot Sanitization
        let pipelineLayout: GPUPipelineLayout | "auto" = "auto";
        if (desc.layouts && desc.layouts.length > 0) {
            let emptyLayout: GPUBindGroupLayout | null = null;
            const sanitizedLayouts = desc.layouts.map((l) => {
                if (!l) {
                    if (!emptyLayout) {
                        emptyLayout = gpu.createBindGroupLayout({
                            label: `${label}_EmptySlot`,
                            entries: [],
                        });
                    }
                    return emptyLayout;
                }
                return "native" in l ? l.native : l;
            });

            pipelineLayout = gpu.createPipelineLayout({
                label: `${label}_Layout`,
                bindGroupLayouts: sanitizedLayouts,
            });
        }

        // 4. Native Pipeline Descriptor
        const nativeDesc: GPURenderPipelineDescriptor = {
            label,
            layout: pipelineLayout,
            vertex: {
                module: vsModule,
                entryPoint: desc.vertex.entryPoint ?? "vs_main",
                buffers: vertexBuffers,
            },
            primitive: desc.primitive ?? {
                topology: "triangle-list",
                cullMode: "none",
            },
        };

        if (desc.depthStencil) {
            nativeDesc.depthStencil = desc.depthStencil;
        }

        if (desc.multisample) {
            nativeDesc.multisample = desc.multisample;
        }

        // 5. Fragment Stage (Optional for depth-only passes)
        const hasFragmentStage = !!desc.fragment;
        if (desc.fragment) {
            const fsCode = desc.fragment.code ?? desc.vertex.code;
            const fsModule =
                fsCode === desc.vertex.code
                    ? vsModule
                    : gpu.createShaderModule({
                          label: `${label}_FS`,
                          code: fsCode,
                      });

            if (fsModule !== vsModule) {
                reportShaderMessages(fsModule, "fragment", desc.onShaderMessage);
            }

            nativeDesc.fragment = {
                module: fsModule,
                entryPoint: desc.fragment.entryPoint ?? "fs_main",
                targets: desc.fragment.targets,
            };
        }

        return { nativeDesc, hasFragmentStage, pipelineLayout, label };
    }

    /**
     * Factory: Compiles shaders and instantiates GPURenderPipeline with automatic layout derivation.
     */
    static create(device: Device | GPUDevice, desc: RasterPipelineDesc): RasterPipeline {
        const gpu = resolveDevice(device);
        const { nativeDesc, hasFragmentStage, pipelineLayout, label } = RasterPipeline._buildDescriptor(gpu, desc);
        const native = gpu.createRenderPipeline(nativeDesc);
        return new RasterPipeline(
            native,
            hasFragmentStage,
            pipelineLayout === "auto" ? undefined : pipelineLayout,
            label
        );
    }

    /**
     * Factory: Asynchronously compiles shaders and instantiates GPURenderPipeline.
     */
    static async createAsync(device: Device | GPUDevice, desc: RasterPipelineDesc): Promise<RasterPipeline> {
        const gpu = resolveDevice(device);
        const { nativeDesc, hasFragmentStage, pipelineLayout, label } = RasterPipeline._buildDescriptor(gpu, desc);
        const native = await gpu.createRenderPipelineAsync(nativeDesc);
        return new RasterPipeline(
            native,
            hasFragmentStage,
            pipelineLayout === "auto" ? undefined : pipelineLayout,
            label
        );
    }
}

/**
 * WebGPU compute pipeline wrapper.
 */
export class ComputePipeline {
    readonly native: GPUComputePipeline;
    readonly layout?: GPUPipelineLayout;
    readonly label: string;

    constructor(native: GPUComputePipeline, layout?: GPUPipelineLayout, label = "ComputePipeline") {
        this.native = native;
        this.layout = layout;
        this.label = label;
    }

    private static _buildDescriptor(gpu: GPUDevice, desc: ComputePipelineDesc): {
        nativeDesc: GPUComputePipelineDescriptor;
        pipelineLayout: GPUPipelineLayout | "auto";
        label: string;
    } {
        const label = desc.label ?? "ComputePipeline";

        const csModule = gpu.createShaderModule({
            label: `${label}_CS`,
            code: desc.code,
        });
        reportShaderMessages(csModule, "compute", desc.onShaderMessage);

        let pipelineLayout: GPUPipelineLayout | "auto" = "auto";
        if (desc.layouts && desc.layouts.length > 0) {
            let emptyLayout: GPUBindGroupLayout | null = null;
            const sanitizedLayouts = desc.layouts.map((l) => {
                if (!l) {
                    if (!emptyLayout) {
                        emptyLayout = gpu.createBindGroupLayout({
                            label: `${label}_EmptySlot`,
                            entries: [],
                        });
                    }
                    return emptyLayout;
                }
                return "native" in l ? l.native : l;
            });

            pipelineLayout = gpu.createPipelineLayout({
                label: `${label}_Layout`,
                bindGroupLayouts: sanitizedLayouts,
            });
        }

        const nativeDesc: GPUComputePipelineDescriptor = {
            label,
            layout: pipelineLayout,
            compute: {
                module: csModule,
                entryPoint: desc.entryPoint ?? "cs_main",
            },
        };

        return { nativeDesc, pipelineLayout, label };
    }

    /**
     * Factory: Compiles compute shader and instantiates GPUComputePipeline.
     */
    static create(device: Device | GPUDevice, desc: ComputePipelineDesc): ComputePipeline {
        const gpu = resolveDevice(device);
        const { nativeDesc, pipelineLayout, label } = ComputePipeline._buildDescriptor(gpu, desc);
        const native = gpu.createComputePipeline(nativeDesc);
        return new ComputePipeline(
            native,
            pipelineLayout === "auto" ? undefined : pipelineLayout,
            label
        );
    }

    /**
     * Factory: Asynchronously compiles compute shader and instantiates GPUComputePipeline.
     */
    static async createAsync(device: Device | GPUDevice, desc: ComputePipelineDesc): Promise<ComputePipeline> {
        const gpu = resolveDevice(device);
        const { nativeDesc, pipelineLayout, label } = ComputePipeline._buildDescriptor(gpu, desc);
        const native = await gpu.createComputePipelineAsync(nativeDesc);
        return new ComputePipeline(
            native,
            pipelineLayout === "auto" ? undefined : pipelineLayout,
            label
        );
    }
}

function hashPipelineString(str: string): string {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
    }
    return h.toString(36);
}

let _nextPipelineLayoutId = 1;
const _pipelineLayoutIdMap = new WeakMap<GPUBindGroupLayout, number>();

function getBindGroupLayoutId(layout: GPUBindGroupLayout | BindLayout | null | undefined): number {
    if (!layout) return 0;
    const raw = "native" in layout ? layout.native : layout;
    let id = _pipelineLayoutIdMap.get(raw);
    if (id === undefined) {
        id = _nextPipelineLayoutId++;
        _pipelineLayoutIdMap.set(raw, id);
    }
    return id;
}

/**
 * Cache preventing redundant driver recompilation of identical pipelines.
 */
export class PipelineCache {
    private static _defaultInstance?: PipelineCache;

    static get default(): PipelineCache {
        if (!PipelineCache._defaultInstance) {
            PipelineCache._defaultInstance = new PipelineCache();
        }
        return PipelineCache._defaultInstance;
    }

    private _rasterPipelines = new Map<string, RasterPipeline>();
    private _computePipelines = new Map<string, ComputePipeline>();

    /**
     * Computes deterministic hash key for RasterPipelineDesc.
     */
    static hashRasterDesc(desc: RasterPipelineDesc): string {
        const vsHash = hashPipelineString(desc.vertex.code);
        const vsEp = desc.vertex.entryPoint ?? "vs_main";

        let vBuffers = "";
        if (desc.vertex.buffers) {
            vBuffers = JSON.stringify(desc.vertex.buffers);
        } else if (desc.streamSet) {
            vBuffers = JSON.stringify(desc.streamSet.deriveVertexLayouts());
        }

        let fsKey = "none";
        if (desc.fragment) {
            const fsCode = desc.fragment.code ?? desc.vertex.code;
            const fsHash = hashPipelineString(fsCode);
            const fsEp = desc.fragment.entryPoint ?? "fs_main";
            fsKey = `${fsHash}:${fsEp}:${JSON.stringify(desc.fragment.targets)}`;
        }

        const layoutsKey = desc.layouts
            ? desc.layouts.map(getBindGroupLayoutId).join(",")
            : "auto";

        const dsKey = desc.depthStencil ? JSON.stringify(desc.depthStencil) : "";
        const primKey = desc.primitive ? JSON.stringify(desc.primitive) : "";
        const msKey = desc.multisample ? JSON.stringify(desc.multisample) : "";

        return `r:${vsHash}:${vsEp};b:${vBuffers};f:${fsKey};l:${layoutsKey};d:${dsKey};p:${primKey};m:${msKey}`;
    }

    /**
     * Computes deterministic hash key for ComputePipelineDesc.
     */
    static hashComputeDesc(desc: ComputePipelineDesc): string {
        const csHash = hashPipelineString(desc.code);
        const csEp = desc.entryPoint ?? "cs_main";
        const layoutsKey = desc.layouts
            ? desc.layouts.map(getBindGroupLayoutId).join(",")
            : "auto";

        return `c:${csHash}:${csEp};l:${layoutsKey}`;
    }

    getRaster(key: string): RasterPipeline | undefined {
        return this._rasterPipelines.get(key);
    }

    setRaster(key: string, pipeline: RasterPipeline): void {
        this._rasterPipelines.set(key, pipeline);
    }

    getCompute(key: string): ComputePipeline | undefined {
        return this._computePipelines.get(key);
    }

    setCompute(key: string, pipeline: ComputePipeline): void {
        this._computePipelines.set(key, pipeline);
    }

    /**
     * Retrieves existing cached RasterPipeline or compiles new instance.
     */
    getOrCreateRaster(device: Device | GPUDevice, desc: RasterPipelineDesc): RasterPipeline {
        const key = PipelineCache.hashRasterDesc(desc);
        let pipeline = this._rasterPipelines.get(key);
        if (!pipeline) {
            pipeline = RasterPipeline.create(device, desc);
            this._rasterPipelines.set(key, pipeline);
        }
        return pipeline;
    }

    /**
     * Retrieves existing cached RasterPipeline or asynchronously compiles new instance.
     */
    async getOrCreateRasterAsync(device: Device | GPUDevice, desc: RasterPipelineDesc): Promise<RasterPipeline> {
        const key = PipelineCache.hashRasterDesc(desc);
        let pipeline = this._rasterPipelines.get(key);
        if (!pipeline) {
            pipeline = await RasterPipeline.createAsync(device, desc);
            this._rasterPipelines.set(key, pipeline);
        }
        return pipeline;
    }

    /**
     * Retrieves existing cached ComputePipeline or compiles new instance.
     */
    getOrCreateCompute(device: Device | GPUDevice, desc: ComputePipelineDesc): ComputePipeline {
        const key = PipelineCache.hashComputeDesc(desc);
        let pipeline = this._computePipelines.get(key);
        if (!pipeline) {
            pipeline = ComputePipeline.create(device, desc);
            this._computePipelines.set(key, pipeline);
        }
        return pipeline;
    }

    /**
     * Retrieves existing cached ComputePipeline or asynchronously compiles new instance.
     */
    async getOrCreateComputeAsync(device: Device | GPUDevice, desc: ComputePipelineDesc): Promise<ComputePipeline> {
        const key = PipelineCache.hashComputeDesc(desc);
        let pipeline = this._computePipelines.get(key);
        if (!pipeline) {
            pipeline = await ComputePipeline.createAsync(device, desc);
            this._computePipelines.set(key, pipeline);
        }
        return pipeline;
    }

    clear(): void {
        this._rasterPipelines.clear();
        this._computePipelines.clear();
    }
}
