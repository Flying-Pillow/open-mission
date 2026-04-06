export type ProgressRailItemState = 'done' | 'active' | 'blocked' | 'pending';

export type ProgressRailItem = {
    id: string;
    label: string;
    state: ProgressRailItemState;
    selected: boolean;
    subtitle?: string;
};