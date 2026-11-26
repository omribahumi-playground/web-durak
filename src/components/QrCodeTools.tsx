import jsQR from 'jsqr';
import QRCode from 'qrcode';
import React, { useEffect, useRef, useState } from 'react';

interface QrCodeDisplayProps {
  value: string;
  label?: string;
  size?: number;
}

export const QrCodeDisplay: React.FC<QrCodeDisplayProps> = ({
  value,
  label,
  size = 240,
}) => {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let active = true;
    setError('');
    QRCode.toDataURL(value, {
      errorCorrectionLevel: 'L',
      margin: 2,
      width: size,
      color: {
        dark: '#091713',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setError('Could not render QR code.');
      });
    return () => {
      active = false;
    };
  }, [size, value]);

  return (
    <div className="qr-display-box">
      {label && <div className="qr-display-label">{label}</div>}
      {error ? (
        <p className="error-text">{error}</p>
      ) : dataUrl ? (
        <img
          src={dataUrl}
          alt={label || 'Invite QR Code'}
          className="qr-image"
          width={size}
          height={size}
        />
      ) : (
        <div className="qr-loading">Generating QR...</div>
      )}
    </div>
  );
};

interface QrScannerModalProps {
  title: string;
  hint?: string;
  onScan: (decodedText: string) => void;
  onClose: () => void;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  title,
  hint = 'Point your camera at the other device’s QR code.',
  onScan,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraError, setCameraError] = useState<string>('');
  const [photoError, setPhotoError] = useState<string>('');
  const [scanning, setScanning] = useState<boolean>(true);
  const scannedOnceRef = useRef<boolean>(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          'Camera access isn’t available here. You can scan from a photo or screenshot below instead.',
        );
        setScanning(false);
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 720 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }

        timer = setInterval(() => {
          if (scannedOnceRef.current) return;
          const v = videoRef.current;
          const c = canvasRef.current;
          if (!v || !c || v.readyState < 2 || v.videoWidth === 0) return;

          const w = v.videoWidth;
          const h = v.videoHeight;
          if (c.width !== w || c.height !== h) {
            c.width = w;
            c.height = h;
          }
          const ctx = c.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(v, 0, 0, w, h);
          const imageData = ctx.getImageData(0, 0, w, h);
          const result = jsQR(imageData.data, w, h, {
            inversionAttempts: 'dontInvert',
          });
          if (result?.data) {
            scannedOnceRef.current = true;
            onScan(result.data.trim());
          }
        }, 120);
      } catch {
        if (!cancelled) {
          setCameraError(
            'Could not open camera (check browser permissions). You can still scan from a photo or screenshot below.',
          );
          setScanning(false);
        }
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [onScan]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhotoError('');
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(data.data, canvas.width, canvas.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (decoded?.data) {
          onScan(decoded.data.trim());
        } else {
          setPhotoError('No QR code found in that image. Try cropping closer to the QR code.');
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card qr-scanner-card" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-ghost btn-xs" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className="muted-small">{hint}</p>

        {scanning && !cameraError ? (
          <div className="qr-video-wrap">
            <video ref={videoRef} playsInline muted className="qr-video" />
            <div className="qr-reticle" aria-hidden="true" />
            <canvas ref={canvasRef} className="qr-hidden-canvas" />
          </div>
        ) : (
          <div className="qr-camera-fallback">
            <p className="error-text">{cameraError}</p>
          </div>
        )}

        <div className="qr-photo-fallback">
          <label className="btn btn-secondary btn-sm qr-file-label">
            🖼️ Scan QR from Photo / Screenshot
            <input
              type="file"
              accept="image/*"
              onChange={handlePhotoUpload}
              className="qr-file-input"
            />
          </label>
          {photoError && <p className="error-text">{photoError}</p>}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
