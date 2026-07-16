# Invoice visual regression

Target: A4 (595.28 x 841.89 pt), 300 DPI

| Case | Page | Rule X error | Rule Y error | Text max error | Checked font max error | ₹ baseline error | Tax center error | Diagnostic diff % | Structural result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| fcapl-igst-no-rounding | 595.28 x 841.89 | 0.000 | 0.000 | 1.087 | 0.000 | 0.000 | 0.003 | 5.599374% | PASS |
| fcapl-igst-rounding | 595.28 x 841.89 | 0.000 | 0.000 | 1.110 | 0.000 | 0.000 | 0.003 | 5.724418% | PASS |
| fcapl-cgst-sgst | 595.28 x 841.89 | 0.000 | 0.000 | 0.878 | 0.000 | 0.000 | 0.003 | 6.299151% | PASS |
| fcs-igst-no-rounding | 595.28 x 841.89 | 0.010 | 0.000 | 1.843 | 0.001 | 0.000 | 0.003 | 6.174463% | PASS |
| fcs-igst-rounding | 595.28 x 841.89 | 0.000 | 0.000 | 0.953 | 0.002 | 0.000 | 0.003 | 6.011434% | PASS |
| fcs-cgst-sgst | 595.28 x 841.89 | 0.000 | 0.000 | 1.347 | 0.001 | 0.000 | 0.003 | 6.467741% | PASS |

The client-email anchor is position-gated but its fitted font size is diagnostic: the source PDFs clip the sample address, while the production PDF preserves the complete dynamic email inside its cell.

Overall: PASS
