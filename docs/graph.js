const SUBJECTS = ["AOA", "DBMS", "COA", "DSGT"];
const LOW_CONFIDENCE_THRESHOLD = 30;
const HIGH_CONFIDENCE_THRESHOLD = 70;

let currentSubject = "AOA";
let subjectData = {};

async function loadSubjectData(short) {
  if (subjectData[short]) {
    return subjectData[short];
  }
  try {
    const response = await fetch(`data/${short}.json?t=${Date.now()}`);
    if (!response.ok) {
      throw new Error(`Failed to load ${short}.json: ${response.status}`);
    }
    const data = await response.json();
    subjectData[short] = data;
    return data;
  } catch (err) {
    console.error(`Error loading ${short}:`, err);
    return { subject: short, short, nodes: [] };
  }
}

function confidenceClass(confidence) {
  if (confidence < LOW_CONFIDENCE_THRESHOLD) return "node-circle--weak";
  if (confidence < HIGH_CONFIDENCE_THRESHOLD) return "node-circle--mid";
  return "node-circle--strong";
}

function nodeRadius(node) {
  // Size scales with how many times it's been reviewed, so practiced
  // topics visibly grow -- capped so the graph doesn't get unwieldy.
  const base = 18;
  const growth = Math.min(node.times_reviewed || 0, 10) * 1.8;
  return base + growth;
}

function buildGraphElements(data) {
  const nodes = data.nodes.map(n => ({ ...n }));
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  const confirmedLinks = [];
  const recommendedLinks = [];

  nodes.forEach(node => {
    (node.connections || []).forEach(conn => {
      if (nodeById.has(conn.to)) {
        confirmedLinks.push({ source: node.id, target: conn.to, relation: conn.relation });
      }
    });
    (node.recommended_connections || []).forEach(rec => {
      if (nodeById.has(rec.to)) {
        recommendedLinks.push({ source: node.id, target: rec.to, reason: rec.reason });
      }
    });
  });

  return { nodes, confirmedLinks, recommendedLinks };
}

function renderGraph(data) {
  const svg = d3.select("#graph-svg");
  svg.selectAll("*").remove();

  const emptyState = document.getElementById("empty-state");

  if (!data.nodes || data.nodes.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  const container = document.querySelector(".graph-area");
  const width = container.clientWidth;
  const height = container.clientHeight;

  const { nodes, confirmedLinks, recommendedLinks } = buildGraphElements(data);

  const simulation = d3.forceSimulation(nodes)
    .force("charge", d3.forceManyBody().strength(-220))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide(d => nodeRadius(d) + 12))
    .force("link", d3.forceLink([...confirmedLinks, ...recommendedLinks])
      .id(d => d.id)
      .distance(110)
      .strength(0.3));

  const recommendedGroup = svg.append("g").attr("class", "recommended-links");
  const confirmedGroup = svg.append("g").attr("class", "confirmed-links");
  const nodeGroup = svg.append("g").attr("class", "nodes");

  const recLines = recommendedGroup.selectAll("line")
    .data(recommendedLinks)
    .join("line")
    .attr("class", "edge-recommended");

  const confLines = confirmedGroup.selectAll("line")
    .data(confirmedLinks)
    .join("line")
    .attr("class", "edge-confirmed");

  const nodeSel = nodeGroup.selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", "node-group")
    .style("cursor", "pointer")
    .on("click", (event, d) => showNodeDetail(d, data.nodes));

  nodeSel.append("circle")
    .attr("class", d => {
      let cls = `node-circle ${confidenceClass(d.confidence)}`;
      if (d.confidence < LOW_CONFIDENCE_THRESHOLD) cls += " node-circle--pulse";
      return cls;
    })
    .attr("r", d => nodeRadius(d));

  nodeSel.append("text")
    .attr("class", "node-label")
    .attr("dy", d => nodeRadius(d) + 16)
    .text(d => d.name.length > 18 ? d.name.slice(0, 16) + "…" : d.name)
    .each(function () {
      // Insert a background rect behind each label for legibility,
      // sized to the actual rendered text width.
      const bbox = this.getBBox();
      d3.select(this.parentNode)
        .insert("rect", "text")
        .attr("class", "node-label-bg")
        .attr("x", bbox.x - 4)
        .attr("y", bbox.y - 2)
        .attr("width", bbox.width + 8)
        .attr("height", bbox.height + 4)
        .attr("rx", 3);
    });

  simulation.on("tick", () => {
    recLines
      .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    confLines
      .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    nodeSel.attr("transform", d => `translate(${d.x},${d.y})`);
  });

  // Keep nodes within the visible viewport as the simulation settles.
  // Reserves extra space below each node for its label, and margin
  // above so nodes don't crowd the tab bar.
  simulation.force("bound", () => {
    nodes.forEach(d => {
      const r = nodeRadius(d);
      const labelSpace = 30;
      d.x = Math.max(r + 10, Math.min(width - r - 10, d.x));
      d.y = Math.max(r + 20, Math.min(height - r - labelSpace, d.y));
    });
  });
}

function showNodeDetail(node, allNodes) {
  const detail = document.getElementById("node-detail");
  const nameEl = document.getElementById("detail-name");
  const confidenceEl = document.getElementById("detail-confidence");
  const definitionEl = document.getElementById("detail-definition");
  const connectionsEl = document.getElementById("detail-connections");

  nameEl.textContent = node.name;
  confidenceEl.textContent = `Confidence: ${node.confidence}/100 · Reviewed ${node.times_reviewed} time${node.times_reviewed === 1 ? "" : "s"}`;
  definitionEl.textContent = node.definition || "(no definition written yet)";

  const nodeById = new Map(allNodes.map(n => [n.id, n]));
  let connectionsHtml = "";

  (node.connections || []).forEach(conn => {
    const targetName = nodeById.get(conn.to)?.name || conn.to;
    connectionsHtml += `<div class="connection-item"><span class="connection-arrow">&rarr;</span><strong>${escapeHtml(targetName)}</strong>: ${escapeHtml(conn.relation)}</div>`;
  });

  (node.recommended_connections || []).forEach(rec => {
    const targetName = nodeById.get(rec.to)?.name || rec.to;
    connectionsHtml += `<div class="connection-item connection-item--recommended"><span class="connection-arrow">?</span>Try linking to <strong>${escapeHtml(targetName)}</strong>: ${escapeHtml(rec.reason)}</div>`;
  });

  if (!connectionsHtml) {
    connectionsHtml = `<div class="connection-item connection-item--recommended">No connections yet.</div>`;
  }

  connectionsEl.innerHTML = connectionsHtml;
  detail.hidden = false;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function switchSubject(short) {
  currentSubject = short;
  document.querySelectorAll(".tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.subject === short);
  });
  document.getElementById("node-detail").hidden = true;

  const data = await loadSubjectData(short);
  renderGraph(data);
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => switchSubject(tab.dataset.subject));
  });
}

function setupDetailClose() {
  document.getElementById("detail-close").addEventListener("click", () => {
    document.getElementById("node-detail").hidden = true;
  });
}

function updateLastUpdatedLabel() {
  const label = document.getElementById("last-updated");
  label.textContent = `Updated ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

async function init() {
  setupTabs();
  setupDetailClose();
  updateLastUpdatedLabel();
  document.querySelector(`.tab[data-subject="${currentSubject}"]`).classList.add("active");
  await switchSubject(currentSubject);
}

init();
