// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// https://stackoverflow.com/questions/39877156/how-to-extend-string-prototype-and-use-it-next-in-typescript
// eslint-disable-next-line @typescript-eslint/naming-convention
declare interface String {
    /**
     * Split a string using the cr and lf characters and return them as an array.
     * By default lines are trimmed and empty lines are removed.
     * @param {SplitLinesOptions=} splitOptions - Options used for splitting the string.
     */
    splitLines(splitOptions?: { trim: boolean; removeEmptyEntries?: boolean }): string[];
}

/**
 * Split a string using the cr and lf characters and return them as an array.
 * By default lines are trimmed and empty lines are removed.
 * @param {SplitLinesOptions=} splitOptions - Options used for splitting the string.
 */
 String.prototype.splitLines = function (
    this: string,
    splitOptions: { trim: boolean; removeEmptyEntries: boolean } = { removeEmptyEntries: true, trim: true }
): string[] {
    let lines = this.split(/\r?\n/g);
    if (splitOptions && splitOptions.trim) {
        lines = lines.map((line) => line.trim());
    }
    if (splitOptions && splitOptions.removeEmptyEntries) {
        lines = lines.filter((line) => line.length > 0);
    }
    return lines;
};
