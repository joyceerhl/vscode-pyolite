import * as vscode from 'vscode';
import { EXTENSION_ID, JUPYTER_NOTEBOOK_VIEWTYPE, PYTHON_EXTENSION_ID } from './constants';
import { createNotebookCellOutput } from './utils';

const disposables: vscode.Disposable[] = [];

export async function activate(context: vscode.ExtensionContext) {
  // Use renderer preloads to load Pyodide scripts
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

  await optIntoNativeNotebooks();
}

export function deactivate() {
  disposables.map((disposable) => disposable.dispose());
}

async function ensureKernel(controller: vscode.NotebookController) {
  const kernelResolvedPromise = new Promise<void>((resolve, reject) => {
    // Reject after 60 seconds so we don't wait forever
    setTimeout(() => {
      reject();
    }, 60_000);

    // As soon as we get some messages from the renderer preload script,
    // we're good to go
    disposables.push(controller.onDidReceiveMessage(() => {
      resolve();
    }));

    // Ping the kernel for good measure
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

    // Don't send execute requests until the kernel is ready.
    // Display progress indicator in status bar while kernel is starting up.
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: 'Starting Pyolite kernel...'
    }, async () => ensureKernel(controller));

    let success = false;
    let result;

    // Tell VS Code we started executing this cell
    task.start(Date.now());

    // Send our code execution request to the kernel
    try {
      result = await executeCell(controller, cell);
      success = true;
    } catch (e) {
      result = e;
    }

    // Update notebook cell output with result from kernel execution
    if (result !== undefined) {
      await updateCellOutput(cell, task, result);
    }

    // Now tell VS Code we're done with this cell
    task.end(success, Date.now());
  }
}

async function updateCellOutput(
  cell: vscode.NotebookCell,
  task: vscode.NotebookCellExecution,
  result: any
) {
  const data = result.hasOwnProperty('data')
    ? result.data
    : { 'text/plain': result };
  const output = createNotebookCellOutput(data);
  await task.replaceOutput(output, cell);
}

async function executeCell(controller: vscode.NotebookController, cell: vscode.NotebookCell) {
  const resultPromise = new Promise(async (resolve, reject) => {
    const disposable = controller.onDidReceiveMessage(({ editor, message }) => {
      switch (message?.command) {
        case 'alive':
          break;
        case 'success':
        case 'display':
          resolve(message.args);
        case 'error':
          reject(message?.args);
        default:
          reject('Unhandled message.');
      }
    });
    disposables.push(disposable);

    try {
      const message = { command: 'runPythonAsync', args: cell.document.getText() };
      controller.postMessage(message);
    } catch (e) {
      reject(e);
    }
  });
  return await resultPromise;
}

// Ensure users get the native notebooks UI since this extension is built on top of the VS Code notebooks API
async function optIntoNativeNotebooks() {
  const settings = vscode.workspace.getConfiguration("jupyter", undefined);
  const optInto = settings.get<string[]>('experiments.optInto');
  if (!Array.isArray(optInto) || optInto.includes('All') || optInto.includes('__NativeNotebookEditor__')) {
    return;
  }
  optInto.push('__NativeNotebookEditor__');
  await settings.update('experiments.optInto', optInto, vscode.ConfigurationTarget.Global);
}
