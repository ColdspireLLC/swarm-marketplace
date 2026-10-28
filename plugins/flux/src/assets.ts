// Flux's uploaded images (backend/internal/server/assets.go): what it accepts, and
// how its documents refer to them. Shared by the plugin's server, which
// uploads and fetches them with the API token, and its app, which shows them.

/** The image types Flux accepts, as its editors' file pickers list them. */
export const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Flux's own error wording for the two limits. */
export const IMAGE_TOO_LARGE = "Images must be 2 MB or smaller";
export const IMAGE_WRONG_TYPE = "Upload a PNG, JPEG, GIF, or WebP image";

/** Where an image is used; Flux's issue editors upload as `issue_image`. */
export const IMAGE_ENTITY_TYPES = ["issue_image", "comment_image"] as const;
export type ImageEntityType = (typeof IMAGE_ENTITY_TYPES)[number];

export const ASSET_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Flux's placeholder for an image a Flux client is still uploading
 * (`flux-local:<id>`, app/src/lib/local/uploads.ts). Only that client can
 * show it; Flux swaps in the uploaded URL once it lands.
 */
export const LOCAL_ASSET_PREFIX = "flux-local:";

export function isImageType(type: string): boolean {
  return (IMAGE_TYPES as readonly string[]).includes(type);
}

/**
 * The asset id when `src` is one of Flux's uploads: `/assets/<id>` as Flux
 * stores it, or that path on the Flux origin (how Markdown spells it).
 */
export function fluxAssetId(
  src: string,
  baseUrl: string | null,
): string | null {
  let path = src.trim();
  if (path.startsWith("/") && !path.startsWith("//")) {
    path = path.split(/[?#]/)[0]!;
  } else {
    if (!baseUrl) return null;
    try {
      const url = new URL(path);
      if (url.origin !== new URL(baseUrl).origin) return null;
      path = url.pathname;
    } catch {
      return null;
    }
  }
  const match = /^\/assets\/([^/]+)$/.exec(path);
  const id = match?.[1];
  return id && ASSET_ID_PATTERN.test(id) ? id.toLowerCase() : null;
}
