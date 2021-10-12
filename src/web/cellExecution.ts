import { nbformat } from "@jupyterlab/coreutils";
import { KernelMessage } from "@jupyterlab/services";
import { NotebookCell, NotebookCellData, NotebookCellExecution, NotebookCellKind, NotebookCellOutput, NotebookController, NotebookDocument, NotebookRange, notebooks, Range, workspace, WorkspaceEdit } from "vscode";
import { cellOutputToVSCCellOutput, concatMultilineString, createErrorOutput, formatStreamText, noop, translateErrorOutput } from "./helpers";
import { IKernel } from "./kernel/types";
import { createDeferred, Deferred } from "./utils";

// Helper interface for the set_next_input execute reply payload
interface ISetNextInputPayload {
    replace: boolean;
    source: 'set_next_input';
    text: string;
}

type ExecuteResult = nbformat.IExecuteResult & {
    transient?: { display_id?: string };
};
type DisplayData = nbformat.IDisplayData & {
    transient?: { display_id?: string };
};

export class CellOutputDisplayIdTracker {
    private displayIdCellOutputMappingPerDocument = new WeakMap<
        NotebookDocument,
        Map<string, { output: NotebookCellOutput; cell: NotebookCell }>
    >();
    private cellToDisplayIdMapping = new WeakMap<NotebookCell, string>();
    constructor() {}
    /**
     * Keep track of the mapping between display_id and the output.
     * When we need to update this display, we can resolve the promise & access the output.
     * The return value is a promise that needs to be resolved with the associated output thats been added to the DOM
     */
    public trackOutputByDisplayId(cell: NotebookCell, displayId: string, output: NotebookCellOutput) {
        let mapOfDisplayIdToOutput = this.displayIdCellOutputMappingPerDocument.get(cell.notebook);
        if (!mapOfDisplayIdToOutput) {
            mapOfDisplayIdToOutput = new Map<string, { output: NotebookCellOutput; cell: NotebookCell }>();
            this.displayIdCellOutputMappingPerDocument.set(cell.notebook, mapOfDisplayIdToOutput);
        }
        mapOfDisplayIdToOutput.set(displayId, { output, cell: cell });
        this.cellToDisplayIdMapping.set(cell, displayId);
    }
    /**
     * We return a promise, as we need to wait until the output is part of the DOM before we can update it.
     */
    public getMappedOutput(notebook: NotebookDocument, displayId: string): NotebookCellOutput | undefined {
        const mapOfDisplayIdToOutput = this.displayIdCellOutputMappingPerDocument.get(notebook);
        if (!mapOfDisplayIdToOutput) {
            return;
        }
        // Check if the cell still exists.
        const mapping = mapOfDisplayIdToOutput.get(displayId);
        return mapping?.cell.document.isClosed ? undefined : mapping?.output;
    }
}


export class RefBool {
    constructor(private val: boolean) {}

    public get value(): boolean {
        return this.val;
    }

    public update(newVal: boolean) {
        this.val = newVal;
    }
}

export class CellExecution {
    private cellExecutions = new Map<NotebookCell, Deferred<boolean | undefined>>();
    private cell: NotebookCell | undefined;
    private execution: NotebookCellExecution | undefined;
    private clearState: RefBool | undefined;
    private lastUsedStreamOutput?: { stream: 'stdout' | 'stderr'; text: string; output: NotebookCellOutput };

    constructor() { }

    async execute(
        controller: NotebookController,
        kernel: IKernel,
        cell: NotebookCell
    ) {
        const task = controller.createNotebookCellExecution(cell);
        this.execution = task;
        this.clearState = new RefBool(false);
        const executionPromise = createDeferred<boolean | undefined>();
        this.cellExecutions.set(cell, executionPromise);
        this.cell = cell;
        
		task.start( Date.now() );
        task.clearOutput();

        const code = cell.document.getText();
        const result = await kernel.executeRequest({
            code: code,
        });

        // Wait for execution to complete
        const success = result.status === 'ok';
        this.cellExecutions.delete(cell);
        this.lastUsedStreamOutput = undefined;
		task.end(success, Date.now());
    }

    handleMessage(msg: KernelMessage.IMessage){
        if (this.cell) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');
            const clearState = this.clearState || new RefBool(false);

            try {
                if (jupyterLab.KernelMessage.isExecuteResultMsg(msg)) {
                    this.handleExecuteResult(msg as KernelMessage.IExecuteResultMsg, clearState);
                } else if (jupyterLab.KernelMessage.isStreamMsg(msg)) {
                    this.handleStreamMessage(msg as KernelMessage.IStreamMsg, clearState);
                } else if (jupyterLab.KernelMessage.isDisplayDataMsg(msg)) {
                    this.handleDisplayData(msg as KernelMessage.IDisplayDataMsg, clearState);
                } else if (jupyterLab.KernelMessage.isUpdateDisplayDataMsg(msg)) {
                    // this.handleUpdateDisplayDataMessage(msg);
                } else if (jupyterLab.KernelMessage.isClearOutputMsg(msg)) {
                    this.handleClearOutput(msg as KernelMessage.IClearOutputMsg, clearState);
                } else if (jupyterLab.KernelMessage.isErrorMsg(msg)) {
                    this.handleError(msg as KernelMessage.IErrorMsg, clearState);
                } else if (jupyterLab.KernelMessage.isExecuteReplyMsg(msg)) {
                    this.handleExecuteReply(msg, clearState);
                } else if (jupyterLab.KernelMessage.isExecuteReplyMsg(msg)) {
                    this.handleExecuteReply(msg, clearState);
                } else {
                    console.log(`Unknown message ${msg.header.msg_type} : hasData=${'data' in msg.content}`);
                }

                // Set execution count, all messages should have it
                if ('execution_count' in msg.content && typeof msg.content.execution_count === 'number' && this.execution) {
                    this.execution.executionOrder = msg.content.execution_count;
                }
            } catch (err) {
                // If not a restart error, then tell the subscriber
                this.completedWithErrors(err as Error);
            }
        }
    }

    private addToCellData(
        output: ExecuteResult | DisplayData | nbformat.IStream | nbformat.IError,
        clearState: RefBool
    ) {
        const cellOutput = cellOutputToVSCCellOutput(output);
        const displayId =
            output.transient &&
            typeof output.transient === 'object' &&
            'display_id' in output.transient &&
            typeof output.transient?.display_id === 'string'
                ? output.transient?.display_id
                : undefined;
        if (this.cell?.document.isClosed) {
            return;
        }
        // Clear if necessary
        if (clearState.value) {
            this.clearLastUsedStreamOutput();
            this.execution?.clearOutput().then(noop, noop);
            clearState.update(false);
        }

        // Append to the data (we would push here but VS code requires a recreation of the array)
        // Possible execution of cell has completed (the task would have been disposed).
        // This message could have come from a background thread.
        // In such circumstances, create a temporary task & use that to update the output (only cell execution tasks can update cell output).
        const task = this.execution;
        this.clearLastUsedStreamOutput();
        task?.appendOutput([cellOutput]).then(noop, noop);
    }

    // See this for docs on the messages:
    // https://jupyter-client.readthedocs.io/en/latest/messaging.html#messaging-in-jupyter
    private handleExecuteResult(msg: KernelMessage.IExecuteResultMsg, clearState: RefBool) {
        this.addToCellData(
            {
                output_type: 'execute_result',
                data: msg.content.data as any,
                metadata: msg.content.metadata as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                transient: msg.content.transient as any, // NOSONAR
                execution_count: msg.content.execution_count
            },
            clearState
        );
    }

    private handleExecuteReply(msg: KernelMessage.IExecuteReplyMsg, clearState: RefBool) {
        const reply = msg.content as KernelMessage.IExecuteReply;
        if (reply.payload) {
            reply.payload.forEach((payload) => {
                if (
                    payload.source &&
                    payload.source === 'set_next_input' &&
                    'text' in payload &&
                    'replace' in payload
                ) {
                    this.handleSetNextInput((payload as unknown) as ISetNextInputPayload);
                }
                if (payload.data && payload.data.hasOwnProperty('text/plain')) {
                    this.addToCellData(
                        {
                            // Mark as stream output so the text is formatted because it likely has ansi codes in it.
                            output_type: 'stream',
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            text: (payload.data as any)['text/plain'].toString(),
                            name: 'stdout',
                            metadata: {},
                            execution_count: reply.execution_count
                        },
                        clearState
                    );
                }
            });
        }
    }

    // Handle our set_next_input message, which can either replace or insert a new cell with text
    private handleSetNextInput(payload: ISetNextInputPayload) {
        const edit = new WorkspaceEdit();
        if (!this.cell) {
            return;
        }
        if (payload.replace) {
            // Replace the contents of the current cell with text
            edit.replace(
                this.cell.document.uri,
                new Range(
                    this.cell.document.lineAt(0).range.start,
                    this.cell.document.lineAt(this.cell.document.lineCount - 1).range.end
                ),
                payload.text
            );
        } else {
            // Add a new cell after the current with text
            const cellData = new NotebookCellData(NotebookCellKind.Code, payload.text, this.cell.document.languageId);
            cellData.outputs = [];
            cellData.metadata = {};
            edit.replaceNotebookCells(
                this.cell.notebook.uri,
                new NotebookRange(this.cell.index + 1, this.cell.index + 1),
                [cellData]
            );
        }
        workspace.applyEdit(edit).then(noop, noop);
    }

    private handleStreamMessage(msg: KernelMessage.IStreamMsg, clearState: RefBool) {
        // eslint-disable-next-line complexity
        // Possible execution of cell has completed (the task would have been disposed).
        // This message could have come from a background thread.
        // In such circumstances, create a temporary task & use that to update the output (only cell execution tasks can update cell output).
        const task = this.execution;

        // Clear output if waiting for a clear
        const clearOutput = clearState.value;
        if (clearOutput) {
            this.clearLastUsedStreamOutput();
            task?.clearOutput().then(noop, noop);
            clearState.update(false);
        }
        // Ensure we append to previous output, only if the streams as the same &
        // If the last output is the desired stream type.
        if (this.lastUsedStreamOutput?.stream === msg.content.name) {
            // Get the jupyter output from the vs code output (so we can concatenate the text ourselves).
            let existingOutputText = this.lastUsedStreamOutput.text;
            let newContent = msg.content.text;
            // Look for the ansi code `<char27>[A`. (this means move up)
            // Not going to support `[2A` (not for now).
            const moveUpCode = `${String.fromCharCode(27)}[A`;
            if (msg.content.text.startsWith(moveUpCode)) {
                // Split message by lines & strip out the last n lines (where n = number of lines to move cursor up).
                const existingOutputLines = existingOutputText.splitLines({
                    trim: false,
                    removeEmptyEntries: false
                });
                if (existingOutputLines.length) {
                    existingOutputLines.pop();
                }
                existingOutputText = existingOutputLines.join('\n');
                newContent = newContent.substring(moveUpCode.length);
            }
            // Create a new output item with the concatenated string.
            this.lastUsedStreamOutput.text = formatStreamText(
                concatMultilineString(`${existingOutputText}${newContent}`)
            );
            const output = cellOutputToVSCCellOutput({
                output_type: 'stream',
                name: msg.content.name,
                text: this.lastUsedStreamOutput.text
            });
            task?.replaceOutputItems(output.items, this.lastUsedStreamOutput.output).then(noop, noop);
        } else if (clearOutput) {
            // Replace the current outputs with a single new output.
            const text = formatStreamText(concatMultilineString(msg.content.text));
            const output = cellOutputToVSCCellOutput({
                output_type: 'stream',
                name: msg.content.name,
                text
            });
            this.lastUsedStreamOutput = { output, stream: msg.content.name, text };
            task?.replaceOutput([output]).then(noop, noop);
        } else {
            // Create a new output
            const text = formatStreamText(concatMultilineString(msg.content.text));
            const output = cellOutputToVSCCellOutput({
                output_type: 'stream',
                name: msg.content.name,
                text
            });
            this.lastUsedStreamOutput = { output, stream: msg.content.name, text };
            task?.appendOutput([output]).then(noop, noop);
        }
    }

    private handleDisplayData(msg: KernelMessage.IDisplayDataMsg, clearState: RefBool) {
        const output: nbformat.IDisplayData = {
            output_type: 'display_data',
            data: msg.content.data as any,
            metadata: msg.content.metadata as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            transient: msg.content.transient as any // NOSONAR
        };
        this.addToCellData(output, clearState);
    }

    private handleClearOutput(msg: KernelMessage.IClearOutputMsg, clearState: RefBool) {
        // If the message says wait, add every message type to our clear state. This will
        // make us wait for this type of output before we clear it.
        if (msg && msg.content.wait) {
            clearState.update(true);
        } else {
            // Possible execution of cell has completed (the task would have been disposed).
            // This message could have come from a background thread.
            // In such circumstances, create a temporary task & use that to update the output (only cell execution tasks can update cell output).
            // Clear all outputs and start over again.
            const task = this.execution;
            this.clearLastUsedStreamOutput();
            task?.clearOutput().then(noop, noop);
        }
    }

    private clearLastUsedStreamOutput() {
        this.lastUsedStreamOutput = undefined;
    }
    private completedWithErrors(error: Partial<Error>) {
        this.execution?.appendOutput([translateErrorOutput(createErrorOutput(error))]).then(noop, noop);

        this.execution?.end(false);
    }

    private handleError(msg: KernelMessage.IErrorMsg, clearState: RefBool) {
        const output: nbformat.IError = {
            output_type: 'error',
            ename: msg.content.ename,
            evalue: msg.content.evalue,
            traceback: msg.content.traceback
        };

        this.addToCellData(output, clearState);
    }
}
