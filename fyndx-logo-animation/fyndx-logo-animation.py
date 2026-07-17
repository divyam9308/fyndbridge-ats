#!/usr/bin/env python3
"""Generate the transparent, path-revealed FyndX logo animation.

The script extracts the original logo pixels from the supplied flat backdrop,
assigns every visible pixel to a hand-traced logo component, reveals those
components in the requested order, and exports transparent GIFs plus an MP4
preview.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path
from typing import Iterable, Sequence

import cv2
import imageio_ffmpeg
import numpy as np
from PIL import Image


REFERENCE_SIZE = (1404, 864)
BRAND_BLUE_RGB = np.asarray((0, 18, 100), dtype=np.uint8)  # #001264
BRAND_GOLD_RGB = np.asarray((218, 177, 17), dtype=np.uint8)  # #DAB111
COMPONENT_ORDER = ("F", "y", "n", "d", "x1", "x_curve", "blue_swoosh")
FRAME_COUNTS_AT_25_FPS = {
    "transparent_hold": 4,
    "F": 9,
    "y": 10,
    "n": 8,
    "d": 9,
    "x1": 10,
    "x_curve": 19,
    "blue_swoosh": 8,
    "shine": 20,
    "complete_hold": 20,
    "loop_reset": 5,
}
GIF_ALPHA_THRESHOLD = 96
GIF_MIN_VISIBLE_COMPONENT_AREA = 6
GIF_BRAND_BLUE_INDEX = 253
GIF_BRAND_GOLD_INDEX = 254
GIF_TRANSPARENCY_INDEX = 255


def smoothstep(edge0: np.ndarray | float, edge1: np.ndarray | float, value: np.ndarray) -> np.ndarray:
    denominator = np.maximum(np.asarray(edge1) - np.asarray(edge0), 1e-6)
    t = np.clip((value - edge0) / denominator, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def estimate_background(rgb: np.ndarray) -> np.ndarray:
    """Estimate the almost-uniform source backdrop from a wide border."""
    height, width = rgb.shape[:2]
    border_width = max(8, round(min(height, width) * 0.045))
    border = np.concatenate(
        (
            rgb[:border_width].reshape(-1, 3),
            rgb[-border_width:].reshape(-1, 3),
            rgb[:, :border_width].reshape(-1, 3),
            rgb[:, -border_width:].reshape(-1, 3),
        ),
        axis=0,
    )
    return np.median(border, axis=0).astype(np.float32)


def keep_meaningful_components(alpha: np.ndarray, minimum_area: int = 24) -> np.ndarray:
    binary = (alpha > 0.01).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    keep = np.zeros_like(binary, dtype=bool)
    for label in range(1, count):
        if stats[label, cv2.CC_STAT_AREA] >= minimum_area:
            keep |= labels == label
    return np.where(keep, alpha, 0.0)


def extract_logo(rgb_u8: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return straight-alpha logo RGB, alpha, background RGB, and material seeds."""
    rgb = rgb_u8.astype(np.float32)
    background = estimate_background(rgb)
    delta = np.linalg.norm(rgb - background[None, None, :], axis=2)
    red, green, blue = np.moveaxis(rgb, 2, 0)

    gold_core = (
        (red > 62)
        & (green > 42)
        & (red > blue * 1.18)
        & (green > blue * 0.82)
        & (delta > 15)
    )
    blue_core = (
        (blue > 108)
        & (blue > red * 1.42)
        & (blue > green * 1.28)
        & (delta > 12)
    )
    material_core = gold_core | blue_core
    near_material = cv2.dilate(
        material_core.astype(np.uint8),
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)),
        iterations=1,
    ).astype(bool)

    solid_alpha = smoothstep(3.8, 19.0, delta)
    soft_alpha = smoothstep(3.8, 32.0, delta)
    dark_shadow = (
        (blue < background[2] - 2.0)
        & (red < 45)
        & (green < 50)
    )
    shadow_alpha = np.clip((background[2] - blue) / 76.0, 0.0, 0.88)
    outside_alpha = np.where(dark_shadow, shadow_alpha, soft_alpha)
    distance_to_material = cv2.distanceTransform(
        (~material_core).astype(np.uint8),
        cv2.DIST_L2,
        5,
    )
    shadow_envelope = 1.0 - smoothstep(9.0, 24.0, distance_to_material)
    outside_alpha *= shadow_envelope
    alpha = np.where(near_material, solid_alpha, outside_alpha)
    alpha = np.where(delta > 3.8, alpha, 0.0)
    alpha = keep_meaningful_components(alpha)
    alpha = cv2.GaussianBlur(alpha.astype(np.float32), (0, 0), sigmaX=0.38)
    alpha = np.clip(alpha, 0.0, 1.0)

    # Undo the original background matte on antialiased and shadow pixels.
    safe_alpha = np.maximum(alpha[..., None], 1.0 / 255.0)
    straight_rgb = (
        rgb - (1.0 - alpha[..., None]) * background[None, None, :]
    ) / safe_alpha
    straight_rgb = np.clip(straight_rgb, 0.0, 255.0)
    straight_rgb[alpha <= 1.0 / 255.0] = 0.0

    seeds = np.stack((blue_core, gold_core), axis=0)
    return straight_rgb.astype(np.uint8), alpha, background, seeds


def apply_brand_colors(
    logo_rgb: np.ndarray,
    logo_alpha: np.ndarray,
    seeds: np.ndarray,
) -> np.ndarray:
    """Recolour both materials around their exact approved brand base."""
    blue_seed, gold_seed = seeds
    blue_distance = cv2.distanceTransform(
        (~blue_seed).astype(np.uint8),
        cv2.DIST_L2,
        5,
    )
    gold_distance = cv2.distanceTransform(
        (~gold_seed).astype(np.uint8),
        cv2.DIST_L2,
        5,
    )
    material_is_blue = blue_distance <= gold_distance

    source = logo_rgb.astype(np.float32)
    source_luminance = np.sum(
        source * np.asarray((0.2126, 0.7152, 0.0722), dtype=np.float32),
        axis=2,
    )
    output = source.copy()
    dead_zone = 0.055

    for material_mask, core_seed, target_u8 in (
        (material_is_blue, blue_seed, BRAND_BLUE_RGB),
        (~material_is_blue, gold_seed, BRAND_GOLD_RGB),
    ):
        reference_pixels = core_seed & (logo_alpha >= 0.60)
        if not np.any(reference_pixels):
            raise RuntimeError("Cannot determine a base tone for a logo material.")
        reference_luminance = float(np.median(source_luminance[reference_pixels]))
        tone_ratio = source_luminance / max(reference_luminance, 1.0)
        target = target_u8.astype(np.float32)

        # Keep a narrow midtone plateau at the exact brand code. Below it,
        # darken the brand colour to retain the embossed edges and shadows.
        # Above it, mix a restrained amount of white into the same brand hue
        # to retain the metallic surface highlight.
        shadow_scale = np.power(
            np.clip(tone_ratio / (1.0 - dead_zone), 0.0, 1.0),
            0.58,
        )
        highlight_amount = 0.24 * np.clip(
            (tone_ratio - (1.0 + dead_zone)) / 0.55,
            0.0,
            1.0,
        )
        shadow_rgb = target[None, None, :] * shadow_scale[..., None]
        highlight_rgb = (
            target[None, None, :]
            + (255.0 - target[None, None, :]) * highlight_amount[..., None]
        )
        recoloured = np.where(
            (tone_ratio < 1.0 - dead_zone)[..., None],
            shadow_rgb,
            np.where(
                (tone_ratio > 1.0 + dead_zone)[..., None],
                highlight_rgb,
                target[None, None, :],
            ),
        )
        output[material_mask] = recoloured[material_mask]

    output[logo_alpha <= 1.0 / 255.0] = 0.0
    return np.clip(np.rint(output), 0.0, 255.0).astype(np.uint8)


def scaled_path(
    points: Sequence[tuple[float, float]],
    width: int,
    height: int,
) -> np.ndarray:
    scale_x = width / REFERENCE_SIZE[0]
    scale_y = height / REFERENCE_SIZE[1]
    return np.asarray([(x * scale_x, y * scale_y) for x, y in points], dtype=np.float32)


def path_field(
    paths: Sequence[Sequence[tuple[float, float]]],
    width: int,
    height: int,
    gap: float = 12.0,
    simultaneous: bool = False,
) -> tuple[np.ndarray, np.ndarray]:
    """Return distance-to-path and ordered progress for one or more strokes."""
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    prepared = [scaled_path(path, width, height) for path in paths]
    path_lengths = [
        float(np.linalg.norm(path[1:] - path[:-1], axis=1).sum())
        for path in prepared
    ]
    total = max(sum(path_lengths) + gap * max(0, len(paths) - 1), 1.0)
    best_distance_sq = np.full((height, width), np.inf, dtype=np.float32)
    best_progress = np.zeros((height, width), dtype=np.float32)
    offset = 0.0

    for path, path_length in zip(prepared, path_lengths):
        within_path = 0.0
        for start, end in zip(path[:-1], path[1:]):
            vector = end - start
            segment_length_sq = float(np.dot(vector, vector))
            segment_length = math.sqrt(segment_length_sq)
            projection = np.clip(
                ((xx - start[0]) * vector[0] + (yy - start[1]) * vector[1])
                / max(segment_length_sq, 1e-6),
                0.0,
                1.0,
            )
            nearest_x = start[0] + projection * vector[0]
            nearest_y = start[1] + projection * vector[1]
            distance_sq = (xx - nearest_x) ** 2 + (yy - nearest_y) ** 2
            replace = distance_sq < best_distance_sq
            if simultaneous:
                progress = (within_path + projection * segment_length) / max(path_length, 1.0)
            else:
                progress = (offset + within_path + projection * segment_length) / total
            best_progress = np.where(replace, progress, best_progress)
            best_distance_sq = np.where(replace, distance_sq, best_distance_sq)
            within_path += segment_length
        offset += path_length + gap

    return np.sqrt(best_distance_sq), np.clip(best_progress, 0.0, 1.0)


def phased_path_field(
    groups: Sequence[Sequence[Sequence[tuple[float, float]]]],
    weights: Sequence[float],
    width: int,
    height: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Sequence path groups while drawing every stroke within a group together."""
    if len(groups) != len(weights) or not groups:
        raise ValueError("Phased paths require one positive weight per path group.")
    normalized_weights = np.asarray(weights, dtype=np.float32)
    if np.any(normalized_weights <= 0):
        raise ValueError("Path-group weights must be positive.")
    normalized_weights /= normalized_weights.sum()

    best_distance = np.full((height, width), np.inf, dtype=np.float32)
    best_progress = np.zeros((height, width), dtype=np.float32)
    phase_start = 0.0
    for group, phase_weight in zip(groups, normalized_weights):
        distance, progress = path_field(
            group,
            width,
            height,
            simultaneous=True,
        )
        replace = distance < best_distance
        phased_progress = phase_start + progress * float(phase_weight)
        best_progress = np.where(replace, phased_progress, best_progress)
        best_distance = np.where(replace, distance, best_distance)
        phase_start += float(phase_weight)

    return best_distance, np.clip(best_progress, 0.0, 1.0)


def hard_two_phase_path_field(
    first_paths: Sequence[Sequence[tuple[float, float]]],
    second_paths: Sequence[Sequence[tuple[float, float]]],
    weights: Sequence[float],
    second_phase_mask: np.ndarray,
    width: int,
    height: int,
) -> np.ndarray:
    """Build a two-phase trace without nearest-path cross-phase leakage."""
    if len(weights) != 2 or np.any(np.asarray(weights) <= 0):
        raise ValueError("Hard two-phase paths require two positive weights.")
    normalized_weights = np.asarray(weights, dtype=np.float32)
    normalized_weights /= normalized_weights.sum()
    _, first_progress = path_field(
        first_paths,
        width,
        height,
        simultaneous=True,
    )
    _, second_progress = path_field(
        second_paths,
        width,
        height,
        simultaneous=True,
    )
    return np.where(
        second_phase_mask,
        normalized_weights[0] + second_progress * normalized_weights[1],
        first_progress * normalized_weights[0],
    ).astype(np.float32)


def inside_box(
    width: int,
    height: int,
    box: tuple[float, float, float, float],
) -> np.ndarray:
    x0, y0, x1, y1 = box
    scale_x = width / REFERENCE_SIZE[0]
    scale_y = height / REFERENCE_SIZE[1]
    yy, xx = np.mgrid[0:height, 0:width]
    return (
        (xx >= x0 * scale_x)
        & (xx <= x1 * scale_x)
        & (yy >= y0 * scale_y)
        & (yy <= y1 * scale_y)
    )


def build_component_fields(
    alpha: np.ndarray,
    seeds: np.ndarray,
) -> tuple[np.ndarray, dict[str, np.ndarray], np.ndarray]:
    height, width = alpha.shape
    paths: dict[str, Sequence[Sequence[tuple[float, float]]]] = {
        "n": (
            ((556, 488), (578, 394), (607, 394), (602, 407), (675, 407), (696, 424), (680, 488)),
        ),
        "x1": (
            ((820, 329), (858, 343), (1095, 530)),
        ),
        "x_curve": (
            (
                (1093, 329),
                (1022, 368),
                (950, 418),
                (881, 466),
                (807, 511),
                (714, 554),
                (603, 597),
                (493, 630),
                (423, 632),
            ),
        ),
        "blue_swoosh": (
            ((269, 593), (391, 621), (526, 582), (660, 548), (800, 519), (930, 497), (1045, 492), (1167, 494)),
        ),
    }
    phased_paths = {
        "F": (
            (
                (((260, 488), (287, 353)),),
                0.44,
            ),
            (
                (
                    ((287, 353), (314, 347), (447, 347)),
                    ((277, 415), (397, 415)),
                ),
                0.56,
            ),
        ),
        "y": (
            (
                (
                    ((440, 394), (419, 468), (437, 489), (474, 491)),
                    ((551, 394), (533, 482), (519, 508)),
                ),
                0.64,
            ),
            (
                (((519, 508), (505, 521), (475, 530), (383, 530)),),
                0.36,
            ),
        ),
        "d": (
            (
                (((821, 340), (807, 395), (797, 485)),),
                0.42,
            ),
            (
                (
                    (
                        (797, 485),
                        (765, 491),
                        (716, 491),
                        (692, 472),
                        (704, 414),
                        (729, 395),
                        (807, 395),
                    ),
                ),
                0.58,
            ),
        ),
    }
    fields: dict[str, np.ndarray] = {}
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    reference_x = xx * REFERENCE_SIZE[0] / width
    reference_y = yy * REFERENCE_SIZE[1] / height
    for name in COMPONENT_ORDER:
        if name == "F":
            first_weight, second_weight = (
                np.asarray(
                    [weight for _, weight in phased_paths[name]],
                    dtype=np.float32,
                )
                / sum(weight for _, weight in phased_paths[name])
            )
            top_bar = (reference_y <= 389.0) & (reference_x >= 304.0)
            middle_bar = (
                (reference_y > 389.0)
                & (reference_y <= 441.0)
                & (reference_x >= 304.0)
            )
            bar_pixels = top_bar | middle_bar
            vertical_progress = np.clip(
                (493.0 - reference_y) / (493.0 - 338.0),
                0.0,
                1.0,
            )
            top_bar_progress = np.clip(
                (reference_x - 304.0) / (451.0 - 304.0),
                0.0,
                1.0,
            )
            middle_bar_progress = np.clip(
                (reference_x - 304.0) / (400.0 - 304.0),
                0.0,
                1.0,
            )
            bar_progress = np.where(
                top_bar,
                top_bar_progress,
                middle_bar_progress,
            )
            progress = np.where(
                bar_pixels,
                first_weight + second_weight * bar_progress,
                first_weight * vertical_progress,
            )
        elif name == "y":
            first_weight, second_weight = (
                np.asarray(
                    [weight for _, weight in phased_paths[name]],
                    dtype=np.float32,
                )
                / sum(weight for _, weight in phased_paths[name])
            )
            lower_curve = reference_y >= 493.0
            stem_progress = np.clip(
                (reference_y - 388.0) / (490.0 - 388.0),
                0.0,
                1.0,
            )
            lower_curve_progress = np.clip(
                (534.0 - reference_x) / (534.0 - 380.0),
                0.0,
                1.0,
            )
            progress = np.where(
                lower_curve,
                first_weight + second_weight * lower_curve_progress,
                first_weight * stem_progress,
            )
        elif name == "d":
            first_weight, second_weight = (
                np.asarray(
                    [weight for _, weight in phased_paths[name]],
                    dtype=np.float32,
                )
                / sum(weight for _, weight in phased_paths[name])
            )
            stem_boundary = 805.0 - 0.12 * (reference_y - 390.0)
            bowl_pixels = reference_x < stem_boundary
            stem_progress = np.clip(
                (reference_y - 338.0) / (492.0 - 338.0),
                0.0,
                1.0,
            )

            # Clockwise bowl: bottom-right to bottom-left, up the left
            # side, then across the top into the completed stem.
            bottom_progress = 0.40 * np.clip(
                (794.0 - reference_x) / (794.0 - 694.0),
                0.0,
                1.0,
            )
            left_progress = 0.40 + 0.32 * np.clip(
                (455.0 - reference_y) / (455.0 - 418.0),
                0.0,
                1.0,
            )
            top_progress = 0.72 + 0.28 * np.clip(
                (reference_x - 709.0) / (805.0 - 709.0),
                0.0,
                1.0,
            )
            bowl_progress = np.where(
                reference_y >= 455.0,
                bottom_progress,
                np.where(
                    reference_y >= 418.0,
                    left_progress,
                    top_progress,
                ),
            )
            progress = np.where(
                bowl_pixels,
                first_weight + second_weight * bowl_progress,
                first_weight * stem_progress,
            )
        elif name in phased_paths:
            groups = [group for group, _ in phased_paths[name]]
            weights = [weight for _, weight in phased_paths[name]]
            _, progress = phased_path_field(groups, weights, width, height)
        else:
            _, progress = path_field(paths[name], width, height)
        fields[name] = progress

    blue_seed, gold_seed = seeds
    blue_distance = cv2.distanceTransform((~blue_seed).astype(np.uint8), cv2.DIST_L2, 5)
    gold_distance = cv2.distanceTransform((~gold_seed).astype(np.uint8), cv2.DIST_L2, 5)
    material_is_blue = blue_distance <= gold_distance

    component_seeds = np.zeros(
        (len(COMPONENT_ORDER), height, width),
        dtype=bool,
    )
    scale_x = width / REFERENCE_SIZE[0]
    scale_y = height / REFERENCE_SIZE[1]

    blue_count, blue_labels, blue_stats, _ = cv2.connectedComponentsWithStats(
        blue_seed.astype(np.uint8),
        connectivity=8,
    )
    for component in range(1, blue_count):
        x = blue_stats[component, cv2.CC_STAT_LEFT]
        y = blue_stats[component, cv2.CC_STAT_TOP]
        if y < 370 * scale_y:
            name = "F" if x < 550 * scale_x else "d"
        elif y < 470 * scale_y:
            name = "y" if x < 530 * scale_x else "n"
        else:
            name = "blue_swoosh"
        component_seeds[COMPONENT_ORDER.index(name)] |= blue_labels == component

    gold_count, gold_labels, gold_stats, _ = cv2.connectedComponentsWithStats(
        gold_seed.astype(np.uint8),
        connectivity=8,
    )
    for component in range(1, gold_count):
        area = gold_stats[component, cv2.CC_STAT_AREA]
        component_width = gold_stats[component, cv2.CC_STAT_WIDTH]
        name = (
            "x_curve"
            if component_width > 300 * scale_x or area < 300 * scale_x * scale_y
            else "x1"
        )
        component_seeds[COMPONENT_ORDER.index(name)] |= gold_labels == component

    component_distances = []
    for component_seed in component_seeds:
        if np.any(component_seed):
            distance = cv2.distanceTransform(
                (~component_seed).astype(np.uint8),
                cv2.DIST_L2,
                5,
            )
        else:
            distance = np.full((height, width), np.inf, dtype=np.float32)
        component_distances.append(distance)
    component_distances = np.stack(component_distances, axis=0)

    labels = np.zeros((height, width), dtype=np.uint8)
    blue_indices = np.asarray(
        [COMPONENT_ORDER.index(name) for name in ("F", "y", "n", "d", "blue_swoosh")],
        dtype=np.uint8,
    )
    gold_indices = np.asarray(
        [COMPONENT_ORDER.index(name) for name in ("x1", "x_curve")],
        dtype=np.uint8,
    )
    nearest_blue = np.argmin(component_distances[blue_indices], axis=0)
    nearest_gold = np.argmin(component_distances[gold_indices], axis=0)
    labels[material_is_blue] = blue_indices[nearest_blue[material_is_blue]]
    labels[~material_is_blue] = gold_indices[nearest_gold[~material_is_blue]]

    # Normalize each progress field over the pixels actually owned by it. This
    # guarantees that the final trace frame contains every original logo pixel.
    component_masks = []
    normalized_fields: dict[str, np.ndarray] = {}
    for index, name in enumerate(COMPONENT_ORDER):
        mask = labels == index
        component_masks.append(mask)
        samples = fields[name][mask & (alpha > 0.05)]
        if samples.size:
            low, high = np.percentile(samples, (0.5, 99.5))
            normalized = np.clip((fields[name] - low) / max(high - low, 1e-6), 0.0, 1.0)
        else:
            normalized = fields[name]
        normalized_fields[name] = normalized.astype(np.float32)

    return labels, normalized_fields, np.stack(component_masks, axis=0)


def component_gate(progress_field: np.ndarray, progress: float, feather: float = 0.026) -> np.ndarray:
    if progress <= 0.0:
        return np.zeros_like(progress_field, dtype=np.float32)
    if progress >= 1.0:
        return np.ones_like(progress_field, dtype=np.float32)
    return 1.0 - smoothstep(progress - feather, progress + feather, progress_field)


def render_frame(
    logo_rgb: np.ndarray,
    logo_alpha: np.ndarray,
    component_masks: np.ndarray,
    progress_fields: dict[str, np.ndarray],
    progress: dict[str, float],
    shine: np.ndarray | None = None,
) -> np.ndarray:
    visible_alpha = np.zeros_like(logo_alpha, dtype=np.float32)
    for index, name in enumerate(COMPONENT_ORDER):
        gate = component_gate(progress_fields[name], progress.get(name, 0.0))
        visible_alpha += logo_alpha * component_masks[index] * gate
    visible_alpha = np.clip(visible_alpha, 0.0, 1.0)

    rgb = logo_rgb.astype(np.float32)
    if shine is not None:
        strength = np.clip(shine[..., None], 0.0, 0.24)
        rgb = rgb + (255.0 - rgb) * strength

    rgba = np.dstack(
        (
            np.clip(rgb, 0, 255).astype(np.uint8),
            np.rint(visible_alpha * 255).astype(np.uint8),
        )
    )
    return rgba


def make_frames(
    logo_rgb: np.ndarray,
    logo_alpha: np.ndarray,
    seeds: np.ndarray,
    fps: int,
) -> tuple[list[np.ndarray], dict[str, tuple[int, int]]]:
    _, progress_fields, component_masks = build_component_fields(logo_alpha, seeds)
    height, width = logo_alpha.shape
    scale = fps / 25.0
    frame_counts = {
        name: max(1, round(count * scale))
        for name, count in FRAME_COUNTS_AT_25_FPS.items()
    }

    progress = {name: 0.0 for name in COMPONENT_ORDER}
    frames: list[np.ndarray] = []
    ranges: dict[str, tuple[int, int]] = {}

    def add_range(name: str, new_frames: Iterable[np.ndarray]) -> None:
        start = len(frames)
        frames.extend(new_frames)
        ranges[name] = (start, len(frames) - 1)

    transparent = np.dstack(
        (
            logo_rgb,
            np.zeros((height, width), dtype=np.uint8),
        )
    )
    add_range(
        "transparent_hold",
        (transparent.copy() for _ in range(frame_counts["transparent_hold"])),
    )

    for name in COMPONENT_ORDER:
        count = frame_counts[name]
        rendered = []
        for step in range(1, count + 1):
            progress[name] = step / count
            rendered.append(
                render_frame(
                    logo_rgb,
                    logo_alpha,
                    component_masks,
                    progress_fields,
                    progress,
                )
            )
        add_range(name, rendered)
        progress[name] = 1.0

    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    diagonal = xx - 0.33 * yy
    minimum, maximum = float(diagonal.min()), float(diagonal.max())
    blue_seed, gold_seed = seeds
    surface = cv2.dilate(
        (blue_seed | gold_seed).astype(np.uint8),
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)),
        iterations=1,
    ).astype(np.float32)
    surface *= logo_alpha
    shine_frames = []
    shine_count = frame_counts["shine"]
    band_width = 34.0 * width / REFERENCE_SIZE[0]
    for step in range(shine_count):
        amount = step / max(shine_count - 1, 1)
        center = minimum - 2.5 * band_width + amount * (
            maximum - minimum + 5.0 * band_width
        )
        band = np.exp(-0.5 * ((diagonal - center) / max(band_width, 1.0)) ** 2)
        shine = 0.235 * band * surface
        shine_frames.append(
            render_frame(
                logo_rgb,
                logo_alpha,
                component_masks,
                progress_fields,
                progress,
                shine=shine,
            )
        )
    add_range("shine", shine_frames)

    complete = render_frame(
        logo_rgb,
        logo_alpha,
        component_masks,
        progress_fields,
        progress,
    )
    add_range(
        "complete_hold",
        (complete.copy() for _ in range(frame_counts["complete_hold"])),
    )

    global_order = np.zeros_like(logo_alpha, dtype=np.float32)
    for index, name in enumerate(COMPONENT_ORDER):
        component_order = (index + progress_fields[name]) / len(COMPONENT_ORDER)
        global_order = np.where(component_masks[index], component_order, global_order)
    erase_order = 1.0 - global_order
    reset_frames = []
    reset_count = frame_counts["loop_reset"]
    erase_feather = 0.045
    for step in range(reset_count):
        if step == reset_count - 1:
            keep = np.zeros_like(logo_alpha)
        else:
            linear_amount = step / max(reset_count - 1, 1)
            amount = (1.0 + erase_feather) * linear_amount**0.20
            keep = smoothstep(0.0, erase_feather, erase_order + erase_feather - amount)
        rgba = complete.copy()
        rgba[..., 3] = np.rint(logo_alpha * keep * 255.0).astype(np.uint8)
        reset_frames.append(rgba)
    add_range("loop_reset", reset_frames)

    return frames, ranges


def build_palette(logo_rgb: np.ndarray, logo_alpha: np.ndarray) -> Image.Image:
    straight = logo_rgb.copy()
    straight[logo_alpha < 0.02] = 0
    premultiplied = np.rint(
        logo_rgb.astype(np.float32) * logo_alpha[..., None]
    ).astype(np.uint8)
    samples = np.concatenate((straight, premultiplied), axis=0)
    quantized = Image.fromarray(samples).quantize(
        colors=253,
        method=Image.Quantize.MEDIANCUT,
    )
    # Reserve two exact palette entries for the approved brand bases, plus the
    # final entry for transparency. Quantization must never shift either hex.
    palette = (
        quantized.getpalette()[: 253 * 3]
        + BRAND_BLUE_RGB.tolist()
        + BRAND_GOLD_RGB.tolist()
        + [0, 255, 0]
    )
    palette_image = Image.new("P", (1, 1))
    palette_image.putpalette(palette)
    return palette_image


def gif_opaque_mask(alpha: np.ndarray) -> np.ndarray:
    """Return a clean binary GIF-alpha mask without isolated reveal debris."""
    opaque = (alpha >= GIF_ALPHA_THRESHOLD).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(
        opaque,
        connectivity=8,
    )
    for label in range(1, count):
        if stats[label, cv2.CC_STAT_AREA] < GIF_MIN_VISIBLE_COMPONENT_AREA:
            opaque[labels == label] = 0
    return opaque


def resize_rgba_for_gif(rgba: np.ndarray, width: int) -> np.ndarray:
    """Resize RGB sharply and alpha monotonically for a smaller GIF."""
    image = Image.fromarray(rgba)
    height = round(image.height * width / image.width)
    resized_rgb = image.convert("RGB").resize(
        (width, height),
        Image.Resampling.LANCZOS,
    )
    resized_alpha = image.getchannel("A").resize(
        (width, height),
        Image.Resampling.BILINEAR,
    )
    return np.asarray(
        Image.merge(
            "RGBA",
            (*resized_rgb.split(), resized_alpha),
        )
    )


def rgba_to_gif_frame(rgba: np.ndarray, palette_image: Image.Image) -> Image.Image:
    alpha = rgba[..., 3].astype(np.float32) / 255.0
    premultiplied_rgb = np.rint(
        rgba[..., :3].astype(np.float32) * alpha[..., None]
    ).astype(np.uint8)
    rgb_image = Image.fromarray(premultiplied_rgb)
    indexed = rgb_image.quantize(
        palette=palette_image,
        dither=Image.Dither.NONE,
    )
    indexed_array = np.asarray(indexed).copy()
    # Pillow's palette search is approximate and can choose a neighbouring
    # colour even when an exact entry exists. Pin fully opaque brand-base
    # pixels to their reserved entries after quantization.
    indexed_array[
        np.all(
            premultiplied_rgb == BRAND_BLUE_RGB[None, None, :],
            axis=2,
        )
    ] = GIF_BRAND_BLUE_INDEX
    indexed_array[
        np.all(
            premultiplied_rgb == BRAND_GOLD_RGB[None, None, :],
            axis=2,
        )
    ] = GIF_BRAND_GOLD_INDEX
    opaque = gif_opaque_mask(rgba[..., 3])
    indexed_array[opaque == 0] = GIF_TRANSPARENCY_INDEX
    output = Image.fromarray(indexed_array.astype(np.uint8)).convert("P")
    output.putpalette(palette_image.getpalette())
    output.info["transparency"] = GIF_TRANSPARENCY_INDEX
    output.info["disposal"] = 2
    return output


def save_gif(
    frames: Sequence[np.ndarray],
    output_path: Path,
    palette_image: Image.Image,
    fps: int,
    width: int | None = None,
) -> None:
    # Pillow can emit an invalid zero-area GIF image descriptor for a final
    # fully transparent frame at this canvas size. The preceding reset frame
    # uses disposal=2, and the loop's first frame is transparent, so omitting
    # that redundant terminal frame preserves the same clean visual reset.
    gif_frames = frames[:-1] if not np.any(frames[-1][..., 3]) else frames
    converted = []
    for rgba in gif_frames:
        prepared = (
            resize_rgba_for_gif(rgba, width)
            if width is not None and width != rgba.shape[1]
            else rgba
        )
        converted.append(rgba_to_gif_frame(prepared, palette_image))
    converted[0].save(
        output_path,
        save_all=True,
        append_images=converted[1:],
        duration=round(1000 / fps),
        loop=0,
        disposal=2,
        transparency=GIF_TRANSPARENCY_INDEX,
        background=GIF_TRANSPARENCY_INDEX,
        optimize=False,
    )


def composite_on_background(rgba: np.ndarray, background: np.ndarray) -> np.ndarray:
    alpha = rgba[..., 3:4].astype(np.float32) / 255.0
    rgb = rgba[..., :3].astype(np.float32)
    composited = rgb * alpha + background[None, None, :] * (1.0 - alpha)
    return np.clip(composited, 0, 255).astype(np.uint8)


def save_mp4(
    frames: Sequence[np.ndarray],
    output_path: Path,
    background: np.ndarray,
    fps: int,
) -> None:
    height, width = frames[0].shape[:2]
    writer = imageio_ffmpeg.write_frames(
        str(output_path),
        (width, height),
        fps=fps,
        codec="libx264",
        macro_block_size=2,
        pix_fmt_in="rgb24",
        pix_fmt_out="yuv420p",
        output_params=["-crf", "17", "-preset", "slow", "-movflags", "+faststart"],
        ffmpeg_log_level="warning",
    )
    writer.send(None)
    try:
        for rgba in frames:
            writer.send(composite_on_background(rgba, background).tobytes())
    finally:
        writer.close()


def save_transparent_logo(
    logo_rgb: np.ndarray,
    logo_alpha: np.ndarray,
    output_path: Path,
) -> None:
    rgba = np.dstack((logo_rgb, np.rint(logo_alpha * 255.0).astype(np.uint8)))
    Image.fromarray(rgba).save(output_path, optimize=True)


def validate_outputs(
    frames: Sequence[np.ndarray],
    ranges: dict[str, tuple[int, int]],
    logo_rgb: np.ndarray,
    logo_alpha: np.ndarray,
    seeds: np.ndarray,
    main_gif: Path,
    small_gif: Path,
    mp4: Path,
    fps: int,
    small_width: int,
) -> None:
    expected_order = (
        "transparent_hold",
        "F",
        "y",
        "n",
        "d",
        "x1",
        "x_curve",
        "blue_swoosh",
        "shine",
        "complete_hold",
        "loop_reset",
    )
    starts = [ranges[name][0] for name in expected_order]
    if starts != sorted(starts):
        raise RuntimeError("Animation sections are not in the required order.")

    _, _, component_masks = build_component_fields(logo_alpha, seeds)
    for name in ("F", "y", "n", "d"):
        index = COMPONENT_ORDER.index(name)
        source_component = (
            component_masks[index] & (logo_alpha > 0.05)
        ).astype(np.uint8)
        count, _, stats, _ = cv2.connectedComponentsWithStats(
            source_component,
            connectivity=8,
        )
        meaningful = sum(
            stats[label, cv2.CC_STAT_AREA] >= 20
            for label in range(1, count)
        )
        if meaningful != 1:
            raise RuntimeError(
                f"{name} owns {meaningful} disconnected source regions; expected one."
            )

    # Every drawing phase must add pixels monotonically. This catches crawling
    # or prematurely disappearing reveal edges before any file is encoded.
    for name in COMPONENT_ORDER:
        start, end = ranges[name]
        for frame_index in range(start + 1, end + 1):
            previous = frames[frame_index - 1][..., 3]
            current = frames[frame_index][..., 3]
            if np.any(current < previous):
                raise RuntimeError(
                    f"{name} loses alpha between raw frames "
                    f"{frame_index - 1} and {frame_index}."
                )

    # Independent regression regions for the exact stray fragments reported in
    # the earlier build. These do not rely on the generator's own labels.
    y_end = ranges["y"][1]
    if any(
        np.any(frame[536:552, 441:556, 3])
        for frame in frames[: y_end + 1]
    ):
        raise RuntimeError("A premature blue streak appears beneath y.")
    d_end = ranges["d"][1]
    if any(
        np.any(frame[498:512, 697:789, 3])
        for frame in frames[: d_end + 1]
    ):
        raise RuntimeError("A premature blue streak appears beneath d.")

    y_start, y_end = ranges["y"]
    y_count = y_end - y_start + 1
    last_stems_only = y_start + max(1, math.floor(0.60 * y_count)) - 1
    if np.any(frames[last_stems_only][493:536, 380:535, 3]):
        raise RuntimeError("The lower y curve begins before both stems finish.")

    d_start, d_end = ranges["d"]
    d_count = d_end - d_start + 1
    last_stem_only = d_start + max(1, math.floor(0.36 * d_count)) - 1
    yy, xx = np.mgrid[0 : logo_alpha.shape[0], 0 : logo_alpha.shape[1]]
    reference_x = xx * REFERENCE_SIZE[0] / logo_alpha.shape[1]
    reference_y = yy * REFERENCE_SIZE[1] / logo_alpha.shape[0]
    d_bowl = (
        (reference_x >= 700.0)
        & (reference_x < 805.0 - 0.12 * (reference_y - 390.0))
        & (reference_y >= 390.0)
        & (reference_y <= 495.0)
    )
    if np.any(frames[last_stem_only][..., 3][d_bowl]):
        raise RuntimeError("The d bowl begins before its upper stem finishes.")

    hold_frame = frames[ranges["complete_hold"][0]]
    expected_alpha = np.rint(logo_alpha * 255.0).astype(np.uint8)
    for color_name, target in (
        ("blue", BRAND_BLUE_RGB),
        ("gold", BRAND_GOLD_RGB),
    ):
        exact_pixels = (
            np.all(logo_rgb == target[None, None, :], axis=2)
            & (expected_alpha > 0)
        )
        if not np.any(exact_pixels):
            raise RuntimeError(
                f"The completed logo does not contain exact brand {color_name}."
            )
    if not np.array_equal(hold_frame[..., :3], logo_rgb):
        raise RuntimeError("Completed animation frame does not retain the branded logo colors.")
    if not np.array_equal(hold_frame[..., 3], expected_alpha):
        raise RuntimeError("Completed animation frame does not match the extracted logo alpha.")
    if np.any(frames[-1][..., 3]):
        raise RuntimeError("Final reset frame must be transparent for a flash-free loop.")

    for path in (main_gif, small_gif, mp4):
        if not path.exists() or path.stat().st_size == 0:
            raise RuntimeError(f"Missing or empty output: {path}")

    gif_source_frames = (
        frames[:-1] if not np.any(frames[-1][..., 3]) else frames
    )
    gif_frame_duration = round(1000 / fps)

    def validate_gif(path: Path, width: int | None) -> None:
        expected_size = (
            REFERENCE_SIZE
            if width is None
            else (
                width,
                round(REFERENCE_SIZE[1] * width / REFERENCE_SIZE[0]),
            )
        )
        with Image.open(path) as image:
            if image.size != expected_size:
                raise RuntimeError(f"Unexpected {path.name} size: {image.size}")
            if image.info.get("loop") != 0:
                raise RuntimeError(f"{path.name} is not configured to loop forever.")
            if image.info.get("transparency") != GIF_TRANSPARENCY_INDEX:
                raise RuntimeError(
                    f"{path.name} does not reserve palette index "
                    f"{GIF_TRANSPARENCY_INDEX} for transparency."
                )

            gif_starts: list[int] = []
            gif_duration_ms = 0
            brand_colors_seen = {
                "blue": False,
                "gold": False,
            }
            for frame_index in range(image.n_frames):
                image.seek(frame_index)
                gif_starts.append(gif_duration_ms)
                gif_duration_ms += image.info.get("duration", 0)
                decoded_rgba = np.asarray(image.convert("RGBA"))
                visible = (decoded_rgba[..., 3] > 0).astype(np.uint8)
                for color_name, target in (
                    ("blue", BRAND_BLUE_RGB),
                    ("gold", BRAND_GOLD_RGB),
                ):
                    brand_colors_seen[color_name] |= bool(
                        np.any(
                            np.all(
                                decoded_rgba[..., :3] == target[None, None, :],
                                axis=2,
                            )
                            & visible.astype(bool)
                        )
                    )
                count, _, stats, _ = cv2.connectedComponentsWithStats(
                    visible,
                    connectivity=8,
                )
                if any(
                    stats[label, cv2.CC_STAT_AREA]
                    < GIF_MIN_VISIBLE_COMPONENT_AREA
                    for label in range(1, count)
                ):
                    raise RuntimeError(
                        f"{path.name} frame {frame_index} contains isolated edge debris."
                    )
            missing_brand_colors = [
                color_name
                for color_name, seen in brand_colors_seen.items()
                if not seen
            ]
            if missing_brand_colors:
                raise RuntimeError(
                    f"{path.name} does not retain exact brand colours: "
                    + ", ".join(missing_brand_colors)
                )

            expected_duration_ms = len(gif_source_frames) * gif_frame_duration
            if abs(gif_duration_ms - expected_duration_ms) > gif_frame_duration:
                raise RuntimeError(
                    f"{path.name} duration is {gif_duration_ms}ms; "
                    f"expected approximately {expected_duration_ms}ms."
                )

            decoded_index = 0
            for raw_index, raw_frame in enumerate(gif_source_frames):
                presentation_time = raw_index * gif_frame_duration
                while (
                    decoded_index + 1 < len(gif_starts)
                    and gif_starts[decoded_index + 1] <= presentation_time
                ):
                    decoded_index += 1
                image.seek(decoded_index)
                decoded_alpha = (
                    np.asarray(image.convert("RGBA").getchannel("A")) > 0
                )
                prepared = (
                    resize_rgba_for_gif(raw_frame, width)
                    if width is not None
                    else raw_frame
                )
                expected_opaque = gif_opaque_mask(prepared[..., 3]).astype(bool)
                if not np.array_equal(decoded_alpha, expected_opaque):
                    difference = int(
                        np.count_nonzero(decoded_alpha != expected_opaque)
                    )
                    raise RuntimeError(
                        f"{path.name} diverges from raw frame {raw_index} "
                        f"by {difference} alpha pixels."
                    )

            image.seek(0)
            if image.convert("RGBA").getchannel("A").getextrema() != (0, 0):
                raise RuntimeError(f"{path.name} does not begin transparent.")
            image.seek(image.n_frames - 1)
            last_alpha = np.asarray(image.convert("RGBA").getchannel("A"))
            full_coverage = max(np.count_nonzero(expected_alpha), 1)
            if np.count_nonzero(last_alpha) / full_coverage > 0.08:
                raise RuntimeError(
                    f"{path.name} leaves too much visible during its loop reset."
                )
            if image.disposal_method != 2:
                raise RuntimeError(
                    f"{path.name} does not clear each frame before restarting."
                )

    validate_gif(main_gif, None)
    validate_gif(small_gif, small_width)

    video = cv2.VideoCapture(str(mp4))
    try:
        video_width = round(video.get(cv2.CAP_PROP_FRAME_WIDTH))
        video_height = round(video.get(cv2.CAP_PROP_FRAME_HEIGHT))
        video_fps = video.get(cv2.CAP_PROP_FPS)
        video_frames = round(video.get(cv2.CAP_PROP_FRAME_COUNT))
    finally:
        video.release()
    if (video_width, video_height) != REFERENCE_SIZE:
        raise RuntimeError(
            f"Unexpected MP4 dimensions: {(video_width, video_height)}."
        )
    if video_frames != len(frames) or abs(video_fps - fps) > 0.01:
        raise RuntimeError(
            f"Unexpected MP4 timing: {video_frames} frames at {video_fps:.3f} FPS."
        )

    duration = len(frames) / fps
    if not 4.0 <= duration <= 5.2:
        raise RuntimeError(f"Animation duration {duration:.2f}s is outside the target range.")


def parse_args() -> argparse.Namespace:
    folder = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=folder / "fyndx-logo-source.png",
        help="Path to the supplied FyndX PNG.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=folder,
        help="Folder for the generated PNG, GIFs, and MP4.",
    )
    parser.add_argument("--fps", type=int, default=25, help="Animation frame rate.")
    parser.add_argument(
        "--small-width",
        type=int,
        default=800,
        help="Width of the smaller transparent GIF.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not 20 <= args.fps <= 30:
        raise SystemExit("--fps must be between 20 and 30.")
    args.output_dir.mkdir(parents=True, exist_ok=True)

    source = Image.open(args.source).convert("RGB")
    if source.size != REFERENCE_SIZE:
        raise SystemExit(
            f"Expected the supplied {REFERENCE_SIZE[0]}x{REFERENCE_SIZE[1]} image; "
            f"received {source.width}x{source.height}."
        )
    source_rgb = np.asarray(source)
    logo_rgb, logo_alpha, background, seeds = extract_logo(source_rgb)
    logo_rgb = apply_brand_colors(logo_rgb, logo_alpha, seeds)
    frames, ranges = make_frames(logo_rgb, logo_alpha, seeds, args.fps)

    transparent_png = args.output_dir / "fyndx-logo-transparent.png"
    main_gif = args.output_dir / "fyndx-logo-animated.gif"
    small_gif = args.output_dir / "fyndx-logo-animated-small.gif"
    mp4 = args.output_dir / "preview.mp4"

    save_transparent_logo(logo_rgb, logo_alpha, transparent_png)
    palette = build_palette(logo_rgb, logo_alpha)
    save_gif(frames, main_gif, palette, args.fps)

    small_height = round(REFERENCE_SIZE[1] * args.small_width / REFERENCE_SIZE[0])
    small_logo = Image.fromarray(
        np.dstack((logo_rgb, np.rint(logo_alpha * 255.0).astype(np.uint8)))
    ).resize((args.small_width, small_height), Image.Resampling.LANCZOS)
    small_array = np.asarray(small_logo)
    small_palette = build_palette(
        small_array[..., :3],
        small_array[..., 3].astype(np.float32) / 255.0,
    )
    save_gif(frames, small_gif, small_palette, args.fps, width=args.small_width)
    save_mp4(frames, mp4, background, args.fps)

    validate_outputs(
        frames,
        ranges,
        logo_rgb,
        logo_alpha,
        seeds,
        main_gif,
        small_gif,
        mp4,
        args.fps,
        args.small_width,
    )

    duration = len(frames) / args.fps
    print(f"Generated {len(frames)} frames at {args.fps} FPS ({duration:.2f}s).")
    print(f"Transparent logo: {transparent_png}")
    print(f"Main GIF:         {main_gif}")
    print(f"Small GIF:        {small_gif}")
    print(f"MP4 preview:      {mp4}")


if __name__ == "__main__":
    main()
