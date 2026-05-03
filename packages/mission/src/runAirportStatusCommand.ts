import { note, outro } from '@clack/prompts';
import { DaemonApi, connectAirportDaemon, resolveAirportDaemonRuntimeMode } from '@flying-pillow/mission-core/node';
import type { EntryContext } from './entryContext.js';

export async function runAirportStatusCommand(context: EntryContext): Promise<void> {
	if (
		context.args.includes('--help')
		|| context.args.includes('-h')
		|| context.args.includes('help')
	) {
		process.stdout.write('mission airport:status [--json]\n');
		return;
	}

	const client = await connectAirportDaemon({
		surfacePath: context.workingDirectory,
		runtimeMode: resolveAirportDaemonRuntimeMode(import.meta.url)
	});

	try {
		const api = new DaemonApi(client);
		const status = await api.system.getStatus();

		if (context.json) {
			process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
			return;
		}

		note(
			[
				`github cli: ${status.github.cliAvailable ? 'available' : 'missing'}`,
				`github auth: ${status.github.authenticated ? 'authenticated' : 'unauthenticated'}`,
				...(status.github.user ? [`github user: ${status.github.user}`] : []),
				...(status.github.email ? [`github email: ${status.github.email}`] : []),
				...(status.github.detail ? [`detail: ${status.github.detail}`] : [])
			].join('\n'),
			'Airport status'
		);
		outro('Mission airport status loaded.');
	} finally {
		client.dispose();
	}
}