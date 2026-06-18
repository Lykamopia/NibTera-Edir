'use client';

import { useRef, useEffect, useState, useLayoutEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Undo, Trash2, Save } from 'lucide-react';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

interface SignaturePadProps {
  onSave: (dataUrl: string) => void;
  initialSignature?: string;
}

interface Point {
  x: number;
  y: number;
  time: number;
}

export function SignaturePad({ onSave, initialSignature }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [strokeColor, setStrokeColor] = useState('#000000');
  const [history, setHistory] = useState<ImageData[]>([]);
  const [isClient, setIsClient] = useState(false);

  const pointsRef = useRef<Point[]>([]);

  // We wait for the component to mount before rendering the canvas
  // to ensure window/document are available.
  useEffect(() => {
    setIsClient(true);
  }, []);

  const getContext = useCallback(() => {
    const canvas = canvasRef.current;
    return canvas?.getContext('2d');
  }, []);

  // Effect to handle canvas DPI scaling
  useLayoutEffect(() => {
    if (!isClient) return;
    const canvas = canvasRef.current;
    const context = getContext();
    if (!canvas || !context) return;
    
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    context.scale(dpr, dpr);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    // If there's an initial signature, draw it.
    if (initialSignature) {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => {
            context.clearRect(0, 0, canvas.width/dpr, canvas.height/dpr);
            context.drawImage(image, 0, 0, canvas.width / dpr, canvas.height / dpr);
        }
        image.src = initialSignature;
    }
  }, [isClient, initialSignature, getContext]);

  const saveHistory = useCallback(() => {
    const context = getContext();
    if (context) {
        const { canvas } = context;
        setHistory(prev => [...prev, context.getImageData(0, 0, canvas.width, canvas.height)]);
    }
  }, [getContext]);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const context = getContext();
    if (!context) return;
    saveHistory();

    const { x, y } = getCoordinates(e);
    pointsRef.current = [{ x, y, time: Date.now() }];
    
    context.lineWidth = strokeWidth;
    context.strokeStyle = strokeColor;
    context.beginPath();
    context.moveTo(x,y);
    
    setIsDrawing(true);
  };
  
  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const context = getContext();
    if (!context) return;
    const { x, y } = getCoordinates(e);
    const newPoint = { x, y, time: Date.now() };
    pointsRef.current.push(newPoint);

    if(pointsRef.current.length < 3) {
      context.lineTo(x, y);
      context.stroke();
      return;
    }
    
    // Use the second to last point and the new point to create a quadratic curve
    const points = pointsRef.current;
    const p2 = points[points.length-2];
    const p3 = points[points.length-1];

    const midPoint = {
      x: (p2.x + p3.x) / 2,
      y: (p2.y + p3.y) / 2,
    };

    context.quadraticCurveTo(p2.x, p2.y, midPoint.x, midPoint.y);
    context.stroke();
    context.beginPath();
    context.moveTo(midPoint.x, midPoint.y);
  };

  const stopDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const context = getContext();
    if (!context) return;

    context.closePath();
    setIsDrawing(false);
    pointsRef.current = [];
  };

  const clearCanvas = () => {
    const context = getContext();
    if (context) {
        saveHistory();
        context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    }
  };
  
  const undoLast = () => {
    const context = getContext();
    if (context && history.length > 0) {
        const lastState = history[history.length - 1];
        setHistory(prev => prev.slice(0, -1));
        context.putImageData(lastState, 0, 0);
    } else if (context) {
        context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    }
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = getContext();
    if (!context) return;
    
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas;
    const imageData = context.getImageData(0, 0, width, height);
    const data = imageData.data;
    let minX = width, minY = height, maxX = -1, maxY = -1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] > 0) { // Check for non-transparent pixels
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (maxX === -1) { // Canvas is empty
      onSave('');
      return;
    }

    const padding = 20 * dpr;
    const trimmedWidth = maxX - minX + 2 * padding;
    const trimmedHeight = maxY - minY + 2 * padding;

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = trimmedWidth;
    finalCanvas.height = trimmedHeight;
    const finalCtx = finalCanvas.getContext('2d');
    if (!finalCtx) return;
    
    finalCtx.drawImage(canvas, minX, minY, maxX - minX, maxY - minY, padding, padding, maxX - minX, maxY - minY);
    
    onSave(finalCanvas.toDataURL('image/webp', 0.95));
  };

  if (!isClient) return <div className="h-[300px] w-full max-w-[500px] bg-white rounded-md animate-pulse"></div>;

  return (
    <div className="flex flex-col gap-4">
      {/* 
          Drawing area refactored to use a constant white background 
          to match final display and ensure ink visibility.
      */}
      <canvas
        ref={canvasRef}
        className="w-full max-w-[500px] h-[300px] rounded-md border-2 border-dashed border-slate-200 bg-white cursor-crosshair touch-none shadow-inner"
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
      />
      <div className="flex flex-col sm:flex-row items-center gap-4 bg-muted/30 p-3 rounded-lg border">
        <div className="flex items-center gap-2">
            <Label className="text-xs font-semibold">INK:</Label>
            <Input
                type="color"
                value={strokeColor}
                onChange={(e) => setStrokeColor(e.target.value)}
                className="w-10 h-8 p-0.5 border-none bg-transparent"
            />
        </div>
        <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
            <Label className="text-xs font-semibold">WEIGHT:</Label>
            <Slider
                min={1}
                max={10}
                step={0.5}
                value={[strokeWidth]}
                onValueChange={(value) => setStrokeWidth(value[0])}
                className="flex-1"
            />
        </div>
        <div className="flex gap-2 shrink-0">
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={undoLast} disabled={history.length === 0}>
                            <Undo className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Undo</TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={clearCanvas}>
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Clear All</TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </div>
      </div>
       <div className="flex justify-end pt-2">
            <Button onClick={handleSave} className="gap-2">
                <Save className="h-4 w-4" />
                Capture Signature
            </Button>
        </div>
    </div>
  );
}