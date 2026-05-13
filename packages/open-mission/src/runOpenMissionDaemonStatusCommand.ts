import { note, outro } from '@clack/prompts';
import { DaemonApi } from '@flying-pillow/open-mission-core/daemon/client/DaemonApi';
import { connectDaemon } from '@flying-pillow/open-mission-core/daemon/client/connectDaemon';
import type { EntryContext } from './entryContext.js';

export async function runOpenMissionDaemonStatusCommand(context: EntryContext): Promise<void> {
	if (
		context.args.includes('--help')
		|| context.args.includes('-h')
		|| context.args.includes('help')
	) {
		process.stdout.write('open-mission daemon:status [--json]\n');
		return;
	}

	const client = await connectDaemon({
		surfacePath: context.workingDirectory
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
			'Open Mission daemon status'
		);
		outro('Open Mission daemon status loaded.');
	} finally {
		client.dispose();
	}
}