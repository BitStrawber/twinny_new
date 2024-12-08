import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { window } from 'vscode'; // 导入 VSCode API
import * as vscode from 'vscode';

export class ProjectGenerator {
  private url: string;
  private projectName: string;
  private projectLanguage: string;
  private template: string;

  constructor() {
    this.url = 'http://127.0.0.1:11434/api/generate';
    this.projectName = '';
    this.projectLanguage = '';
    this.template = ''; // 在构造函数中不设置模板
  }

  private createProject(dir: string, structure: Record<string, any>) {
    for (const [key, value] of Object.entries(structure)) {
      const newDir = path.join(dir, key);
      if (typeof value === 'object' && value !== null) {
        fs.mkdirSync(newDir, { recursive: true });
        this.createProject(newDir, value);
      } else {
        fs.writeFileSync(newDir, String(value));
      }
    }
  }

  public async callOllamaService(projectName: string, projectLanguage: string, projectDir: string) {
    console.log("begin call ollama service !");
    
    this.projectName = projectName;
    this.projectLanguage = projectLanguage;

    // 确保项目名称和语言都被输入
    if (!this.projectName || !this.projectLanguage) {
      console.log('项目名称或语言未输入，操作取消。');
      return; // 如果用户取消输入，则退出
    }

    // 设置模板
    this.template = `Please generate a unique and detailed project folder structure based on the project description "${this.projectName}" and language "${this.projectLanguage}" in JSON format.

    Your output should include a complete structure of the project with multiple directories and specific files they contain.Each file should contain example content that includes detailed and meaningful code with at least 100 lines per file. The content should be realistic and functional based on the project description. Ensure the output is valid JSON . Note that in order for the result to be a valid string, the contents of each file should be a single-line string. For example, 'def main():\\n    print('Welcome to here')\\n    \\n    # Create a new chat window\\n    chat_window = ChatWindow()\\n    \\n    # Start the chat session\\n    chat_session = ChatSession(chat_window)\\n    \\n    # Run the chat session\\n    chat_session.run()\\n\\nif __name__ == '__main__':\\n    main()' .Remember, do not contain any other information like 'Here is the result ...' or 'Here is the detailed project folder structure',which is very important. Just give me a JSON.In other words , your response should start with the character '{' and end with '}'.

    Example format:
    {
      "src": {
        "main.py": "def main():\\n    print('Welcome to ${this.projectName}')\\n\\nif __name__ == '__main__':\\n    main()",
        "utils": {
          "helper.py": "def helper_function():\\n    result = 'This is a helper function.'\\n    return result\\n\\nif __name__ == '__main__':\\n    print(helper_function())"
        }
      },
      "assets": {
        "images": {},
        "audio": {}
      },
      "tests": {
        "test_main.py": "import unittest\\n\\nclass TestMain(unittest.TestCase):\\n    def test_example(self):\\n        self.assertEqual(1, 1)\\n\\nif __name__ == '__main__':\\n    unittest.main()"
      },
      "README.md": "# ${this.projectName}\\n\\nA project generated by VSCode plugin."
    }`;
    
    // 去掉路径中的空格
    projectDir = projectDir?.trim();
    
    if (!projectDir) {
      console.log('未输入目录，操作取消。');
      return; // 如果用户取消输入，则退出
    }
    const data = {
      model: 'llama3.1:8b',
      prompt: this.template,
    };

    try {
      const response = await axios.post(this.url, data, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const responses = response.data.split('\n').filter(Boolean);
      let fullResponse = '';

      responses.forEach((line: string) => {
        try {
          const item = JSON.parse(line);
          fullResponse += item.response;
          if (item.done) {
            console.log('已完成响应，停止提取。');
          }
        } catch (error) {
          console.error('解析错误:', error);
        }
      });

      fullResponse = fullResponse.replace(/```json|```/g, '').trim();
      console.log(fullResponse)
      const parsedOutput = JSON.parse(fullResponse);
      console.log(parsedOutput)
      console.log("?88")
      const projectStructure = {
        project: parsedOutput,
      };
      console.log("?66")
      console.log(projectStructure);
      
      const targetDir = path.join(projectDir, this.projectName);
      this.createProject(targetDir, projectStructure.project);
    
      // 添加项目到工作区并打开
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders) {
        const folderExists = workspaceFolders.some(folder => folder.uri.fsPath === targetDir);
        if (!folderExists) {
          await vscode.workspace.updateWorkspaceFolders(workspaceFolders.length, null, {
            uri: vscode.Uri.file(targetDir),
            name: this.projectName,
          });
        }
      } else {
        await vscode.workspace.updateWorkspaceFolders(0, null, {
          uri: vscode.Uri.file(targetDir),
          name: this.projectName,
        });
      }
    
      // 打开目标目录
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetDir), true);

    } catch (error) {
      console.error('Error calling Ollama service:', error);
    }
  }
}
