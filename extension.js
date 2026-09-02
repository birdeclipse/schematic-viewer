// VS Code / Cursor extension: shows a netlist document in the viewer webview.
// The webview reuses index.html verbatim; script tags are rewritten to webview URIs.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const VIEW_TYPE = 'schematicViewer.netlist';

function html(webview, root) {
  const nonce = Math.random().toString(36).slice(2);
  const uri = f => webview.asWebviewUri(vscode.Uri.joinPath(root, f));
  return fs.readFileSync(path.join(root.fsPath, 'index.html'), 'utf8')
    .replace(/<script src="([^"]+)"><\/script>/g, (_, f) => `<script nonce="${nonce}" src="${uri(f)}"></script>`)
    .replace('<style>', `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-eval' 'nonce-${nonce}';">\n<style>`);
}

function activate(context) {
  const root = context.extensionUri;
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW_TYPE, {
    resolveCustomTextEditor(document, panel) {
      panel.webview.options = { enableScripts: true, localResourceRoots: [root] };
      panel.webview.html = html(panel.webview, root);
      const send = () => panel.webview.postMessage({ type: 'load', text: document.getText() });
      let timer;   // one full re-parse + ELK layout per keystroke is too much on a 14k-line macro
      const subs = [
        panel.webview.onDidReceiveMessage(m => { if (m.type === 'ready') send(); }),
        vscode.workspace.onDidChangeTextDocument(e => { if (e.document === document) { clearTimeout(timer); timer = setTimeout(send, 400); } }),
      ];
      panel.onDidDispose(() => { clearTimeout(timer); subs.forEach(s => s.dispose()); });
    },
  }, { webviewOptions: { retainContextWhenHidden: true } }));

  context.subscriptions.push(vscode.commands.registerCommand('schematicViewer.open', uri => {
    uri = uri || vscode.window.activeTextEditor?.document.uri;
    if (!uri) return vscode.window.showInformationMessage('Open a SPICE/CDL netlist first.');
    return vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE, vscode.ViewColumn.Beside);
  }));
}

module.exports = { activate };
