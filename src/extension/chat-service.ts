import {
  StatusBarItem,
  WebviewView,
  commands,
  window,
  workspace,
  ExtensionContext
} from 'vscode'
import * as path from 'path'

import {
  EXTENSION_CONTEXT_NAME,
  EVENT_NAME,
  WEBUI_TABS,
  ACTIVE_CHAT_PROVIDER_STORAGE_KEY,
  SYSTEM,
  USER,
  RELEVANT_FILE_COUNT,
  RELEVANT_CODE_COUNT,
  SYMMETRY_EMITTER_KEY,
  DEFAULT_RERANK_THRESHOLD
} from '../common/constants'
import {
  StreamResponse,
  RequestBodyBase,
  ServerMessage,
  TemplateData,
  Message,
  StreamRequestOptions,
  EmbeddedDocument
} from '../common/types'
import { getChatDataFromProvider, getLanguage } from './utils'
import { CodeLanguageDetails } from '../common/languages'
import { TemplateProvider } from './template-provider'
import { streamResponse } from './stream'
import { createStreamRequestBody } from './provider-options'
import { kebabToSentence } from '../webview/utils'
import { TwinnyProvider } from './provider-manager'
import { EmbeddingDatabase } from './embeddings'
import { Reranker } from './reranker'
import { SymmetryService } from './symmetry-service'

export class ChatService {
  private _completion = ''
  private _config = workspace.getConfiguration('twinny')
  private _context?: ExtensionContext
  private _controller?: AbortController
  private _db?: EmbeddingDatabase
  private _documents: EmbeddedDocument[] = []
  private _keepAlive = this._config.get('keepAlive') as string | number
  private _numPredictChat = this._config.get('numPredictChat') as number
  private _promptTemplate = ''
  private _reranker: Reranker
  private _statusBar: StatusBarItem
  private _symmetryService?: SymmetryService
  private _temperature = this._config.get('temperature') as number
  private _templateProvider?: TemplateProvider
  private _view?: WebviewView

  constructor(
    statusBar: StatusBarItem,
    templateDir: string,
    extensionContext: ExtensionContext,
    view: WebviewView,
    db: EmbeddingDatabase | undefined,
    symmetryService: SymmetryService
  ) {
    this._view = view
    this._statusBar = statusBar
    this._templateProvider = new TemplateProvider(templateDir)
    this._reranker = new Reranker()
    this._context = extensionContext
    this._db = db
    this._symmetryService = symmetryService
    workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('twinny')) {
        return
      }
      this.updateConfig()
    })

    this.setupSymmetryListeners()
  }

  private setupSymmetryListeners() {
    this._symmetryService?.on(
      SYMMETRY_EMITTER_KEY.inference,
      (completion: string) => {
        this._view?.webview.postMessage({
          type: EVENT_NAME.twinnyOnCompletion,
          value: {
            completion: completion.trimStart(),
            data: getLanguage()
          }
        } as ServerMessage)
      }
    )
  }

  private async getRelevantFiles(text: string | undefined) {
    if (!this._db || !text || !workspace.name) return
    const table = `${workspace.name}-file-paths`
    if (await this._db.hasEmbeddingTable(table)) {
      const embedding = await this._db.fetchModelEmbedding(text)

      if (!embedding) return

      const filePaths =
        (await this._db.getDocuments(
          embedding,
          RELEVANT_FILE_COUNT,
          `${workspace.name}-file-paths`
        )) || []

      if (!filePaths.length) {
        return
      }

      return await this.rerankFiles(
        text,
        filePaths?.map((f) => f.content)
      )
    }
    return []
  }

  private getRerankThreshold() {
    const rerankThresholdContext = `${EVENT_NAME.twinnyGlobalContext}-${EXTENSION_CONTEXT_NAME.twinnyRerankThreshold}`
    const rerankThreshold =
      (this._context?.globalState.get(rerankThresholdContext) as number) ||
      DEFAULT_RERANK_THRESHOLD

    return rerankThreshold
  }

  private async rerankFiles(
    text: string | undefined,
    filePaths: string[] | undefined
  ) {
    if (!this._db || !text || !workspace.name || !filePaths?.length) return []

    const rerankThreshold = this.getRerankThreshold()

    const fileNames = filePaths?.map((filePath) => path.basename(filePath))

    const scores = await this._reranker.rerank(text, fileNames)

    if (!scores) return []

    const relevantFilePaths =
      filePaths
        ?.map((filePath, index) =>
          scores[index] > rerankThreshold ? filePath : ''
        )
        .filter(Boolean) || []

    return relevantFilePaths
  }

  private async getRelevantCode(
    text: string | undefined,
    filePaths: string[] | undefined
  ) {
    if (!this._db || !text || !workspace.name) return
    const table = `${workspace.name}-documents`
    const rerankThreshold = this.getRerankThreshold()

    if (await this._db.hasEmbeddingTable(table)) {
      const embedding = await this._db.fetchModelEmbedding(text)

      if (!embedding) return

      const query = filePaths?.length
        ? `file IN ("${filePaths.join('","')}")`
        : ''

      this._documents =
        (await this._db.getDocuments(
          embedding,
          RELEVANT_CODE_COUNT,
          `${workspace.name}-documents`,
          query
        )) || []

      const scores = await this._reranker.rerank(
        text,
        this._documents.map((item) =>
          `
          ${item.file}
        `.trim()
        )
      )

      if (!scores) return ''

      const codeChunks =
        this._documents
          ?.map(({ content }, index) =>
            scores[index] > rerankThreshold ? content : null
          )
          .filter(Boolean)
          .join('\n\n')
          .trim() || ''

      return codeChunks
    }
    return ''
  }

  private getProvider = () => {
    const provider = this._context?.globalState.get<TwinnyProvider>(
      ACTIVE_CHAT_PROVIDER_STORAGE_KEY
    )
    return provider
  }

  private buildStreamRequest(messages?: Message[] | Message[]) {
    const provider = this.getProvider()

    if (!provider) return

    const requestOptions: StreamRequestOptions = {
      hostname: provider.apiHostname,
      port: Number(provider.apiPort),
      path: provider.apiPath,
      protocol: provider.apiProtocol,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`
      }
    }

    const requestBody = createStreamRequestBody(provider.provider, {
      model: provider.modelName,
      numPredictChat: this._numPredictChat,
      temperature: this._temperature,
      messages,
      keepAlive: this._keepAlive
    })

    return { requestOptions, requestBody }
  }

  private onStreamData = (
    streamResponse: StreamResponse,
    onEnd?: (completion: string) => void
  ) => {
    const provider = this.getProvider()
    if (!provider) return

    try {
      const data = getChatDataFromProvider(provider.provider, streamResponse)
      this._completion = this._completion + data
      if (onEnd) return
      this._view?.webview.postMessage({
        type: EVENT_NAME.twinnyOnCompletion,
        value: {
          completion: this._completion.trimStart(),
          data: getLanguage(),
          type: this._promptTemplate
        }
      } as ServerMessage)
    } catch (error) {
      console.error('Error parsing JSON:', error)
      return
    }
  }

  private onStreamEnd = (onEnd?: (completion: string) => void) => {
    this._statusBar.text = '🤖'
    commands.executeCommand(
      'setContext',
      EXTENSION_CONTEXT_NAME.twinnyGeneratingText,
      false
    )
    if (onEnd) {
      onEnd(this._completion)
      this._view?.webview.postMessage({
        type: EVENT_NAME.twinnyOnEnd
      } as ServerMessage)
      return
    }
    this._view?.webview.postMessage({
      type: EVENT_NAME.twinnyOnEnd,
      value: {
        completion: this._completion.trimStart(),
        data: getLanguage(),
        type: this._promptTemplate
      }
    } as ServerMessage)
  }

  private onStreamError = (error: Error) => {
    this._view?.webview.postMessage({
      type: EVENT_NAME.twinnyOnEnd,
      value: {
        error: true,
        errorMessage: error.message
      }
    } as ServerMessage)
  }

  private onStreamStart = (controller: AbortController) => {
    this._controller = controller
    commands.executeCommand(
      'setContext',
      EXTENSION_CONTEXT_NAME.twinnyGeneratingText,
      true
    )
    this._view?.webview.onDidReceiveMessage((data: { type: string }) => {
      if (data.type === EVENT_NAME.twinnyStopGeneration) {
        this._controller?.abort()
      }
    })
  }

  public destroyStream = () => {
    this._controller?.abort()
    this._statusBar.text = '🤖'
    commands.executeCommand(
      'setContext',
      EXTENSION_CONTEXT_NAME.twinnyGeneratingText,
      true
    )
    this._view?.webview.postMessage({
      type: EVENT_NAME.twinnyOnEnd,
      value: {
        completion: this._completion.trimStart(),
        data: getLanguage(),
        type: this._promptTemplate
      }
    } as ServerMessage)
  }

  private buildTemplatePrompt = async (
    template: string,
    language: CodeLanguageDetails,
    context?: string
  ) => {
    const editor = window.activeTextEditor
    const selection = editor?.selection
    const selectionContext =
      editor?.document.getText(selection) || context || ''

    const prompt = await this._templateProvider?.renderTemplate<TemplateData>(
      template,
      {
        code: selectionContext || '',
        language: language?.langName || 'unknown'
      }
    )
    return { prompt: prompt || '', selection: selectionContext }
  }

  private streamResponse({
    requestBody,
    requestOptions,
    onEnd
  }: {
    requestBody: RequestBodyBase
    requestOptions: StreamRequestOptions
    onEnd?: (completion: string) => void
  }) {
    return streamResponse({
      body: requestBody,
      options: requestOptions,
      onData: (streamResponse) =>
        this.onStreamData(streamResponse as StreamResponse, onEnd),
      onEnd: () => this.onStreamEnd(onEnd),
      onStart: this.onStreamStart,
      onError: this.onStreamError
    })
  }

  private sendEditorLanguage = () => {
    this._view?.webview.postMessage({
      type: EVENT_NAME.twinnySendLanguage,
      value: {
        data: getLanguage()
      }
    } as ServerMessage)
  }

  private focusChatTab = () => {
    this._view?.webview.postMessage({
      type: EVENT_NAME.twinnySetTab,
      value: {
        data: WEBUI_TABS.chat
      }
    } as ServerMessage<string>)
  }

  public async addRagContextIfEnabled(conversation: Message[], text?: string) {
    const ragContextKey = `${EVENT_NAME.twinnyWorkspaceContext}-${EXTENSION_CONTEXT_NAME.twinnyEnableRag}`

    const isRagEnabled = this._context?.workspaceState.get(ragContextKey)

    if (isRagEnabled) {
      const relevantFiles = await this.getRelevantFiles(text)

      let relevantCode = await this.getRelevantCode(text, relevantFiles)

      if (relevantFiles?.length && !relevantCode) {
        const promises = []
        for (const file of relevantFiles) {
          promises.push(this._db?.getDocumentByFilePath(file))
        }

        relevantCode = (await Promise.all(promises)).join('\n')
      }

      if (relevantFiles?.length) {
        conversation.push({
          role: USER,
          content: `Here are some files which might or might not be relevant, decide for yourself and reply with the correct answer: ${relevantFiles.join(
            ', '
          )}`
        })
      }

      if (relevantCode) {
        conversation.push({
          role: USER,
          content: `Here is the code that might be relevant, decide for yourself and reply with the correct answer: ${relevantCode}`
        })
      }
    }
  }

  public async streamChatCompletion(messages: Message[]) {
    this._completion = ''
    this.sendEditorLanguage()
    const editor = window.activeTextEditor
    const selection = editor?.selection
    const userSelection = editor?.document.getText(selection)
    const lastMessage = messages[messages.length - 1]
    const text = lastMessage.content

    const systemMessage = {
      role: SYSTEM,
      content: await this._templateProvider?.readSystemMessageTemplate(
        this._promptTemplate
      )
    }

    const conversation = [systemMessage, ...messages]

    if (userSelection) {
      conversation.push({
        role: USER,
        content: `This is the code that the user is selecting: ${userSelection}`
      })
    }

    await this.addRagContextIfEnabled(conversation, text)

    const request = this.buildStreamRequest(conversation)
    if (!request) return
    const { requestBody, requestOptions } = request
    return this.streamResponse({ requestBody, requestOptions })
  }

  public async getTemplateMessages(
    promptTemplate: string,
    context?: string,
    skipMessage?: boolean
  ): Promise<Message[]> {
    this._statusBar.text = '$(loading~spin)'
    const { language } = getLanguage()
    this._completion = ''
    this._promptTemplate = promptTemplate
    this.sendEditorLanguage()
    const { prompt, selection } = await this.buildTemplatePrompt(
      promptTemplate,
      language,
      context
    )

    if (!skipMessage) {
      this.focusChatTab()
      this._view?.webview.postMessage({
        type: EVENT_NAME.twinnyOnLoading
      })
      this._view?.webview.postMessage({
        type: EVENT_NAME.twinngAddMessage,
        value: {
          completion:
            kebabToSentence(promptTemplate) + '\n\n' + '```\n' + selection,
          data: getLanguage()
        }
      } as ServerMessage)
    }

    const systemMessage = {
      role: SYSTEM,
      content: await this._templateProvider?.readSystemMessageTemplate(
        this._promptTemplate
      )
    }

    const conversation = [
      systemMessage,
      {
        role: USER,
        content: prompt
      }
    ]

    await this.addRagContextIfEnabled(conversation, selection)

    return conversation
  }

  public async streamTemplateCompletion(
    promptTemplate: string,
    context?: string,
    onEnd?: (completion: string) => void,
    skipMessage?: boolean
  ) {
    const messages = await this.getTemplateMessages(
      promptTemplate,
      context,
      skipMessage
    )
    const request = this.buildStreamRequest(messages)

    if (!request) return
    const { requestBody, requestOptions } = request
    return this.streamResponse({ requestBody, requestOptions, onEnd })
  }

  private updateConfig() {
    this._config = workspace.getConfiguration('twinny')
    this._temperature = this._config.get('temperature') as number
    this._keepAlive = this._config.get('keepAlive') as string | number
  }
}
