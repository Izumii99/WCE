import { SDK, HOOK_PRIORITIES } from "../util/modding";
import { logInfo, logError } from "../util/logger";

interface RemoteAnimState {
  cycles: number;
  maxCycles: number;
  delay: number;
  timer: ReturnType<typeof setTimeout> | null;
  state: number; // 0 or 1 for alternating
  originalPose: readonly string[];
}

const remoteAnims = new Map<number, RemoteAnimState>();

export default function petsuitAnimation(): void {
  // 1. Hook ChatRoomMessage to receive the Hidden message and start the local animation loop
  SDK.hookFunction("ChatRoomMessage", HOOK_PRIORITIES.Top, (args, next) => {
    const data = args[0];
    if (data && data.Type === "Hidden" && data.Content === "WCE_PetsuitAnim") {
      const sender = data.Sender;
      const char = ChatRoomCharacter.find((c) => c.MemberNumber === sender);
      
      if (char && data.Dictionary && data.Dictionary.length > 0) {
        const payload = data.Dictionary[0];
        const delay = payload.delay || 350;
        const maxCycles = payload.maxCycles || 4;

        if (remoteAnims.has(sender)) {
          const existing = remoteAnims.get(sender);
          if (existing?.timer) clearTimeout(existing.timer);
          remoteAnims.delete(sender);
        }

        const animState: RemoteAnimState = {
          cycles: 0,
          maxCycles: maxCycles,
          delay: delay,
          timer: null,
          state: 0,
          originalPose: [...(char.Pose || [])]
        };

        remoteAnims.set(sender, animState);

        const loop = () => {
          const currentAnim = remoteAnims.get(sender);
          if (!currentAnim || currentAnim.cycles >= currentAnim.maxCycles) {
            remoteAnims.delete(sender);
            CharacterRefresh(char, false);
            return;
          }

          currentAnim.state = currentAnim.state === 0 ? 1 : 0;
          currentAnim.cycles++;
          CharacterRefresh(char, false);
          
          currentAnim.timer = setTimeout(loop, currentAnim.delay);
        };

        loop();
        return; // Don't forward this hidden message down the chain
      }
    }
    return next(args);
  });

  // 2. Hook CharacterAppearanceBuildCanvas to intercept drawing
  SDK.hookFunction("CharacterAppearanceBuildCanvas", HOOK_PRIORITIES.Top, (args, next) => {
    const C = args[0] as Character;
    if (!C || !C.MemberNumber) return next(args);

    const anim = remoteAnims.get(C.MemberNumber);
    if (!anim) return next(args);

    // Make sure we have an active petsuit
    const suit = InventoryGet(C, "Suit");
    if (!suit || !suit.Asset || suit.Asset.Name !== "PetSuit") return next(args);

    const leftPose = anim.state === 0 ? "OverTheHead" : "BackElbowTouch";
    const rightPose = anim.state === 0 ? "BackElbowTouch" : "OverTheHead";

    // Setup temporary canvases
    const tempCanvasA = document.createElement("canvas");
    tempCanvasA.width = C.Canvas.width;
    tempCanvasA.height = C.Canvas.height;
    const tempCtxA = tempCanvasA.getContext("2d");

    const tempCanvasB = document.createElement("canvas");
    tempCanvasB.width = C.Canvas.width;
    tempCanvasB.height = C.Canvas.height;
    const tempCtxB = tempCanvasB.getContext("2d");

    const originalCanvas = C.Canvas;

    // CRITICAL BYPASS 1: Native Pose Forcing (SetPose Stripping)
    const originalAssetSetPose = suit.Asset.SetPose;
    const originalPropertySetPose = suit.Property ? suit.Property.SetPose : null;
    suit.Asset.SetPose = null;
    if (suit.Property) suit.Property.SetPose = undefined;

    // We intercept UpdateOverrides to force our target poses, ignoring dependencies
    const origUpdateOverrides = window.CharacterAppearanceUpdateOverrides;
    
    // CRITICAL BYPASS 2: Native 404 Abort Mechanism (DrawGetImage Intercept)
    const origDrawGetImage = window.DrawGetImage;
    const dummyImage = new Image(1, 1);
    dummyImage.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    
    window.DrawGetImage = function(src: string) {
      const img = origDrawGetImage(src);
      return img !== undefined ? img : dummyImage;
    };

    try {
      // 1. Draw Left Side (Pose A)
      window.CharacterAppearanceUpdateOverrides = function(char) {
        char.Pose = [leftPose];
        char.DrawPoseMapping = char.DrawPoseMapping || {};
        char.DrawPoseMapping.BodyUpper = leftPose;
      };
      C.Canvas = tempCanvasA;
      next(args);

      // 2. Draw Right Side (Pose B)
      window.CharacterAppearanceUpdateOverrides = function(char) {
        char.Pose = [rightPose];
        char.DrawPoseMapping = char.DrawPoseMapping || {};
        char.DrawPoseMapping.BodyUpper = rightPose;
      };
      C.Canvas = tempCanvasB;
      next(args);

      // Splice them together onto the original canvas
      C.Canvas = originalCanvas;
      const ctx = C.Canvas.getContext("2d");
      if (ctx && tempCtxA && tempCtxB) {
        ctx.clearRect(0, 0, C.Canvas.width, C.Canvas.height);
        // Left half from A
        ctx.drawImage(tempCanvasA, 0, 0, C.Canvas.width / 2, C.Canvas.height, 0, 0, C.Canvas.width / 2, C.Canvas.height);
        // Right half from B
        ctx.drawImage(tempCanvasB, C.Canvas.width / 2, 0, C.Canvas.width / 2, C.Canvas.height, C.Canvas.width / 2, 0, C.Canvas.width / 2, C.Canvas.height);
      }
      
    } finally {
      // Restore everything
      window.CharacterAppearanceUpdateOverrides = origUpdateOverrides;
      window.DrawGetImage = origDrawGetImage;
      suit.Asset.SetPose = originalAssetSetPose;
      if (suit.Property && originalPropertySetPose !== undefined) suit.Property.SetPose = originalPropertySetPose;
      C.Canvas = originalCanvas;
      
      // Cleanup the overrides to let native rendering stabilize later
      origUpdateOverrides(C); 
    }

    // We do NOT return next(args) here because we already executed it in the try block
    return null; 
  });
}
