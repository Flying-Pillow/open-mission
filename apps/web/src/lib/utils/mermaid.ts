let mermaidModulePromise: Promise<typeof import("mermaid").default> | undefined;

function getMermaidTheme(): "dark" | "default" {
	if (typeof document === "undefined") {
		return "default";
	}

	return document.documentElement.classList.contains("dark")
		? "dark"
		: "default";
}

async function loadMermaid() {
	mermaidModulePromise ??= import("mermaid").then((module) => module.default);
	return mermaidModulePromise;
}

export async function renderMermaidDiagrams(container: HTMLElement): Promise<void> {
	const codeBlocks = Array.from(
		container.querySelectorAll<HTMLElement>(
			"pre > code.language-mermaid, pre > code.lang-mermaid",
		),
	);

	if (codeBlocks.length === 0) {
		return;
	}

	const mermaid = await loadMermaid();
	mermaid.initialize({
		startOnLoad: false,
		theme: getMermaidTheme(),
		securityLevel: "strict",
	});

	const diagramNodes = codeBlocks
		.map((codeBlock, index) => {
			const source = codeBlock.textContent?.trim();
			const preElement = codeBlock.parentElement;

			if (!source || !preElement?.parentElement) {
				return null;
			}

			const diagramElement = document.createElement("div");
			diagramElement.className = "mermaid";
			diagramElement.dataset.mermaidId = `diagram-${index}`;
			diagramElement.textContent = source;
			preElement.replaceWith(diagramElement);

			return diagramElement;
		})
		.filter((node): node is HTMLDivElement => node !== null);

	if (diagramNodes.length === 0) {
		return;
	}

	await mermaid.run({ nodes: diagramNodes });
}