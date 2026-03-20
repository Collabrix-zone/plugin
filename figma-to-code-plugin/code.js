const PROXY_URL = "https://api.collabrix.zone/generate";
const LICENSE_CHECK_URL = "https://api.collabrix.zone/license-check";
const UPGRADE_URL = "https://collabrix.zone/upgrade";
const FREE_TIER_LIMIT = 10;
const PRO_TIER_LIMIT = 200;

figma.showUI(__html__, { width: 340, height: 480 });

function serializeNode(node) {
  const data = {
    id: node.id,
    name: node.name,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    opacity: node.opacity,
    blendMode: node.blendMode,
  };

  if ("fills" in node && node.fills !== figma.mixed) {
    data.fills = node.fills.map(serializePaint);
  }

  if ("strokes" in node) {
    data.strokes = node.strokes.map(serializePaint);
    data.strokeWeight = node.strokeWeight;
    data.strokeAlign = node.strokeAlign;
  }

  if ("effects" in node) {
    data.effects = node.effects.map((effect) => ({
      type: effect.type,
      visible: effect.visible,
      radius: effect.radius,
      offset: effect.offset,
      color: effect.color,
    }));
  }

  if ("cornerRadius" in node) {
    if (node.cornerRadius !== figma.mixed) {
      data.cornerRadius = node.cornerRadius;
    } else {
      data.topLeftRadius = node.topLeftRadius;
      data.topRightRadius = node.topRightRadius;
      data.bottomLeftRadius = node.bottomLeftRadius;
      data.bottomRightRadius = node.bottomRightRadius;
    }
  }

  if (node.type === "TEXT") {
    data.fontName = node.fontName !== figma.mixed ? node.fontName : undefined;
    data.fontSize = node.fontSize !== figma.mixed ? node.fontSize : undefined;
    data.fontWeight = node.fontWeight !== figma.mixed ? node.fontWeight : undefined;
    data.letterSpacing = node.letterSpacing !== figma.mixed ? node.letterSpacing : undefined;
    data.lineHeight = node.lineHeight !== figma.mixed ? node.lineHeight : undefined;
    data.textAlignHorizontal = node.textAlignHorizontal;
    data.textAlignVertical = node.textAlignVertical;
    data.characters = node.characters;
  }

  if ("layoutMode" in node && node.layoutMode !== "NONE") {
    data.layoutMode = node.layoutMode;
    data.itemSpacing = node.itemSpacing;
    data.paddingLeft = node.paddingLeft;
    data.paddingRight = node.paddingRight;
    data.paddingTop = node.paddingTop;
    data.paddingBottom = node.paddingBottom;
    data.primaryAxisAlignItems = node.primaryAxisAlignItems;
    data.counterAxisAlignItems = node.counterAxisAlignItems;
  }

  if ("reactions" in node && node.reactions.length > 0) {
    data.reactions = node.reactions;
  }

  if ("children" in node) {
    data.children = node.children.map(serializeNode);
  }

  return data;
}

function serializePaint(paint) {
  const result = { type: paint.type, visible: paint.visible };
  if (paint.color) {
    result.color = {
      r: paint.color.r,
      g: paint.color.g,
      b: paint.color.b,
      a: paint.opacity !== undefined ? paint.opacity : 1,
    };
  }
  if (paint.imageRef) {
    result.imageRef = paint.imageRef;
  }
  return result;
}

async function handleGenerate(msg) {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: "error",
      error: "NO_SELECTION",
      message: "Please select a frame or component first.",
    });
    return;
  }

  const nodeData = serializeNode(selection[0]);
  const licenseKey = await figma.clientStorage.getAsync("licenseKey");
  const language = await figma.clientStorage.getAsync("language") || "react";
  const options = await figma.clientStorage.getAsync("options") || {};

  try {
    const response = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-figma-user-id": figma.currentUser?.id || "anonymous",
      },
      body: JSON.stringify({
        nodeData,
        language,
        options,
        licenseKey: licenseKey || null,
        figmaUserId: figma.currentUser?.id || "anonymous",
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      figma.ui.postMessage({
        type: "error",
        error: data.error,
        message: data.message,
      });
      return;
    }

    figma.ui.postMessage({
      type: "code-result",
      code: data.code,
      language,
      usage: data.usage,
    });
  } catch (err) {
    figma.ui.postMessage({
      type: "error",
      error: "GENERATION_FAILED",
      message: "Code generation failed. Try again or contact support@collabrix.zone",
    });
  }
}

figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case "generate":
      await handleGenerate(msg);
      break;

    case "get-settings": {
      const language = await figma.clientStorage.getAsync("language") || "react";
      const options = await figma.clientStorage.getAsync("options") || {};
      const licenseKey = await figma.clientStorage.getAsync("licenseKey") || "";
      figma.ui.postMessage({ type: "settings", language, options, licenseKey });
      break;
    }

    case "save-settings":
      if (msg.language) await figma.clientStorage.setAsync("language", msg.language);
      if (msg.options) await figma.clientStorage.setAsync("options", msg.options);
      break;

    case "save-license":
      await figma.clientStorage.setAsync("licenseKey", msg.licenseKey || "");
      break;

    case "open-url":
      figma.openExternal(msg.url);
      break;

    case "resize":
      figma.ui.resize(msg.width, msg.height);
      break;
  }
};
