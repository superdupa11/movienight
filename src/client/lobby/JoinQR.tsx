import { useEffect, useState } from "react";
import QRCode from "qrcode";

export default function JoinQR({ code, publicUrl }: { code: string; publicUrl: string }) {
  const [dataUrl, setDataUrl] = useState<string>();
  const joinUrl = `${publicUrl}/?code=${code}`;

  useEffect(() => {
    let cancelled = false;
    // errorCorrectionLevel "H" tolerates ~30% occlusion — the centered icon
    // badge below covers well under that, so it stays scannable. Modules stay
    // dark-on-light (not inverted) — an inverted QR failed to decode in
    // testing, since finder-pattern detection generally assumes that polarity.
    QRCode.toDataURL(joinUrl, {
      margin: 2,
      width: 200,
      errorCorrectionLevel: "H",
      color: { dark: "#08080b", light: "#f6f3ec" },
    }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [joinUrl]);

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-ink-950 p-4 ring-1 ring-inset ring-white/[0.06]">
      <div className="relative h-40 w-40">
        {dataUrl ? (
          <img src={dataUrl} alt="Join QR code" width={160} height={160} className="h-40 w-40 rounded-lg" />
        ) : (
          <div className="h-40 w-40 animate-pulse rounded-lg bg-white/5" />
        )}
        {dataUrl && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[10px] bg-ink-950 p-[3px] ring-1 ring-white/10">
            <img src="/icons/ic_launcher_512.png" alt="" width={34} height={34} className="h-[34px] w-[34px] rounded-[7px]" />
          </div>
        )}
      </div>
      <div className="text-center">
        <div className="font-mono text-3xl font-bold tracking-[0.3em] text-[#e0a34a]">{code}</div>
        <button
          className="mt-1 text-xs text-white/45 underline decoration-white/20 underline-offset-2"
          onClick={() => navigator.clipboard?.writeText(joinUrl)}
        >
          Copy link
        </button>
      </div>
    </div>
  );
}
