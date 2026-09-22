#!/usr/bin/env python3
"""Prepare a conservative Daribar image batch for the Medusa importer.

Only products whose Inkar handle is exactly equal to one unique Daribar URL key
are considered.  The live Daribar product payload must confirm the same URL key,
and the image must exist in the public object index.  No fuzzy or numeric-ID
matching is performed.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

from PIL import Image


HANDLE_SUFFIX_RE = re.compile(r"-[0-9a-f]{8}$", re.IGNORECASE)
UUID_RE = re.compile(
    r"^[0-9A-F]{8}-[0-9A-F]{4}-[1-5][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$"
)
IMAGE_PREFIX = "optimized_v4_img_small_"
IMAGE_BUCKET = "https://db-images.object.pscloud.io/"
PRODUCT_API = "https://prod-backoffice.daribar.com/api/v2/products/cache/get?sku="
USER_AGENT = "Mozilla/5.0 (compatible; InkarCatalogImageAudit/1.0)"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--sitemap", type=Path, required=True)
    parser.add_argument("--image-index", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def fetch_bytes(url: str, max_bytes: int = 10 * 1024 * 1024) -> bytes:
    request = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/json,image/*"}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        length = int(response.headers.get("Content-Length") or 0)
        if length > max_bytes:
            raise ValueError(f"response exceeds {max_bytes} bytes")
        body = response.read(max_bytes + 1)
    if len(body) > max_bytes:
        raise ValueError(f"response exceeds {max_bytes} bytes")
    return body


def attributes_by_code(product: dict) -> dict[str, list]:
    result: dict[str, list] = {}
    for attribute in product.get("attributes") or []:
        if not isinstance(attribute, dict):
            continue
        code = str(attribute.get("code") or "").strip()
        values = attribute.get("values")
        if code and isinstance(values, list):
            result[code] = values
    return result


def first_value(attributes: dict[str, list], code: str) -> str:
    values = attributes.get(code) or []
    return str(values[0]).strip() if values else ""


def load_image_keys(path: Path) -> dict[str, str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    keys: dict[str, str] = {}
    duplicates: set[str] = set()
    for item in payload:
        key = str(item.get("key") or "") if isinstance(item, dict) else ""
        if not key.startswith(IMAGE_PREFIX) or not key.endswith(".webp"):
            continue
        sku = key[len(IMAGE_PREFIX) : -len(".webp")].strip()
        if sku in keys and keys[sku] != key:
            duplicates.add(sku)
        else:
            keys[sku] = key
    for sku in duplicates:
        keys.pop(sku, None)
    return keys


def load_candidates(args: argparse.Namespace) -> tuple[list[dict], list[dict]]:
    sitemap = json.loads(args.sitemap.read_text(encoding="utf-8"))
    by_slug: dict[str, list[str]] = defaultdict(list)
    for sku, slug in sitemap:
        by_slug[str(slug).strip().lower()].append(str(sku).strip())

    image_keys = load_image_keys(args.image_index)
    candidates: list[dict] = []
    rejected: list[dict] = []
    with args.catalog.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        next(reader, None)
        for row in reader:
            if len(row) < 17:
                rejected.append({"reason": "invalid_catalog_row"})
                continue
            product_id, product_handle, title = row[0], row[1], row[2]
            brand, manufacturer, ware_id = row[4], row[5], row[8].upper()
            slug = HANDLE_SUFFIX_RE.sub("", product_handle.lower())
            matches = by_slug.get(slug) or []
            if len(matches) != 1:
                continue
            daribar_sku = matches[0]
            image_key = image_keys.get(daribar_sku)
            if not UUID_RE.fullmatch(ware_id):
                rejected.append(
                    {"product_id": product_id, "title": title, "reason": "invalid_ware_id"}
                )
                continue
            if not image_key:
                rejected.append(
                    {
                        "product_id": product_id,
                        "title": title,
                        "slug": slug,
                        "daribar_sku": daribar_sku,
                        "reason": "daribar_image_missing",
                    }
                )
                continue
            candidates.append(
                {
                    "product_id": product_id,
                    "handle": product_handle,
                    "title": title,
                    "brand": brand,
                    "manufacturer": manufacturer,
                    "ware_id": ware_id,
                    "slug": slug,
                    "daribar_sku": daribar_sku,
                    "image_key": image_key,
                }
            )
    candidates.sort(key=lambda item: item["ware_id"])
    return candidates, rejected


def verify_and_download(candidate: dict, images_dir: Path) -> dict:
    sku = candidate["daribar_sku"]
    detail_url = PRODUCT_API + urllib.parse.quote(sku, safe="")
    detail = json.loads(fetch_bytes(detail_url).decode("utf-8"))
    products = detail.get("result") if isinstance(detail, dict) else None
    if not isinstance(products, list) or len(products) != 1:
        raise ValueError("Daribar product payload is not unique")
    product = products[0]
    attributes = attributes_by_code(product)
    confirmed_slug = first_value(attributes, "url_key").lower()
    if confirmed_slug != candidate["slug"]:
        raise ValueError("Daribar URL key changed or does not match")

    image_url = IMAGE_BUCKET + urllib.parse.quote(candidate["image_key"], safe="")
    source = fetch_bytes(image_url)
    with Image.open(io.BytesIO(source)) as image:
        image.load()
        width, height = image.size
        if width < 80 or height < 80 or width > 5000 or height > 5000:
            raise ValueError(f"invalid image dimensions: {width}x{height}")
        rgba = image.convert("RGBA")
        white = Image.new("RGBA", rgba.size, "white")
        white.alpha_composite(rgba)
        rgb = white.convert("RGB")
        output_path = images_dir / f"{candidate['ware_id']}.jpg"
        rgb.save(output_path, "JPEG", quality=92, optimize=True)

    output = output_path.read_bytes()
    candidate.update(
        {
            "status": "approved",
            "daribar_name": str(product.get("name") or "").strip(),
            "daribar_manufacturer": first_value(attributes, "manufacturer_id"),
            "daribar_packing": first_value(attributes, "pp_packing"),
            "source_url": image_url,
            "output_file": output_path.name,
            "width": width,
            "height": height,
            "source_sha256": hashlib.sha256(source).hexdigest(),
            "output_sha256": hashlib.sha256(output).hexdigest(),
            "output_bytes": len(output),
        }
    )
    return candidate


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    images_dir = args.output_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    candidates, rejected = load_candidates(args)
    if args.limit:
        candidates = candidates[: args.limit]

    approved: list[dict] = []
    if args.download:
        for index, candidate in enumerate(candidates, start=1):
            try:
                approved.append(verify_and_download(candidate, images_dir))
                print(f"[{index}/{len(candidates)}] approved {candidate['title']}")
            except Exception as error:  # keep the batch auditable and resumable
                rejected.append({**candidate, "reason": "verification_failed", "error": str(error)})
                print(f"[{index}/{len(candidates)}] rejected {candidate['title']}: {error}")
            time.sleep(0.12)

    manifest = {
        "policy": "exact unique URL-key match only; no fuzzy or numeric-ID matching",
        "candidate_count": len(candidates),
        "approved_count": len(approved),
        "rejected_count": len(rejected),
        "approved": approved,
        "rejected": rejected,
    }
    (args.output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({key: manifest[key] for key in ("candidate_count", "approved_count", "rejected_count")}))


if __name__ == "__main__":
    main()
