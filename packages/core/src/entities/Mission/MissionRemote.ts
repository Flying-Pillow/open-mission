import { MissionCommands } from './MissionCommands.js';
import type {
	MissionCommandPayload,
	MissionCommandAcknowledgement,
	MissionActionListSnapshot,
	MissionDocumentSnapshot,
	MissionExecuteActionPayload,
	MissionIdentityPayload,
	MissionListActionsPayload,
	MissionReadDocumentPayload,
	MissionReadProjectionPayload,
	MissionReadWorktreePayload,
	MissionProjectionSnapshot,
	MissionSnapshot,
	MissionSessionCommandPayload,
	MissionTaskCommandPayload,
	MissionWorktreeSnapshot,
	MissionWriteDocumentPayload
} from '../../schemas/Mission.js';

export class MissionRemote {
	public static async read(input: MissionIdentityPayload, context: { surfacePath: string }): Promise<MissionSnapshot> {
		return MissionCommands.read(input, context);
	}

	public static async readProjection(
		input: MissionReadProjectionPayload,
		context: { surfacePath: string }
	): Promise<MissionProjectionSnapshot> {
		return MissionCommands.readProjection(input, context);
	}

	public static async listActions(
		input: MissionListActionsPayload,
		context: { surfacePath: string }
	): Promise<MissionActionListSnapshot> {
		return MissionCommands.listActions(input, context);
	}

	public static async readDocument(
		input: MissionReadDocumentPayload,
		context: { surfacePath: string }
	): Promise<MissionDocumentSnapshot> {
		return MissionCommands.readDocument(input, context);
	}

	public static async readWorktree(
		input: MissionReadWorktreePayload,
		context: { surfacePath: string }
	): Promise<MissionWorktreeSnapshot> {
		return MissionCommands.readWorktree(input, context);
	}

	public static async command(
		input: MissionCommandPayload,
		context: { surfacePath: string }
	): Promise<MissionCommandAcknowledgement> {
		return MissionCommands.command(input, context);
	}

	public static async taskCommand(
		input: MissionTaskCommandPayload,
		context: { surfacePath: string }
	): Promise<MissionCommandAcknowledgement> {
		return MissionCommands.taskCommand(input, context);
	}

	public static async sessionCommand(
		input: MissionSessionCommandPayload,
		context: { surfacePath: string }
	): Promise<MissionCommandAcknowledgement> {
		return MissionCommands.sessionCommand(input, context);
	}

	public static async executeAction(
		input: MissionExecuteActionPayload,
		context: { surfacePath: string }
	): Promise<MissionCommandAcknowledgement> {
		return MissionCommands.executeAction(input, context);
	}

	public static async writeDocument(
		input: MissionWriteDocumentPayload,
		context: { surfacePath: string }
	): Promise<MissionDocumentSnapshot> {
		return MissionCommands.writeDocument(input, context);
	}
}
