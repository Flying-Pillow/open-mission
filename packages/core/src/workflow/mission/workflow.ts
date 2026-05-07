import type { WorkflowDefinition } from '../engine/types.js';

export const DEFAULT_WORKFLOW_VERSION = 'mission-workflow-v1';

export function createDefaultWorkflowSettings(): WorkflowDefinition {
    return {
        autostart: {
            mission: true
        },
        humanInLoop: {
            enabled: true,
            pauseOnMissionStart: false
        },
        execution: {
            maxParallelTasks: 1,
            maxParallelSessions: 1
        },
        stageOrder: ['prd', 'spec', 'implementation', 'audit', 'delivery'],
        stages: {
            prd: {
                stageId: 'prd',
                displayName: 'PRD',
                taskLaunchPolicy: {
                    defaultAutostart: true
                }
            },
            spec: {
                stageId: 'spec',
                displayName: 'Spec',
                taskLaunchPolicy: {
                    defaultAutostart: true
                }
            },
            implementation: {
                stageId: 'implementation',
                displayName: 'Implement',
                taskLaunchPolicy: {
                    defaultAutostart: false
                }
            },
            audit: {
                stageId: 'audit',
                displayName: 'Audit',
                taskLaunchPolicy: {
                    defaultAutostart: true
                }
            },
            delivery: {
                stageId: 'delivery',
                displayName: 'Delivery',
                taskLaunchPolicy: {
                    defaultAutostart: false
                }
            }
        },
        taskGeneration: [
            {
                stageId: 'prd',
                artifactTasks: false,
                templateSources: [{ templateId: 'prd-from-brief', path: 'tasks/PRD/01-prd-from-brief.md' }],
                tasks: []
            },
            {
                stageId: 'spec',
                artifactTasks: false,
                templateSources: [
                    { templateId: 'draft-spec', path: 'tasks/SPEC/01-spec-from-prd.md' },
                    { templateId: 'plan-implementation', path: 'tasks/SPEC/02-plan.md' }
                ],
                tasks: []
            },
            {
                stageId: 'implementation',
                artifactTasks: true,
                templateSources: [],
                tasks: []
            },
            {
                stageId: 'audit',
                artifactTasks: false,
                templateSources: [
                    { templateId: 'debrief', path: 'tasks/AUDIT/01-debrief.md' },
                    { templateId: 'touchdown', path: 'tasks/AUDIT/02-touchdown.md' }
                ],
                tasks: []
            },
            {
                stageId: 'delivery',
                artifactTasks: false,
                templateSources: [],
                tasks: []
            }
        ],
        gates: [
            { gateId: 'implement', intent: 'implement', stageId: 'implementation' },
            { gateId: 'verify', intent: 'verify', stageId: 'implementation' },
            { gateId: 'audit', intent: 'audit', stageId: 'audit' },
            { gateId: 'deliver', intent: 'deliver', stageId: 'delivery' }
        ]
    };
}
