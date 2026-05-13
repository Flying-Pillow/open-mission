export type MissionFileTreeNode = {
	name: string;
	relativePath: string;
	absolutePath: string;
	kind: "file" | "directory";
	children?: MissionFileTreeNode[];
};

export type MissionFileTreeResponse = {
	rootPath: string;
	fetchedAt: string;
	tree: MissionFileTreeNode[];
};