"use client";

import { useState } from "react";
import type { Product } from "@/lib/types";
import { ProductArt } from "./ProductArt";

/**
 * Фото товара: реальный снимок (product.image) с object-contain; при ошибке/отсутствии —
 * иллюстрация-плейсхолдер ProductArt. Заменяет прямые <ProductArt/> в карточках/деталях.
 */
export function ProductImage({
  product,
  className,
}: {
  product: Pick<Product, "art" | "image" | "name">;
  className?: string;
}) {
  const [err, setErr] = useState(false);
  if (product.image && !err) {
    return (
      <div className={`grid place-items-center bg-white ${className ?? ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.image}
          alt={product.name}
          loading="lazy"
          onError={() => setErr(true)}
          className="h-full w-full object-contain"
        />
      </div>
    );
  }
  return <ProductArt art={product.art} className={className} />;
}
