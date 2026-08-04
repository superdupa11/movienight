import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

type Props = {
  onScan: (code: string) => void;
  onClose: () => void;
};

/** Matches our own JoinQR output ({publicUrl}/?code=XXXX) and, as a bonus, a bare 4-letter code. */
function extractRoomCode(text: string): string | null {
  try {
    const fromParam = new URL(text).searchParams.get("code");
    if (fromParam && /^[A-Za-z]{4}$/.test(fromParam)) return fromParam.toUpperCase();
  } catch {
    // not a URL — fall through to the bare-code check below
  }
  const trimmed = text.trim();
  return /^[A-Za-z]{4}$/.test(trimmed) ? trimmed.toUpperCase() : null;
}

export default function ScanQR({ onScan, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't access the camera.");
      return;
    }

    let stream: MediaStream | undefined;
    let frameId: number;
    let stopped = false;

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" });
          const code = result && extractRoomCode(result.data);
          if (code) {
            onScan(code);
            return;
          }
        }
      }
      if (!stopped) frameId = requestAnimationFrame(tick);
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
        frameId = requestAnimationFrame(tick);
      })
      .catch(() => setError("Camera access was denied — allow it in your browser settings to scan a code."));

    return () => {
      stopped = true;
      cancelAnimationFrame(frameId);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink-950">
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-56 w-56 rounded-2xl shadow-[inset_0_0_0_2px_rgba(255,255,255,.6)]" />
        </div>
      </div>

      <div className="flex flex-col items-center gap-4 px-6 py-6">
        <p className={`text-center font-mono text-[10px] tracking-[.18em] ${error ? "text-no" : "text-white/50"}`}>
          {error ?? "POINT YOUR CAMERA AT THE HOST'S QR CODE"}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-ink-800 px-6 py-2.5 text-sm font-semibold text-white ring-1 ring-white/10 transition active:scale-95"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
