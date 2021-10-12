# Pyolite kernel for Visual Studio Code

Python kernel for Visual Studio Code notebooks based on [JupyterLite](https://github.com/jupyterlite/jupyterlite), [Pyodide](https://pyodide.org/en/stable/development/core.html), the [Jupyter extension for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter).

<img src=https://raw.githubusercontent.com/joyceerhl/vscode-pyolite/main/images/pyolite.gif>

# Development

To build the extension and test it against github.dev:
1. `git clone https://github.com/joyceerhl/vscode-pyolite`
2. `cd vscode-pyolite`
2. `npm i`
3. `npm run watch-web`
3. In one shell, `npm run serve`
3. In another shell, `npm run localtunnel`
3. Click on the local URL printed as a result of running `npm run localtunnel` and click 'Click to Continue'
3. Navigate to a repository in `github.dev`
4. Ctrl+Shift+P > Install Web Extension > paste in the URL printed from running `npm run localtunnel`
4. The Pyolite VS Code extension should be installed and ready for local testing! 

# Acknowledgments

This extension builds on top of:
1. The VS Code [notebooks API](https://code.visualstudio.com/api/extension-guides/notebook)
2. [JupyterLite](https://github.com/jupyterlite/jupyterlite)
3. [Pyodide](https://pyodide.org/en/stable/development/core.html)
4. The [Jupyter extension for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter)
