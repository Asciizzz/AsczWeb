import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (
			specifier.startsWith(".") &&
			specifier.endsWith(".js") &&
			context.parentURL &&
			context.parentURL.endsWith(".ts")
		) {
			const tsUrl = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
			if (existsSync(fileURLToPath(tsUrl))) {
				return nextResolve(tsUrl.href, context);
			}
		}
		return nextResolve(specifier, context);
	}
});
