import type { WithChildren } from "bits-ui";
import type { Snippet } from "svelte";
import type { HTMLAttributes, HTMLButtonAttributes } from "svelte/elements";
import type { WithElementRef } from "$lib/utils.js";

export type TreeViewRootProps = WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement>;

export type TreeViewFolderProps = WithChildren<{
	name: string;
	open?: boolean;
	class?: string;
	style?: string;
	icon?: Snippet<[{ name: string; open: boolean }]>;
	actions?: Snippet;
	checked?: boolean;
	onCheckedChange?: (checked: boolean) => void;
	onclick?: (event: MouseEvent) => void;
	oncontextmenu?: (event: MouseEvent) => void;
	ondragenter?: (event: DragEvent) => void;
	ondragover?: (event: DragEvent) => void;
	ondragleave?: (event: DragEvent) => void;
	ondrop?: (event: DragEvent) => void;
}>;

export type TreeViewFilePropsWithoutHTML = {
	name: string;
	icon?: Snippet<[{ name: string }]>;
};

export type TreeViewFileProps = WithElementRef<HTMLButtonAttributes, HTMLButtonElement> &
	TreeViewFilePropsWithoutHTML;