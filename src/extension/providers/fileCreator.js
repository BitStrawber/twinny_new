"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectGenerator = void 0;
var axios_1 = require("axios");
var fs = require("fs");
var path = require("path");
var vscode_1 = require("vscode"); // 导入 VSCode API
var ProjectGenerator = /** @class */ (function () {
    function ProjectGenerator() {
        this.url = 'http://10.171.180.231:11434/api/generate';
        this.projectName = '';
        this.projectLanguage = '';
        this.template = ''; // 在构造函数中不设置模板
    }
    ProjectGenerator.prototype.createProject = function (dir, structure) {
        for (var _i = 0, _a = Object.entries(structure); _i < _a.length; _i++) {
            var _b = _a[_i], key = _b[0], value = _b[1];
            var newDir = path.join(dir, key);
            if (typeof value === 'object' && value !== null) {
                fs.mkdirSync(newDir, { recursive: true });
                this.createProject(newDir, value);
            }
            else {
                fs.writeFileSync(newDir, String(value));
            }
        }
    };
    ProjectGenerator.prototype.callOllamaService = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, _b, projectDirInput, projectDir, data, response, responses, fullResponse_1, parsedOutput, projectStructure, targetDir, error_1;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        // 弹出输入框让用户输入项目名称和语言
                        _a = this;
                        return [4 /*yield*/, vscode_1.window.showInputBox({
                                prompt: '请输入项目名称',
                                placeHolder: '例如: 坦克大战',
                            })];
                    case 1:
                        // 弹出输入框让用户输入项目名称和语言
                        _a.projectName = (_c.sent()) || '';
                        _b = this;
                        return [4 /*yield*/, vscode_1.window.showInputBox({
                                prompt: '请输入项目语言',
                                placeHolder: '例如: Python',
                            })];
                    case 2:
                        _b.projectLanguage = (_c.sent()) || '';
                        // 确保项目名称和语言都被输入
                        if (!this.projectName || !this.projectLanguage) {
                            console.log('项目名称或语言未输入，操作取消。');
                            return [2 /*return*/]; // 如果用户取消输入，则退出
                        }
                        // 设置模板
                        this.template = "Please generate a unique project folder structure based on the project name \"".concat(this.projectName, "\" and language \"").concat(this.projectLanguage, "\" in JSON format. \n\n    Your output should only include the structure of the project, with various directories and the specific files they contain. Ensure the output is valid JSON, including only files and directories that need to be created manually. \n     \n    **Do not include any additional content or comments. Only provide the JSON structure.**\n    \n    Example format:\n    {\n      \"{{project_name}}\": {\n        \"src\": {\n          \"main.py\": \"\",\n          \"utils\": {\n            \"helper.py\": \"\"\n          }\n        },\n        \"assets\": {\n          \"images\": {},\n          \"audio\": {}\n        },\n        \"tests\": {},\n        \"README.md\": \"\"\n      }\n    }");
                        return [4 /*yield*/, vscode_1.window.showInputBox({
                                prompt: '请输入生成项目的目录地址',
                                placeHolder: '例如: C:/Users/ljh31/Desktop/twinny-main',
                            })];
                    case 3:
                        projectDirInput = _c.sent();
                        projectDir = projectDirInput === null || projectDirInput === void 0 ? void 0 : projectDirInput.trim();
                        if (!projectDir) {
                            console.log('未输入目录，操作取消。');
                            return [2 /*return*/]; // 如果用户取消输入，则退出
                        }
                        data = {
                            model: 'llama3.1:8b',
                            prompt: this.template,
                        };
                        _c.label = 4;
                    case 4:
                        _c.trys.push([4, 6, , 7]);
                        return [4 /*yield*/, axios_1.default.post(this.url, data, {
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                            })];
                    case 5:
                        response = _c.sent();
                        responses = response.data.split('\n').filter(Boolean);
                        fullResponse_1 = '';
                        responses.forEach(function (line) {
                            try {
                                var item = JSON.parse(line);
                                fullResponse_1 += item.response;
                                if (item.done) {
                                    console.log('已完成响应，停止提取。');
                                }
                            }
                            catch (error) {
                                console.error('解析错误:', error);
                            }
                        });
                        fullResponse_1 = fullResponse_1.replace(/```json|```/g, '').trim();
                        parsedOutput = JSON.parse(fullResponse_1);
                        projectStructure = {
                            project: parsedOutput[this.projectName],
                        };
                        console.log(projectStructure);
                        targetDir = path.join(projectDir, this.projectName);
                        this.createProject(targetDir, projectStructure.project);
                        return [3 /*break*/, 7];
                    case 6:
                        error_1 = _c.sent();
                        console.error('Error calling Ollama service:', error_1);
                        return [3 /*break*/, 7];
                    case 7: return [2 /*return*/];
                }
            });
        });
    };
    return ProjectGenerator;
}());
exports.ProjectGenerator = ProjectGenerator;
var c = new ProjectGenerator();
c.callOllamaService();
