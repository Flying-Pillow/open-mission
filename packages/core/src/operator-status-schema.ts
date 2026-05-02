import { z } from 'zod';
import {
	MISSION_GATE_INTENTS,
	MISSION_LIFECYCLE_STATES,
	MISSION_STAGE_DERIVED_STATES,
	MISSION_TASK_LIFECYCLE_STATES
} from './types.js';

const nonEmptyStringSchema = z.string().trim().min(1);
const missionTypeSchema = z.enum(['feature', 'fix', 'docs', 'refactor', 'task']);
const missionOperationalModeSchema = z.enum(['setup', 'root', 'mission']);
const taskKindSchema = z.enum(['implementation', 'verification']);
const gateIntentSchema = z.enum(MISSION_GATE_INTENTS);
const missionLifecycleStateSchema = z.enum(MISSION_LIFECYCLE_STATES);
const missionStageDerivedStateSchema = z.enum(MISSION_STAGE_DERIVED_STATES);
const missionTaskLifecycleStateSchema = z.enum(MISSION_TASK_LIFECYCLE_STATES);
const missionAgentLifecycleStateSchema = z.enum([
	'idle',
	'starting',
	'running',
	'awaiting-input',
	'completed',
	'failed',
	'cancelled',
	'terminated'
]);
const missionPauseReasonSchema = z.enum([
	'human-requested',
	'panic',
	'checkpoint',
	'agent-failure',
	'system'
]);
const missionGateStateSchema = z.enum(['blocked', 'passed']);

const missionTaskStateSchema = z.object({
	taskId: nonEmptyStringSchema,
	stage: nonEmptyStringSchema,
	sequence: z.number().int().positive(),
	subject: z.string(),
	instruction: z.string(),
	body: z.string(),
	taskKind: taskKindSchema.optional(),
	pairedTaskId: nonEmptyStringSchema.optional(),
	dependsOn: z.array(nonEmptyStringSchema),
	waitingOn: z.array(nonEmptyStringSchema),
	status: missionTaskLifecycleStateSchema,
	agent: nonEmptyStringSchema,
	retries: z.number().int().nonnegative(),
	fileName: nonEmptyStringSchema,
	filePath: nonEmptyStringSchema,
	relativePath: nonEmptyStringSchema
});

const missionStageStatusSchema = z.object({
	stage: nonEmptyStringSchema,
	folderName: nonEmptyStringSchema,
	status: missionStageDerivedStateSchema,
	taskCount: z.number().int().nonnegative(),
	completedTaskCount: z.number().int().nonnegative(),
	activeTaskIds: z.array(nonEmptyStringSchema),
	readyTaskIds: z.array(nonEmptyStringSchema),
	tasks: z.array(missionTaskStateSchema)
});

const missionSelectionCandidateSchema = z.object({
	missionId: nonEmptyStringSchema,
	title: nonEmptyStringSchema,
	branchRef: nonEmptyStringSchema,
	createdAt: nonEmptyStringSchema,
	issueId: z.number().int().positive().optional()
});

const repositoryCandidateSchema = z.object({
	repositoryId: nonEmptyStringSchema,
	repositoryRootPath: nonEmptyStringSchema,
	label: nonEmptyStringSchema,
	description: z.string(),
	githubRepository: nonEmptyStringSchema.optional()
});

const missionTowerStageRailItemSchema = z.object({
	id: nonEmptyStringSchema,
	label: nonEmptyStringSchema,
	state: missionStageDerivedStateSchema,
	subtitle: nonEmptyStringSchema.optional()
});

const missionTowerTreeNodeSchema = z.object({
	id: nonEmptyStringSchema,
	label: nonEmptyStringSchema,
	kind: z.enum(['mission-artifact', 'stage', 'stage-artifact', 'task', 'task-artifact', 'session']),
	depth: z.number().int().nonnegative(),
	color: nonEmptyStringSchema,
	statusLabel: nonEmptyStringSchema.optional(),
	collapsible: z.boolean(),
	sourcePath: nonEmptyStringSchema.optional(),
	stageId: nonEmptyStringSchema.optional(),
	taskId: nonEmptyStringSchema.optional(),
	sessionId: nonEmptyStringSchema.optional()
});

const missionTowerProjectionSchema = z.object({
	stageRail: z.array(missionTowerStageRailItemSchema),
	treeNodes: z.array(missionTowerTreeNodeSchema)
});

const workflowStageTaskLaunchPolicySchema = z.object({
	defaultAutostart: z.boolean()
});

const workflowStageDefinitionSchema = z.object({
	stageId: nonEmptyStringSchema,
	displayName: nonEmptyStringSchema,
	taskLaunchPolicy: workflowStageTaskLaunchPolicySchema
});

const workflowGeneratedTaskDefinitionSchema = z.object({
	taskId: nonEmptyStringSchema,
	title: nonEmptyStringSchema,
	instruction: z.string(),
	taskKind: taskKindSchema.optional(),
	pairedTaskId: nonEmptyStringSchema.optional(),
	dependsOn: z.array(nonEmptyStringSchema),
	agentRunner: nonEmptyStringSchema.optional()
});

const workflowTaskTemplateSourceSchema = z.object({
	templateId: nonEmptyStringSchema,
	path: nonEmptyStringSchema
});

const workflowTaskGenerationRuleSchema = z.object({
	stageId: nonEmptyStringSchema,
	artifactTasks: z.boolean(),
	templateSources: z.array(workflowTaskTemplateSourceSchema),
	tasks: z.array(workflowGeneratedTaskDefinitionSchema)
});

const workflowGateDefinitionSchema = z.object({
	gateId: nonEmptyStringSchema,
	intent: gateIntentSchema,
	stageId: nonEmptyStringSchema.optional()
});

const missionWorkflowConfigurationSnapshotSchema = z.object({
	createdAt: nonEmptyStringSchema,
	source: z.literal('workflow-definition'),
	workflowVersion: nonEmptyStringSchema,
	workflow: z.object({
		autostart: z.object({
			mission: z.boolean()
		}),
		humanInLoop: z.object({
			enabled: z.boolean(),
			pauseOnMissionStart: z.boolean()
		}),
		panic: z.object({
			terminateSessions: z.boolean(),
			clearLaunchQueue: z.boolean(),
			haltMission: z.boolean()
		}),
		execution: z.object({
			maxParallelTasks: z.number().int().positive(),
			maxParallelSessions: z.number().int().positive()
		}),
		stageOrder: z.array(nonEmptyStringSchema),
		stages: z.record(nonEmptyStringSchema, workflowStageDefinitionSchema),
		taskGeneration: z.array(workflowTaskGenerationRuleSchema),
		gates: z.array(workflowGateDefinitionSchema)
	})
});

const missionTaskArtifactReferenceSchema = z.object({
	path: nonEmptyStringSchema,
	title: nonEmptyStringSchema.optional()
});

const missionTaskReworkRequestSchema = z.object({
	requestId: nonEmptyStringSchema,
	requestedAt: nonEmptyStringSchema,
	actor: z.enum(['human', 'system', 'workflow']),
	reasonCode: nonEmptyStringSchema,
	summary: nonEmptyStringSchema,
	iteration: z.number().int().nonnegative(),
	maxIterations: z.number().int().positive(),
	sourceTaskId: nonEmptyStringSchema.optional(),
	sourceSessionId: nonEmptyStringSchema.optional(),
	launchedAt: nonEmptyStringSchema.optional(),
	resolvedAt: nonEmptyStringSchema.optional(),
	artifactRefs: z.array(missionTaskArtifactReferenceSchema)
});

const missionTaskPendingLaunchContextSchema = z.object({
	source: z.literal('rework'),
	requestId: nonEmptyStringSchema,
	createdAt: nonEmptyStringSchema,
	actor: z.enum(['human', 'system', 'workflow']),
	reasonCode: nonEmptyStringSchema,
	summary: nonEmptyStringSchema,
	sourceTaskId: nonEmptyStringSchema.optional(),
	artifactRefs: z.array(missionTaskArtifactReferenceSchema)
});

const missionTaskRuntimeStateSchema = z.object({
	taskId: nonEmptyStringSchema,
	stageId: nonEmptyStringSchema,
	title: nonEmptyStringSchema,
	instruction: z.string(),
	taskKind: taskKindSchema.optional(),
	pairedTaskId: nonEmptyStringSchema.optional(),
	dependsOn: z.array(nonEmptyStringSchema),
	lifecycle: missionTaskLifecycleStateSchema,
	waitingOnTaskIds: z.array(nonEmptyStringSchema),
	runtime: z.object({
		autostart: z.boolean(),
		maxReworkIterations: z.number().int().positive().optional()
	}),
	agentRunner: nonEmptyStringSchema.optional(),
	retries: z.number().int().nonnegative(),
	reworkIterationCount: z.number().int().nonnegative().optional(),
	reworkRequest: missionTaskReworkRequestSchema.optional(),
	pendingLaunchContext: missionTaskPendingLaunchContextSchema.optional(),
	createdAt: nonEmptyStringSchema,
	updatedAt: nonEmptyStringSchema,
	completedAt: nonEmptyStringSchema.optional(),
	failedAt: nonEmptyStringSchema.optional(),
	cancelledAt: nonEmptyStringSchema.optional()
});

const missionPauseStateSchema = z.object({
	paused: z.boolean(),
	reason: missionPauseReasonSchema.optional(),
	targetType: z.enum(['mission', 'task', 'session']).optional(),
	targetId: nonEmptyStringSchema.optional(),
	requestedAt: nonEmptyStringSchema.optional()
});

const missionPanicStateSchema = z.object({
	active: z.boolean(),
	requestedAt: nonEmptyStringSchema.optional(),
	requestedBy: z.enum(['human', 'system']).optional(),
	terminateSessions: z.boolean(),
	clearLaunchQueue: z.boolean(),
	haltMission: z.boolean()
});

const missionStageRuntimeProjectionSchema = z.object({
	stageId: nonEmptyStringSchema,
	lifecycle: missionStageDerivedStateSchema,
	taskIds: z.array(nonEmptyStringSchema),
	readyTaskIds: z.array(nonEmptyStringSchema),
	queuedTaskIds: z.array(nonEmptyStringSchema),
	runningTaskIds: z.array(nonEmptyStringSchema),
	completedTaskIds: z.array(nonEmptyStringSchema),
	enteredAt: nonEmptyStringSchema.optional(),
	completedAt: nonEmptyStringSchema.optional()
});

const missionGateProjectionSchema = z.object({
	gateId: nonEmptyStringSchema,
	intent: gateIntentSchema,
	state: missionGateStateSchema,
	stageId: nonEmptyStringSchema.optional(),
	reasons: z.array(z.string()),
	updatedAt: nonEmptyStringSchema
});

const agentSessionRecordSchema = z.object({
	sessionId: nonEmptyStringSchema,
	runnerId: nonEmptyStringSchema,
	transportId: nonEmptyStringSchema.optional(),
	runnerLabel: nonEmptyStringSchema,
	sessionLogPath: nonEmptyStringSchema.optional(),
	terminalSessionName: nonEmptyStringSchema.optional(),
	terminalPaneId: nonEmptyStringSchema.optional(),
	lifecycleState: missionAgentLifecycleStateSchema,
	taskId: nonEmptyStringSchema.optional(),
	assignmentLabel: nonEmptyStringSchema.optional(),
	workingDirectory: nonEmptyStringSchema.optional(),
	currentTurnTitle: nonEmptyStringSchema.optional(),
	scope: z.unknown().optional(),
	telemetry: z.unknown().optional(),
	failureMessage: nonEmptyStringSchema.optional(),
	createdAt: nonEmptyStringSchema,
	lastUpdatedAt: nonEmptyStringSchema
});

const repositoryControlStatusSchema = z.object({
	controlRoot: nonEmptyStringSchema,
	missionDirectory: nonEmptyStringSchema,
	settingsPath: nonEmptyStringSchema,
	worktreesPath: nonEmptyStringSchema,
	currentBranch: nonEmptyStringSchema.optional(),
	settings: z.unknown(),
	isGitRepository: z.boolean(),
	initialized: z.boolean(),
	settingsPresent: z.boolean(),
	trackingProvider: z.literal('github').optional(),
	githubRepository: nonEmptyStringSchema.optional(),
	issuesConfigured: z.boolean(),
	availableMissionCount: z.number().int().nonnegative(),
	problems: z.array(z.string()),
	warnings: z.array(z.string())
});

export const operatorStatusSchema = z.object({
	found: z.boolean(),
	operationalMode: missionOperationalModeSchema.optional(),
	control: repositoryControlStatusSchema.optional(),
	system: z.unknown().optional(),
	missionId: nonEmptyStringSchema.optional(),
	title: nonEmptyStringSchema.optional(),
	issueId: z.number().int().positive().optional(),
	type: missionTypeSchema.optional(),
	stage: nonEmptyStringSchema.optional(),
	branchRef: nonEmptyStringSchema.optional(),
	missionDir: nonEmptyStringSchema.optional(),
	missionRootDir: nonEmptyStringSchema.optional(),
	productFiles: z.record(nonEmptyStringSchema, nonEmptyStringSchema).optional(),
	activeTasks: z.array(missionTaskStateSchema).optional(),
	readyTasks: z.array(missionTaskStateSchema).optional(),
	stages: z.array(missionStageStatusSchema).optional(),
	agentSessions: z.array(agentSessionRecordSchema).optional(),
	tower: missionTowerProjectionSchema.optional(),
	workflow: z.object({
		lifecycle: missionLifecycleStateSchema,
		pause: missionPauseStateSchema,
		panic: missionPanicStateSchema,
		currentStageId: nonEmptyStringSchema.optional(),
		configuration: missionWorkflowConfigurationSnapshotSchema,
		stages: z.array(missionStageRuntimeProjectionSchema),
		tasks: z.array(missionTaskRuntimeStateSchema),
		gates: z.array(missionGateProjectionSchema),
		updatedAt: nonEmptyStringSchema
	}).optional(),
	recommendedAction: nonEmptyStringSchema.optional(),
	availableMissions: z.array(missionSelectionCandidateSchema).optional(),
	availableRepositories: z.array(repositoryCandidateSchema).optional(),
	preparation: z.unknown().optional()
});

export type OperatorStatusSchema = z.infer<typeof operatorStatusSchema>;