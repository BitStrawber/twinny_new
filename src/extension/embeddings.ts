import * as lancedb from "@lancedb/lancedb"
import { IntoVector } from "@lancedb/lancedb/dist/arrow"
import fs from "fs"
import ignore from "ignore"
import path from "path"
import * as vscode from "vscode"

import { ACTIVE_EMBEDDINGS_PROVIDER_STORAGE_KEY } from "../common/constants"
import { logger } from "../common/logger"
import {
  apiProviders,
  EmbeddedDocument,
  Embedding,
  LMStudioEmbedding,
  RequestOptionsOllama,
  StreamRequestOptions as RequestOptions
} from "../common/types"

import { fetchEmbedding } from "./api"
import { Base } from "./base"
import { TwinnyProvider } from "./provider-manager"
import { getDocumentSplitChunks, readGitSubmodulesFile } from "./utils"

export class EmbeddingDatabase extends Base {
  private _documents: EmbeddedDocument[] = []
  private _filePaths: EmbeddedDocument[] = []
  private _db: lancedb.Connection | null = null
  private _dbPath: string
  private _extensionContext?: vscode.ExtensionContext
  private _workspaceName = vscode.workspace.name || ""
  private _documentTableName = `${this._workspaceName}-documents`
  private _filePathTableName = `${this._workspaceName}-file-paths`

  constructor(dbPath: string, extensionContext: vscode.ExtensionContext) {
    super()
    this._dbPath = dbPath
    this._extensionContext = extensionContext
  }

  public async connect() {
    try {
      this._db = await lancedb.connect(this._dbPath)
    } catch (e) {
      console.error(e)
    }
  }

  private getProvider = () =>
    this._extensionContext?.globalState.get<TwinnyProvider>(
      ACTIVE_EMBEDDINGS_PROVIDER_STORAGE_KEY
    )

  public async fetchModelEmbedding(content: string) {
    const provider = this.getProvider()

    if (!provider) return

    const requestBody: RequestOptionsOllama = {
      model: provider.modelName,
      input: content,
      stream: false,
      options: {}
    }

    const requestOptions: RequestOptions = {
      hostname: provider.apiHostname,
      port: provider.apiPort,
      path: provider.apiPath,
      protocol: provider.apiProtocol,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`
      }
    }

    return new Promise<number[]>((resolve) => {
      fetchEmbedding({
        body: requestBody,
        options: requestOptions,
        onData: (response) => {
          resolve(this.getEmbeddingFromResponse(provider, response))
        }
      })
    })
  }

  private getAllFilePaths = async (dirPath: string): Promise<string[]> => {
    let filePaths: string[] = []
    const dirents = await fs.promises.readdir(dirPath, { withFileTypes: true })
    const submodules = readGitSubmodulesFile()

    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ""

    const ig = ignore()

    const gitIgnoreFilePath = path.join(rootPath, ".gitignore")

    if (fs.existsSync(gitIgnoreFilePath)) {
      ig.add(fs.readFileSync(gitIgnoreFilePath).toString())
    }

    const embeddingIgnoredGlobs = this.config.get(
      "embeddingIgnoredGlobs",
      [] as string[]
    )

    ig.add(embeddingIgnoredGlobs)
    ig.add([".git", ".gitignore"])

    for (const dirent of dirents) {
      const fullPath = path.join(dirPath, dirent.name)
      const relativePath = path.relative(rootPath, fullPath)

      if (submodules?.some((submodule) => fullPath.includes(submodule))) {
        continue
      }

      if (ig.ignores(relativePath)) {
        logger.log(`git-ignored: ${relativePath}`)
        continue
      }

      if (dirent.isDirectory()) {
        filePaths = filePaths.concat(await this.getAllFilePaths(fullPath))
      } else if (dirent.isFile()) {
        filePaths.push(fullPath)
      }
    }
    return filePaths
  }

  public async injestDocuments(
    directoryPath: string
  ): Promise<EmbeddingDatabase> {
    const filePaths = await this.getAllFilePaths(directoryPath)
    const totalFiles = filePaths.length
    let processedFiles = 0

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Embedding",
        cancellable: true
      },
      async (progress) => {
        if (!this._extensionContext) return
        const promises = filePaths.map(async (filePath) => {
          const content = await fs.promises.readFile(filePath, "utf-8")

          const chunks = await getDocumentSplitChunks(
            content,
            filePath,
            this._extensionContext
          )

          const filePathEmbedding = await this.fetchModelEmbedding(filePath)

          this._filePaths.push({
            content: filePath,
            vector: filePathEmbedding,
            file: filePath
          })

          for (const chunk of chunks) {
            const chunkEmbedding = await this.fetchModelEmbedding(chunk)
            if (this.getIsDuplicateItem(chunk, chunks)) return
            this._documents.push({
              content: chunk,
              vector: chunkEmbedding,
              file: filePath
            })
          }

          processedFiles++
          progress.report({
            message: `${((processedFiles / totalFiles) * 100).toFixed(
              2
            )}% (${filePath.split("/").pop()})`
          })
        })

        await Promise.all(promises)

        vscode.window.showInformationMessage(
          `Embedded successfully! Processed ${totalFiles} files.`
        )
      }
    )

    return this
  }

  public async populateDatabase() {
    try {
      const tableNames = await this._db?.tableNames()
      if (!tableNames?.includes(`${this._workspaceName}-documents`)) {
        await this._db?.createTable(
          this._documentTableName,
          this._documents,
          {
            mode: "overwrite"
          }
        )
      }

      if (!tableNames?.includes(`${this._workspaceName}-file-paths`)) {
        await this._db?.createTable(
          this._filePathTableName,
          this._filePaths,
          {
            mode: "overwrite"
          }
        )
        return
      }

      await this._db?.dropTable(`${this._workspaceName}-documents`)
      await this._db?.dropTable(`${this._workspaceName}-file-paths`)
      await this.populateDatabase()

      this._documents.length = 0
      this._filePaths.length = 0
    } catch (e) {
      console.log("Error populating database", e)
    }
  }

  public async hasEmbeddingTable(name: string): Promise<boolean | undefined> {
    const tableNames = await this._db?.tableNames()
    return tableNames?.includes(name)
  }

  public async getDocuments(
    vector: IntoVector,
    limit: number,
    tableName: string,
    where?: string
  ): Promise<EmbeddedDocument[] | undefined> {
    try {
      const table = await this._db?.openTable(tableName)
      const query = table?.vectorSearch(vector).limit(limit)
      if (where) query?.where(where)
      return query?.toArray()
    } catch (e) {
      return undefined
    }
  }

  public async getDocumentByFilePath(filePath: string) {
    const content = await fs.promises.readFile(filePath, "utf-8")
    const contentSnippet = content?.slice(0, 500)
    return contentSnippet
  }

  private getIsDuplicateItem(item: string, collection: string[]): boolean {
    return collection.includes(item.trim().toLowerCase())
  }

  private getEmbeddingFromResponse<T>(
    provider: TwinnyProvider,
    response: T
  ): number[] {
    if (provider.provider === apiProviders.LMStudio) {
      return (response as LMStudioEmbedding).data?.[0].embedding
    }

    return (response as Embedding).embeddings[0]
  }
}
