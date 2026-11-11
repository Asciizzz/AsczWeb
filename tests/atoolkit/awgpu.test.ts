import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	Buffer,
	BufferPool,
	Texture,
	StreamSet,
	Target,
	BindLayout,
	BindTableCache,
	RasterPipeline,
	ComputePipeline,
	PipelineCache,
	RenderPassNode,
	resolveTextureView,
	type Device
} from "../../Atoolkit/awgpu/index.ts";

interface MockBufferRecord {
	label?: string;
	size: number;
	usage: number;
	bytes: Uint8Array;
	destroyed: boolean;
	mapped: boolean;
	unmappedCount: number;
}

interface MockTextureWriteCall {
	destination: GPUImageCopyTexture;
	data: Uint8Array;
	dataLayout: GPUImageDataLayout;
	size: GPUExtent3DStrict;
}

function createMockGPUDevice(options: {
	failAsyncPipelineCount?: number;
	failMapAsync?: boolean;
	asyncDelayMs?: number;
} = {}) {
	let destroyed = false;
	let remainingAsyncFailures = options.failAsyncPipelineCount ?? 0;
	let createRenderPipelineCount = 0;
	let createRenderPipelineAsyncCount = 0;
	let createBindGroupCount = 0;

	const buffers: MockBufferRecord[] = [];
	const textures: Array<{ label?: string; destroyed: boolean; desc: GPUTextureDescriptor }> = [];
	const textureWrites: MockTextureWriteCall[] = [];
	const recordedPassOps: Array<
		| { type: "setVertexBuffer"; slot: number; buffer: GPUBuffer; offset?: number; size?: number }
		| { type: "setIndexBuffer"; buffer: GPUBuffer; format: GPUIndexFormat; offset?: number; size?: number }
		| { type: "draw"; vertexCount: number; instanceCount?: number; firstVertex?: number; firstInstance?: number }
		| { type: "drawIndexed"; indexCount: number; instanceCount?: number; firstIndex?: number; baseVertex?: number; firstInstance?: number }
	> = [];
	let lastRenderPassDesc: GPURenderPassDescriptor | null = null;

	const rawDevice = {
		get isDestroyed() {
			return destroyed;
		},
		destroy() {
			destroyed = true;
		},
		queue: {
			writeBuffer(
				buffer: GPUBuffer,
				bufferOffset: number,
				data: BufferSource,
				dataOffset = 0,
				size?: number
			) {
				const rec = (buffer as unknown as { _rec: MockBufferRecord })._rec;
				const src = ArrayBuffer.isView(data)
					? new Uint8Array(data.buffer, data.byteOffset + dataOffset, size ?? (data.byteLength - dataOffset))
					: new Uint8Array(data, dataOffset, size ?? (data.byteLength - dataOffset));
				rec.bytes.set(src, bufferOffset);
			},
			writeTexture(
				destination: GPUImageCopyTexture,
				data: BufferSource,
				dataLayout: GPUImageDataLayout,
				size: GPUExtent3DStrict
			) {
				const bytes = ArrayBuffer.isView(data)
					? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
					: new Uint8Array(data).slice();
				textureWrites.push({
					destination,
					data: bytes,
					dataLayout: { ...dataLayout },
					size: { ...(size as object) } as GPUExtent3DStrict
				});
			},
			submit(_commandBuffers: Iterable<GPUCommandBuffer>) {}
		},
		createBuffer(desc: GPUBufferDescriptor): GPUBuffer {
			const rec: MockBufferRecord = {
				label: desc.label,
				size: desc.size,
				usage: desc.usage,
				bytes: new Uint8Array(desc.size),
				destroyed: false,
				mapped: !!desc.mappedAtCreation,
				unmappedCount: 0
			};
			buffers.push(rec);
			const handle = {
				_rec: rec,
				label: desc.label ?? "",
				size: desc.size,
				usage: desc.usage,
				mapState: desc.mappedAtCreation ? "mapped" : "unmapped",
				getMappedRange(offset = 0, size = desc.size - offset): ArrayBuffer {
					return rec.bytes.buffer.slice(offset, offset + size) as ArrayBuffer;
				},
				unmap() {
					// If mappedAtCreation was used, sync back any modifications written via getMappedRange:
					rec.mapped = false;
					rec.unmappedCount++;
				},
				async mapAsync(_mode: number, _offset = 0, _size = desc.size): Promise<void> {
					if (options.failMapAsync) {
						throw new Error("Mock mapAsync failure");
					}
					rec.mapped = true;
				},
				destroy() {
					rec.destroyed = true;
				}
			};
			// Allow direct writes into getMappedRange buffer to reflect in rec.bytes
			handle.getMappedRange = (offset = 0, size = desc.size - offset): ArrayBuffer => {
				if (offset === 0 && size === desc.size) {
					return rec.bytes.buffer as ArrayBuffer;
				}
				return rec.bytes.buffer.slice(offset, offset + size) as ArrayBuffer;
			};
			return handle as unknown as GPUBuffer;
		},
		createTexture(desc: GPUTextureDescriptor): GPUTexture {
			const rec = {
				label: desc.label,
				destroyed: false,
				desc
			};
			textures.push(rec);
			const sizeObj = desc.size as { width: number; height: number; depthOrArrayLayers?: number };
			return {
				_rec: rec,
				label: desc.label ?? "",
				width: sizeObj.width,
				height: sizeObj.height,
				depthOrArrayLayers: sizeObj.depthOrArrayLayers ?? 1,
				mipLevelCount: desc.mipLevelCount ?? 1,
				sampleCount: desc.sampleCount ?? 1,
				dimension: desc.dimension ?? "2d",
				format: desc.format,
				usage: desc.usage,
				createView(viewDesc?: GPUTextureViewDescriptor): GPUTextureView {
					return { label: viewDesc?.label ?? "view" } as unknown as GPUTextureView;
				},
				destroy() {
					rec.destroyed = true;
				}
			} as unknown as GPUTexture;
		},
		createSampler(desc?: GPUSamplerDescriptor): GPUSampler {
			return { label: desc?.label ?? "" } as unknown as GPUSampler;
		},
		createBindGroupLayout(desc: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout {
			return { label: desc.label ?? "" } as unknown as GPUBindGroupLayout;
		},
		createPipelineLayout(desc: GPUPipelineLayoutDescriptor): GPUPipelineLayout {
			return { label: desc.label ?? "" } as unknown as GPUPipelineLayout;
		},
		createBindGroup(desc: GPUBindGroupDescriptor): GPUBindGroup {
			createBindGroupCount++;
			return { label: desc.label ?? "", _desc: desc } as unknown as GPUBindGroup;
		},
		createShaderModule(desc: GPUShaderModuleDescriptor): GPUShaderModule {
			return {
				label: desc.label ?? "",
				async getCompilationInfo(): Promise<GPUCompilationInfo> {
					return { messages: [] } as unknown as GPUCompilationInfo;
				}
			} as unknown as GPUShaderModule;
		},
		createRenderPipeline(desc: GPURenderPipelineDescriptor): GPURenderPipeline {
			createRenderPipelineCount++;
			return {
				label: desc.label ?? "",
				_desc: desc,
				getBindGroupLayout(_index: number): GPUBindGroupLayout {
					return {} as unknown as GPUBindGroupLayout;
				}
			} as unknown as GPURenderPipeline;
		},
		async createRenderPipelineAsync(desc: GPURenderPipelineDescriptor): Promise<GPURenderPipeline> {
			createRenderPipelineAsyncCount++;
			if (options.asyncDelayMs) {
				await new Promise((r) => setTimeout(r, options.asyncDelayMs));
			}
			if (remainingAsyncFailures > 0) {
				remainingAsyncFailures--;
				throw new Error("Simulated async pipeline compilation failure");
			}
			return {
				label: desc.label ?? "",
				_desc: desc,
				getBindGroupLayout(_index: number): GPUBindGroupLayout {
					return {} as unknown as GPUBindGroupLayout;
				}
			} as unknown as GPURenderPipeline;
		},
		createComputePipeline(desc: GPUComputePipelineDescriptor): GPUComputePipeline {
			return {
				label: desc.label ?? "",
				getBindGroupLayout(_index: number): GPUBindGroupLayout {
					return {} as unknown as GPUBindGroupLayout;
				}
			} as unknown as GPUComputePipeline;
		},
		async createComputePipelineAsync(desc: GPUComputePipelineDescriptor): Promise<GPUComputePipeline> {
			return {
				label: desc.label ?? "",
				getBindGroupLayout(_index: number): GPUBindGroupLayout {
					return {} as unknown as GPUBindGroupLayout;
				}
			} as unknown as GPUComputePipeline;
		},
		createCommandEncoder(): GPUCommandEncoder {
			return {
				label: "",
				copyBufferToBuffer(
					src: GPUBuffer,
					srcOffset: number,
					dst: GPUBuffer,
					dstOffset: number,
					size: number
				) {
					const sRec = (src as unknown as { _rec: MockBufferRecord })._rec;
					const dRec = (dst as unknown as { _rec: MockBufferRecord })._rec;
					dRec.bytes.set(sRec.bytes.subarray(srcOffset, srcOffset + size), dstOffset);
				},
				beginRenderPass(desc: GPURenderPassDescriptor): GPURenderPassEncoder {
					lastRenderPassDesc = desc;
					return {
						setPipeline(_p: GPURenderPipeline) {},
						setBindGroup(_slot: number, _bg: GPUBindGroup | null) {},
						setVertexBuffer(slot: number, buffer: GPUBuffer | null, offset?: number, size?: number) {
							if (buffer) {
								recordedPassOps.push({ type: "setVertexBuffer", slot, buffer, offset, size });
							}
						},
						setIndexBuffer(buffer: GPUBuffer, format: GPUIndexFormat, offset?: number, size?: number) {
							recordedPassOps.push({ type: "setIndexBuffer", buffer, format, offset, size });
						},
						draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number) {
							recordedPassOps.push({ type: "draw", vertexCount, instanceCount, firstVertex, firstInstance });
						},
						drawIndexed(
							indexCount: number,
							instanceCount?: number,
							firstIndex?: number,
							baseVertex?: number,
							firstInstance?: number
						) {
							recordedPassOps.push({
								type: "drawIndexed",
								indexCount,
								instanceCount,
								firstIndex,
								baseVertex,
								firstInstance
							});
						},
						end() {}
					} as unknown as GPURenderPassEncoder;
				},
				finish(): GPUCommandBuffer {
					return {} as unknown as GPUCommandBuffer;
				}
			} as unknown as GPUCommandEncoder;
		}
	};

	const gpuDevice = rawDevice as unknown as GPUDevice;
	const wrappedDevice = {
		native: gpuDevice,
		queue: rawDevice.queue as unknown as GPUQueue,
		format: "bgra8unorm" as GPUTextureFormat,
		canvas: { width: 800, height: 600 } as unknown as HTMLCanvasElement,
		getCurrentTextureView(): GPUTextureView {
			return { label: "swapchain-view" } as unknown as GPUTextureView;
		}
	} as unknown as Device;

	return {
		gpuDevice,
		wrappedDevice,
		buffers,
		textures,
		textureWrites,
		recordedPassOps,
		get lastRenderPassDesc() {
			return lastRenderPassDesc;
		},
		get isDeviceDestroyed() {
			return destroyed;
		},
		get createRenderPipelineCount() {
			return createRenderPipelineCount;
		},
		get createRenderPipelineAsyncCount() {
			return createRenderPipelineAsyncCount;
		},
		get createBindGroupCount() {
			return createBindGroupCount;
		}
	};
}

describe("awgpu 7A - Device-Scoped Caches, Pipeline Normalization, and Async Deduplication", () => {
	it("isolates PipelineCache, BindTableCache, and BufferPool across devices and never destroys borrowed GPUDevice", () => {
		const devA = createMockGPUDevice();
		const devB = createMockGPUDevice();

		const pipeCache = new PipelineCache();
		const desc = {
			vertex: { code: "@vertex fn vs_main() -> @builtin(position) vec4f { return vec4f(0.0); }" },
			fragment: {
				code: "@fragment fn fs_main() -> @location(0) vec4f { return vec4f(1.0); }",
				targets: [{ format: "rgba8unorm" as GPUTextureFormat }]
			}
		};

		const pA1 = pipeCache.getOrCreateRaster(devA.gpuDevice, desc);
		const pA2 = pipeCache.getOrCreateRaster(devA.gpuDevice, desc);
		const pB1 = pipeCache.getOrCreateRaster(devB.gpuDevice, desc);

		assert.equal(pA1, pA2);
		assert.notEqual(pA1, pB1);
		assert.equal(devA.createRenderPipelineCount, 1);
		assert.equal(devB.createRenderPipelineCount, 1);

		pipeCache.dispose();
		assert.equal(devA.isDeviceDestroyed, false);
		assert.equal(devB.isDeviceDestroyed, false);

		// BindTableCache device isolation + LRU + evictResource
		const btCache = new BindTableCache({ maxEntries: 2 });
		const layoutA = new BindLayout(devA.gpuDevice, [{ binding: 0, visibility: 1, buffer: { type: "uniform" } }]);
		const layoutB = new BindLayout(devB.gpuDevice, [{ binding: 0, visibility: 1, buffer: { type: "uniform" } }]);
		const bufA = Buffer.uniform(devA.gpuDevice, 64);
		const bufB = Buffer.uniform(devB.gpuDevice, 64);

		const btA = btCache.getOrCreate(devA.gpuDevice, layoutA, [{ binding: 0, resource: bufA }]);
		const btB = btCache.getOrCreate(devB.gpuDevice, layoutB, [{ binding: 0, resource: bufB }]);
		assert.notEqual(btA, btB);

		assert.equal(btCache.evictResource(bufA), 1);
		btCache.dispose();
		assert.equal(devA.isDeviceDestroyed, false);

		// BufferPool device scoping and destroy cleanup
		const pool = new BufferPool(devA.gpuDevice);
		const pooledBuf = pool.acquire(128);
		assert.equal(pooledBuf.size, 256);
		assert.throws(() => {
			pool.acquire(devB.gpuDevice, 128);
		}, /different GPUDevice/i);

		pool.destroy();
		assert.equal(pooledBuf.isDestroyed, true);
		assert.equal(devA.isDeviceDestroyed, false);
	});

	it("rejects simultaneous streamSet and vertex.buffers on RasterPipeline", () => {
		const dev = createMockGPUDevice();
		const vbo = Buffer.vertex(dev.gpuDevice, 64);
		const streams = new StreamSet().addVertex(0, 0, "float32x3", vbo);

		assert.throws(() => {
			RasterPipeline.create(dev.gpuDevice, {
				streamSet: streams,
				vertex: {
					code: "@vertex fn vs_main() -> @builtin(position) vec4f { return vec4f(0.0); }",
					buffers: []
				}
			});
		}, /mutually exclusive/i);
	});

	it("deduplicates concurrent async compilations, evicts failed promises for retry, and guards clear() generation", async () => {
		const dev = createMockGPUDevice({ failAsyncPipelineCount: 1, asyncDelayMs: 10 });
		const cache = new PipelineCache(dev.gpuDevice);
		const desc = {
			vertex: { code: "@vertex fn vs_main() -> @builtin(position) vec4f { return vec4f(0.0); }" }
		};

		// First attempt fails
		await assert.rejects(() => cache.getOrCreateRasterAsync(dev.gpuDevice, desc), /Simulated async/);
		assert.equal(cache.rasterCount, 0);

		// Subsequent retry succeeds and concurrent callers share the same compilation promise
		const [res1, res2] = await Promise.all([
			cache.getOrCreateRasterAsync(dev.gpuDevice, desc),
			cache.getOrCreateRasterAsync(dev.gpuDevice, desc)
		]);
		assert.equal(res1, res2);
		assert.equal(dev.createRenderPipelineAsyncCount, 2);
		assert.equal(cache.rasterCount, 1);

		// Clearing while an async compilation is in flight prevents stale repopulation
		const desc2 = {
			vertex: { code: "@vertex fn vs_main() -> @builtin(position) vec4f { return vec4f(1.0); }" }
		};
		const inFlight = cache.getOrCreateRasterAsync(dev.gpuDevice, desc2);
		cache.clear();
		await inFlight;
		assert.equal(cache.rasterCount, 0);
	});

	it("supports repeatable populate/clear cycles across bound and unbound caches and isolates in-flight promises across clear()", async () => {
		const devA = createMockGPUDevice();
		const devB = createMockGPUDevice();

		// 1. BindTableCache: 3 populate -> clear cycles on the same GPUDevice
		const btCache = new BindTableCache(devA.gpuDevice);
		const layoutA = new BindLayout(devA.gpuDevice, [{ binding: 0, visibility: 1, buffer: { type: "uniform" } }]);
		const bufA = Buffer.uniform(devA.gpuDevice, 64);
		for (let cycle = 0; cycle < 3; cycle++) {
			btCache.getOrCreate(devA.gpuDevice, layoutA, [{ binding: 0, resource: bufA }]);
			assert.equal(btCache.size, 1, `BindTableCache cycle ${cycle} populate`);
			btCache.clear();
			assert.equal(btCache.size, 0, `BindTableCache cycle ${cycle} clear`);
		}

		// 2. PipelineCache: 3 populate -> clear cycles for both raster and compute pipelines on the same GPUDevice
		const pipeCache = new PipelineCache(devA.gpuDevice);
		const rasterDesc = {
			vertex: { code: "@vertex fn vs_main() -> @builtin(position) vec4f { return vec4f(0.0); }" }
		};
		const computeDesc = {
			compute: { code: "@compute @workgroup_size(1) fn cs_main() {}" }
		};
		for (let cycle = 0; cycle < 3; cycle++) {
			pipeCache.getOrCreateRaster(devA.gpuDevice, rasterDesc);
			pipeCache.getOrCreateCompute(devA.gpuDevice, computeDesc);
			assert.equal(pipeCache.rasterCount, 1, `PipelineCache raster cycle ${cycle} populate`);
			assert.equal(pipeCache.computeCount, 1, `PipelineCache compute cycle ${cycle} populate`);
			pipeCache.clear();
			assert.equal(pipeCache.rasterCount, 0, `PipelineCache raster cycle ${cycle} clear`);
			assert.equal(pipeCache.computeCount, 0, `PipelineCache compute cycle ${cycle} clear`);
		}

		// 3. Two-device unbound BindTableCache: populate both, clear, populate both again, then evictResource on each
		const multiBtCache = new BindTableCache();
		const layoutB = new BindLayout(devB.gpuDevice, [{ binding: 0, visibility: 1, buffer: { type: "uniform" } }]);
		const bufB = Buffer.uniform(devB.gpuDevice, 64);

		multiBtCache.getOrCreate(devA.gpuDevice, layoutA, [{ binding: 0, resource: bufA }]);
		multiBtCache.getOrCreate(devB.gpuDevice, layoutB, [{ binding: 0, resource: bufB }]);
		assert.equal(multiBtCache.size, 2);

		multiBtCache.clear();
		assert.equal(multiBtCache.size, 0);

		multiBtCache.getOrCreate(devA.gpuDevice, layoutA, [{ binding: 0, resource: bufA }]);
		multiBtCache.getOrCreate(devB.gpuDevice, layoutB, [{ binding: 0, resource: bufB }]);
		assert.equal(multiBtCache.size, 2);

		assert.equal(multiBtCache.evictResource(bufA), 1);
		assert.equal(multiBtCache.size, 1);
		assert.equal(multiBtCache.evictResource(bufB), 1);
		assert.equal(multiBtCache.size, 0);

		// 4. Deferred async compilation race across clear() (both resolve and reject cases for raster & compute)
		let rasterCallCount = 0;
		const rasterDeferreds: Array<{
			resolve: (p: GPURenderPipeline) => void;
			reject: (err: Error) => void;
		}> = [];
		(devA.gpuDevice as unknown as {
			createRenderPipelineAsync: (d: GPURenderPipelineDescriptor) => Promise<GPURenderPipeline>;
		}).createRenderPipelineAsync = (d: GPURenderPipelineDescriptor) => {
			rasterCallCount++;
			return new Promise<GPURenderPipeline>((resolve, reject) => {
				rasterDeferreds.push({
					resolve,
					reject
				});
				void d;
			});
		};

		const asyncCache = new PipelineCache(devA.gpuDevice);
		// Start compilation A before clear()
		const promiseA = asyncCache.getOrCreateRasterAsync(devA.gpuDevice, rasterDesc);
		assert.equal(rasterCallCount, 1);

		// Clear while A is pending, then start compilation B for the same descriptor
		asyncCache.clear();
		const promiseB = asyncCache.getOrCreateRasterAsync(devA.gpuDevice, rasterDesc);
		assert.equal(rasterCallCount, 2);

		// Resolve A while B is still pending; A must NOT delete B's in-flight tracking or populate the cache
		rasterDeferreds[0]!.resolve({
			label: "pipeline-A",
			getBindGroupLayout: () => ({} as unknown as GPUBindGroupLayout)
		} as unknown as GPURenderPipeline);
		await promiseA;
		assert.equal(asyncCache.rasterCount, 0);

		// Start C while B is still pending; C must join B rather than starting a 3rd native compilation
		const promiseC = asyncCache.getOrCreateRasterAsync(devA.gpuDevice, rasterDesc);
		assert.equal(rasterCallCount, 2);
		assert.equal(promiseB, promiseC);

		// Resolve B; cache count becomes 1 and subsequent lookup returns B's pipeline
		const nativeB = {
			label: "pipeline-B",
			getBindGroupLayout: () => ({} as unknown as GPUBindGroupLayout)
		} as unknown as GPURenderPipeline;
		rasterDeferreds[1]!.resolve(nativeB);
		const [resolvedB, resolvedC] = await Promise.all([promiseB, promiseC]);
		assert.equal(resolvedB, resolvedC);
		assert.equal(resolvedB.native, nativeB);
		assert.equal(asyncCache.rasterCount, 1);
		const cachedAfterB = asyncCache.getOrCreateRaster(devA.gpuDevice, rasterDesc);
		assert.equal(cachedAfterB, resolvedB);

		// Verify compute in-flight isolation when pre-clear compilation A rejects while post-clear B is pending
		let computeCallCount = 0;
		const computeDeferreds: Array<{
			resolve: (p: GPUComputePipeline) => void;
			reject: (err: Error) => void;
		}> = [];
		(devA.gpuDevice as unknown as {
			createComputePipelineAsync: (d: GPUComputePipelineDescriptor) => Promise<GPUComputePipeline>;
		}).createComputePipelineAsync = (d: GPUComputePipelineDescriptor) => {
			computeCallCount++;
			return new Promise<GPUComputePipeline>((resolve, reject) => {
				computeDeferreds.push({ resolve, reject });
				void d;
			});
		};

		const compA = asyncCache.getOrCreateComputeAsync(devA.gpuDevice, computeDesc);
		assert.equal(computeCallCount, 1);
		asyncCache.clear();

		const compB = asyncCache.getOrCreateComputeAsync(devA.gpuDevice, computeDesc);
		assert.equal(computeCallCount, 2);

		computeDeferreds[0]!.reject(new Error("pre-clear failure"));
		await assert.rejects(() => compA, /pre-clear failure/);
		assert.equal(asyncCache.computeCount, 0);

		const compC = asyncCache.getOrCreateComputeAsync(devA.gpuDevice, computeDesc);
		assert.equal(computeCallCount, 2);
		assert.equal(compB, compC);

		const nativeCompB = {
			label: "compute-B",
			getBindGroupLayout: () => ({} as unknown as GPUBindGroupLayout)
		} as unknown as GPUComputePipeline;
		computeDeferreds[1]!.resolve(nativeCompB);
		const resolvedCompB = await compB;
		assert.equal(resolvedCompB.native, nativeCompB);
		assert.equal(asyncCache.computeCount, 1);
		assert.equal(asyncCache.getOrCreateCompute(devA.gpuDevice, computeDesc), resolvedCompB);
	});

	it("caches raw GPUTexture bindings without transient views, shares default views, distinguishes explicit views, and bounds reverse index on LRU eviction", () => {
		const dev = createMockGPUDevice();
		const bindCache = new BindTableCache(dev.gpuDevice);
		const layout = new BindLayout(dev.gpuDevice, [
			{ binding: 0, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } }
		]);

		const texWrapper = Texture.create2D(dev.gpuDevice, {
			width: 16,
			height: 16,
			format: "rgba8unorm"
		});
		const rawTexture = texWrapper.native;

		let createViewCalls = 0;
		const origCreateView = rawTexture.createView.bind(rawTexture);
		rawTexture.createView = (desc?: GPUTextureViewDescriptor): GPUTextureView => {
			createViewCalls++;
			return origCreateView(desc);
		};

		const createdBindGroupDescs: GPUBindGroupDescriptor[] = [];
		const origCreateBindGroup = dev.gpuDevice.createBindGroup.bind(dev.gpuDevice);
		dev.gpuDevice.createBindGroup = (desc: GPUBindGroupDescriptor): GPUBindGroup => {
			createdBindGroupDescs.push(desc);
			return origCreateBindGroup(desc);
		};

		// 1 & 2. Two lookups with raw GPUTexture create default view once and bind group once
		const bt1 = bindCache.getOrCreate(dev.gpuDevice, layout, [{ binding: 0, resource: rawTexture }]);
		const bt2 = bindCache.getOrCreate(dev.gpuDevice, layout, [{ binding: 0, resource: rawTexture }]);
		assert.equal(bt1, bt2);
		assert.equal(createViewCalls, 1);
		assert.equal(createdBindGroupDescs.length, 1);

		// 3. Bound resource in GPUBindGroupDescriptor is the exact default GPUTextureView from resolveTextureView(rawTexture)
		const defaultView = resolveTextureView(rawTexture);
		assert.equal(createViewCalls, 1);
		const firstEntries = Array.from(createdBindGroupDescs[0]!.entries);
		assert.equal(firstEntries[0]!.resource, defaultView);

		// 4. Binding Texture wrapper and rawTexture resolve the same default GPUTextureView and hit the same cached BindTable
		assert.equal(texWrapper.view, defaultView);
		const btWrapper = bindCache.getOrCreate(dev.gpuDevice, layout, [{ binding: 0, resource: texWrapper }]);
		assert.equal(btWrapper, bt1);
		assert.equal(createViewCalls, 1);
		assert.equal(createdBindGroupDescs.length, 1);

		// 5. Two explicit GPUTextureView objects from the same texture produce distinct cached BindTables
		const explicitViewA = texWrapper.createView({ label: "view-A" });
		const explicitViewB = texWrapper.createView({ label: "view-B" });
		assert.notEqual(explicitViewA, explicitViewB);
		const btViewA = bindCache.getOrCreate(dev.gpuDevice, layout, [{ binding: 0, resource: explicitViewA }]);
		const btViewB = bindCache.getOrCreate(dev.gpuDevice, layout, [{ binding: 0, resource: explicitViewB }]);
		assert.notEqual(btViewA, bt1);
		assert.notEqual(btViewB, bt1);
		assert.notEqual(btViewA, btViewB);
		assert.equal(bindCache.size, 3);

		// 6. Evicting rawTexture removes all entries associated with the texture (including its registered views)
		const evictedCount = bindCache.evictResource(rawTexture);
		assert.equal(evictedCount, 3);
		assert.equal(bindCache.size, 0);

		const btAfterEvict = bindCache.getOrCreate(dev.gpuDevice, layout, [{ binding: 0, resource: rawTexture }]);
		assert.notEqual(btAfterEvict, bt1);
		assert.equal(bindCache.size, 1);

		// 7. Small LRU capacity (maxEntries: 4) cycling 64 distinct layouts with one shared texture keeps reverse index bounded
		const lruCache = new BindTableCache(dev.gpuDevice, { maxEntries: 4 });
		for (let i = 0; i < 64; i++) {
			const distinctLayout = new BindLayout(
				dev.gpuDevice,
				[{ binding: 0, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } }],
				`layout-${i}`
			);
			lruCache.getOrCreate(dev.gpuDevice, distinctLayout, [{ binding: 0, resource: texWrapper }]);
			assert.ok(lruCache.size <= 4);
		}
		assert.equal(lruCache.size, 4);
		const lruEvicted = lruCache.evictResource(texWrapper);
		assert.equal(lruEvicted, 4);
		assert.equal(lruCache.size, 0);
		assert.equal(lruCache.evictResource(texWrapper), 0);
	});
});

describe("awgpu 7B - Buffer Uploads, Readback Cleanup, StreamSet Validation, and Slice Binding", () => {
	it("normalizes typed array subviews in Buffer.write, rejects unaligned writes without corrupting adjacent bytes, and supports writePadded", () => {
		const dev = createMockGPUDevice();
		const initial = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
		const buf = Buffer.create(dev.gpuDevice, {
			size: 16,
			usage: 0x0008 | 0x0004,
			initialData: initial
		});
		const backing = dev.buffers[0]!.bytes;
		assert.deepEqual(Array.from(backing), Array.from(initial));

		// Subview with non-zero byteOffset into a larger ArrayBuffer
		const backingFloats = new Float32Array([100, 200, 300, 400]);
		const subview = backingFloats.subarray(1, 3); // 2 floats = 8 bytes at byteOffset 4
		buf.write(dev.gpuDevice, subview, 4, 0, 8);
		const expectedBytes = new Uint8Array(backingFloats.buffer, 4, 8);
		assert.deepEqual(Array.from(backing.subarray(4, 12)), Array.from(expectedBytes));
		// Bytes [0..3] and [12..15] must remain untouched
		assert.deepEqual(Array.from(backing.subarray(0, 4)), [1, 2, 3, 4]);
		assert.deepEqual(Array.from(backing.subarray(12, 16)), [13, 14, 15, 16]);

		// Odd-length write via Buffer.write must throw RangeError and NOT modify adjacent bytes
		const oddBytes = new Uint8Array([99, 98, 97]);
		assert.throws(() => {
			buf.write(dev.gpuDevice, oddBytes, 0);
		}, RangeError);
		assert.deepEqual(Array.from(backing.subarray(0, 4)), [1, 2, 3, 4]);

		// Explicit writePadded zero-pads the 4-byte tail
		buf.writePadded(dev.gpuDevice, oddBytes, 0);
		assert.deepEqual(Array.from(backing.subarray(0, 4)), [99, 98, 97, 0]);
	});

	it("cleans up owned temporary staging buffer on readback failure while preserving caller-provided staging buffer", async () => {
		const failingDev = createMockGPUDevice({ failMapAsync: true });
		const srcBuf = Buffer.create(failingDev.gpuDevice, {
			size: 16,
			usage: 0x0004 | 0x0008 // COPY_SRC | COPY_DST
		});

		// Owned temporary staging buffer is created at index 1 and must be destroyed on mapAsync failure
		await assert.rejects(() => srcBuf.readback(failingDev.gpuDevice, 0, 16), /Mock mapAsync failure/);
		assert.equal(failingDev.buffers.length, 2);
		assert.equal(failingDev.buffers[1]!.destroyed, true);

		// Caller-provided staging buffer must NOT be destroyed when mapAsync fails
		const callerStaging = Buffer.create(failingDev.gpuDevice, {
			size: 16,
			usage: 0x0001 | 0x0008 // MAP_READ | COPY_DST
		});
		await assert.rejects(
			() => srcBuf.readback(failingDev.gpuDevice, 0, 16, callerStaging),
			/Mock mapAsync failure/
		);
		assert.equal(callerStaging.isDestroyed, false);
		assert.equal(failingDev.buffers[2]!.destroyed, false);
	});

	it("validates StreamSet vertex formats, derives stride from max(offset + size), and binds slice + stream offsets accurately", () => {
		const dev = createMockGPUDevice();
		const vbo = Buffer.vertex(dev.gpuDevice, 128);
		const ibo = Buffer.index(dev.gpuDevice, 128);

		const streams = new StreamSet();
		assert.throws(() => {
			streams.addVertex(0, 0, "invalid-format" as unknown as GPUVertexFormat, vbo);
		}, /Unsupported or malformed GPUVertexFormat/);

		// Interleaved attributes declared out of offset order in slot 0:
		// location 1 at offset 12 (float32x2 = 8 bytes -> end 20)
		// location 0 at offset 0 (float32x3 = 12 bytes -> end 12)
		streams.add({
			slot: 0,
			location: 1,
			format: "float32x2",
			source: vbo.slice(16, 64),
			offset: 12,
			bufferOffset: 8
		});
		streams.add({
			slot: 0,
			location: 0,
			format: "float32x3",
			source: vbo.slice(16, 64),
			offset: 0,
			bufferOffset: 8
		});
		streams.setIndex(ibo.slice(32, 64), "uint32", 4, 6);

		const layouts = streams.deriveVertexLayouts();
		assert.equal(layouts.length, 1);
		assert.equal(layouts[0]!.arrayStride, 20);

		const target = Target.createOffscreen(dev.gpuDevice, { width: 64, height: 64 });
		const pipeline = RasterPipeline.create(dev.gpuDevice, {
			streamSet: streams,
			vertex: { code: "@vertex fn vs_main() -> @builtin(position) vec4f { return vec4f(0.0); }" }
		});

		const passNode = new RenderPassNode(target, "TestPass");
		passNode.addDraw({ pipeline, streamSet: streams });

		// Second batch with same buffer and offset but smaller slice size must rebind vertex buffer
		const streams2 = new StreamSet().add({
			slot: 0,
			location: 0,
			format: "float32x3",
			source: vbo.slice(16, 48),
			offset: 0,
			bufferOffset: 8
		});
		streams2.setIndex(ibo.slice(32, 64), "uint32", 4, 3);
		passNode.addDraw({ pipeline, streamSet: streams2 });

		const encoder = dev.gpuDevice.createCommandEncoder();
		passNode.execute(encoder);

		const vboOps = dev.recordedPassOps.filter((op) => op.type === "setVertexBuffer");
		const iboOps = dev.recordedPassOps.filter((op) => op.type === "setIndexBuffer");
		assert.equal(vboOps.length, 2);
		// First batch: slice.offset (16) + bufferOffset (8) = 24; size = 64 - 8 = 56 (NOT affected by attribute offset 12)
		assert.equal(vboOps[0]!.offset, 24);
		assert.equal(vboOps[0]!.size, 56);
		// Second batch: slice.offset (16) + bufferOffset (8) = 24; size = 48 - 8 = 40
		assert.equal(vboOps[1]!.offset, 24);
		assert.equal(vboOps[1]!.size, 40);

		// Index buffer bound once (deduplicated across both draws): slice.offset (32) + index.offset (4) = 36, size = 64 - 4 = 60
		assert.equal(iboOps.length, 1);
		assert.equal(iboOps[0]!.offset, 36);
		assert.equal(iboOps[0]!.size, 60);
	});
});

describe("awgpu 7C & 7D - Texture.write2D Validation and Target Attachment Ownership", () => {
	it("supports tight 2x2 RGBA8 upload, padded row stride + dataOffset, and rejects short buffers or compressed formats", () => {
		const dev = createMockGPUDevice();
		const tex = Texture.create2D(dev.gpuDevice, {
			width: 2,
			height: 2,
			format: "rgba8unorm"
		});

		// 1. Tight 2x2 RGBA8 upload (16 bytes, bytesPerRow = 8)
		const tight16 = new Uint8Array(16).fill(0x7f);
		tex.write2D(dev.gpuDevice, tight16);
		assert.equal(dev.textureWrites.length, 1);
		assert.equal(dev.textureWrites[0]!.dataLayout.bytesPerRow, 8);
		assert.equal(dev.textureWrites[0]!.dataLayout.rowsPerImage, 2);

		// 2. Padded row stride (bytesPerRow = 16) with non-zero dataOffset = 4
		// Required bytes = (2 - 1) * 16 + 8 = 24 bytes after offset 4 -> 28 bytes total
		const paddedBuf = new Uint8Array(28);
		tex.write2D(dev.gpuDevice, paddedBuf, {
			bytesPerRow: 16,
			dataOffset: 4
		});
		assert.equal(dev.textureWrites.length, 2);
		assert.equal(dev.textureWrites[1]!.dataLayout.bytesPerRow, 16);

		// 3. 1 byte short buffer is rejected before calling WebGPU
		assert.throws(() => {
			tex.write2D(dev.gpuDevice, new Uint8Array(27), {
				bytesPerRow: 16,
				dataOffset: 4
			});
		}, RangeError);
		assert.equal(dev.textureWrites.length, 2);

		// 4. Compressed / depth format without explicit bytesPerPixel is rejected
		const compressedTex = Texture.create2D(dev.gpuDevice, {
			width: 4,
			height: 4,
			format: "bc1-rgba-unorm" as GPUTextureFormat
		});
		assert.throws(() => {
			compressedTex.write2D(dev.gpuDevice, new Uint8Array(64));
		}, /unsupported or compressed/i);

		// 5. Invalid MSAA combinations are rejected
		assert.throws(() => {
			Texture.create2D(dev.gpuDevice, {
				width: 64,
				height: 64,
				format: "rgba8unorm",
				sampleCount: 4,
				mipLevelCount: 2
			});
		}, /mipLevelCount/i);
	});

	it("preserves depthClearValue = 0.0, increments Target.generation on resize, and never destroys borrowed textures", () => {
		const dev = createMockGPUDevice();

		// Offscreen target with reversed-Z depthClearValue = 0.0
		const offscreen = Target.createOffscreen(dev.gpuDevice, {
			width: 128,
			height: 128,
			colorFormats: ["rgba8unorm"],
			depthFormat: "depth32float",
			depthClearValue: 0.0
		});
		const ownedColor0 = offscreen.colorTextures[0]!;
		const desc0 = offscreen.getDescriptor();
		assert.equal(desc0.depthStencilAttachment?.depthClearValue, 0.0);

		// Attach a borrowed external texture to slot 1
		const borrowedTex = Texture.create2D(dev.gpuDevice, {
			width: 128,
			height: 128,
			format: "rgba8unorm"
		});
		offscreen.setColorTarget(1, { target: borrowedTex }, { owned: false });

		const genBeforeResize = offscreen.generation;
		const retired: Texture[] = [];
		offscreen.resize(dev.gpuDevice, 256, 256, { retiredOut: retired });
		assert.ok(offscreen.generation > genBeforeResize);
		// With retiredOut supplied, the replaced owned color texture is collected in retired[] instead of immediately destroyed
		assert.equal(retired.includes(ownedColor0), true);
		assert.equal(ownedColor0.isDestroyed, false);

		// Destroying the target destroys its current owned textures, but NEVER destroys borrowedTex
		const currentOwnedColor0 = offscreen.colorTextures[0]!;
		offscreen.destroy();
		assert.equal(currentOwnedColor0.isDestroyed, true);
		assert.equal(borrowedTex.isDestroyed, false);
	});
});

it("rejects attachment changes after disposal before taking ownership", () => {
	const { gpuDevice } = createMockGPUDevice();
	const target = new Target("disposed", 1, 1, { colorTargets: [{ target: null }] });
	const texture = Texture.create2D(gpuDevice, { width: 1, height: 1, format: "rgba8unorm" });
	target.destroy();
	const generation = target.generation;
	assert.throws(() => target.setColorTarget(0, { target: texture }, { owned: true }), /destroyed/i);
	assert.throws(() => target.setResolveTarget(0, texture), /destroyed/i);
	assert.throws(() => target.setDepthTarget({ target: texture }, { owned: true }), /destroyed/i);
	assert.equal(target.generation, generation);
	assert.equal(texture.isDestroyed, false);
	texture.destroy();
});
