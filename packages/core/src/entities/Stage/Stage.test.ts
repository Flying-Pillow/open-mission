import { describe, expect, it } from 'vitest';
import { Stage } from './Stage.js';
import { StageInstanceInputSchema, StageStorageSchema } from './StageSchema.js';

const stageData = {
    id: 'stage:mission-1/implementation',
    missionId: 'mission-1',
    stageId: 'implementation',
    lifecycle: 'running',
    isCurrentStage: true,
    artifacts: [],
    tasks: []
};

describe('Stage', () => {
    it('uses canonical Entity identity for id', () => {
        const stage = new Stage(stageData);

        expect(stage.id).toBe('stage:mission-1/implementation');
        expect(stage.stageId).toBe('implementation');
    });

    it('owns Stage entity id construction', () => {
        expect(Stage.createEntityId('mission-1', 'implementation')).toBe('stage:mission-1/implementation');
    });

    it('uses an empty input schema for entity-executed commands', () => {
        expect(StageInstanceInputSchema.parse({})).toEqual({});
        expect(() => StageInstanceInputSchema.parse({ stageId: 'implementation' })).toThrow();
    });

    it('keeps Stage storage leaner than hydrated Stage data', () => {
        expect(StageStorageSchema.parse({
            id: 'stage:mission-1/implementation',
            missionId: 'mission-1',
            stageId: 'implementation',
            lifecycle: 'running',
            isCurrentStage: true
        })).toEqual({
            id: 'stage:mission-1/implementation',
            missionId: 'mission-1',
            stageId: 'implementation',
            lifecycle: 'running',
            isCurrentStage: true
        });
        expect(() => StageStorageSchema.parse(stageData)).toThrow();
    });
});
