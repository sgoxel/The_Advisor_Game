import * as pc from "playcanvas";
import { PLANET_RADIUS, unitToLonLat, type Unit } from "./planet.ts";
import { coordinateValue } from "./world.ts";

/** Longitude / latitude segments of the sphere: 96 × 48 quads, 3.75° each. */
const LON_SEGMENTS = 96;
const LAT_SEGMENTS = 48;
/** The shading overlay is one radial fan; its texture runs centre → edge along U. */
const SHADE_SEGMENTS = 128;
const SHADE_TEXELS = 2048;
/** Outer edge of the halo, in globe radii. */
const SHADE_REACH = 2.4;
/** The camera sits two radii above the centre, one radius above the surface. */
const CAMERA_HEIGHT = PLANET_RADIUS * 2;
const CAMERA_FAR = PLANET_RADIUS * 3;
/** Display colours (sRGB bytes): desk ink, sea placeholder, rim light, halo. */
const INK = [15, 26, 23];
const SEA = [94, 137, 139];
const RIM = [240, 222, 180];
const HALO = [214, 190, 140];
const DEG = 180 / Math.PI;
/** Camera rotation that looks down -Y with screen-up = -Z. */
const DOWN = new pc.Quat().setFromEulerAngles(-90, 0, 0);

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** UV sphere whose vertices sit exactly on the equirectangular texel grid:
 * u = (lon + π) / 2π, v = (π/2 − lat) / π, position = lonLatToUnit(lon, lat).
 * The ±180° meridian has two vertex columns (u = 0 and u = 1) so U never jumps,
 * and each pole is one vertex per column with u at the column centre. */
function sphereMesh(device: pc.GraphicsDevice): pc.Mesh {
  const columns = LON_SEGMENTS + 1,
    count = columns * (LAT_SEGMENTS + 1);
  const positions = new Float32Array(count * 3),
    uvs = new Float32Array(count * 2),
    indices = new Uint16Array(LON_SEGMENTS * (LAT_SEGMENTS * 2 - 2) * 3);
  for (let j = 0, v = 0; j <= LAT_SEGMENTS; j++) {
    const pole = j === 0 || j === LAT_SEGMENTS,
      lat = Math.PI / 2 - (j / LAT_SEGMENTS) * Math.PI,
      y = j === 0 ? 1 : j === LAT_SEGMENTS ? -1 : Math.sin(lat),
      ring = pole ? 0 : Math.cos(lat);
    for (let i = 0; i <= LON_SEGMENTS; i++, v++) {
      // The seam column repeats the first column's position bit for bit.
      const lon = ((i % LON_SEGMENTS) / LON_SEGMENTS) * 2 * Math.PI - Math.PI;
      positions[v * 3] = ring * Math.sin(lon);
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = ring * Math.cos(lon);
      uvs[v * 2] = (pole ? i + 0.5 : i) / LON_SEGMENTS;
      uvs[v * 2 + 1] = j / LAT_SEGMENTS;
    }
  }
  let n = 0;
  for (let j = 0; j < LAT_SEGMENTS; j++)
    for (let i = 0; i < LON_SEGMENTS; i++) {
      const a = j * columns + i,
        b = a + 1,
        c = a + columns,
        d = c + 1;
      if (j === 0) {
        indices[n++] = a;
        indices[n++] = c;
        indices[n++] = d;
      } else {
        indices[n++] = a;
        indices[n++] = c;
        indices[n++] = b;
        if (j < LAT_SEGMENTS - 1) {
          indices[n++] = b;
          indices[n++] = c;
          indices[n++] = d;
        }
      }
    }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(positions);
  mesh.setUvs(0, uvs);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

/** Unit disc in the XZ plane, fanned from the centre: u = radius, v = 0.5. */
function fanMesh(device: pc.GraphicsDevice): pc.Mesh {
  // Screen-facing XY disc; GlobeView.placeCamera gives it the camera rotation.
  const positions = new Float32Array((SHADE_SEGMENTS + 1) * 3),
    normals = new Float32Array((SHADE_SEGMENTS + 1) * 3),
    uvs = new Float32Array((SHADE_SEGMENTS + 1) * 2),
    indices = new Uint16Array(SHADE_SEGMENTS * 3);
  normals[2] = 1;
  uvs[1] = 0.5;
  for (let i = 0; i < SHADE_SEGMENTS; i++) {
    const angle = (i / SHADE_SEGMENTS) * 2 * Math.PI,
      v = i + 1;
    positions[v * 3] = Math.cos(angle);
    positions[v * 3 + 1] = Math.sin(angle);
    normals[v * 3 + 2] = 1;
    uvs[v * 2] = 1;
    uvs[v * 2 + 1] = 0.5;
    indices[i * 3] = 0;
    indices[i * 3 + 1] = ((i + 1) % SHADE_SEGMENTS) + 1;
    indices[i * 3 + 2] = v;
  }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setUvs(0, uvs);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

/** Radial shading profile, one texel row from the globe centre to SHADE_REACH radii.
 * Two layers are composited into straight-alpha RGBA: an ink veil that darkens the
 * limb and melts the silhouette into the backdrop, and a warm rim light with a wide,
 * faint halo. Quantisation is dithered by a coordinate hash, never a random stream. */
function shadePixels(): Uint8Array {
  const pixels = new Uint8Array(SHADE_TEXELS * 4);
  const dither = (i: number, channel: number) =>
    coordinateValue(i, channel, 977) / 4294967296;
  for (let i = 0; i < SHADE_TEXELS; i++) {
    const r = ((i + 0.5) / SHADE_TEXELS) * SHADE_REACH;
    if (r < 0.1) continue; // The centre of the map is left untouched.
    const inside = r <= 1,
      mu = inside ? Math.sqrt(1 - r * r) : 0;
    const veil = inside
      ? 0.6 * (1 - mu) ** 1.5 + 0.35 * smoothstep(0.988, 1, r)
      : 0.95 * (1 - smoothstep(1.004, 1.02, r));
    const line = Math.exp(-(((r - 0.996) / (r < 0.996 ? 0.014 : 0.009)) ** 2));
    const rim =
      0.36 * line + 0.08 * Math.exp(-Math.abs(r - 1) / (inside ? 0.06 : 0.012));
    const halo = inside
      ? 0.075 * Math.exp((r - 1) / 0.02)
      : 0.075 *
        Math.exp((1 - r) / 0.34) *
        (1 - smoothstep(1.5, SHADE_REACH - 0.02, r));
    const light = rim + halo * (1 - rim),
      alpha = 1 - (1 - veil) * (1 - light);
    if (alpha <= 0) continue;
    for (let c = 0; c < 3; c++) {
      const glow = (RIM[c] * rim + HALO[c] * halo * (1 - rim)) / (light || 1),
        value = (INK[c] * veil * (1 - light) + glow * light) / alpha;
      pixels[i * 4 + c] = Math.min(255, Math.floor(value + dither(i, c)));
    }
    pixels[i * 4 + 3] = Math.min(255, Math.floor(alpha * 255 + dither(i, 3)));
  }
  return pixels;
}

/** Unlit material that shows its emissive map exactly as stored. The textures are
 * RGBA8 (not SRGBA8) on purpose: the engine then decodes with pow 2.2 and encodes
 * with pow 1/2.2, an exact round trip, whereas a hardware sRGB decode does not match
 * the pow 1/2.2 output and lifts dark colours by several levels. */
function flatMaterial(name: string): pc.StandardMaterial {
  const material = new pc.StandardMaterial();
  material.name = name;
  material.diffuse = new pc.Color(0, 0, 0);
  material.specular = new pc.Color(0, 0, 0);
  material.emissive = new pc.Color(1, 1, 1);
  material.useLighting = false;
  material.useSkybox = false;
  material.useFog = false;
  material.useTonemap = false;
  return material;
}

/** The Realm-scale globe: one textured sphere, one shading fan, two small textures. */
export class GlobeView {
  /** Everything the globe draws hangs under this entity. Hidden until setVisible(true). */
  readonly root: pc.Entity;
  /** Camera clear colour to use while the globe is shown. */
  readonly backdropColor = new pc.Color(
    INK[0] / 255,
    INK[1] / 255,
    INK[2] / 255,
  );
  readonly stats = { triangles: 0, textureWidth: 0, textureHeight: 0 };
  private readonly device: pc.GraphicsDevice;
  private readonly sphere: pc.Entity;
  private readonly surfaceMaterial: pc.StandardMaterial;
  private readonly shadeMaterial: pc.StandardMaterial;
  private readonly shadeTexture: pc.Texture;
  private surfaceTexture: pc.Texture;
  get surface(): pc.Texture { return this.surfaceTexture; }
  private readonly rotation = new pc.Quat();
  private readonly turn = new pc.Quat();
  private readonly point = new pc.Vec3();
  private readonly viewAxis = new pc.Vec3(0, 1, 0);
  private readonly shade: pc.Entity;

  constructor(app: pc.AppBase) {
    const device = (this.device = app.graphicsDevice);
    this.root = new pc.Entity("Globe");
    this.root.enabled = false;

    this.surfaceTexture = this.createSurface(
      2,
      1,
      new Uint8Array([...SEA, 255, ...SEA, 255]),
    );
    this.surfaceMaterial = flatMaterial("Globe surface");
    this.surfaceMaterial.emissiveMap = this.surfaceTexture;
    this.surfaceMaterial.cull = pc.CULLFACE_BACK;
    this.surfaceMaterial.update();
    const sphere = sphereMesh(device);
    this.sphere = new pc.Entity("Globe surface");
    this.sphere.addComponent("render", {
      meshInstances: [new pc.MeshInstance(sphere, this.surfaceMaterial)],
      castShadows: false,
      receiveShadows: false,
    });
    this.sphere.setLocalScale(PLANET_RADIUS, PLANET_RADIUS, PLANET_RADIUS);
    this.root.addChild(this.sphere);

    this.shadeTexture = new pc.Texture(device, {
      name: "Globe shading",
      width: SHADE_TEXELS,
      height: 1,
      format: pc.PIXELFORMAT_RGBA8,
      mipmaps: false,
      minFilter: pc.FILTER_LINEAR,
      magFilter: pc.FILTER_LINEAR,
      addressU: pc.ADDRESS_CLAMP_TO_EDGE,
      addressV: pc.ADDRESS_CLAMP_TO_EDGE,
      flipY: false,
      levels: [shadePixels()],
    });
    this.shadeMaterial = flatMaterial("Globe shading");
    this.shadeMaterial.emissiveMap = this.shadeTexture;
    this.shadeMaterial.opacityMap = this.shadeTexture;
    this.shadeMaterial.opacityMapChannel = "a";
    this.shadeMaterial.blendType = pc.BLEND_NORMAL;
    this.shadeMaterial.depthTest = false;
    this.shadeMaterial.depthWrite = false;
    this.shadeMaterial.cull = pc.CULLFACE_NONE;
    this.shadeMaterial.update();
    // Drawn after the sphere (transparent pass) with no depth test: it can never
    // z-fight. It lies flat above the globe because the camera looks straight down.
    const fan = fanMesh(device);
    const shade = (this.shade = new pc.Entity("Globe shading"));
    shade.addComponent("render", {
      meshInstances: [new pc.MeshInstance(fan, this.shadeMaterial)],
      castShadows: false,
      receiveShadows: false,
    });
    const reach = PLANET_RADIUS * SHADE_REACH;
    shade.setLocalScale(reach, reach, 1);
    shade.setLocalPosition(0, PLANET_RADIUS * 1.25, 0);
    this.root.addChild(shade);

    this.stats.triangles =
      LON_SEGMENTS * (LAT_SEGMENTS * 2 - 2) + SHADE_SEGMENTS;
    this.orient(0, 0, 0);
    app.root.addChild(this.root);
  }

  private createSurface(width: number, height: number, pixels: Uint8Array) {
    this.stats.textureWidth = width;
    this.stats.textureHeight = height;
    return new pc.Texture(this.device, {
      name: "Globe surface",
      width,
      height,
      format: pc.PIXELFORMAT_RGBA8,
      mipmaps: true,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
      magFilter: pc.FILTER_LINEAR,
      anisotropy: Math.min(8, this.device.maxAnisotropy),
      addressU: pc.ADDRESS_REPEAT,
      addressV: pc.ADDRESS_CLAMP_TO_EDGE,
      // Row 0 of the pixel array is v = 0, the north edge, on both backends.
      flipY: false,
      levels: [pixels],
    });
  }

  /** Replace the surface image. Destroys the previous texture. Safe to call repeatedly.
   * The pixel array is kept by the texture (for re-upload after a lost device). */
  setSurface(surface: { width: number; height: number; pixels: Uint8Array }) {
    const { width, height, pixels } = surface;
    if (
      !Number.isInteger(height) ||
      height < 1 ||
      width !== height * 2 ||
      pixels.length !== width * height * 4
    )
      throw Error(
        `Globe surface must be equirectangular RGBA8 (width = 2 × height); got ${width} × ${height} with ${pixels.length} bytes.`,
      );
    if (width > this.device.maxTextureSize)
      throw Error(
        `Globe surface is ${width} px wide; this device allows ${this.device.maxTextureSize}.`,
      );
    const previous = this.surfaceTexture;
    this.surfaceTexture = this.createSurface(width, height, pixels);
    this.surfaceMaterial.emissiveMap = this.surfaceTexture;
    this.surfaceMaterial.update();
    previous.destroy();
  }

  setBlend(alpha: number) {
    const value = Math.max(0, Math.min(1, alpha));
    if (this.shadeMaterial.opacity === value) return;
    this.surfaceMaterial.opacity = value > 0 ? 1 : 0;
    this.surfaceMaterial.blendType = pc.BLEND_NONE;
    this.surfaceMaterial.depthWrite = value >= 0.999;
    this.surfaceMaterial.update();
    this.shade.enabled = value > 0.001;
    this.shadeMaterial.opacity = value;
    this.shadeMaterial.update();
  }

  setVisible(visible: boolean) {
    this.root.enabled = visible;
  }

  /** Turn the globe so that (lon, lat) faces the camera at the centre of the view with
   * north up, then roll the picture by `yaw` radians about the view axis. The roll has
   * the flat map's sense: the compass direction at the top of the screen is north turned
   * `yaw` toward the west, so a positive yaw turns the picture clockwise. */
  orient(lon: number, lat: number, yaw: number) {
    this.rotation
      .setFromAxisAngle(pc.Vec3.UP, -yaw * DEG)
      .mul(this.turn.setFromAxisAngle(pc.Vec3.RIGHT, lat * DEG - 90))
      .mul(this.turn.setFromAxisAngle(pc.Vec3.UP, -lon * DEG));
    this.sphere.setLocalRotation(this.rotation);
  }

  /** Use the same fixed 60°-above-ground camera angle as the flat presentation.
   * The focused surface point remains at the screen centre at every zoom. */
  placeCamera(camera: pc.Entity, halfHeight: number, yaw: number) {
    const lens = camera.camera!,
      distance = halfHeight * 2.2 + 200,
      target = new pc.Vec3(0, PLANET_RADIUS, 0),
      position = new pc.Vec3(
        Math.sin(yaw) * distance * 0.5,
        PLANET_RADIUS + distance * Math.sin(Math.PI / 3),
        Math.cos(yaw) * distance * 0.5,
      );
    camera.setPosition(position);
    camera.lookAt(target);
    lens.orthoHeight = halfHeight;
    lens.farClip = Math.max(lens.farClip, PLANET_RADIUS * 6 + distance);
    this.viewAxis.copy(position).sub(target).normalize();
    // The radial halo is a camera-facing overlay centred on the projected sphere disc.
    const centreToCamera = position.clone().normalize();
    this.shade.setPosition(centreToCamera.mulScalar(PLANET_RADIUS * 1.25));
    this.shade.setRotation(camera.getRotation());
    lens.onAppPrerender();
  }

  /** World position of the surface point (lon, lat) under the current orientation.
   * Returns false when that point is on the far side (not visible to the camera). */
  worldPoint(lon: number, lat: number, out: pc.Vec3): boolean {
    const c = Math.cos(lat);
    this.point.set(c * Math.sin(lon), Math.sin(lat), c * Math.cos(lon));
    this.rotation.transformVector(this.point, out).mulScalar(PLANET_RADIUS);
    return out.dot(this.viewAxis) > 0;
  }

  frontness(point: pc.Vec3): number {
    return point.dot(this.viewAxis) / PLANET_RADIUS;
  }

  coordinatesOf(point: pc.Vec3) {
    const local = this.rotation
      .clone()
      .invert()
      .transformVector(point, new pc.Vec3());
    return unitToLonLat([local.x, local.y, local.z] as Unit);
  }

  destroy() {
    this.root.destroy();
    this.surfaceMaterial.destroy();
    this.shadeMaterial.destroy();
    this.surfaceTexture.destroy();
    this.shadeTexture.destroy();
  }
}
