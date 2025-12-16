const vscode = require('vscode');

/**
 * This method is called when your extension is activated
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    // Create a collection to hold our error messages (diagnostics)
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('nexus');

    // Run validation on the currently active file
    if (vscode.window.activeTextEditor) {
        validateNexus(vscode.window.activeTextEditor.document, diagnosticCollection);
    }

    // Run validation when the active editor changes
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                validateNexus(editor.document, diagnosticCollection);
            }
        })
    );

    // Run validation when the text in the document changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            validateNexus(event.document, diagnosticCollection);
        })
    );
}

/**
 * Validates the NTAX vs Matrix row count
 * @param {vscode.TextDocument} document 
 * @param {vscode.DiagnosticCollection} collection 
 */
function validateNexus(document, collection) {
    // Only check NEXUS files
    if (document.languageId !== 'nexus') return;

    collection.clear();
    const text = document.getText();
    const diagnostics = [];

    // 1. Find the defined NTAX value (e.g., NTAX=5)
    // Regex explanation: Look for NTAX, optional whitespace, =, optional whitespace, capture digits
    const ntaxRegex = /\bNTAX\s*=\s*(\d+)/i;
    const ntaxMatch = ntaxRegex.exec(text);

    if (!ntaxMatch) {
        return; // No NTAX defined, nothing to validate
    }

    const definedNtax = parseInt(ntaxMatch[1]);

    // 2. Find the MATRIX block
    // Regex explanation: Find MATRIX, capture everything until the next semicolon
    const matrixRegex = /\bMATRIX\b([\s\S]*?);/i;
    const matrixMatch = matrixRegex.exec(text);

    if (!matrixMatch) {
        return; // No Matrix found
    }

    const matrixContent = matrixMatch[1];
    
    // 3. Count the actual taxa
    // We split by newline and filter out empty lines or comment-only lines
    const lines = matrixContent.split('\n');
    let actualTaxaCount = 0;

    for (let line of lines) {
        // Remove comments [ ... ]
        let cleanLine = line.replace(/\[.*?\]/g, '').trim();
        
        // If the line still has content, we assume it's a taxon row
        if (cleanLine.length > 0) {
            actualTaxaCount++;
        }
    }

    // 4. Compare and create error if mismatch
    if (definedNtax !== actualTaxaCount) {
        // Create a range object to underline the "NTAX=..." part
        const startPos = document.positionAt(ntaxMatch.index);
        const endPos = document.positionAt(ntaxMatch.index + ntaxMatch[0].length);
        const range = new vscode.Range(startPos, endPos);

        const diagnostic = new vscode.Diagnostic(
            range,
            `Mismatch: NTAX is set to ${definedNtax}, but MATRIX contains ${actualTaxaCount} taxa.`,
            vscode.DiagnosticSeverity.Error
        );

        diagnostics.push(diagnostic);
    }

    collection.set(document.uri, diagnostics);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};