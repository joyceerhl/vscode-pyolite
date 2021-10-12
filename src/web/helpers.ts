// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { nbformat } from "@jupyterlab/coreutils";
import { NotebookCellOutput, NotebookCellOutputItem } from "vscode";

const orderOfMimeTypes = [
    'application/vnd.*',
    'application/vdom.*',
    'application/geo+json',
    'application/x-nteract-model-debug+json',
    'text/html',
    'application/javascript',
    'image/gif',
    'text/latex',
    'text/markdown',
    'image/svg+xml',
    'image/png',
    'image/jpeg',
    'application/json',
    'text/plain'
];

function sortOutputItemsBasedOnDisplayOrder(outputItems: NotebookCellOutputItem[]): NotebookCellOutputItem[] {
    return outputItems.sort((outputItemA, outputItemB) => {
        const isMimeTypeMatch = (value: string, compareWith: string) => {
            if (value.endsWith('.*')) {
                value = value.substr(0, value.indexOf('.*'));
            }
            return compareWith.startsWith(value);
        };
        const indexOfMimeTypeA = orderOfMimeTypes.findIndex((mime) => isMimeTypeMatch(outputItemA.mime, mime));
        const indexOfMimeTypeB = orderOfMimeTypes.findIndex((mime) => isMimeTypeMatch(outputItemB.mime, mime));
        return indexOfMimeTypeA - indexOfMimeTypeB;
    });
}


export enum CellOutputMimeTypes {
    error = 'application/vnd.code.notebook.error',
    stderr = 'application/vnd.code.notebook.stderr',
    stdout = 'application/vnd.code.notebook.stdout'
}

const textMimeTypes = ['text/plain', 'text/markdown', CellOutputMimeTypes.stderr, CellOutputMimeTypes.stdout];

export function concatMultilineString(str: string | string[], trim?: boolean): string {
    const nonLineFeedWhiteSpaceTrim = /(^[\t\f\v\r ]+|[\t\f\v\r ]+$)/g; // Local var so don't have to reset the lastIndex.
    if (Array.isArray(str)) {
        let result = '';
        for (let i = 0; i < str.length; i += 1) {
            const s = str[i];
            if (i < str.length - 1 && !s.endsWith('\n')) {
                result = result.concat(`${s}\n`);
            } else {
                result = result.concat(s);
            }
        }

        // Just trim whitespace. Leave \n in place
        return trim ? result.replace(nonLineFeedWhiteSpaceTrim, '') : result;
    }
    return trim ? str.toString().replace(nonLineFeedWhiteSpaceTrim, '') : str.toString();
}

// Took this from jupyter/notebook
// https://github.com/jupyter/notebook/blob/b8b66332e2023e83d2ee04f83d8814f567e01a4e/notebook/static/base/js/utils.js
// Remove characters that are overridden by backspace characters
function fixBackspace(txt: string) {
    let tmp = txt;
    do {
        txt = tmp;
        // Cancel out anything-but-newline followed by backspace
        tmp = txt.replace(/[^\n]\x08/gm, '');
    } while (tmp.length < txt.length);
    return txt;
}

// Using our own version for fixCarriageReturn. The jupyter version seems to not work.
function fixCarriageReturn(str: string): string {
    // Go through the string, looking for \r's that are not followed by \n. This is
    // a special case that means replace the string before. This is necessary to
    // get an html display of this string to behave correctly.

    // Note: According to this:
    // https://jsperf.com/javascript-concat-vs-join/2.
    // Concat is way faster than array join for building up a string.
    let result = '';
    let previousLinePos = 0;
    for (let i = 0; i < str.length; i += 1) {
        if (str[i] === '\r') {
            // See if this is a line feed. If so, leave alone. This is goofy windows \r\n
            if (i < str.length - 1 && str[i + 1] === '\n') {
                // This line is legit, output it and convert to '\n' only.
                result += str.substr(previousLinePos, i - previousLinePos);
                result += '\n';
                previousLinePos = i + 2;
                i += 1;
            } else {
                // This line should replace the previous one. Skip our \r
                previousLinePos = i + 1;
            }
        } else if (str[i] === '\n') {
            // This line is legit, output it. (Single linefeed)
            result += str.substr(previousLinePos, i - previousLinePos + 1);
            previousLinePos = i + 1;
        }
    }
    result += str.substr(previousLinePos, str.length - previousLinePos);
    return result;
}

export function formatStreamText(str: string): string {
    // Do the same thing jupyter is doing
    return fixCarriageReturn(fixBackspace(str));
}

function convertJupyterOutputToBuffer(mime: string, value: unknown): NotebookCellOutputItem {
    if (!value) {
        return NotebookCellOutputItem.text('', mime);
    }
    try {
        if (
            (mime.startsWith('text/') || textMimeTypes.includes(mime)) &&
            (Array.isArray(value) || typeof value === 'string')
        ) {
            const stringValue = Array.isArray(value) ? concatMultilineString(value) : value;
            return NotebookCellOutputItem.text(stringValue, mime);
        } else if (mime.startsWith('image/') && typeof value === 'string' && mime !== 'image/svg+xml') {
            // Images in Jupyter are stored in base64 encoded format.
            // VS Code expects bytes when rendering images.
            const data = Uint8Array.from(atob(value), c => c.charCodeAt(0));
            return new NotebookCellOutputItem(data, mime);
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            return NotebookCellOutputItem.text(JSON.stringify(value), mime);
        } else {
            // For everything else, treat the data as strings (or multi-line strings).
            value = Array.isArray(value) ? concatMultilineString(value) : value;
            return NotebookCellOutputItem.text(value as string, mime);
        }
    } catch (ex) {
        return NotebookCellOutputItem.error(ex as Error);
    }
}

export function createNotebookCellOutput(data: Record<string, any>) {
	const items: NotebookCellOutputItem[] = [];
    // eslint-disable-next-line
    for (const key in data) {
        // Add metadata to all (its the same)
        // We can optionally remove metadata that belongs to other mime types (feels like over optimization, hence not doing that).
        items.push(convertJupyterOutputToBuffer(key, data[key]));
    }

    return new NotebookCellOutput(sortOutputItemsBasedOnDisplayOrder(items));
}



const cellOutputMappers = new Map<nbformat.OutputType, (output: nbformat.IOutput) => NotebookCellOutput>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
cellOutputMappers.set('display_data', translateDisplayDataOutput as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
cellOutputMappers.set('error', translateErrorOutput as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
cellOutputMappers.set('execute_result', translateDisplayDataOutput as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
cellOutputMappers.set('stream', translateStreamOutput as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
cellOutputMappers.set('update_display_data', translateDisplayDataOutput as any);
export function cellOutputToVSCCellOutput(output: nbformat.IOutput): NotebookCellOutput {
    /**
     * Stream, `application/x.notebook.stream`
     * Error, `application/x.notebook.error-traceback`
     * Rich, { mime: value }
     *
     * outputs: [
            new vscode.NotebookCellOutput([
                new vscode.NotebookCellOutputItem('application/x.notebook.stream', 2),
                new vscode.NotebookCellOutputItem('application/x.notebook.stream', 3),
            ]),
            new vscode.NotebookCellOutput([
                new vscode.NotebookCellOutputItem('text/markdown', '## header 2'),
                new vscode.NotebookCellOutputItem('image/svg+xml', [
                    "<svg baseProfile=\"full\" height=\"200\" version=\"1.1\" width=\"300\" xmlns=\"http://www.w3.org/2000/svg\">\n",
                    "  <rect fill=\"blue\" height=\"100%\" width=\"100%\"/>\n",
                    "  <circle cx=\"150\" cy=\"100\" fill=\"green\" r=\"80\"/>\n",
                    "  <text fill=\"white\" font-size=\"60\" text-anchor=\"middle\" x=\"150\" y=\"125\">SVG</text>\n",
                    "</svg>"
                    ]),
            ]),
        ]
     *
     */
    const fn = cellOutputMappers.get(output.output_type as nbformat.OutputType);
    let result: NotebookCellOutput;
    if (fn) {
        result = fn(output);
    } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = translateDisplayDataOutput(output as any);
    }
    return result;
}

/**
 * Metadata we store in VS Code cell output items.
 * This contains the original metadata from the Jupyuter Outputs.
 */
 export type CellOutputMetadata = {
    /**
     * Cell output metadata.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: any;
    /**
     * Transient data from Jupyter.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transient?: {
        /**
         * This is used for updating the output in other cells.
         * We don't know of others properties, but this is definitely used.
         */
        display_id?: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } & any;
    /**
     * Original cell output type
     */
    outputType: nbformat.OutputType | string;
    executionCount?: nbformat.IExecuteResult['ExecutionCount'];
    /**
     * Whether the original Mime data is JSON or not.
     * This properly only exists in metadata for NotebookCellOutputItems
     * (this is something we have added)
     */
    __isJson?: boolean;
    /**
     * Whether to display the open plot icon.
     */
    __displayOpenPlotIcon?: boolean;
};


function getOutputMetadata(output: nbformat.IOutput): CellOutputMetadata {
    // Add on transient data if we have any. This should be removed by our save functions elsewhere.
    const metadata: CellOutputMetadata = {
        outputType: output.output_type
    };
    if (output.transient) {
        metadata.transient = output.transient;
    }

    switch (output.output_type as nbformat.OutputType) {
        case 'display_data':
        case 'execute_result':
        case 'update_display_data': {
            metadata.executionCount = output.execution_count;
            metadata.metadata = output.metadata ?? {};
            break;
        }
        default:
            break;
    }

    return metadata;
}

/**
 * We will display the error message in the status of the cell.
 * The `ename` & `evalue` is displayed at the top of the output by VS Code.
 * As we're displaying the error in the statusbar, we don't want this dup error in output.
 * Hence remove this.
 */
 export function translateErrorOutput(output?: nbformat.IError): NotebookCellOutput {
    output = output || { output_type: 'error', ename: '', evalue: '', traceback: [] };
    return new NotebookCellOutput(
        [
            NotebookCellOutputItem.error({
                name: output?.ename || '',
                message: output?.evalue || '',
                stack: (output?.traceback || []).join('\n')
            })
        ],
        { ...getOutputMetadata(output), originalError: output }
    );
}

/**
 * Converts a Jupyter display cell output into a VSCode cell output format.
 * Handles sizing, adding backgrounds to images and the like.
 * E.g. Jupyter cell output contains metadata to add backgrounds to images.
 */
function translateDisplayDataOutput(
    output: nbformat.IDisplayData | nbformat.IDisplayUpdate | nbformat.IExecuteResult
): NotebookCellOutput {
    // Metadata could be as follows:
    // We'll have metadata specific to each mime type as well as generic metadata.
    /*
    IDisplayData = {
        output_type: 'display_data',
        data: {
            'image/jpg': '/////'
            'image/png': '/////'
            'text/plain': '/////'
        },
        metadata: {
            'image/png': '/////',
            'background': true,
            'xyz': '///
        }
    }
    */
    const metadata = getOutputMetadata(output);
    // If we have SVG or PNG, then add special metadata to indicate whether to display `open plot`
    if ('image/svg+xml' in output.data || 'image/png' in output.data) {
        metadata.__displayOpenPlotIcon = true;
    }
    const items: NotebookCellOutputItem[] = [];
    if (output.data) {
        // eslint-disable-next-line no-restricted-syntax
        for (const key in output.data) {
            items.push(convertJupyterOutputToBuffer(key, output.data[key]));
        }
    }

    return new NotebookCellOutput(sortOutputItemsBasedOnDisplayOrder(items), metadata);
}

function translateStreamOutput(output: nbformat.IStream): NotebookCellOutput {
    const value = concatMultilineString(output.text);
    const factoryFn = output.name === 'stderr' ? NotebookCellOutputItem.stderr : NotebookCellOutputItem.stdout;
    return new NotebookCellOutput([factoryFn(value)], getOutputMetadata(output));
}

export function isStreamOutput(output: NotebookCellOutput, expectedStreamName: string): boolean {
    const metadata = output.metadata as CellOutputMetadata | undefined;
    return metadata?.outputType === 'stream' && getOutputStreamType(output) === expectedStreamName;
}

// Output stream can only have stderr or stdout so just check the first output. Undefined if no outputs
export function getOutputStreamType(output: NotebookCellOutput): string | undefined {
    if (output.items.length > 0) {
        return output.items[0].mime === CellOutputMimeTypes.stderr ? 'stderr' : 'stdout';
    }
}

export function splitMultilineString(source: nbformat.MultilineString): string[] {
    // Make sure a multiline string is back the way Jupyter expects it
    if (Array.isArray(source)) {
        return source as string[];
    }
    const str = source.toString();
    if (str.length > 0) {
        // Each line should be a separate entry, but end with a \n if not last entry
        const arr = str.split('\n');
        return arr
            .map((s, i) => {
                if (i < arr.length - 1) {
                    return `${s}\n`;
                }
                return s;
            })
            .filter((s) => s.length > 0); // Skip last one if empty (it's the only one that could be length 0)
    }
    return [];
}

export function translateCellErrorOutput(output: NotebookCellOutput): nbformat.IError {
    // it should have at least one output item
    const firstItem = output.items[0];
    // Bug in VS Code.
    if (!firstItem.data) {
        return {
            output_type: 'error',
            ename: '',
            evalue: '',
            traceback: []
        };
    }
    const originalError: undefined | nbformat.IError = output.metadata?.originalError;
    const value: Error = JSON.parse(Buffer.from(firstItem.data as Uint8Array).toString('utf8'));
    return {
        output_type: 'error',
        ename: value.name,
        evalue: value.message,
        // VS Code needs an `Error` object which requires a `stack` property as a string.
        // Its possible the format could change when converting from `traceback` to `string` and back again to `string`
        // When .NET stores errors in output (with their .NET kernel),
        // stack is empty, hence store the message instead of stack (so that somethign gets displayed in ipynb).
        traceback: originalError?.traceback || splitMultilineString(value.stack || value.message || '')
    };
}

const textDecoder = new TextDecoder();
function convertOutputMimeToJupyterOutput(mime: string, value: Uint8Array) {
    if (!value) {
        return '';
    }
    try {
        if (mime === CellOutputMimeTypes.error) {
            const stringValue = textDecoder.decode(value);
            return JSON.parse(stringValue);
        } else if (mime.startsWith('text/') || textMimeTypes.includes(mime)) {
            const stringValue = textDecoder.decode(value);
            return splitMultilineString(stringValue);
        } else if (mime.startsWith('image/') && mime !== 'image/svg+xml') {
            // Images in Jupyter are stored in base64 encoded format.
            // VS Code expects bytes when rendering images.
            if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
                return Buffer.from(value).toString('base64');
            } else {
                // https://developer.mozilla.org/en-US/docs/Glossary/Base64#solution_1_%E2%80%93_escaping_the_string_before_encoding_it
                const stringValue = textDecoder.decode(value);
                return btoa(
                    encodeURIComponent(stringValue).replace(/%([0-9A-F]{2})/g, function (_match, p1) {
                        return String.fromCharCode(Number.parseInt('0x' + p1));
                    })
                );
            }
        } else if (mime.toLowerCase().includes('json')) {
            const stringValue = textDecoder.decode(value);
            return stringValue.length > 0 ? JSON.parse(stringValue) : stringValue;
        } else {
            const stringValue = textDecoder.decode(value);
            return stringValue;
        }
    } catch (ex) {
        return '';
    }
}
type JupyterOutput =
    | nbformat.IUnrecognizedOutput
    | nbformat.IExecuteResult
    | nbformat.IDisplayData
    | nbformat.IStream
    | nbformat.IError;

function convertStreamOutput(output: NotebookCellOutput): JupyterOutput {
    const outputs: string[] = [];
    output.items
        .filter((opit) => opit.mime === CellOutputMimeTypes.stderr || opit.mime === CellOutputMimeTypes.stdout)
        .map((opit) => textDecoder.decode(opit.data))
        .forEach((value) => {
            // Ensure each line is a seprate entry in an array (ending with \n).
            const lines = value.split('\n');
            // If the last item in `outputs` is not empty and the first item in `lines` is not empty, then concate them.
            // As they are part of the same line.
            if (outputs.length && lines.length && lines[0].length > 0) {
                outputs[outputs.length - 1] = `${outputs[outputs.length - 1]}${lines.shift()!}`;
            }
            for (const line of lines) {
                outputs.push(line);
            }
        });

    for (let index = 0; index < outputs.length - 1; index++) {
        outputs[index] = `${outputs[index]}\n`;
    }

    // Skip last one if empty (it's the only one that could be length 0)
    if (outputs.length && outputs[outputs.length - 1].length === 0) {
        outputs.pop();
    }

    const streamType = getOutputStreamType(output) || 'stdout';

    return {
        output_type: 'stream',
        name: streamType,
        text: outputs
    };
}
export function translateCellDisplayOutput(output: NotebookCellOutput): JupyterOutput {
    const customMetadata = output.metadata as CellOutputMetadata | undefined;
    let result: JupyterOutput;
    // Possible some other extension added some output (do best effort to translate & save in ipynb).
    // In which case metadata might not contain `outputType`.
    const outputType = customMetadata?.outputType as nbformat.OutputType;
    switch (outputType) {
        case 'error': {
            result = translateCellErrorOutput(output);
            break;
        }
        case 'stream': {
            result = convertStreamOutput(output);
            break;
        }
        case 'display_data': {
            result = {
                output_type: 'display_data',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data: output.items.reduce((prev: any, curr) => {
                    prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.mime, curr.data as Uint8Array);
                    return prev;
                }, {}),
                metadata: customMetadata?.metadata || {} // This can never be undefined.
            };
            break;
        }
        case 'execute_result': {
            result = {
                output_type: 'execute_result',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data: output.items.reduce((prev: any, curr) => {
                    prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.mime, curr.data as Uint8Array);
                    return prev;
                }, {}),
                metadata: customMetadata?.metadata || {}, // This can never be undefined.
                execution_count:
                    typeof customMetadata?.executionCount === 'number' ? customMetadata?.executionCount : null // This can never be undefined, only a number or `null`.
            };
            break;
        }
        case 'update_display_data': {
            result = {
                output_type: 'update_display_data',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data: output.items.reduce((prev: any, curr) => {
                    prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.mime, curr.data as Uint8Array);
                    return prev;
                }, {}),
                metadata: customMetadata?.metadata || {} // This can never be undefined.
            };
            break;
        }
        default: {
            const isError =
                output.items.length === 1 && output.items.every((item) => item.mime === CellOutputMimeTypes.error);
            const isStream = output.items.every(
                (item) => item.mime === CellOutputMimeTypes.stderr || item.mime === CellOutputMimeTypes.stdout
            );

            if (isError) {
                return translateCellErrorOutput(output);
            }

            // In the case of .NET & other kernels, we need to ensure we save ipynb correctly.
            // Hence if we have stream output, save the output as Jupyter `stream` else `display_data`
            // Unless we already know its an unknown output type.
            const outputType: nbformat.OutputType =
                <nbformat.OutputType>customMetadata?.outputType || (isStream ? 'stream' : 'display_data');

            let unknownOutput: nbformat.IUnrecognizedOutput | nbformat.IDisplayData | nbformat.IStream;
            if (outputType === 'stream') {
                // If saving as `stream` ensure the mandatory properties are set.
                unknownOutput = convertStreamOutput(output);
            } else if (outputType === 'display_data') {
                // If saving as `display_data` ensure the mandatory properties are set.
                const displayData: nbformat.IDisplayData = {
                    data: {},
                    metadata: {},
                    output_type: 'display_data'
                };
                unknownOutput = displayData;
            } else {
                unknownOutput = {
                    output_type: outputType
                };
            }
            if (customMetadata?.metadata) {
                unknownOutput.metadata = customMetadata.metadata;
            }
            if (output.items.length > 0) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                unknownOutput.data = output.items.reduce((prev: any, curr) => {
                    prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.mime, curr.data as Uint8Array);
                    return prev;
                }, {});
            }
            result = unknownOutput;
            break;
        }
    }

    // Account for transient data as well
    // `transient.display_id` is used to update cell output in other cells, at least thats one use case we know of.
    if (result && customMetadata && customMetadata.transient) {
        result.transient = customMetadata.transient;
    }
    return result;
}

export function noop() {}

export function createErrorOutput(error: Partial<Error>): nbformat.IError {
    return {
        output_type: 'error',
        ename: error.name || error.message || 'Error',
        evalue: error.message || error.name || 'Error',
        traceback: (error.stack || '').splitLines()
    };
}
