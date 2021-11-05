#!/usr/bin/env node

import {
  extract,
  parseMarkup,
  parseStylesheet,
  resolveConfig,
  stringifyMarkup,
  stringifyStylesheet,
} from "emmet";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  CompletionItem,
  CompletionItemKind,
  createConnection,
  DidChangeConfigurationNotification,
  InitializeParams,
  InitializeResult,
  InsertTextFormat,
  ProposedFeatures,
  TextDocumentPositionParams,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";

let connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;
let hasDiagnosticRelatedInformationCapability: boolean = false;

connection.onInitialize((params: InitializeParams) => {
  let capabilities = params.capabilities;

  // Does the client support the `workspace/configuration` request?
  // If not, we fall back using global settings.
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  const triggerCharacters = [
    ">",
    ")",
    "]",
    "}",

    "@",
    "*",
    "$",
    "+",
    
    // alpha
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
    "h",
    "i",
    "j",
    "k",
    "l",
    "m",
    "n",
    "o",
    "p",
    "q",
    "r",
    "s",
    "t",
    "u",
    "v",
    "w",
    "x",
    "y",
    "z",

    // num
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
  ];

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that this server supports code completion.
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: triggerCharacters,
      },
    },
  };
  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }
  return result;
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    );
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((_event) => {
      connection.console.log("Workspace folder change event received.");
    });
  }
});

interface Settings {
  html_filetypes: string[],
  css_filetypes: string[],
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: Settings = {
    html_filetypes: ['html'],
    css_filetypes: ['css'],
};
let globalSettings: Settings = defaultSettings;

// Cache the settings of all open documents
let documentSettings: Map<string, Thenable<Settings>> = new Map();

connection.onDidChangeConfiguration((change) => {
      globalSettings = <Settings>change.settings;
});

function getDocumentSettings(resource: string): Thenable<Settings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings);
  }
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: "languageServerExample",
    });
    documentSettings.set(resource, result);
  }
  return result;
}

function getCssSnippet(abbreviation: string) {
  const cssConfig = resolveConfig({
    type: "stylesheet",
    options: {
      "output.field": (index : number, placeholder : string) =>
        `\$\{${index}${placeholder ? ":" + placeholder : ""}\}`,
    },
  });
  const markup = parseStylesheet(abbreviation, cssConfig);
  return stringifyStylesheet(markup, cssConfig);
}

function getHtmlSnippet(abbreviation: string) {
  const htmlconfig = resolveConfig({
    options: {
      "output.field": (index : number, placeholder : string) =>
      `\$\{${index}${placeholder ? ":" + placeholder : ""}\}`,
    },
  });
  const markup = parseMarkup(abbreviation, htmlconfig);
  return stringifyMarkup(markup, htmlconfig);
}

function buildCompletionItem(abbreviation: string, textResult: string, range: any) {
  return {
    insertTextFormat: InsertTextFormat.Snippet,
    label: abbreviation,
    detail: abbreviation,
    documentation: textResult,
    textEdit: {
      range,
      newText: textResult,
      // newText: textResult.replace(/\$\{\d*\}/g,''),
    },
    kind: CompletionItemKind.Snippet,
    data: {
      range,
      textResult,
    },
  }
}

function buildRange(linenr: number, left: number, right: number) {
  return {
    start: {
      line: linenr,
      character: left,
    },
    end: {
      line: linenr,
      character: right,
    },
  };
}

function getCompeletionItem(linenr: number, line: string, char: number, opts? : any ) {
  opts = typeof(opts) !== 'undefined' ? opts : {}

  try {
    let extractPosition = extract(line, char, opts);
    if (extractPosition?.abbreviation != undefined) {
      let left = extractPosition.start;
      let right = extractPosition.start;
      let abbreviation = extractPosition.abbreviation;

      let textResult = opts.type == 'stylesheet'
                     ? getCssSnippet(abbreviation)
                     : getHtmlSnippet(abbreviation);

      let range = buildRange(linenr, left, right);
      return buildCompletionItem(abbreviation, textResult, range);
    }
  } catch (error) {
    connection.console.log(`ERR: ${error}`);
  }
}

documents.onDidClose((e : any) => {
  documentSettings.delete(e.document.uri);
});

connection.onCompletion(
  (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    try {
      let docs = documents.get(_textDocumentPosition.textDocument.uri);
      if (!docs) throw "failed to find document";
      let languageId = docs.languageId;
      let content = docs.getText();
      let linenr = _textDocumentPosition.position.line;
      let line = String(content.split(/\r?\n/g)[linenr]);
      let character = _textDocumentPosition.position.character;
      let result = [];

      if (globalSettings.html_filetypes.indexOf(languageId) != -1) {
        let completionItem = getCompeletionItem(linenr, line, character)
        if (completionItem) {
          result.push(completionItem);
        }
      }
      if (globalSettings.css_filetypes.indexOf(languageId) != -1) {
        let completionItem = getCompeletionItem(linenr, line, character, { type: "stylesheet" })
        if (completionItem) {
          result.push(completionItem);
        }
      }

      return result;
    } catch (error) {
      connection.console.log(`ERR: ${error}`);
    }

    return [];
  }
);

documents.listen(connection);

connection.listen();
