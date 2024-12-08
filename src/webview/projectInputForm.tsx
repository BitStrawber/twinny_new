import React, { useState } from 'react';
import { VSCodeButton, VSCodePanelView } from '@vscode/webview-ui-toolkit/react';

interface ProjectInputFormProps {
  onSubmit: (data: { projectName: string; projectDescription: string; projectLanguage: string }) => void;
}

const ProjectInputForm: React.FC<ProjectInputFormProps> = ({ onSubmit }) => {
  const [projectName, setProjectName] = useState<string>('');
  const [projectDescription, setProjectDescription] = useState<string>('');
  const [projectLanguage, setProjectLanguage] = useState<string>('');

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit({ projectName, projectDescription, projectLanguage });
  };

  return (
    <form onSubmit={handleSubmit}>
      <label>
        项目名称:
        <input 
          type="text" 
          value={projectName} 
          onChange={(e) => setProjectName(e.target.value)} 
          required 
        />
      </label>
      <label>
        项目描述:
        <textarea 
          value={projectDescription} 
          onChange={(e) => setProjectDescription(e.target.value)} 
          required 
        />
      </label>
      <label>
        项目语言:
        <input 
          type="text" 
          value={projectLanguage} 
          onChange={(e) => setProjectLanguage(e.target.value)} 
          required 
        />
      </label>
      <VSCodeButton type="submit" appearance="primary">生成项目</VSCodeButton>
    </form>
  );
};

export const Chat: React.FC = () => {
  const [showInputForm, setShowInputForm] = useState<boolean>(false);

  const handleNewButtonClick = () => {
    setShowInputForm(true);
  };

  const handleFormSubmit = async (data: { projectName: string; projectDescription: string; projectLanguage: string }) => {
    // 这里可以调用你生成项目的逻辑，将 data 传递过去
    console.log(data);
    // 生成项目的逻辑...
    setShowInputForm(false); // 生成完毕后返回聊天界面
  };

  return (
    <VSCodePanelView>
      {showInputForm ? (
        <ProjectInputForm onSubmit={handleFormSubmit} />
      ) : (
        <div>
          {/* 你的聊天界面代码 */}
          <VSCodeButton onClick={handleNewButtonClick} appearance="primary">
            生成完整工程
          </VSCodeButton>
          {/* 其他聊天内容 */}
        </div>
      )}
    </VSCodePanelView>
  );
};
