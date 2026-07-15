# Invoice visual regression

Target: A4 (595.28 x 841.89 pt), 300 DPI

| Case | Page | Rule X error | Rule Y error | Text max error | Checked font max error | Diagnostic diff % | Structural result |
|---|---:|---:|---:|---:|---:|---:|---|
| fcapl-igst-no-rounding | 595.28 x 841.89 | 0.000 | 0.000 | 1.087 | 0.000 | 5.631373% | PASS |
| fcapl-igst-rounding | 595.28 x 841.89 | 0.000 | 0.000 | 1.110 | 0.000 | 5.763736% | PASS |
| fcapl-cgst-sgst | 595.28 x 841.89 | 0.000 | 0.000 | 0.878 | 0.000 | 6.322762% | PASS |
| fcs-igst-no-rounding | 595.28 x 841.89 | 0.010 | 0.000 | 1.843 | 0.001 | 6.214356% | PASS |
| fcs-igst-rounding | 595.28 x 841.89 | 0.000 | 0.000 | 0.953 | 0.002 | 6.046857% | PASS |
| fcs-cgst-sgst | 595.28 x 841.89 | 0.000 | 0.000 | 1.347 | 0.001 | 6.489388% | PASS |

The client-email anchor is position-gated but its fitted font size is diagnostic: the source PDFs clip the sample address, while the production PDF preserves the complete dynamic email inside its cell.

Overall: PASS
