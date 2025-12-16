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
 * Validates NTAX and NCHAR
 * @param {vscode.TextDocument} document 
 * @param {vscode.DiagnosticCollection} collection 
 */
function validateNexus(document, collection) {
    if (document.languageId !== 'nexus') return;

    collection.clear();
    const text = document.getText();
    const diagnostics = [];

    // 1. Find NTAX
    const ntaxRegex = /\bNTAX\s*=\s*(\d+)/i;
    const ntaxMatch = ntaxRegex.exec(text);
    const definedNtax = ntaxMatch ? parseInt(ntaxMatch[1]) : null;

    // 2. Find NCHAR
    const ncharRegex = /\bNCHAR\s*=\s*(\d+)/i;
    const ncharMatch = ncharRegex.exec(text);
    const definedNchar = ncharMatch ? parseInt(ncharMatch[1]) : null;

    // 3. Find MATRIX Block
    // Captures the content between MATRIX and ;
    const matrixRegex = /\bMATRIX\b\s*([\s\S]*?)\s*;/i;
    const matrixMatch = matrixRegex.exec(text);

    if (!matrixMatch) {
        return; 
    }

    // Calculate where the matrix content actually starts in the file
    const matrixContentStart = matrixMatch.index + matrixMatch[0].indexOf(matrixMatch[1]);
    const matrixContentEnd = matrixContentStart + matrixMatch[1].length;
    
    // Convert to line numbers to iterate safely
    const startLine = document.positionAt(matrixContentStart).line;
    const endLine = document.positionAt(matrixContentEnd).line;

    let actualTaxaCount = 0;
    let maxSequenceLength = 0;

    // Iterate through lines inside the matrix block
    for (let i = startLine; i <= endLine; i++) {
        const line = document.lineAt(i);
        const lineText = line.text;
        const trimmed = lineText.trim();

        // Skip comments, empty lines, or isolated semicolons
        if (trimmed.length === 0 || trimmed.startsWith('[') || trimmed === ';') continue;

        // Naive parser: 
        // 1. Optional whitespace
        // 2. Group 1: Taxon Name (Quoted '...' OR SingleWord)
        // 3. Group 4: The rest (Sequence)
        const rowRegex = /^\s*('([^']+)'|(\S+))\s+(.*)$/;
        const match = rowRegex.exec(lineText);

        if (match) {
            actualTaxaCount++;
            
            // Extract sequence part
            let rawSequence = match[4];
            
            // Remove inline comments if any (e.g. ACGT [comment] ACGT)
            rawSequence = rawSequence.replace(/\[.*?\]/g, '');
            
            // Remove whitespace to count actual nucleotides
            const cleanSequence = rawSequence.replace(/\s/g, '');
            const seqLength = cleanSequence.length;

            if (seqLength > maxSequenceLength) {
                maxSequenceLength = seqLength;
            }

            // CHECK: Row Length vs NCHAR
            if (definedNchar !== null && seqLength !== definedNchar) {
                const diagnostic = new vscode.Diagnostic(
                    line.range,
                    `Sequence length (${seqLength}) does not match NCHAR (${definedNchar}).`,
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostics.push(diagnostic);
            }
        }
    }

    // CHECK: NTAX vs Actual Count
    if (definedNtax !== null && definedNtax !== actualTaxaCount) {
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

    // CHECK: NCHAR vs Max Sequence Length
    if (definedNchar !== null && definedNchar !== maxSequenceLength && maxSequenceLength > 0) {
        const startPos = document.positionAt(ncharMatch.index);
        const endPos = document.positionAt(ncharMatch.index + ncharMatch[0].length);
        const range = new vscode.Range(startPos, endPos);

        const diagnostic = new vscode.Diagnostic(
            range,
            `Mismatch: NCHAR is set to ${definedNchar}, but the longest sequence found is ${maxSequenceLength}.`,
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