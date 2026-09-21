import { openDB, type IDBPDatabase } from "idb";

import { DEFAULT_WARDROBE_SIZE, EXPANDED_WARDROBE_SIZE } from "../util/constants";
import { fbcBeepNotify } from "../util/hooks";
import { logInfo, logError } from "../util/logger";
import { SDK, HOOK_PRIORITIES } from "../util/modding";
import { fbcSettings } from "../util/settings";
import { waitFor, isWardrobe, parseJSON } from "../util/utils";

let localWardrobeDB: IDBPDatabase<{ wardrobe: { key: number; value: { id: number; appearance: ServerItemBundle[] } } }>;
let extendedWardrobeLoaded = false;

/** Convert old {@link ItemProperties.Type} remnants into {@link ItemProperties.TypeRecord} in the passed item bundles.
 * @param {ItemBundle[]} bundleList
 * @returns {ItemBundle[]}
 */
function sanitizeBundles(bundleList: ItemBundle[]): ItemBundle[] {
  if (!Array.isArray(bundleList)) return bundleList;
  return bundleList.map(bundle => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    if (typeof bundle.Property?.Type === "string" && !CommonIsObject(bundle.Property?.TypeRecord)) {
      const asset = AssetGet("Female3DCG", bundle.Group, bundle.Name);
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      if (asset) bundle.Property.TypeRecord = ExtendedItemTypeToRecord(asset, bundle.Property.Type);
    }
    return bundle;
  });
}

export async function loadLocalWardrobe(wardrobe: ItemBundle[][]): Promise<void> {
  localWardrobeDB = await openDB("wce-local-wardrobe", 11, {
    upgrade(db, ov, nv, tx) {
      if (!db.objectStoreNames.contains("wardrobe")) db.createObjectStore("wardrobe", { keyPath: "id" });
      for (const idx of tx.objectStore("wardrobe").indexNames) tx.objectStore("wardrobe").deleteIndex(idx);
    },
  });
  const localWardrobe = (await localWardrobeDB.getAll("wardrobe")) || [];
  await waitFor(() => wardrobe.length === EXPANDED_WARDROBE_SIZE);
  wardrobe.push(...localWardrobe.map(w => sanitizeBundles(w.appearance)));
}

async function saveLocalWardrobe(wardrobe: ServerItemBundle[][]): Promise<void> {
  const store = localWardrobeDB.transaction("wardrobe", "readwrite").objectStore("wardrobe");
  await Promise.all(wardrobe.map((appearance, id) => store.put({ id, appearance })));
}

export async function loadExtendedWardrobe(wardrobe: ItemBundle[][], init: boolean): Promise<ItemBundle[][]> {
  // Option A bypass: letting R132 native system handle wardrobe entirely
  return wardrobe;
}

export default async function extendedWardrobe(): Promise<void> {
  // Option A bypass: disabling legacy Extended Wardrobe hooks to prevent clashing with R132 WardrobeCharacterNames
  return;
}
