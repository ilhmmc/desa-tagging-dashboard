import React, { useMemo, useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Upload, Download, SortAsc, SortDesc, Filter } from "lucide-react";

// Canvas choropleth + dots map with zoom, pan and labels
const CanvasChoroplethMap = ({
  points,
  geojson,
  onFetchGeoJSON,
  geoLoading,
}) => {
  const wrapperRef = useRef(null);
  const canvasRef = useRef(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const [showLabels, setShowLabels] = useState(true);
  const minZoom = 0.5,
    maxZoom = 8;
  const panRef = useRef({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const lastPointerRef = useRef(null);

  // Calculate bounds from geojson and points
  const bounds = useMemo(() => {
    let minLat = Infinity,
      maxLat = -Infinity,
      minLon = Infinity,
      maxLon = -Infinity;
    const extend = (lat, lon) => {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    };
    if (geojson && geojson.features) {
      for (const f of geojson.features) {
        const coords = f.geometry && f.geometry.coordinates;
        const iter = (arr) => {
          if (!arr) return;
          if (typeof arr[0] === "number") {
            // [lon, lat]
            extend(arr[1], arr[0]);
          } else {
            for (const a of arr) iter(a);
          }
        };
        iter(coords);
      }
    }
    for (const p of points || []) extend(p.lat, p.lon);
    if (!isFinite(minLat)) {
      minLat = -7.8;
      maxLat = -7.2;
      minLon = 111.6;
      maxLon = 112.2;
    }
    if (minLat === maxLat) {
      minLat -= 0.05;
      maxLat += 0.05;
    }
    if (minLon === maxLon) {
      minLon -= 0.05;
      maxLon += 0.05;
    }
    return { minLat, maxLat, minLon, maxLon };
  }, [geojson, points]);

  // compute centroids for labels
  const centroids = useMemo(() => {
    if (!geojson || !geojson.features) return [];
    const res = [];
    for (const f of geojson.features) {
      const props = f.properties || {};
      const name =
        props.name ||
        props.NAME ||
        props.nama ||
        props.KAB ||
        props.kecamatan ||
        props.kec ||
        props.NAME_2 ||
        "";
      let coords = [];
      if (!f.geometry) {
        res.push({ lon: 0, lat: 0, name });
        continue;
      }
      if (f.geometry.type === "Polygon") coords = f.geometry.coordinates[0];
      else if (f.geometry.type === "MultiPolygon")
        coords =
          (f.geometry.coordinates[0] && f.geometry.coordinates[0][0]) || [];
      if (!coords || coords.length === 0) {
        res.push({ lon: 0, lat: 0, name });
        continue;
      }
      let sumX = 0,
        sumY = 0,
        cnt = 0;
      for (const c of coords) {
        sumX += c[0];
        sumY += c[1];
        cnt++;
      }
      const lon = sumX / cnt;
      const lat = sumY / cnt;
      res.push({ lon, lat, name });
    }
    return res;
  }, [geojson]);

  // Resize observer
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;
    const ro = new ResizeObserver(() => {
      const rect = wrapper.getBoundingClientRect();
      sizeRef.current = { w: rect.width, h: rect.height };
      canvas.width = Math.floor(rect.width * window.devicePixelRatio);
      canvas.height = Math.floor(rect.height * window.devicePixelRatio);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      draw();
    });
    ro.observe(wrapper);

    // pointer handlers for pan
    const onPointerDown = (e) => {
      draggingRef.current = true;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      wrapper.setPointerCapture && wrapper.setPointerCapture(e.pointerId);
      wrapper.style.cursor = "grabbing";
    };
    const onPointerMove = (e) => {
      if (!draggingRef.current) return;
      const last = lastPointerRef.current;
      if (!last) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      panRef.current.x += dx;
      panRef.current.y += dy;
      draw();
    };
    const onPointerUp = (e) => {
      draggingRef.current = false;
      lastPointerRef.current = null;
      wrapper.releasePointerCapture &&
        wrapper.releasePointerCapture(e.pointerId);
      wrapper.style.cursor = "default";
    };

    const onWheel = (e) => {
      e.preventDefault();
      const rect = wrapper.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const oldZ = zoomRef.current || zoom;
      const newZoom = Math.max(
        minZoom,
        Math.min(maxZoom, +(oldZ * factor).toFixed(3))
      );
      // adjust pan to keep focus at mouse position
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      panRef.current.x =
        panRef.current.x - (mouseX - cx) * (newZoom / oldZ - 1);
      panRef.current.y =
        panRef.current.y - (mouseY - cy) * (newZoom / oldZ - 1);
      zoomRef.current = newZoom;
      setZoom(newZoom);
      draw();
    };

    wrapper.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    wrapper.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      ro.disconnect();
      wrapper.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      wrapper.removeEventListener("wheel", onWheel);
    };
  }, [geojson, points, zoom, showLabels]);

  const project = (lat, lon, w, h) => {
    const pad = 12;
    const { minLat, maxLat, minLon, maxLon } = bounds;
    const x =
      pad + ((lon - minLon) / (maxLon - minLon)) * Math.max(1, w - pad * 2);
    const y =
      pad + ((maxLat - lat) / (maxLat - minLat)) * Math.max(1, h - pad * 2);
    // apply zoom about canvas center
    const cx = w / 2;
    const cy = h / 2;
    const z = zoomRef.current || zoom;
    const zx = cx + (x - cx) * z + (panRef.current.x || 0);
    const zy = cy + (y - cy) * z + (panRef.current.y || 0);
    return [zx, zy];
  };

  // Ray-casting algorithm for point-in-polygon
  const pointInRing = (x, y, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0],
        yi = ring[i][1];
      const xj = ring[j][0],
        yj = ring[j][1];
      const intersect =
        yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const pointInPolygon = (lon, lat, polygon) => {
    if (!polygon || polygon.length === 0) return false;
    if (pointInRing(lon, lat, polygon[0])) {
      for (let i = 1; i < polygon.length; i++) {
        if (pointInRing(lon, lat, polygon[i])) return false;
      }
      return true;
    }
    return false;
  };

  const computeCounts = (geojson, pts) => {
    const counts = new Array(geojson?.features?.length || 0).fill(0);
    if (!geojson || !geojson.features || !pts) return counts;
    for (const p of pts) {
      for (let i = 0; i < geojson.features.length; i++) {
        const f = geojson.features[i];
        if (!f.geometry) continue;
        const geom = f.geometry;
        if (geom.type === "Polygon") {
          if (pointInPolygon(p.lon, p.lat, geom.coordinates)) {
            counts[i]++;
            break;
          }
        } else if (geom.type === "MultiPolygon") {
          for (const poly of geom.coordinates) {
            if (pointInPolygon(p.lon, p.lat, poly)) {
              counts[i]++;
              break;
            }
          }
        }
      }
    }
    return counts;
  };

  const colorFor = (value, max) => {
    if (max === 0) return "#F3F4F6";
    const t = Math.min(1, value / max);
    const r1 = 254,
      g1 = 243,
      b1 = 199;
    const r2 = 220,
      g2 = 38,
      b2 = 38;
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `rgb(${r},${g},${b})`;
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // draw choropleth polygons first
    const counts = computeCounts(geojson, points);
    const maxCount = counts.length ? Math.max(...counts) : 0;

    if (geojson && geojson.features) {
      for (let i = 0; i < geojson.features.length; i++) {
        const f = geojson.features[i];
        const geom = f.geometry;
        const fill = colorFor(counts[i], maxCount);
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.beginPath();
        const drawRing = (ring) => {
          for (let j = 0; j < ring.length; j++) {
            const [lon, lat] = ring[j];
            const [x, y] = project(lat, lon, w / dpr, h / dpr);
            if (j === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        };
        if (geom.type === "Polygon") {
          for (let r = 0; r < geom.coordinates.length; r++)
            drawRing(geom.coordinates[r]);
        } else if (geom.type === "MultiPolygon") {
          for (const poly of geom.coordinates) {
            for (let r = 0; r < poly.length; r++) drawRing(poly[r]);
          }
        }
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.globalAlpha = 0.8;
        ctx.fill();
        ctx.strokeStyle = "#9CA3AF";
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
    }

    // draw points
    ctx.save();
    ctx.scale(dpr, dpr);
    const radius = 2.2;
    for (const p of points || []) {
      const [x, y] = project(p.lat, p.lon, w / dpr, h / dpr);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(17,24,39,0.85)";
      ctx.fill();
    }
    ctx.restore();

    // labels
    if (showLabels && centroids && centroids.length) {
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.font = "12px sans-serif";
      ctx.fillStyle = "#111827";
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 3;
      for (const c of centroids) {
        if (!c.name) continue;
        const [x, y] = project(c.lat, c.lon, w / dpr, h / dpr);
        // only draw labels that are within canvas bounds
        if (x < 0 || y < 0 || x > w / dpr || y > h / dpr) continue;
        ctx.strokeText(c.name, x + 4, y);
        ctx.fillText(c.name, x + 4, y);
      }
      ctx.restore();
    }

    // legend
    ctx.save();
    ctx.scale(dpr, dpr);
    const legendX = 12,
      legendY = 12;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(legendX - 8, legendY - 8, 140, 90);
    ctx.fillStyle = "#111827";
    ctx.font = "12px sans-serif";
    ctx.fillText("Choropleth (per kecamatan)", legendX, legendY + 8);
    const steps = 5;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const val = Math.round(maxCount * t);
      const col = colorFor(val, maxCount);
      ctx.fillStyle = col;
      const boxY = legendY + 18 + s * 14;
      ctx.fillRect(legendX, boxY, 14, 10);
      ctx.fillStyle = "#111827";
      ctx.fillText(val.toString(), legendX + 20, boxY + 9);
    }
    ctx.restore();
  };

  useEffect(() => {
    draw();
  }, [geojson, points, bounds, zoom, showLabels]);

  const zoomIn = () =>
    setZoom((z) => {
      const nz = Math.min(maxZoom, +(z * 1.3).toFixed(2));
      zoomRef.current = nz;
      return nz;
    });
  const zoomOut = () =>
    setZoom((z) => {
      const nz = Math.max(minZoom, +(z / 1.3).toFixed(2));
      zoomRef.current = nz;
      return nz;
    });
  const resetZoom = () => {
    zoomRef.current = 1;
    setZoom(1);
  };

  return (
    <div
      ref={wrapperRef}
      style={{ height: 450, width: "100%" }}
      className="relative bg-white"
    >
      <canvas ref={canvasRef} />

      <div className="absolute flex flex-col items-end space-y-2 top-3 right-3">
        <div className="flex space-x-2">
          <button
            onClick={zoomIn}
            className="px-2 py-1 text-sm bg-white border rounded shadow"
          >
            +
          </button>
          <button
            onClick={zoomOut}
            className="px-2 py-1 text-sm bg-white border rounded shadow"
          >
            −
          </button>
          <button
            onClick={resetZoom}
            className="px-2 py-1 text-sm bg-white border rounded shadow"
          >
            Reset
          </button>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={() => setShowLabels((s) => !s)}
            className="px-2 py-1 text-sm bg-white border rounded shadow"
          >
            {showLabels ? "Hide Labels" : "Show Labels"}
          </button>
          <button
            onClick={onFetchGeoJSON}
            disabled={geoLoading}
            className="px-3 py-1 text-sm bg-white border rounded shadow"
          >
            {geoLoading
              ? "Memuat..."
              : geojson
              ? "Segarkan Batas"
              : "Muat Batas Kecamatan"}
          </button>
        </div>
        <div className="px-2 py-1 text-xs text-gray-600 bg-white border rounded shadow">
          Zoom: {zoom}×
        </div>
      </div>
    </div>
  );
};

// Fetch GeoJSON: try known raw GitHub/jsDelivr URLs first, then Overpass, then fallback bbox
const fetchKecamatanGeoJSON = async () => {
  const candidateUrls = [
    "https://raw.githubusercontent.com/superpikar/indonesia-geojson/master/kabupaten/jawa-timur/nganjuk.geojson",
    "https://raw.githubusercontent.com/thetrisatria/geojson-indonesia/master/regencies/nganjuk.geojson",
    "https://raw.githubusercontent.com/ans-4175/peta-indonesia-geojson/master/kabupaten/35/3518.geojson",
    "https://cdn.jsdelivr.net/gh/superpikar/indonesia-geojson@master/kabupaten/jawa-timur/nganjuk.geojson",
  ];

  const fetchWithTimeout = async (url, timeout = 12000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        console.warn('fetchWithTimeout non-ok status', url, res.status);
        return null;
      }
      const data = await res.json();
      return data;
    } catch (err) {
      clearTimeout(timer);
      // Log and return null instead of throwing so callers can continue gracefully
      console.warn('fetchWithTimeout failed for', url, err && err.message ? err.message : err);
      return null;
    }
  };

  // Try candidate static URLs first
  for (const url of candidateUrls) {
    try {
      const gj = await fetchWithTimeout(url);
      if (gj && (gj.type === "FeatureCollection" || gj.features)) {
        return gj;
      }
    } catch (err) {
      // ignore and try next
    }
  }

  // If static URLs fail, try Overpass endpoints (assemble GeoJSON from relation)
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
  ];
  const query = `
  [out:json][timeout:25];
  area["name"="Kabupaten Nganjuk"]["boundary"="administrative"]->.searchArea;
  relation["admin_level"="6"](area.searchArea);
  out body;
  >;
  out geom;`;

  const tryFetchOverpass = async (baseUrl) => {
    const full = baseUrl + "?data=" + encodeURIComponent(query);
    return await fetchWithTimeout(full, 20000);
  };

  let overpassData = null;
  for (const ep of endpoints) {
    try {
      const d = await tryFetchOverpass(ep);
      if (d) {
        overpassData = d;
        break;
      }
    } catch (err) {
      // try next
    }
  }

  if (overpassData) {
    const elements = overpassData.elements || [];
    const ways = {};
    const relations = [];
    for (const el of elements) {
      if (el.type === "way" && el.geometry) {
        ways[el.id] = el.geometry.map((pt) => [pt.lon, pt.lat]);
      } else if (el.type === "relation") {
        relations.push(el);
      }
    }

    const features = [];
    for (const rel of relations) {
      const polygons = [];
      const members = rel.members || [];
      const outerRings = [];
      for (const m of members) {
        if (m.type === "way" && (m.role === "outer" || m.role === "")) {
          const w = ways[m.ref];
          if (w) outerRings.push(w);
        }
      }
      if (outerRings.length === 0) continue;
      for (const ring of outerRings) {
        if (ring.length > 0) {
          const first = ring[0];
          const last = ring[ring.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
        }
        polygons.push([ring]);
      }
      const feature = {
        type: "Feature",
        properties: rel.tags || {},
        geometry: {
          type: polygons.length > 1 ? "MultiPolygon" : "Polygon",
          coordinates: polygons.length > 1 ? polygons : polygons[0],
        },
      };
      features.push(feature);
    }

    if (features.length > 0) return { type: "FeatureCollection", features };
  }

  // As a last resort return an approximate bbox polygon for Kabupaten Nganjuk
  const minLat = -7.8,
    maxLat = -7.2,
    minLon = 111.6,
    maxLon = 112.2;
  const coords = [
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
    [minLon, minLat],
  ];
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "Kabupaten Nganjuk (approx bbox fallback)" },
        geometry: { type: "Polygon", coordinates: [coords] },
      },
    ],
  };
};

const DesaTaggingDashboard = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [points, setPoints] = useState([]);
  const [sortOrder, setSortOrder] = useState("desc"); // 'asc' or 'desc'
  const [filterText, setFilterText] = useState("");
  const [originalData, setOriginalData] = useState([]);
  const [geojson, setGeojson] = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [masterDesaList, setMasterDesaList] = useState([]);
  const [desaToKecMap, setDesaToKecMap] = useState({});
  const [daftarDesaMap, setDaftarDesaMap] = useState({});
  const [muatanByNames, setMuatanByNames] = useState({}); // key: normKec+"|||"+normDesa -> muatan number
  const [muatanByDesa, setMuatanByDesa] = useState({});  // key: normDesa -> muatan number (fallback)
  const [mapExpanded, setMapExpanded] = useState(false);
  const [rawRows, setRawRows] = useState([]);

  const isRowKabupatenNganjuk = (row) => {
    if (!row || typeof row !== "object") return false;
    const getVal = (obj, candidates) => {
      const keys = Object.keys(obj || {});
      const lower = keys.reduce((acc, k) => {
        acc[k.toLowerCase()] = k;
        return acc;
      }, {});
      for (const c of candidates) {
        const k = lower[c.toLowerCase()];
        if (k) return obj[k];
      }
      return undefined;
    };
    const kabCandidates = [
      "kabupaten",
      "kabupaten/kota",
      "kab/kota",
      "kab kota",
      "kabupaten kota",
      "kabkota",
      "nama kabupaten",
      "kab",
      "kabupaten_kota",
    ];
    // Only consider explicit Kabupaten column — require it to be present
    const kabVal = getVal(row, kabCandidates);
    if (kabVal == null || kabVal === "") return false;
    const s = String(kabVal ?? "");
    // Check explicit bracketed code or the code number
    if (/\[?\s*3518\s*\]?/.test(s)) return true;
    // Check text NGANJUK appearing in the kabupaten column
    if (s.toUpperCase().includes("NGANJUK")) return true;
    return false;
  };

  // Normalize desa name for matching keys: remove leading codes like [020] or numeric prefixes, trim, remove punctuation and common words, lowercase
  const normalizeDesaName = (val) => {
    if (!val && val !== 0) return "";
    let s = val.toString().trim();
    // Remove bracketed codes like [020] or [ 020 ] at start
    s = s.replace(/^\s*\[\s*\d+\s*\]\s*/g, "");
    // Remove unbracketed numeric prefixes like 020, 020. or 020 -
    s = s.replace(/^\s*\d{1,6}[\.\-)\s]+/g, "");
    // remove common administrative words that may vary in source
    s = s.replace(/\b(desa|kelurahan|kampung|dusun|ds|ds\.|kel)\b/gi, " ");
    // remove diacritics and punctuation, keep only alphanumerics and spaces
    try {
      s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    } catch (e) {
      /* ignore if normalize not available */
    }
    s = s.replace(/[^0-9a-zA-Z\s]/g, " ");
    // Collapse multiple spaces and to lower for stable matching
    s = s.replace(/\s+/g, " ").trim().toLowerCase();
    return s;
  };
  const [chartExpanded, setChartExpanded] = useState(false);

  const normalizeGeneralName = (val) => {
    if (!val && val !== 0) return "";
    let s = val.toString().trim();
    try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch(e) {}
    s = s.replace(/[^0-9a-zA-Z\s]/g, " ");
    s = s.replace(/\s+/g, " ").trim().toLowerCase();
    return s;
  };

  const buildMuatanIndexes = (map) => {
    const byNames = {};
    const byDesa = {};
    if (!map || typeof map !== 'object') return { byNames, byDesa };
    const toNum = (v) => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const cleaned = v.replace(/,/g, '.').replace(/[^0-9+\-.]/g, '');
        const n = parseFloat(cleaned);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    };
    for (const rec of Object.values(map)) {
      const desaName = (rec.nama_desa || rec.desa || rec.DESA || rec['Nama Desa'] || rec.nama || '').toString().trim();
      const kecName = (rec.nama_kecamatan || rec.kecamatan || rec.kec || rec.kecamatan_name || rec.kecamatan_nama || '').toString().trim();
      const muatan = toNum(rec.jumlah_muatan_usaha_wilkerstat);
      if (desaName) {
        const dKey = normalizeDesaName(desaName);
        if (muatan != null) byDesa[dKey] = muatan;
        if (kecName) {
          const kKey = normalizeGeneralName(kecName);
          const nameKey = `${kKey}|||${dKey}`;
          if (muatan != null) byNames[nameKey] = muatan;
        }
      }
    }
    return { byNames, byDesa };
  };

  // Auto-load default GeoJSON and Excel from public/ if available; fallback to remote fetch for geojson
  useEffect(() => {
    let cancelled = false;
    const tryLoadGeoJSONPublic = async () => {
      const publicCandidates = [
        "/nganjuk.gejson",
        "/nganjuk.geojson",
        "/nganjuk.json",
      ];
      for (const path of publicCandidates) {
        try {
          const res = await fetch(path);
          if (!res.ok) continue;
          const gj = await res.json();
          return gj;
        } catch (e) {
          // ignore
        }
      }
      return null;
    };

    const tryLoadDaftarDesa = async () => {
      try {
        const path = "/daftar-desa.xlsx";
        const res = await fetch(path);
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        const workbook = XLSX.read(buf, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet);
        const map = {};
        for (const r of json) {
          const keys = Object.keys(r || {});
          let idVal = null;
          for (const k of keys) {
            const v = String(r[k] ?? "").trim();
            if (/^\d{10}$/.test(v)) {
              idVal = v;
              break;
            }
            if (/^id_desa$/i.test(k) && /^\d+$/.test(v)) {
              idVal = v.padStart(10, "0");
              break;
            }
          }
          if (!idVal) continue;
          map[idVal] = r;
        }
        return map;
      } catch (e) {
        return null;
      }
    };

    const tryLoadExcelPublic = async (daftarMap = null) => {
      const path = "/hasil-tagging-kdm-nganjuk.csv";
      try {
        const res = await fetch(path);
        if (!res.ok) return null;
        const text = await res.text();
        const workbook = XLSX.read(text, { type: "string" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        const rows = (jsonData || []).filter(isRowKabupatenNganjuk);
        try {
          if (rows && rows.length) setRawRows(rows);
        } catch (e) {}
        // Build desa -> kecamatan mapping using object keys (case-insensitive), avoid picking email columns
        const desaKecMap = {};
        if (rows && rows.length) {
          const desaCandidates = [
            "desa",
            "nama desa",
            "nama_desa",
            "nm_desa",
            "name",
            "nama",
            "nama desa (desa/kel)",
          ];
          const kecCandidates = [
            "kecamatan",
            "nama kecamatan",
            "kec",
            "nm_kecamatan",
            "nama_kec",
            "nama kec",
            "kecamatan/desa",
          ];
          const findKey = (obj, candidates) => {
            const keys = Object.keys(obj || {});
            const lowerMap = keys.reduce((acc, k) => {
              acc[k.toLowerCase()] = k;
              return acc;
            }, {});
            for (const cand of candidates) {
              const k = lowerMap[cand.toLowerCase()];
              if (k) return k;
            }
            return null;
          };
          const looksLikeKecamatan = (v) => {
            if (v == null) return false;
            const s = String(v).trim();
            if (!s) return false;
            if (s.includes("@")) return false;
            return /[A-Za-z]/.test(s);
          };
          for (const row of rows) {
            // helper to extract 10-digit id from row values (e.g. [3518] [023] [004] -> 3518023004 -> 10 digits)
            const extractIdFromRow = (r) => {
              try {
                const keys = Object.keys(r || {});
                const lower = keys.reduce((acc, k) => {
                  acc[k.toLowerCase()] = k;
                  return acc;
                }, {});
                const candKab =
                  lower["kabupaten"] ||
                  lower["kab"] ||
                  lower["kabupaten/kota"] ||
                  lower["kabupaten_kota"] ||
                  null;
                const candKec = lower["kecamatan"] || lower["kec"] || null;
                const candDesa =
                  lower["desa"] ||
                  lower["nama desa"] ||
                  lower["nama_desa"] ||
                  lower["nm_desa"] ||
                  lower["name"] ||
                  null;
                const getBracketDigits = (v) => {
                  if (v == null) return null;
                  const s = String(v);
                  const m = s.match(/\[(\d+)\]/);
                  return m ? m[1] : null;
                };
                let kab = candKab
                  ? getBracketDigits(r[candKab])
                  : getBracketDigits(r["Kabupaten"]) ||
                    getBracketDigits(r["KABUPATEN"]);
                let kec = candKec
                  ? getBracketDigits(r[candKec])
                  : getBracketDigits(r["Kecamatan"]) ||
                    getBracketDigits(r["KECAMATAN"]);
                let desa = candDesa
                  ? getBracketDigits(r[candDesa])
                  : getBracketDigits(r["Desa"]) || getBracketDigits(r["DESA"]);
                // fallback: search any value for bracketed codes and try to find sequence kab(4) kec(3) desa(3)
                if (!kab || !kec || !desa) {
                  const allVals = keys.map((k) => String(r[k] ?? ""));
                  const bracketDigits = [];
                  for (const v of allVals) {
                    const ms = v.match(/\[(\d+)\]/g);
                    if (ms) {
                      for (const item of ms) {
                        const d = item.replace(/[^0-9]/g, "");
                        bracketDigits.push(d);
                      }
                    }
                  }
                  for (let i = 0; i < bracketDigits.length; i++) {
                    const a = bracketDigits[i] || "";
                    const b = bracketDigits[i + 1] || "";
                    const c = bracketDigits[i + 2] || "";
                    if (a.length === 4 && b.length === 3 && c.length === 3) {
                      kab = kab || a;
                      kec = kec || b;
                      desa = desa || c;
                      break;
                    }
                  }
                }
                if (kab && kec && desa) {
                  kab = kab.padStart(4, "0").slice(-4);
                  kec = kec.padStart(3, "0").slice(-3);
                  desa = desa.padStart(3, "0").slice(-3);
                  return `${kab}${kec}${desa}`;
                }
              } catch (e) {}
              return null;
            };

            const id10 = extractIdFromRow(row);
            if (id10 && daftarMap && daftarMap[id10]) {
              const rec = daftarMap[id10];
              const desaNameRaw =
                rec.nama_desa ||
                rec.nama ||
                rec.DESA ||
                rec["Nama Desa"] ||
                rec.desa ||
                "";
              const kecRaw =
                rec.nama_kecamatan ||
                rec.kecamatan ||
                rec.kec ||
                rec.kecamatan_name ||
                rec.kecamatan_nama ||
                "";
              const desaName = desaNameRaw ? String(desaNameRaw).trim() : "";
              const kec = kecRaw != null ? String(kecRaw).trim() : "";
              if (!desaName) continue;
              const key = normalizeDesaName(desaName);
              if (kec && looksLikeKecamatan(kec)) desaKecMap[key] = kec;
              continue;
            }

            const desaKey = findKey(row, desaCandidates);
            const kecKey = findKey(row, kecCandidates);
            const desaNameRaw = desaKey
              ? row[desaKey]
              : row["Nama Desa"] ||
                row["DESA"] ||
                row["Desa"] ||
                row["desa"] ||
                row["nama_desa"] ||
                row["nama"] ||
                row["NAMA"];
            const kecRaw = kecKey
              ? row[kecKey]
              : row["Kecamatan"] ||
                row["KECAMATAN"] ||
                row["kecamatan"] ||
                row["Nama Kecamatan"] ||
                row["nama kecamatan"] ||
                row["Kec"] ||
                row["kec"];
            const desaName = desaNameRaw ? String(desaNameRaw).trim() : "";
            const kec = kecRaw != null ? String(kecRaw).trim() : "";
            if (!desaName) continue;
            const key = normalizeDesaName(desaName);
            if (kec && looksLikeKecamatan(kec)) desaKecMap[key] = kec;
          }
        }
        // debug: log detected desa/kecamatan mapping sample
        try {
          console.debug(
            "tryLoadExcelPublic: detected desa->kecamatan count=",
            Object.keys(desaKecMap).length
          );
          console.debug(
            "tryLoadExcelPublic: sample mapping=",
            Object.entries(desaKecMap).slice(0, 10)
          );
        } catch (e) {
          /* ignore */
        }
        return { jsonData, desaKecMap };
      } catch (e) {
        return null;
      }
    };

    (async () => {
      try {
        setLoading(true);
        // GeoJSON: try public first
        const localGJ = await tryLoadGeoJSONPublic();
        if (!cancelled && localGJ) {
          setGeojson(localGJ);
        } else {
          // fallback to remote/autofetch function
          try {
            setGeoLoading(true);
            const gj = await fetchKecamatanGeoJSON();
            if (!cancelled) setGeojson(gj);
          } catch (err) {
            console.warn("Auto GeoJSON fetch failed", err);
          } finally {
            if (!cancelled) setGeoLoading(false);
          }
        }

        // Load authoritative daftar-desa mapping if present
        const daftarMap = await tryLoadDaftarDesa();
        if (daftarMap && Object.keys(daftarMap).length) {
          setDaftarDesaMap(daftarMap);
          try {
            const idx = buildMuatanIndexes(daftarMap);
            setMuatanByNames(idx.byNames);
            setMuatanByDesa(idx.byDesa);
          } catch(e) {}
        }

        // Excel: try public
        const excelRes = await tryLoadExcelPublic(daftarMap);
        const jsonData =
          excelRes && excelRes.jsonData ? excelRes.jsonData : null;
        const publicDesaKecMap =
          excelRes && excelRes.desaKecMap ? excelRes.desaKecMap : {};
        const rows = (jsonData || []).filter(isRowKabupatenNganjuk);
        try {
          if (rows && rows.length) setRawRows(rows);
        } catch (e) {}
        if (!cancelled && rows && rows.length) {
          // Build master desa list from Excel if possible
          try {
            const names = new Set();
            for (const row of rows) {
              const name = (
                row.Desa ||
                row.desa ||
                row.nama_desa ||
                row.nama ||
                row.NAMA ||
                row.nm_desa ||
                row.name ||
                row["Nama Desa"]
              )
                ?.toString()
                .trim();
              if (name) names.add(name);
            }
            if (names.size) setMasterDesaList(Array.from(names).sort());
          } catch (e) {
            /* ignore */
          }

          // if public excel provided desa->kecamatan map, store it
          if (publicDesaKecMap && Object.keys(publicDesaKecMap).length) {
            setDesaToKecMap(publicDesaKecMap);
          }

          // Diagnostic: check specific desa names reported missing and log matching rows & mapping
          try {
            const reported = [
              "[006] GODEAN",
              "[006] CANGKRINGAN",
              "[010] SUMBERWINDU",
              "[016] JEDONGCANGKRING",
              "[004] KALIANYAR",
              "[001] SALAMROJO",
              "[004] BENDOLO",
              "[010] PULOWETAN",
              "[013] TRAYANG",
              "[003] TEMPURAN",
              "[004] JEGREG",
              "[004] KWEDEN",
              "[006] BAJANG",
              "[013] CANDI MULYO",
              "[014] DANDANGAN",
              "[002] SEDENGAN MIJEN",
              "[003] KATRUNGAN",
              "[010] JATIKALANG",
              "[014] TANGGUL",
              "[016] PAGERNGUMBUK",
              "[002] BANGSONGAN",
              "[003] TAMANAN",
              "[008] BRANGKAL",
              "[008] MOJOROTO",
              "[011] LARANGAN TOKOL",
              "[011] WONOAYU",
              "[016] POCANAN",
              "[023] CANDINEGORO",
            ];
            const normReported = reported.map((r) => normalizeDesaName(r));
            const foundRows = [];
            for (const row of rows || []) {
              const rawName = (
                row.Desa ||
                row.desa ||
                row.nama_desa ||
                row.nama ||
                row.NAMA ||
                row.nm_desa ||
                row.name ||
                row["Nama Desa"]
              )
                ?.toString()
                .trim();
              if (!rawName) continue;
              const nk = normalizeDesaName(rawName);
              if (normReported.includes(nk)) {
                foundRows.push({ rawName, normalized: nk, row });
              }
            }
            console.debug(
              "Diagnostics: number of reported desa to inspect=",
              reported.length,
              "found in excel rows=",
              foundRows.length
            );
            console.debug(
              "Diagnostics: sample foundRows=",
              foundRows.slice(0, 50)
            );
            // also log whether publicDesaKecMap has mapping for those keys
            const mappingChecks = normReported.map((k) => ({
              key: k,
              publicMapValue: publicDesaKecMap[k],
            }));
            console.debug(
              "Diagnostics: publicDesaKecMap presence for reported desa=",
              mappingChecks
            );
          } catch (e) {
            console.error("Diagnostics logging failed", e);
          }

          // reuse same processing code as handleFileUpload to fill points and counts
          const desaCount = {};
          const newPoints = [];
          const latCandidates = [
            "lat",
            "latitude",
            "lintang",
            "y",
            "koordinat_lat",
            "latitude (y)",
          ];
          const lonCandidates = [
            "lon",
            "lng",
            "longitude",
            "bujur",
            "x",
            "koordinat_lon",
            "longitude (x)",
          ];
          const combinedCoordCandidates = [
            "koordinat",
            "coordinate",
            "coord",
            "coordinates",
          ];
          const findKey = (obj, candidates) => {
            const keys = Object.keys(obj);
            const lowerMap = keys.reduce((acc, k) => {
              acc[k.toLowerCase()] = k;
              return acc;
            }, {});
            for (const cand of candidates) {
              const k = lowerMap[cand.toLowerCase()];
              if (k) return k;
            }
            return null;
          };
          rows.forEach((row, idx) => {
            const desa = (
              row.Desa ||
              row.desa ||
              row.nama_desa ||
              row.nama ||
              row.NAMA ||
              row.nm_desa
            )
              ?.toString()
              .trim();
            if (desa && desa !== "")
              desaCount[desa] = (desaCount[desa] || 0) + 1;
            let latKey = findKey(row, latCandidates);
            let lonKey = findKey(row, lonCandidates);
            let latVal = latKey ? row[latKey] : undefined;
            let lonVal = lonKey ? row[lonKey] : undefined;
            if (latVal == null || lonVal == null) {
              const comboKey = findKey(row, combinedCoordCandidates);
              if (comboKey && typeof row[comboKey] === "string") {
                const parts = row[comboKey]
                  .split(/[,\s]+/)
                  .map((s) => s.trim())
                  .filter(Boolean);
                if (parts.length >= 2) {
                  latVal = parts[0];
                  lonVal = parts[1];
                }
              }
            }
            const toNum = (v) => {
              if (typeof v === "number") return v;
              if (typeof v === "string") {
                const cleaned = v.replace(/,/g, ".").replace(/[^0-9+\-.]/g, "");
                const n = parseFloat(cleaned);
                return Number.isFinite(n) ? n : null;
              }
              return null;
            };
            const lat = toNum(latVal);
            const lon = toNum(lonVal);
            if (
              lat != null &&
              lon != null &&
              Math.abs(lat) <= 90 &&
              Math.abs(lon) <= 180
            ) {
              newPoints.push({
                id: `${idx}-${desa || "row"}`,
                desa: desa || "-",
                lat,
                lon,
                row,
              });
            }
          });
          const processedData = Object.entries(desaCount).map(
            ([desa, count]) => {
              const nd = normalizeDesaName(desa);
              const kec = desaToKecMap[nd] ? String(desaToKecMap[nd]).trim() : '';
              const nk = normalizeGeneralName(kec);
              const denom = (muatanByNames[`${nk}|||${nd}`] ?? muatanByDesa[nd] ?? null);
              const percentMu = denom && denom > 0 ? ((count / denom) * 100) : null;
              return {
                desa,
                count,
                percentage: percentMu != null ? percentMu.toFixed(2) : ((count / rows.length) * 100).toFixed(2),
                percentageMU: percentMu, // raw number (not fixed) for display
                muatan: denom || 0,
                kecamatan: kec || ''
              };
            }
          );
          setOriginalData(processedData);
          sortData(processedData, "desc");
          setPoints(newPoints);
        }
      } catch (err) {
        console.warn("Default data load failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Proses upload file Excel
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setLoading(true);
    const reader = new FileReader();
    const isCSV = file.name && file.name.toLowerCase().endsWith(".csv");

    reader.onload = (e) => {
      try {
        const data = e.target.result;
        const workbook = isCSV
          ? XLSX.read(data, { type: "string" })
          : XLSX.read(data, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        const rows = (jsonData || []).filter(isRowKabupatenNganjuk);
        try {
          if (rows && rows.length) setRawRows(rows);
        } catch (e) {}

        // Proses data untuk mendapatkan jumlah tagging per desa dan kumpulkan titik koordinat
        const desaCount = {};
        const newPoints = [];

        const latCandidates = [
          "lat",
          "latitude",
          "lintang",
          "y",
          "koordinat_lat",
          "latitude (y)",
        ];
        const lonCandidates = [
          "lon",
          "lng",
          "longitude",
          "bujur",
          "x",
          "koordinat_lon",
          "longitude (x)",
        ];
        const combinedCoordCandidates = [
          "koordinat",
          "coordinate",
          "coord",
          "coordinates",
        ];

        const findKey = (obj, candidates) => {
          const keys = Object.keys(obj);
          const lowerMap = keys.reduce((acc, k) => {
            acc[k.toLowerCase()] = k;
            return acc;
          }, {});
          for (const cand of candidates) {
            const k = lowerMap[cand.toLowerCase()];
            if (k) return k;
          }
          return null;
        };

        const extractIdFromRow = (r) => {
          try {
            const keys = Object.keys(r || {});
            const lower = keys.reduce((acc, k) => {
              acc[k.toLowerCase()] = k;
              return acc;
            }, {});
            const candKab =
              lower["kabupaten"] ||
              lower["kab"] ||
              lower["kabupaten/kota"] ||
              lower["kabupaten_kota"] ||
              null;
            const candKec = lower["kecamatan"] || lower["kec"] || null;
            const candDesa =
              lower["desa"] ||
              lower["nama desa"] ||
              lower["nama_desa"] ||
              lower["nm_desa"] ||
              lower["name"] ||
              null;
            const getBracketDigits = (v) => {
              if (v == null) return null;
              const s = String(v);
              const m = s.match(/\[(\d+)\]/);
              return m ? m[1] : null;
            };
            let kab = candKab
              ? getBracketDigits(r[candKab])
              : getBracketDigits(r["Kabupaten"]) ||
                getBracketDigits(r["KABUPATEN"]);
            let kec = candKec
              ? getBracketDigits(r[candKec])
              : getBracketDigits(r["Kecamatan"]) ||
                getBracketDigits(r["KECAMATAN"]);
            let desa = candDesa
              ? getBracketDigits(r[candDesa])
              : getBracketDigits(r["Desa"]) || getBracketDigits(r["DESA"]);
            if (!kab || !kec || !desa) {
              const allVals = keys.map((k) => String(r[k] ?? ""));
              const bracketDigits = [];
              for (const v of allVals) {
                const ms = v.match(/\[(\d+)\]/g);
                if (ms) {
                  for (const item of ms) {
                    const d = item.replace(/[^0-9]/g, "");
                    bracketDigits.push(d);
                  }
                }
              }
              for (let i = 0; i < bracketDigits.length; i++) {
                const a = bracketDigits[i] || "";
                const b = bracketDigits[i + 1] || "";
                const c = bracketDigits[i + 2] || "";
                if (a.length === 4 && b.length === 3 && c.length === 3) {
                  kab = kab || a;
                  kec = kec || b;
                  desa = desa || c;
                  break;
                }
              }
            }
            if (kab && kec && desa) {
              kab = kab.padStart(4, "0").slice(-4);
              kec = kec.padStart(3, "0").slice(-3);
              desa = desa.padStart(3, "0").slice(-3);
              return `${kab}${kec}${desa}`;
            }
          } catch (e) {}
          return null;
        };

        rows.forEach((row, idx) => {
          const desaVal =
            row.Desa ||
            row.desa ||
            row.nama_desa ||
            row.nama ||
            row.NAMA ||
            row.nm_desa ||
            row.name ||
            row["Nama Desa"];
          let desa = desaVal != null ? desaVal.toString().trim() : "";
          // try authoritative mapping via daftarDesaMap
          try {
            const id10 = extractIdFromRow(row);
            if (id10 && daftarDesaMap && daftarDesaMap[id10]) {
              const rec = daftarDesaMap[id10];
              desa =
                rec.nama_desa ||
                rec.nama ||
                rec.DESA ||
                rec["Nama Desa"] ||
                rec.desa
                  ? String(
                      rec.nama_desa ||
                        rec.nama ||
                        rec.DESA ||
                        rec["Nama Desa"] ||
                        rec.desa
                    ).trim()
                  : desa;
            }
          } catch (e) {}

          if (desa && desa !== "") {
            desaCount[desa] = (desaCount[desa] || 0) + 1;
          }

          // Ekstrak koordinat per baris
          let latKey = findKey(row, latCandidates);
          let lonKey = findKey(row, lonCandidates);
          let latVal = latKey ? row[latKey] : undefined;
          let lonVal = lonKey ? row[lonKey] : undefined;

          if (latVal == null || lonVal == null) {
            const comboKey = findKey(row, combinedCoordCandidates);
            if (comboKey && typeof row[comboKey] === "string") {
              const parts = row[comboKey]
                .split(/[,\s]+/)
                .map((s) => s.trim())
                .filter(Boolean);
              if (parts.length >= 2) {
                latVal = parts[0];
                lonVal = parts[1];
              }
            }
          }

          const toNum = (v) => {
            if (typeof v === "number") return v;
            if (typeof v === "string") {
              const cleaned = v.replace(/,/g, ".").replace(/[^0-9+\-.]/g, "");
              const n = parseFloat(cleaned);
              return Number.isFinite(n) ? n : null;
            }
            return null;
          };

          const lat = toNum(latVal);
          const lon = toNum(lonVal);
          if (
            lat != null &&
            lon != null &&
            Math.abs(lat) <= 90 &&
            Math.abs(lon) <= 180
          ) {
            newPoints.push({
              id: `${idx}-${desa || "row"}`,
              desa: desa || "-",
              lat,
              lon,
              row,
            });
          }
        });

        // Konversi ke array dan urutkan
        const processedData = Object.entries(desaCount).map(
          ([desa, count]) => {
            const nd = normalizeDesaName(desa);
            const kec = desaToKecMap[nd] ? String(desaToKecMap[nd]).trim() : '';
            const nk = normalizeGeneralName(kec);
            const denom = (muatanByNames[`${nk}|||${nd}`] ?? muatanByDesa[nd] ?? null);
            const percentMu = denom && denom > 0 ? ((count / denom) * 100) : null;
            return {
              desa,
              count,
              percentage: percentMu != null ? percentMu.toFixed(2) : ((count / rows.length) * 100).toFixed(2),
              percentageMU: percentMu,
              muatan: denom || 0,
              kecamatan: kec || ''
            };
          }
        );

        // Update master desa list dari file upload
        try {
          const names = new Set();
          for (const row of rows) {
            const name =
              row.Desa ||
              row.desa ||
              row.nama_desa ||
              row.nama ||
              row.NAMA ||
              row.nm_desa ||
              row.name ||
              row["Nama Desa"];
            if (name) names.add(String(name).trim());
          }
          if (names.size) setMasterDesaList(Array.from(names).sort());
        } catch (e) {}

        // Bangun peta desa->kecamatan dari file upload dan gabungkan
        try {
          const desaKecNew = {};
          const kecCandidates = [
            "kecamatan",
            "nama kecamatan",
            "kec",
            "nm_kecamatan",
            "nama_kec",
            "Kecamatan",
            "KECAMATAN",
            "Nama Kecamatan",
          ];
          const findKey2 = (obj, candidates) => {
            const keys = Object.keys(obj || {});
            const lowerMap = keys.reduce((acc, k) => {
              acc[k.toLowerCase()] = k;
              return acc;
            }, {});
            for (const cand of candidates) {
              const k = lowerMap[cand.toLowerCase()];
              if (k) return k;
            }
            return null;
          };
          for (const row of rows) {
            const desaNameRaw =
              row.Desa ||
              row.desa ||
              row.nama_desa ||
              row.nama ||
              row.NAMA ||
              row.nm_desa ||
              row.name ||
              row["Nama Desa"];
            const kecKey = findKey2(row, kecCandidates);
            const kecRaw = kecKey ? row[kecKey] : undefined;
            const desaName = desaNameRaw ? String(desaNameRaw).trim() : "";
            const kec = kecRaw != null ? String(kecRaw).trim() : "";
            if (!desaName || !kec) continue;
            if (kec.includes("@")) continue;
            const key = normalizeDesaName(desaName);
            desaKecNew[key] = kec;
          }
          if (Object.keys(desaKecNew).length)
            setDesaToKecMap((prev) => ({ ...prev, ...desaKecNew }));
        } catch (e) {}

        setOriginalData(processedData);
        sortData(processedData, "desc");
        setPoints(newPoints);
        setLoading(false);
      } catch (error) {
        console.error("Error processing file:", error);
        alert("Error memproses file. Pastikan format file Excel benar.");
        setLoading(false);
      }
    };

    if (isCSV) reader.readAsText(file, "utf-8");
    else reader.readAsBinaryString(file);
  };

  // Upload authoritative daftar-desa.xlsx or CSV to enable Export Corrected
  const handleDaftarDesaUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = ev.target.result;
        const workbook =
          file.name && file.name.toLowerCase().endsWith(".csv")
            ? XLSX.read(data, { type: "string" })
            : XLSX.read(data, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet);
        const map = {};
        for (const r of json) {
          const keys = Object.keys(r || {});
          let idVal = null;
          for (const k of keys) {
            const v = String(r[k] ?? "").trim();
            if (/^\d{10}$/.test(v)) {
              idVal = v;
              break;
            }
            if (/^id_desa$/i.test(k) && /^\d+$/.test(v)) {
              idVal = v.padStart(10, "0");
              break;
            }
          }
          if (!idVal) continue;
          map[idVal] = r;
        }
        if (Object.keys(map).length) {
          setDaftarDesaMap(map);
          try {
            const idx = buildMuatanIndexes(map);
            setMuatanByNames(idx.byNames);
            setMuatanByDesa(idx.byDesa);
          } catch(e) {}
          alert("Daftar-desa berhasil dimuat dan siap untuk koreksi.");
        } else {
          alert(
            "Gagal membaca daftar-desa. Pastikan kolom id_desa atau nilai 10 digit tersedia."
          );
        }
      } catch (err) {
        console.error("Error loading daftar-desa:", err);
        alert("Gagal memproses file daftar-desa.");
      }
    };
    if (file.name && file.name.toLowerCase().endsWith(".csv"))
      reader.readAsText(file, "utf-8");
    else reader.readAsBinaryString(file);
  };

  // Fungsi sorting data
  const sortData = (dataToSort, order) => {
    const sorted = [...dataToSort].sort((a, b) => {
      if (order === "desc") {
        return b.count - a.count;
      } else {
        return a.count - b.count;
      }
    });
    setData(sorted);
  };

  // Handle perubahan sorting
  const handleSortChange = (newOrder) => {
    setSortOrder(newOrder);
    sortData(originalData, newOrder);
  };

  // Filter data berdasarkan nama desa
  const filteredData = data.filter((item) =>
    item.desa.toLowerCase().includes(filterText.toLowerCase())
  );

  // Export data ke Excel — aggregate by Kecamatan + Desa using rawRows values when available
  const exportToExcel = () => {
    if (!rawRows || rawRows.length === 0) {
      alert(
        "Tidak ada data mentah untuk diekspor. Unggah file terlebih dahulu."
      );
      return;
    }

    // Helper to find candidate keys in a row
    const findKey = (obj, candidates) => {
      const keys = Object.keys(obj || {});
      const lowerMap = keys.reduce((acc, k) => {
        acc[k.toLowerCase()] = k;
        return acc;
      }, {});
      for (const cand of candidates) {
        const k = lowerMap[cand.toLowerCase()];
        if (k) return k;
      }
      return null;
    };

    const desaCandidates = [
      "desa",
      "nama desa",
      "nama_desa",
      "nm_desa",
      "name",
      "nama",
      "nama desa (desa/kel)",
    ];
    const kecCandidates = [
      "kecamatan",
      "nama kecamatan",
      "kec",
      "nm_kecamatan",
      "nama_kec",
      "nama kec",
      "kecamatan/desa",
    ];

    // Filter rawRows to only include Kabupaten Nganjuk explicitly
    const filteredRows = (rawRows || []).filter((r) => isRowKabupatenNganjuk(r));

    // Build counts keyed by Kecamatan + Desa (prefer rawRows Kecamatan column)
    const pairCounts = {}; // key -> count
    const pairSample = {}; // key -> {kec, desa}
    const total = filteredRows.length;

    const toStr = (v) => (v == null ? "" : String(v).trim());

    for (const row of filteredRows) {
      // Prioritize reading order: Kabupaten -> Kecamatan -> Desa
      const kabCandidates = ['kabupaten','kabupaten/kota','kab','nama kabupaten','kabupaten_kota'];
      const kabKey = findKey(row, kabCandidates);
      // if kab not present or not Nganjuk, skip (defensive)
      if (!kabKey && !isRowKabupatenNganjuk(row)) continue;

      const kecKeyName = findKey(row, kecCandidates);
      const desaKeyName = findKey(row, desaCandidates);

      const kecRaw = kecKeyName
        ? toStr(row[kecKeyName])
        : toStr(row.Kecamatan) || toStr(row.kec) || toStr(row.nama_kecamatan) || "";
      const desaRaw = desaKeyName
        ? toStr(row[desaKeyName])
        : toStr(row.Desa) || toStr(row.nama_desa) || toStr(row.nama) || toStr(row.NAMA) || toStr(row.nm_desa) || toStr(row.name);

      let finalKec = kecRaw;
      let finalDesa = desaRaw;

      // Fallback to daftarDesaMap by id if missing
      if ((!finalKec || finalKec === '') || (!finalDesa || finalDesa === '')) {
        if (daftarDesaMap && typeof daftarDesaMap === 'object') {
          try {
            const id10 = (function(r){
              try {
                const keys = Object.keys(r || {});
                const lower = keys.reduce((acc, k) => { acc[k.toLowerCase()] = k; return acc; }, {});
                const candKab = lower['kabupaten'] || lower['kab'] || lower['kabupaten/kota'] || lower['kabupaten_kota'] || null;
                const candKec = lower['kecamatan'] || lower['kec'] || null;
                const candDesa = lower['desa'] || lower['nama desa'] || lower['nama_desa'] || lower['nm_desa'] || lower['name'] || null;
                const getBracketDigits = (v) => { if (v == null) return null; const s = String(v); const m = s.match(/\[(\d+)\]/); return m ? m[1] : null; };
                let kab = candKab ? getBracketDigits(r[candKab]) : getBracketDigits(r['Kabupaten']) || getBracketDigits(r['KABUPATEN']);
                let kec = candKec ? getBracketDigits(r[candKec]) : getBracketDigits(r['Kecamatan']) || getBracketDigits(r['KECAMATAN']);
                let desa = candDesa ? getBracketDigits(r[candDesa]) : getBracketDigits(r['Desa']) || getBracketDigits(r['DESA']);
                if (!kab || !kec || !desa) {
                  const allVals = keys.map(k => String(r[k] ?? ''));
                  const bracketDigits = [];
                  for (const v of allVals) {
                    const ms = v.match(/\[(\d+)\]/g);
                    if (ms) for (const item of ms) { bracketDigits.push(item.replace(/[^0-9]/g, '')); }
                  }
                  for (let i=0;i<bracketDigits.length;i++) {
                    const a = bracketDigits[i] || '';
                    const b = bracketDigits[i+1] || '';
                    const c = bracketDigits[i+2] || '';
                    if (a.length===4 && b.length===3 && c.length===3) { kab = kab || a; kec = kec || b; desa = desa || c; break; }
                  }
                }
                if (kab && kec && desa) { kab = kab.padStart(4,'0').slice(-4); kec = kec.padStart(3,'0').slice(-3); desa = desa.padStart(3,'0').slice(-3); return `${kab}${kec}${desa}`; }
              } catch(e){}
              return null;
            })(row);
            if (id10 && daftarDesaMap[id10]) {
              const rec = daftarDesaMap[id10];
              if ((!finalDesa || finalDesa === '') && (rec.nama_desa || rec.nama || rec.DESA || rec['Nama Desa'] || rec.desa)) finalDesa = toStr(rec.nama_desa || rec.nama || rec.DESA || rec['Nama Desa'] || rec.desa);
              if ((!finalKec || finalKec === '') && (rec.nama_kecamatan || rec.kecamatan || rec.kec || rec.kecamatan_name || rec.kecamatan_nama)) finalKec = toStr(rec.nama_kecamatan || rec.kecamatan || rec.kec || rec.kecamatan_name || rec.kecamatan_nama);
            }
          } catch(e){}
        }
      }

      const nDesa = normalizeDesaName(finalDesa || '');
      const nKec = (finalKec || '').toString().trim();
      // Skip rows that do not contain a Desa name to avoid counting kecamatan-only rows
      if (!nDesa) continue;
      const pairKey = `${nKec}|||${nDesa}`;
      if (!pairCounts[pairKey]) pairCounts[pairKey] = 0;
      pairCounts[pairKey] += 1;
      if (!pairSample[pairKey]) pairSample[pairKey] = { kec: finalKec || '', desa: finalDesa || '' };
    }

    // Build ordered rows from pairCounts
    const rows = Object.entries(pairCounts).map(([pairKey, cnt]) => {
      const sample = pairSample[pairKey] || { kec: '', desa: '' };
      return {
        'Nama Kecamatan': sample.kec || '',
        'Nama Desa': sample.desa || '',
        'Jumlah Tagging': cnt,
        'Persentase (%)': total ? ((cnt / total) * 100).toFixed(2) : '0.00'
      };
    });

    // Sort rows by count desc
    rows.sort((a, b) => b['Jumlah Tagging'] - a['Jumlah Tagging']);

    // Ensure desired column order: Ranking, Nama Kecamatan, Nama Desa, Jumlah Tagging, Persentase (%)
    const ordered = rows.map((r, idx) => ({
      Ranking: idx + 1,
      'Nama Kecamatan': r['Nama Kecamatan'],
      'Nama Desa': r['Nama Desa'],
      'Jumlah Tagging': r['Jumlah Tagging'],
      'Persentase (%)': r['Persentase (%)']
    }));

    const wb = XLSX.utils.book_new();
    // Use AoA to preserve column order
    const header = ['Ranking','Nama Kecamatan','Nama Desa','Jumlah Tagging','Persentase (%)'];
    const sheetData = [header, ...ordered.map(r => header.map(h => r[h]))];
    const ws1 = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(wb, ws1, 'Data Tagging per Desa');

    // Also create a sheet for desa with zero tagging (none expected since we aggregated from rawRows)
    const zeroRows = ordered.filter(r => r['Jumlah Tagging'] === 0).map(r => [r['Ranking'], r['Nama Kecamatan'], r['Nama Desa'], r['Jumlah Tagging']]);
    const ws2 = XLSX.utils.aoa_to_sheet([['Ranking','Nama Kecamatan','Nama Desa','Jumlah Tagging'], ...zeroRows]);
    XLSX.utils.book_append_sheet(wb, ws2, 'Belum Ditagging');

    XLSX.writeFile(wb, 'sebaran_tagging_desa.xlsx');
  };

  // Export corrected rows using daftarDesaMap (use id10 to override Kecamatan and Desa)
  const exportCorrectedExcel = () => {
    if (!rawRows || rawRows.length === 0) {
      alert(
        "Tidak ada data mentah untuk diekspor. Unggah file terlebih dahulu."
      );
      return;
    }
    if (!daftarDesaMap || Object.keys(daftarDesaMap).length === 0) {
      if (
        !confirm("Daftar-desa.xlsx tidak ditemukan. Lanjutkan tanpa koreksi?")
      )
        return;
    }

    const getBracketDigits = (v) => {
      if (v == null) return null;
      const s = String(v);
      const m = s.match(/\[(\d+)\]/);
      return m ? m[1] : null;
    };

    const extractIdFromRow = (r) => {
      try {
        const keys = Object.keys(r || {});
        const lower = keys.reduce((acc, k) => {
          acc[k.toLowerCase()] = k;
          return acc;
        }, {});
        const candKab =
          lower["kabupaten"] ||
          lower["kab"] ||
          lower["kabupaten/kota"] ||
          lower["kabupaten_kota"] ||
          null;
        const candKec = lower["kecamatan"] || lower["kec"] || null;
        const candDesa =
          lower["desa"] ||
          lower["nama desa"] ||
          lower["nama_desa"] ||
          lower["nm_desa"] ||
          lower["name"] ||
          null;
        let kab = candKab
          ? getBracketDigits(r[candKab])
          : getBracketDigits(r["Kabupaten"]) ||
            getBracketDigits(r["KABUPATEN"]);
        let kec = candKec
          ? getBracketDigits(r[candKec])
          : getBracketDigits(r["Kecamatan"]) ||
            getBracketDigits(r["KECAMATAN"]);
        let desa = candDesa
          ? getBracketDigits(r[candDesa])
          : getBracketDigits(r["Desa"]) || getBracketDigits(r["DESA"]);
        if (!kab || !kec || !desa) {
          const allVals = keys.map((k) => String(r[k] ?? ""));
          const bracketDigits = [];
          for (const v of allVals) {
            const ms = v.match(/\[(\d+)\]/g);
            if (ms) {
              for (const item of ms) {
                const d = item.replace(/[^0-9]/g, "");
                bracketDigits.push(d);
              }
            }
          }
          for (let i = 0; i < bracketDigits.length; i++) {
            const a = bracketDigits[i] || "";
            const b = bracketDigits[i + 1] || "";
            const c = bracketDigits[i + 2] || "";
            if (a.length === 4 && b.length === 3 && c.length === 3) {
              kab = kab || a;
              kec = kec || b;
              desa = desa || c;
              break;
            }
          }
        }
        if (kab && kec && desa) {
          kab = kab.padStart(4, "0").slice(-4);
          kec = kec.padStart(3, "0").slice(-3);
          desa = desa.padStart(3, "0").slice(-3);
          return `${kab}${kec}${desa}`;
        }
      } catch (e) {}
      return null;
    };

    const out = [];
    for (const row of rawRows) {
      const copied = { ...row };
      try {
        const id10 = extractIdFromRow(row);
        if (id10 && daftarDesaMap && daftarDesaMap[id10]) {
          const rec = daftarDesaMap[id10];
          if (rec.nama_kecamatan) copied.Kecamatan = String(rec.nama_kecamatan);
          else if (rec.kecamatan) copied.Kecamatan = String(rec.kecamatan);
          if (rec.nama_desa) copied.Desa = String(rec.nama_desa);
          else if (rec.nama) copied.Desa = String(rec.nama);
        }
      } catch (e) {}
      out.push(copied);
    }

    try {
      const ws = XLSX.utils.json_to_sheet(out);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Corrected");
      XLSX.writeFile(wb, "hasil-tagging-corrected.xlsx");
    } catch (e) {
      console.error("Export corrected failed", e);
      alert("Gagal mengekspor file terkorigasi. Cek console for details.");
    }
  };

  // Helper: pusat koordinat default (Kabupaten Nganjuk)
  const CENTER_LAT = -7.603;
  const CENTER_LON = 111.901;

  // Generate synthetic test data (fast) untuk menguji performa peta
  const generateTestData = (n = 5000) => {
    setLoading(true);
    // jalankan di next tick agar spinner muncul
    setTimeout(() => {
      const newPoints = [];
      const desaCount = {};
      const desaPool = 300; // jumlah desa unik simulasi
      for (let i = 0; i < n; i++) {
        const lat = CENTER_LAT + (Math.random() - 0.5) * 0.4; // +-0.2 deg
        const lon = CENTER_LON + (Math.random() - 0.5) * 0.6; // +-0.3 deg
        const desaIndex = (i % desaPool) + 1;
        const desa = `DESA ${String(desaIndex).padStart(3, "0")}`;
        desaCount[desa] = (desaCount[desa] || 0) + 1;
        newPoints.push({ id: `g-${i}`, desa, lat, lon, row: {} });
      }

      const processedData = Object.entries(desaCount).map(([desa, count]) => ({
        desa,
        count,
        percentage: ((count / n) * 100).toFixed(2),
      }));

      setOriginalData(processedData);
      sortData(processedData, "desc");
      setPoints(newPoints);
      setLoading(false);
    }, 20);
  };

  const clearData = () => {
    setOriginalData([]);
    setData([]);
    setPoints([]);
    setFilterText("");
  };

  // Komponen Progress Bar
  const ProgressBar = ({ value, max, label, count, percentMU }) => {
    const percentage = max > 0 ? (value / max) * 100 : 0;
    const pctText = percentMU != null ? `${percentMU.toFixed(1)}%` : "—";
    return (
      <div className="p-4 mb-4 bg-white border border-gray-200 rounded-lg shadow">
        <div className="flex items-center justify-between mb-2">
          <span className="mr-2 text-sm font-medium text-gray-700 truncate">
            {label}
          </span>
          <div className="flex items-center space-x-2">
            <span className="text-sm font-bold text-blue-600">
              {count.toLocaleString()}
            </span>
            <span className="text-xs text-gray-500">
              ({pctText})
            </span>
          </div>
        </div>
        <div className="w-full h-3 bg-gray-200 rounded-full">
          <div
            className="h-3 transition-all duration-300 ease-out rounded-full bg-gradient-to-r from-blue-500 to-blue-600"
            style={{ width: `${percentage}%` }}
          ></div>
        </div>
      </div>
    );
  };

  const maxCount =
    data.length > 0 ? Math.max(...data.map((item) => item.count)) : 0;
  const filteredPoints = useMemo(() => {
    if (!filterText) return points;
    return points.filter((p) =>
      (p.desa || "").toLowerCase().includes(filterText.toLowerCase())
    );
  }, [points, filterText]);

  const totalData = originalData.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="min-h-screen p-6 bg-gray-50">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-6">
          <div className="relative overflow-hidden rounded-lg">
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 via-sky-600 to-emerald-500 opacity-95"></div>
            <div className="relative p-8 text-white sm:p-12">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <img
                    src="/logo-bps-nganjuk-transparan.png"
                    alt="logo BPS Nganjuk"
                    className="w-10 h-10 p-1 rounded-md bg-white/20"
                  />
                  <div>
                    <div className="text-sm font-semibold tracking-wider uppercase">
                      BPS Kabupaten Nganjuk
                    </div>
                    <div className="text-xs opacity-80">Dashboard Resmi</div>
                  </div>
                </div>
                <div className="px-3 py-1 text-sm rounded-full bg-white/20">
                  {new Date().toLocaleDateString()}
                </div>
              </div>

              <h1 className="text-4xl font-extrabold leading-tight sm:text-5xl">
                Dashboard Sebaran Data Tagging per Desa
              </h1>
              <p className="max-w-2xl mt-3 text-lg opacity-90">
                Analisis distribusi data tagging dari{" "}
                <span className="font-semibold">
                  {totalData.toLocaleString()}
                </span>{" "}
                total entri
              </p>

              <div className="flex mt-6 space-x-3">
                <label className="flex items-center px-4 py-2 space-x-2 text-indigo-700 transition bg-white rounded-lg cursor-pointer hover:brightness-90">
                  <Upload size={16} />
                  <span className="font-medium">Pilih File Excel (.xlsx/.csv)</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
                {data.length > 0 && (
                  <>
                    <button
                      onClick={exportToExcel}
                      className="flex items-center px-4 py-2 mr-2 space-x-2 text-white transition border rounded-lg bg-white/20 border-white/30 hover:bg-white/10"
                    >
                      <Download size={16} />
                      <span>Export Excel</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Upload Section */}
        <div className="p-6 mb-6 bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-800">
              Upload Data Excel
            </h2>
            {data.length > 0 && (
              <div className="flex items-center space-x-2">
                <button
                  onClick={exportToExcel}
                  className="flex items-center px-4 py-2 space-x-2 text-white transition-colors bg-green-600 rounded-lg hover:bg-green-700"
                >
                  <Download size={16} />
                  <span>Export Excel</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-4">
            <label className="flex items-center px-4 py-2 space-x-2 text-white transition-colors bg-blue-600 rounded-lg cursor-pointer hover:bg-blue-700">
              <Upload size={16} />
              <span>Pilih File Excel (.xlsx/.csv)</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>


            {/* <button
              onClick={() => generateTestData(5000)}
              className="px-3 py-2 text-gray-800 transition bg-gray-100 border border-gray-200 rounded-lg hover:bg-gray-200"
              title="Generate 5000 titik (test)"
            >
              Generate 5k titik
            </button> */}

            <button
              onClick={clearData}
              className="px-3 py-2 text-red-600 transition border border-red-100 rounded-lg bg-red-50 hover:bg-red-100"
              title="Clear semua data"
            >
              Clear
            </button>

            {/* <div className="ml-2 text-xs text-gray-500">Atau coba URL publik:</div>
            <div className="flex flex-col ml-2 space-y-1">
              <button onClick={async () => {
                try { setGeoLoading(true); const gj = await fetch('https://raw.githubusercontent.com/superpikar/indonesia-geojson/master/kabupaten/jawa-timur/nganjuk.geojson').then(r => r.json()); setGeojson(gj); } catch (e) { console.warn(e); alert('Gagal memuat dari URL 1'); } finally { setGeoLoading(false); }
              }} className="px-2 py-1 text-xs bg-white border rounded">Use raw.githubusercontent.com/superpikar</button>
              <button onClick={async () => {
                try { setGeoLoading(true); const gj = await fetch('https://raw.githubusercontent.com/thetrisatria/geojson-indonesia/master/regencies/nganjuk.geojson').then(r => r.json()); setGeojson(gj); } catch (e) { console.warn(e); alert('Gagal memuat dari URL 2'); } finally { setGeoLoading(false); }
              }} className="px-2 py-1 text-xs bg-white border rounded">Use raw.githubusercontent.com/thetrisatria</button>
              <button onClick={async () => {
                try { setGeoLoading(true); const gj = await fetch('https://raw.githubusercontent.com/ans-4175/peta-indonesia-geojson/master/kabupaten/35/3518.geojson').then(r => r.json()); setGeojson(gj); } catch (e) { console.warn(e); alert('Gagal memuat dari URL 3'); } finally { setGeoLoading(false); }
              }} className="px-2 py-1 text-xs bg-white border rounded">Use raw.githubusercontent.com/ans-4175</button>
              <button onClick={async () => {
                try { setGeoLoading(true); const gj = await fetch('https://cdn.jsdelivr.net/gh/superpikar/indonesia-geojson@master/kabupaten/jawa-timur/nganjuk.geojson').then(r => r.json()); setGeojson(gj); } catch (e) { console.warn(e); alert('Gagal memuat dari URL 4'); } finally { setGeoLoading(false); }
              }} className="px-2 py-1 text-xs bg-white border rounded">Use jsdelivr superpikar</button>
            </div> */}

            {loading && (
              <div className="flex items-center space-x-2">
                <div className="w-5 h-5 border-b-2 border-blue-600 rounded-full animate-spin"></div>
                <span className="text-gray-600">Memproses data...</span>
              </div>
            )}
          </div>
        </div>

        {data.length > 0 && (
          <>
            {/* Controls */}
            <div className="p-6 mb-6 bg-white border border-gray-200 rounded-lg shadow-sm">
              <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0">
                <div className="flex items-center space-x-4">
                  <button
                    onClick={() =>
                      handleSortChange(sortOrder === "desc" ? "asc" : "desc")
                    }
                    className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
                      sortOrder === "desc"
                        ? "bg-blue-600 text-white hover:bg-blue-700"
                        : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                    }`}
                  >
                    {sortOrder === "desc" ? (
                      <SortDesc size={16} />
                    ) : (
                      <SortAsc size={16} />
                    )}
                    <span>
                      {sortOrder === "desc"
                        ? "Terbanyak → Tersedikit"
                        : "Tersedikit → Terbanyak"}
                    </span>
                  </button>
                </div>

                <div className="flex items-center space-x-2">
                  <Filter size={16} className="text-gray-500" />
                  <input
                    type="text"
                    placeholder="Filter nama desa..."
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-1 gap-6 mb-6 md:grid-cols-4">
              <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
                <h3 className="text-sm font-medium tracking-wide text-gray-500 uppercase">
                  Total Desa
                </h3>
                <p className="text-2xl font-bold text-blue-600">
                  {data.length}
                </p>
              </div>
              <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
                <h3 className="text-sm font-medium tracking-wide text-gray-500 uppercase">
                  Total Entri
                </h3>
                <p className="text-2xl font-bold text-green-600">
                  {totalData.toLocaleString()}
                </p>
              </div>
              <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
                <h3 className="text-sm font-medium tracking-wide text-gray-500 uppercase">
                  Rata-rata per Desa
                </h3>
                <p className="text-2xl font-bold text-purple-600">
                  {Math.round(totalData / data.length)}
                </p>
              </div>
              <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
                <h3 className="text-sm font-medium tracking-wide text-gray-500 uppercase">
                  Tertinggi
                </h3>
                <p className="text-2xl font-bold text-red-600">
                  {maxCount.toLocaleString()}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Progress Bars */}
              <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
                <h2 className="mb-4 text-xl font-semibold text-gray-800">
                  Progress per Desa ({filteredData.length} dari {data.length}{" "}
                  desa)
                </h2>
                <div className="overflow-y-auto max-h-96">
                  {filteredData.map((item, index) => (
                    <ProgressBar
                      key={item.desa}
                      value={item.count}
                      max={maxCount}
                      label={`${index + 1}. ${item.desa}`}
                      count={item.count}
                      percentMU={item.percentageMU}
                    />
                  ))}
                </div>
              </div>

              {/* Chart */}
              <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold text-gray-800">
                    Top 20 Desa
                  </h2>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setChartExpanded(true)}
                      className="px-3 py-1 text-sm bg-white border rounded shadow"
                    >
                      Expand Chart
                    </button>
                    <button
                      onClick={exportToExcel}
                      className="px-3 py-1 text-white bg-green-600 rounded shadow"
                    >
                      Export
                    </button>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart
                    data={filteredData.slice(0, 20)}
                    margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="desa"
                      angle={-45}
                      textAnchor="end"
                      height={80}
                      fontSize={10}
                    />
                    <YAxis />
                    <Tooltip
                      formatter={(value, name) => [
                        `${value.toLocaleString()} entri`,
                        "Jumlah Tagging",
                      ]}
                      labelStyle={{ color: "#374151" }}
                    />
                    <Bar dataKey="count" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Map */}
              <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xl font-semibold text-gray-800">
                    Sebaran Titik Desa (ringan)
                  </h2>
                  <div className="flex items-center space-x-3">
                    <div className="text-sm text-gray-600">
                      {filteredPoints.length.toLocaleString()} titik
                    </div>
                    <button
                      onClick={() => setMapExpanded(true)}
                      className="px-3 py-1 text-sm bg-white border rounded shadow"
                    >
                      Expand Map
                    </button>
                  </div>
                </div>
                <div className="overflow-hidden border border-gray-100 rounded-lg">
                  <CanvasChoroplethMap
                    points={filteredPoints}
                    geojson={geojson}
                    onFetchGeoJSON={async () => {
                      try {
                        setGeoLoading(true);
                        const gj = await fetchKecamatanGeoJSON();
                        setGeojson(gj);
                      } catch (err) {
                        console.error("GeoJSON fetch failed", err);
                        alert(
                          "Gagal memuat GeoJSON dari Overpass. Silakan unggah file GeoJSON manual jika perlu."
                        );
                      } finally {
                        setGeoLoading(false);
                      }
                    }}
                    geoLoading={geoLoading}
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Visualisasi titik ringan tanpa peta dasar — cocok untuk ribuan
                  titik.
                </p>
              </div>
            </div>

            {/* Expanded overlays */}
            {mapExpanded && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="bg-white w-[90vw] h-[90vh] rounded shadow-lg overflow-hidden">
                  <div className="flex items-center justify-between p-3 border-b">
                    <div className="font-semibold">Peta Sebaran (Expanded)</div>
                    <div className="space-x-2">
                      <button
                        onClick={() => setMapExpanded(false)}
                        className="px-3 py-1 bg-white border rounded"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                  <div className="h-full p-4">
                    <CanvasChoroplethMap
                      points={filteredPoints}
                      geojson={geojson}
                      onFetchGeoJSON={async () => {
                        try {
                          setGeoLoading(true);
                          const gj = await fetchKecamatanGeoJSON();
                          setGeojson(gj);
                        } catch (err) {
                          console.error(err);
                          alert("Gagal memuat GeoJSON");
                        } finally {
                          setGeoLoading(false);
                        }
                      }}
                      geoLoading={geoLoading}
                    />
                  </div>
                </div>
              </div>
            )}

            {chartExpanded && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="bg-white w-[90vw] h-[90vh] rounded shadow-lg overflow-hidden">
                  <div className="flex items-center justify-between p-3 border-b">
                    <div className="font-semibold">
                      Chart Top Desa (Expanded)
                    </div>
                    <div className="space-x-2">
                      <button
                        onClick={() => setChartExpanded(false)}
                        className="px-3 py-1 bg-white border rounded"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                  <div className="h-full p-4">
                    <div style={{ height: "100%", width: "100%" }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={filteredData}
                          margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis
                            dataKey="desa"
                            angle={-45}
                            textAnchor="end"
                            height={80}
                            fontSize={12}
                          />
                          <YAxis />
                          <Tooltip
                            formatter={(value) => [
                              `${value.toLocaleString()} entri`,
                              "Jumlah Tagging",
                            ]}
                          />
                          <Bar
                            dataKey="count"
                            fill="#3B82F6"
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {data.length === 0 && !loading && (
          <div className="p-12 text-center bg-white border border-gray-200 rounded-lg shadow-sm">
            <Upload size={48} className="mx-auto mb-4 text-gray-400" />
            <h3 className="mb-2 text-lg font-medium text-gray-900">
              Belum ada data yang dimuat
            </h3>
            <p className="text-gray-600">
              Upload file Excel Anda untuk melihat dashboard sebaran data
              tagging per desa
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DesaTaggingDashboard;
