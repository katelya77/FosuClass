#!/usr/bin/env python3
"""Generate deterministic multi-end icon assets from the approved favicon source."""

from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "miniapp" / "assets" / "source" / "favicon-original.png"
ASSET_ROOT = ROOT / "miniapp" / "assets"
MASTER_SIZE = 1024
SUBJECT_SIZE = 900
BRAND_RED = (198, 40, 40)
MATTE_SOLID_FLOOR = 100


def resize_rgba(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Resize in premultiplied-alpha space so removed white matte cannot bleed back."""
    return image.convert("RGBa").resize(size, Image.Resampling.LANCZOS).convert("RGBA")


def remove_edge_white(image: Image.Image) -> Image.Image:
    source = image.convert("RGBA")
    width, height = source.size
    pixels = source.load()
    visited = bytearray(width * height)
    queue = deque()

    def is_outer_white(x: int, y: int) -> bool:
        red, green, blue, _ = pixels[x, y]
        # The source is antialiased against opaque white. Traverse the connected
        # matte band, stopping at saturated artwork. Interior whites are enclosed
        # and therefore remain untouched.
        return min(red, green, blue) >= MATTE_SOLID_FLOOR

    def enqueue(x: int, y: int) -> None:
        index = y * width + x
        if visited[index] or not is_outer_white(x, y):
            return
        visited[index] = 1
        queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        if x > 0:
            enqueue(x - 1, y)
        if x + 1 < width:
            enqueue(x + 1, y)
        if y > 0:
            enqueue(x, y - 1)
        if y + 1 < height:
            enqueue(x, y + 1)

    for index, was_visited in enumerate(visited):
        if not was_visited:
            continue
        x = index % width
        y = index // width
        red, green, blue, _ = pixels[x, y]
        darkest = min(red, green, blue)
        alpha_ratio = max(0.0, min(1.0, (255 - darkest) / (255 - MATTE_SOLID_FLOOR)))
        # Discard low-coverage compression/antialias noise from the old white
        # canvas; retain and decontaminate only the meaningful edge transition.
        if alpha_ratio < 0.35:
            pixels[x, y] = (0, 0, 0, 0)
            continue
        foreground = tuple(
            max(0, min(255, round((channel - 255 * (1 - alpha_ratio)) / alpha_ratio)))
            for channel in (red, green, blue)
        )
        pixels[x, y] = foreground + (round(alpha_ratio * 255),)

    alpha = source.getchannel("A")
    bounding_box = alpha.getbbox()
    if not bounding_box:
        raise RuntimeError("favicon source became fully transparent")
    return source.crop(bounding_box)


def transparent_master(source: Image.Image) -> Image.Image:
    trimmed = remove_edge_white(source)
    scale = min(SUBJECT_SIZE / trimmed.width, SUBJECT_SIZE / trimmed.height)
    resized_size = (
        max(1, round(trimmed.width * scale)),
        max(1, round(trimmed.height * scale)),
    )
    trimmed = resize_rgba(trimmed, resized_size)
    master = Image.new("RGBA", (MASTER_SIZE, MASTER_SIZE), (0, 0, 0, 0))
    offset = ((MASTER_SIZE - trimmed.width) // 2, (MASTER_SIZE - trimmed.height) // 2)
    master.alpha_composite(trimmed, offset)
    return master


def validate_master(master: Image.Image) -> None:
    alpha = master.getchannel("A")
    bounding_box = alpha.getbbox()
    if not bounding_box:
        raise RuntimeError("generated master is fully transparent")
    width = bounding_box[2] - bounding_box[0]
    height = bounding_box[3] - bounding_box[1]
    if max(width, height) != SUBJECT_SIZE or min(width, height) < SUBJECT_SIZE - 8:
        raise RuntimeError(f"unexpected icon subject bounds: {bounding_box}")
    if any(alpha.getpixel(point) != 0 for point in ((0, 0), (1023, 0), (0, 1023), (1023, 1023))):
        raise RuntimeError("generated master corners must remain transparent")


def save_rgba(master: Image.Image, size: int, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    resized = resize_rgba(master, (size, size))
    resized.save(target, format="PNG", optimize=True)


def save_opaque(master: Image.Image, size: int, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    resized = resize_rgba(master, (size, size))
    background = Image.new("RGBA", (size, size), BRAND_RED + (255,))
    background.alpha_composite(resized)
    background.convert("RGB").save(target, format="PNG", optimize=True)


def save_solid(size: int, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (size, size), BRAND_RED).save(target, format="PNG", optimize=True)


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"approved icon source is missing: {SOURCE}")
    source = Image.open(SOURCE)
    master = transparent_master(source)
    validate_master(master)

    save_rgba(master, MASTER_SIZE, ASSET_ROOT / "app-icon-master-1024.png")
    save_rgba(master, 256, ROOT / "miniprogram" / "assets" / "logo" / "favicon.png")

    android_sizes = {
        "hdpi": 72,
        "xhdpi": 96,
        "xxhdpi": 144,
        "xxxhdpi": 192,
    }
    for density, size in android_sizes.items():
        save_rgba(master, size, ASSET_ROOT / "android" / f"icon-{density}.png")

    ios_sizes = {
        "main-120": 120,
        "main-180": 180,
        "spotlight-80": 80,
        "spotlight-120": 120,
        "settings-58": 58,
        "settings-87": 87,
        "notification-40": 40,
        "notification-60": 60,
        "app-store-1024": 1024,
    }
    for name, size in ios_sizes.items():
        save_opaque(master, size, ASSET_ROOT / "ios" / f"icon-{name}.png")

    save_rgba(master, 1024, ASSET_ROOT / "harmonyos" / "icon-foreground.png")
    save_solid(1024, ASSET_ROOT / "harmonyos" / "icon-background.png")
    save_rgba(master, 512, ASSET_ROOT / "harmonyos" / "start-window-icon.png")

    print("mobile icon generation passed")
    print(f"source={SOURCE}")
    print(f"master={ASSET_ROOT / 'app-icon-master-1024.png'}")


if __name__ == "__main__":
    main()
