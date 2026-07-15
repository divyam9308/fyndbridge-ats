# Invoice visual regression

Target: A4 (595.28 x 841.89 pt), 300 DPI

| Case | Page | X max error | Y max error | Diagnostic diff % | Structural result |
|---|---:|---:|---:|---:|---|
| fcapl-igst-no-rounding | 595.28 x 841.89 | 0.000 | 0.000 | 7.040394% | PASS |
| fcapl-igst-rounding | 595.28 x 841.89 | 0.000 | 0.000 | 6.933114% | PASS |
| fcapl-cgst-sgst | 595.28 x 841.89 | 0.000 | 0.000 | 7.531263% | PASS |
| fcs-igst-no-rounding | 595.28 x 841.89 | 0.010 | 0.000 | 7.526793% | PASS |
| fcs-igst-rounding | 595.28 x 841.89 | 0.000 | 0.000 | 6.969318% | PASS |
| fcs-cgst-sgst | 595.28 x 841.89 | 0.000 | 0.000 | 7.612955% | PASS |

Overall: PASS
