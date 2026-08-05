import { Canvg } from "canvg";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import tzlookup from "tz-lookup";
import { t, translateElement, locale } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const ids = [
  "section-title", "start-name", "finish-name",
  "width-px", "height-px", "width-mm", "height-mm", "dpi",
  "route-width", "profile-width", "profile-box-width", "profile-box-height",
  "profile-offset-x", "profile-offset-y", "info-offset-x", "info-offset-y",
  "arrow-size", "info-font-size", "label-font-size", "marker-scale", "elevation-font-size",
  "route-scale", "route-offset-x", "route-offset-y",
  "map-style",
  "elevation-threshold", "time-zone", "show-profile", "show-profile-elevation", "show-datetime",
  "show-map", "show-arrows", "antialias", "start-label-position", "finish-label-position",
  "meta-position", "profile-position"
];

let routeData = null;
let sourceRouteData = null;
let currentSvg = "";
let renderVersion = 0;
let renderedState = null;
let previewLoadingSince = 0;
let previewLoadingTimer;

const state = () => {
  const sizeMode = document.querySelector('input[name="size-mode"]:checked').value;
  const dpi = clamp(Number($("dpi").value), 72, 1200);
  const width = sizeMode === "px"
    ? clamp(Math.round(Number($("width-px").value)), 320, 12000)
    : clamp(Math.round(Number($("width-mm").value) / 25.4 * dpi), 320, 12000);
  const height = sizeMode === "px"
    ? clamp(Math.round(Number($("height-px").value)), 320, 12000)
    : clamp(Math.round(Number($("height-mm").value) / 25.4 * dpi), 320, 12000);
  const marginMode = $("margin-link").getAttribute("aria-pressed") === "true" ? "all" : "individual";
  const marginAllMm = clamp(Number($("margin-top").value), 0, 200);
  return {
    sizeMode, width, height, dpi,
    widthMm: width / dpi * 25.4, heightMm: height / dpi * 25.4,
    sectionTitle: $("section-title").value.trim() || "Route",
    startName: $("start-name").value.trim(),
    finishName: $("finish-name").value.trim(),
    marginMode, marginAllMm,
    marginTopMm: clamp(Number($("margin-top").value), 0, 200),
    marginRightMm: clamp(Number($("margin-right").value), 0, 200),
    marginBottomMm: clamp(Number($("margin-bottom").value), 0, 200),
    marginLeftMm: clamp(Number($("margin-left").value), 0, 200),
    routeWidthMm: clamp(Number($("route-width").value), .2, 1.5),
    profileWidthMm: clamp(Number($("profile-width").value), .1, 1.5),
    profileBoxWidthMm: clamp(Number($("profile-box-width").value), 10, 1000),
    profileBoxHeightMm: clamp(Number($("profile-box-height").value), 10, 1000),
    profileOffsetXMm: clamp(Number($("profile-offset-x").value), -500, 500),
    profileOffsetYMm: clamp(Number($("profile-offset-y").value), -500, 500),
    infoOffsetXMm: clamp(Number($("info-offset-x").value), -500, 500),
    infoOffsetYMm: clamp(Number($("info-offset-y").value), -500, 500),
    arrowSizeMm: clamp(Number($("arrow-size").value), .5, 10),
    infoFontSizePt: clamp(Number($("info-font-size").value), 4, 144),
    labelFontSizePt: clamp(Number($("label-font-size").value), 4, 144),
    markerScale: clamp(Number($("marker-scale").value), 10, 200),
    elevationFontSizePt: clamp(Number($("elevation-font-size").value), 4, 144),
    routeScale: clamp(Number($("route-scale").value), 50, 300),
    mapStyle: $("map-style").value,
    routeOffsetXMm: clamp(Number($("route-offset-x").value), -500, 500),
    routeOffsetYMm: clamp(Number($("route-offset-y").value), -500, 500),
    elevationThreshold: clamp(Number($("elevation-threshold").value), 0, 50),
    timeZone: $("time-zone").value.trim() || "auto",
    showMap: $("show-map").checked,
    showArrows: $("show-arrows").checked,
    startLabelPosition: $("start-label-position").value,
    finishLabelPosition: $("finish-label-position").value,
    metaPosition: $("meta-position").value,
    profilePosition: $("profile-position").value,
    showProfile: $("show-profile").checked,
    showProfileElevation: $("show-profile-elevation").checked,
    showDatetime: $("show-datetime").checked,
    antialias: $("antialias").checked,
    previewScale: clamp(Number($("preview-scale").value), 1, 300),
    clipMode: $("clip-mode").value,
    clipDistanceStart: $("clip-distance-start").value,
    clipDistanceEnd: $("clip-distance-end").value,
    clipTimeStart: $("clip-time-start").value,
    clipTimeEnd: $("clip-time-end").value,
    customLabels: readCustomLabels()
  };
};

function clamp(value, min, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

function extent(items, valueOf) {
  let min = Infinity;
  let max = -Infinity;
  for (const item of items) {
    const value = valueOf(item);
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

function readCustomLabels() {
  return [...$("custom-labels").querySelectorAll(".custom-label-row")].map((row) => ({
    name: row.querySelector(".custom-name").value.trim(),
    mode: row.querySelector(".custom-mode").value,
    distance: row.querySelector(".custom-distance").value,
    time: row.querySelector(".custom-time").value,
    lat: row.querySelector(".custom-lat").value,
    lon: row.querySelector(".custom-lon").value,
    position: row.querySelector(".custom-position").value,
    showOnProfile: row.querySelector(".custom-show-profile").checked
  })).filter((label) => label.name);
}

function updateCustomLabelFields(row) {
  const mode = row.querySelector(".custom-mode").value;
  row.querySelector(".custom-distance-fields").hidden = mode !== "distance";
  row.querySelector(".custom-time-fields").hidden = mode !== "time";
  row.querySelector(".custom-coordinate-fields").hidden = mode !== "coordinate";
}

function addCustomLabel(label) {
  const isNewLabel = label === undefined;
  label ||= {};
  const row = document.createElement("div");
  row.className = "custom-label-row";
  row.innerHTML = `
    <div class="field-grid">
      <label class="wide">Name<input class="custom-name" type="text" placeholder="e.g. Pass, CP1"></label>
      <label>Specify by
        <select class="custom-mode">
          <option value="distance">Distance</option>
          <option value="time">Datetime</option>
          <option value="coordinate">Latitude/longitude</option>
        </select>
      </label>
      <label>Display direction
        <select class="custom-position">
          <option value="top">Top</option><option value="top-right">Top right</option>
          <option value="right">Right</option><option value="bottom-right">Bottom right</option>
          <option value="bottom">Bottom</option><option value="bottom-left">Bottom left</option>
          <option value="left">Left</option><option value="top-left">Top left</option>
        </select>
      </label>
    </div>
    <div class="custom-distance-fields"><label>Distance along route km<input class="custom-distance" type="number" min="0" step="0.1"></label></div>
    <div class="custom-time-fields" hidden><label>Datetime<input class="custom-time" type="datetime-local"></label></div>
    <div class="custom-coordinate-fields field-grid" hidden>
      <label>Latitude<input class="custom-lat" type="number" min="-90" max="90" step="0.000001"></label>
      <label>Longitude<input class="custom-lon" type="number" min="-180" max="180" step="0.000001"></label>
    </div>
    <label class="check"><input class="custom-show-profile" type="checkbox"> Show on elevation profile</label>
    <button class="remove-label" type="button">Remove this label</button>`;
  translateElement(row);
  row.querySelector(".custom-name").value = label.name || "";
  row.querySelector(".custom-mode").value = label.mode || "distance";
  row.querySelector(".custom-distance").value = label.distance ?? "";
  const labelTimeZone = resolveTimeZone(
    $("time-zone").value.trim() || "auto",
    sourceRouteData?.flat[0]
  );
  row.querySelector(".custom-time").value = label.time
    || (isNewLabel ? toDatetimeLocal(sourceRouteData?.startTime, labelTimeZone) : "");
  row.querySelector(".custom-lat").value = label.lat ?? "";
  row.querySelector(".custom-lon").value = label.lon ?? "";
  row.querySelector(".custom-position").value = label.position || "top";
  const profileCheckbox = row.querySelector(".custom-show-profile");
  const hasSavedProfileSetting = Object.hasOwn(label, "showOnProfile");
  profileCheckbox.checked = hasSavedProfileSetting
    ? Boolean(label.showOnProfile)
    : row.querySelector(".custom-mode").value !== "coordinate";
  profileCheckbox.dataset.explicit = hasSavedProfileSetting ? "true" : "false";
  row.querySelector(".custom-mode").addEventListener("change", () => {
    if (profileCheckbox.dataset.explicit !== "true") {
      profileCheckbox.checked = row.querySelector(".custom-mode").value !== "coordinate";
    }
    updateCustomLabelFields(row);
    update();
  });
  profileCheckbox.addEventListener("change", () => {
    profileCheckbox.dataset.explicit = "true";
  });
  row.querySelectorAll("input, select").forEach((element) => element.addEventListener("input", update));
  row.querySelector(".remove-label").addEventListener("click", () => {
    row.remove();
    update();
  });
  $("custom-labels").append(row);
  updateCustomLabelFields(row);
}

function setCustomLabels(labels = []) {
  $("custom-labels").replaceChildren();
  labels.forEach(addCustomLabel);
}

function parseGpx(text) {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("Unable to parse GPX. Please check the XML format.");

  const nodePoints = (nodes) => [...nodes].map((node) => {
    const lat = Number(node.getAttribute("lat"));
    const lon = Number(node.getAttribute("lon"));
    const eleNode = [...node.children].find((child) => child.localName === "ele");
    const timeNode = [...node.children].find((child) => child.localName === "time");
    const ele = eleNode ? Number(eleNode.textContent) : null;
    const time = timeNode?.textContent.trim() || null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon, ele: Number.isFinite(ele) ? ele : null, time };
  }).filter(Boolean);

  let segments = [...xml.getElementsByTagNameNS("*", "trkseg")]
    .map((seg) => nodePoints(seg.getElementsByTagNameNS("*", "trkpt")))
    .filter((seg) => seg.length);

  if (!segments.length) {
    segments = [...xml.getElementsByTagNameNS("*", "rte")]
      .map((rte) => nodePoints(rte.getElementsByTagNameNS("*", "rtept")))
      .filter((seg) => seg.length);
  }
  if (segments.flat().length < 2) throw new Error("At least two valid route points are required.");

  let profileCumulative = 0;
  segments.forEach((segment) => {
    segment.forEach((point, pointIndex) => {
      if (pointIndex > 0) profileCumulative += haversine(segment[pointIndex - 1], point);
      point.profileDistance = profileCumulative;
    });
  });

  const transportLinks = [];
  segments = segments.flatMap((segment) => {
    const split = [];
    let current = [segment[0]];
    for (let index = 1; index < segment.length; index++) {
      const previous = segment[index - 1];
      const point = segment[index];
      const previousTime = previous.time ? new Date(previous.time).getTime() : NaN;
      const pointTime = point.time ? new Date(point.time).getTime() : NaN;
      const gapMs = pointTime - previousTime;
      const gapDistance = haversine(previous, point);
      if (Number.isFinite(gapMs) && gapMs >= 5 * 60 * 1000 && gapDistance >= 1000) {
        split.push(current);
        transportLinks.push({ from: previous, to: point, gapMs, gapDistance });
        current = [point];
      } else {
        current.push(point);
      }
    }
    split.push(current);
    return split.filter((part) => part.length);
  });

  const waypoints = [...xml.getElementsByTagNameNS("*", "wpt")].map((node) => {
    const point = nodePoints([node])[0];
    if (!point) return null;
    const nameNode = [...node.children].find((child) => child.localName === "name");
    return { ...point, name: nameNode?.textContent.trim() || "Point" };
  }).filter(Boolean);

  let cumulative = 0;
  const flat = [];
  segments.forEach((segment, segmentIndex) => {
    segment.forEach((point, pointIndex) => {
      if (pointIndex > 0) cumulative += haversine(segment[pointIndex - 1], point);
      point.distance = cumulative;
      flat.push({ ...point, distance: cumulative, segmentIndex });
    });
  });
  const directChildText = (element, name) =>
    element ? [...element.children].find((child) => child.localName === name)?.textContent.trim() || "" : "";
  const trackName = directChildText(xml.getElementsByTagNameNS("*", "trk")[0], "name");
  const routeName = directChildText(xml.getElementsByTagNameNS("*", "rte")[0], "name");
  const metadataName = directChildText(xml.getElementsByTagNameNS("*", "metadata")[0], "name");
  return {
    segments, flat, waypoints, transportLinks, totalDistance: cumulative,
    profileStartDistance: 0, profileTotalDistance: profileCumulative,
    name: trackName || routeName || metadataName,
    startTime: flat.find((point) => point.time)?.time || null,
    endTime: [...flat].reverse().find((point) => point.time)?.time || null
  };
}

function combineRouteData(items) {
  const missingTime = items.filter(({ data }) => !data.startTime);
  if (items.length > 1 && missingTime.length) {
    throw new Error(t("multipleGpxMissingTime", {
      files: missingTime.map(({ file }) => file.name).join(", ")
    }));
  }
  const ordered = [...items].sort((a, b) => {
    const timeDifference = new Date(a.data.startTime).getTime() - new Date(b.data.startTime).getTime();
    return timeDifference || a.index - b.index;
  });
  const segments = [];
  const flat = [];
  const waypoints = [];
  const transportLinks = [];
  let distanceOffset = 0;
  let profileDistanceOffset = 0;
  let previousFileEnd = null;

  ordered.forEach(({ data }) => {
    const pointMap = new Map();
    data.segments.forEach((segment) => {
      const combinedSegment = segment.map((point) => {
        const combinedPoint = {
          ...point,
          distance: distanceOffset + point.distance,
          profileDistance: profileDistanceOffset + point.profileDistance
        };
        pointMap.set(point, combinedPoint);
        return combinedPoint;
      });
      const segmentIndex = segments.length;
      segments.push(combinedSegment);
      combinedSegment.forEach((point) => flat.push({ ...point, segmentIndex }));
    });
    const currentFileStart = pointMap.get(data.segments[0][0]);
    const currentFileEnd = pointMap.get(data.segments.at(-1).at(-1));
    if (previousFileEnd && currentFileStart) {
      const gapDistance = haversine(previousFileEnd, currentFileStart);
      if (gapDistance >= 1000) {
        const previousTime = previousFileEnd.time ? new Date(previousFileEnd.time).getTime() : NaN;
        const currentTime = currentFileStart.time ? new Date(currentFileStart.time).getTime() : NaN;
        transportLinks.push({
          from: previousFileEnd,
          to: currentFileStart,
          gapMs: currentTime - previousTime,
          gapDistance,
          fileBoundary: true
        });
      }
    }
    (data.transportLinks || []).forEach((link) => {
      const from = pointMap.get(link.from);
      const to = pointMap.get(link.to);
      if (from && to) transportLinks.push({ ...link, from, to });
    });
    waypoints.push(...data.waypoints);
    distanceOffset += data.totalDistance;
    profileDistanceOffset += data.profileTotalDistance;
    previousFileEnd = currentFileEnd;
  });

  return {
    segments,
    flat,
    waypoints,
    transportLinks,
    totalDistance: distanceOffset,
    profileStartDistance: 0,
    profileTotalDistance: profileDistanceOffset,
    name: ordered.length === 1 ? ordered[0].data.name : "",
    startTime: ordered[0].data.startTime,
    endTime: [...ordered].reverse().find(({ data }) => data.endTime)?.data.endTime || null,
    fileNames: ordered.map(({ file }) => file.name)
  };
}

function derivedRouteData(source, predicate) {
  const segments = source.segments
    .map((segment) => segment.filter(predicate).map((point) => ({ ...point })))
    .filter((segment) => segment.length >= 2);
  if (!segments.length) throw new Error("Fewer than two route points fall within the specified range. Please widen the trim range.");

  let cumulative = 0;
  const flat = [];
  segments.forEach((segment, segmentIndex) => {
    segment.forEach((point, pointIndex) => {
      if (pointIndex > 0) cumulative += haversine(segment[pointIndex - 1], point);
      point.distance = cumulative;
      flat.push({ ...point, distance: cumulative, segmentIndex });
    });
  });
  const latitudeExtent = extent(flat, (point) => point.lat);
  const longitudeExtent = extent(flat, (point) => point.lon);
  const minLat = latitudeExtent.min;
  const maxLat = latitudeExtent.max;
  const minLon = longitudeExtent.min;
  const maxLon = longitudeExtent.max;
  const profileStartDistance = flat[0].profileDistance ?? flat[0].distance;
  const profileEndDistance = flat.at(-1).profileDistance ?? flat.at(-1).distance;
  return {
    segments,
    flat,
    transportLinks: (source.transportLinks || []).filter(({ from, to }) => predicate(from) && predicate(to)),
    totalDistance: cumulative,
    profileStartDistance,
    profileTotalDistance: Math.max(0, profileEndDistance - profileStartDistance),
    name: source.name,
    waypoints: source.waypoints.filter((point) =>
      point.lat >= minLat && point.lat <= maxLat && point.lon >= minLon && point.lon <= maxLon
    ),
    startTime: flat.find((point) => point.time)?.time || null,
    endTime: [...flat].reverse().find((point) => point.time)?.time || null
  };
}

function dateTimeParts(value, timeZone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23", timeZone
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function toDatetimeLocal(value, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (!value) return "";
  const parts = dateTimeParts(value, timeZone);
  return parts ? `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` : "";
}

function zonedDateTimeToTimestamp(value, timeZone) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return NaN;
  const desired = Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6] || 0)
  );
  let timestamp = desired;
  for (let index = 0; index < 3; index++) {
    const parts = dateTimeParts(timestamp, timeZone);
    if (!parts) return NaN;
    const represented = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second)
    );
    const correction = desired - represented;
    timestamp += correction;
    if (Math.abs(correction) < 1000) break;
  }
  return timestamp;
}

async function applyClip() {
  const mode = $("clip-mode").value;
  $("clip-distance-fields").hidden = mode !== "distance";
  $("clip-time-fields").hidden = mode !== "time";
  if (!sourceRouteData) return;
  try {
    if (mode === "distance") {
      const start = Math.max(0, Number($("clip-distance-start").value) || 0) * 1000;
      const end = Math.max(start, Number($("clip-distance-end").value) * 1000);
      routeData = derivedRouteData(sourceRouteData, (point) => point.distance >= start && point.distance <= end);
    } else if (mode === "time") {
      const start = new Date($("clip-time-start").value).getTime();
      const end = new Date($("clip-time-end").value).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error("Please specify both a start and end datetime.");
      routeData = derivedRouteData(sourceRouteData, (point) => {
        const time = point.time ? new Date(point.time).getTime() : NaN;
        return Number.isFinite(time) && time >= start && time <= end;
      });
    } else {
      routeData = sourceRouteData;
    }
    await update();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function haversine(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const q = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}

function ascent(points, threshold) {
  const elevations = points.map((p) => p.ele).filter(Number.isFinite);
  if (elevations.length < 2) return null;
  let gain = 0;
  let anchor = elevations[0];
  for (const value of elevations.slice(1)) {
    const delta = value - anchor;
    if (Math.abs(delta) >= threshold) {
      if (delta > 0) gain += delta;
      anchor = value;
    }
  }
  return Math.round(gain);
}

const ascentCache = new WeakMap();

function routeAscent(data, threshold) {
  let cache = ascentCache.get(data);
  if (!cache) {
    cache = new Map();
    ascentCache.set(data, cache);
  }
  if (!cache.has(threshold)) cache.set(threshold, ascent(data.flat, threshold));
  return cache.get(threshold);
}

function sampled(points, limit) {
  if (points.length <= limit) return points;
  const step = (points.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) =>
    points[Math.min(points.length - 1, Math.round(index * step))]
  );
}

const previewDataCache = new WeakMap();

function previewRouteData(data, pointLimit = 12000) {
  if (data.flat.length <= pointLimit) return data;
  const cached = previewDataCache.get(data);
  if (cached) return cached;
  const totalPoints = data.segments.reduce((sum, segment) => sum + segment.length, 0);
  const segments = data.segments.map((segment) => sampled(
    segment,
    Math.max(2, Math.round(pointLimit * segment.length / totalPoints))
  ));
  const flat = [];
  segments.forEach((segment, segmentIndex) => {
    segment.forEach((point) => flat.push({ ...point, segmentIndex }));
  });
  const preview = { ...data, segments, flat };
  previewDataCache.set(data, preview);
  return preview;
}

function nearestDistancePoint(points, distanceMeters) {
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].distance < distanceMeters) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return points[0];
  return Math.abs(points[low].distance - distanceMeters) <
    Math.abs(points[low - 1].distance - distanceMeters) ? points[low] : points[low - 1];
}

const timedPointsCache = new WeakMap();

function nearestTimePoint(data, target) {
  let points = timedPointsCache.get(data);
  if (!points) {
    points = data.flat.filter((point) => point.time && Number.isFinite(new Date(point.time).getTime()));
    timedPointsCache.set(data, points);
  }
  if (!points.length) return null;
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (new Date(points[middle].time).getTime() < target) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return points[0];
  const currentDifference = Math.abs(new Date(points[low].time).getTime() - target);
  const previousDifference = Math.abs(new Date(points[low - 1].time).getTime() - target);
  return currentDifference < previousDifference ? points[low] : points[low - 1];
}

function resolveCustomLabel(label, data, timeZoneSelection) {
  if (label.mode === "distance") {
    const distance = Number(label.distance) * 1000;
    if (!Number.isFinite(distance)) return null;
    return nearestDistancePoint(data.flat, clamp(distance, 0, data.totalDistance));
  }
  if (label.mode === "time") {
    const timeZone = resolveTimeZone(timeZoneSelection, data.flat[0]);
    const target = zonedDateTimeToTimestamp(label.time, timeZone);
    if (!Number.isFinite(target)) return null;
    return nearestTimePoint(data, target);
  }
  const lat = Number(label.lat);
  const lon = Number(label.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { lat, lon, ele: null }
    : null;
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

const tileCache = new Map();
let worldLandPromise;
const broadWaterBackgroundCache = new Map();
const broadLandPathCache = new Map();
const routeBoundsCache = new WeakMap();

function routeBounds(data) {
  const cached = routeBoundsCache.get(data);
  if (cached) return cached;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of data.flat) {
    const projected = mercator(point);
    if (projected.px < minX) minX = projected.px;
    if (projected.px > maxX) maxX = projected.px;
    if (projected.py < minY) minY = projected.py;
    if (projected.py > maxY) maxY = projected.py;
  }
  const bounds = { minX, maxX, minY, maxY };
  routeBoundsCache.set(data, bounds);
  return bounds;
}

async function generateSvg(data, s, renderData = data) {
  const { width: w, height: h } = s;
  const pxPerMm = s.dpi / 25.4;
  const ptToPx = s.dpi / 72;
  const margin = {
    top: s.marginTopMm * pxPerMm,
    right: s.marginRightMm * pxPerMm,
    bottom: s.marginBottomMm * pxPerMm,
    left: s.marginLeftMm * pxPerMm
  };
  const routeTop = margin.top;
  const routeBottom = h - margin.bottom;
  const mapLeft = margin.left;
  const mapRight = w - margin.right;
  const all = renderData.flat;
  const resolvedCustomLabels = s.customLabels
    .map((label) => ({ label, point: resolveCustomLabel(label, data, s.timeZone) }))
    .filter((item) => item.point);
  const layoutPoints = [...all, ...resolvedCustomLabels.map((item) => item.point)];
  const bounds = routeBounds(data);
  let { minX, maxX, minY, maxY } = bounds;
  resolvedCustomLabels.forEach(({ point }) => {
    const projected = mercator(point);
    minX = Math.min(minX, projected.px);
    maxX = Math.max(maxX, projected.px);
    minY = Math.min(minY, projected.py);
    maxY = Math.max(maxY, projected.py);
  });
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const scale = Math.min((mapRight - mapLeft) / spanX, (routeBottom - routeTop) / spanY)
    * .84 * s.routeScale / 100;
  const offsetX = (mapLeft + mapRight) / 2 - (minX + maxX) / 2 * scale + s.routeOffsetXMm * pxPerMm;
  const offsetY = (routeTop + routeBottom) / 2 - (minY + maxY) / 2 * scale + s.routeOffsetYMm * pxPerMm;
  const xy = (p) => {
    const q = mercator(p);
    return [q.px * scale + offsetX, q.py * scale + offsetY];
  };
  const sans = "Hiragino Sans, Yu Gothic, sans-serif";
  const infoFs = s.infoFontSizePt * ptToPx;
  const labelFontSize = s.labelFontSizePt * ptToPx;
  const profileLabelFontSize = s.elevationFontSizePt * ptToPx;
  const labelElevationFontSize = labelFontSize * .65;
  const auxiliaryFontSize = 7 * ptToPx;
  const profileAxisFontSize = auxiliaryFontSize;
  const attributionFontSize = auxiliaryFontSize * .68;
  const attributionBottomInset = auxiliaryFontSize * .2;
  const attributionGap = auxiliaryFontSize * .25;
  const linePx = Math.max(1, 12.8 * (w / 2400) * (s.routeWidthMm / .5));
  const ascentM = routeAscent(data, s.elevationThreshold);

  const routePointLimit = Math.max(800, Math.min(6000, Math.round((w + h) * 1.5)));
  const pointsPerSegment = Math.max(2, Math.floor(routePointLimit / renderData.segments.length));
  const renderSegments = renderData.segments.map((segment) => sampled(segment, pointsPerSegment));
  const paths = renderSegments.map((segment) => segment.map((p, i) => {
    const [x, y] = xy(p);
    return `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ")).join("");
  const transportPaths = (data.transportLinks || []).map(({ from, to }) => {
    const [fromX, fromY] = xy(from);
    const [toX, toY] = xy(to);
    return `M${fromX.toFixed(2)},${fromY.toFixed(2)} L${toX.toFixed(2)},${toY.toFixed(2)}`;
  }).join(" ");

  const first = data.flat[0], last = data.flat.at(-1);
  const [startX, startY] = xy(first);
  const [finishX, finishY] = xy(last);
  const labels = [];
  const markerScale = s.markerScale / 100;
  const endpointFontSize = labelFontSize;
  if (s.startName) labels.push(pointLabel(startX, startY, s.startName, first.ele, s.startLabelPosition, w, h, endpointFontSize, labelElevationFontSize));
  if (s.finishName) labels.push(pointLabel(finishX, finishY, s.finishName, last.ele, s.finishLabelPosition, w, h, endpointFontSize, labelElevationFontSize));

  const customLabelSvg = resolvedCustomLabels.map(({ label, point }) => {
    const [x, y] = xy(point);
    const markerSize = Math.max(5, h * .005) * markerScale;
    return `<rect x="${x - markerSize}" y="${y - markerSize}" width="${markerSize * 2}" height="${markerSize * 2}" transform="rotate(45 ${x} ${y})" fill="#111" stroke="#fff" stroke-width="${Math.max(1, markerSize * .25)}"/>
      ${pointLabel(x, y, label.name, null, label.position, w, h, labelFontSize, labelElevationFontSize)}`;
  }).join("");

  const profileMargin = s.profilePosition.startsWith("bottom") && s.showMap
    ? { ...margin, bottom: margin.bottom + attributionFontSize + attributionBottomInset + attributionGap }
    : margin;
  const profileBox = positionedBox(
    s.profilePosition,
    w,
    h,
    profileMargin,
    s.profileBoxWidthMm * pxPerMm,
    s.profileBoxHeightMm * pxPerMm
  );
  const profileOffsetX = s.profileOffsetXMm * pxPerMm;
  const profileOffsetY = s.profileOffsetYMm * pxPerMm;
  const profileBoxWidth = profileBox.right - profileBox.left;
  const profileBoxHeight = profileBox.bottom - profileBox.top;
  const profileLeftGutter = Math.min(profileAxisFontSize * 4.5, profileBoxWidth * .35);
  const profileRightGutter = Math.min(profileAxisFontSize, profileBoxWidth * .1);
  const profileBottomGutter = Math.min(profileAxisFontSize * 2, profileBoxHeight * .3);
  const profileLeft = profileBox.left + profileOffsetX + profileLeftGutter;
  const profileRight = profileBox.right + profileOffsetX - profileRightGutter;
  const profileTop = profileBox.top + profileOffsetY;
  const profileBottom = profileBox.bottom + profileOffsetY - profileBottomGutter;
  const profile = s.showProfile
    ? profileSvg(renderData, s, profileLeft, profileRight, profileTop, profileBottom, profileAxisFontSize, profileLabelFontSize, resolvedCustomLabels)
    : "";
  const japan = layoutPoints.every((p) => p.lat >= 20 && p.lat <= 46 && p.lon >= 122 && p.lon <= 154);
  const background = s.showMap
    ? await tileBackgroundSvg({ w, h, scale, offsetX, offsetY, minX, maxX, minY, maxY, japan, mapStyle: s.mapStyle })
    : { svg: "", attribution: "" };
  const arrows = s.showArrows
    ? renderSegments.map((segment) => arrowSvg(segment.map((point) => {
      const [x, y] = xy(point);
      return { x, y };
    }), s.arrowSizeMm / 25.4 * s.dpi)).join("")
    : "";
  const centerLat = all.reduce((sum, point) => sum + point.lat, 0) / all.length;
  const scaleSide = s.showProfile && s.profilePosition.endsWith("left") ? "right" : "left";
  const scaleBar = s.showMap ? scaleBarSvg(w, h, margin, scale, centerLat, auxiliaryFontSize, scaleSide) : "";
  const attributionOnLeft = scaleSide === "right";
  const attributionX = attributionOnLeft ? margin.left : w - margin.right;
  const attributionAnchor = attributionOnLeft ? "start" : "end";
  const dateLines = [];
  const startTimeZone = resolveTimeZone(s.timeZone, data.flat[0]);
  const endTimeZone = resolveTimeZone(s.timeZone, data.flat.at(-1));
  if (s.showDatetime && data.startTime && data.endTime) {
    dateLines.push(`${t("Start")} ${formatGpxTime(data.startTime, startTimeZone)}  ${t("Finish")} ${formatGpxTime(data.endTime, endTimeZone)}`);
  } else if (s.showDatetime && data.startTime) {
    dateLines.push(`${t("Start")} ${formatGpxTime(data.startTime, startTimeZone)}`);
  } else if (s.showDatetime && data.endTime) {
    dateLines.push(`${t("Finish")} ${formatGpxTime(data.endTime, endTimeZone)}`);
  }
  const info = infoBlockPosition(s.metaPosition, w, h, margin, infoFs, 1 + dateLines.length);
  info.x += s.infoOffsetXMm * pxPerMm;
  info.titleY += s.infoOffsetYMm * pxPerMm;
  info.metaY += s.infoOffsetYMm * pxPerMm;
  const distanceValue = (data.totalDistance / 1000).toFixed(1);
  const metricText = `<text x="${info.x}" y="${info.metaY}" font-size="${infoFs * .42}" font-weight="700" stroke-width="${infoFs * .18}">
    ${esc(t("Distance"))} <tspan font-size="${infoFs * .66}" font-weight="800">${distanceValue}</tspan> <tspan>km</tspan>${ascentM === null ? "" : `  ${esc(t("Elevation gain"))} <tspan font-size="${infoFs * .66}" font-weight="800">${ascentM.toLocaleString("ja-JP")}</tspan> <tspan>m</tspan>`}
  </text>`;
  const dateTexts = dateLines.map((line, index) =>
    `<text x="${info.x}" y="${info.metaY + (index + 1) * infoFs * .78}" font-size="${infoFs * .42}" font-weight="700" stroke-width="${infoFs * .16}">${esc(line)}</text>`
  ).join("");

  const renderingHints = s.antialias
    ? 'shape-rendering="geometricPrecision" text-rendering="optimizeLegibility"'
    : 'shape-rendering="crispEdges" text-rendering="optimizeSpeed"';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ${renderingHints} role="img" aria-labelledby="svg-title svg-desc">
  <title id="svg-title">${esc(s.sectionTitle)} route diagram</title>
  <desc id="svg-desc">Route of ${(data.totalDistance / 1000).toFixed(1)} km with elevation profile</desc>
  <defs><filter id="map-gray"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="linear" slope=".55" intercept=".42"/><feFuncG type="linear" slope=".55" intercept=".42"/><feFuncB type="linear" slope=".55" intercept=".42"/></feComponentTransfer></filter><filter id="map-terrain"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="linear" slope=".82" intercept=".12"/><feFuncG type="linear" slope=".82" intercept=".12"/><feFuncB type="linear" slope=".82" intercept=".12"/></feComponentTransfer></filter></defs>
  <rect width="${w}" height="${h}" fill="#fff"/>
  <g id="map-background">${background.svg}</g>
  <g fill="#111" font-family="${sans}">
    <g text-anchor="${info.anchor}" paint-order="stroke" stroke="#fff">
      <text x="${info.x}" y="${info.titleY}" font-size="${infoFs}" font-weight="800" stroke-width="${infoFs * .2}">${esc(s.sectionTitle)}</text>
      ${metricText}
      ${dateTexts}
    </g>
    <g id="route-overlay"><g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="${paths}" stroke="#fff" stroke-width="${linePx * 2}"/>
      <path d="${paths}" stroke="#111" stroke-width="${linePx}"/>
      ${transportPaths ? `<path d="${transportPaths}" stroke="#fff" stroke-width="${linePx * 2}" stroke-linecap="butt"/>
      <path d="${transportPaths}" stroke="#111" stroke-width="${linePx}" stroke-linecap="butt" stroke-dasharray="${linePx} ${linePx * .73}"/>` : ""}
    </g>
    ${arrows}
    ${s.startName ? `<circle cx="${startX}" cy="${startY}" r="${Math.max(7, h * .007) * markerScale}" fill="#fff" stroke="#111" stroke-width="${Math.max(2, linePx * .45)}"/>` : ""}
    ${s.finishName ? `<circle cx="${finishX}" cy="${finishY}" r="${Math.max(7, h * .007) * markerScale}" fill="#fff" stroke="#111" stroke-width="${Math.max(2, linePx * .45)}"/>` : ""}
    ${labels.join("")}
    ${customLabelSvg}
    </g>
    ${profile}
    ${scaleBar}
    <text x="${attributionX}" y="${h - margin.bottom - attributionBottomInset}" text-anchor="${attributionAnchor}" font-size="${attributionFontSize}" fill="#333" paint-order="stroke" stroke="#fff" stroke-width="${auxiliaryFontSize * .2}">${esc(background.attribution)}</text>
  </g>
</svg>`;
}

function scaleBarSvg(w, h, margin, projectionScale, latitude, fs, side = "left") {
  const earthCircumference = 40075016.686;
  const metersPerPixel = earthCircumference * Math.cos(latitude * Math.PI / 180) / projectionScale;
  const targetMeters = metersPerPixel * w * .12;
  const magnitude = 10 ** Math.floor(Math.log10(targetMeters));
  const normalized = targetMeters / magnitude;
  const factor = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
  const distanceMeters = factor * magnitude;
  const length = distanceMeters / metersPerPixel;
  const x = side === "right" ? w - margin.right - length : margin.left;
  const y = h - margin.bottom - fs * 1.25;
  const segment = length / 2;
  const label = distanceMeters >= 1000
    ? `${Number((distanceMeters / 1000).toPrecision(3))} km`
    : `${Math.round(distanceMeters)} m`;
  const stroke = Math.max(1.5, h * .0014);
  return `<g font-family='"Hiragino Sans","Yu Gothic",sans-serif' paint-order="stroke" stroke="#fff" stroke-width="${stroke * 3}">
    <rect x="${x}" y="${y - fs * .42}" width="${segment}" height="${fs * .42}" fill="#111"/>
    <rect x="${x + segment}" y="${y - fs * .42}" width="${segment}" height="${fs * .42}" fill="#fff" stroke="#111" stroke-width="${stroke}"/>
    <line x1="${x}" y1="${y - fs * .55}" x2="${x}" y2="${y + fs * .12}" stroke="#111" stroke-width="${stroke}"/>
    <line x1="${x + segment}" y1="${y - fs * .55}" x2="${x + segment}" y2="${y + fs * .12}" stroke="#111" stroke-width="${stroke}"/>
    <line x1="${x + length}" y1="${y - fs * .55}" x2="${x + length}" y2="${y + fs * .12}" stroke="#111" stroke-width="${stroke}"/>
    <text x="${x + length / 2}" y="${y + fs * 1.05}" text-anchor="middle" stroke="#fff" stroke-width="${fs * .24}" fill="#111" font-size="${fs}">${label}</text>
  </g>`;
}

function mercator(point) {
  const lat = clamp(point.lat, -85.05112878, 85.05112878) * Math.PI / 180;
  return {
    px: (point.lon + 180) / 360,
    py: (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2
  };
}

function infoBlockPosition(position, w, h, margin, fs, lineCount) {
  const left = position.endsWith("left");
  const right = position.endsWith("right");
  const top = position.startsWith("top");
  const bottom = position.startsWith("bottom");
  const bottomMetaY = h - margin.bottom * .55 - (lineCount - 1) * fs * .78;
  const centerBlockHeight = fs * (2.12 + (lineCount - 1) * .78);
  const centerTitleY = (h - centerBlockHeight) / 2 + fs;
  const titleY = top
    ? margin.top + fs * .8
    : bottom ? bottomMetaY - fs * 1.12 : centerTitleY;
  return {
    x: left ? margin.left : right ? w - margin.right : w / 2,
    titleY,
    metaY: titleY + fs * 1.12,
    anchor: left ? "start" : right ? "end" : "middle"
  };
}

function resolveTimeZone(selection, point) {
  if (selection === "auto") {
    try {
      return point ? tzlookup(point.lat, point.lon) : "Asia/Tokyo";
    } catch {
      return "Asia/Tokyo";
    }
  }
  if (selection === "browser") return Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    new Intl.DateTimeFormat("ja-JP", { timeZone: selection }).format();
    return selection;
  } catch {
    throw new Error(t("invalidDisplayTimeZone", { zone: selection }));
  }
}

function updateTimeZoneHint(data) {
  const selection = $("time-zone").value.trim() || "auto";
  try {
    if (!data?.flat.length) {
      $("detected-time-zone").textContent = selection === "auto"
        ? t("Auto-detect (falls back to Asia/Tokyo if undetectable)")
        : t("displayTimeZone", { zone: resolveTimeZone(selection, null) });
      return;
    }
    const startTimeZone = resolveTimeZone(selection, data.flat[0]);
    const endTimeZone = resolveTimeZone(selection, data.flat.at(-1));
    $("detected-time-zone").textContent = startTimeZone === endTimeZone
      ? t("detectedTimeZone", { zone: startTimeZone })
      : t("detectedTimeZones", { start: startTimeZone, end: endTimeZone });
  } catch {
    $("detected-time-zone").textContent = t("invalidTimeZone", { zone: selection });
  }
}

function formatGpxTime(value, timeZone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23", timeZone
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.month}/${parts.day} ${Number(parts.hour)}:${parts.minute}`;
}

function positionedBox(position, w, h, margin, boxW, boxH) {
  const leftSide = position.endsWith("left");
  const rightSide = position.endsWith("right");
  const topSide = position.startsWith("top");
  const bottomSide = position.startsWith("bottom");
  const left = leftSide ? margin.left : rightSide ? w - margin.right - boxW : (w - boxW) / 2;
  const top = topSide ? margin.top : bottomSide ? h - margin.bottom - boxH : (h - boxH) / 2;
  return { left, right: left + boxW, top, bottom: top + boxH };
}

async function tileBackgroundSvg({ w, h, scale, offsetX, offsetY, japan, mapStyle = "standard" }) {
  if (mapStyle === "water" && japan) {
    const vectorBackground = await vectorWaterBackgroundSvg({ w, h, scale, offsetX, offsetY });
    if (vectorBackground) return vectorBackground;
  }
  const terrain = mapStyle === "terrain";
  const minZoom = terrain ? (japan ? 2 : 0) : (japan ? 5 : 1);
  const maxZoom = terrain ? (japan ? 16 : 17) : (japan ? 18 : 19);
  let zoom = clamp(Math.round(Math.log2(scale / 256)), minZoom, maxZoom);
  const viewMinX = (0 - offsetX) / scale;
  const viewMaxX = (w - offsetX) / scale;
  const viewMinY = (0 - offsetY) / scale;
  const viewMaxY = (h - offsetY) / scale;
  let range;
  do {
    const count = 2 ** zoom;
    range = {
      count,
      x0: Math.floor(viewMinX * count),
      x1: Math.floor(viewMaxX * count),
      y0: Math.floor(viewMinY * count),
      y1: Math.floor(viewMaxY * count)
    };
    if ((range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1) <= 64) break;
    zoom--;
  } while (zoom > minZoom);
  const { count, x0, x1, y0, y1 } = range;
  const source = terrain ? (japan ? "gsi" : "opentopomap") : (japan ? "gsi" : "osm");
  const tiles = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (ty < 0 || ty >= count) continue;
      const wrappedX = ((tx % count) + count) % count;
      const url = terrain
        ? japan
          ? `https://cyberjapandata.gsi.go.jp/xyz/hillshademap/${zoom}/${wrappedX}/${ty}.png`
          : `https://a.tile.opentopomap.org/${zoom}/${wrappedX}/${ty}.png`
        : japan
          ? `https://cyberjapandata.gsi.go.jp/xyz/pale/${zoom}/${wrappedX}/${ty}.png`
          : `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${ty}.png`;
      tiles.push({ tx, ty, url });
    }
  }
  const rendered = await Promise.all(tiles.map(async (tile) => {
    try {
      const href = mapStyle === "water"
        ? await binaryWaterTileDataUrl(tile.url)
        : await tileDataUrl(tile.url);
      const x = tile.tx / count * scale + offsetX;
      const y = tile.ty / count * scale + offsetY;
      const size = scale / count + 1;
      return `<image href="${href}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="none"/>`;
    } catch {
      return "";
    }
  }));
  const loaded = rendered.filter(Boolean);
  const attribution = source === "gsi"
    ? t("Source: GSI Tiles (Geospatial Information Authority of Japan)")
    : source === "opentopomap"
      ? "© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC BY-SA)"
      : "© OpenStreetMap contributors";
  if (!loaded.length) {
    return {
      svg: "",
      attribution: `${attribution} (failed to fetch background map)`,
      failed: true
    };
  }
  return {
    svg: mapStyle === "water"
      ? `<g opacity=".82">${loaded.join("")}</g>`
      : `<g filter="url(#${terrain ? "map-terrain" : "map-gray"})" opacity="${terrain ? ".65" : ".72"}">${loaded.join("")}</g>`,
    attribution,
    failed: false
  };
}

async function vectorWaterBackgroundSvg({ w, h, scale, offsetX, offsetY }) {
  const minZoom = 4;
  const minimumFeatureAreaPx = 24;
  const minimumWaterWidthPx = 3;
  let zoom = clamp(Math.round(Math.log2(scale / 256)) - 1, minZoom, 16);
  if (zoom <= 7) return broadWaterLandBackgroundSvg({ w, h, scale, offsetX, offsetY, resolution: zoom <= 5 ? "50m" : "10m" });
  const viewMinX = (0 - offsetX) / scale;
  const viewMaxX = (w - offsetX) / scale;
  const viewMinY = (0 - offsetY) / scale;
  const viewMaxY = (h - offsetY) / scale;
  let range;
  do {
    const count = 2 ** zoom;
    range = {
      count,
      x0: Math.floor(viewMinX * count),
      x1: Math.floor(viewMaxX * count),
      y0: Math.floor(viewMinY * count),
      y1: Math.floor(viewMaxY * count)
    };
    if ((range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1) <= 64) break;
    zoom--;
  } while (zoom > minZoom);
  if (zoom <= 7) return broadWaterLandBackgroundSvg({ w, h, scale, offsetX, offsetY, resolution: zoom <= 5 ? "50m" : "10m" });
  const { count, x0, x1, y0, y1 } = range;
  const tiles = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (ty < 0 || ty >= count) continue;
      const wrappedX = ((tx % count) + count) % count;
      tiles.push({
        tx,
        ty,
        wrappedX,
        url: `https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/${zoom}/${wrappedX}/${ty}.pbf`,
        rasterUrl: `https://cyberjapandata.gsi.go.jp/xyz/pale/${zoom}/${wrappedX}/${ty}.png`
      });
    }
  }
  let successfulTiles = 0;
  const rasterFallbackFor = async (tile) => {
    try {
      const href = await binaryWaterTileDataUrl(tile.rasterUrl);
      const x = tile.tx / count * scale + offsetX;
      const y = tile.ty / count * scale + offsetY;
      const size = scale / count + 1;
      return `<image href="${href}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}" preserveAspectRatio="none"/>`;
    } catch {
      return "";
    }
  };
  // A raster base tile with almost no distinct colors carries no real map detail — it's a
  // flat background tile (plain sea or, rarely, plain land), so trusting its water/land
  // classification for a full-tile fallback is safe. A tile with real detail (roads, labels,
  // contours near the coast) is never used this way, since its coarse classification can
  // misread land texture as water and speckle noise across otherwise clean vector-drawn land.
  const isRasterTileUniform = async (url) => {
    try {
      const source = await tileDataUrl(url);
      return await new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) { resolve(false); return; }
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          const seen = new Set();
          for (let index = 0; index < pixels.length; index += 4) {
            seen.add((pixels[index] << 16) | (pixels[index + 1] << 8) | pixels[index + 2]);
            if (seen.size > 4) { resolve(false); return; }
          }
          resolve(true);
        };
        image.onerror = () => resolve(false);
        image.src = source;
      });
    } catch {
      return false;
    }
  };
  const rendered = await Promise.all(tiles.map(async (tile) => {
    try {
      const vectorTile = await vectorTileData(tile.url);
      successfulTiles++;
      const layer = vectorTile.layers.waterarea;
      if (!layer) return { path: "", fallback: await rasterFallbackFor(tile) };
      const paths = [];
      for (let index = 0; index < layer.length; index++) {
        const feature = layer.feature(index);
        if (![5000, 55000].includes(Number(feature.properties.ftCode))) continue;
        const rings = feature.loadGeometry();
        let path = "";
        let visibleArea = 0;
        let visiblePerimeter = 0;
        let touchesTileEdge = false;
        for (const ring of rings) {
          if (ring.length < 3) continue;
          let ringArea = 0;
          if (ring.some((point) => point.x <= 1 || point.y <= 1 || point.x >= feature.extent - 1 || point.y >= feature.extent - 1)) {
            touchesTileEdge = true;
          }
          const points = ring.map((point) => ({
            x: (tile.tx + point.x / feature.extent) / count * scale + offsetX,
            y: (tile.ty + point.y / feature.extent) / count * scale + offsetY
          }));
          for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
            const current = points[pointIndex];
            const next = points[(pointIndex + 1) % points.length];
            ringArea += current.x * next.y - next.x * current.y;
            visiblePerimeter += Math.hypot(next.x - current.x, next.y - current.y);
          }
          visibleArea = Math.max(visibleArea, Math.abs(ringArea) / 2);
          path += points.map((point, pointIndex) => `${pointIndex ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join("") + "Z";
        }
        const estimatedWidth = 2 * visibleArea / Math.max(1, visiblePerimeter);
        if (path && visibleArea >= minimumFeatureAreaPx && (touchesTileEdge || estimatedWidth >= minimumWaterWidthPx)) {
          paths.push(`<path d="${path}" fill-rule="evenodd"/>`);
        }
      }
      // GSI's experimental vector water tiles thin out far offshore, where a tile can end up
      // with zero, or only a partial/gapped, water polygon even though the whole tile is open
      // sea. Fall back to a binarized raster tile whenever this tile's own base map has no real
      // detail (a flat single-color background — definitely open sea, safe to trust fully) or
      // carries no vector coverage at all. Tiles with real map detail near the coast are left
      // vector-only, since blending in the coarser raster there speckles noise across land
      // (rivers, shorelines) that the vector data already draws precisely.
      const fallback = (!paths.length || await isRasterTileUniform(tile.rasterUrl))
        ? await rasterFallbackFor(tile)
        : "";
      return { path: paths.join(""), fallback };
    } catch (error) {
      if (!String(error.message).includes("404")) return { path: "", fallback: await rasterFallbackFor(tile) };
      const fallback = await rasterFallbackFor(tile);
      if (fallback) return { path: "", fallback };
      const x = tile.tx / count * scale + offsetX;
      const y = tile.ty / count * scale + offsetY;
      const size = scale / count + 1;
      return {
        path: "",
        fallback: `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}" fill="#cacaca"/>`
      };
    }
  }));
  const paths = rendered.map((item) => item.path).filter(Boolean).join("");
  const fallback = rendered.map((item) => item.fallback).filter(Boolean).join("");
  if (!successfulTiles && !fallback) return null;
  return {
    svg: `${fallback}${paths ? `<g fill="#cacaca" stroke="#cacaca" stroke-width=".6" stroke-linejoin="round">${paths}</g>` : ""}`,
    attribution: t("Source: GSI Vector Tiles (Geospatial Information Authority of Japan)"),
    failed: false
  };
}

async function broadWaterLandBackgroundSvg({ w, h, scale, offsetX, offsetY, resolution }) {
  const cacheKey = [resolution, w, h, scale, offsetX, offsetY]
    .map((value) => typeof value === "number" ? value.toFixed(3) : value)
    .join(":");
  if (broadWaterBackgroundCache.has(cacheKey)) return broadWaterBackgroundCache.get(cacheKey);
  const rendering = renderBroadWaterLandBackgroundSvg({ w, h, scale, offsetX, offsetY, resolution });
  broadWaterBackgroundCache.set(cacheKey, rendering);
  while (broadWaterBackgroundCache.size > 3) {
    broadWaterBackgroundCache.delete(broadWaterBackgroundCache.keys().next().value);
  }
  try {
    return await rendering;
  } catch (error) {
    broadWaterBackgroundCache.delete(cacheKey);
    throw error;
  }
}

async function renderBroadWaterLandBackgroundSvg({ w, h, scale, offsetX, offsetY, resolution }) {
  worldLandPromise ||= {};
  worldLandPromise[resolution] ||= Promise.all([
    import("topojson-client"),
    resolution === "50m"
      ? import("world-atlas/land-50m.json")
      : import("world-atlas/land-10m.json")
  ]).then(([{ feature }, { default: topology }]) => {
    const land = feature(topology, topology.objects.land);
    return land.type === "FeatureCollection" ? land.features[0] : land;
  });
  const land = await worldLandPromise[resolution];
  if (resolution === "50m") {
    const pathCacheKey = scale.toFixed(3);
    let path = broadLandPathCache.get(pathCacheKey);
    if (!path) {
      const commands = [];
      const polygons = land.geometry.type === "MultiPolygon"
        ? land.geometry.coordinates
        : [land.geometry.coordinates];
      for (const polygon of polygons) {
        for (const ring of polygon) {
          let previousX = NaN;
          let previousY = NaN;
          let previousLon = NaN;
          let started = false;
          for (let index = 0; index < ring.length; index++) {
            const [lon, lat] = ring[index];
            const projected = mercator({ lon, lat });
            const x = projected.px * scale;
            const y = projected.py * scale;
            const antimeridianJump = started && Math.abs(lon - previousLon) > 180;
            if (!started || antimeridianJump) {
              if (started) commands.push("Z");
              commands.push(`M${x.toFixed(1)},${y.toFixed(1)}`);
              started = true;
            } else if (index === ring.length - 1 || Math.hypot(x - previousX, y - previousY) >= .35) {
              commands.push(`L${x.toFixed(1)},${y.toFixed(1)}`);
            } else {
              continue;
            }
            previousX = x;
            previousY = y;
            previousLon = lon;
          }
          commands.push("Z");
        }
      }
      path = commands.join("");
      broadLandPathCache.set(pathCacheKey, path);
      while (broadLandPathCache.size > 3) {
        broadLandPathCache.delete(broadLandPathCache.keys().next().value);
      }
    }
    return {
      svg: `<rect width="${w}" height="${h}" fill="#cacaca"/><path id="broad-land" d="${path}" data-offset-x="${offsetX.toFixed(3)}" data-offset-y="${offsetY.toFixed(3)}" transform="translate(${offsetX.toFixed(3)} ${offsetY.toFixed(3)})" fill="#fff" fill-rule="evenodd"/>`,
      attribution: t("Source: Natural Earth"),
      failed: false
    };
  }
  const maxRenderSize = resolution === "50m" ? 2048 : 4096;
  const renderScale = Math.min(1, maxRenderSize / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * renderScale));
  canvas.height = Math.max(1, Math.round(h * renderScale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to render wide-area water map.");
  context.fillStyle = "#cacaca";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.beginPath();
  const polygons = land.geometry.type === "MultiPolygon"
    ? land.geometry.coordinates
    : [land.geometry.coordinates];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      let previousX = NaN;
      let previousY = NaN;
      let previousLon = NaN;
      let started = false;
      for (let index = 0; index < ring.length; index++) {
        const [lon, lat] = ring[index];
        const projected = mercator({ lon, lat });
        const x = (projected.px * scale + offsetX) * renderScale;
        const y = (projected.py * scale + offsetY) * renderScale;
        const antimeridianJump = started && Math.abs(lon - previousLon) > 180;
        if (!started || antimeridianJump) {
          if (started) context.closePath();
          context.moveTo(x, y);
          started = true;
        } else if (index === ring.length - 1 || Math.hypot(x - previousX, y - previousY) >= .35) {
          context.lineTo(x, y);
        } else {
          continue;
        }
        previousX = x;
        previousY = y;
        previousLon = lon;
      }
      context.closePath();
    }
  }
  context.fillStyle = "#fff";
  context.fill("evenodd");
  const image = canvas.toDataURL("image/png");
  return {
    svg: `<image href="${image}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none"/>`,
    attribution: t("Source: Natural Earth"),
    failed: false
  };
}

async function vectorTileData(url) {
  const cacheKey = `vector:${url}`;
  if (tileCache.has(cacheKey)) return tileCache.get(cacheKey);
  const promise = fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(`Vector map tile ${response.status}`);
    return new VectorTile(new PbfReader(new Uint8Array(await response.arrayBuffer())));
  });
  tileCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    tileCache.delete(cacheKey);
    throw error;
  }
}

async function binaryWaterTileDataUrl(url) {
  const cacheKey = `water:${url}`;
  if (tileCache.has(cacheKey)) return tileCache.get(cacheKey);
  const promise = tileDataUrl(url).then((source) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        reject(new Error("Unable to process map tile."));
        return;
      }
      context.drawImage(image, 0, 0);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;
      let waterMask = new Uint8Array(canvas.width * canvas.height);
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const isWater = pixels[index + 3] > 0
          && blue >= 145
          && blue > red * 1.035
          && blue > green * 1.012;
        waterMask[index / 4] = isWater ? 1 : 0;
      }
      // Close small holes left by labels drawn over water, then open the mask
      // to discard narrow rivers, straits, and inlets while retaining broad water.
      waterMask = morphWaterMask(morphWaterMask(waterMask, canvas.width, canvas.height, 2, true), canvas.width, canvas.height, 2, false);
      waterMask = morphWaterMask(morphWaterMask(waterMask, canvas.width, canvas.height, 1, false), canvas.width, canvas.height, 1, true);
      waterMask = removeSmallWaterComponents(waterMask, canvas.width, canvas.height, 512);
      for (let index = 0; index < pixels.length; index += 4) {
        const value = waterMask[index / 4] ? 205 : 255;
        pixels[index] = value;
        pixels[index + 1] = value;
        pixels[index + 2] = value;
        pixels[index + 3] = 255;
      }
      context.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = reject;
    image.src = source;
  }));
  tileCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    tileCache.delete(cacheKey);
    throw error;
  }
}

function morphWaterMask(mask, width, height, radius, dilate) {
  const horizontal = new Uint8Array(mask.length);
  const output = new Uint8Array(mask.length);
  const target = dilate ? 1 : 0;
  const fallback = dilate ? 0 : 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let value = fallback;
      for (let offset = -radius; offset <= radius; offset++) {
        const sampleX = Math.min(width - 1, Math.max(0, x + offset));
        if (mask[row + sampleX] === target) {
          value = target;
          break;
        }
      }
      horizontal[row + x] = value;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = fallback;
      for (let offset = -radius; offset <= radius; offset++) {
        const sampleY = Math.min(height - 1, Math.max(0, y + offset));
        if (horizontal[sampleY * width + x] === target) {
          value = target;
          break;
        }
      }
      output[y * width + x] = value;
    }
  }
  return output;
}

function removeSmallWaterComponents(mask, width, height, minimumPixels) {
  const output = mask.slice();
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const above = index - width;
      const below = index + width;
      const left = index - 1;
      const right = index + 1;
      if (above >= 0 && mask[above] && !visited[above]) { visited[above] = 1; queue[tail++] = above; }
      if (below < mask.length && mask[below] && !visited[below]) { visited[below] = 1; queue[tail++] = below; }
      if (x > 0 && mask[left] && !visited[left]) { visited[left] = 1; queue[tail++] = left; }
      if (x < width - 1 && mask[right] && !visited[right]) { visited[right] = 1; queue[tail++] = right; }
    }
    if (tail < minimumPixels) {
      for (let index = 0; index < tail; index++) output[queue[index]] = 0;
    }
  }
  return output;
}

async function tileDataUrl(url) {
  if (tileCache.has(url)) return tileCache.get(url);
  const promise = fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(`Map tile ${response.status}`);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  });
  tileCache.set(url, promise);
  try {
    return await promise;
  } catch (error) {
    tileCache.delete(url);
    throw error;
  }
}

function arrowSvg(points, size) {
  if (points.length < 5) return "";
  const targets = [0.22, 0.48, 0.74];
  return targets.map((ratio) => {
    const i = clamp(Math.floor((points.length - 2) * ratio), 1, points.length - 2);
    const a = points[i - 1], b = points[i + 1];
    const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    const x = points[i].x, y = points[i].y;
    return `<g transform="translate(${x} ${y}) rotate(${angle})">
      <path d="M${-size * .7},${-size * .72} L${size * .65},0 L${-size * .7},${size * .72} Z" fill="#111" stroke="#fff" stroke-width="${size * .24}" paint-order="stroke"/>
    </g>`;
  }).join("");
}

function pointLabel(x, y, name, ele, position, w, h, fs, elevationFs) {
  const left = position === "left" || position.endsWith("-left");
  const right = position === "right" || position.endsWith("-right");
  const top = position === "top" || position.startsWith("top-");
  const bottom = position === "bottom" || position.startsWith("bottom-");
  const diagonalScale = position.includes("-") ? Math.SQRT1_2 : 1;
  const anchor = left ? "end" : right ? "start" : "middle";
  const dx = (left ? -fs * .65 : right ? fs * .65 : 0) * diagonalScale;
  const elevation = Number.isFinite(ele) ? `${Math.round(ele).toLocaleString("ja-JP")} m` : "";
  const verticalOffset = top
    ? elevation ? -elevationFs * 2.25 : -fs * .65
    : bottom ? fs * 1.35
    : elevation && (position === "left" || position === "right") ? -elevationFs * .625
    : position === "left" || position === "right" ? fs * .35
    : 0;
  const dy = (top || bottom) ? verticalOffset * diagonalScale : verticalOffset;
  const safeX = clamp(x + dx, w * .04, w * .96);
  const safeY = clamp(y + dy, h * .08, h * .91);
  return `<g font-family='"Hiragino Sans","Yu Gothic",sans-serif' text-anchor="${anchor}">
    <text x="${safeX}" y="${safeY}" font-size="${fs}" font-weight="600" paint-order="stroke" stroke="#fff" stroke-width="${fs * .28}">${esc(name)}</text>
    ${elevation ? `<text x="${safeX}" y="${safeY + elevationFs * 1.25}" font-size="${elevationFs}" fill="#555" paint-order="stroke" stroke="#fff" stroke-width="${elevationFs * .3}">${elevation}</text>` : ""}
  </g>`;
}

function profileSvg(data, s, left, right, top, bottom, fs, annotationFontSize, customLabels = []) {
  const allElevationPoints = data.flat.filter((p) => Number.isFinite(p.ele));
  if (allElevationPoints.length < 2) return "";
  const profileLabels = customLabels.filter(({ label }) => label.showOnProfile);
  const annotationMeasure = document.createElement("canvas").getContext("2d");
  annotationMeasure.font = `600 ${annotationFontSize}px "Hiragino Sans","Yu Gothic",sans-serif`;
  const preparedAnnotations = profileLabels.map(({ label, point }) => {
    let routePoint = point;
    if (!Number.isFinite(routePoint.distance) || !Number.isFinite(routePoint.ele)) {
      routePoint = allElevationPoints.reduce((nearest, candidate) =>
        !nearest || haversine(candidate, point) < haversine(nearest, point) ? candidate : nearest, null);
    }
    if (!routePoint || !Number.isFinite(routePoint.distance) || !Number.isFinite(routePoint.ele)) return null;
    const elevationLabel = Math.round(routePoint.ele).toLocaleString("ja-JP");
    const annotationText = s.showProfileElevation ? `${elevationLabel}m${label.name}` : label.name;
    const advance = annotationMeasure.measureText(annotationText).width
      + (s.showProfileElevation ? annotationFontSize * .62 : 0);
    return { label, routePoint, elevationLabel, advance };
  }).filter(Boolean);
  const maxAnnotationAdvance = Math.max(1, ...preparedAnnotations.map(({ advance }) => advance));
  const annotationInset = fs * 1.08;
  const annotationBandHeight = preparedAnnotations.length
    ? maxAnnotationAdvance + annotationInset
    : fs * .75;
  const plotTop = top + annotationBandHeight;
  const points = sampled(allElevationPoints, Math.max(500, Math.min(2400, Math.round(right - left))));
  const elevationExtent = extent(allElevationPoints, (point) => point.ele);
  const dataMin = elevationExtent.min;
  const dataMax = elevationExtent.max;
  const low = Math.max(0, Math.floor(dataMin / 100) * 100);
  const roundedHigh = Math.max(low + 100, Math.ceil(dataMax / 100) * 100);
  const elevationStep = Math.max(100, Math.ceil((roundedHigh - low) / 3 / 100) * 100);
  const elevationTickCount = Math.max(1, Math.ceil((roundedHigh - low) / elevationStep));
  const high = low + elevationStep * elevationTickCount;
  const profileStartDistance = data.profileStartDistance || 0;
  const profileTotalDistance = data.profileTotalDistance || data.totalDistance;
  const distanceKm = profileTotalDistance / 1000;
  const distanceStep = Math.max(10, Math.floor(distanceKm / 4 / 10) * 10);
  const x = (p) => {
    const profileDistance = p.profileDistance ?? p.distance;
    return left + ((profileDistance - profileStartDistance) / profileTotalDistance) * (right - left);
  };
  const y = (p) => bottom - clamp((p.ele - low) / (high - low), 0, 1) * (bottom - plotTop);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p).toFixed(2)},${y(p).toFixed(2)}`).join(" ");
  const area = `${path} L${x(points.at(-1))},${bottom} L${x(points[0])},${bottom} Z`;
  const xTickCount = Math.floor(distanceKm / distanceStep + 1e-9);
  const xTicks = Array.from({ length: xTickCount + 1 }, (_, index) => {
    const tickDistance = index * distanceStep;
    const ratio = tickDistance / distanceKm;
    const tx = left + ratio * (right - left);
    const anchor = index === 0 ? "start" : ratio >= .999 ? "end" : "middle";
    return `<line x1="${tx}" y1="${bottom}" x2="${tx}" y2="${bottom + fs * .45}" stroke="#777"/>
      <text x="${tx}" y="${bottom + fs * 1.5}" text-anchor="${anchor}" font-size="${fs * .8}" fill="#666">${tickDistance} km</text>`;
  }).join("");
  const yTicks = Array.from({ length: elevationTickCount + 1 }, (_, index) => {
    const value = low + index * elevationStep;
    const ty = bottom - index / elevationTickCount * (bottom - plotTop);
    return `<line x1="${left - fs * .35}" y1="${ty}" x2="${right}" y2="${ty}" stroke="#bbb" stroke-width="${Math.max(1, s.height * .0006)}"/>
      <text x="${left - fs * .5}" y="${ty + fs * .28}" text-anchor="end" font-size="${fs * .78}" fill="#555">${value} m</text>`;
  }).join("");
  const annotations = preparedAnnotations.map(({ label, routePoint, elevationLabel }) => {
    const px = x(routePoint);
    const py = y(routePoint);
    const textX = clamp(px, left + annotationFontSize * .25, right - annotationFontSize * .25);
    const textY = plotTop - fs * .35;
    return `<g>
      <line x1="${px}" y1="${plotTop}" x2="${px}" y2="${py}" stroke="#777" stroke-width="${Math.max(1, s.height * .00065)}" stroke-dasharray="${fs * .22} ${fs * .22}"/>
      <circle cx="${px}" cy="${py}" r="${Math.max(2.2, fs * .16)}" fill="#111" stroke="#fff" stroke-width="${Math.max(1, fs * .1)}"/>
      <text x="${textX}" y="${textY}" transform="rotate(-90 ${textX} ${textY})" text-anchor="start" dominant-baseline="middle" font-size="${annotationFontSize}" font-weight="600" fill="#111" paint-order="stroke" stroke="#fff" stroke-width="${annotationFontSize * .3}">${s.showProfileElevation ? `${esc(elevationLabel)}<tspan dx=".12em">m</tspan><tspan dx=".5em">${esc(label.name)}</tspan>` : esc(label.name)}</text>
    </g>`;
  }).join("");
  const backgroundLeft = Math.max(0, left - fs * 4.5);
  const backgroundRight = right + fs;
  return `<g font-family='"Hiragino Sans","Yu Gothic",sans-serif'>
    <rect x="${backgroundLeft}" y="${top}" width="${backgroundRight - backgroundLeft}" height="${bottom - top + fs * 2}" fill="#fff" fill-opacity=".86"/>
    <path d="${area}" fill="#ededeb"/>
    ${yTicks}
    <path d="${path}" fill="none" stroke="#111" stroke-width="${Math.max(1, s.profileWidthMm / 25.4 * s.dpi)}"/>
    ${annotations}
    <line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="#999"/>
    ${xTicks}
  </g>`;
}

async function update() {
  const version = ++renderVersion;
  const s = state();
  $("size-summary").value = `${s.width.toLocaleString()} × ${s.height.toLocaleString()} px\n${s.widthMm.toFixed(1)} × ${s.heightMm.toFixed(1)} mm（${s.dpi} DPI）`;
  if (!routeData) return;
  try {
    setPreviewLoading("Generating preview…");
    setStatus("Generating route…");
    const previewData = previewRouteData(routeData);
    if (s.showMap) {
      const provisionalSvg = await generateSvg(routeData, { ...s, showMap: false }, previewData);
      if (version !== renderVersion) return;
      currentSvg = provisionalSvg;
      $("preview").innerHTML = currentSvg;
      $("empty-preview").hidden = true;
      $("download-png").disabled = false;
      $("download-svg").disabled = false;
      setPreviewLoading("Loading background map…");
      setStatus("Route displayed. Loading background map…");
    }
    const svg = await generateSvg(routeData, s, previewData);
    if (version !== renderVersion) return;
    currentSvg = svg;
    $("preview").innerHTML = currentSvg;
    renderedState = s;
    $("empty-preview").hidden = true;
    $("download-png").disabled = false;
    $("download-svg").disabled = false;
    setPreviewLoading();
    const missingElevation = routeData.flat.every((p) => !Number.isFinite(p.ele));
    const excludedTransportCount = routeData.transportLinks?.length || 0;
    const excludedTransportText = excludedTransportCount
      ? t("excludedTransport", { count: excludedTransportCount.toLocaleString() })
      : "";
    setStatus(missingElevation
      ? "Route generated. No elevation data, so the elevation profile is omitted."
      : t("routeGenerated", {
        points: routeData.flat.length.toLocaleString(),
        segments: routeData.segments.length,
        excluded: excludedTransportText
      }));
  } catch (error) {
    if (version !== renderVersion) return;
    setPreviewLoading();
    setStatus(error.message, true);
    $("download-png").disabled = true;
    $("download-svg").disabled = true;
  }
}

async function updateEndpointNames(sourceData) {
  const first = sourceData.flat[0];
  const last = sourceData.flat[sourceData.flat.length - 1];
  if (!first || !last) return;
  const startName = await reverseGeocodePlaceName(first.lat, first.lon);
  if (sourceRouteData !== sourceData) return;
  if (startName) $("start-name").value = startName;
  const finishName = await reverseGeocodePlaceName(last.lat, last.lon);
  if (sourceRouteData !== sourceData) return;
  if (finishName) $("finish-name").value = finishName;
  if (startName || finishName) await update();
}

async function loadGpxFiles(files) {
  try {
    const selectedFiles = [...files];
    if (!selectedFiles.length) return;
    setPreviewLoading("Reading GPX file…");
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const parsedItems = await Promise.all(selectedFiles.map(async (file, index) => ({
      file,
      index,
      data: parseGpx(await file.text())
    })));
    sourceRouteData = combineRouteData(parsedItems);
    routeData = sourceRouteData;
    setCustomLabels(sourceRouteData.waypoints.map((point) => ({
      name: point.name,
      mode: "coordinate",
      lat: point.lat,
      lon: point.lon,
      position: "top",
      showOnProfile: false
    })));
    if (sourceRouteData.name) $("section-title").value = sourceRouteData.name;
    $("clip-mode").value = "all";
    $("clip-distance-start").value = "0";
    $("clip-distance-end").value = (sourceRouteData.totalDistance / 1000).toFixed(1);
    $("clip-time-start").value = toDatetimeLocal(sourceRouteData.startTime);
    $("clip-time-end").value = toDatetimeLocal(sourceRouteData.endTime);
    const timeOption = $("clip-mode").querySelector('option[value="time"]');
    timeOption.disabled = !sourceRouteData.startTime || !sourceRouteData.endTime;
    timeOption.textContent = t(timeOption.disabled ? "Time (no time data)" : "Time");
    $("clip-distance-fields").hidden = true;
    $("clip-time-fields").hidden = true;
    $("file-name").textContent = sourceRouteData.fileNames.length === 1
      ? sourceRouteData.fileNames[0]
      : t("filesSelected", {
        count: sourceRouteData.fileNames.length,
        names: sourceRouteData.fileNames.join(" → ")
      });
    updateTimeZoneHint(sourceRouteData);
    await update();
    updateEndpointNames(sourceRouteData);
  } catch (error) {
    routeData = null;
    sourceRouteData = null;
    setPreviewLoading();
    setStatus(error.message, true);
  }
}

function setPreviewLoading(message = "") {
  const loading = $("preview-loading");
  clearTimeout(previewLoadingTimer);
  if (message) {
    if (loading.hidden) previewLoadingSince = performance.now();
    loading.hidden = false;
    $("preview-loading-text").textContent = t(message);
    $("preview-shell").setAttribute("aria-busy", "true");
    return;
  }
  const hide = () => {
    loading.hidden = true;
    $("preview-loading-text").textContent = "";
    $("preview-shell").setAttribute("aria-busy", "false");
  };
  const remaining = 500 - (performance.now() - previewLoadingSince);
  if (remaining > 0) previewLoadingTimer = setTimeout(hide, remaining);
  else hide();
}

function setStatus(message, error = false) {
  $("status").textContent = t(message);
  $("status").classList.toggle("error", error);
}

function filename(s, extension) {
  const safeTitle = s.sectionTitle.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40) || "Route";
  return `${safeTitle}_${s.width}x${s.height}_${s.dpi}dpi.${extension}`;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function rasterizeSvg(svg, width, height, contextOptions = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", contextOptions);
  if (!ctx) throw new Error("Failed to create a canvas for image conversion.");
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    ctx.drawImage(image, 0, 0, width, height);
    return { canvas, ctx };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function textMask(svg, width, height, includeStroke) {
  const xml = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (xml.querySelector("parsererror")) throw new Error("Failed to parse the SVG used for the text mask.");
  const keep = new Set(["svg", "g", "text", "tspan"]);
  [...xml.querySelectorAll("*")].reverse().forEach((element) => {
    if (!keep.has(element.localName)) element.remove();
  });
  xml.querySelectorAll("g").forEach((group) => {
    group.removeAttribute("filter");
    group.setAttribute("fill", "#000");
    group.setAttribute("stroke", "#000");
  });
  xml.querySelectorAll("text, tspan").forEach((text) => {
    text.setAttribute("fill", "#000");
    text.setAttribute("stroke", includeStroke ? "#000" : "none");
    text.removeAttribute("paint-order");
  });
  const maskSvg = new XMLSerializer().serializeToString(xml.documentElement);
  const { ctx } = await rasterizeSvg(maskSvg, width, height, {
    alpha: true,
    willReadFrequently: true
  });
  return ctx.getImageData(0, 0, width, height).data;
}

async function svgToGrayscalePng(svg, width, height, dpi, antialias = true) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!ctx) throw new Error("Failed to create a canvas for image conversion.");
  ctx.imageSmoothingEnabled = antialias;
  if (antialias && "imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  let rendered = false;
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    image.src = svgUrl;
    await image.decode();
    ctx.drawImage(image, 0, 0, width, height);
    rendered = true;
  } catch {
    rendered = false;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
  if (!rendered) {
    try {
      const xml = new DOMParser().parseFromString(svg, "image/svg+xml");
      xml.querySelectorAll("text").forEach((text) => {
        text.setAttribute("stroke", "none");
        if (!text.hasAttribute("fill")) text.setAttribute("fill", "#111");
        text.removeAttribute("paint-order");
      });
      const fallbackSvg = new XMLSerializer().serializeToString(xml.documentElement);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      const renderer = Canvg.fromString(ctx, fallbackSvg, {
        ignoreAnimation: true,
        ignoreMouse: true,
        ignoreDimensions: true
      });
      await renderer.render();
    } catch (error) {
      throw new Error(t("svgConversionFailed", { message: error.message }));
    }
  }
  try {
    const imageData = ctx.getImageData(0, 0, width, height);
    const rgba = imageData.data;
    if (!antialias) {
      const [textCoverage, textFill] = await Promise.all([
        textMask(svg, width, height, true),
        textMask(svg, width, height, false)
      ]);
      for (let i = 0; i < rgba.length; i += 4) {
        if (textCoverage[i + 3] > 0) {
          rgba[i] = 255;
          rgba[i + 1] = 255;
          rgba[i + 2] = 255;
        }
        if (textFill[i + 3] >= 128) {
          rgba[i] = 17;
          rgba[i + 1] = 17;
          rgba[i + 2] = 17;
        }
      }
    }
    const raw = new Uint8Array((width + 1) * height);
    for (let y = 0; y < height; y++) {
      const row = y * (width + 1);
      raw[row] = 0;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        raw[row + 1 + x] = Math.round(rgba[i] * .2126 + rgba[i + 1] * .7152 + rgba[i + 2] * .0722);
      }
    }
    if (!("CompressionStream" in window)) throw new Error("This browser does not support grayscale PNG compression. Please use SVG instead.");
    const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    const ppm = Math.round(dpi / .0254);
    return new Blob([pngSignature(), pngChunk("IHDR", ihdr(width, height)), pngChunk("pHYs", phys(ppm)), pngChunk("IDAT", compressed), pngChunk("IEND", new Uint8Array())], { type: "image/png" });
  } catch (error) {
    if (error.message?.includes("does not support")) throw error;
    throw new Error(t("pngGenerationFailed", { message: error.message }));
  }
}

const be32 = (value) => new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
const pngSignature = () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
function ihdr(w, h) {
  return concat(be32(w), be32(h), new Uint8Array([8, 0, 0, 0, 0]));
}
function phys(ppm) {
  return concat(be32(ppm), be32(ppm), new Uint8Array([1]));
}
function concat(...arrays) {
  const result = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  arrays.forEach((a) => { result.set(a, offset); offset += a.length; });
  return result;
}
function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const body = concat(typeBytes, data);
  return concat(be32(data.length), body, be32(crc32(body)));
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

$("gpx-file").addEventListener("change", (event) => loadGpxFiles(event.target.files));
const gpxDropZone = $("gpx-drop-zone");
const gpxDropLabel = $("gpx-drop-label");
const defaultGpxDropLabel = gpxDropLabel.textContent;
let gpxDragDepth = 0;

function setGpxDragover(active) {
  gpxDropZone.classList.toggle("is-dragover", active);
  gpxDropLabel.textContent = active ? t("Drop GPX file(s) here") : defaultGpxDropLabel;
}

gpxDropZone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  gpxDragDepth += 1;
  setGpxDragover(true);
});
gpxDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});
gpxDropZone.addEventListener("dragleave", () => {
  gpxDragDepth = Math.max(0, gpxDragDepth - 1);
  if (!gpxDragDepth) setGpxDragover(false);
});
gpxDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  gpxDragDepth = 0;
  setGpxDragover(false);
  const files = [...event.dataTransfer.files];
  if (!files.length) return;
  const gpxFiles = files.filter((file) => file.name.toLowerCase().endsWith(".gpx"));
  if (gpxFiles.length !== files.length) {
    setStatus("Only .gpx files can be dropped here.", true);
    return;
  }
  loadGpxFiles(gpxFiles);
});
async function loadSample() {
  try {
    const response = await fetch("sample.gpx");
    if (!response.ok) throw new Error();
    const blob = await response.blob();
    await loadGpxFiles([new File([blob], "sample.gpx", { type: "application/gpx+xml" })]);
  } catch {
    setStatus("To load the bundled sample, please open this via a local server.", true);
  }
}
$("load-sample").addEventListener("click", loadSample);

const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".heic", ".heif"];
const PHOTO_MIME_TYPES = ["image/jpeg", "image/heic", "image/heif"];

function isPhotoFile(file) {
  const name = file.name.toLowerCase();
  return PHOTO_EXTENSIONS.some((extension) => name.endsWith(extension)) || PHOTO_MIME_TYPES.includes(file.type);
}

function readIsoBmffBoxes(view, start, end) {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset, false);
    const type = String.fromCharCode(
      view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7)
    );
    let headerSize = 8;
    if (size === 1) {
      const high = view.getUint32(offset + 8, false);
      const low = view.getUint32(offset + 12, false);
      size = high * 4294967296 + low;
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize) break;
    boxes.push({ type, bodyStart: offset + headerSize, bodyEnd: offset + size });
    offset += size;
  }
  return boxes;
}

function findExifTiffStartInHeic(view) {
  if (view.byteLength < 12) return null;
  const ftypType = String.fromCharCode(view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7));
  if (ftypType !== "ftyp") return null;
  const metaBox = readIsoBmffBoxes(view, 0, view.byteLength).find((box) => box.type === "meta");
  if (!metaBox) return null;
  const metaChildren = readIsoBmffBoxes(view, metaBox.bodyStart + 4, metaBox.bodyEnd);
  const iinfBox = metaChildren.find((box) => box.type === "iinf");
  const ilocBox = metaChildren.find((box) => box.type === "iloc");
  if (!iinfBox || !ilocBox) return null;

  const iinfVersion = view.getUint8(iinfBox.bodyStart);
  const iinfOffset = iinfBox.bodyStart + 4 + (iinfVersion === 0 ? 2 : 4);
  let exifItemId = null;
  for (const infe of readIsoBmffBoxes(view, iinfOffset, iinfBox.bodyEnd)) {
    if (infe.type !== "infe") continue;
    const infeVersion = view.getUint8(infe.bodyStart);
    let p = infe.bodyStart + 4;
    let itemId;
    if (infeVersion === 2) { itemId = view.getUint16(p, false); p += 4; }
    else if (infeVersion === 3) { itemId = view.getUint32(p, false); p += 6; }
    else continue;
    const itemType = String.fromCharCode(
      view.getUint8(p), view.getUint8(p + 1), view.getUint8(p + 2), view.getUint8(p + 3)
    );
    if (itemType === "Exif") { exifItemId = itemId; break; }
  }
  if (exifItemId === null) return null;

  const ilocVersion = view.getUint8(ilocBox.bodyStart);
  let p = ilocBox.bodyStart + 4;
  const sizesByte1 = view.getUint8(p); p += 1;
  const offsetSize = sizesByte1 >> 4;
  const lengthSize = sizesByte1 & 0xf;
  const sizesByte2 = view.getUint8(p); p += 1;
  const baseOffsetSize = sizesByte2 >> 4;
  const indexSize = ilocVersion === 1 || ilocVersion === 2 ? (sizesByte2 & 0xf) : 0;
  const itemCount = ilocVersion < 2 ? view.getUint16(p, false) : view.getUint32(p, false);
  p += ilocVersion < 2 ? 2 : 4;
  const readField = (size) => {
    if (size === 4) { const value = view.getUint32(p, false); p += 4; return value; }
    if (size === 8) {
      const high = view.getUint32(p, false);
      const low = view.getUint32(p + 4, false);
      p += 8;
      return high * 4294967296 + low;
    }
    return 0;
  };
  for (let i = 0; i < itemCount; i++) {
    const itemId = ilocVersion < 2 ? view.getUint16(p, false) : view.getUint32(p, false);
    p += ilocVersion < 2 ? 2 : 4;
    if (ilocVersion === 1 || ilocVersion === 2) p += 2;
    p += 2;
    const baseOffset = readField(baseOffsetSize);
    const extentCount = view.getUint16(p, false); p += 2;
    let firstExtentOffset = null;
    for (let extentIndex = 0; extentIndex < extentCount; extentIndex++) {
      if (indexSize > 0) p += indexSize;
      const extentOffset = readField(offsetSize);
      const extentLength = readField(lengthSize);
      if (extentIndex === 0) firstExtentOffset = extentOffset;
      void extentLength;
    }
    if (itemId === exifItemId) {
      const absoluteOffset = baseOffset + firstExtentOffset;
      const exifTiffHeaderOffset = view.getUint32(absoluteOffset, false);
      return absoluteOffset + 4 + exifTiffHeaderOffset;
    }
  }
  return null;
}

function findExifTiffStartInJpeg(view) {
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset, false);
    if ((marker & 0xff00) !== 0xff00) break;
    if (marker === 0xffd9 || marker === 0xffda) break;
    const segmentLength = view.getUint16(offset + 2, false);
    if (marker === 0xffe1 && offset + 10 <= view.byteLength) {
      const header = String.fromCharCode(
        view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6),
        view.getUint8(offset + 7), view.getUint8(offset + 8)
      );
      if (header === "Exif\0" && view.getUint8(offset + 9) === 0) return offset + 10;
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function readExifIfds(view, tiffStart) {
  const empty = { lat: null, lon: null, title: "" };
  const byteOrderMark = view.getUint16(tiffStart, false);
  if (byteOrderMark !== 0x4949 && byteOrderMark !== 0x4d4d) return empty;
  const little = byteOrderMark === 0x4949;
  if (view.getUint16(tiffStart + 2, little) !== 42) return empty;
  const ifd0Offset = view.getUint32(tiffStart + 4, little);

  const typeSize = (type) => ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] || 1);

  const readIfd = (offset) => {
    const count = view.getUint16(offset, little);
    const entries = [];
    for (let i = 0; i < count; i++) {
      const entryOffset = offset + 2 + i * 12;
      entries.push({
        tag: view.getUint16(entryOffset, little),
        type: view.getUint16(entryOffset + 2, little),
        numValues: view.getUint32(entryOffset + 4, little),
        valueOffset: entryOffset + 8
      });
    }
    return entries;
  };

  const readValue = (entry) => {
    const size = typeSize(entry.type) * entry.numValues;
    const dataOffset = size > 4 ? tiffStart + view.getUint32(entry.valueOffset, little) : entry.valueOffset;
    switch (entry.type) {
      case 2: {
        let str = "";
        for (let i = 0; i < entry.numValues; i++) {
          const code = view.getUint8(dataOffset + i);
          if (code === 0) break;
          str += String.fromCharCode(code);
        }
        return str;
      }
      case 1:
        return Array.from({ length: entry.numValues }, (_, i) => view.getUint8(dataOffset + i));
      case 3:
        return Array.from({ length: entry.numValues }, (_, i) => view.getUint16(dataOffset + i * 2, little));
      case 4:
        return Array.from({ length: entry.numValues }, (_, i) => view.getUint32(dataOffset + i * 4, little));
      case 5:
        return Array.from({ length: entry.numValues }, (_, i) => {
          const num = view.getUint32(dataOffset + i * 8, little);
          const den = view.getUint32(dataOffset + i * 8 + 4, little);
          return den ? num / den : 0;
        });
      default:
        return null;
    }
  };

  const ifd0 = readIfd(tiffStart + ifd0Offset);
  const findEntry = (entries, tag) => entries.find((entry) => entry.tag === tag);

  const imageDescriptionEntry = findEntry(ifd0, 0x010e);
  const imageDescription = imageDescriptionEntry ? String(readValue(imageDescriptionEntry)).trim() : "";

  const xpTitleEntry = findEntry(ifd0, 0x9c9b);
  let xpTitle = "";
  if (xpTitleEntry) {
    const bytes = readValue(xpTitleEntry);
    const codeUnits = [];
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const code = bytes[i] | (bytes[i + 1] << 8);
      if (code === 0) break;
      codeUnits.push(code);
    }
    xpTitle = String.fromCharCode(...codeUnits).trim();
  }

  let lat = null;
  let lon = null;
  const gpsIfdEntry = findEntry(ifd0, 0x8825);
  if (gpsIfdEntry) {
    const gpsIfd = readIfd(tiffStart + view.getUint32(gpsIfdEntry.valueOffset, little));
    const latEntry = findEntry(gpsIfd, 2);
    const lonEntry = findEntry(gpsIfd, 4);
    if (latEntry && lonEntry) {
      const latRefEntry = findEntry(gpsIfd, 1);
      const lonRefEntry = findEntry(gpsIfd, 3);
      const latDms = readValue(latEntry);
      const lonDms = readValue(lonEntry);
      const latRef = (latRefEntry ? readValue(latRefEntry) : "N").trim().toUpperCase();
      const lonRef = (lonRefEntry ? readValue(lonRefEntry) : "E").trim().toUpperCase();
      lat = (latDms[0] + latDms[1] / 60 + latDms[2] / 3600) * (latRef === "S" ? -1 : 1);
      lon = (lonDms[0] + lonDms[1] / 60 + lonDms[2] / 3600) * (lonRef === "W" ? -1 : 1);
    }
  }
  return { lat, lon, title: imageDescription || xpTitle };
}

function parseExif(arrayBuffer) {
  const empty = { lat: null, lon: null, title: "" };
  try {
    const view = new DataView(arrayBuffer);
    const tiffStart = findExifTiffStartInJpeg(view) ?? findExifTiffStartInHeic(view);
    if (tiffStart === null || tiffStart === undefined) return empty;
    return readExifIfds(view, tiffStart);
  } catch {
    return empty;
  }
}

function isJapan(lat, lon) {
  return lat >= 20 && lat <= 46 && lon >= 122 && lon <= 154;
}

async function reverseGeocodePlaceNameJapan(lat, lon) {
  try {
    const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lon}`;
    const response = await fetch(url);
    if (!response.ok) return "";
    const data = await response.json();
    const muniCd = data.results?.muniCd;
    const aza = data.results?.lv01Nm;
    if (!muniCd || !aza) return "";
    const { default: muniNames } = await import("./muni-codes.json");
    const muniName = muniNames[muniCd];
    if (!muniName) return aza;
    return /[市区]$/.test(muniName) ? `${muniName}${aza}` : muniName;
  } catch {
    return "";
  }
}

async function reverseGeocodePlaceNameOverseas(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=12&accept-language=${locale}`;
    const response = await fetch(url, { headers: { "Accept-Language": locale } });
    if (!response.ok) return "";
    const data = await response.json();
    const address = data.address || {};
    const poiKeys = ["attraction", "tourism", "natural", "peak"];
    for (const key of poiKeys) {
      if (address[key]) return address[key];
    }
    if (data.name) return data.name;
    const placeKeys = ["city", "town", "village", "municipality", "county"];
    for (const key of placeKeys) {
      if (address[key]) return address[key];
    }
    return data.display_name?.split(",")[0].trim() || "";
  } catch {
    return "";
  }
}

async function reverseGeocodePlaceName(lat, lon) {
  if (isJapan(lat, lon)) {
    const name = await reverseGeocodePlaceNameJapan(lat, lon);
    if (name) return name;
  }
  return reverseGeocodePlaceNameOverseas(lat, lon);
}

async function loadPhotoFiles(files) {
  const selectedFiles = [...files];
  if (!selectedFiles.length) return;
  if (selectedFiles.some((file) => !isPhotoFile(file))) {
    setStatus("Only JPEG or HEIC photos can be dropped here.", true);
    return;
  }
  setPreviewLoading("Reading photo location data…");
  let addedCount = 0;
  let skippedCount = 0;
  for (const file of selectedFiles) {
    const { lat, lon, title } = parseExif(await file.arrayBuffer());
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      skippedCount += 1;
      continue;
    }
    const name = title || await reverseGeocodePlaceName(lat, lon) || file.name.replace(/\.[^.]+$/, "");
    addCustomLabel({ name, mode: "coordinate", lat, lon, position: "top", showOnProfile: false });
    addedCount += 1;
    if (selectedFiles.length > 1) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  setPreviewLoading();
  if (addedCount) {
    setStatus(skippedCount
      ? t("photosLoadedWithSkipped", { added: addedCount, skipped: skippedCount })
      : t("photosLoaded", { count: addedCount }));
    await update();
  } else {
    setStatus(t("photosNoLocation", { count: skippedCount }), true);
  }
}

$("photo-file").addEventListener("change", (event) => loadPhotoFiles(event.target.files));
const photoDropZone = $("photo-drop-zone");
const photoDropLabel = $("photo-drop-label");
const defaultPhotoDropLabel = photoDropLabel.textContent;
let photoDragDepth = 0;

function setPhotoDragover(active) {
  photoDropZone.classList.toggle("is-dragover", active);
  photoDropLabel.textContent = active ? t("Drop photo(s) here") : defaultPhotoDropLabel;
}

photoDropZone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  photoDragDepth += 1;
  setPhotoDragover(true);
});
photoDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});
photoDropZone.addEventListener("dragleave", () => {
  photoDragDepth = Math.max(0, photoDragDepth - 1);
  if (!photoDragDepth) setPhotoDragover(false);
});
photoDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  photoDragDepth = 0;
  setPhotoDragover(false);
  const files = [...event.dataTransfer.files];
  if (files.length) loadPhotoFiles(files);
});
$("add-custom-label").addEventListener("click", () => addCustomLabel());

ids.filter((id) => !["route-offset-x", "route-offset-y"].includes(id))
  .forEach((id) => $(id).addEventListener("input", update));

function updateRouteOffset() {
  const s = state();
  const previewSvg = $("preview").querySelector("svg");
  const routeOverlay = previewSvg?.querySelector("#route-overlay");
  const broadLand = previewSvg?.querySelector("#broad-land");
  if (!renderedState || !previewSvg || !routeOverlay || !broadLand || s.mapStyle !== "water") {
    update();
    return;
  }
  const pxPerMm = renderedState.dpi / 25.4;
  const dx = (s.routeOffsetXMm - renderedState.routeOffsetXMm) * pxPerMm;
  const dy = (s.routeOffsetYMm - renderedState.routeOffsetYMm) * pxPerMm;
  routeOverlay.setAttribute("transform", `translate(${dx.toFixed(3)} ${dy.toFixed(3)})`);
  const mapX = Number(broadLand.dataset.offsetX) + dx;
  const mapY = Number(broadLand.dataset.offsetY) + dy;
  broadLand.setAttribute("transform", `translate(${mapX.toFixed(3)} ${mapY.toFixed(3)})`);
}

$("route-offset-x").addEventListener("input", updateRouteOffset);
$("route-offset-y").addEventListener("input", updateRouteOffset);
const marginFieldIds = ["margin-top", "margin-right", "margin-bottom", "margin-left"];
function setMarginLinked(linked, syncValue = false) {
  $("margin-link").setAttribute("aria-pressed", String(linked));
  const actionLabel = t(linked ? "Unlink margin values" : "Link margin values");
  $("margin-link").title = actionLabel;
  $("margin-link").setAttribute("aria-label", actionLabel);
  if (linked && syncValue) {
    const value = $("margin-top").value;
    marginFieldIds.forEach((id) => { $(id).value = value; });
  }
}
$("margin-link").addEventListener("click", () => {
  const linked = $("margin-link").getAttribute("aria-pressed") !== "true";
  setMarginLinked(linked, true);
  update();
});
marginFieldIds.forEach((id) => $(id).addEventListener("input", (event) => {
  if ($("margin-link").getAttribute("aria-pressed") === "true") {
    marginFieldIds.forEach((otherId) => { if (otherId !== id) $(otherId).value = event.target.value; });
  }
  update();
}));
$("time-zone").addEventListener("input", () => updateTimeZoneHint(routeData));
$("clip-mode").addEventListener("change", applyClip);
["clip-distance-start", "clip-distance-end", "clip-time-start", "clip-time-end"]
  .forEach((id) => $(id).addEventListener("change", applyClip));
document.querySelectorAll('input[name="size-mode"]').forEach((input) => input.addEventListener("change", () => {
  const px = input.value === "px";
  $("px-fields").hidden = !px;
  $("mm-fields").hidden = px;
  update();
}));

$("download-svg").addEventListener("click", async () => {
  const s = state();
  try {
    setStatus("Generating high-resolution SVG…");
    const exportSvg = await generateSvg(routeData, s);
    downloadBlob(new Blob([exportSvg], { type: "image/svg+xml;charset=utf-8" }), filename(s, "svg"));
    setStatus("SVG saved.");
  } catch (error) {
    setStatus(error.message, true);
  }
});
$("download-png").addEventListener("click", async () => {
  const s = state();
  try {
    setStatus("Generating high-resolution PNG…");
    const exportSvg = await generateSvg(routeData, s);
    const blob = await svgToGrayscalePng(exportSvg, s.width, s.height, s.dpi, s.antialias);
    downloadBlob(blob, filename(s, "png"));
    setStatus("8-bit grayscale PNG saved.");
  } catch (error) {
    setStatus(error.message, true);
  }
});
$("save-settings").addEventListener("click", () => {
  const s = state();
  const safeTitle = s.sectionTitle.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40) || "Route";
  downloadBlob(new Blob([JSON.stringify(s, null, 2)], { type: "application/json" }), `${safeTitle}_settings.json`);
});
const layoutSettingKeys = [
  "sizeMode", "width", "height", "widthMm", "heightMm", "dpi",
  "marginMode", "marginAllMm", "marginTopMm", "marginRightMm", "marginBottomMm", "marginLeftMm",
  "routeWidthMm", "profileWidthMm", "profileBoxWidthMm", "profileBoxHeightMm",
  "profileOffsetXMm", "profileOffsetYMm", "infoOffsetXMm", "infoOffsetYMm",
  "arrowSizeMm", "infoFontSizePt", "labelFontSizePt", "markerScale", "elevationFontSizePt",
  "routeScale", "routeOffsetXMm", "routeOffsetYMm", "elevationThreshold",
  "mapStyle",
  "showProfile", "showProfileElevation", "showMap", "showArrows", "showDatetime",
  "antialias", "metaPosition", "profilePosition", "previewScale"
];
const layoutControlMap = {
  width: "width-px", height: "height-px", widthMm: "width-mm", heightMm: "height-mm", dpi: "dpi",
  marginTopMm: "margin-top", marginRightMm: "margin-right",
  marginBottomMm: "margin-bottom", marginLeftMm: "margin-left",
  routeWidthMm: "route-width", profileWidthMm: "profile-width",
  profileBoxWidthMm: "profile-box-width", profileBoxHeightMm: "profile-box-height",
  profileOffsetXMm: "profile-offset-x", profileOffsetYMm: "profile-offset-y",
  infoOffsetXMm: "info-offset-x", infoOffsetYMm: "info-offset-y",
  arrowSizeMm: "arrow-size", infoFontSizePt: "info-font-size",
  labelFontSizePt: "label-font-size", markerScale: "marker-scale",
  elevationFontSizePt: "elevation-font-size", routeScale: "route-scale",
  mapStyle: "map-style",
  routeOffsetXMm: "route-offset-x", routeOffsetYMm: "route-offset-y",
  elevationThreshold: "elevation-threshold", showProfile: "show-profile",
  showProfileElevation: "show-profile-elevation",
  showMap: "show-map", showArrows: "show-arrows", showDatetime: "show-datetime",
  antialias: "antialias", metaPosition: "meta-position",
  profilePosition: "profile-position", previewScale: "preview-scale"
};

function applyLayoutSettings(settings) {
  Object.entries(layoutControlMap).forEach(([key, id]) => {
    if (!(key in settings)) return;
    if ($(id).type === "checkbox") $(id).checked = Boolean(settings[key]);
    else $(id).value = settings[key];
  });
  setMarginLinked(settings.marginMode !== "individual", false);
  applyPreviewScale();
  const mode = settings.sizeMode === "mm" ? "mm" : "px";
  document.querySelector(`input[name="size-mode"][value="${mode}"]`).click();
  update();
}

$("save-layout").addEventListener("click", () => {
  const s = state();
  const layout = Object.fromEntries(layoutSettingKeys.map((key) => [key, s[key]]));
  const payload = { settingsType: "layout", version: 1, ...layout };
  const safeTitle = s.sectionTitle.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40) || "Route";
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `${safeTitle}_layout.json`);
});

$("layout-settings-file").addEventListener("change", async (event) => {
  try {
    const settings = JSON.parse(await event.target.files[0].text());
    applyLayoutSettings(settings);
    setStatus("Layout loaded. GPX range and label content were preserved.");
  } catch {
    setStatus("Unable to load layout JSON.", true);
  } finally {
    event.target.value = "";
  }
});
$("settings-file").addEventListener("change", async (event) => {
  try {
    const settings = JSON.parse(await event.target.files[0].text());
    const map = {
      sectionTitle: "section-title",
      startName: "start-name", finishName: "finish-name", width: "width-px", height: "height-px",
      widthMm: "width-mm", heightMm: "height-mm", dpi: "dpi",
      marginTopMm: "margin-top", marginRightMm: "margin-right",
      marginBottomMm: "margin-bottom", marginLeftMm: "margin-left",
      routeWidthMm: "route-width", profileWidthMm: "profile-width",
      profileBoxWidthMm: "profile-box-width", profileBoxHeightMm: "profile-box-height",
      profileOffsetXMm: "profile-offset-x", profileOffsetYMm: "profile-offset-y",
      infoOffsetXMm: "info-offset-x", infoOffsetYMm: "info-offset-y",
      arrowSizeMm: "arrow-size",
      infoFontSizePt: "info-font-size", labelFontSizePt: "label-font-size", markerScale: "marker-scale",
      elevationFontSizePt: "elevation-font-size",
      mapStyle: "map-style",
      routeScale: "route-scale",
      routeOffsetXMm: "route-offset-x", routeOffsetYMm: "route-offset-y",
      elevationThreshold: "elevation-threshold", timeZone: "time-zone", showProfile: "show-profile",
      showProfileElevation: "show-profile-elevation",
      showMap: "show-map", showArrows: "show-arrows", showDatetime: "show-datetime",
      antialias: "antialias", previewScale: "preview-scale",
      startLabelPosition: "start-label-position", finishLabelPosition: "finish-label-position",
      metaPosition: "meta-position", profilePosition: "profile-position",
      clipMode: "clip-mode", clipDistanceStart: "clip-distance-start",
      clipDistanceEnd: "clip-distance-end", clipTimeStart: "clip-time-start", clipTimeEnd: "clip-time-end"
    };
    Object.entries(map).forEach(([key, id]) => {
      if (!(key in settings)) return;
      if ($(id).type === "checkbox") $(id).checked = Boolean(settings[key]);
      else $(id).value = settings[key];
    });
    if (!("marginTopMm" in settings) && Number.isFinite(settings.marginAllMm)) {
      marginFieldIds.forEach((id) => { $(id).value = settings.marginAllMm; });
    }
    const legacyWidthMm = Number(settings.widthMm) || Number(settings.width) / (Number(settings.dpi) || 300) * 25.4;
    const legacyHeightMm = Number(settings.heightMm) || Number(settings.height) / (Number(settings.dpi) || 300) * 25.4;
    if (!("profileBoxWidthMm" in settings) && Number.isFinite(settings.profileBoxWidth)) {
      $("profile-box-width").value = (legacyWidthMm * settings.profileBoxWidth / 100).toFixed(1);
    }
    if (!("profileBoxHeightMm" in settings) && Number.isFinite(settings.profileBoxHeight)) {
      $("profile-box-height").value = (legacyHeightMm * settings.profileBoxHeight / 100).toFixed(1);
    }
    if (!("marginTopMm" in settings) && Number.isFinite(settings.marginPercent)) {
      const legacyMarginMm = legacyWidthMm * Number(settings.marginPercent) / 100;
      ["margin-top", "margin-right", "margin-bottom", "margin-left"].forEach((id) => { $(id).value = legacyMarginMm.toFixed(2); });
    }
    if (!("routeOffsetXMm" in settings) && Number.isFinite(settings.routeOffsetX)) $("route-offset-x").value = legacyWidthMm * settings.routeOffsetX / 100;
    if (!("routeOffsetYMm" in settings) && Number.isFinite(settings.routeOffsetY)) $("route-offset-y").value = legacyHeightMm * settings.routeOffsetY / 100;
    if (!("profileOffsetXMm" in settings) && Number.isFinite(settings.profileOffsetX)) $("profile-offset-x").value = legacyWidthMm * settings.profileOffsetX / 100;
    if (!("profileOffsetYMm" in settings) && Number.isFinite(settings.profileOffsetY)) $("profile-offset-y").value = legacyHeightMm * settings.profileOffsetY / 100;
    const legacyDpi = Number(settings.dpi) || 300;
    const legacyWidthPx = Number(settings.width) || legacyWidthMm / 25.4 * legacyDpi;
    const legacyBaseFontPx = Math.max(14, legacyWidthPx * .024);
    if (!("infoFontSizePt" in settings) && Number.isFinite(settings.infoScale)) $("info-font-size").value = (legacyBaseFontPx * settings.infoScale / 100 / legacyDpi * 72).toFixed(1);
    if (!("labelFontSizePt" in settings) && Number.isFinite(settings.labelScale)) $("label-font-size").value = (legacyBaseFontPx * .66 * settings.labelScale / 100 / legacyDpi * 72).toFixed(1);
    if (!("elevationFontSizePt" in settings) && Number.isFinite(settings.elevationScale)) $("elevation-font-size").value = (Math.max(10, legacyWidthPx * (8 / 750)) * settings.elevationScale / 100 / legacyDpi * 72).toFixed(1);
    if (!("startLabelPosition" in settings) && settings.labelPosition) {
      $("start-label-position").value = settings.labelPosition;
    }
    if (!("finishLabelPosition" in settings) && settings.labelPosition) {
      $("finish-label-position").value = settings.labelPosition;
    }
    setCustomLabels(settings.customLabels || []);
    const marginMode = settings.marginMode === "individual" ? "individual" : "all";
    setMarginLinked(marginMode === "all", false);
    applyPreviewScale();
    const mode = settings.sizeMode === "mm" ? "mm" : "px";
    document.querySelector(`input[name="size-mode"][value="${mode}"]`).click();
    if (sourceRouteData) applyClip();
    else update();
    setStatus("Settings loaded.");
  } catch {
    setStatus("Unable to load settings JSON.", true);
  }
});
function applyPreviewScale() {
  const scale = clamp(Number($("preview-scale").value), 1, 300);
  $("preview").style.setProperty("--preview-scale", `${scale}%`);
}
function fitPreview() {
  const shell = $("preview-shell");
  const shellStyle = getComputedStyle(shell);
  const availableWidth = shell.clientWidth
    - parseFloat(shellStyle.paddingLeft) - parseFloat(shellStyle.paddingRight);
  const availableHeight = shell.clientHeight
    - parseFloat(shellStyle.paddingTop) - parseFloat(shellStyle.paddingBottom);
  const s = state();
  const heightAtFullWidth = availableWidth * s.height / s.width;
  const scale = heightAtFullWidth > 0
    ? clamp(Math.min(100, availableHeight / heightAtFullWidth * 100), 1, 100)
    : 100;
  $("preview-scale").value = Number(scale.toFixed(1));
  applyPreviewScale();
}
$("preview-scale").addEventListener("input", applyPreviewScale);
$("fit-preview").addEventListener("click", () => {
  fitPreview();
});

applyPreviewScale();
update();
if (new URLSearchParams(location.search).get("sample") === "1") loadSample();
