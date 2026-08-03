import { useEffect, useState } from "react";
import QRCode from "qrcode";

export default function JoinQR({ code, publicUrl }: { code: string; publicUrl: string }) {
  const [dataUrl, setDataUrl] = useState<string>();
  const joinUrl = `${publicUrl}/?code=${code}`;

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(joinUrl, { margin: 1, width: 200, color: { dark: "#0a0a0f", light: "#ffffff" } }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [joinUrl]);

  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl bg-white p-4">
      {dataUrl ? <img src={dataUrl} alt="Join QR code" width={160} height={160} /> : <div className="h-40 w-40 animate-pulse bg-black/10" />}
      <div className="text-center">
        <div className="font-mono text-3xl font-bold tracking-[0.3em] text-ink-950">{code}</div>
        <button
          className="mt-1 text-xs text-ink-950/60 underline"
          onClick={() => navigator.clipboard?.writeText(joinUrl)}
        >
          Copy link
        </button>
      </div>
    </div>
  );
}
