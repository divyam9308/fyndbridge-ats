# Invoice reference PDF forensic measurements

Coordinate convention: PDF points, origin at the top-left, as reported by PyMuPDF. All six source PDFs are 612 x 792 pt (US Letter), portrait, one page, with no crop/rotation. Production has separately been specified as A4; the final section gives an A4 mapping that preserves the source proportions without stretching the logo.

Every source was rendered to 2550 x 3300 PNG at 300 DPI and visually inspected. Renders are in `tmp/pdfs/reference-300dpi/` and the independently rendered `*_p1_300dpi.png` files.

## Shared visual facts

- White page, black rules and text; there are no fills other than the logo.
- The rule geometry is emitted as filled rectangles by Excel, not stroked paths. Reproducing rules as filled rectangles is the safest way to match intersections and thickness.
- Main typeface: embedded subset `ArialMT` and `Arial-BoldMT`; every referenced font has `/FontFile2` embedded.
- A few spreadsheet cells use Calibri accidentally. Those cells coincide with visibly malformed numeric formatting; production should use Arial consistently rather than copy the anomaly.
- Source body sizes vary by Excel print scaling per case: 8.88-9.24 pt. Top metadata is 9.36-9.72 pt and `TAX INVOICE` is 14.88-15.48 pt.
- Exact Arial files exist at `/System/Library/Fonts/Supplemental/Arial.ttf` and `/System/Library/Fonts/Supplemental/Arial Bold.ttf`.
- There is one transparent raster logo per page and no other image/signature.
- Solid logo colors in the highest-resolution extracted logo: navy `#001264`, gold `#DBB111`, tagline dark navy `#0A1130` (plus antialiasing).
- Highest-resolution alpha-correct extraction: `tmp/pdfs/reference_logo_507x80_rgba.png`.
- Common alignment: table headings centered; line item description left; SL/SAC/rates/% centered; money right; total labels left; total money right; signature captions right.
- Common absolute left text x is about 23.88 pt. This is 1.3-2.3 pt after the left rule's x origin depending on rule thickness.

## 1. FCAPL CGST + SGST

Source: `FCAPL CGST SGST.pdf`.

- Rule thickness: 0.84 pt throughout.
- Outer border: left 21.72..22.56, right 584.40..585.24, top 21.72..22.56, bottom 698.26..699.10.
- Main centre divider: x 337.87..338.71.
- Service-table x boundaries (rule origins): `[21.72, 68.88, 262.49, 337.87, 421.75, 479.50, 584.40]`.
- Service column widths: `[47.16, 193.61, 75.38, 83.88, 57.75, 104.90]`.
- Tax-summary x boundaries: `[21.72, 68.88, 186.14, 262.49, 337.87, 421.75, 479.50, 584.40]`.
- Bottom description/bank divider: x 337.87.
- Full-width horizontal rule y origins: `[21.72, 66.98, 85.10, 237.65, 257.81, 410.09, 424.75, 439.39, 454.03, 467.95, 495.79, 509.71, 523.63, 537.55, 610.42, 698.26]`.
- Nested-summary partial rule: y 481.87, x 186.98..480.33.
- Row heights from rule origins: header 45.26; invoice/date 18.12; bill/from 152.55; service heading 20.16; service body 152.28; total-before 14.66; round-off 14.64; total 14.64; words 13.92; summary 55.68 total; tax-words 13.92; description/bank 72.87; signature 87.84 pt.
- Logo bbox `[27.30, 30.87, 202.25, 58.70]`, displayed 174.95 x 27.83 pt; embedded 485 x 77 px.
- `TAX INVOICE` bbox `[487.78, 36.23, 582.04, 52.82]`.
- Type scale: Arial body/bold 8.88; top metadata 9.36 bold; title 14.88 bold.
- Body tax text bboxes: CGST `[182.66,354.53,261.43,364.43]`, SGST `[190.94,370.25,261.43,380.15]`; the labels are right-aligned to the description-column boundary.

## 2. FCAPL IGST, no rounding

Source: `FCAPL NOROUNDING (1).pdf`.

- Rule thickness: 0.96 pt, except the service-heading bottom rule at y 274.25 is 1.80 pt.
- Outer border: left 21.60..22.56, right 588.24..589.20, top 21.60..22.56, bottom 720.34..721.30.
- Main centre divider: x 333.79..334.75.
- Service-table x boundaries: `[21.60, 70.32, 254.57, 333.79, 420.43, 479.98, 588.24]`.
- Service column widths: `[48.72, 184.25, 79.22, 86.64, 59.55, 108.26]`.
- IGST-summary x boundaries: `[21.60, 184.10, 333.79, 479.98, 588.24]`.
- Bottom description/bank divider: x 333.79.
- Full-width horizontal y origins: `[21.60, 68.42, 87.14, 253.73, 274.25, 455.83, 470.95, 485.35, 508.39, 522.79, 537.19, 551.59, 627.94, 720.34]`.
- Row heights: header 46.82; invoice/date 18.72; bill/from 166.59; service heading 20.52; service body 181.58; total 15.12; words 14.40; summary heading 23.04; data 14.40; summary total 14.40; tax-words 14.40; description/bank 76.35; signature 92.40 pt.
- Logo bbox `[27.48,31.17,208.23,59.93]`, displayed 180.75 x 28.76 pt; embedded 502 x 79 px.
- `TAX INVOICE` bbox `[488.26,36.76,586.10,53.89]`.
- Type scale: Arial body/bold 9.12; top metadata 9.60 bold; title 15.36 bold. Three malformed tax cells are Calibri 10.56 and should not be copied.
- IGST label bbox `[161.66,397.16,253.71,407.33]`.

## 3. FCAPL IGST, with rounding

Source: `FCAPL WITH ROUNDOFF.pdf`.

- Rule thickness: 0.84 pt, except the service-heading bottom rule at y 263.45 is 1.80 pt.
- Outer border: left 21.72..22.56, right 585.48..586.32, top 21.72..22.56, bottom 756.58..757.42.
- Main centre divider: x 336.07..336.91.
- Service-table x boundaries: `[21.72, 68.88, 257.81, 336.07, 419.95, 477.70, 585.48]`.
- Service column widths: `[47.16, 188.93, 78.26, 83.88, 57.75, 107.78]`.
- IGST-summary x boundaries: `[21.72, 179.06, 336.07, 477.70, 585.48]`.
- Bottom description/bank divider: x 336.07.
- Full-width horizontal y origins: `[21.72, 66.98, 85.10, 243.77, 263.45, 473.95, 488.59, 503.23, 517.87, 531.79, 554.11, 568.03, 581.95, 595.87, 668.74, 756.58]`.
- Row heights: header 45.26; invoice/date 18.12; bill/from 158.67; service heading 19.68; service body 210.50; total-before 14.64; round-off 14.64; total 14.64; words 13.92; summary heading 22.32; data 13.92; summary total 13.92; tax-words 13.92; description/bank 72.87; signature 87.84 pt.
- Logo bbox `[27.30,30.87,202.32,58.70]`, displayed 175.02 x 27.83 pt; embedded 486 x 77 px.
- `TAX INVOICE` bbox `[488.86,36.23,583.12,52.82]`.
- Type scale: Arial body/bold 8.88; top metadata 9.36 bold; title 14.88 bold. Three malformed tax cells are Calibri 10.20 and should not be copied.
- IGST label bbox `[163.58,399.17,256.71,409.07]`.

## 4. FCS IGST, no rounding

Source: `FCS NoRounding.pdf`.

- Major rule thickness: 1.92 pt for the outer border and full-width section rules. Internal service/summary rules are 0.96 pt.
- Outer border: left 21.12..23.04, right 586.56..588.48, top 21.12..23.04, bottom 766.06..767.98.
- Main centre divider is x 337.39..339.31 in bill/from and bottom details. The service-table divider uses x 337.87..338.83 (0.48 pt offset).
- Service-table x boundaries: `[21.12, 70.80, 261.29, 337.87, 425.35, 485.50, 586.56]` (outer right visible edge is 588.48).
- Effective service widths from rule origins: `[49.68, 190.49, 76.58, 87.48, 60.15, 101.06]`.
- IGST-summary x boundaries: `[21.12, 190.10, 337.87, 485.50, 586.56]`.
- Full-width horizontal y origins: `[21.12, 68.30, 87.14, 241.13, 262.25, 498.79, 514.03, 528.55, 580.87, 595.39, 663.70, 766.06]`, all 1.92 pt.
- Internal summary rules: y 552.31 and 566.83, x 23.04..586.56, thickness 0.96.
- Row heights: header 47.18; invoice/date 18.84; bill/from 153.99; service heading 21.12; service body 236.54; total 15.24; words 14.52; summary heading 23.76; data 14.52; summary total 14.04; tax-words 14.52; description/bank 68.31; signature 102.36 pt.
- Logo bbox `[27.55,31.27,210.07,60.18]`, displayed 182.52 x 28.91 pt; embedded 506 x 80 px.
- `TAX INVOICE` bbox `[486.34,36.89,584.90,54.15]`.
- Type scale: Arial body/bold 9.24; top metadata 9.72 bold; title 15.48 bold.
- IGST label bbox `[167.06,429.95,260.38,440.25]`.

## 5. FCS IGST, with rounding

Source: `FCS with roundoff.pdf`.

- Rule thickness: 0.96 pt throughout.
- Outer border: left 21.60..22.56, right 586.08..587.04, top 21.60..22.56, bottom 763.42..764.38.
- Main centre divider: x 346.39..347.35.
- Service-table x boundaries: `[21.60, 69.36, 273.65, 346.39, 431.26, 489.58, 586.08]`.
- Service column widths: `[47.76, 204.29, 72.74, 84.87, 58.32, 96.50]`.
- IGST-summary x boundaries: `[21.60, 193.70, 346.39, 489.58, 586.08]`.
- Bottom description/bank divider: x 346.39.
- Full-width horizontal y origins: `[21.60, 67.22, 85.46, 243.89, 264.29, 476.83, 491.59, 506.35, 521.11, 535.27, 557.83, 571.99, 586.15, 600.34, 674.86, 763.42]`.
- Row heights: header 45.62; invoice/date 18.24; bill/from 158.43; service heading 20.40; service body 212.54; total-before 14.76; round-off 14.76; total 14.76; words 14.16; summary heading 22.56; data 14.16; summary total 14.16; tax-words 14.19; description/bank 74.52; signature 88.56 pt.
- Logo bbox `[27.36,30.97,204.36,58.95]`, displayed 177.00 x 27.98 pt; embedded 491 x 77 px.
- `TAX INVOICE` bbox `[489.10,36.37,583.96,53.09]`.
- Type scale: Arial body/bold 9.00; top metadata 9.36 bold; title 15.00 bold. `State Code`/`GSTIN` are accidental Calibri 10.32 in the source; use Arial in production.
- IGST label bbox `[181.70,413.73,272.71,423.76]`.

## 6. FCS CGST + SGST

Source: `FCS_CGST_SGST.pdf`.

- Rule thickness: 0.96 pt throughout.
- Outer border: left 21.60..22.56, right 588.72..589.68, top 21.60..22.56, bottom 727.66..728.62.
- Main centre divider: x 331.63..332.59.
- Service-table x boundaries: `[21.60, 70.80, 244.49, 331.63, 419.11, 479.26, 588.72]`.
- Service column widths: `[49.20, 173.69, 87.14, 87.48, 60.15, 109.46]`.
- Tax-summary x boundaries: `[21.60, 70.80, 173.30, 244.49, 331.63, 419.11, 479.26, 588.72]`.
- Bottom description/bank divider: x 331.63.
- Full-width horizontal y origins: `[21.60, 68.78, 87.62, 241.61, 262.73, 421.63, 436.87, 452.11, 467.35, 481.87, 510.91, 525.43, 539.95, 554.47, 622.78, 727.66]`.
- Nested-summary partial rule: y 496.39, x 174.26..480.21.
- Extra reference-only vertical divider in the rounding row: x 479.26, y 437.83..453.07.
- Row heights: header 47.18; invoice/date 18.84; bill/from 153.99; service heading 21.12; service body 158.90; total-before 15.24; round-off 15.24; total 15.24; words 14.52; summary 58.08 total; tax-words 14.52; description/bank 68.31; signature 104.88 pt.
- Logo bbox `[27.55,31.27,210.14,60.18]`, displayed 182.59 x 28.91 pt; embedded 507 x 80 px.
- `TAX INVOICE` bbox `[488.02,36.89,586.58,54.15]`.
- Type scale: Arial body/bold 9.24; top metadata 9.72 bold; title 15.48 bold. The unformatted SGST amount is accidental Calibri 10.68 and should not be copied.
- Body tax bboxes: CGST `[161.54,362.61,243.54,372.91]`; SGST `[170.54,378.57,243.57,388.87]`.

## Controlled fixture content

### Common client/service fixture

- Client: `M/S SMT SHAKUNTLA EDUCATIONAL & WELFARE SOCIETY`
- Address: `PLOT NO. 1, KNOWLEDGE PARK II, GREATER NOIDA, Gautambuddha Nagar, Uttar Pradesh, 201301`
- PAN / IT No: `AABTS7575D`
- Place of Supply: `Greater Noida`
- State / code: `Uttar Pradesh` / `09`
- GSTIN: `09AABTS7575D1Z6`
- Contact Person: `Shilpi Chandra`
- Email visibly clips in every source at `shilpi.chandra@galgotiasuniversi`; use the full dynamic value and deterministic wrapping/clipping policy, not this fragment as business data.
- Service: `Professional Fee`; SAC `998312`.
- Bottom description: `Permanent placement services, other than executive search services`.
- Reverse charge: `No`.
- Date: `24-06-2026`.

There is no separate literal `Name` label in any of the six PDFs. The only plausible optional-name field demonstrated is `Contact Person`, and it is populated in all six. An absent-state layout is therefore not directly specified by these references.

### FCAPL entity fixture

- Invoice no: `FCAPL/26-27/001`.
- Entity: `FyndBridge Consultants & Advisors Private Limited`.
- Registered office: `Second Floor, House No- A-34, Pocket A-8, Kalkaji Extension, Behind Aggarwal Sweet House, New Delhi, South East Delhi, Delhi - 110019`.
- Mobile/email: `9717773066`, `partner@fyndbridge.in`.
- State/code: `Delhi`, `07`.
- GSTIN: `07AAFCF8821L1ZA`; CIN: `U70200DL2024PTC429251`; PAN: `AAFCF8821L`.
- Bank: `State Bank of India`; IFSC `SBIN0000727`; A/c `42926962136`; branch `233 Okhla Industrial Estate, New Delhi - 110020`.
- Signature caption: `For FyndBridge Consultants & Advisors Private Limited`.

### FCS entity fixture

- Invoice no: `FB/26-27/012`.
- Entity: `FyndBridge Consulting Services`.
- Registered office: `Ground Floor, 20, New Delhi, Okhla Industrial Estate Phase 3, New Delhi, South East Delhi, Delhi, 110020`.
- Mobile/email: `9717773066`, `partner@fyndbridge.in`.
- State/code: `Delhi`, `07`.
- GSTIN: `07AAJFF1433D1ZV`; no CIN in the references; PAN `AAJFF1433D`.
- Bank: `ICICI Bank Limited`; IFSC `ICIC0001023`; A/c `102305501028`; branch `233 Okhla Industrial Estate, New Delhi - 110020`.
- Signature caption: `For FyndBridge Consulting Services`.

### Numerically correct variant fixtures

Use these values for generated comparisons. They preserve the intended samples while fixing obvious spreadsheet formula/format defects.

1. IGST, no rounding (FCAPL and FCS): taxable `₹5,60,000.00`; IGST 18% `₹1,00,800.00`; final total `₹6,60,800.00`; charge words `INR Six Lakh Sixty Thousand Eight Hundred Only`; tax words `One Lakh Eight Hundred Rupees Only`.
2. IGST, with rounding (FCAPL and FCS): taxable `₹5,58,720.00`; IGST 18% `₹1,00,569.60`; total before `₹6,59,289.60`; adjustment `(+)₹0.40`; final `₹6,59,290.00`; charge words `INR Six Lakh Fifty Nine Thousand Two Hundred Ninety Only`; tax words `One Lakh Five Hundred Sixty Nine Rupees and Sixty Paise Only`.
3. CGST + SGST (FCAPL and FCS): taxable `₹5,58,720.00`; CGST 9% `₹50,284.80`; SGST 9% `₹50,284.80`; total tax `₹1,00,569.60`; total before `₹6,59,289.60`; adjustment `(+)₹0.40`; final `₹6,59,290.00`; the same charge/tax words as item 2.

Reference defects that must not be treated as fixtures:

- FCAPL no-rounding prints body tax as `100800` and summary tax as `₹0.00`, although its final total includes tax.
- FCAPL with-rounding mixes the `₹5,60,000` line item with totals/words from the `₹5,58,720` round-off fixture and zero summary tax.
- FCAPL CGST shows body/summary tax as zero and excludes tax from numeric total, while its words are for `₹6,59,290`.
- FCS CGST prints SGST as `50284.8`, zeros the tax summary, and excludes tax from numeric total, while its words are for `₹6,59,290`.
- FCS no-rounding and FCS with-rounding are the internally consistent canonical value examples.

## Recommended A4 adaptation

Production requirement is A4: `595.276 x 841.890 pt`.

Avoid directly changing the page to A4 while retaining Letter x coordinates (right-side clipping) and avoid non-uniformly stretching the whole reference (logo/font distortion).

Recommended deterministic transform:

- `sx = 595.275590551 / 612 = 0.9726725336`.
- Scale every x coordinate, horizontal width, font size, rule thickness, and logo width/height by `sx`.
- Uniformly scaled Letter height is 770.357 pt; A4 has 71.533 pt additional height.
- Put that 71.533 pt only into the two elastic blank zones: the service-table body and the signature area, split in proportion to their source heights. Preserve all fixed row heights with the same `sx` scale and map tax-label baselines proportionally within the stretched service body.
- Anchor the final border to the source-relative A4 bottom margin. This keeps the logo aspect ratio and exact row typography while using A4's added height for whitespace.

Resulting A4 major x boundaries and full horizontal boundaries (same case order as above):

1. FCAPL CGST: x `[21.13,67.00,255.32,328.64,410.22,466.40,568.43]`; y `[21.13,65.15,82.77,231.16,250.76,444.25,458.51,472.75,486.99,500.53,514.07,527.61,541.15,554.69,568.23,639.10,750.71]`; elastic addition split service/signature `45.365/26.168` pt.
2. FCAPL IGST no round: x `[21.01,68.40,247.61,324.67,408.94,466.86,572.16]`; y `[21.01,66.55,84.76,246.80,266.76,490.78,505.49,519.50,541.91,555.91,569.92,583.92,658.19,772.19]`; split `47.409/24.125`.
3. FCAPL IGST round: x `[21.13,67.00,250.76,326.89,408.47,464.65,569.48]`; y `[21.13,65.15,82.77,237.11,256.25,511.47,525.71,539.95,554.19,567.73,589.44,602.98,616.52,630.06,700.94,807.44]`; split `50.472/21.061`.
4. FCS IGST no round: x `[20.54,68.87,254.15,328.64,413.73,472.23,570.53]` (the 1.92-pt outer rule's visible right edge is 572.40); y `[20.54,66.43,84.76,234.54,255.08,535.09,549.91,564.03,587.14,601.27,614.92,629.05,695.49,816.66]`; split `49.928/21.606`.
5. FCS IGST round: x `[21.01,67.46,266.17,336.92,419.47,476.20,570.06]`; y `[21.01,65.38,83.12,237.23,257.07,514.29,528.65,543.01,557.36,571.14,593.08,606.85,620.63,634.43,706.91,814.09]`; split `50.494/21.039`.
6. FCS CGST: x `[21.01,68.87,237.81,322.57,407.66,466.16,572.63]`; y `[21.01,66.90,85.23,235.01,255.55,453.20,468.02,482.85,497.67,511.79,525.92,540.04,554.16,568.29,582.41,648.85,779.31]`; split `43.091/28.442`.

The A4 coordinates are an adaptation recommendation, not measurements observed in the Letter references. The native source coordinates above remain the audit ground truth.
