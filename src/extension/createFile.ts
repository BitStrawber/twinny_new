import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand('fileCreator.createFile', async () => {

    // 获取当前工作区文件夹路径
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage('请打开一个工作区!');
      return;
    }

    const folderPath = workspaceFolders[0].uri.fsPath;

    // 弹出输入框，提示用户输入文件名
    const fileName = await vscode.window.showInputBox({ prompt: '请输入文件名（带扩展名）' });
    if (!fileName) {
      vscode.window.showErrorMessage('文件名无效');
      return;
    }

    const filePath = path.join(folderPath, fileName);

    // 检查文件是否已存在
    if (fs.existsSync(filePath)) {
      vscode.window.showErrorMessage('文件已存在');
      return;
    }

    // 创建文件并写入默认内容
    fs.writeFile(filePath, '这是自动创建的文件内容', (err) => {
      if (err) {
        vscode.window.showErrorMessage('文件创建失败: ' + err.message);
      } else {
        vscode.window.showInformationMessage(`文件创建成功: ${filePath}`);

        // 打开刚创建的文件
        vscode.workspace.openTextDocument(filePath).then(doc => {
          vscode.window.showTextDocument(doc);
        });
      }
    });
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}
