import { spawn } from "node:child_process";

const devServerUrl = "http://127.0.0.1:5174";

async function hasReusableDevServer() {
	try {
		const response = await fetch(devServerUrl, {
			headers: {
				accept: "text/html"
			}
		});

		if (!response.ok) {
			return false;
		}

		const body = await response.text();
		return body.includes("favicon.ico") && body.includes("apple-touch-icon");
	} catch {
		return false;
	}
}

function run(command, args) {
	const child = spawn(command, args, { stdio: "inherit" });

	child.on("exit", (code, signal) => {
		if (signal) {
			process.kill(process.pid, signal);
			return;
		}

		process.exit(code ?? 0);
	});

	child.on("error", (error) => {
		throw error;
	});
}

if (await hasReusableDevServer()) {
	console.log(`Reusing existing Airport web dev server at ${devServerUrl}.`);
	process.exit(0);
}

run("bash", [
	"-lc",
	"pnpm --dir ../../.. run dev"
]);
