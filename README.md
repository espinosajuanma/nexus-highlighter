# NEXUS Bioinformatics Support for VS Code

This extension provides robust syntax highlighting and structure validation for
NEXUS (`.nex`, `.nxs`) files, commonly used in bioinformatics and phylogenetics
(PAUP*, MrBayes, BEAST, etc.).

## Features

### 1. Syntax Highlighting

* **Matrix Awareness:** Nucleotides are only highlighted inside `MATRIX` blocks.

* **Taxon Names:** Intelligently identifies taxon names (first word/quoted
string on a line) to distinguish them from sequence data.

* **Comments:** Supports standard NEXUS comments `[ ... ]`.

### 2. Real-time Validation

The extension automatically checks your file structure and provides error
warnings (red squiggles) for:

* **NTAX Mismatches:** Verifies if `NTAX` matches the actual number of taxa rows
in the matrix.

* **NCHAR Mismatches:** Verifies if `NCHAR` matches the longest sequence in the
matrix.

* **Row Consistency:** Warns if a specific taxon row length does not match the
defined `NCHAR`.

## Requirements

No external dependencies required.
