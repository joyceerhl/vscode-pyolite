export interface PyProxy {
	length: number;
	type: string;
	get(key: string): unknown;
}

export interface LoadPyodideArgs {
	indexURL: string
}