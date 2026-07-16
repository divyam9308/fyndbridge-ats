# Invoice visual regression harness

This development-only harness calls the production `renderInvoicePdf` function
with six controlled fixtures, writes the PDFs to `output/pdf`, and creates
300-DPI reference renders, generated renders, overlays, diff images, and reports
under `output/invoice-visual-regression`.

## Requirements

- Node dependencies installed for the root and `server` packages.
- Python 3 with PyMuPDF and Pillow:

```sh
python3 -m pip install pymupdf pillow
```

## Run

From the repository root:

```sh
node server/scripts/invoice-visual-regression.js \
  --references "/Users/divyamaggarwal/Downloads"
```

`--references` defaults to `~/Downloads`. During layout iteration, add
`--no-fail` to create every artifact while allowing a non-matching run to exit
successfully. Use `--list` to print the six stable case IDs and `--case ID` to
run a subset.

The same run is available as `npm run invoice:visual` from the repository root,
or `npm run invoice:visual` from `server`.

## A4 normalization and hard gate

The supplied source PDFs report a 612 x 792 point Letter media box, while the
required generated invoice is A4 (595.28 x 841.89 points). Each explicit case
uses the measured A4 adaptation encoded in the six fixture profiles:

- horizontal coordinates, font sizes, logo dimensions, and rule thicknesses use
  the uniform `595.275590551 / 612` scale;
- fixed vertical sections use the same scale;
- the case-specific service-table body and signature blank zones absorb A4's
  additional height.

The hard gate checks one-page A4 structure, the case's measured major x/y rule
coordinates, rule thicknesses, title/metadata/body font sizes, embedded fonts,
logo resolution, selectable text, rupee glyphs, mixed-font currency baseline
alignment, expected fixture text, stable
text-anchor coordinates (including client values and issuer-detail rows),
per-anchor font sizes, centered tax-summary amount values, off-page or
overlapping text, and off-page drawings.
The complete client email is fitted into its cell instead of reproducing the
source PDFs' clipped sample value, so that one anchor's font size is reported
diagnostically while its x/y position remains a hard assertion.

## Diff policy

The default raster resolution is 300 DPI. A case-specific piecewise transform
maps each Letter reference to the A4 rule profile for overlays. This necessarily
stretches rasterized glyphs inside the two elastic zones, and four references
also contain known incorrect tax values. Pixel differences are therefore
diagnostic, not the hard pass condition. A nonzero diff is expected.

RGB changes of 12 or less per channel are treated as antialiasing noise. The
report records the advisory 0.1% threshold, strict zero-tolerance changed-pixel
count, mean delta, and RMS delta so the visual evidence remains explicit.
