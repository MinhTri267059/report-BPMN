/* ===========================
   BPMN PROCESS VISUALIZER
   app.js — Full Graph Engine
=========================== */

// ===== STATE =====
const state = {
  nodes: [],       // { id, type, x, y, label, duration }
  edges: [],       // { id, from, to, label }
  selectedNode: null,
  selectedEdge: null,
  connectMode: false,
  connectFrom: null,
  nextId: 1,
  draggingNode: null,
  dragOffset: { x: 0, y: 0 },
  highlightedPath: -1,
  scenarios: []
};

// ===== DOM REFS =====
const canvas = document.getElementById('canvas');
const nodesLayer = document.getElementById('nodes-layer');
const edgesLayer = document.getElementById('edges-layer');

// ===== NODE DIMENSIONS =====
const NODE_CONFIG = {
  start:       { width: 40, height: 40, shape: 'circle', color: '#22c55e', textColor: '#fff', label: 'Start' },
  end:         { width: 40, height: 40, shape: 'circle', color: '#ef4444', textColor: '#fff', label: 'End' },
  task:        { width: 120, height: 50, shape: 'rect',  color: '#6366f1', textColor: '#fff', label: 'Task' },
  'gateway-xor': { width: 44, height: 44, shape: 'diamond', color: '#f59e0b', textColor: '#000', label: 'XOR' },
  'gateway-and': { width: 44, height: 44, shape: 'diamond', color: '#06b6d4', textColor: '#000', label: 'AND' }
};

// ===== SVG HELPERS =====
function svgEl(tag, attrs={}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function getNodeCenter(node) {
  const cfg = NODE_CONFIG[node.type];
  return { x: node.x + cfg.width / 2, y: node.y + cfg.height / 2 };
}

function getNodeBorderPoint(node, tx, ty) {
  const cfg = NODE_CONFIG[node.type];
  const cx = node.x + cfg.width / 2;
  const cy = node.y + cfg.height / 2;
  const dx = tx - cx, dy = ty - cy;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / dist, ny = dy / dist;

  if (cfg.shape === 'circle') {
    const r = cfg.width / 2;
    return { x: cx + nx * r, y: cy + ny * r };
  } else if (cfg.shape === 'diamond') {
    const hw = cfg.width / 2, hh = cfg.height / 2;
    // intersect with diamond edges
    let t = Infinity;
    const edges = [
      [0, -hh, hw, 0], [hw, 0, 0, hh],
      [0, hh, -hw, 0], [-hw, 0, 0, -hh]
    ];
    for (const [ex, ey, efx, efy] of edges) {
      const denom = nx * efy - ny * efx;
      if (Math.abs(denom) < 1e-6) continue;
      const tc = ((ex - 0) * efy - (ey - 0) * efx) / denom;
      const sc = ((ex - 0) * ny - (ey - 0) * nx) / denom;
      if (tc >= 0 && sc >= 0 && sc <= 1 && tc < t) t = tc;
    }
    if (!isFinite(t)) t = hw;
    return { x: cx + nx * t, y: cy + ny * t };
  } else {
    // rect
    const hw = cfg.width / 2, hh = cfg.height / 2;
    if (Math.abs(nx) * hh > Math.abs(ny) * hw) {
      const tx2 = cx + Math.sign(nx) * hw;
      return { x: tx2, y: cy + ny * (hw / (Math.abs(nx) || 1)) };
    } else {
      const ty2 = cy + Math.sign(ny) * hh;
      return { x: cx + nx * (hh / (Math.abs(ny) || 1)), y: ty2 };
    }
  }
}

// ===== RENDER NODE =====
function renderNode(node) {
  const cfg = NODE_CONFIG[node.type];
  const g = svgEl('g', { class: 'bpmn-node', id: `node-${node.id}`, transform: `translate(${node.x},${node.y})` });
  g.setAttribute('data-id', node.id);

  let shape;
  if (cfg.shape === 'circle') {
    const r = cfg.width / 2;
    shape = svgEl('circle', {
      cx: r, cy: r, r, fill: cfg.color,
      stroke: 'rgba(255,255,255,0.25)', 'stroke-width': 2,
      class: 'node-shape'
    });
    if (node.type === 'end') {
      shape.setAttribute('stroke', cfg.color);
      shape.setAttribute('stroke-width', 4);
      shape.setAttribute('fill', '#1e1e35');
      // inner filled circle
      const inner = svgEl('circle', { cx: r, cy: r, r: r - 6, fill: cfg.color, class: 'node-shape' });
      g.appendChild(shape);
      g.appendChild(inner);
    } else {
      g.appendChild(shape);
    }
  } else if (cfg.shape === 'diamond') {
    const hw = cfg.width / 2, hh = cfg.height / 2;
    const pts = `${hw},0 ${cfg.width},${hh} ${hw},${cfg.height} 0,${hh}`;
    shape = svgEl('polygon', { points: pts, fill: cfg.color, stroke: 'rgba(255,255,255,0.25)', 'stroke-width': 2, class: 'node-shape' });
    g.appendChild(shape);
    // symbol inside
    const sym = svgEl('text', { x: hw, y: hh + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: cfg.textColor, 'font-size': 16, 'font-weight': 700 });
    sym.textContent = node.type === 'gateway-xor' ? '×' : '+';
    g.appendChild(sym);
  } else {
    shape = svgEl('rect', { width: cfg.width, height: cfg.height, rx: 8, fill: cfg.color, stroke: 'rgba(255,255,255,0.2)', 'stroke-width': 1.5, class: 'node-shape' });
    g.appendChild(shape);
  }

  // Label text
  const labelY = cfg.height + 14;
  const lbl = svgEl('text', {
    x: cfg.width / 2, y: labelY,
    'text-anchor': 'middle', fill: '#c4c4e0', 'font-size': 11, 'font-family': 'Inter, sans-serif', 'font-weight': 500
  });
  lbl.textContent = node.label || cfg.label;
  g.appendChild(lbl);

  if (node.duration && node.type === 'task') {
    const dlbl = svgEl('text', { x: cfg.width / 2, y: cfg.height / 2 + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#fff', 'font-size': 11, 'font-weight': 500, 'font-family': 'Inter, sans-serif' });
    dlbl.textContent = (node.label || 'Task').substring(0, 14);
    g.appendChild(dlbl);
    const dtlbl = svgEl('text', { x: cfg.width / 2, y: cfg.height - 8, 'text-anchor': 'middle', fill: 'rgba(255,255,255,0.6)', 'font-size': 9, 'font-family': 'Inter, sans-serif' });
    dtlbl.textContent = `⏱ ${node.duration}m`;
    g.appendChild(dtlbl);
  } else if (node.type === 'task') {
    const tlbl = svgEl('text', { x: cfg.width / 2, y: cfg.height / 2 + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#fff', 'font-size': 11, 'font-weight': 500, 'font-family': 'Inter, sans-serif' });
    tlbl.textContent = (node.label || 'Task').substring(0, 14);
    g.appendChild(tlbl);
  }

  // Selection indicator + events
  g.addEventListener('mousedown', (e) => onNodeMousedown(e, node.id));
  g.addEventListener('click', (e) => onNodeClick(e, node.id));
  g.addEventListener('contextmenu', (e) => onNodeContextMenu(e, node.id));

  // Tooltip
  g.addEventListener('mouseenter', (e) => showTooltip(e, node));
  g.addEventListener('mousemove', (e) => moveTooltip(e));
  g.addEventListener('mouseleave', () => hideTooltip());

  return g;
}

// ===== RENDER EDGE =====
function renderEdge(edge) {
  const fromNode = state.nodes.find(n => n.id === edge.from);
  const toNode   = state.nodes.find(n => n.id === edge.to);
  if (!fromNode || !toNode) return null;

  const fc = getNodeCenter(fromNode);
  const tc = getNodeCenter(toNode);
  const fp = getNodeBorderPoint(fromNode, tc.x, tc.y);
  const tp = getNodeBorderPoint(toNode, fc.x, fc.y);

  // Quadratic bezier midpoint offset
  const mx = (fp.x + tp.x) / 2;
  const my = (fp.y + tp.y) / 2;
  const dx = tp.x - fp.x, dy = tp.y - fp.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const curveOffset = Math.min(40, len * 0.2);
  const cx = mx - (dy / len) * curveOffset;
  const cy = my + (dx / len) * curveOffset;

  const g = svgEl('g', { class: 'bpmn-edge', id: `edge-${edge.id}` });
  g.setAttribute('data-id', edge.id);

  const path = svgEl('path', {
    d: `M ${fp.x} ${fp.y} Q ${cx} ${cy} ${tp.x} ${tp.y}`,
    fill: 'none', stroke: '#6366f1', 'stroke-width': 2,
    'marker-end': 'url(#arrow)',
    'stroke-dasharray': 'none'
  });
  g.appendChild(path);

  // Hit target
  const hitPath = svgEl('path', {
    d: `M ${fp.x} ${fp.y} Q ${cx} ${cy} ${tp.x} ${tp.y}`,
    fill: 'none', stroke: 'transparent', 'stroke-width': 12
  });
  hitPath.addEventListener('click', (e) => onEdgeClick(e, edge.id));
  g.appendChild(hitPath);

  if (edge.label) {
    const lx = (fp.x + cx + tp.x) / 3;
    const ly = (fp.y + cy + tp.y) / 3 - 6;
    const etxt = svgEl('text', { x: lx, y: ly, 'text-anchor': 'middle', fill: '#a78bfa', 'font-size': 10, 'font-family': 'Inter, sans-serif' });
    etxt.textContent = edge.label;
    g.appendChild(etxt);
  }

  return g;
}

// ===== FULL RE-RENDER =====
function render() {
  nodesLayer.innerHTML = '';
  edgesLayer.innerHTML = '';

  state.edges.forEach(e => {
    const el = renderEdge(e);
    if (el) edgesLayer.appendChild(el);
  });

  state.nodes.forEach(n => {
    nodesLayer.appendChild(renderNode(n));
  });

  applySelection();
  applyHighlight(state.highlightedPath);
}

function applySelection() {
  document.querySelectorAll('.bpmn-node.selected').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.bpmn-edge.selected').forEach(el => el.classList.remove('selected'));
  if (state.selectedNode != null) {
    document.getElementById(`node-${state.selectedNode}`)?.classList.add('selected');
  }
  if (state.selectedEdge != null) {
    document.getElementById(`edge-${state.selectedEdge}`)?.classList.add('selected');
  }
}

// ===== NODE INTERACTIONS =====
function onNodeMousedown(e, id) {
  if (state.connectMode) return;
  if (e.button === 2) return; // ignore right click for dragging
  e.stopPropagation();
  hideTooltip();
  hideContextMenu();
  const node = state.nodes.find(n => n.id === id);
  if (!node) return;
  const svgRect = canvas.getBoundingClientRect();
  state.draggingNode = id;
  state.dragOffset = { x: e.clientX - svgRect.left - node.x, y: e.clientY - svgRect.top - node.y };
}

function onNodeClick(e, id) {
  if (state.connectMode) {
    e.stopPropagation();
    if (state.connectFrom == null) {
      state.connectFrom = id;
      document.getElementById(`node-${id}`)?.classList.add('selected');
      document.getElementById('canvas-hint').textContent = 'Bây giờ click node đích...';
    } else if (state.connectFrom !== id) {
      pendingEdgeFrom = state.connectFrom;
      pendingEdgeTo = id;
      showEdgeModal();
      state.connectFrom = null;
      document.getElementById('canvas-hint').textContent = 'Đã kết nối. Click node nguồn để nối tiếp.';
    } else {
      state.connectFrom = null;
      document.querySelectorAll('.bpmn-node.selected').forEach(x => x.classList.remove('selected'));
    }
    return;
  }
  state.selectedNode = id;
  state.selectedEdge = null;
  applySelection();
  showPropsPanel(id);
}

// ===== CONTEXT MENU =====
const ctxMenu = document.getElementById('context-menu');

function onNodeContextMenu(e, id) {
  e.preventDefault();
  e.stopPropagation();
  if (state.connectMode) return;
  
  hideTooltip();
  
  // Select node immediately
  state.selectedNode = id;
  state.selectedEdge = null;
  applySelection();
  
  // Display menu at mouse position
  ctxMenu.style.display = 'block';
  ctxMenu.style.left = e.clientX + 'px';
  ctxMenu.style.top = e.clientY + 'px';
}

function hideContextMenu() {
  ctxMenu.style.display = 'none';
}

document.getElementById('ctx-edit').addEventListener('click', () => {
  hideContextMenu();
  if (state.selectedNode != null) showPropsPanel(state.selectedNode);
});

document.getElementById('ctx-delete').addEventListener('click', () => {
  hideContextMenu();
  if (state.selectedNode != null) deleteNode(state.selectedNode);
});

function onEdgeClick(e, id) {
  e.stopPropagation();
  hideContextMenu();
  state.selectedEdge = id;
  state.selectedNode = null;
  applySelection();
  hidePropsPanel();
}

canvas.addEventListener('click', (e) => {
  hideContextMenu();
  if (!state.connectMode) {
    state.selectedNode = null;
    state.selectedEdge = null;
    applySelection();
    hidePropsPanel();
  }
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  hideContextMenu();
  hidePropsPanel();
  state.selectedNode = null;
  state.selectedEdge = null;
  applySelection();
});

canvas.addEventListener('mousemove', (e) => {
  if (state.draggingNode == null) return;
  const svgRect = canvas.getBoundingClientRect();
  const x = e.clientX - svgRect.left - state.dragOffset.x;
  const y = e.clientY - svgRect.top - state.dragOffset.y;
  const node = state.nodes.find(n => n.id === state.draggingNode);
  if (!node) return;
  hideTooltip();
  node.x = Math.max(0, x);
  node.y = Math.max(0, y);

  // Move node incrementally (fast path)
  const gEl = document.getElementById(`node-${node.id}`);
  if (gEl) gEl.setAttribute('transform', `translate(${node.x},${node.y})`);

  // Redraw edges only
  edgesLayer.innerHTML = '';
  state.edges.forEach(e => {
    const el = renderEdge(e);
    if (el) edgesLayer.appendChild(el);
  });
});

canvas.addEventListener('mouseup', () => { state.draggingNode = null; });
canvas.addEventListener('mouseleave', () => { state.draggingNode = null; });

// ===== DRAG FROM TOOLBOX =====
document.querySelectorAll('.tool-item').forEach(item => {
  item.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('type', item.dataset.type);
  });
});

canvas.addEventListener('dragover', e => e.preventDefault());
canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  const type = e.dataTransfer.getData('type');
  if (!type) return;
  const svgRect = canvas.getBoundingClientRect();
  const x = e.clientX - svgRect.left - (NODE_CONFIG[type].width / 2);
  const y = e.clientY - svgRect.top - (NODE_CONFIG[type].height / 2);
  addNode(type, Math.max(0, x), Math.max(0, y));
});

function addNode(type, x, y) {
  const cfg = NODE_CONFIG[type];
  const id = state.nextId++;
  const label = cfg.label + ' ' + state.nodes.filter(n => n.type === type).length;
  state.nodes.push({ id, type, x, y, label, duration: type === 'task' ? 5 : 0, personnel: '', cost: type === 'task' ? 10 : 0, material: '' });
  render();
  updateStats();
  updateHint();
}

// ===== PROPS PANEL =====
function showPropsPanel(id) {
  const node = state.nodes.find(n => n.id === id);
  if (!node) return;
  document.getElementById('props-panel').style.display = 'block';
  document.getElementById('prop-name').value = node.label || '';
  
  const isTask = node.type === 'task';
  document.getElementById('prop-tasks-only').style.display = isTask ? 'grid' : 'none';
  if (isTask) {
    document.getElementById('prop-duration').value = node.duration || 0;
    document.getElementById('prop-personnel').value = node.personnel || '';
    document.getElementById('prop-cost').value = node.cost || 0;
    document.getElementById('prop-material').value = node.material || '';
  }
}
function hidePropsPanel() {
  document.getElementById('props-panel').style.display = 'none';
}

document.getElementById('btn-apply-props').addEventListener('click', () => {
  if (state.selectedNode == null) return;
  const node = state.nodes.find(n => n.id === state.selectedNode);
  if (!node) return;
  node.label = document.getElementById('prop-name').value || node.label;
  if (node.type === 'task') {
    node.duration = parseFloat(document.getElementById('prop-duration').value) || 0;
    node.personnel = document.getElementById('prop-personnel').value;
    node.cost = parseFloat(document.getElementById('prop-cost').value) || 0;
    node.material = document.getElementById('prop-material').value;
  }
  render();
});

document.getElementById('btn-delete-node').addEventListener('click', () => {
  if (state.selectedNode == null) return;
  deleteNode(state.selectedNode);
});

function deleteNode(id) {
  state.nodes = state.nodes.filter(n => n.id !== id);
  state.edges = state.edges.filter(e => e.from !== id && e.to !== id);
  state.selectedNode = null;
  hidePropsPanel();
  render();
  updateStats();
  updateHint();
}

// ===== KEYBOARD DELETE =====
document.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (document.activeElement.tagName === 'INPUT') return;
    if (state.selectedNode != null) deleteNode(state.selectedNode);
    else if (state.selectedEdge != null) {
      state.edges = state.edges.filter(eg => eg.id !== state.selectedEdge);
      state.selectedEdge = null;
      render();
    }
  }
});

// ===== EDGE MODAL =====
let pendingEdgeFrom = null, pendingEdgeTo = null;

function showEdgeModal() {
  document.getElementById('edge-label-input').value = '';
  document.getElementById('edge-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('edge-label-input').focus(), 50);
}

document.getElementById('edge-modal-ok').addEventListener('click', () => {
  const lbl = document.getElementById('edge-label-input').value.trim();
  if (pendingEdgeFrom != null && pendingEdgeTo != null) {
    // Avoid duplicate edges
    const exists = state.edges.some(e => e.from === pendingEdgeFrom && e.to === pendingEdgeTo);
    if (!exists) {
      state.edges.push({ id: state.nextId++, from: pendingEdgeFrom, to: pendingEdgeTo, label: lbl });
      render();
    }
  }
  document.getElementById('edge-modal').style.display = 'none';
  pendingEdgeFrom = pendingEdgeTo = null;
});

document.getElementById('edge-modal-cancel').addEventListener('click', () => {
  document.getElementById('edge-modal').style.display = 'none';
  pendingEdgeFrom = pendingEdgeTo = null;
});

// ===== CONNECT MODE =====
document.getElementById('btn-connect-mode').addEventListener('click', () => {
  state.connectMode = !state.connectMode;
  state.connectFrom = null;
  const btn = document.getElementById('btn-connect-mode');
  btn.classList.toggle('active', state.connectMode);
  document.getElementById('canvas-hint').textContent = state.connectMode
    ? 'Chế độ nối: Click node nguồn...'
    : 'Kéo phần tử từ sidebar vào đây để bắt đầu';
  if (!state.connectMode) applySelection();
});

// ===== RESET =====
document.getElementById('btn-reset').addEventListener('click', () => {
  if (!confirm('Xoá toàn bộ canvas?')) return;
  state.nodes = [];
  state.edges = [];
  state.selectedNode = null;
  state.selectedEdge = null;
  state.nextId = 1;
  state.scenarios = [];
  state.highlightedPath = -1;
  render();
  updateStats();
  renderPaths([]);
  updateHint();
  document.getElementById('cycle-section').style.display = 'none';
  document.getElementById('canvas-hint').textContent = 'Kéo phần tử từ sidebar vào đây để bắt đầu';
});

// ===== TOOLTIP =====
const tooltip = document.getElementById('node-tooltip');

function showTooltip(e, node) {
  if (state.draggingNode != null || state.connectMode) return;
  
  const typeMap = {
    'start': { label: 'Start Event', bg: 'rgba(34,197,94,0.15)', col: '#4ade80' },
    'end': { label: 'End Event', bg: 'rgba(239,68,68,0.15)', col: '#f87171' },
    'task': { label: 'Task', bg: 'rgba(99,102,241,0.15)', col: '#818cf8' },
    'gateway-xor': { label: 'Gateway XOR', bg: 'rgba(245,158,11,0.15)', col: '#fbbf24' },
    'gateway-and': { label: 'Gateway AND', bg: 'rgba(6,182,212,0.15)', col: '#22d3ee' }
  };
  
  const info = typeMap[node.type];
  const badge = document.getElementById('tt-type');
  badge.textContent = info.label;
  badge.style.background = info.bg;
  badge.style.color = info.col;
  
  document.getElementById('tt-name').textContent = node.label || 'Chưa đặt tên';
  
  const body = document.getElementById('tt-details');
  if (node.type === 'task') {
    body.style.display = 'flex';
    document.getElementById('tt-dur').textContent = (node.duration || 0) + ' phút';
    
    document.getElementById('tt-pers').textContent = node.personnel ? node.personnel : 'Không';
    document.getElementById('tt-pers').title = node.personnel || '';
    
    const fmt = (v) => new Intl.NumberFormat('en-US').format(v);
    document.getElementById('tt-cost').textContent = '$' + fmt(node.cost || 0);
    
    document.getElementById('tt-mat').textContent = node.material ? node.material : 'Không';
    document.getElementById('tt-mat').title = node.material || '';
  } else {
    body.style.display = 'none';
  }
  
  tooltip.style.display = 'block';
  moveTooltip(e);
}

function moveTooltip(e) {
  tooltip.style.left = e.clientX + 'px';
  tooltip.style.top = e.clientY + 'px';
}

function hideTooltip() {
  tooltip.style.display = 'none';
}

// ===== HINT =====
function updateHint() {
  if (state.nodes.length === 0) {
    document.getElementById('canvas-hint').textContent = 'Kéo phần tử từ sidebar vào đây để bắt đầu';
  } else if (!state.connectMode) {
    document.getElementById('canvas-hint').textContent = `${state.nodes.length} node | ${state.edges.length} cạnh — Bật Chế độ nối để kết nối`;
  }
}

// ===== STATS =====
function updateStats() {
  const tasks    = state.nodes.filter(n => n.type === 'task').length;
  const gateways = state.nodes.filter(n => n.type.startsWith('gateway')).length;
  const events   = state.nodes.filter(n => n.type === 'start' || n.type === 'end').length;

  document.getElementById('count-tasks').textContent    = tasks;
  document.getElementById('count-gateways').textContent = gateways;
  document.getElementById('count-events').textContent   = events;

  const pSet = new Set(), mSet = new Set();
  let totCost = 0;
  state.nodes.filter(n => n.type === 'task').forEach(n => {
    totCost += (n.cost || 0);
    if (n.personnel) n.personnel.split(',').map(s=>s.trim()).filter(Boolean).forEach(p => pSet.add(p));
    if (n.material) n.material.split(',').map(s=>s.trim()).filter(Boolean).forEach(m => mSet.add(m));
  });
  
  const fmt = (v) => new Intl.NumberFormat('en-US').format(v);
  document.getElementById('total-personnel').textContent = fmt(pSet.size);
  document.getElementById('total-cost').textContent = '$' + fmt(totCost);
  document.getElementById('total-material').textContent = fmt(mSet.size);

  drawBarChart(tasks, gateways, events);
  drawPieChart(tasks, gateways, events);
}

// ===== BAR CHART =====
function drawBarChart(tasks, gateways, events) {
  const canvas2 = document.getElementById('chart-bar');
  const ctx = canvas2.getContext('2d');
  const W = canvas2.width, H = canvas2.height;
  ctx.clearRect(0, 0, W, H);

  const data = [
    { label: 'Tasks',    value: tasks,    color: '#6366f1' },
    { label: 'Gateways', value: gateways, color: '#f59e0b' },
    { label: 'Events',   value: events,   color: '#22d3ee' }
  ];
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barW = 48, gap = 24, padX = 20, padY = 10;
  const chartH = H - 36 - padY * 2;

  // Grid lines
  const gridCount = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= gridCount; i++) {
    const gy = padY + (chartH / gridCount) * i;
    ctx.beginPath(); ctx.moveTo(padX, gy); ctx.lineTo(W - padX, gy); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxVal - (maxVal / gridCount) * i), padX - 3, gy + 3);
  }

  data.forEach((d, i) => {
    const bh = (d.value / maxVal) * chartH;
    const bx = padX + i * (barW + gap);
    const by = padY + chartH - bh;

    // Glow
    ctx.shadowColor = d.color;
    ctx.shadowBlur = 8;
    // Bar with gradient
    const grad = ctx.createLinearGradient(bx, by, bx, by + bh);
    grad.addColorStop(0, d.color);
    grad.addColorStop(1, d.color + '44');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(bx, by, barW, bh, [4, 4, 0, 0]);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Value on top
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.value, bx + barW / 2, by - 4);

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px Inter, sans-serif';
    ctx.fillText(d.label, bx + barW / 2, H - padY);
  });
}

// ===== PIE CHART =====
function drawPieChart(tasks, gateways, events) {
  const canvas2 = document.getElementById('chart-pie');
  const ctx = canvas2.getContext('2d');
  const W = canvas2.width, H = canvas2.height;
  ctx.clearRect(0, 0, W, H);

  const data = [
    { label: 'Tasks',    value: tasks,    color: '#6366f1' },
    { label: 'Gateways', value: gateways, color: '#f59e0b' },
    { label: 'Events',   value: events,   color: '#22d3ee' }
  ].filter(d => d.value > 0);

  if (data.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath(); ctx.arc(W/2, H/2, 60, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '12px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('Chưa có dữ liệu', W/2, H/2+4);
    document.getElementById('pie-legend').innerHTML = '';
    return;
  }

  const total = data.reduce((s, d) => s + d.value, 0);
  let angle = -Math.PI / 2;
  const cx = W / 2, cy = H / 2, r = 68, innerR = 36;

  data.forEach(d => {
    const slice = (d.value / total) * Math.PI * 2;
    ctx.shadowColor = d.color; ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = d.color;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Percentage label
    const midAngle = angle + slice / 2;
    const lx = cx + Math.cos(midAngle) * (r * 0.65);
    const ly = cy + Math.sin(midAngle) * (r * 0.65);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(d.value / total * 100) + '%', lx, ly + 4);

    angle += slice;
  });

  // Donut hole
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fillStyle = '#1e1e35';
  ctx.fill();

  // Legend
  const legendEl = document.getElementById('pie-legend');
  legendEl.innerHTML = data.map(d =>
    `<div class="pie-legend-item">
      <div class="pie-legend-dot" style="background:${d.color}"></div>
      <span>${d.label}: <strong>${d.value}</strong></span>
    </div>`
  ).join('');
}

// ===== DFS: FIND ALL PATHS =====
function findAllPaths() {
  const starts = state.nodes.filter(n => n.type === 'start');
  const ends   = state.nodes.filter(n => n.type === 'end');
  if (starts.length === 0 || ends.length === 0) return [];

  const endIds = new Set(ends.map(n => n.id));
  const adj = {};
  state.nodes.forEach(n => adj[n.id] = []);
  state.edges.forEach(e => { if (adj[e.from]) adj[e.from].push(e.to); });

  const allPaths = [];
  const MAX_PATHS = 200; // prevent infinite loops in cyclic graphs

  function dfs(current, visited, path) {
    if (allPaths.length >= MAX_PATHS) return;
    if (endIds.has(current)) {
      allPaths.push([...path]);
      return;
    }
    for (const next of (adj[current] || [])) {
      if (!visited.has(next)) {
        visited.add(next);
        path.push(next);
        dfs(next, visited, path);
        path.pop();
        visited.delete(next);
      }
    }
  }

  starts.forEach(s => {
    dfs(s.id, new Set([s.id]), [s.id]);
  });

  return allPaths;
}

// Deprecated calcPathMetrics - now handled inline during scenario grouping

// ===== CYCLE TIME BAR =====
function drawCycleTimeChart(cycleTimes) {
  const canvas2 = document.getElementById('chart-ct');
  const ctx = canvas2.getContext('2d');
  const W = canvas2.width, H = canvas2.height;
  ctx.clearRect(0, 0, W, H);

  if (cycleTimes.length === 0) return;
  const maxVal = Math.max(...cycleTimes, 1);
  const barW = Math.min(28, (W - 30) / cycleTimes.length - 4);
  const gap = Math.max(2, (W - 30 - cycleTimes.length * barW) / (cycleTimes.length + 1));
  const padY = 8;
  const chartH = H - 28;

  cycleTimes.forEach((ct, i) => {
    const bh = (ct / maxVal) * chartH;
    const bx = 15 + gap + i * (barW + gap);
    const by = padY + chartH - bh;

    const hue = 220 + (i / cycleTimes.length) * 120;
    const col = `hsl(${hue},80%,60%)`;
    ctx.shadowColor = col; ctx.shadowBlur = 6;
    const grad = ctx.createLinearGradient(bx, by, bx, by + bh);
    grad.addColorStop(0, col);
    grad.addColorStop(1, col + '44');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.roundRect(bx, by, barW, bh, [3,3,0,0]); ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '9px Inter';
    ctx.textAlign = 'center';
    ctx.fillText(`P${i + 1}`, bx + barW / 2, H - 4);
  });
}

// ===== RENDER PATHS LIST =====
function renderPaths(scenarios) {
  const listEl = document.getElementById('paths-list');
  const emptyEl = document.getElementById('paths-empty');

  if (scenarios.length === 0) {
    emptyEl.style.display = 'flex';
    listEl.innerHTML = '';
    return;
  }
  emptyEl.style.display = 'none';
  listEl.innerHTML = '';

  scenarios.forEach((scenario, i) => {
    const metrics = scenario.metrics;
    const fmt = (v) => new Intl.NumberFormat('en-US').format(v);
    const item = document.createElement('div');
    item.className = 'path-item';
    item.style.animationDelay = `${i * 0.04}s`;

    const badgesHtml = scenario.criticalPath.map((id, idx) => {
      const node = state.nodes.find(n => n.id === id);
      if (!node) return '';
      let cls = 'badge-task';
      if (node.type === 'start') cls = 'badge-start';
      else if (node.type === 'end') cls = 'badge-end';
      else if (node.type.startsWith('gateway')) cls = 'badge-gateway';
      const arrow = idx < scenario.criticalPath.length - 1 ? '<span class="path-arrow">→</span>' : '';
      const shortLabel = (node.label || node.type).substring(0, 10);
      return `<span class="path-node-badge ${cls}">${shortLabel}</span>${arrow}`;
    }).join('');

    const parallelCount = scenario.nodeIds.length - scenario.criticalPath.length;
    const parallelHtml = parallelCount > 0 ? `<div style="margin-top:4px"><span class="path-node-badge" style="background:rgba(255,255,255,0.06); color:#a1a1aa;">+ ${parallelCount} phần tử nhánh song song</span></div>` : '';

    item.innerHTML = `
      <div class="path-header">
        <span class="path-index">🚀 Kịch bản ${i + 1}</span>
      </div>
      <div class="path-nodes">${badgesHtml}</div>
      ${parallelHtml}
      <div class="path-metrics">
        <span class="path-metric metric-time" title="Cycle Time">⏱ ${metrics.duration}m</span>
        <span class="path-metric metric-pers" title="Personnel">👥 ${metrics.personnel}</span>
        <span class="path-metric metric-cost" title="Cost">💲${fmt(metrics.cost)}</span>
        <span class="path-metric metric-mat" title="Material">🧱 ${metrics.material}</span>
      </div>
    `;

    item.addEventListener('click', () => {
      document.querySelectorAll('.path-item.active-path').forEach(el => el.classList.remove('active-path'));
      item.classList.add('active-path');
      state.highlightedPath = i;
      applyHighlight(i);
    });

    listEl.appendChild(item);
  });
}

// ===== HIGHLIGHT PATH =====
function applyHighlight(scenarioIdx) {
  document.querySelectorAll('.bpmn-node.highlighted').forEach(el => el.classList.remove('highlighted'));
  document.querySelectorAll('.bpmn-edge.highlighted').forEach(el => el.classList.remove('highlighted'));

  if (scenarioIdx < 0 || scenarioIdx >= state.scenarios.length) return;

  const scenario = state.scenarios[scenarioIdx];

  scenario.nodeIds.forEach(id => {
    document.getElementById(`node-${id}`)?.classList.add('highlighted');
  });

  scenario.edgeIds.forEach(id => {
    const el = document.getElementById(`edge-${id}`);
    if (el) {
      el.classList.add('highlighted');
      el.querySelector('path')?.setAttribute('marker-end', 'url(#arrow-highlight)');
      el.querySelector('path')?.setAttribute('stroke-dasharray', '10 4');
    }
  });
}

// ===== ANALYZE BUTTON =====
document.getElementById('btn-analyze').addEventListener('click', () => {
  updateStats();
  const allPaths = findAllPaths();
  
  // Group DFS paths into Execution Scenarios by XOR branch choices
  const scenariosMap = {};
  allPaths.forEach(path => {
    const xorDecisions = [];
    for (let i = 0; i < path.length - 1; i++) {
      const n = state.nodes.find(x => x.id === path[i]);
      if (n && n.type === 'gateway-xor') {
        const outEdges = state.edges.filter(e => e.from === path[i]);
        if (outEdges.length > 1) {
          xorDecisions.push(`${path[i]}->${path[i+1]}`);
        }
      }
    }
    const sig = xorDecisions.join('|');
    if (!scenariosMap[sig]) scenariosMap[sig] = [];
    scenariosMap[sig].push(path);
  });
  
  state.scenarios = Object.values(scenariosMap).map((paths, idx) => {
    const nodeIds = new Set();
    const edgeIds = new Set();
    let maxDuration = 0;
    let criticalPath = paths[0];
    
    paths.forEach(p => {
      let pDur = 0;
      for (let i = 0; i < p.length; i++) {
        nodeIds.add(p[i]);
        const n = state.nodes.find(x => x.id === p[i]);
        if (n && n.type === 'task') pDur += (n.duration || 0);
        if (i < p.length - 1) {
          const e = state.edges.find(x => x.from === p[i] && x.to === p[i+1]);
          if (e) edgeIds.add(e.id);
        }
      }
      if (pDur > maxDuration) { maxDuration = pDur; criticalPath = p; }
    });
    
    let cost = 0;
    const pSet = new Set(), mSet = new Set();
    nodeIds.forEach(id => {
      const n = state.nodes.find(x => x.id === id);
      if (n && n.type === 'task') {
        cost += (n.cost || 0);
        if (n.personnel) n.personnel.split(',').map(s=>s.trim()).filter(Boolean).forEach(x => pSet.add(x));
        if (n.material) n.material.split(',').map(s=>s.trim()).filter(Boolean).forEach(x => mSet.add(x));
      }
    });

    return {
      id: idx,
      paths: paths,
      criticalPath: criticalPath,
      nodeIds: Array.from(nodeIds),
      edgeIds: Array.from(edgeIds),
      metrics: {
        duration: maxDuration,
        cost: cost,
        personnel: pSet.size,
        material: mSet.size
      }
    };
  });

  state.highlightedPath = -1;

  // Reset all highlights
  document.querySelectorAll('.bpmn-edge.highlighted path').forEach(p => {
    p.setAttribute('marker-end', 'url(#arrow)');
    p.setAttribute('stroke-dasharray', 'none');
  });
  document.querySelectorAll('.bpmn-node.highlighted').forEach(el => el.classList.remove('highlighted'));
  document.querySelectorAll('.bpmn-edge.highlighted').forEach(el => el.classList.remove('highlighted'));

  renderPaths(state.scenarios);

  // Switch to paths tab
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('[data-tab="paths"]').classList.add('active');
  document.getElementById('tab-paths').classList.add('active');
  
  renderResources();

  // Cycle time
  if (state.scenarios.length > 0) {
    const cycleTimes = state.scenarios.map(s => s.metrics.duration);
    const min = Math.min(...cycleTimes);
    const max = Math.max(...cycleTimes);
    const avg = cycleTimes.reduce((s, v) => s + v, 0) / cycleTimes.length;

    document.getElementById('ct-min').textContent = `${min}m`;
    document.getElementById('ct-max').textContent = `${max}m`;
    document.getElementById('ct-avg').textContent = `${avg.toFixed(1)}m`;
    document.getElementById('cycle-section').style.display = 'block';
    drawCycleTimeChart(cycleTimes);
  } else {
    document.getElementById('cycle-section').style.display = 'none';
  }
});

// ===== RENDER RESOURCES =====
function renderResources() {
  const tasks = state.nodes.filter(n => n.type === 'task');
  const persMap = {}, matMap = {};
  
  tasks.forEach(task => {
    const pList = task.personnel ? task.personnel.split(',').map(s=>s.trim()).filter(Boolean) : [];
    pList.forEach(p => {
      if (!persMap[p]) persMap[p] = [];
      persMap[p].push(task);
    });
    
    const mList = task.material ? task.material.split(',').map(s=>s.trim()).filter(Boolean) : [];
    mList.forEach(m => {
      if (!matMap[m]) matMap[m] = [];
      matMap[m].push(task);
    });
  });
  
  const pKeys = Object.keys(persMap).sort();
  const mKeys = Object.keys(matMap).sort();
  
  const resEmpty = document.getElementById('res-empty');
  const resContent = document.getElementById('res-content');
  
  if (pKeys.length === 0 && mKeys.length === 0) {
    resEmpty.style.display = 'flex';
    resContent.style.display = 'none';
    return;
  }
  
  resEmpty.style.display = 'none';
  resContent.style.display = 'block';
  
  document.getElementById('res-personnel-list').innerHTML = pKeys.map(k => `
    <div class="res-card">
      <div class="res-header"><span>👥 ${k}</span> <span class="res-count">${persMap[k].length} node</span></div>
      <div class="res-nodes">${persMap[k].map(n => `<span class="res-node-badge">${n.label || 'Task'}</span>`).join('')}</div>
    </div>
  `).join('');
  
  document.getElementById('res-material-list').innerHTML = mKeys.map(k => `
    <div class="res-card">
      <div class="res-header"><span>🧱 ${k}</span> <span class="res-count">${matMap[k].length} node</span></div>
      <div class="res-nodes">${matMap[k].map(n => `<span class="res-node-badge">${n.label || 'Task'}</span>`).join('')}</div>
    </div>
  `).join('');
}

// ===== TAB SWITCHING =====
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ===== LOAD SAMPLE =====
document.getElementById('btn-load-sample').addEventListener('click', loadSample);

function loadSample() {
  state.nodes = [];
  state.edges = [];
  state.nextId = 1;
  state.allPaths = [];
  state.highlightedPath = -1;

  // Create sample process: Order Handling
  const addN = (type, x, y, label, duration=0, personnel='', cost=0, material='') => {
    const id = state.nextId++;
    state.nodes.push({ id, type, x, y, label, duration, personnel, cost, material });
    return id;
  };
  const addE = (from, to, label='') => {
    state.edges.push({ id: state.nextId++, from, to, label });
  };

  const s   = addN('start',       60,  220, 'Bắt đầu');
  const t1  = addN('task',       160,  200, 'Nhận đơn hàng', 10, 'Nam, Hùng', 50, '');
  const g1  = addN('gateway-xor',330,  215, 'Kiểm tra tồn kho');
  const t2  = addN('task',       450,  140, 'Xử lý đơn hàng', 20, 'Hoa, Nam', 120, 'Máy in, Giấy');
  const t3  = addN('task',       450,  300, 'Đặt hàng bổ sung', 30, 'Ly', 300, '');
  const g2  = addN('gateway-xor',620,  215, 'Gộp lại');
  const g3  = addN('gateway-and',760,  215, 'Song song');
  const t4  = addN('task',       880,  140, 'Đóng gói', 15, 'Tuấn, Hoa', 80, 'Thùng carton, Băng keo');
  const t5  = addN('task',       880,  300, 'Lập hoá đơn', 10, 'Kế toán', 20, 'Máy in');
  const g4  = addN('gateway-and',1020, 215, 'Đồng bộ');
  const t6  = addN('task',       1140, 200, 'Giao hàng', 25, 'Shipper', 150, 'Xe tải');
  const e   = addN('end',        1300, 215, 'Kết thúc');

  addE(s, t1); addE(t1, g1);
  addE(g1, t2, 'Còn hàng'); addE(g1, t3, 'Hết hàng');
  addE(t2, g2); addE(t3, g2);
  addE(g2, g3); addE(g3, t4); addE(g3, t5);
  addE(t4, g4); addE(t5, g4);
  addE(g4, t6); addE(t6, e);

  render();
  updateStats();
  renderPaths([]);
  document.getElementById('cycle-section').style.display = 'none';
  updateHint();
}

// ===== INIT =====
updateStats();
updateHint();
