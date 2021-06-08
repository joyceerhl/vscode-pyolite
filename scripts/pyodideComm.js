/** Parts of the following code are based on the JupyterLite project.
 *  In accordance with the JupyterLite project license,
 *  the JupyterLite license text is reproduced below.
 * 
 *  BSD 3-Clause License

    Copyright (c) 2021, JupyterLite Contributors
    All rights reserved.

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright notice, this
      list of conditions and the following disclaimer.

    * Redistributions in binary form must reproduce the above copyright notice,
      this list of conditions and the following disclaimer in the documentation
      and/or other materials provided with the distribution.

    * Neither the name of the copyright holder nor the names of its
      contributors may be used to endorse or promote products derived from
      this software without specific prior written permission.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
    AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
    DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
    FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
    DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
    SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
    CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
    OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
    OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

const PYOLITE_WHEEL = 'https://cdn.jsdelivr.net/gh/joyceerhl/vscode-pyolite@08c3997609f33a77fc018781b51e2f9034e8f8a5/bin/pyolite-0.1.0-py3-none-any.whl';

let kernel;
let interpreter;
let kernelStarted = false;

const api = acquireVsCodeApi();

function stdoutCallback(stdout) {
  console.log('stdout', stdout);
}

function stderrCallback(stderr) {
  console.error('stderr', stderr);
}

function displayCallback(res) {
  const bundle = formatResult(res);
  api.postMessage(wrapMessage({
    command: 'display',
    args: bundle
  }));
}

async function main() {
  try {
    await loadPyodide({
      indexURL : "https://cdn.jsdelivr.net/pyodide/v0.17.0/full/"
    });
    await pyodide.loadPackage(['matplotlib']);
    await pyodide.runPythonAsync("import micropip");
    await pyodide.runPythonAsync(`await micropip.install("${PYOLITE_WHEEL}")`);
    await pyodide.runPythonAsync("import pyolite");
  
    kernel = pyodide.globals.get('pyolite').kernel_instance;
    interpreter = kernel.interpreter;
  
    interpreter.stdout_callback = stdoutCallback;
    interpreter.stderr_callback = stderrCallback;
    kernel.display_publisher.display_callback = displayCallback;

    kernelStarted = true;
    api.postMessage(wrapMessage({ command: 'initialized' }));
  } catch (e) {
    api.postMessage(wrapMessage({ command: 'dead' }));
  }
}

async function runCode(code, retryOnError) {
  let result;
  try {
    result = await interpreter.run(code);
    result = formatResult(result);
    api.postMessage(wrapMessage({ command: 'success', args: result }));
  } catch (e) {
    console.log('error', e);
    const error = e.toString();
    const moduleNotFoundRegex = /ModuleNotFoundError: No module named '(?<moduleName>.*)'/g;
    const matches = moduleNotFoundRegex.exec(error);
    // If the error is due to a missing import, auto-download it and retry
    if (retryOnError && matches?.groups?.moduleName) {
      try {
        await pyodide.runPythonAsync(`await micropip.install("${matches.groups.moduleName}")`);
        await runCode(code, false);
      } catch (e) {
        api.postMessage(wrapMessage({ command: 'error', args: e.toString() }));
      }
    } else {
      api.postMessage(wrapMessage({ command: 'error', args: error }));
    }
  }
}

function mapToObject(map) {
  const out = {};
  map.forEach((value, key) => {
    out[key] = value instanceof Map ? mapToObject(value) : value;
  });
  return out;
}

function formatResult(res) {
  if (!pyodide.isPyProxy(res)) {
    return res;
  }
  const m = res.toJs();
  const results = mapToObject(m);
  return results;
}

main()
  .then(() => {
    window.addEventListener('message', event => {
      if (!kernelStarted) {
        return api.postMessage(wrapMessage({ command: 'dead' }));
      }
      const message = event.data?.message;
      switch (message?.command) {
        case 'heartbeat':
          api.postMessage(wrapMessage({ command: 'alive' }));
          break;
        case 'runPythonAsync':
          runCode(message.args, true).then(() => {});
          break;
        default:
          break;
      }
    });
  });

function wrapMessage(message) {
  return {
    '__vscode_notebook_message': true,
    'type': 'customKernelMessage',
    message
  };
}