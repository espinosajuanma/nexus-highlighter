const vscode = require('vscode');

// Define a decoration type to highlight unclosed comments
// We use 'editor.foreground' with opacity to make it look "muted" rather than invisible
const unclosedCommentDecoration = vscode.window.createTextEditorDecorationType({
    color: new vscode.ThemeColor('editor.foreground'), // Overrides the syntax highlighter's comment color
    opacity: '0.5', // Makes the text appear muted/faded
    fontStyle: 'italic' // Optional: adds a visual cue that this state is temporary/broken
});

/**
 * Activated when the extension starts.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('nexus');
    
    // Create an Output Channel for logging
    const outputChannel = vscode.window.createOutputChannel('NEXUS Validator');
    context.subscriptions.push(outputChannel);

    if (vscode.window.activeTextEditor) {
        validateNexus(vscode.window.activeTextEditor.document, diagnosticCollection, outputChannel);
    }

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                validateNexus(editor.document, diagnosticCollection, outputChannel);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            validateNexus(event.document, diagnosticCollection, outputChannel);
        })
    );
}

/**
 * Core validation logic connecting the Parser to VS Code Diagnostics.
 * @param {vscode.TextDocument} document 
 * @param {vscode.DiagnosticCollection} collection 
 * @param {vscode.OutputChannel} outputChannel
 */
function validateNexus(document, collection, outputChannel) {
    if (document.languageId !== 'nexus') return;

    collection.clear();
    const text = document.getText();
    const diagnostics = [];

    // Optional: Clear previous logs or just separator (comment out .clear() if you want history)
    outputChannel.clear();
    outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] Validating ${document.fileName}`);

    // 0. VALIDATION: Bracket Balance (Comments)
    // We run this first because unclosed comments often break parsing logic
    validateComments(document, diagnostics, outputChannel);

    // 1. Extract Metadata (NTAX/NCHAR defined in header)
    const ntaxRegex = /\bNTAX\s*=\s*(\d+)/i;
    const ncharRegex = /\bNCHAR\s*=\s*(\d+)/i;

    const ntaxMatch = ntaxRegex.exec(text);
    const ncharMatch = ncharRegex.exec(text);

    const definedNtax = ntaxMatch ? parseInt(ntaxMatch[1]) : null;
    const definedNchar = ncharMatch ? parseInt(ncharMatch[1]) : null;

    outputChannel.appendLine(`   Header: NTAX=${definedNtax}, NCHAR=${definedNchar}`);

    // 2. Parse the Matrix into our Object Model
    const parser = new NexusParser();
    const nexusData = parser.parse(document); // Pass document to get line numbers for errors
    
    outputChannel.appendLine(`   Parsed: Found ${nexusData.ntax} taxa. Max Length: ${nexusData.maxSequenceLength}`);

    // 3. VALIDATION: NTAX
    if (definedNtax !== null && nexusData.ntax !== definedNtax) {
        const range = getRangeFromMatch(document, ntaxMatch);
        diagnostics.push(new vscode.Diagnostic(
            range,
            `Mismatch: NTAX=${definedNtax} but MATRIX has ${nexusData.ntax} taxa.`,
            vscode.DiagnosticSeverity.Error
        ));
        outputChannel.appendLine(`   [Error] NTAX Mismatch: ${definedNtax} vs ${nexusData.ntax}`);
    }

    // 4. VALIDATION: NCHAR (Global max length check)
    if (definedNchar !== null && nexusData.maxSequenceLength !== definedNchar) {
        const range = getRangeFromMatch(document, ncharMatch);
        diagnostics.push(new vscode.Diagnostic(
            range,
            `Mismatch: NCHAR=${definedNchar} but the longest sequence is ${nexusData.maxSequenceLength}.`,
            vscode.DiagnosticSeverity.Error
        ));
        outputChannel.appendLine(`   [Error] NCHAR Mismatch: ${definedNchar} vs Max ${nexusData.maxSequenceLength}`);
    }

    // 5. VALIDATION: Per-Taxon Row Consistency
    if (definedNchar !== null) {
        for (const taxon of nexusData.taxa.values()) {
            if (taxon.length !== definedNchar) {
                diagnostics.push(new vscode.Diagnostic(
                    taxon.lineRange,
                    `Sequence length (${taxon.length}) does not match NCHAR (${definedNchar}).`,
                    vscode.DiagnosticSeverity.Warning
                ));
                outputChannel.appendLine(`   [Warning] Taxon '${taxon.name}' length ${taxon.length} != ${definedNchar}`);
            }
        }
    }

    collection.set(document.uri, diagnostics);
}

// --- HELPER ---
function getRangeFromMatch(document, match) {
    const start = document.positionAt(match.index);
    const end = document.positionAt(match.index + match[0].length);
    return new vscode.Range(start, end);
}

/**
 * Validates balanced brackets for comments, respecting quotes.
 * Applies decorations to visualize unclosed comments.
 */
function validateComments(document, diagnostics, outputChannel) {
    const text = document.getText();
    const stack = []; // Stores indices of '['
    let inQuote = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        // Handle Quotes: NEXUS uses single quotes. Escaped quotes are doubled ''.
        if (char === "'") {
            if (inQuote && i + 1 < text.length && text[i+1] === "'") {
                i++; // Skip the next quote as it is part of the escape sequence
                continue;
            }
            inQuote = !inQuote;
            continue;
        }

        if (inQuote) continue;

        // Handle Brackets
        if (char === '[') {
            stack.push(i);
        } else if (char === ']') {
            if (stack.length === 0) {
                const pos = document.positionAt(i);
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(pos, pos.translate(0, 1)),
                    "Unexpected closing bracket ']'",
                    vscode.DiagnosticSeverity.Error
                ));
            } else {
                stack.pop();
            }
        }
    }

    if (inQuote) {
        // Warning for unclosed quotes (which can hide bracket errors)
        const lastPos = document.positionAt(text.length);
        diagnostics.push(new vscode.Diagnostic(
            new vscode.Range(lastPos.translate(0, -1), lastPos),
            "Unclosed single quote. This may hide other errors.",
            vscode.DiagnosticSeverity.Error
        ));
    }

    // Prepare ranges for highlighting unclosed comments
    const decorationRanges = [];
    const endPos = document.positionAt(text.length);

    // Any remaining '[' in stack are unclosed
    if (stack.length > 0) {
        outputChannel.appendLine(`   [Error] Found ${stack.length} unclosed comment blocks.`);
        
        // VISUAL FIX: Only highlight from the OUTERMOST (first) unclosed bracket to the end.
        // This prevents opacity stacking (0.5 * 0.5 * 0.5...) which renders text invisible.
        const outermostUnclosedIndex = stack[0];
        const startPos = document.positionAt(outermostUnclosedIndex);
        decorationRanges.push(new vscode.Range(startPos, endPos));

        // Add squiggle diagnostics for ALL unclosed brackets
        for (const index of stack) {
            const pos = document.positionAt(index);
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(pos, pos.translate(0, 1)),
                "Unclosed comment block '['",
                vscode.DiagnosticSeverity.Error
            ));
        }
    }

    // Apply decorations to all visible editors showing this document
    const editors = vscode.window.visibleTextEditors.filter(
        editor => editor.document.uri.toString() === document.uri.toString()
    );

    for (const editor of editors) {
        editor.setDecorations(unclosedCommentDecoration, decorationRanges);
    }
}

// --- DOMAIN MODEL ---

class Nexus {
    constructor() {
        this.taxa = new Map();
    }

    addTaxon(taxon) {
        // If handling interleaved, we might append to existing taxon here
        if (this.taxa.has(taxon.name)) {
            const existing = this.taxa.get(taxon.name);
            existing.concat(taxon.sequence);
        } else {
            this.taxa.set(taxon.name, taxon);
        }
    }

    getTaxon(name) {
        return this.taxa.get(name);
    }

    get ntax() {
        return this.taxa.size;
    }

    /**
     * Returns the length of the longest sequence in the matrix.
     */
    get maxSequenceLength() {
        let max = 0;
        for (const taxon of this.taxa.values()) {
            if (taxon.length > max) max = taxon.length;
        }
        return max;
    }
}

class Taxon {
    constructor(name, sequence, lineRange) {
        this.name = name;
        this.sequence = sequence; // Instance of Sequence
        this.lineRange = lineRange; // vscode.Range for error highlighting
    }

    concat(otherSequence) {
        this.sequence.pushSequence(otherSequence);
    }

    get length() {
        return this.sequence.length;
    }
}

class Sequence {
    constructor(rawString = "") {
        // Remove whitespace and Nexus inline comments [ ... ]
        this.bases = this._clean(rawString).split('');
    }

    push(base) {
        this.bases.push(base);
    }

    pushSequence(otherSequence) {
        this.bases = this.bases.concat(otherSequence.bases);
    }

    _clean(str) {
        // PARSER FIX: Use a stack-based approach to correctly handle nested comments.
        // The previous regex /\[.*?\]/g failed on nested structures like [[[]]],
        // potentially hiding invalid structures from the parser.
        
        let clean = '';
        let stack = 0;
        let inQuote = false;

        for (let i = 0; i < str.length; i++) {
            const char = str[i];
            
            // Handle Quotes
            if (char === "'") {
                if (inQuote && i + 1 < str.length && str[i+1] === "'") {
                    // Escaped quote: skip next char, keep one quote if we are not in a comment
                    i++; 
                    if (stack === 0) clean += "'";
                    continue;
                }
                inQuote = !inQuote;
                if (stack === 0) clean += "'"; // Keep quotes that are part of data
                continue;
            }

            // Handle Comments (only if not in quote)
            if (!inQuote) {
                if (char === '[') {
                    stack++;
                    continue; // Skip comment start
                }
                if (char === ']') {
                    if (stack > 0) stack--;
                    continue; // Skip comment end
                }
            }

            // Keep character if we are not deep in a comment
            if (stack === 0) {
                clean += char;
            }
        }
        
        return clean.replace(/\s/g, '');
    }

    toString() {
        return this.bases.join('');
    }

    get length() {
        return this.bases.length;
    }
}

// --- PARSER ---

class NexusParser {
    parse(document) {
        const nexus = new Nexus();
        const text = document.getText();
        
        // Find MATRIX block
        const matrixRegex = /\bMATRIX\b\s*([\s\S]*?)\s*;/i;
        const matrixMatch = matrixRegex.exec(text);

        if (!matrixMatch) return nexus;

        // Calculate offset to map back to line numbers
        const matrixStartOffset = matrixMatch.index + matrixMatch[0].indexOf(matrixMatch[1]);
        const startLine = document.positionAt(matrixStartOffset).line;
        const endLine = document.positionAt(matrixStartOffset + matrixMatch[1].length).line;

        for (let i = startLine; i <= endLine; i++) {
            const line = document.lineAt(i);
            const textLine = line.text.trim();

            if (!textLine || textLine.startsWith('[') || textLine === ';') continue;

            // Regex: Group 2 is Quoted Name, Group 3 is Simple Name, Group 4 is Sequence
            const rowRegex = /^\s*('([^']+)'|(\S+))\s+(.*)$/;
            const match = rowRegex.exec(line.text);

            if (match) {
                const name = match[2] || match[3];
                const rawSeq = match[4];
                
                const sequence = new Sequence(rawSeq);
                const taxon = new Taxon(name, sequence, line.range);
                
                nexus.addTaxon(taxon);
            }
        }

        return nexus;
    }
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};