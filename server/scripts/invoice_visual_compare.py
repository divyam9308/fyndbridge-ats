#!/usr/bin/env python3
"""Render, normalize, inspect, and pixel-diff generated invoice PDFs."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

try:
    import fitz  # PyMuPDF
    from PIL import Image, ImageChops
except ModuleNotFoundError as error:
    missing = error.name or "required package"
    raise SystemExit(
        f"Missing {missing}. Install the visual-test dependencies with: "
        "python3 -m pip install pymupdf pillow"
    ) from error


A4_WIDTH_POINTS = 595.28
A4_HEIGHT_POINTS = 841.89
PAGE_TOLERANCE_POINTS = 0.05


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--dpi", type=int, default=300)
    parser.add_argument("--pixel-tolerance", type=int, default=12)
    parser.add_argument("--max-diff-percent", type=float, default=0.1)
    parser.add_argument("--no-fail", action="store_true")
    return parser.parse_args()


def sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def render_page(page: fitz.Page, dpi: int) -> Image.Image:
    scale = dpi / 72
    pixmap = page.get_pixmap(
        matrix=fitz.Matrix(scale, scale),
        colorspace=fitz.csRGB,
        alpha=False,
        annots=True,
    )
    return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def target_pixel_size(dpi: int) -> tuple[int, int]:
    # MuPDF raster bounds use the enclosing integer rectangle (ceil), not round.
    return (
        math.ceil(A4_WIDTH_POINTS * dpi / 72),
        math.ceil(A4_HEIGHT_POINTS * dpi / 72),
    )


def generated_a4_comparison_canvas(image: Image.Image, dpi: int) -> tuple[Image.Image, int]:
    width, height = target_pixel_size(dpi)
    canvas = Image.new("RGB", (width, height), "white")
    copied_width = min(width, image.width)
    copied_height = min(height, image.height)
    canvas.paste(image.crop((0, 0, copied_width, copied_height)), (0, 0))

    cropped_nonwhite = 0
    if image.width > width:
        cropped = image.crop((width, 0, image.width, min(image.height, height)))
        extrema = ImageChops.difference(cropped, Image.new("RGB", cropped.size, "white"))
        maximum = max_channel_image(extrema)
        histogram = maximum.histogram()
        cropped_nonwhite += sum(histogram[6:])
    if image.height > height:
        cropped = image.crop((0, height, min(image.width, width), image.height))
        extrema = ImageChops.difference(cropped, Image.new("RGB", cropped.size, "white"))
        maximum = max_channel_image(extrema)
        histogram = maximum.histogram()
        cropped_nonwhite += sum(histogram[6:])
    return canvas, cropped_nonwhite


def point_to_pixel(value: float, dpi: int, maximum: int) -> int:
    return max(0, min(maximum, round(value * dpi / 72)))


def normalize_reference_to_a4(image: Image.Image, dpi: int, profile: dict) -> tuple[Image.Image, list[dict]]:
    """Piecewise-map a Letter reference raster to its forensic A4 profile.

    Fixed-height sections scale by the common 0.9726725 factor. The service-body
    and signature strips absorb the case-specific elastic height. This aligns
    rule geometry for overlays; text inside elastic strips is intentionally a
    diagnostic approximation and is therefore not a pixel-perfect pass target.
    """
    width, height = target_pixel_size(dpi)
    source_points = [0.0, *profile["source_y_points"], 792.0]
    target_points = [0.0, *profile["target_y_points"], A4_HEIGHT_POINTS]
    if len(source_points) != len(target_points):
        raise ValueError("A4 profile source/target y-boundary counts differ")

    canvas = Image.new("RGB", (width, height), "white")
    segments = []
    for index in range(len(source_points) - 1):
        source_top = point_to_pixel(source_points[index], dpi, image.height)
        source_bottom = point_to_pixel(source_points[index + 1], dpi, image.height)
        target_top = point_to_pixel(target_points[index], dpi, height)
        target_bottom = point_to_pixel(target_points[index + 1], dpi, height)
        if source_bottom <= source_top or target_bottom <= target_top:
            continue
        source_strip = image.crop((0, source_top, image.width, source_bottom))
        target_size = (width, target_bottom - target_top)
        canvas.paste(source_strip.resize(target_size, Image.Resampling.LANCZOS), (0, target_top))
        segments.append({
            "source_points": [source_points[index], source_points[index + 1]],
            "target_points": [target_points[index], target_points[index + 1]],
            "vertical_scale": (target_points[index + 1] - target_points[index]) / (source_points[index + 1] - source_points[index]),
        })
    return canvas, segments


def max_channel_image(difference: Image.Image) -> Image.Image:
    red, green, blue = difference.split()
    return ImageChops.lighter(ImageChops.lighter(red, green), blue)


def nearest_errors(actual: list[float], expected: list[float]) -> list[dict]:
    if not actual:
        return [{"expected": value, "actual": None, "error": None} for value in expected]
    return [
        {
            "expected": value,
            "actual": min(actual, key=lambda candidate: abs(candidate - value)),
            "error": min(abs(candidate - value) for candidate in actual),
        }
        for value in expected
    ]


def profile_check(actual: list[float], expected: list[float], tolerance: float) -> dict:
    errors = nearest_errors(actual, expected)
    numeric_errors = [item["error"] for item in errors if item["error"] is not None]
    return {
        "tolerance_points": tolerance,
        "max_error_points": max(numeric_errors, default=None),
        "errors": errors,
        "passed": len(numeric_errors) == len(expected) and all(error <= tolerance for error in numeric_errors),
    }


def drawing_profile(page: fitz.Page) -> dict:
    vertical = []
    horizontal = []
    thicknesses = []
    for drawing in page.get_drawings():
        rect = drawing["rect"]
        width = abs(rect.width)
        height = abs(rect.height)
        stroke_width = drawing.get("width")
        if stroke_width and stroke_width > 0:
            thicknesses.append(float(stroke_width))
        if height > 10 and width <= 3:
            vertical.extend([rect.x0, (rect.x0 + rect.x1) / 2])
            if width > 0:
                thicknesses.append(width)
        if width > 10 and height <= 3:
            horizontal.extend([rect.y0, (rect.y0 + rect.y1) / 2])
            if height > 0:
                thicknesses.append(height)
        if width > 10 and height > 10:
            # PDFKit may emit the outer border as one stroked rectangle.
            vertical.extend([rect.x0, rect.x1])
            horizontal.extend([rect.y0, rect.y1])
    return {
        "vertical_points": sorted(set(round(value, 4) for value in vertical)),
        "horizontal_points": sorted(set(round(value, 4) for value in horizontal)),
        "thickness_points": sorted(set(round(value, 4) for value in thicknesses if 0 < value <= 4)),
    }


def span_matching(spans: list[dict], needle: str) -> dict | None:
    return next((span for span in spans if needle in span["text"]), None)


def overlapping_text_pairs(spans: list[dict]) -> list[dict]:
    overlaps = []
    for index, first in enumerate(spans):
        first_x0, first_y0, first_x1, first_y1 = first["bbox"]
        for second in spans[index + 1 :]:
            second_x0, second_y0, second_x1, second_y1 = second["bbox"]
            width = min(first_x1, second_x1) - max(first_x0, second_x0)
            height = min(first_y1, second_y1) - max(first_y0, second_y0)
            if width > 0.5 and height > 0.5 and width * height > 1:
                overlaps.append({
                    "first": first["text"],
                    "second": second["text"],
                    "intersection_points_squared": width * height,
                })
    return overlaps


def difference_metrics(reference: Image.Image, generated: Image.Image, tolerance: int) -> dict:
    difference = ImageChops.difference(reference, generated)
    maximum = max_channel_image(difference)
    histogram = maximum.histogram()
    total = reference.width * reference.height
    strict_changed = total - histogram[0]
    tolerated_changed = total - sum(histogram[: tolerance + 1])
    mean_max_delta = sum(value * count for value, count in enumerate(histogram)) / total
    rms_max_delta = math.sqrt(sum((value**2) * count for value, count in enumerate(histogram)) / total)
    return {
        "strict_changed_pixels": strict_changed,
        "strict_changed_percent": strict_changed * 100 / total,
        "changed_pixels": tolerated_changed,
        "changed_percent": tolerated_changed * 100 / total,
        "mean_max_channel_delta": mean_max_delta,
        "rms_max_channel_delta": rms_max_delta,
        "mask": maximum.point(lambda value: 255 if value > tolerance else 0),
    }


def inspect_pdf(pdf_path: Path, expected_text: list[str], dpi: int) -> tuple[dict, Image.Image]:
    document = fitz.open(pdf_path)
    page_count = document.page_count
    page = document[0] if page_count else None
    if page is None:
        return {
            "page_count": 0,
            "page_width_points": 0,
            "page_height_points": 0,
            "is_a4": False,
            "fonts": [],
            "all_fonts_embedded": False,
            "image_count": 0,
            "images": [],
            "largest_image_pixels": [0, 0],
            "selectable_text_length": 0,
            "has_rupee_symbol": False,
            "missing_expected_text": expected_text,
            "out_of_page_text_spans": 0,
            "overlapping_text_pairs": [],
            "out_of_page_drawings": 0,
            "drawing_profile": {"vertical_points": [], "horizontal_points": [], "thickness_points": []},
            "text_spans": [],
        }, Image.new("RGB", (1, 1), "white")

    rect = page.rect
    text = page.get_text("text")
    fonts = []
    for font in page.get_fonts(full=True):
        xref, extension, font_type, base_font, resource_name, encoding, *_ = font
        embedded_bytes = b""
        if xref:
            try:
                embedded_bytes = document.extract_font(xref)[3] or b""
            except (RuntimeError, ValueError):
                embedded_bytes = b""
        fonts.append({
            "base_font": base_font,
            "resource_name": resource_name,
            "type": font_type,
            "extension": extension,
            "embedded": bool(embedded_bytes),
        })

    outside_text = 0
    text_spans = []
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                x0, y0, x1, y1 = span.get("bbox", (0, 0, 0, 0))
                text_spans.append({
                    "text": span.get("text", ""),
                    "font": span.get("font", ""),
                    "size": span.get("size", 0),
                    "bbox": [x0, y0, x1, y1],
                })
                if x0 < -0.5 or y0 < -0.5 or x1 > rect.width + 0.5 or y1 > rect.height + 0.5:
                    outside_text += 1

    outside_drawings = 0
    for drawing in page.get_drawings():
        drawing_rect = drawing["rect"]
        if (
            drawing_rect.x0 < -0.5
            or drawing_rect.y0 < -0.5
            or drawing_rect.x1 > rect.width + 0.5
            or drawing_rect.y1 > rect.height + 0.5
        ):
            outside_drawings += 1

    images = [
        {"width": image[2], "height": image[3], "bits_per_component": image[4], "color_space": image[5]}
        for image in page.get_images(full=True)
    ]
    largest_image = max(images, key=lambda image: image["width"] * image["height"], default={"width": 0, "height": 0})

    inspection = {
        "page_count": page_count,
        "page_width_points": rect.width,
        "page_height_points": rect.height,
        "is_a4": (
            page_count == 1
            and abs(rect.width - A4_WIDTH_POINTS) <= PAGE_TOLERANCE_POINTS
            and abs(rect.height - A4_HEIGHT_POINTS) <= PAGE_TOLERANCE_POINTS
        ),
        "fonts": fonts,
        "all_fonts_embedded": bool(fonts) and all(font["embedded"] for font in fonts),
        "image_count": len(images),
        "images": images,
        "largest_image_pixels": [largest_image["width"], largest_image["height"]],
        "selectable_text_length": len(text.strip()),
        "has_rupee_symbol": "₹" in text,
        "missing_expected_text": [value for value in expected_text if value not in text],
        "out_of_page_text_spans": outside_text,
        "overlapping_text_pairs": overlapping_text_pairs(text_spans),
        "out_of_page_drawings": outside_drawings,
        "drawing_profile": drawing_profile(page),
        "text_spans": text_spans,
    }
    return inspection, render_page(page, dpi)


def invoice_profile_assertions(structure: dict, profile: dict) -> dict:
    drawings = structure["drawing_profile"]
    x_check = profile_check(drawings["vertical_points"], profile["target_x_points"], 1.0)
    y_check = profile_check(drawings["horizontal_points"], profile["target_y_points"], 1.0)
    thickness_check = profile_check(drawings["thickness_points"], profile["rule_thickness_points"], 0.22)

    spans = structure["text_spans"]
    title = span_matching(spans, "TAX INVOICE")
    metadata = span_matching(spans, "Invoice No.")
    # The bill-to heading intentionally uses the larger metadata size. The
    # service-table heading is the stable representative of the body profile.
    body = span_matching(spans, "SL.No")
    font_checks = {
        "tolerance_points": 0.4,
        "title": {
            "expected": profile["title_font_size"],
            "actual": title["size"] if title else None,
        },
        "metadata": {
            "expected": profile["metadata_font_size"],
            "actual": metadata["size"] if metadata else None,
        },
        "body": {
            "expected": profile["body_font_size"],
            "actual": body["size"] if body else None,
        },
    }
    for item in (font_checks["title"], font_checks["metadata"], font_checks["body"]):
        item["error"] = abs(item["actual"] - item["expected"]) if item["actual"] is not None else None
    font_checks["passed"] = all(
        item["error"] is not None and item["error"] <= font_checks["tolerance_points"]
        for item in (font_checks["title"], font_checks["metadata"], font_checks["body"])
    )

    return {
        "x_coordinates": x_check,
        "y_coordinates": y_check,
        "rule_thickness": thickness_check,
        "font_sizes": font_checks,
        "passed": x_check["passed"] and y_check["passed"] and thickness_check["passed"] and font_checks["passed"],
    }


def rounded_metrics(metrics: dict) -> dict:
    return {
        key: round(value, 6) if isinstance(value, float) else value
        for key, value in metrics.items()
        if key != "mask"
    }


def write_markdown(report: dict, output_path: Path) -> None:
    rows = [
        "# Invoice visual regression",
        "",
        f"Target: A4 (595.28 x 841.89 pt), {report['dpi']} DPI",
        "",
        "| Case | Page | X max error | Y max error | Diagnostic diff % | Structural result |",
        "|---|---:|---:|---:|---:|---|",
    ]
    for case in report["cases"]:
        structure = case["generated_structure"]
        x_error = case["profile_assertions"]["x_coordinates"]["max_error_points"]
        y_error = case["profile_assertions"]["y_coordinates"]["max_error_points"]
        rows.append(
            "| {id} | {width:.2f} x {height:.2f} | {x_error} | {y_error} | {percent:.6f}% | {result} |".format(
                id=case["id"],
                width=structure["page_width_points"],
                height=structure["page_height_points"],
                x_error=f"{x_error:.3f}" if x_error is not None else "n/a",
                y_error=f"{y_error:.3f}" if y_error is not None else "n/a",
                percent=case["pixel_difference"]["changed_percent"],
                result="PASS" if case["passed"] else "FAIL",
            )
        )
    rows.extend(["", f"Overall: {'PASS' if report['passed'] else 'FAIL'}", ""])
    output_path.write_text("\n".join(rows), encoding="utf-8")


def main(args: argparse.Namespace) -> int:
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    output = args.output.resolve()
    directories = {
        "reference_raw": output / "reference-raw",
        "reference_a4": output / "reference-a4",
        "generated_raw": output / "generated-raw",
        "generated_a4": output / "generated-a4",
        "diff": output / "diff",
        "overlay": output / "overlay",
    }
    for directory in directories.values():
        directory.mkdir(parents=True, exist_ok=True)

    report_cases = []
    for item in manifest["cases"]:
        case_id = item["id"]
        reference_path = Path(item["reference_pdf"])
        generated_path = Path(item["generated_pdf"])

        reference_document = fitz.open(reference_path)
        reference_page = reference_document[0]
        reference_raw = render_page(reference_page, args.dpi)
        reference_raw.save(directories["reference_raw"] / f"{case_id}.png", dpi=(args.dpi, args.dpi))
        reference_a4, normalization_segments = normalize_reference_to_a4(reference_raw, args.dpi, item["a4_profile"])
        reference_a4.save(directories["reference_a4"] / f"{case_id}.png", dpi=(args.dpi, args.dpi))

        generated_structure, generated_raw = inspect_pdf(generated_path, item.get("expected_text", []), args.dpi)
        generated_raw.save(directories["generated_raw"] / f"{case_id}.png", dpi=(args.dpi, args.dpi))
        generated_a4, cropped_generated_ink = generated_a4_comparison_canvas(generated_raw, args.dpi)
        generated_a4.save(directories["generated_a4"] / f"{case_id}.png", dpi=(args.dpi, args.dpi))

        metrics = difference_metrics(reference_a4, generated_a4, args.pixel_tolerance)
        faint_reference = Image.blend(reference_a4, Image.new("RGB", reference_a4.size, "white"), 0.72)
        diff_image = Image.composite(Image.new("RGB", reference_a4.size, (255, 0, 0)), faint_reference, metrics["mask"])
        diff_image.save(directories["diff"] / f"{case_id}.png", dpi=(args.dpi, args.dpi))
        Image.blend(reference_a4, generated_a4, 0.5).save(
            directories["overlay"] / f"{case_id}.png",
            dpi=(args.dpi, args.dpi),
        )

        reference_digest = sha256(reference_path)
        generated_digest = sha256(generated_path)
        reference_hash_matches = reference_digest == item["reference_sha256"]
        generated_hash_matches = generated_digest == item["generated_sha256"]
        profile_assertions = invoice_profile_assertions(generated_structure, item["a4_profile"])
        structural_pass = (
            item["renderer_reported_page_count"] == 1
            and generated_structure["page_count"] == 1
            and generated_structure["is_a4"]
            and generated_structure["all_fonts_embedded"]
            and generated_structure["image_count"] >= 1
            and generated_structure["largest_image_pixels"][0] >= 480
            and generated_structure["largest_image_pixels"][1] >= 70
            and generated_structure["selectable_text_length"] > 0
            and generated_structure["has_rupee_symbol"]
            and not generated_structure["missing_expected_text"]
            and generated_structure["out_of_page_text_spans"] == 0
            and not generated_structure["overlapping_text_pairs"]
            and generated_structure["out_of_page_drawings"] == 0
            and cropped_generated_ink == 0
            and reference_hash_matches
            and generated_hash_matches
            and profile_assertions["passed"]
        )
        visual_within_advisory_threshold = metrics["changed_percent"] <= args.max_diff_percent
        case_report = {
            "id": case_id,
            "entity": item["entity"],
            "tax_type": item["tax_type"],
            "rounding": item["rounding"],
            "reference_file": item["reference_file"],
            "reference_sha256": reference_digest,
            "generated_sha256": generated_digest,
            "reference_hash_matches_manifest": reference_hash_matches,
            "generated_hash_matches_manifest": generated_hash_matches,
            "renderer_reported_page_count": item["renderer_reported_page_count"],
            "reference_page_points": [reference_page.rect.width, reference_page.rect.height],
            "reference_raw_pixels": list(reference_raw.size),
            "reference_a4_pixels": list(reference_a4.size),
            "reference_normalization_segments": normalization_segments,
            "generated_raw_pixels": list(generated_raw.size),
            "generated_a4_pixels": list(generated_a4.size),
            "generated_cropped_nonwhite_pixels": cropped_generated_ink,
            "generated_structure": generated_structure,
            "profile_assertions": profile_assertions,
            "pixel_difference": rounded_metrics(metrics),
            "structural_pass": structural_pass,
            "visual_within_advisory_threshold": visual_within_advisory_threshold,
            "passed": structural_pass,
        }
        report_cases.append(case_report)
        print(
            f"{case_id}: page={generated_structure['page_width_points']:.2f}x"
            f"{generated_structure['page_height_points']:.2f}pt, "
            f"diagnostic-diff={metrics['changed_percent']:.6f}%, "
            f"structural={'PASS' if case_report['passed'] else 'FAIL'}"
        )

    report = {
        "target_page": {"name": "A4", "width_points": A4_WIDTH_POINTS, "height_points": A4_HEIGHT_POINTS},
        "normalization": {
            "horizontal_scale": A4_WIDTH_POINTS / 612,
            "method": "case-specific piecewise y mapping from FORENSIC_MEASUREMENTS.md",
            "pixel_diff_is_advisory": True,
        },
        "dpi": args.dpi,
        "pixel_tolerance": args.pixel_tolerance,
        "max_diff_percent": args.max_diff_percent,
        "cases": report_cases,
        "passed": all(case["passed"] for case in report_cases),
    }
    (output / "report.json").write_text(f"{json.dumps(report, indent=2)}\n", encoding="utf-8")
    write_markdown(report, output / "report.md")
    print(f"report: {output / 'report.md'}")
    return 0 if report["passed"] or args.no_fail else 1


if __name__ == "__main__":
    ARGS = parse_args()
    raise SystemExit(main(ARGS))
