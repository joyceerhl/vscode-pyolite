import * as vscode from 'vscode';
import { EXTENSION_ID, JUPYTER_NOTEBOOK_VIEWTYPE, PYTHON_EXTENSION_ID } from './constants';
import { createNotebookCellOutput } from './utils';

const disposables: vscode.Disposable[] = [];
let kernelStatusBar: vscode.StatusBarItem;

enum KernelStatus {
  NotStarted = 'Not Started',
  Starting = 'Starting...',
  Busy = 'Busy',
  Idle = 'Idle',
  Disposed = 'Disposed'
}

export async function activate(context: vscode.ExtensionContext) {
  // Use renderer preloads to load Pyodide scripts. Ideally we would load these in a dedicated web worker
  const scripts = ['loadPyodide.js', 'pyodideComm.js'].map((filename) => new vscode.NotebookRendererScript(vscode.Uri.joinPath(context.extensionUri, 'scripts', filename)));

  // Tell VS Code about our kernel. For now this is global
  const controller =
    vscode.notebooks.createNotebookController(EXTENSION_ID, JUPYTER_NOTEBOOK_VIEWTYPE, 'Pyolite', handleExecute, scripts);
  controller.detail = 'Run Python code without a Python interpreter installed';
  controller.supportedLanguages = ['python'];

  // If the Python extension is not available, it's safe to say there aren't any
  // Python kernels. Register ourselves as the preferred kernel so we get selected
  // for the opened notebook
  disposables.push(vscode.workspace.onDidOpenNotebookDocument((document) => {
    if (document.cellAt(0).document.languageId === 'python'
      && vscode.extensions.getExtension(PYTHON_EXTENSION_ID) === undefined
    ) {
      controller.updateNotebookAffinity(document, vscode.NotebookControllerAffinity.Preferred);
    }
  }));

  // Create a status bar item to report kernel status
  kernelStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
  kernelStatusBar.text = `Pyolite: ${KernelStatus.NotStarted}`;

  // Ensure we only show our status bar item when the Pyolite kernel is selected
  disposables.push(controller.onDidChangeSelectedNotebooks(({ notebook, selected }) =>
    selected ? kernelStatusBar.show() : kernelStatusBar.hide()
  ));
}

export function deactivate() {
  disposables.map((disposable) => disposable.dispose());
}

async function ensureKernel(controller: vscode.NotebookController) {
  const kernelResolvedPromise = new Promise<void>((resolve, reject) => {
    // Transition status bar to starting
    kernelStatusBar.text = `Pyolite: ${KernelStatus.Starting}`;

    // As soon as we get some messages from the renderer preload script,
    // we're good to go
    const disposable = controller.onDidReceiveMessage(({ editor, message }) => {
      switch (message) {
        case 'dead':
          kernelStatusBar.text = `Pyolite: ${KernelStatus.Disposed}`;
          disposable.dispose();
          reject('Pyolite kernel failed to start.');
        default:
          kernelStatusBar.text = `Pyolite: ${KernelStatus.Idle}`;
          disposable.dispose();
          resolve();
      }
    });

    // Ping the kernel just to confirm it's started
    controller.postMessage({ command: 'heartbeat' });
  });

  return await kernelResolvedPromise;
}

async function handleExecute(
  this: vscode.NotebookController,
  cells: vscode.NotebookCell[],
  notebook: vscode.NotebookDocument,
  controller: vscode.NotebookController
): Promise<void> {
  // Process our cell execute requests one by one
  for (let cell of cells) {
    // Create our cell execution task to transition the cell to the busy state
    const task = controller.createNotebookCellExecution(cell);
    let success = false;
    let result;

    // Tell VS Code we started executing this cell
    task.start(Date.now());

    // Send our code execution request to the kernel
    try {
      // Don't send execute requests until the kernel is ready
      await ensureKernel(controller);

      // If the kernel successfully started, send our execute request
      kernelStatusBar.text = `Pyolite: ${KernelStatus.Busy}`;
      result = await executeCell(controller, cell);
      success = true;
      kernelStatusBar.text = `Pyolite: ${KernelStatus.Idle}`;
    } catch (e) {
      result = e;
    }

    // Update notebook cell output with result from kernel execution
    await updateCellOutput(cell, task, result);

    // Now tell VS Code we're done with this cell
    task.end(success, Date.now());
  }
}

async function updateCellOutput(
  cell: vscode.NotebookCell,
  task: vscode.NotebookCellExecution,
  result: any
) {
  // Remove any outputs left over from previous execution
  await task.clearOutput(cell);

  if (result !== undefined) {
    const data = result.hasOwnProperty('data')
      ? result.data
      : { 'text/plain': result };
    const output = createNotebookCellOutput(data);
    await task.replaceOutput(output, cell);
  }
}

function hookupHandlers(controller: vscode.NotebookController, successCallback: (v: any) => void, errorCallback: (v: any) => void) {
  const disposable = controller.onDidReceiveMessage(({ editor, message }) => {
    switch (message?.command) {
      case 'alive':
        break;
      case 'success':
      case 'display':
        successCallback(message.args);
      case 'error':
        errorCallback(message?.args);
      case 'dead':
        kernelStatusBar.text = `Pyolite: ${KernelStatus.Disposed}`;
        errorCallback('Pyolite kernel failed to start.');
      default:
        errorCallback('Unhandled message.');
    }
  });
  disposables.push(disposable);
}

async function executeCell(controller: vscode.NotebookController, cell: vscode.NotebookCell) {
  const resultPromise = new Promise(async (resolve, reject) => {
    hookupHandlers(controller, resolve, reject);

    try {
      const message = { command: 'runPythonAsync', args: cell.document.getText() };
      controller.postMessage(message);
    } catch (e) {
      reject(e);
    }
  });
  return await resultPromise;
}
