import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	Device,
	Buffer,
	Texture,
	Target,
	PassGraph
} from "../../Atoolkit/awgpu/index.ts";

function createGraphMockDevice() {
	const rawDevice = {
		queue: {
			submit() {}
		},
		createBuffer(desc: GPUBufferDescriptor): GPUBuffer {
			return {
				label: desc.label ?? "",
				size: desc.size,
				usage: desc.usage,
				destroy() {}
			} as unknown as GPUBuffer;
		},
		createTexture(desc: GPUTextureDescriptor): GPUTexture {
			const sz = desc.size as { width: number; height: number; depthOrArrayLayers?: number };
			return {
				label: desc.label ?? "",
				width: sz.width,
				height: sz.height,
				depthOrArrayLayers: sz.depthOrArrayLayers ?? 1,
				mipLevelCount: desc.mipLevelCount ?? 1,
				sampleCount: desc.sampleCount ?? 1,
				dimension: desc.dimension ?? "2d",
				format: desc.format,
				usage: desc.usage,
				createView(viewDesc?: GPUTextureViewDescriptor): GPUTextureView {
					return { label: viewDesc?.label ?? "view" } as unknown as GPUTextureView;
				},
				destroy() {}
			} as unknown as GPUTexture;
		}
	};

	const gpuDevice = rawDevice as unknown as GPUDevice;
	const wrappedDevice = Device.fromNative(gpuDevice);
	wrappedDevice.canvas = { width: 640, height: 480 } as unknown as HTMLCanvasElement;

	return { gpuDevice, wrappedDevice };
}

describe("awgpu 7E - PassGraph Hazard Ordering, Culling, Aliasing, and Cache Invalidation", () => {
	it("1. orders RAW (write A -> read A) so writer executes before reader", () => {
		const { gpuDevice } = createGraphMockDevice();
		const resA = Buffer.storage(gpuDevice, 64);

		const graph = new PassGraph();
		const writer = graph.addComputePass("Writer").write(resA);
		const reader = graph.addComputePass("Reader").read(resA).sideEffect(true);

		const seq = graph.compile({ cullDeadPasses: true });
		assert.deepEqual(
			seq.passes.map((n) => n.label),
			[writer.node.label, reader.node.label]
		);
	});

	it("2. orders WAR on imported resource (read A -> write A) so reader executes before writer", () => {
		const { gpuDevice } = createGraphMockDevice();
		const importedA = Buffer.storage(gpuDevice, 64);

		const graph = new PassGraph();
		const reader = graph.addComputePass("ReadImportedA").read(importedA);
		const writer = graph.addComputePass("OverwriteA").write(importedA).sideEffect(true);

		const seq = graph.compile();
		assert.deepEqual(
			seq.passes.map((n) => n.label),
			[reader.node.label, writer.node.label]
		);
	});

	it("3. orders WAW (write A -> write A -> read A) sequentially", () => {
		const { gpuDevice } = createGraphMockDevice();
		const resA = Buffer.storage(gpuDevice, 64);

		const graph = new PassGraph();
		const w1 = graph.addComputePass("Write1").write(resA);
		const w2 = graph.addComputePass("Write2").write(resA);
		const r = graph.addComputePass("ReadFinal").read(resA).sideEffect(true);

		const seq = graph.compile({ cullDeadPasses: true });
		assert.deepEqual(
			seq.passes.map((n) => n.label),
			[w1.node.label, w2.node.label, r.node.label]
		);
	});

	it("4. does not add a false hazard edge between two concurrent readers (read A + read A)", () => {
		const { gpuDevice } = createGraphMockDevice();
		const resA = Buffer.storage(gpuDevice, 64);

		const graph = new PassGraph();
		const r1 = graph.addComputePass("Reader1").read(resA);
		const r2 = graph.addComputePass("Reader2").read(resA);
		// Explicit edge r2 -> r1 must not cycle because read A + read A adds no r1 -> r2 edge
		graph.addDependency(r2, r1);

		const seq = graph.compile();
		assert.deepEqual(
			seq.passes.map((n) => n.label),
			["Reader2", "Reader1"]
		);
	});

	it("5. invalidates cached compilation when sideEffect(false -> true) changes on an existing pass", () => {
		const { gpuDevice } = createGraphMockDevice();
		const resA = Buffer.storage(gpuDevice, 64);

		const graph = new PassGraph();
		const p1 = graph.addComputePass("Producer").write(resA);
		const p2 = graph.addComputePass("Consumer").read(resA).sideEffect(false);

		assert.deepEqual(
			graph.compile({ cullDeadPasses: true }).passes.map((n) => n.label),
			[]
		);

		p2.sideEffect(true);
		assert.deepEqual(
			graph.compile({ cullDeadPasses: true }).passes.map((n) => n.label),
			[p1.node.label, p2.node.label]
		);
	});

	it("6. caches and returns distinct plans for cullDeadPasses: false -> true -> false on the same graph", () => {
		const { gpuDevice } = createGraphMockDevice();
		const liveRes = Buffer.storage(gpuDevice, 64);
		const deadRes = Buffer.storage(gpuDevice, 64);

		const graph = new PassGraph();
		graph.addComputePass("DeadPass").write(deadRes);
		graph.addComputePass("LivePass").write(liveRes).sideEffect(true);

		const uncull1 = graph.compile({ cullDeadPasses: false });
		assert.deepEqual(
			uncull1.passes.map((n) => n.label),
			["DeadPass", "LivePass"]
		);

		const culled = graph.compile({ cullDeadPasses: true });
		assert.deepEqual(
			culled.passes.map((n) => n.label),
			["LivePass"]
		);

		const uncull2 = graph.compile({ cullDeadPasses: false });
		assert.deepEqual(
			uncull2.passes.map((n) => n.label),
			["DeadPass", "LivePass"]
		);
	});

	it("7. throws on explicit dependency cycles even when cullDeadPasses is true", () => {
		const graph = new PassGraph();
		const a = graph.addComputePass("A");
		const b = graph.addComputePass("B");
		a.dependsOn(b);
		b.dependsOn(a);

		assert.throws(() => graph.compile({ cullDeadPasses: false }), /cycle/i);
		assert.throws(() => graph.compile({ cullDeadPasses: true }), /cycle/i);
	});

	it("8. detects hazards across two distinct GPUTextureViews created from the same Texture", () => {
		const { gpuDevice } = createGraphMockDevice();
		const tex = Texture.create2D(gpuDevice, {
			width: 64,
			height: 64,
			format: "rgba8unorm",
			mipLevelCount: 2
		});
		const viewMip0 = tex.createView({ baseMipLevel: 0, mipLevelCount: 1 });
		const viewMip1 = tex.createView({ baseMipLevel: 1, mipLevelCount: 1 });

		const graph = new PassGraph();
		const writer = graph.addComputePass("WriteView0").write(viewMip0);
		const reader = graph.addComputePass("ReadView1").read(viewMip1).sideEffect(true);

		// Even though viewMip0 !== viewMip1, both resolve to `tex` so WriteView0 is kept alive by ReadView1
		const seq = graph.compile({ cullDeadPasses: true });
		assert.deepEqual(
			seq.passes.map((n) => n.label),
			[writer.node.label, reader.node.label]
		);
	});

	it("9. re-evaluates target attachments when target.resize() increments target generation", () => {
		const { gpuDevice } = createGraphMockDevice();
		const offscreen = Target.createOffscreen(gpuDevice, {
			width: 64,
			height: 64,
			colorFormats: ["rgba8unorm"]
		});

		const graph = new PassGraph();
		const renderPass = graph.addRenderPass(offscreen, "RenderToOffscreen");
		const reader = graph.addComputePass("SampleOffscreen").read(offscreen.colorTextures[0]!).sideEffect(true);

		assert.deepEqual(
			graph.compile({ cullDeadPasses: true }).passes.map((n) => n.label),
			[renderPass.node.label, reader.node.label]
		);

		// Resize replaces offscreen.colorTextures[0] with a new Texture instance;
		// Because `reader` still reads the old texture, `RenderToOffscreen` no longer feeds `reader`!
		offscreen.resize(gpuDevice, 128, 128);
		assert.deepEqual(
			graph.compile({ cullDeadPasses: true }).passes.map((n) => n.label),
			[reader.node.label]
		);
	});

	it("10. treats an MSAA screen pass with resolveTarget === null as a live presentation root under culling", () => {
		const { wrappedDevice } = createGraphMockDevice();
		const msaaScreen = Target.createScreen(wrappedDevice, {
			sampleCount: 4,
			label: "MSAAScreen"
		});
		// Verify colorTargets[0].target is the MSAA Texture while resolveTarget is null (swapchain)
		assert.notEqual(msaaScreen.colorTargets[0]!.target, null);
		assert.equal(msaaScreen.colorTargets[0]!.resolveTarget, null);

		const graph = new PassGraph();
		const screenPass = graph.addRenderPass(msaaScreen, "MSAAPresentPass");
		assert.equal(screenPass.hasSideEffect, true);

		const seq = graph.compile({ cullDeadPasses: true });
		assert.deepEqual(
			seq.passes.map((n) => n.label),
			[screenPass.node.label]
		);
	});

	it("11. returns an empty PassSequence when cullDeadPasses is true and no roots exist", () => {
		const { gpuDevice } = createGraphMockDevice();
		const buf = Buffer.storage(gpuDevice, 64);

		const graph = new PassGraph();
		graph.addComputePass("UnrootedWrite").write(buf);
		graph.addComputePass("UnrootedRead").read(buf);

		const seq = graph.compile({ cullDeadPasses: true });
		assert.equal(seq.passes.length, 0);
	});

	it("12. returns defensive snapshots for nodes, reads, writes, dependencies, and sequence.passes", () => {
		const { gpuDevice } = createGraphMockDevice();
		const buf = Buffer.storage(gpuDevice, 64);

		const graph = new PassGraph();
		const p1 = graph.addComputePass("P1").write(buf);
		const p2 = graph.addComputePass("P2").read(buf).sideEffect(true);
		p2.dependsOn(p1);

		(graph.nodes as unknown as unknown[]).length = 0;
		assert.equal(graph.nodes.length, 2);

		(p1.writes as Set<unknown>).clear();
		assert.equal(p1.writes.size, 1);

		(p2.reads as Set<unknown>).clear();
		assert.equal(p2.reads.size, 1);

		(p2.dependencies as Set<unknown>).clear();
		assert.equal(p2.dependencies.size, 1);

		const seq1 = graph.compile();
		(seq1.passes as unknown as unknown[]).length = 0;

		const seq2 = graph.compile();
		assert.equal(seq2.passes.length, 2);
	});

	it("13. updates culling and hazard scheduling across setColorTarget, setResolveTarget, and setDepthTarget", () => {
		const { gpuDevice } = createGraphMockDevice();
		const offscreenTex = Texture.create2D(gpuDevice, {
			width: 64,
			height: 64,
			format: "rgba8unorm"
		});

		// 1. Offscreen -> presentation (null) -> offscreen via setColorTarget
		const target = new Target("DynamicTarget", 64, 64, {
			colorTargets: [{ target: offscreenTex, loadOp: "clear", storeOp: "store" }]
		});
		const graph = new PassGraph();
		const renderPass = graph.addRenderPass(target, "DynamicRenderPass");

		assert.deepEqual(
			graph.compile({ cullDeadPasses: true }).passes.map((n) => n.label),
			[]
		);

		target.setColorTarget(0, { target: null, loadOp: "clear", storeOp: "store" });
		assert.equal(renderPass.hasSideEffect, true);
		assert.deepEqual(
			graph.compile({ cullDeadPasses: true }).passes.map((n) => n.label),
			["DynamicRenderPass"]
		);

		target.setColorTarget(0, { target: offscreenTex, loadOp: "clear", storeOp: "store" });
		assert.equal(renderPass.hasSideEffect, false);
		assert.deepEqual(
			graph.compile({ cullDeadPasses: true }).passes.map((n) => n.label),
			[]
		);

		// 2a. setResolveTarget: connecting and disconnecting MSAA resolve texture to a downstream compute reader
		const msaaTex = Texture.create2D(gpuDevice, {
			width: 64,
			height: 64,
			format: "rgba8unorm",
			sampleCount: 4
		});
		const resolveTex = Texture.create2D(gpuDevice, {
			width: 64,
			height: 64,
			format: "rgba8unorm"
		});
		const msaaTarget = new Target("MsaaOffscreen", 64, 64, {
			sampleCount: 4,
			colorTargets: [{ target: msaaTex, loadOp: "clear", storeOp: "discard" }]
		});

		const resolveGraph = new PassGraph();
		const msaaPass = resolveGraph.addRenderPass(msaaTarget, "MsaaPass");
		const postPass = resolveGraph.addComputePass("ReadResolved").read(resolveTex).sideEffect(true);

		// Before setResolveTarget: MsaaPass does not write resolveTex, so MsaaPass is culled
		assert.deepEqual(
			resolveGraph.compile({ cullDeadPasses: true }).passes.map((n) => n.label),
			[postPass.node.label]
		);

		// Attach resolveTex via setResolveTarget: MsaaPass now feeds ReadResolved
		msaaTarget.setResolveTarget(0, resolveTex);
		assert.deepEqual(
			resolveGraph.compile({ cullDeadPasses: true }).passes.map((n) => n.label),
			[msaaPass.node.label, postPass.node.label]
		);

		// Detach resolveTex: MsaaPass is culled again
		msaaTarget.setResolveTarget(0, undefined);
		assert.deepEqual(
			resolveGraph.compile({ cullDeadPasses: true }).passes.map((n) => n.label),
			[postPass.node.label]
		);

		// 2b. setDepthTarget: shared depth prepass -> opaque pass with depthLoadOp: "load"
		const sharedDepth = Texture.createDepth(gpuDevice, {
			width: 64,
			height: 64,
			format: "depth32float"
		});
		const prepassTarget = new Target("DepthPrepassTarget", 64, 64, {
			colorTargets: []
		});
		const mainTarget = new Target("MainTarget", 64, 64, {
			colorTargets: [{ target: null, loadOp: "clear", storeOp: "store" }]
		});

		const depthGraph = new PassGraph();
		const depthPrepass = depthGraph.addRenderPass(prepassTarget, "DepthPrepass");
		const mainPass = depthGraph.addRenderPass(mainTarget, "MainPass");

		// Neither pass touches sharedDepth yet -> DepthPrepass is culled
		assert.deepEqual(
			depthGraph.compile({ cullDeadPasses: true }).passes.map((n) => n.label),
			[mainPass.node.label]
		);

		// Configure DepthPrepass to write sharedDepth and MainPass to load sharedDepth
		prepassTarget.setDepthTarget({
			target: sharedDepth,
			depthLoadOp: "clear",
			depthStoreOp: "store"
		});
		mainTarget.setDepthTarget({
			target: sharedDepth,
			depthLoadOp: "load",
			depthStoreOp: "store"
		});

		assert.deepEqual(
			depthGraph.compile({ cullDeadPasses: true }).passes.map((n) => n.label),
			[depthPrepass.node.label, mainPass.node.label]
		);
	});

	it("14. enforces read-only Target attachment snapshots, freezes clearColor, and retires owned attachments cleanly", () => {
		const { gpuDevice } = createGraphMockDevice();
		const texA = Texture.create2D(gpuDevice, { width: 32, height: 32, format: "rgba8unorm" });
		const texB = Texture.create2D(gpuDevice, { width: 32, height: 32, format: "rgba8unorm" });
		const depthA = Texture.createDepth(gpuDevice, { width: 32, height: 32, format: "depth24plus" });

		const clearColorObj = { r: 0.1, g: 0.2, b: 0.3, a: 1.0 };
		const inputColorDesc = {
			target: texA,
			clearColor: clearColorObj,
			loadOp: "clear" as GPULoadOp,
			storeOp: "store" as GPUStoreOp
		};
		const inputDepthDesc = {
			target: depthA,
			depthClearValue: 1.0,
			depthLoadOp: "clear" as GPULoadOp,
			depthStoreOp: "store" as GPUStoreOp
		};

		const target = new Target("ImmutableSnapshotTarget", 32, 32, {
			colorTargets: [inputColorDesc],
			depthTarget: inputDepthDesc
		});

		// Mutating caller-owned descriptor objects after construction must not affect live target state
		inputColorDesc.target = texB;
		clearColorObj.r = 0.99;
		inputDepthDesc.depthClearValue = 0.25;

		assert.equal(target.colorTargets[0]!.target, texA);
		assert.deepEqual(target.colorTargets[0]!.clearColor, { r: 0.1, g: 0.2, b: 0.3, a: 1.0 });
		assert.equal(target.depthTarget?.depthClearValue, 1.0);

		// Attempting to mutate read-only snapshots directly fails at compile time and throws at runtime
		assert.throws(() => {
			// @ts-expect-error colorTargets is ReadonlyArray<Readonly<ColorTargetDesc>>
			target.colorTargets[0]!.target = texB;
		}, TypeError);

		assert.throws(() => {
			// @ts-expect-error colorTargets is ReadonlyArray
			target.colorTargets.push({ target: texB });
		}, TypeError);

		assert.throws(() => {
			// @ts-expect-error depthTarget is Readonly<DepthTargetDesc>
			target.depthTarget!.depthClearValue = 0.5;
		}, TypeError);

		assert.throws(() => {
			// @ts-expect-error colorTextures is ReadonlyArray<Texture>
			target.colorTextures.push(texB);
		}, TypeError);

		// Sparse index in setColorTarget is rejected before mutating state
		assert.throws(() => {
			target.setColorTarget(5, { target: texB });
		}, RangeError);

		// Replacing an owned attachment retires/destroys it once while never destroying borrowed attachments
		const offscreen = Target.createOffscreen(gpuDevice, {
			width: 32,
			height: 32,
			colorFormats: ["rgba8unorm"],
			depthFormat: "depth24plus"
		});
		const initialOwnedColor = offscreen.colorTextures[0]!;
		const initialOwnedDepth = offscreen.depthTarget!.target as Texture;

		const retiredColor: Texture[] = [];
		offscreen.setColorTarget(0, { target: texB }, { owned: false, retiredOut: retiredColor });
		assert.equal(retiredColor.length, 1);
		assert.equal(retiredColor[0], initialOwnedColor);
		assert.equal(initialOwnedColor.isDestroyed, false);

		// Resize skips borrowed texB while resizing owned depth
		const retiredOnResize: Texture[] = [];
		offscreen.resize(gpuDevice, 64, 64, { retiredOut: retiredOnResize });
		assert.equal(texB.isDestroyed, false);
		assert.equal(offscreen.colorTargets[0]!.target, texB);
		assert.equal(retiredOnResize.includes(initialOwnedDepth), true);
	});
});
