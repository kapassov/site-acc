"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

type LocalQrCodeProps = {
  value: string;
  alt: string;
  size?: number;
};

export function LocalQrCode({ value, alt, size = 160 }: LocalQrCodeProps) {
  const renderKey = `${size}:${value}`;
  const [state, setState] = useState({
    key: "",
    source: "",
    failed: false,
  });

  useEffect(() => {
    let active = true;

    QRCode.toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 0,
      width: size,
      color: { dark: "#0f172a", light: "#ffffff" },
    }).then((dataUrl) => {
      if (active) setState({ key: renderKey, source: dataUrl, failed: false });
    }).catch(() => {
      if (active) setState({ key: renderKey, source: "", failed: true });
    });

    return () => {
      active = false;
    };
  }, [renderKey, size, value]);

  if (state.key === renderKey && state.failed) {
    return <div role="img" aria-label={alt} className="mx-auto mt-3 h-40 w-40 rounded-lg bg-white p-2" />;
  }
  if (state.key !== renderKey || !state.source) {
    return <div aria-hidden="true" className="mx-auto mt-3 h-40 w-40 animate-pulse rounded-lg bg-white p-2" />;
  }

  // The data URL is generated locally; no order identifier leaves the browser.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={state.source} alt={alt} width={size} height={size} className="mx-auto mt-3 rounded-lg bg-white p-2" />;
}
