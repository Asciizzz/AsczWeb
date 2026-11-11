import assert from "node:assert/strict";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../..");
const atoolkitDir = join(repoRoot, "Atoolkit");
const tscBin = join(repoRoot, "node_modules/typescript/bin/tsc");

const REMOVED_DOC_IDENTIFIERS: readonly string[] = [
	"Buffer.createVertex",
	"Buffer.createUniform",
	"Buffer.createStorage",
	"Buffer.createIndex",
	"Buffer.read(",
	"Texture.create(",
	"Texture.create3D",
	"Texture.createCube",
	"copyExternalImage",
	"Sampler.createLinear",
	"Sampler.createNearest",
	"Sampler.createComparison",
	"Device.createHeadless",
	"BindTable.getOrCreate",
	"BindTable.clearCache",
	".addStream(",
	".setIndices(",
	".setSlotStride(",
	"PipelineCache.default",
	"ColorSpace.PerceptualGamma"
];

function extractImportCodeBlocks(markdownPath: string): string[] {
	const text = readFileSync(markdownPath, "utf8");
	const blocks: string[] = [];
	const fenceRegex = /```(?:typescript|ts)\r?\n([\s\S]*?)```/g;
	let match: RegExpExecArray | null;
	while ((match = fenceRegex.exec(text)) !== null) {
		const rawBlock = match[1]!;
		if (!/^\s*import\s+/m.test(rawBlock)) {
			continue;
		}
		blocks.push(rawBlock);
	}
	return blocks;
}

function collectFilesRecursive(dir: string, prefix = ""): string[] {
	const results: string[] = [];
	const entries = readdirSync(dir);
	for (const name of entries) {
		const rel = prefix ? `${prefix}/${name}` : name;
		const full = join(dir, name);
		let children: string[] | null = null;
		try {
			children = readdirSync(full);
		} catch {
			children = null;
		}
		if (children !== null) {
			results.push(...collectFilesRecursive(full, rel));
		} else {
			results.push(rel);
		}
	}
	return results;
}

function main(): void {
	const distDir = join(atoolkitDir, "dist");
	assert.ok(existsSync(distDir), "Atoolkit/dist must exist before running verify-package.ts");

	// 1. Check dist/ for stray test or spec artifacts
	const distFiles = collectFilesRecursive(distDir);
	const testArtifacts = distFiles.filter((f) => /\.(test|spec)\.(js|d\.ts|mjs|cjs)$/.test(f));
	assert.deepEqual(
		testArtifacts,
		[],
		`Found unexpected test artifacts in Atoolkit/dist: ${testArtifacts.join(", ")}`
	);

	const tempDir = mkdtempSync(join(tmpdir(), "atoolkit-pkg-verify-"));
	let tarballPath: string | null = null;

	try {
		// 2. Pack @asciiz/atoolkit via npm pack
		const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
		const packRes = spawnSync(npmCmd, ["pack", "--silent"], {
			cwd: atoolkitDir,
			encoding: "utf8",
			shell: process.platform === "win32"
		});
		if (packRes.status !== 0) {
			throw new Error(`npm pack failed:\n${packRes.stderr || packRes.stdout}`);
		}
		const tarballName = packRes.stdout.trim().split(/\r?\n/).pop()?.trim();
		assert.ok(tarballName && tarballName.endsWith(".tgz"), `Unexpected npm pack output: ${packRes.stdout}`);
		tarballPath = join(atoolkitDir, tarballName);
		assert.ok(existsSync(tarballPath), `Packed tarball not found at ${tarballPath}`);

		// 3. Extract packed tarball into temporary consumer node_modules/@asciiz/atoolkit
		const pkgTargetDir = join(tempDir, "node_modules/@asciiz/atoolkit");
		mkdirSync(pkgTargetDir, { recursive: true });

		const tarRes = spawnSync("tar", ["-xzf", tarballPath, "-C", pkgTargetDir, "--strip-components=1"], {
			encoding: "utf8"
		});
		if (tarRes.status !== 0) {
			throw new Error(`tar extraction failed:\n${tarRes.stderr || tarRes.stdout}`);
		}

		// Verify extracted dist files contain no test files
		const packedDistFiles = collectFilesRecursive(join(pkgTargetDir, "dist"));
		const packedTestArtifacts = packedDistFiles.filter((f) => /\.(test|spec)\./.test(f));
		assert.deepEqual(packedTestArtifacts, []);

		// 4. Write minimal consumer package.json and tsconfig.json with lib: ["ES2022"] only (no DOM, no @webgpu/types)
		writeFileSync(
			join(tempDir, "package.json"),
			JSON.stringify({ name: "atoolkit-consumer-test", private: true, type: "module" }, null, "\t")
		);

		writeFileSync(
			join(tempDir, "tsconfig.json"),
			JSON.stringify(
				{
					compilerOptions: {
						target: "ES2022",
						module: "NodeNext",
						moduleResolution: "NodeNext",
						lib: ["ES2022"],
						types: [],
						strict: true,
						noEmit: true,
						skipLibCheck: false
					},
					include: ["consumer-cpu.ts"]
				},
				null,
				"\t"
			)
		);

		writeFileSync(
			join(tempDir, "consumer-cpu.ts"),
			[
				'import { Vec3, Mat4, Quat } from "@asciiz/atoolkit/alm";',
				'import { EntityPool, ComponentSet, Query } from "@asciiz/atoolkit/aecs";',
				'import { Cadence, ScalarTrack, Spring } from "@asciiz/atoolkit/atempo";',
				'import { Circuit, Chip } from "@asciiz/atoolkit/acircuit";',
				'import { Bus } from "@asciiz/atoolkit/adiag";',
				"",
				"const v = new Vec3(1, 2, 3);",
				"const m = Mat4.identity();",
				"const q = Quat.identity();",
				"const pool = new EntityPool(16);",
				"const e = pool.spawn();",
				"const set = new ComponentSet<number>();",
				"set.set(e, v.x + m[0]! + q.w);",
				"const query = new Query(set);",
				"const cadence = new Cadence();",
				"const track = new ScalarTrack();",
				"const spring = new Spring(0);",
				"const circuit = new Circuit();",
				"const bus = new Bus({ maxHistory: 8 });",
				"export { query, cadence, track, spring, circuit, bus, Chip };",
				""
			].join("\n")
		);

		const tscRes = spawnSync("node", [tscBin, "-p", join(tempDir, "tsconfig.json")], {
			cwd: tempDir,
			encoding: "utf8"
		});
		if (tscRes.status !== 0) {
			throw new Error(
				`Non-WebGPU consumer typecheck (lib: ["ES2022"], types: []) failed:\n${tscRes.stdout}\n${tscRes.stderr}`
			);
		}

		// 5. Verify Node ESM runtime imports of root and all 7 subpath exports
		writeFileSync(
			join(tempDir, "consumer-runtime.mjs"),
			[
				'import * as root from "@asciiz/atoolkit";',
				'import * as alm from "@asciiz/atoolkit/alm";',
				'import * as aecs from "@asciiz/atoolkit/aecs";',
				'import * as atempo from "@asciiz/atoolkit/atempo";',
				'import * as acircuit from "@asciiz/atoolkit/acircuit";',
				'import * as adiag from "@asciiz/atoolkit/adiag";',
				'import * as awgpu from "@asciiz/atoolkit/awgpu";',
				'import * as awasm from "@asciiz/atoolkit/awasm";',
				"",
				"if (!root.Alm || !root.Aecs || !root.Atempo || !root.Acircuit || !root.Adiag || !root.Awgpu || !root.Awasm) {",
				'\tthrow new Error("Root barrel is missing one or more module namespaces.");',
				"}",
				"const v = new alm.Vec3(3, 4, 0);",
				"if (alm.Vec3.len(v) !== 5) throw new Error('alm.Vec3.len failed');",
				"const pool = new aecs.EntityPool(8);",
				"const e = pool.spawn();",
				"if (!pool.isAlive(e)) throw new Error('aecs.EntityPool.isAlive failed');",
				"if (atempo.Cadence.expDecay(10, 20, 5, 0) !== 10) throw new Error('atempo.Cadence.expDecay failed');",
				"const cir = new acircuit.Circuit();",
				"if (cir.topoSort().length !== 0) throw new Error('acircuit.Circuit.topoSort failed');",
				"const bus = new adiag.Bus();",
				'bus.info("VERIFY", { ok: true });',
				"const graph = new awgpu.PassGraph();",
				"if (graph.nodes.length !== 0) throw new Error('awgpu.PassGraph failed');",
				"const mem = new awasm.WasmMemory({ initial: 1 });",
				"if (mem.pageCount !== 1) throw new Error('awasm.WasmMemory failed');",
				""
			].join("\n")
		);

		const nodeRes = spawnSync("node", [join(tempDir, "consumer-runtime.mjs")], {
			cwd: tempDir,
			encoding: "utf8"
		});
		if (nodeRes.status !== 0) {
			throw new Error(
				`Node ESM consumer runtime import check failed:\n${nodeRes.stdout}\n${nodeRes.stderr}`
			);
		}

		// 6. Verify Atoolkit/**/*.md documentation hygiene (no removed method names outside MIGRATION.md)
		const allAtoolkitFiles = collectFilesRecursive(atoolkitDir);
		const mdFiles = allAtoolkitFiles.filter((f) => f.endsWith(".md") && !f.startsWith("dist/"));
		for (const relMd of mdFiles) {
			if (relMd === "MIGRATION.md") continue;
			const mdContent = readFileSync(join(atoolkitDir, relMd), "utf8");
			for (const banned of REMOVED_DOC_IDENTIFIERS) {
				assert.equal(
					mdContent.includes(banned),
					false,
					`Found removed API identifier '${banned}' in Atoolkit/${relMd} (allowed only in Atoolkit/MIGRATION.md)`
				);
			}
		}

		// 7. Extract and typecheck + execute CPU README examples under lib: ["ES2022"], types: []
		const cpuModules = ["alm", "aecs", "atempo", "acircuit", "adiag"] as const;
		const cpuReadmeFiles: string[] = [];
		for (const mod of cpuModules) {
			const readmePath = join(pkgTargetDir, mod, "ReadMe.md");
			const blocks = extractImportCodeBlocks(readmePath);
			assert.ok(blocks.length > 0, `Expected import-bearing TypeScript code blocks in ${mod}/ReadMe.md`);
			for (let i = 0; i < blocks.length; i++) {
				const fileName = `readme-${mod}-${i}.ts`;
				writeFileSync(join(tempDir, fileName), blocks[i]!, "utf8");
				cpuReadmeFiles.push(fileName);
			}
		}

		writeFileSync(
			join(tempDir, "tsconfig-readme-cpu.json"),
			JSON.stringify(
				{
					compilerOptions: {
						target: "ES2022",
						module: "NodeNext",
						moduleResolution: "NodeNext",
						lib: ["ES2022"],
						types: [],
						strict: true,
						noEmit: true,
						skipLibCheck: false
					},
					include: cpuReadmeFiles
				},
				null,
				"\t"
			)
		);

		const tscCpuReadmeRes = spawnSync("node", [tscBin, "-p", join(tempDir, "tsconfig-readme-cpu.json")], {
			cwd: tempDir,
			encoding: "utf8"
		});
		if (tscCpuReadmeRes.status !== 0) {
			throw new Error(
				`CPU README example typecheck (lib: ["ES2022"], types: []) failed:\n${tscCpuReadmeRes.stdout}\n${tscCpuReadmeRes.stderr}`
			);
		}

		// Execute deterministic CPU README examples at runtime against the packed package
		for (const fileName of cpuReadmeFiles) {
			const execRes = spawnSync(
				"node",
				["--experimental-transform-types", join(tempDir, fileName)],
				{ cwd: tempDir, encoding: "utf8" }
			);
			if (execRes.status !== 0) {
				throw new Error(
					`CPU README example execution failed for ${fileName}:\n${execRes.stdout}\n${execRes.stderr}`
				);
			}
		}

		// 8. Extract and typecheck root + awgpu + awasm README examples with @webgpu/types
		const webgpuTypesSrc = join(repoRoot, "node_modules/@webgpu/types");
		const webgpuTypesDst = join(tempDir, "node_modules/@webgpu/types");
		mkdirSync(dirname(webgpuTypesDst), { recursive: true });
		cpSync(webgpuTypesSrc, webgpuTypesDst, { recursive: true });

		const gpuReadmeFiles: string[] = [];
		const rootBlocks = extractImportCodeBlocks(join(pkgTargetDir, "ReadMe.md"));
		assert.ok(rootBlocks.length > 0, "Expected composition example in Atoolkit/ReadMe.md");
		for (let i = 0; i < rootBlocks.length; i++) {
			const fileName = `readme-root-${i}.ts`;
			writeFileSync(join(tempDir, fileName), rootBlocks[i]!, "utf8");
			gpuReadmeFiles.push(fileName);
		}

		for (const mod of ["awgpu", "awasm"] as const) {
			const blocks = extractImportCodeBlocks(join(pkgTargetDir, mod, "ReadMe.md"));
			assert.ok(blocks.length > 0, `Expected usage pattern examples in ${mod}/ReadMe.md`);
			for (let i = 0; i < blocks.length; i++) {
				const fileName = `readme-${mod}-${i}.ts`;
				writeFileSync(join(tempDir, fileName), blocks[i]!, "utf8");
				gpuReadmeFiles.push(fileName);
			}
		}

		writeFileSync(
			join(tempDir, "tsconfig-readme-gpu.json"),
			JSON.stringify(
				{
					compilerOptions: {
						target: "ES2022",
						module: "NodeNext",
						moduleResolution: "NodeNext",
						lib: ["ES2022", "DOM"],
						types: ["@webgpu/types"],
						strict: true,
						noEmit: true,
						skipLibCheck: false
					},
					include: gpuReadmeFiles
				},
				null,
				"\t"
			)
		);

		const tscGpuReadmeRes = spawnSync("node", [tscBin, "-p", join(tempDir, "tsconfig-readme-gpu.json")], {
			cwd: tempDir,
			encoding: "utf8"
		});
		if (tscGpuReadmeRes.status !== 0) {
			throw new Error(
				`GPU/WASM README example typecheck failed:\n${tscGpuReadmeRes.stdout}\n${tscGpuReadmeRes.stderr}`
			);
		}

		// 9. Negative verification: ensure an outdated symbol such as Buffer.createVertex fails typechecking
		writeFileSync(
			join(tempDir, "negative-outdated-example.ts"),
			[
				'import { Device, Buffer } from "@asciiz/atoolkit/awgpu";',
				"declare const gfx: Device;",
				"const bad = Buffer.createVertex(gfx, new Float32Array([1, 2, 3]));",
				"void bad;",
				""
			].join("\n"),
			"utf8"
		);
		writeFileSync(
			join(tempDir, "tsconfig-negative.json"),
			JSON.stringify(
				{
					compilerOptions: {
						target: "ES2022",
						module: "NodeNext",
						moduleResolution: "NodeNext",
						lib: ["ES2022", "DOM"],
						types: ["@webgpu/types"],
						strict: true,
						noEmit: true
					},
					include: ["negative-outdated-example.ts"]
				},
				null,
				"\t"
			)
		);
		const negRes = spawnSync("node", [tscBin, "-p", join(tempDir, "tsconfig-negative.json")], {
			cwd: tempDir,
			encoding: "utf8"
		});
		assert.notEqual(
			negRes.status,
			0,
			"Expected outdated Buffer.createVertex snippet to fail TypeScript verification"
		);
		assert.match(negRes.stdout + negRes.stderr, /createVertex/);

		process.stdout.write("[test:atoolkit:package] PASS: Package tarball, dist hygiene, ES2022 consumer types, all 7 subpath exports, and README code examples verified.\n");
	} finally {
		if (tarballPath && existsSync(tarballPath)) {
			rmSync(tarballPath, { force: true });
		}
		if (existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	}
}

main();
