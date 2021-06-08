// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

export class StopWatch {
  private started = new Date().getTime();
  public get elapsedTime() {
    return new Date().getTime() - this.started;
  }
  public reset() {
    this.started = new Date().getTime();
  }
}

export enum CellOutputMimeTypes {
  error = 'application/vnd.code.notebook.error',
  stderr = 'application/vnd.code.notebook.stderr',
  stdout = 'application/vnd.code.notebook.stdout'
}

const textMimeTypes = ['text/plain', 'text/markdown', CellOutputMimeTypes.stderr, CellOutputMimeTypes.stdout];

export function convertJupyterOutputToBuffer(mime: string, value: unknown): Buffer {
  if (!value) {
    return Buffer.from('');
  }
  if (
    (mime.startsWith('text/') || textMimeTypes.includes(mime)) &&
    (Array.isArray(value) || typeof value === 'string')
  ) {
    return Buffer.from(value);
  } else if (mime.startsWith('image/') && typeof value === 'string') {
    // Images in Jupyter are stored in base64 encoded format.
    // VS Code expects bytes when rendering images.
    return Buffer.from(value, 'base64');
  } else if (mime.toLowerCase().includes('json')) {
    return Buffer.from(JSON.stringify(value));
  } else {
    return Buffer.from(typeof value === 'object' && !!value ? JSON.stringify(value) : value as string);
  }
}

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

export function createNotebookCellOutput(data: Record<string, any>) {
  const items: NotebookCellOutputItem[] = [];
  // eslint-disable-next-line
  for (const key in data) {
    // Add metadata to all (its the same)
    // We can optionally remove metadata that belongs to other mime types (feels like over optimization, hence not doing that).
    items.push(new NotebookCellOutputItem(convertJupyterOutputToBuffer(key, data[key]), key));
  }

  return new NotebookCellOutput(sortOutputItemsBasedOnDisplayOrder(items));
}
