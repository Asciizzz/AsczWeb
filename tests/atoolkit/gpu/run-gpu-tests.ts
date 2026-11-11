import { checkDevice } from "./check-device.js";

checkDevice().then(
	adapter => process.stdout.write(`[test:atoolkit:gpu] PASS: ${adapter}\n`),
	error => {
		process.stderr.write(`[test:atoolkit:gpu] FAIL: ${error}\n`);
		process.exit(1);
	}
);
