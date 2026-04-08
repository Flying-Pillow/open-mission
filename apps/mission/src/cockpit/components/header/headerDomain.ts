type HeaderTabLike = {
	id: string;
};

export function pickPreferredHeaderTabId<TTab extends HeaderTabLike>(
	tabs: TTab[],
	current: string | undefined,
	active: string
): string | undefined {
	if (tabs.length === 0) {
		return undefined;
	}
	if (current && tabs.some((tab) => tab.id === current)) {
		return current;
	}
	if (tabs.some((tab) => tab.id === active)) {
		return active;
	}
	return tabs[0]?.id;
}

export function moveHeaderTabSelection<TTab extends HeaderTabLike>(
	tabs: TTab[],
	current: string | undefined,
	delta: number
): string | undefined {
	if (tabs.length === 0) {
		return undefined;
	}
	const currentId = current && tabs.some((tab) => tab.id === current) ? current : tabs[0]?.id;
	const currentIndex = Math.max(0, tabs.findIndex((tab) => tab.id === currentId));
	const nextIndex = Math.max(0, Math.min(tabs.length - 1, currentIndex + delta));
	return tabs[nextIndex]?.id;
}