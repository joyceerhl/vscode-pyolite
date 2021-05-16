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

var kernel;
var interpreter;
const PYOLITE_WHEEL = 'https://cdn.jsdelivr.net/gh/joyceerhl/vscode-pyolite@08c3997609f33a77fc018781b51e2f9034e8f8a5/bin/pyolite-0.1.0-py3-none-any.whl';

async function main() {
  await loadPyodide({
    indexURL : "https://cdn.jsdelivr.net/pyodide/v0.17.0/full/"
  });
  await pyodide.loadPackage(['matplotlib']);
  await pyodide.runPythonAsync("import micropip");
  await pyodide.runPythonAsync(`await micropip.install("${PYOLITE_WHEEL}")`);
  await pyodide.runPythonAsync("import pyolite");
  kernel = pyodide.globals.get('pyolite').kernel_instance;
  interpreter = kernel.interpreter;
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

main().then(() => {
  const api = acquireVsCodeApi();
  api.postMessage(wrapMessage({ command: 'initialized' }));
  
  function stdoutCallback(stdout) {
    api.postMessage(wrapMessage({ command: 'success', args: stdout }));
  }
  function stderrCallback(stderr) {
    api.postMessage(wrapMessage({ command: 'error', args: stderr }));
  }
  function displayCallback(res) {
    const bundle = formatResult(res);
    api.postMessage(wrapMessage({
      command: 'display',
      args: bundle
    }));
  }

  interpreter.stdout_callback = stdoutCallback;
  interpreter.stderr_callback = stderrCallback;
  kernel.display_publisher.display_callback = displayCallback;

  let result;
  async function runCode(code) {
    try {
      result = await interpreter.run(code);
      result = formatResult(result);
      api.postMessage(wrapMessage({ command: 'success', args: result }));
    } catch (e) {
      api.postMessage(wrapMessage({ command: 'error', args: e }));
      return;
    }
  }

  window.addEventListener('message', event => {
    const message = event.data?.message;
    switch (message?.command) {
      case 'heartbeat':
        api.postMessage(wrapMessage({ command: 'alive' }));
        break;
      case 'runPythonAsync':
        runCode(message.args).then(() => {
        });
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