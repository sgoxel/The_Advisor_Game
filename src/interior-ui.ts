import { InteriorResidency, type InteriorBase } from "./building-interior.ts";
import type { Building } from "./settlement-layout.ts";

type BuildingSelectionDetail = { building?: Building };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const residency = new InteriorResidency(1),
  seenSignatures = new Map<string, string>();
let selected: Building | undefined,
  active: { building: Building; base: InteriorBase } | undefined,
  px = 0,
  pz = 0,
  lastAction = "",
  reconstructed = false;

function scaled(base: InteriorBase, x: number, z: number) {
  const sx = 100 / Math.max(1, base.width),
    sz = 100 / Math.max(1, base.depth);
  return { left: 50 + x * sx, top: 50 + z * sz };
}

function roomAt(base: InteriorBase, x: number, z: number) {
  return base.rooms.find(
    (room) =>
      Math.abs(x - room.x) <= room.width / 2 + 1e-6 &&
      Math.abs(z - room.z) <= room.depth / 2 + 1e-6,
  );
}

function currentRoom() {
  return active ? roomAt(active.base, px, pz) : undefined;
}

function currentAnchor() {
  const room = currentRoom();
  if (!active || !room) return undefined;
  return active.base.anchors.find((anchor) => anchor.kind !== "entry" && anchor.room === room.code);
}

function connections() {
  const room = currentRoom();
  if (!active || !room) return [];
  return active.base.doors
    .filter((door) => door.from === room.code || door.to === room.code)
    .map((door) => ({
      code: door.code,
      target: door.from === room.code ? door.to : door.from,
      kind: "door" as const,
    }));
}

function doorwayAllows(
  base: InteriorBase,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
) {
  const from = roomAt(base, fromX, fromZ),
    to = roomAt(base, toX, toZ);
  if (!to) return false;
  if (!from || from.code === to.code) return true;
  const door = base.doors.find(
    (candidate) =>
      (candidate.from === from.code && candidate.to === to.code) ||
      (candidate.from === to.code && candidate.to === from.code),
  );
  if (!door) return false;
  const horizontalSeparation = Math.abs(from.x - to.x) > Math.abs(from.z - to.z),
    clearance = door.width / 2 + 0.32;
  return horizontalSeparation
    ? Math.abs(toZ - door.z) <= clearance
    : Math.abs(toX - door.x) <= clearance;
}

function updatePlayer() {
  if (!active) return;
  const player = $("interior-player"),
    point = scaled(active.base, px, pz),
    room = currentRoom(),
    anchor = currentAnchor(),
    use = $<HTMLButtonElement>("interior-use");
  player.style.left = `${point.left}%`;
  player.style.top = `${point.top}%`;
  use.disabled = !anchor;
  use.textContent = anchor ? `Use ${anchor.kind}` : "Use destination";
  $("interior-status").textContent = room
    ? `${lastAction ? `${lastAction} · ` : ""}Inside ${room.name} · ${active.building.role} · arrows/WASD move`
    : `At entry · arrows/WASD move`;
}

function move(dx: number, dz: number) {
  if (!active) return false;
  const step = 0.7,
    nx = px + dx * step,
    nz = pz + dz * step,
    halfW = active.base.width / 2 - 0.35,
    halfD = active.base.depth / 2 - 0.35;
  if (nx < -halfW || nx > halfW || nz < -halfD || nz > halfD) return false;
  if (!doorwayAllows(active.base, px, pz, nx, nz)) return false;
  px = nx;
  pz = nz;
  lastAction = "";
  updatePlayer();
  return true;
}

function moveThrough(code: string) {
  if (!active) return false;
  const connection = connections().find((candidate) => candidate.code === code);
  if (!connection) return false;
  const target = active.base.rooms.find((room) => room.code === connection.target);
  if (!target) return false;
  // Diagnostic/traversal action still follows a real canonical doorway: the connection can only
  // exist when the two rooms share that door. Position at the target room centre after crossing.
  px = target.x;
  pz = target.z;
  lastAction = "Crossed doorway";
  updatePlayer();
  return true;
}

function useAnchor() {
  const anchor = currentAnchor();
  if (!anchor) return false;
  lastAction = `Used ${anchor.kind}`;
  updatePlayer();
  return true;
}

function renderInterior(base: InteriorBase) {
  const scene = $("interior-scene");
  scene.replaceChildren();
  for (const room of base.rooms) {
    const node = document.createElement("div"),
      center = scaled(base, room.x, room.z);
    node.className = "interior-room";
    node.dataset.room = room.name;
    node.style.left = `${center.left}%`;
    node.style.top = `${center.top}%`;
    node.style.width = `${(room.width / base.width) * 100}%`;
    node.style.height = `${(room.depth / base.depth) * 100}%`;
    node.style.transform = "translate(-50%, -50%)";
    scene.append(node);
  }
  for (const door of base.doors) {
    const node = document.createElement("div"),
      point = scaled(base, door.x, door.z);
    node.className = "interior-door";
    node.style.left = `${point.left}%`;
    node.style.top = `${point.top}%`;
    node.title = "Walkable doorway";
    scene.append(node);
  }
  for (const anchor of base.anchors.filter((item) => item.kind !== "entry")) {
    const node = document.createElement("div"),
      point = scaled(base, anchor.x, anchor.z);
    node.className = "interior-anchor";
    node.style.left = `${point.left}%`;
    node.style.top = `${point.top}%`;
    node.title = anchor.kind;
    scene.append(node);
  }
  const player = document.createElement("div");
  player.id = "interior-player";
  player.className = "interior-player";
  player.setAttribute("aria-label", "Protagonist position");
  scene.append(player);
}

function enterSelected() {
  if (!selected) return false;
  const base = residency.enter(selected),
    prior = seenSignatures.get(selected.code);
  reconstructed = prior === base.signature;
  seenSignatures.set(selected.code, base.signature);
  active = { building: selected, base };
  px = base.entry.x;
  pz = Math.min(base.depth / 2 - 0.35, base.entry.z - 0.25);
  lastAction = reconstructed ? "Reconstructed canonical interior" : "";
  renderInterior(base);
  $("interior-title").textContent = `${selected.role.replace("-", " ")} interior`;
  $("interior-code").textContent = selected.code;
  $("interior-signature").textContent = base.signature;
  $("interior-room-count").textContent = `${base.rooms.length} usable space${base.rooms.length === 1 ? "" : "s"}`;
  $("interior-panel").hidden = false;
  $("cell-panel").hidden = true;
  document.body.classList.add("interior-open");
  updatePlayer();
  $("exit-interior").focus();
  return true;
}

function exitInterior() {
  if (!active) return false;
  residency.evict(active.building.code);
  active = undefined;
  lastAction = "";
  $("interior-panel").hidden = true;
  document.body.classList.remove("interior-open");
  $("cell-panel").hidden = false;
  $("enter-building").focus();
  return true;
}

function stateSnapshot() {
  const room = currentRoom();
  return {
    selected: selected?.code ?? null,
    active: active
      ? {
          ...active.base,
          role: active.building.role,
        }
      : null,
    currentRoom: room?.code ?? null,
    availableConnections: connections(),
    lastAction,
    reconstructed,
    cache: residency.stats(),
  };
}

function initialize() {
  const enter = $<HTMLButtonElement>("enter-building"),
    controls = $("interior-panel").querySelector(".interior-controls");
  if (!controls) throw new Error("interior controls missing");
  const use = document.createElement("button");
  use.id = "interior-use";
  use.type = "button";
  use.textContent = "Use destination";
  use.disabled = true;
  use.addEventListener("click", useAnchor);
  controls.insertBefore(use, controls.querySelector(".interior-pad"));

  enter.onclick = enterSelected;
  $("exit-interior").onclick = exitInterior;
  const movementControls: [string, number, number][] = [
    ["interior-north", 0, -1],
    ["interior-west", -1, 0],
    ["interior-south", 0, 1],
    ["interior-east", 1, 0],
  ];
  for (const [id, dx, dz] of movementControls) $(id).addEventListener("click", () => move(dx, dz));

  window.addEventListener("advisor:building-selected", ((event: CustomEvent<BuildingSelectionDetail>) => {
    selected = event.detail.building;
    enter.hidden = !selected;
    if (selected) {
      enter.textContent = `Enter ${selected.role.replace("-", " ")}`;
      enter.setAttribute("aria-label", `Enter selected ${selected.role.replace("-", " ")} building`);
    }
  }) as EventListener);

  window.addEventListener("keydown", (event) => {
    if (!active) return;
    const key = event.key.toLowerCase();
    if (key === "escape") {
      event.preventDefault();
      exitInterior();
      return;
    }
    if (key === "f" || key === "enter") {
      if (useAnchor()) event.preventDefault();
      return;
    }
    const direction =
      key === "arrowup" || key === "w"
        ? [0, -1]
        : key === "arrowleft" || key === "a"
          ? [-1, 0]
          : key === "arrowdown" || key === "s"
            ? [0, 1]
            : key === "arrowright" || key === "d"
              ? [1, 0]
              : undefined;
    if (direction) {
      event.preventDefault();
      move(direction[0], direction[1]);
    }
  });

  const api = {
    stats: () => residency.stats(),
    active: () => active?.base ?? null,
    enterSelected,
    exit: exitInterior,
    move,
    moveThrough,
    useAnchor,
  };
  Object.defineProperty(api, "state", { get: stateSnapshot });
  Object.defineProperty(window, "advisorInteriors", {
    configurable: true,
    value: api,
  });
}

initialize();
