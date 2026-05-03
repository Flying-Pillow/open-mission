import { describe, expect, it } from 'vitest';
import { Stage } from './Stage.js';

const stageData = {
    id: 'stage:mission-1/implementation',
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
});
