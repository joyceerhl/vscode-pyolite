import * as vscode from 'vscode';
import { EXTENSION_ID, JUPYTER_NOTEBOOK_VIEWTYPE, PYTHON_EXTENSION_ID } from './constants';
import { PyoliteKernel } from './kernel/pyoliteKernel';
import { CellExecution } from './cellExecution';

let kernel: PyoliteKernel;
let cellExecution: CellExecution;

export async function activate(context: vscode.ExtensionContext) {
	console.log("Pyodide extension activating...");

	registerNotebookController(context); 

	console.log("Pyodide extension activated.");
}

export function deactivate() {}

function registerNotebookController(context: vscode.ExtensionContext) {
	cellExecution = new CellExecution();
	kernel = new PyoliteKernel({
		id: 'pyolite-kernel',
		name: 'Pyolite',
		// Callback for messages sent from the kernel
		// (which runs in a web worker)
		// back to the VS Code extension host
		sendMessage: (msg) => {
			cellExecution.handleMessage(msg)
		},
	}, context);

	const controller = 
		vscode.notebooks.createNotebookController(
			EXTENSION_ID,
			JUPYTER_NOTEBOOK_VIEWTYPE,
			'Pyolite',
			handleExecute
		);
	controller.detail = 'Run Python code without a Python interpreter installed';

	// Set Pyodide kernel as the preferred kernel for Python notebooks
	vscode.workspace.onDidOpenNotebookDocument((document) => {
		if (document.cellAt(0).document.languageId === 'python' &&
			vscode.extensions.getExtension(PYTHON_EXTENSION_ID) === undefined
		) {
			controller.updateNotebookAffinity(document, vscode.NotebookControllerAffinity.Preferred);
		}
	});
}

async function handleExecute(
	this: vscode.NotebookController,
	cells: vscode.NotebookCell[],
	notebook: vscode.NotebookDocument,
	controller: vscode.NotebookController
): Promise<void> {
	await kernel.ready;
	for (let cell of cells) {
		await cellExecution.execute(controller, kernel, cell);
	}
}
