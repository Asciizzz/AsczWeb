import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const browser = process.env.WEBGPU_BROWSER ?? [
	"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
	"C:/Program Files/Google/Chrome/Application/chrome.exe",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/usr/bin/chromium", "/usr/bin/google-chrome"
].find(path => existsSync(path));
if (!browser) throw new Error("Set WEBGPU_BROWSER to a Chromium browser executable.");

const token = randomUUID();
const result = Promise.withResolvers();
const server = createServer(async (req, res) => {
	if (req.method === "POST" && req.url === "/result/" + token) {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		const message = Buffer.concat(chunks).toString();
		res.writeHead(204).end();
		if (message.startsWith("PASS: ")) result.resolve(message);
		else result.reject(new Error(message));
		return;
	}
	const path = req.url === "/" ? "index.html" : req.url?.slice(1);
	if (req.method !== "GET" || !path || (path !== "index.html" && !/^dist\/(?:[\w-]+\/)+[\w-]+\.js$/.test(path))) {
		res.writeHead(404).end();
		return;
	}
	try {
		const data = await readFile(new URL(path, import.meta.url));
		res.writeHead(200, { "Content-Type": path.endsWith(".js") ? "text/javascript" : "text/html" }).end(data);
	} catch {
		res.writeHead(404).end();
	}
});

const profile = await mkdtemp(join(tmpdir(), "atoolkit-webgpu-"));
let child;
let timeout;
try {
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const args = ["--headless", "--no-first-run", "--disable-extensions", "--user-data-dir=" + profile];
	if (process.env.WEBGPU_SOFTWARE === "1") {
		args.push("--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-unsafe-webgpu");
	}
	child = spawn(browser, [...args, `http://127.0.0.1:${server.address().port}/#${token}`], {
		windowsHide: true, stdio: "ignore"
	});
	child.once("error", result.reject);
	child.once("exit", code => result.reject(new Error("Browser exited before reporting a result (" + code + ").")));
	timeout = setTimeout(() => result.reject(new Error("Browser GPU checks timed out.")), 45000);
	console.log(await result.promise);
} finally {
	clearTimeout(timeout);
	server.close();
	server.closeAllConnections();
	if (child?.pid && child.exitCode === null && child.signalCode === null) {
		const exited = once(child, "exit");
		child.kill();
		await exited;
	}
	await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
}
