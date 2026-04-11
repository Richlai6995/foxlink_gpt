/**
 * Phase 2E: AnnotationOverlay — SVG 標註渲染層
 * Phase 2F: 新增 animated 模式 — 標註按步驟順序逐一淡入
 *
 * 用於在播放器/編輯器中渲染截圖標註（步驟編號、圈、框、箭頭、文字等）。
 * 標註座標為百分比制（0-100），相對於截圖尺寸。
 */
import React, { useState, useEffect, useRef } from 'react';

export interface Annotation {
  id: string;
  type: 'number' | 'circle' | 'rect' | 'arrow' | 'text' | 'freehand' | 'mosaic';
  coords: {
    x: number;
    y: number;
    rx?: number;  // ellipse radius x (circle)
    ry?: number;  // ellipse radius y (circle)
    w?: number;   // width (rect/mosaic)
    h?: number;   // height (rect/mosaic)
    x2?: number;  // end x (arrow)
    y2?: number;  // end y (arrow)
    r?: number;   // legacy radius (circle)
    points?: { x: number; y: number }[];  // freehand path
  };
  color: string;
  strokeWidth?: number;
  label?: string;
  stepNumber?: number;
  purpose?: 'ai_hint' | 'display' | 'both';
  visible?: boolean;
}

interface AnnotationOverlayProps {
  annotations: Annotation[];
  /** 是否顯示標註（預設 true） */
  visible?: boolean;
  /** 是否為互動模式（可點擊選取） */
  interactive?: boolean;
  /** 動畫模式 — 標註按順序逐一淡入，每個間隔 ms（0=不動畫，立即全顯示） */
  animateInterval?: number;
  /** 選取回調 */
  onSelect?: (annotation: Annotation) => void;
  /**
   * 圖片 element ref — 用於把 SVG 尺寸/位置精準 sync 到圖片實際渲染區域。
   * 沒給的話就退回 fill parent，但會有 aspect-ratio 偏移。
   */
  imgRef?: React.RefObject<HTMLImageElement | null>;
}

const AnnotationOverlay: React.FC<AnnotationOverlayProps> = ({
  annotations,
  visible = true,
  interactive = false,
  animateInterval = 0,
  onSelect,
  imgRef,
}) => {
  // Animation: reveal annotations one by one
  const [revealCount, setRevealCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [imgAspect, setImgAspect] = useState(1);

  // Sync SVG size + position to image actual render box (handles object-fit, zoom, resize)
  useEffect(() => {
    if (!imgRef?.current) return;
    const img = imgRef.current;
    const sync = () => {
      const svg = svgRef.current;
      if (!svg || !img.clientWidth) return;
      // Position relative to nearest positioned ancestor (must be same as img's offsetParent)
      svg.style.width = img.clientWidth + 'px';
      svg.style.height = img.clientHeight + 'px';
      svg.style.left = img.offsetLeft + 'px';
      svg.style.top = img.offsetTop + 'px';
      if (img.naturalWidth && img.naturalHeight) {
        setImgAspect(img.naturalWidth / img.naturalHeight);
      }
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(img);
    img.addEventListener('load', sync);
    return () => { ro.disconnect(); img.removeEventListener('load', sync); };
  }, [imgRef]);

  const visibleAnnotations = annotations?.filter(a => a.visible !== false) || [];

  useEffect(() => {
    if (!visible || !animateInterval || visibleAnnotations.length === 0) {
      setRevealCount(visibleAnnotations.length);
      return;
    }
    setRevealCount(0);
    let count = 0;
    timerRef.current = setInterval(() => {
      count++;
      setRevealCount(count);
      if (count >= visibleAnnotations.length && timerRef.current) {
        clearInterval(timerRef.current);
      }
    }, animateInterval);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [visible, animateInterval, annotations?.length]);

  if (!visible || !visibleAnnotations.length) return null;

  const shownAnnotations = animateInterval > 0 ? visibleAnnotations.slice(0, revealCount) : visibleAnnotations;

  // Aspect-compensated radii: counter the X-stretch from preserveAspectRatio="none"
  // so circles look round and number badges aren't squashed.
  const cxR = 2.2 / imgAspect; // number badge rx
  const cyR = 2.2;             // number badge ry

  return (
    <svg
      ref={svgRef}
      // When imgRef is supplied we drive width/height/left/top via style; otherwise fall back to fill parent.
      className={imgRef ? 'absolute pointer-events-none' : 'absolute inset-0 w-full h-full'}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ pointerEvents: interactive ? 'auto' : 'none' }}
    >
      <defs>
        <marker
          id="annotation-arrowhead"
          markerWidth="10"
          markerHeight="7"
          refX="10"
          refY="3.5"
          orient="auto"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
        </marker>
        {/* Mosaic pattern */}
        <pattern id="mosaic-pattern" x="0" y="0" width="2" height="2" patternUnits="userSpaceOnUse">
          <rect width="1" height="1" fill="#94a3b8" opacity="0.8" />
          <rect x="1" y="1" width="1" height="1" fill="#64748b" opacity="0.8" />
          <rect x="1" width="1" height="1" fill="#cbd5e1" opacity="0.6" />
          <rect y="1" width="1" height="1" fill="#475569" opacity="0.6" />
        </pattern>
      </defs>

      {shownAnnotations.map((a) => {
        const key = a.id || `ann-${a.type}-${a.coords.x}-${a.coords.y}`;
        const handleClick = interactive ? () => onSelect?.(a) : undefined;

        switch (a.type) {
          case 'number': {
            // Compensate X-stretch (preserveAspectRatio="none") for the badge & text only.
            // Apply scale around the badge centre so position stays exact.
            const compTxt = `translate(${a.coords.x} ${a.coords.y}) scale(${1 / imgAspect} 1) translate(${-a.coords.x} ${-a.coords.y})`;
            return (
              <g key={key} onClick={handleClick} style={{ cursor: interactive ? 'pointer' : undefined }}>
                <ellipse
                  cx={a.coords.x}
                  cy={a.coords.y}
                  rx={cxR}
                  ry={cyR}
                  fill={a.color || '#ef4444'}
                  stroke="#fff"
                  strokeWidth="0.2"
                />
                <text
                  x={a.coords.x}
                  y={a.coords.y}
                  transform={compTxt}
                  fill="#fff"
                  fontSize="2.6"
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontWeight="bold"
                  fontFamily="sans-serif"
                >
                  {a.stepNumber}
                </text>
                {a.label && (
                  <text
                    x={a.coords.x + cxR + 0.6}
                    y={a.coords.y + 0.5}
                    transform={`translate(${a.coords.x + cxR + 0.6} ${a.coords.y + 0.5}) scale(${1 / imgAspect} 1) translate(${-(a.coords.x + cxR + 0.6)} ${-(a.coords.y + 0.5)})`}
                    fill={a.color || '#ef4444'}
                    fontSize="1.8"
                    fontWeight="600"
                    fontFamily="sans-serif"
                    stroke="#000"
                    strokeWidth="0.12"
                    paintOrder="stroke"
                  >
                    {a.label}
                  </text>
                )}
              </g>
            );
          }

          case 'circle': {
            // Note: when only `r` is given (legacy), assume the user expected a round circle
            // → divide rx by aspect to compensate the X-stretch from preserveAspectRatio="none".
            const legacyR = a.coords.r;
            const rx = a.coords.rx ?? (legacyR != null ? legacyR / imgAspect : 5);
            const ry = a.coords.ry ?? legacyR ?? 5;
            return (
              <ellipse
                key={key}
                cx={a.coords.x}
                cy={a.coords.y}
                rx={rx}
                ry={ry}
                fill="none"
                stroke={a.color || '#ef4444'}
                strokeWidth={((a.strokeWidth || 3) / 3) * 0.3}
                onClick={handleClick}
                style={{ cursor: interactive ? 'pointer' : undefined }}
              />
            );
          }

          case 'rect':
            return (
              <rect
                key={key}
                x={a.coords.x}
                y={a.coords.y}
                width={a.coords.w || 10}
                height={a.coords.h || 5}
                fill="none"
                stroke={a.color || '#22c55e'}
                strokeWidth={((a.strokeWidth || 3) / 3) * 0.3}
                onClick={handleClick}
                style={{ cursor: interactive ? 'pointer' : undefined }}
              />
            );

          case 'arrow': {
            const lx = (a.coords.x + (a.coords.x2 ?? a.coords.x + 10)) / 2;
            const ly = (a.coords.y + (a.coords.y2 ?? a.coords.y)) / 2 - 1;
            return (
              <g key={key} style={{ color: a.color || '#3b82f6' }}>
                <line
                  x1={a.coords.x}
                  y1={a.coords.y}
                  x2={a.coords.x2 ?? a.coords.x + 10}
                  y2={a.coords.y2 ?? a.coords.y}
                  stroke={a.color || '#3b82f6'}
                  strokeWidth={((a.strokeWidth || 3) / 3) * 0.3}
                  markerEnd="url(#annotation-arrowhead)"
                  onClick={handleClick}
                  style={{ cursor: interactive ? 'pointer' : undefined }}
                />
                {a.label && (
                  <text
                    x={lx}
                    y={ly}
                    transform={`translate(${lx} ${ly}) scale(${1 / imgAspect} 1) translate(${-lx} ${-ly})`}
                    fill={a.color || '#3b82f6'}
                    fontSize="1.6"
                    textAnchor="middle"
                    fontWeight="600"
                    fontFamily="sans-serif"
                    stroke="#000"
                    strokeWidth="0.1"
                    paintOrder="stroke"
                  >
                    {a.label}
                  </text>
                )}
              </g>
            );
          }

          case 'text': {
            const textLines = String(a.label || '').split('\n');
            const textLh = 2.2 * 1.25;
            return (
              <text
                key={key}
                x={a.coords.x}
                y={a.coords.y}
                transform={`translate(${a.coords.x} ${a.coords.y}) scale(${1 / imgAspect} 1) translate(${-a.coords.x} ${-a.coords.y})`}
                fill={a.color || '#eab308'}
                fontSize="2.2"
                fontWeight="600"
                fontFamily="sans-serif"
                stroke="#000"
                strokeWidth="0.12"
                paintOrder="stroke"
                onClick={handleClick}
                style={{ cursor: interactive ? 'pointer' : undefined }}
              >
                {textLines.map((ln, i) => (
                  <tspan key={i} x={a.coords.x} dy={i === 0 ? 0 : textLh}>{ln || ' '}</tspan>
                ))}
              </text>
            );
          }

          case 'freehand': {
            if (!a.coords.points?.length) return null;
            const d = a.coords.points
              .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`)
              .join(' ');
            return (
              <path
                key={key}
                d={d}
                fill="none"
                stroke={a.color || '#ef4444'}
                strokeWidth={((a.strokeWidth || 3) / 3) * 0.3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          }

          case 'mosaic':
            return (
              <rect
                key={key}
                x={a.coords.x}
                y={a.coords.y}
                width={a.coords.w || 10}
                height={a.coords.h || 5}
                fill="url(#mosaic-pattern)"
                opacity="0.9"
              />
            );

          default:
            return null;
        }
      })}
    </svg>
  );
};

export default AnnotationOverlay;
