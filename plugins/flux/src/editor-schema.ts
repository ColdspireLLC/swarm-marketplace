// Flux's description schema without the editor: the nodes, marks,
// attributes, and HTML that the plugin's editor (app/editor/kit.tsx) and
// the plugin server (which writes agents' descriptions into the same Yjs
// documents) share. It must stay exactly Flux's
// (app/src/components/editor-kit.tsx). The editor extends the custom nodes
// here with its views and commands; nothing here may touch React or the DOM.
import { Node, mergeAttributes, type AnyExtension } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Image from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";

import type { ColorName } from "./flux";

/** Flux's `ProjectMark` value, as stored in a callout's `data-mark`. */
export type CalloutMark =
  | { type: "icon"; value: string; color: ColorName }
  | { type: "emoji"; value: string };

export const defaultCalloutMark: CalloutMark = { type: "emoji", value: "💡" };

export function parseCalloutMark(value: unknown): CalloutMark {
  if (
    value &&
    typeof value === "object" &&
    "type" in value &&
    (value.type === "emoji" || value.type === "icon")
  ) {
    return value as CalloutMark;
  }
  if (typeof value === "string" && value) {
    return { type: "emoji", value };
  }
  return defaultCalloutMark;
}

export const CalloutNode = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      color: { default: "gray" },
      mark: {
        default: defaultCalloutMark,
        parseHTML: (element) => {
          const raw = element.getAttribute("data-mark");
          if (!raw) return defaultCalloutMark;
          try {
            return parseCalloutMark(JSON.parse(raw));
          } catch {
            return defaultCalloutMark;
          }
        },
        renderHTML: (attributes) => ({
          "data-mark": JSON.stringify(attributes.mark ?? defaultCalloutMark),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "callout" }),
      0,
    ];
  },
});

export const CodeBlockNode = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      wrap: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-wrap") === "true",
        renderHTML: (attributes) => ({
          "data-wrap": attributes.wrap ? "true" : "false",
        }),
      },
      lineNumbers: {
        default: true,
        parseHTML: (element) =>
          element.getAttribute("data-line-numbers") !== "false",
        renderHTML: (attributes) => ({
          "data-line-numbers":
            attributes.lineNumbers === false ? "false" : "true",
        }),
      },
      filename: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute("data-filename")?.trim();
          return value ? value : null;
        },
        renderHTML: (attributes) =>
          typeof attributes.filename === "string" && attributes.filename
            ? { "data-filename": attributes.filename }
            : {},
      },
    };
  },
});

export type ImageAlignment = "left" | "center" | "right";

export function parseImageAlignment(value: unknown): ImageAlignment {
  if (value === "center" || value === "right") return value;
  return "left";
}

export const ImageNode = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      alignment: {
        default: "left",
        parseHTML: (element) =>
          parseImageAlignment(element.getAttribute("data-align")),
        renderHTML: (attributes) => {
          const alignment = parseImageAlignment(attributes.alignment);
          if (alignment === "left") return {};
          return { "data-align": alignment };
        },
      },
    };
  },
});

/**
 * The document schema, exactly as Flux defines it. The editor passes its
 * own callout, code block, and image (these nodes, extended with views).
 */
export function documentSchemaExtensions(
  nodes: {
    callout?: AnyExtension;
    codeBlock?: AnyExtension;
    image?: {
      configure(options: {
        inline: boolean;
        allowBase64: boolean;
      }): AnyExtension;
    };
  } = {},
): AnyExtension[] {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true },
      undoRedo: false,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    (nodes.image ?? ImageNode).configure({
      inline: false,
      allowBase64: false,
    }),
    Mention.configure({ HTMLAttributes: { class: "mention" } }),
    TableKit.configure({
      table: { resizable: true, lastColumnResizable: false },
    }),
    nodes.codeBlock ?? CodeBlockNode,
    nodes.callout ?? CalloutNode,
  ];
}
