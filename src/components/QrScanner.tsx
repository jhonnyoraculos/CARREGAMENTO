"use client";

import { Html5Qrcode } from "html5-qrcode";
import { useEffect, useRef } from "react";

type Props = {
  onResult: (text: string) => void;
  onError?: (err: string) => void;
  active: boolean;
};

const QrScanner = ({ onResult, onError, active }: Props) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const idRef = useRef(`qr-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (!active) {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => undefined);
      }
      return;
    }
    const id = idRef.current;
    const scanner = new Html5Qrcode(id);
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: { ideal: "environment" } },
        { fps: 10, qrbox: 250 },
        (decodedText) => {
          onResult(decodedText);
        },
        (err) => onError?.(err)
      )
      .catch((err) => onError?.(String(err)));

    return () => {
      scanner.stop().catch(() => undefined);
      scanner.clear();
    };
  }, [active, onError, onResult]);

  return (
    <div
      id={idRef.current}
      style={{
        width: "100%",
        minHeight: 260,
        background: "#000",
        borderRadius: 12,
        overflow: "hidden",
      }}
    />
  );
};

export default QrScanner;
