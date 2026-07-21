(function () {
  "use strict";

  const sectorNames = new Set([
    "POLITICAL", "ECONOMIC", "SOCIAL", "TECHNOLOGICAL", "ENVIRONMENTAL", "CULTURAL"
  ]);
  let timer = null;

  function numberAttribute(element, name) {
    return Number(element.getAttribute(name) || 0);
  }

  function ensureStyles() {
    if (document.getElementById("aih-radar-visual-styles")) return;
    const style = document.createElement("style");
    style.id = "aih-radar-visual-styles";
    style.textContent = `
      [data-testid="signal-radar"] .aih-radar-sector-label{
        font-size:11px!important;
        font-weight:750!important;
        letter-spacing:.055em!important;
        paint-order:stroke fill;
        stroke:hsl(var(--card));
        stroke-width:7px;
        stroke-linejoin:round;
      }
      [data-testid^="radar-dot-"]>text{
        paint-order:stroke fill;
        stroke:hsl(var(--card));
        stroke-width:4px!important;
        font-size:8.5px!important;
      }
      [data-testid^="radar-dot-"]:hover>text{font-weight:750!important;}
    `;
    document.head.appendChild(style);
  }

  function mainCircle(dot) {
    return Array.from(dot.children).find(function (child) {
      return child.tagName && child.tagName.toLowerCase() === "circle" && !child.classList.contains("sr-collab-group-ring");
    });
  }

  function moveSectorLabels(svg, center, outerRadius) {
    Array.from(svg.querySelectorAll(":scope > text")).forEach(function (label) {
      const name = String(label.textContent || "").trim().toUpperCase();
      if (!sectorNames.has(name)) return;
      const oldX = numberAttribute(label, "x");
      const oldY = numberAttribute(label, "y");
      const angle = Math.atan2(oldY - center, oldX - center);
      const labelRadius = outerRadius + 34;
      label.setAttribute("x", String(center + labelRadius * Math.cos(angle)));
      label.setAttribute("y", String(center + labelRadius * Math.sin(angle)));
      label.classList.add("aih-radar-sector-label");
    });
  }

  function separateDots(svg, center, outerRadius) {
    const points = Array.from(svg.querySelectorAll('[data-testid^="radar-dot-"]')).map(function (dot) {
      const circle = mainCircle(dot);
      if (!circle) return null;
      const x = numberAttribute(circle, "cx");
      const y = numberAttribute(circle, "cy");
      return { dot: dot, id: dot.getAttribute("data-testid") || "", ox: x, oy: y, x: x, y: y };
    }).filter(Boolean);

    const minimumDistance = 28;
    const minRadius = 79;
    const maxRadius = outerRadius - 9;
    const maxDisplacement = 28;

    for (let iteration = 0; iteration < 120; iteration += 1) {
      let collisions = 0;
      for (let i = 0; i < points.length; i += 1) {
        for (let j = i + 1; j < points.length; j += 1) {
          const a = points[i];
          const b = points[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let distance = Math.hypot(dx, dy);
          if (distance >= minimumDistance) continue;
          if (distance < 0.001) {
            const seed = (a.id + b.id).split("").reduce(function (sum, char) { return sum + char.charCodeAt(0); }, 0);
            const angle = (seed % 360) * Math.PI / 180;
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            distance = 1;
          }
          const push = (minimumDistance - distance) * 0.52;
          const ux = dx / distance;
          const uy = dy / distance;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
          collisions += 1;
        }
      }

      points.forEach(function (point) {
        // A light spring keeps every signal recognisably in its original
        // PESTEC sector and response ring.
        point.x += (point.ox - point.x) * 0.018;
        point.y += (point.oy - point.y) * 0.018;

        let dx = point.x - point.ox;
        let dy = point.y - point.oy;
        const displacement = Math.hypot(dx, dy);
        if (displacement > maxDisplacement) {
          point.x = point.ox + dx / displacement * maxDisplacement;
          point.y = point.oy + dy / displacement * maxDisplacement;
        }

        dx = point.x - center;
        dy = point.y - center;
        const radius = Math.hypot(dx, dy) || 1;
        if (radius < minRadius) {
          point.x = center + dx / radius * minRadius;
          point.y = center + dy / radius * minRadius;
        } else if (radius > maxRadius) {
          point.x = center + dx / radius * maxRadius;
          point.y = center + dy / radius * maxRadius;
        }
      });
      if (!collisions) break;
    }

    points.forEach(function (point) {
      const dx = point.x - point.ox;
      const dy = point.y - point.oy;
      point.dot.setAttribute("transform", "translate(" + dx.toFixed(2) + " " + dy.toFixed(2) + ")");
    });
  }

  function improveRadar() {
    const svg = document.querySelector('[data-testid="signal-radar"]');
    if (!svg) return;
    ensureStyles();
    const viewBox = svg.viewBox && svg.viewBox.baseVal;
    const center = viewBox && viewBox.width ? viewBox.x + viewBox.width / 2 : 430;
    const directCircles = Array.from(svg.children).filter(function (child) {
      return child.tagName && child.tagName.toLowerCase() === "circle";
    });
    const outerRadius = directCircles.reduce(function (largest, circle) {
      return Math.max(largest, numberAttribute(circle, "r"));
    }, 360);
    moveSectorLabels(svg, center, outerRadius);
    separateDots(svg, center, outerRadius);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(improveRadar, 70);
  }

  window.addEventListener("hashchange", schedule);
  window.addEventListener("resize", schedule);
  document.addEventListener("DOMContentLoaded", schedule);
  new MutationObserver(function () {
    if ((window.location.hash || "").includes("/radar")) schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState !== "loading") schedule();
})();
