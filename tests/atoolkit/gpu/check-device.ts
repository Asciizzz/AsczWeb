import { BindTableCache, Buffer, ComputePipeline, Device, PassGraph, Target, Texture } from "../../../Atoolkit/awgpu/index.js";

function expectValues(actual: ArrayLike<number>, expected: readonly number[], label: string): void {
	if (actual.length !== expected.length || expected.some((v, i) => actual[i] !== v)) {
		throw new Error(`${label}: expected ${expected}, received ${Array.from(actual)}`);
	}
}

export async function checkDevice(): Promise<string> {
	if (!globalThis.navigator?.gpu) throw new Error("WebGPU is unavailable in this runtime.");
	const adapter = await navigator.gpu.requestAdapter();
	if (!adapter) throw new Error("No WebGPU adapter available.");
	const gpu = await adapter.requestDevice();
	const device = Device.fromNative(gpu, adapter);
	const resources: { destroy(): void }[] = [];
	gpu.pushErrorScope("validation");
	try {
		const buf = Buffer.create(device, {
			size: 32,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
		});
		resources.push(buf);
		buf.write(device, new Uint32Array([10, 20, 30, 40, 50, 60, 70, 80]).subarray(2, 6));
		buf.writePadded(device, new Uint8Array([0xaa, 0xbb, 0xcc]), 16);
		const initial = await buf.readback(device, 0, 20);
		expectValues(new Uint32Array(initial.buffer, initial.byteOffset, 4), [30, 40, 50, 60], "buffer upload");
		expectValues(initial.subarray(16), [0xaa, 0xbb, 0xcc, 0], "padded upload");

		const pipeline = ComputePipeline.create(device, { compute: {
			entryPoint: "main",
			code: `@group(0) @binding(0) var<storage, read_write> data: array<u32>;
				@compute @workgroup_size(4) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
					data[id.x] *= 2u;
				}`
		} });
		const group = gpu.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [{ binding: 0, resource: { buffer: buf.native, size: 16 } }]
		});
		const graph = new PassGraph();
		graph.addComputePass("double").write(buf).sideEffect().addDispatch({
			pipeline, bindTables: [group], workgroups: [1, 1, 1]
		});
		graph.compile().execute(device);
		const doubled = await buf.readback(device, 0, 16);
		expectValues(new Uint32Array(doubled.buffer, doubled.byteOffset, 4), [60, 80, 100, 120], "compute");

		const tex = Texture.create2D(device, {
			width: 2, height: 2, format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC
		});
		resources.push(tex);
		const pixels = Uint8Array.from({ length: 16 }, (_, i) => 11 * i);
		tex.write2D(device, pixels);
		const layout = gpu.createBindGroupLayout({
			entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, texture: {} }]
		});
		const cache = new BindTableCache(device);
		const bind = (resource: GPUTexture | GPUTextureView) =>
			cache.getOrCreate(device, layout, [{ binding: 0, resource }]);
		const nativeTable = bind(tex.native);
		if (bind(tex.native) !== nativeTable || bind(tex.view) !== nativeTable ||
			bind(tex.createView()) === nativeTable) {
			throw new Error("Texture binding cache returned an unexpected table.");
		}

		const staging = gpu.createBuffer({ size: 264, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		resources.push(staging);
		const encoder = gpu.createCommandEncoder();
		encoder.copyTextureToBuffer({ texture: tex.native }, { buffer: staging, bytesPerRow: 256 }, [2, 2]);
		gpu.queue.submit([encoder.finish()]);
		await staging.mapAsync(GPUMapMode.READ);
		try {
			const bytes = new Uint8Array(staging.getMappedRange());
			expectValues(bytes.subarray(0, 8), Array.from(pixels.subarray(0, 8)), "texture row 0");
			expectValues(bytes.subarray(256, 264), Array.from(pixels.subarray(8)), "texture row 1");
		} finally {
			staging.unmap();
		}

		const target = Target.createOffscreen(device, { width: 4, height: 4, depthFormat: "depth24plus", depthClearValue: 0 });
		resources.push(target);
		target.resize(device, 8, 8);
		expectValues([target.width, target.height], [8, 8], "target resize");
		return [adapter.info.vendor, adapter.info.architecture, adapter.info.description].filter(Boolean).join(" ") || "WebGPU adapter";
	} finally {
		try {
			const error = await gpu.popErrorScope();
			if (error) throw new Error(error.message);
		} finally {
			for (const resource of resources.reverse()) resource.destroy();
			gpu.destroy();
		}
	}
}
