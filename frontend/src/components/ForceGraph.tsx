'use client';
import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';
import type { GraphVisualization } from '@/lib/types';

interface SimNode {
  id: string;
  label: string;
  type: string;
  score?: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface SimLink {
  source: SimNode;
  target: SimNode;
  relation?: string;
}

const TYPE_COLORS: Record<string, string> = {
  skill: '#22c55e',
  vuln: '#ef4444',
  tool: '#3b82f6',
  mitigation: '#10b981',
  project: '#a855f7',
  ctf: '#f59e0b',
  role: '#06b6d4',
  company: '#6366f1',
  interview_q: '#ec4899',
  source: '#6b7280',
};

const SIM_EPSILON = 0.005;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;

export default function ForceGraph({
  nodes: rawNodes,
  links: rawLinks,
  onSelectNode,
  selectedNodeId,
}: {
  nodes: GraphVisualization['nodes'];
  links: GraphVisualization['links'];
  onSelectNode?: (node: GraphVisualization['nodes'][number]) => void;
  selectedNodeId?: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 550 });

  // Physics + interaction state live in refs so the RAF loop is not
  // restarted by hover/drag (which previously caused constant re-renders).
  const simRef = useRef<{ nodes: SimNode[]; links: SimLink[]; animId: number | null; alpha: number }>({
    nodes: [], links: [], animId: null, alpha: 1,
  });
  const interactionRef = useRef({
    panning: false,
    panStart: { x: 0, y: 0 },
    draggedNode: null as SimNode | null,
    pointerDown: false,
  });
  const viewRef = useRef({ pan: { x: 0, y: 0 }, zoom: 1, selectedNodeId: null as string | null });
  viewRef.current = { pan, zoom, selectedNodeId: selectedNodeId ?? null };
  const hoverRef = useRef<SimNode | null>(null);

  // Seed the simulation when graph data changes.
  useEffect(() => {
    const sim = simRef.current;
    if (!rawNodes.length) {
      sim.nodes = [];
      sim.links = [];
      return;
    }
    const width = containerRef.current?.clientWidth || 800;
    const height = 550;

    const previous = new Map(sim.nodes.map((n) => [n.id, n]));
    const nodeMap = new Map<string, SimNode>();
    const graphNodes: SimNode[] = rawNodes.map((n, idx) => {
      const prev = previous.get(n.id);
      const angle = (idx / rawNodes.length) * 2 * Math.PI;
      const radius = 100 + ((idx * 37) % 150); // deterministic spread
      return prev ?? {
        ...n,
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        radius: n.type === 'skill' ? 14 : 10,
      };
    });
    for (const n of graphNodes) nodeMap.set(n.id, n);

    const graphLinks: SimLink[] = [];
    for (const l of rawLinks) {
      const s = nodeMap.get(l.source);
      const t = nodeMap.get(l.target);
      if (s && t) graphLinks.push({ source: s, target: t, relation: l.relation });
    }

    sim.nodes = graphNodes;
    sim.links = graphLinks;
    sim.alpha = 1; // reheat on data change
  }, [rawNodes, rawLinks]);

  // Physics + render loop. Starts on data change; stops when settled.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const syncCanvasSize = () => {
      const width = containerRef.current?.clientWidth || 800;
      setCanvasSize({ width, height: 550 });
      canvas.width = width * dpr;
      canvas.height = 550 * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = '550px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    syncCanvasSize();

    const ro = new ResizeObserver(syncCanvasSize);
    if (containerRef.current) ro.observe(containerRef.current);

    const step = () => {
      const sim = simRef.current;
      const { pan, zoom, selectedNodeId } = viewRef.current;
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;
      const cx = width / 2;
      const cy = height / 2;
      const { nodes, links } = sim;

      // Advance physics only while hot.
      if (sim.alpha > SIM_EPSILON) {
        sim.alpha *= 0.98;
        for (let i = 0; i < nodes.length; i++) {
          const n1 = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const n2 = nodes[j];
            const dx = n2.x - n1.x;
            const dy = n2.y - n1.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            if (dist < 250) {
              const force = (3500 / (dist * dist)) * sim.alpha;
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;
              n1.vx -= fx;
              n1.vy -= fy;
              n2.vx += fx;
              n2.vy += fy;
            }
          }
          n1.vx += (cx - n1.x) * 0.005 * sim.alpha;
          n1.vy += (cy - n1.y) * 0.005 * sim.alpha;
        }
        for (const link of links) {
          const s = link.source;
          const t = link.target;
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (dist - 90) * 0.04 * sim.alpha;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          s.vx += fx;
          s.vy += fy;
          t.vx -= fx;
          t.vy -= fy;
        }
        const dragged = interactionRef.current.draggedNode;
        for (const n of nodes) {
          if (n === dragged) continue;
          n.vx *= 0.85;
          n.vy *= 0.85;
          n.x += n.vx;
          n.y += n.vy;
        }
      }

      // Draw frame.
      const isDarkMode = document.documentElement.classList.contains('dark');
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(zoom, zoom);

      for (const link of links) {
        const s = link.source;
        const t = link.target;
        const hovered = hoverRef.current;
        const isHighlighted = hovered && (hovered.id === s.id || hovered.id === t.id);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.strokeStyle = isHighlighted
          ? '#22c55e'
          : isDarkMode
          ? 'rgba(148, 163, 184, 0.25)'
          : 'rgba(203, 213, 225, 0.6)';
        ctx.lineWidth = isHighlighted ? 2.5 : 1;
        ctx.stroke();
        if (link.relation && zoom > 0.8) {
          ctx.font = '9px var(--font-inter), sans-serif';
          ctx.fillStyle = isDarkMode ? '#94a3b8' : '#64748b';
          ctx.textAlign = 'center';
          ctx.fillText(link.relation, (s.x + t.x) / 2, (s.y + t.y) / 2 - 3);
        }
      }

      for (const n of nodes) {
        const isSelected = selectedNodeId === n.id;
        const isHovered = hoverRef.current?.id === n.id;
        const radius = n.radius * (isSelected || isHovered ? 1.3 : 1);
        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, radius + 5, 0, 2 * Math.PI);
          ctx.fillStyle = isSelected ? 'rgba(34, 197, 94, 0.3)' : 'rgba(59, 130, 246, 0.3)';
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = TYPE_COLORS[n.type] || '#64748b';
        ctx.fill();
        ctx.lineWidth = isSelected ? 3 : 1.5;
        ctx.strokeStyle = isDarkMode ? '#0f172a' : '#ffffff';
        ctx.stroke();
        ctx.font = `${isSelected || isHovered ? 'bold 12px' : '11px'} var(--font-inter), sans-serif`;
        ctx.fillStyle = isDarkMode ? '#f8fafc' : '#0f172a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(n.label, n.x, n.y + radius + 4);
      }

      ctx.restore();

      // Keep animating while the user drags; otherwise stop when settled.
      const interacting = interactionRef.current.draggedNode || interactionRef.current.panning;
      if (sim.alpha > SIM_EPSILON || interacting) {
        sim.animId = requestAnimationFrame(step);
      } else {
        sim.animId = null;
      }
    };

    // (Re)start loop only if not already running.
    if (simRef.current.animId === null) {
      simRef.current.alpha = Math.max(simRef.current.alpha, SIM_EPSILON * 2);
      simRef.current.animId = requestAnimationFrame(step);
    }

    return () => {
      ro.disconnect();
    };
  }, [rawNodes, rawLinks]);

  useEffect(() => {
    return () => {
      if (simRef.current.animId !== null) {
        cancelAnimationFrame(simRef.current.animId);
        simRef.current.animId = null;
      }
    };
  }, []);

  const toCanvasCoords = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - viewRef.current.pan.x) / viewRef.current.zoom,
      y: (clientY - rect.top - viewRef.current.pan.y) / viewRef.current.zoom,
    };
  };

  const findNodeAt = (cx: number, cy: number): SimNode | null => {
    for (const n of simRef.current.nodes) {
      const dx = n.x - cx;
      const dy = n.y - cy;
      const r = n.radius + 5;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);
    const hit = findNodeAt(x, y);
    interactionRef.current.pointerDown = true;
    canvasRef.current?.setPointerCapture(e.pointerId);
    if (hit) {
      interactionRef.current.draggedNode = hit;
      // Keep the loop alive while dragging.
      simRef.current.alpha = Math.max(simRef.current.alpha, 0.05);
      onSelectNode?.({
        id: hit.id,
        type: hit.type as GraphVisualization['nodes'][number]['type'],
        label: hit.label,
        score: hit.score ?? 0,
      });
    } else {
      interactionRef.current.panning = true;
      interactionRef.current.panStart = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);
    const interaction = interactionRef.current;

    if (interaction.draggedNode) {
      interaction.draggedNode.x = x;
      interaction.draggedNode.y = y;
      interaction.draggedNode.vx = 0;
      interaction.draggedNode.vy = 0;
      return;
    }
    if (interaction.panning) {
      setPan({ x: e.clientX - interaction.panStart.x, y: e.clientY - interaction.panStart.y });
      return;
    }
    const hovered = findNodeAt(x, y);
    if (hovered !== hoverRef.current) {
      hoverRef.current = hovered;
      canvasRef.current!.style.cursor = hovered ? 'pointer' : 'grab';
      if (simRef.current.animId === null) {
        // One repaint for the hover highlight.
        simRef.current.alpha = Math.max(simRef.current.alpha, SIM_EPSILON * 2);
        simRef.current.animId = requestAnimationFrame(() => {});
        simRef.current.animId = null;
      }
    }
  };

  const onPointerUp = () => {
    interactionRef.current.draggedNode = null;
    interactionRef.current.panning = false;
    interactionRef.current.pointerDown = false;
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((prev) => Math.min(Math.max(prev * zoomFactor, ZOOM_MIN), ZOOM_MAX));
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 shadow-inner"
    >
      {/* Legend */}
      <div className="absolute top-4 left-4 z-10 flex flex-wrap gap-2 max-w-xs sm:max-w-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-md p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs shadow-sm">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="capitalize font-medium text-slate-700 dark:text-slate-300">{type}</span>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-1.5 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
        <button onClick={() => setZoom((z) => Math.min(z * 1.2, ZOOM_MAX))} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-700 dark:text-slate-300 transition-colors" title="Zoom In" aria-label="Zoom in">
          <ZoomIn className="w-4 h-4" />
        </button>
        <button onClick={() => setZoom((z) => Math.max(z * 0.8, ZOOM_MIN))} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-700 dark:text-slate-300 transition-colors" title="Zoom Out" aria-label="Zoom out">
          <ZoomOut className="w-4 h-4" />
        </button>
        <button onClick={resetView} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-700 dark:text-slate-300 transition-colors" title="Reset View" aria-label="Reset view">
          <RefreshCw className="w-4 h-4" />
        </button>
        <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-700 dark:text-slate-300 transition-colors hidden" aria-hidden="true" tabIndex={-1}>
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
        className="w-full h-[550px] cursor-grab active:cursor-grabbing block touch-none"
      />

      <div className="sr-only" role="status" aria-live="polite">
        Knowledge graph: {rawNodes.length} nodes, {rawLinks.length} relationships rendered.
        {selectedNodeId && ` Selected node: ${selectedNodeId}.`}
      </div>

      <div className="absolute bottom-3 left-4 text-xs text-slate-500 dark:text-slate-400 pointer-events-none">
        Click node to inspect • Drag node to move • Scroll to zoom • Drag canvas to pan
      </div>
    </div>
  );
}
