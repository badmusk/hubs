import { addMedia } from "../utils/media-utils";
import { ObjectTypes } from "../object-types";
import { paths } from "../systems/userinput/paths";

import cameraModelSrc from "../assets/camera_tool.glb";

const cameraModelPromise = new Promise(resolve => new THREE.GLTFLoader().load(cameraModelSrc, resolve));

const pathsMap = {
  "player-right-controller": {
    takeSnapshot: paths.actions.rightHand.takeSnapshot
  },
  "player-left-controller": {
    takeSnapshot: paths.actions.leftHand.takeSnapshot
  },
  cursor: {
    takeSnapshot: paths.actions.cursor.takeSnapshot
  }
};

const snapCanvas = document.createElement("canvas");
async function pixelsToPNG(pixels, width, height) {
  snapCanvas.width = width;
  snapCanvas.height = height;
  const context = snapCanvas.getContext("2d");

  const imageData = context.createImageData(width, height);
  imageData.data.set(pixels);
  const bitmap = await createImageBitmap(imageData);
  context.scale(1, -1);
  context.drawImage(bitmap, 0, -height);
  const blob = await new Promise(resolve => snapCanvas.toBlob(resolve));
  return new File([blob], "snap.png", { type: "image/png" });
}

AFRAME.registerComponent("camera-tool", {
  schema: {
    previewFPS: { default: 6 },
    imageWidth: { default: 1024 },
    imageHeight: { default: 1024 / (16 / 9) }
  },

  init() {
    this.stateAdded = this.stateAdded.bind(this);

    this.lastUpdate = performance.now();

    this.renderTarget = new THREE.WebGLRenderTarget(this.data.imageWidth, this.data.imageHeight, {
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.NearestFilter,
      encoding: THREE.sRGBEncoding,
      depth: false,
      stencil: false
    });

    this.camera = new THREE.PerspectiveCamera(50, this.renderTarget.width / this.renderTarget.height, 0.1, 30000);
    this.camera.rotation.set(0, Math.PI, 0);
    this.el.setObject3D("camera", this.camera);

    const material = new THREE.MeshBasicMaterial({
      map: this.renderTarget.texture
    });

    // Bit of a hack here to only update the renderTarget when the screens are in view and at a reduced FPS
    material.map.isVideoTexture = true;
    material.map.update = () => {
      if (performance.now() - this.lastUpdate >= 1000 / this.data.previewFPS) {
        this.updateRenderTargetNextTick = true;
      }
    };

    cameraModelPromise.then(model => {
      const mesh = model.scene.clone();
      mesh.scale.set(2, 2, 2);
      mesh.matrixNeedsUpdate = true;
      this.el.setObject3D("mesh", mesh);

      const width = 0.28;
      const geometry = new THREE.PlaneGeometry(width, width / this.camera.aspect);

      const screen = new THREE.Mesh(geometry, material);
      screen.rotation.set(0, Math.PI, 0);
      screen.position.set(0, 0, -0.042);
      screen.matrixNeedsUpdate = true;
      this.el.setObject3D("screen", screen);

      const selfieScreen = new THREE.Mesh(geometry, material);
      selfieScreen.position.set(0, 0.4, 0);
      selfieScreen.scale.set(-2, 2, 2);
      selfieScreen.matrixNeedsUpdate = true;
      this.el.setObject3D("selfieScreen", selfieScreen);

      this.cameraSystem = this.el.sceneEl.systems["camera-tools"];
      this.cameraSystem.register(this.el);

      this.updateRenderTargetNextTick = true;
    });
  },

  play() {
    this.el.addEventListener("stateadded", this.stateAdded);
  },

  pause() {
    this.el.removeEventListener("stateadded", this.stateAdded);
  },

  remove() {
    this.cameraSystem.deregister(this.el);
    this.el.sceneEl.systems["camera-mirror"].unmirrorCameraAtEl(this.el);
  },

  stateAdded(evt) {
    if (evt.detail === "activated") {
      this.takeSnapshotNextTick = true;
    }
  },

  focus(el, track) {
    if (track) {
      this.trackTarget = el;
    } else {
      this.trackTarget = null;
    }

    this.lookAt(el);
  },

  lookAt: (function() {
    const targetPos = new THREE.Vector3();
    return function(el) {
      targetPos.setFromMatrixPosition(el.object3D.matrixWorld);
      this.el.object3D.lookAt(targetPos);
      this.el.object3D.matrixNeedsUpdate = true;
    };
  })(),

  mirror() {
    this.el.sceneEl.systems["camera-mirror"].mirrorCameraAtEl(this.el);
  },

  unmirror() {
    this.el.sceneEl.systems["camera-mirror"].unmirrorCameraAtEl(this.el);
  },

  tick() {
    const grabber = this.el.components.grabbable.grabbers[0];
    if (grabber && !!pathsMap[grabber.id]) {
      const paths = pathsMap[grabber.id];
      if (AFRAME.scenes[0].systems.userinput.get(paths.takeSnapshot)) {
        this.takeSnapshotNextTick = true;
      }
    }
  },

  tock: (function() {
    const tempHeadScale = new THREE.Vector3();

    return function tock() {
      const sceneEl = this.el.sceneEl;
      const renderer = this.renderer || sceneEl.renderer;
      const now = performance.now();

      // Perform lookAt in tock so it will re-orient after grabs, etc.
      if (this.trackTarget) {
        if (this.trackTarget.parentNode) {
          this.lookAt(this.trackTarget);
        } else {
          this.trackTarget = null; // Target removed
        }
      }

      if (!this.playerHead) {
        const headEl = document.getElementById("player-head");
        this.playerHead = headEl && headEl.object3D;
      }

      if (!this.playerHud) {
        const hudEl = document.getElementById("player-hud");
        this.playerHud = hudEl && hudEl.object3D;
      }

      if (this.takeSnapshotNextTick || this.updateRenderTargetNextTick) {
        if (this.playerHead) {
          tempHeadScale.copy(this.playerHead.scale);
          this.playerHead.scale.set(1, 1, 1);
          this.playerHead.updateMatrices(true, true);
          this.playerHead.updateMatrixWorld(true, true);
        }

        if (this.playerHud) {
          this.playerHud.visible = false;
        }

        const tmpVRFlag = renderer.vr.enabled;
        const tmpOnAfterRender = sceneEl.object3D.onAfterRender;
        delete sceneEl.object3D.onAfterRender;
        renderer.vr.enabled = false;

        renderer.render(sceneEl.object3D, this.camera, this.renderTarget, true);

        renderer.vr.enabled = tmpVRFlag;
        sceneEl.object3D.onAfterRender = tmpOnAfterRender;
        if (this.playerHead) {
          this.playerHead.scale.copy(tempHeadScale);
          this.playerHead.updateMatrices(true, true);
          this.playerHead.updateMatrixWorld(true, true);
        }
        if (this.playerHud) {
          this.playerHud.visible = true;
        }
        this.lastUpdate = now;
        this.updateRenderTargetNextTick = false;
      }

      if (this.takeSnapshotNextTick) {
        const width = this.renderTarget.width;
        const height = this.renderTarget.height;
        if (!this.snapPixels) {
          this.snapPixels = new Uint8Array(width * height * 4);
        }
        renderer.readRenderTargetPixels(this.renderTarget, 0, 0, width, height, this.snapPixels);
        pixelsToPNG(this.snapPixels, width, height).then(file => {
          const { entity, orientation } = addMedia(file, "#interactable-media", undefined, true);
          entity.object3D.position.copy(this.el.object3D.position).add(new THREE.Vector3(0, -0.5, 0));
          entity.object3D.rotation.copy(this.el.object3D.rotation);
          entity.object3D.matrixNeedsUpdate = true;

          entity.addEventListener(
            "media_resolved",
            () => {
              this.el.emit("photo_taken", entity.components["media-loader"].data.src);
            },
            { once: true }
          );
          orientation.then(() => {
            sceneEl.emit("object_spawned", { objectType: ObjectTypes.CAMERA });
          });
        });
        sceneEl.emit("camera_tool_took_snapshot");
        this.takeSnapshotNextTick = false;
      }
    };
  })()
});
