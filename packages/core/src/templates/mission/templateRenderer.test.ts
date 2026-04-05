import { describe, expect, it } from 'vitest';
import { TemplateRenderError, renderTemplate } from './templateRenderer.js';

describe('templateRenderer', () => {
    it('renders interpolation-only placeholders from the provided context', () => {
        expect(
            renderTemplate('Hello {{mission.title}} on {{mission.branchRef}}.', {
                mission: {
                    title: 'Mission',
                    branchRef: 'mission/1-test'
                }
            })
        ).toBe('Hello Mission on mission/1-test.');
    });

    it('rejects missing values', () => {
        expect(() => renderTemplate('Hello {{mission.title}} {{mission.missing}}', {
            mission: {
                title: 'Mission'
            }
        })).toThrow(TemplateRenderError);
    });

    it('rejects blocked prototype traversal paths', () => {
        expect(() => renderTemplate('{{mission.__proto__}}', {
            mission: {
                title: 'Mission'
            }
        })).toThrow(TemplateRenderError);
    });

    it('rejects malformed placeholders', () => {
        expect(() => renderTemplate('{{ mission.title ', {
            mission: {
                title: 'Mission'
            }
        })).toThrow(TemplateRenderError);
    });

    it('rejects non-primitive placeholder values', () => {
        expect(() => renderTemplate('{{mission}}', {
            mission: {
                title: 'Mission'
            }
        })).toThrow(TemplateRenderError);
    });
});
