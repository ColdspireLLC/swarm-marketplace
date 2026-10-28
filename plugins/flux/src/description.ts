// Descriptions written from the CLI. A description is a live Yjs document
// (Flux's, which the plugin's editor joins too), and its HTML is only a
// snapshot of it, so a new description has to go into the document: the
// HTML is parsed with Flux's schema, and its difference from the document
// sent to the issue's room, as an editor's edit would be. Parsing and
// serializing HTML needs a DOM, so domino (Turndown's) stands in for one.
// @ts-expect-error domino's declarations are no module, for its CommonJS
import domino_ from "@mixmark-io/domino";
import { getSchema } from "@tiptap/core";
import {
  DOMParser,
  DOMSerializer,
  type Node as PMNode,
  type Schema,
} from "@tiptap/pm/model";
import {
  prosemirrorToYXmlFragment,
  updateYFragment,
  yXmlFragmentToProseMirrorRootNode,
} from "@tiptap/y-tiptap";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

import { documentSchemaExtensions } from "./editor-schema";

const domino = domino_ as unknown as {
  createDocument(html?: string, force?: boolean): Document;
};

/** The Yjs fragment Flux's editor binds to. */
const FRAGMENT = "default";
/** y-websocket's message types. */
const MESSAGE_SYNC = 0;
/** The most Flux takes in one message from a client (wsMaxFrame). */
const MAX_MESSAGE_BYTES = 64 << 10;
const SYNC_TIMEOUT_MS = 15_000;

let schema: Schema | null = null;

function documentSchema(): Schema {
  if (!schema) {
    // TipTap spreads `classList`, and domino's isn't iterable.
    const tokens = Object.getPrototypeOf(
      domino.createDocument("").createElement("div").classList,
    ) as { [Symbol.iterator]?: unknown };
    tokens[Symbol.iterator] ??= Array.prototype[Symbol.iterator];
    schema = getSchema(documentSchemaExtensions());
  }
  return schema;
}

export interface ParsedDescription {
  doc: PMNode;
  /** The description as Flux's editor saves it. */
  html: string;
}

/** HTML read through Flux's schema, as its editor would load it. */
export function parseDescription(html: string): ParsedDescription {
  const schema = documentSchema();
  const document = domino.createDocument(
    `<!doctype html><html><body>${html}</body></html>`,
    true,
  );
  const doc = DOMParser.fromSchema(schema).parse(document.body);
  return { doc, html: serialize(doc, document) };
}

function serialize(doc: PMNode, document: Document): string {
  const fragment = DOMSerializer.fromSchema(doc.type.schema).serializeFragment(
    doc.content,
    { document },
  );
  const container = document.createElement("div");
  container.appendChild(fragment);
  return container.innerHTML;
}

/** A live document's description as HTML, as Flux's editor saves it. */
export function descriptionHtml(ydoc: Y.Doc): string {
  const doc = yXmlFragmentToProseMirrorRootNode(
    ydoc.getXmlFragment(FRAGMENT),
    documentSchema(),
  );
  return serialize(doc, domino.createDocument("", true));
}

/** A Yjs document holding just this description, for seeding the room. */
export function descriptionState(doc: PMNode): Uint8Array {
  const ydoc = new Y.Doc();
  prosemirrorToYXmlFragment(doc, ydoc.getXmlFragment(FRAGMENT));
  const state = Y.encodeStateAsUpdate(ydoc);
  ydoc.destroy();
  return state;
}

/**
 * Turns `ydoc`'s description into `doc`, changing only what differs (so it
 * merges with edits others make meanwhile), and returns that change, or
 * null when there's none.
 */
export function updateDescription(ydoc: Y.Doc, doc: PMNode): Uint8Array | null {
  const before = Y.encodeStateVector(ydoc);
  updateYFragment(ydoc, ydoc.getXmlFragment(FRAGMENT), doc, {
    mapping: new Map(),
    isOMark: new Map(),
  });
  const update = Y.encodeStateAsUpdate(ydoc, before);
  // An update with no structs and no deletes is two zero bytes.
  return update.length > 2 ? update : null;
}

/**
 * Replaces the description in the issue's live room: syncs with it, sends
 * the difference, and waits until Flux has taken it (its answer to a sync
 * sent after the edit). `state` is the room's copy from the seed.
 */
export async function writeLiveDescription(
  target: { url: string; headers: Record<string, string> },
  state: Uint8Array,
  doc: PMNode,
): Promise<void> {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, state);
  // Node's WebSocket takes headers alongside the protocols.
  const socket = new WebSocket(target.url, {
    headers: target.headers,
  } as unknown as string[]);
  socket.binaryType = "arraybuffer";
  try {
    await new Promise<void>((resolve, reject) => {
      let phase: "syncing" | "confirming" = "syncing";
      const timer = setTimeout(
        () => reject(new Error("Flux didn't answer in time.")),
        SYNC_TIMEOUT_MS,
      );
      const fail = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
      const send = (write: (encoder: encoding.Encoder) => void) => {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        write(encoder);
        const message = encoding.toUint8Array(encoder);
        if (message.length > MAX_MESSAGE_BYTES) {
          throw new Error(
            "This description is too long for Flux to take in one edit.",
          );
        }
        socket.send(message);
      };
      socket.onopen = () =>
        send((encoder) => syncProtocol.writeSyncStep1(encoder, ydoc));
      socket.onerror = () =>
        fail(new Error("Couldn't reach the issue's document."));
      socket.onclose = (event) =>
        fail(
          new Error(
            event.code === 4404
              ? "That issue is gone from Flux."
              : `Flux closed the issue's document${event.reason ? ` (${event.reason})` : ""}.`,
          ),
        );
      socket.onmessage = (event) => {
        try {
          const decoder = decoding.createDecoder(
            new Uint8Array(event.data as ArrayBuffer),
          );
          if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
          // Flux's own SyncStep1 is answered with what it lacks (nothing).
          const reply = encoding.createEncoder();
          encoding.writeVarUint(reply, MESSAGE_SYNC);
          const kind = syncProtocol.readSyncMessage(decoder, reply, ydoc, null);
          if (encoding.length(reply) > 1)
            socket.send(encoding.toUint8Array(reply));
          if (kind !== syncProtocol.messageYjsSyncStep2) return;
          if (phase === "confirming") {
            clearTimeout(timer);
            resolve();
            return;
          }
          const update = updateDescription(ydoc, doc);
          if (!update) {
            clearTimeout(timer);
            resolve();
            return;
          }
          send((encoder) => syncProtocol.writeUpdate(encoder, update));
          phase = "confirming";
          send((encoder) => syncProtocol.writeSyncStep1(encoder, ydoc));
        } catch (cause) {
          fail(cause instanceof Error ? cause : new Error(String(cause)));
        }
      };
    });
  } finally {
    socket.onclose = null;
    socket.onmessage = null;
    socket.close(1000);
    ydoc.destroy();
  }
}
