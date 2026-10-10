import { ProtagonistInteriorCache, type InteriorPlan } from "./building-interior.ts";
import { buildingAt, settlementLayout, type Building, type BuildingRole } from "./settlement-layout.ts";
import { cities, villages } from "./geography.ts";
import { flatToLonLat, lonLatToFlat } from "./planet.ts";

type AdvisorWorld = {
  cellAt(x: number, z: number): { structure?: { code: string; role: string } };
  navigation: {
    surfaceAtScreen(x: number, y: number): { lon: number; lat: number } | undefined;
    setFocus(lon: number, lat: number): void;
  };
  setHalfHeight(height: number): void;
  state: { ready: boolean };
};

declare global {
  interface Window {
    advisorWorld?: AdvisorWorld;
    advisorInteriors?: unknown;
  }
}

const cache = new ProtagonistInteriorCache(2);
let selected: Building | undefined;
let active: InteriorPlan | undefined;
let floor = 0;
let currentRoom = "";
let lastAction = "No interior materialized";
let lastExitedSignature = "";
let reconstructed = false;
let down: { x: number; y: number; moved: boolean } | undefined;

const roleLabel = (role: string) =>
  role.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const HTML_ESCAPE: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => HTML_ESCAPE[char] ?? char);

const style = document.createElement("style");
style.textContent = `
  #building-access, #interior-shell { font-family: ui-sans-serif, system-ui, sans-serif; color:#f2ead7; }
  #building-access { position:fixed; right:16px; top:92px; width:min(330px,calc(100vw - 32px)); z-index:40; background:rgba(19,31,28,.96); border:1px solid rgba(214,185,119,.55); border-radius:12px; padding:14px; box-shadow:0 16px 48px rgba(0,0,0,.38); }
  #building-access[hidden], #interior-shell[hidden] { display:none !important; }
  #building-access .eyebrow, #interior-shell .eyebrow { color:#d6b977; letter-spacing:.12em; font-size:11px; font-weight:700; text-transform:uppercase; }
  #building-access h2 { margin:5px 0 4px; font-size:20px; }
  #building-access p { margin:6px 0; color:#cbd3c9; font-size:13px; line-height:1.45; }
  #building-access .program { display:flex; flex-wrap:wrap; gap:5px; margin:10px 0 12px; }
  #building-access .program span { background:rgba(255,255,255,.08); border-radius:999px; padding:4px 7px; font-size:11px; }
  #building-access button, #interior-shell button { min-width:44px; min-height:44px; border:1px solid rgba(214,185,119,.5); border-radius:8px; background:#263c35; color:#f6efdf; padding:8px 12px; font-weight:650; cursor:pointer; }
  #building-access .actions { display:flex; gap:8px; }
  #building-access .actions button:first-child { flex:1; background:#855f2e; }
  #interior-shell { --interior-wall:#c5b284; --interior-floor:#31463d; --interior-accent:#d6b977; position:fixed; inset:76px 18px 62px 350px; z-index:50; background:rgba(12,21,19,.985); border:1px solid var(--interior-accent); border-radius:14px; box-shadow:0 22px 65px rgba(0,0,0,.55); overflow:hidden; display:grid; grid-template-rows:auto 1fr auto; }
  #interior-head { display:flex; gap:12px; align-items:center; padding:12px 14px; border-bottom:1px solid rgba(255,255,255,.1); }
  #interior-head .titles { flex:1; min-width:0; }
  #interior-head h2 { margin:2px 0 0; font-size:20px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #interior-style { margin-top:3px; color:#bac7bd; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #interior-floor-tabs { display:flex; gap:5px; }
  #interior-floor-tabs button { min-width:44px; padding:6px 9px; }
  #interior-floor-tabs button[aria-pressed=true] { background:#855f2e; }
  #interior-map-wrap { min-height:0; display:grid; grid-template-columns:minmax(0,1fr) 230px; }
  #interior-map { width:100%; height:100%; min-height:280px; background:var(--interior-floor); }
  .interior-room { fill:var(--interior-wall); fill-opacity:.26; stroke:var(--interior-accent); stroke-width:.12; }
  .interior-room.current { fill-opacity:.48; stroke-width:.24; }
  .interior-room-label { fill:#fff7e8; font-size:.62px; font-weight:700; text-anchor:middle; dominant-baseline:middle; pointer-events:none; }
  .interior-you { fill:#fff7e8; stroke:#1b2521; stroke-width:.12; }
  .interior-anchor { fill:var(--interior-accent); stroke:#fff5dd; stroke-width:.10; cursor:pointer; }
  .interior-anchor:hover { filter:brightness(1.25); }
  #interior-uses { padding:12px; overflow:auto; border-left:1px solid rgba(255,255,255,.1); }
  #interior-uses h3 { margin:10px 0 7px; font-size:11px; color:var(--interior-accent); text-transform:uppercase; letter-spacing:.08em; }
  #interior-uses h3:first-child { margin-top:0; }
  #interior-uses .occupied { margin:0 0 8px; padding:7px 8px; border-radius:7px; background:rgba(255,255,255,.08); font-size:12px; }
  #interior-uses button { width:100%; margin:0 0 7px; text-align:left; font-size:12px; min-height:40px; }
  #interior-status { padding:10px 14px; display:flex; align-items:center; gap:10px; border-top:1px solid rgba(255,255,255,.1); color:#cbd3c9; font-size:12px; }
  #interior-status span { flex:1; }
  #interior-status strong { color:var(--interior-accent); }
  @media (max-width:760px) {
    #building-access { top:auto; bottom:72px; left:10px; right:10px; width:auto; padding:10px; }
    #building-access .program { max-height:62px; overflow:auto; }
    #interior-shell { inset:60px 8px 64px 8px; border-radius:10px; }
    #interior-map-wrap { grid-template-columns:1fr; grid-template-rows:minmax(0,1fr) auto; }
    #interior-uses { border-left:0; border-top:1px solid rgba(255,255,255,.1); display:flex; gap:6px; overflow-x:auto; padding:8px; align-items:end; }
    #interior-uses h3 { display:none; }
    #interior-uses .occupied { min-width:118px; margin:0; }
    #interior-uses button { width:auto; min-width:118px; margin:0; }
    #interior-head { padding:8px 10px; }
    #interior-head h2 { font-size:16px; }
    #interior-style { max-width:55vw; }
    #interior-status { padding:7px 10px; }
  }
  @media (max-height:430px) {
    #building-access { top:54px; right:8px; bottom:auto; left:auto; width:280px; max-height:calc(100vh - 112px); overflow:auto; }
    #interior-shell { inset:50px 7px 54px 7px; }
    #interior-head { padding:5px 8px; }
    #interior-head h2 { font-size:14px; }
    #interior-style { font-size:9px; }
    #interior-status { padding:5px 8px; }
    #interior-map { min-height:160px; }
  }
`;
document.head.append(style);

const access = document.createElement("aside");
access.id = "building-access";
access.hidden = true;
access.setAttribute("aria-live", "polite");
document.body.append(access);

const shell = document.createElement("section");
shell.id = "interior-shell";
shell.hidden = true;
shell.setAttribute("aria-label", "Building interior");
shell.innerHTML = `
  <header id="interior-head"><div class="titles"><div class="eyebrow">PROTAGONIST INTERIOR · ON DEMAND</div><h2 id="interior-title"></h2><div id="interior-style"></div></div><div id="interior-floor-tabs"></div><button id="interior-exit" type="button">Exit</button></header>
  <div id="interior-map-wrap"><svg id="interior-map" role="img" aria-label="Deterministic traversable building floor plan"></svg><aside id="interior-uses"></aside></div>
  <footer id="interior-status"><span id="interior-action"></span><strong id="interior-memory"></strong></footer>`;
document.body.append(shell);

function renderAccess() {
  if (!selected || active) {
    access.hidden = true;
    return;
  }
  const rooms = selected.rooms.map((room) => `<span>${escapeHtml(room.name)}</span>`).join("");
  access.innerHTML = `<div class="eyebrow">BUILDING SELECTED · INTERIOR UNLOADED</div><h2>${escapeHtml(roleLabel(selected.role))}</h2><p>${selected.capacity} capacity · ${selected.floors} floor${selected.floors === 1 ? "" : "s"} · entrance connected to ${escapeHtml(selected.street)}</p><div class="program">${rooms}</div><div class="actions"><button id="building-enter" type="button">Enter ${escapeHtml(roleLabel(selected.role))}</button><button id="building-dismiss" type="button" aria-label="Dismiss building">×</button></div><p id="building-cache-state">${escapeHtml(lastAction)} · cache ${cache.stats().cached}</p>`;
  access.hidden = false;
  access.querySelector<HTMLButtonElement>("#building-enter")!.onclick = () => enterSelected();
  access.querySelector<HTMLButtonElement>("#building-dismiss")!.onclick = () => { selected = undefined; access.hidden = true; };
}

const anchorGlyph: Readonly<Record<string, string>> = {
  entrance: "↥", stairs: "↟", bed: "▰", latrine: "◫", hearth: "◉", table: "◇", counter: "▤", forge: "♨", anvil: "◆", stall: "▥", storage: "▣", workbench: "▦", desk: "▧", rack: "▥", hay: "≋",
};

function connectionsFrom(roomCode: string) {
  if (!active) return [];
  return active.doors
    .filter((door) => door.from === roomCode || door.to === roomCode)
    .map((door) => ({
      door,
      target: door.from === roomCode ? door.to : door.from,
    }));
}

function renderInterior() {
  if (!active || !selected) {
    shell.hidden = true;
    return;
  }
  shell.hidden = false;
  access.hidden = true;
  shell.style.setProperty("--interior-wall", active.style.wall);
  shell.style.setProperty("--interior-floor", active.style.floor);
  shell.style.setProperty("--interior-accent", active.style.accent);
  shell.querySelector<HTMLElement>("#interior-title")!.textContent = `${roleLabel(active.role)} · ${selected.code.split("/").slice(-2).join("/")}`;
  shell.querySelector<HTMLElement>("#interior-style")!.textContent = `${active.style.culture} · ${active.style.environment} · ${active.style.construction} · ${active.style.heating}`;
  const tabs = shell.querySelector<HTMLElement>("#interior-floor-tabs")!;
  tabs.innerHTML = Array.from({ length: active.floors }, (_, index) => `<button type="button" data-floor="${index}" aria-pressed="${index === floor}">F${index + 1}</button>`).join("");
  tabs.querySelectorAll<HTMLButtonElement>("button").forEach((button) => button.onclick = () => { floor = Number(button.dataset.floor); renderInterior(); });

  const width = Math.max(4, active.footprint.widthM),
    depth = Math.max(4, active.footprint.depthM),
    svg = shell.querySelector<SVGSVGElement>("#interior-map")!;
  svg.setAttribute("viewBox", `${-width / 2 - 1} ${-depth / 2 - 1} ${width + 2} ${depth + 2}`);
  const visible = active.rooms.filter((room) => room.floor === floor),
    roomSvg = visible.map((room) => `<g><rect class="interior-room${room.code === currentRoom ? " current" : ""}" x="${room.x - room.widthM / 2}" y="${room.z - room.depthM / 2}" width="${room.widthM}" height="${room.depthM}" rx=".18"/><text class="interior-room-label" x="${room.x}" y="${room.z}">${escapeHtml(room.name)}</text>${room.code === currentRoom ? `<circle class="interior-you" cx="${room.x}" cy="${room.z + Math.min(0.7, room.depthM * 0.22)}" r=".24"/><text class="interior-room-label" x="${room.x}" y="${room.z + Math.min(0.7, room.depthM * 0.22)}">YOU</text>` : ""}</g>`).join(""),
    visibleRooms = new Set(visible.map((room) => room.code)),
    anchors = active.anchors.filter((anchor) => visibleRooms.has(anchor.room)),
    anchorSvg = anchors.map((anchor) => `<g data-anchor="${escapeHtml(anchor.code)}" tabindex="0" role="button" aria-label="Use ${escapeHtml(anchor.kind)}"><circle class="interior-anchor" cx="${anchor.x}" cy="${anchor.z}" r=".32"/><text class="interior-room-label" x="${anchor.x}" y="${anchor.z + 0.03}">${anchorGlyph[anchor.kind] ?? "•"}</text></g>`).join("");
  svg.innerHTML = `${roomSvg}${anchorSvg}`;
  svg.querySelectorAll<SVGGElement>("[data-anchor]").forEach((node) => {
    const invoke = () => useAnchor(node.dataset.anchor!);
    node.addEventListener("click", invoke);
    node.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") invoke(); });
  });

  const occupied = active.rooms.find((room) => room.code === currentRoom),
    moves = connectionsFrom(currentRoom),
    usable = active.anchors.filter((anchor) => anchor.room === currentRoom && !["entrance", "stairs"].includes(anchor.kind)),
    uses = shell.querySelector<HTMLElement>("#interior-uses")!;
  uses.innerHTML = `<h3>Current room</h3><div class="occupied">${escapeHtml(occupied?.name ?? "Entry")}</div><h3>Move</h3>${moves.map(({ door, target }) => {
    const targetRoom = active!.rooms.find((room) => room.code === target),
      label = target === "EXTERIOR" ? "Exit building" : `${door.kind === "stair" ? "↟ Stairs" : "→ Door"} · ${targetRoom?.name ?? "room"}`;
    return `<button type="button" data-move="${escapeHtml(door.code)}">${escapeHtml(label)}</button>`;
  }).join("")}<h3>Use</h3>${usable.map((anchor) => `<button type="button" data-use="${escapeHtml(anchor.code)}">${anchorGlyph[anchor.kind] ?? "•"} ${escapeHtml(roleLabel(anchor.kind))}</button>`).join("") || "<div class=\"occupied\">No fixture here</div>"}`;
  uses.querySelectorAll<HTMLButtonElement>("[data-move]").forEach((button) => button.onclick = () => moveThrough(button.dataset.move!));
  uses.querySelectorAll<HTMLButtonElement>("[data-use]").forEach((button) => button.onclick = () => useAnchor(button.dataset.use!));
  shell.querySelector<HTMLElement>("#interior-action")!.textContent = lastAction;
  const stats = cache.stats();
  shell.querySelector<HTMLElement>("#interior-memory")!.textContent = `${Math.round(stats.bytes / 1024)} KiB · ${stats.cached} cached · ${active.signature}`;
}

function selectBuilding(building: Building | undefined, focusMap = false) {
  if (active) return false;
  selected = building;
  if (!building) { access.hidden = true; return false; }
  lastAction = "Exterior selected; interior remains unloaded";
  reconstructed = false;
  if (focusMap) {
    const target = flatToLonLat(building.x, building.z);
    window.advisorWorld?.navigation.setFocus(target.lon, target.lat);
    window.advisorWorld?.setHalfHeight(42);
  }
  renderAccess();
  return true;
}

function enterSelected() {
  if (!selected) return false;
  active = cache.enter(selected);
  currentRoom = active.rooms[0]?.code ?? "";
  floor = active.rooms[0]?.floor ?? 0;
  reconstructed = Boolean(lastExitedSignature && lastExitedSignature === active.signature);
  lastAction = reconstructed ? `Re-entered; topology reconstructed identically (${active.signature})` : `Entered through canonical exterior threshold (${active.signature})`;
  renderInterior();
  return true;
}

function moveThrough(connectionCode: string) {
  if (!active || !currentRoom) return false;
  const connection = active.doors.find((door) => door.code === connectionCode && (door.from === currentRoom || door.to === currentRoom));
  if (!connection) return false;
  const target = connection.from === currentRoom ? connection.to : connection.from;
  if (target === "EXTERIOR") return exitInterior();
  const room = active.rooms.find((candidate) => candidate.code === target);
  if (!room) return false;
  currentRoom = room.code;
  floor = room.floor;
  lastAction = `Moved through ${connection.kind} to ${room.name}`;
  renderInterior();
  return true;
}

function useAnchor(code?: string) {
  if (!active || !currentRoom) return false;
  const anchor = code
    ? active.anchors.find((candidate) => candidate.code === code && candidate.room === currentRoom)
    : active.anchors.find((candidate) => candidate.room === currentRoom && !["entrance", "stairs"].includes(candidate.kind));
  if (!anchor) return false;
  const room = active.rooms.find((candidate) => candidate.code === anchor.room);
  lastAction = `Used ${anchor.kind} in ${room?.name ?? "room"}`;
  renderInterior();
  return true;
}

function exitInterior() {
  if (!active || !selected) return false;
  const code = selected.code;
  lastExitedSignature = active.signature;
  cache.exit(code);
  const evicted = cache.evict(code);
  active = undefined;
  currentRoom = "";
  floor = 0;
  lastAction = evicted ? `Exited to canonical entrance; interior evicted (${lastExitedSignature})` : "Exited interior";
  shell.hidden = true;
  renderAccess();
  return evicted;
}

shell.querySelector<HTMLButtonElement>("#interior-exit")!.onclick = () => exitInterior();

function selectAt(x: number, z: number, focusMap = false) {
  return selectBuilding(buildingAt(x, z), focusMap);
}
function selectByRole(role: BuildingRole, placeIndex = 0, city = false) {
  const placeList = city ? cities : villages,
    place = placeList[Math.max(0, Math.min(placeList.length - 1, placeIndex))],
    candidate = settlementLayout(place).buildings.find((building) => building.role === role);
  return selectBuilding(candidate, true);
}

function attach() {
  if (!window.advisorWorld?.state.ready) {
    requestAnimationFrame(attach);
    return;
  }
  const canvas = document.querySelector<HTMLCanvasElement>("#world");
  if (!canvas) return;
  canvas.addEventListener("pointerdown", (event) => { down = { x: event.clientX, y: event.clientY, moved: false }; });
  canvas.addEventListener("pointermove", (event) => { if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) down.moved = true; });
  canvas.addEventListener("pointerup", (event) => {
    if (!down || down.moved || active) { down = undefined; return; }
    const surface = window.advisorWorld!.navigation.surfaceAtScreen(event.clientX, event.clientY);
    down = undefined;
    if (!surface) return;
    const source = lonLatToFlat(surface.lon, surface.lat);
    const cell = window.advisorWorld!.cellAt(source.x, source.z);
    if (!cell.structure) {
      selected = undefined;
      access.hidden = true;
      return;
    }
    selectAt(source.x, source.z);
  });

  Object.defineProperty(window, "advisorInteriors", {
    configurable: true,
    value: Object.freeze({
      selectAt,
      selectByRole,
      enterSelected,
      moveThrough,
      useAnchor,
      exit: exitInterior,
      get state() {
        const availableConnections = active && currentRoom
          ? connectionsFrom(currentRoom).map(({ door, target }) => ({ code: door.code, kind: door.kind, target }))
          : [];
        return {
          selected: selected ? { code: selected.code, role: selected.role, x: selected.x, z: selected.z, entrance: selected.entrance, access: selected.access } : null,
          active: active ? { code: active.code, building: active.building, role: active.role, signature: active.signature, rooms: active.rooms.map((room) => ({ code: room.code, name: room.name, floor: room.floor })), anchors: active.anchors.length, style: active.style } : null,
          currentRoom,
          floor,
          availableConnections,
          lastAction,
          reconstructed,
          cache: cache.stats(),
          shellVisible: !shell.hidden,
          accessVisible: !access.hidden,
        };
      },
    }),
  });
}
attach();
