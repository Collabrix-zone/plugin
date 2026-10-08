// TODO: Change back to https://api.collabrix.zone before publishing
var PROXY_URL = "http://localhost:3000/api/generate";
var LICENSE_CHECK_URL = "http://localhost:3000/api/license-check";
var UPGRADE_URL = "https://collabrix.zone/upgrade";

figma.showUI(__html__, { width: 380, height: 560 });

// ═══════════════════════════════════════════════════
//  NODE SERIALIZER — extracts all design data
// ═══════════════════════════════════════════════════

async function serializeNode(node, isRoot) {
  if (node.visible === false) return null;

  var data = {
    id: node.id,
    name: node.name,
    type: node.type,
    // x/y are relative to parent in Figma API
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width),
    height: Math.round(node.height),
  };

  if (isRoot) {
    // Don't use canvas position for root
    data.x = 0;
    data.y = 0;
  }

  // Opacity
  if ("opacity" in node && node.opacity !== 1) {
    data.opacity = node.opacity;
  }

  // Fills (skip for text — handled separately as color)
  if ("fills" in node && node.fills !== figma.mixed) {
    var visibleFills = [];
    var hasImageFill = false;
    for (var i = 0; i < node.fills.length; i++) {
      if (node.fills[i].visible !== false) {
        visibleFills.push(serializePaint(node.fills[i]));
        if (node.fills[i].type === "IMAGE") hasImageFill = true;
      }
    }
    if (visibleFills.length > 0) data.fills = visibleFills;

    // Export image fills as base64 PNG
    if (hasImageFill && "exportAsync" in node) {
      try {
        var imgBytes = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } });
        var base64 = figma.base64Encode(imgBytes);
        data.imageBase64 = "data:image/png;base64," + base64;
      } catch (e) {
        // Ignore export errors
      }
    }
  }

  // Strokes
  if ("strokes" in node && node.strokes.length > 0) {
    var visibleStrokes = [];
    for (var j = 0; j < node.strokes.length; j++) {
      if (node.strokes[j].visible !== false) {
        visibleStrokes.push(serializePaint(node.strokes[j]));
      }
    }
    if (visibleStrokes.length > 0) {
      data.strokes = visibleStrokes;
      data.strokeWeight = node.strokeWeight !== figma.mixed ? node.strokeWeight : 1;
      data.strokeAlign = node.strokeAlign;
    }
  }

  // Effects
  if ("effects" in node && node.effects.length > 0) {
    var visibleEffects = [];
    for (var k = 0; k < node.effects.length; k++) {
      var ef = node.effects[k];
      if (ef.visible !== false) {
        visibleEffects.push({
          type: ef.type,
          radius: ef.radius,
          offset: ef.offset || { x: 0, y: 0 },
          color: ef.color,
          spread: ef.spread || 0,
        });
      }
    }
    if (visibleEffects.length > 0) data.effects = visibleEffects;
  }

  // Corner radius
  if ("cornerRadius" in node) {
    if (node.cornerRadius !== figma.mixed) {
      if (node.cornerRadius > 0) data.cornerRadius = node.cornerRadius;
    } else {
      data.topLeftRadius = node.topLeftRadius || 0;
      data.topRightRadius = node.topRightRadius || 0;
      data.bottomLeftRadius = node.bottomLeftRadius || 0;
      data.bottomRightRadius = node.bottomRightRadius || 0;
    }
  }

  // Clipping
  if ("clipsContent" in node && node.clipsContent) {
    data.clipsContent = true;
  }

  // Text
  if (node.type === "TEXT") {
    data.characters = node.characters;
    if (node.fontName !== figma.mixed) {
      data.fontFamily = node.fontName.family;
      data.fontStyle = node.fontName.style;
    }
    if (node.fontSize !== figma.mixed) data.fontSize = node.fontSize;
    if (node.letterSpacing !== figma.mixed && node.letterSpacing) {
      data.letterSpacing = node.letterSpacing;
    }
    if (node.lineHeight !== figma.mixed && node.lineHeight) {
      data.lineHeight = node.lineHeight;
    }
    data.textAlignHorizontal = node.textAlignHorizontal;
    if (node.textDecoration && node.textDecoration !== "NONE" && node.textDecoration !== figma.mixed) {
      data.textDecoration = node.textDecoration;
    }
    if (node.textCase && node.textCase !== figma.mixed && node.textCase !== "ORIGINAL") {
      data.textCase = node.textCase;
    }
  }

  // Auto-layout (→ flexbox)
  if ("layoutMode" in node && node.layoutMode !== "NONE") {
    data.layoutMode = node.layoutMode;
    data.itemSpacing = node.itemSpacing || 0;
    data.paddingLeft = node.paddingLeft || 0;
    data.paddingRight = node.paddingRight || 0;
    data.paddingTop = node.paddingTop || 0;
    data.paddingBottom = node.paddingBottom || 0;
    data.primaryAxisAlignItems = node.primaryAxisAlignItems;
    data.counterAxisAlignItems = node.counterAxisAlignItems;
    if (node.primaryAxisSizingMode) data.primaryAxisSizingMode = node.primaryAxisSizingMode;
    if (node.counterAxisSizingMode) data.counterAxisSizingMode = node.counterAxisSizingMode;
    if (node.layoutWrap) data.layoutWrap = node.layoutWrap;
  }

  // Child sizing within auto-layout
  if (node.layoutSizingHorizontal) data.layoutSizingHorizontal = node.layoutSizingHorizontal;
  if (node.layoutSizingVertical) data.layoutSizingVertical = node.layoutSizingVertical;
  if (node.layoutPositioning === "ABSOLUTE") data.layoutPositioning = "ABSOLUTE";
  if ("layoutGrow" in node && node.layoutGrow === 1) data.layoutGrow = 1;
  if ("layoutAlign" in node && node.layoutAlign === "STRETCH") data.layoutAlign = "STRETCH";

  // Constraints (for non-auto-layout children)
  if ("constraints" in node) {
    data.constraints = {
      horizontal: node.constraints.horizontal,
      vertical: node.constraints.vertical,
    };
  }

  // Reactions (prototype interactions)
  if ("reactions" in node && node.reactions.length > 0) {
    var reactions = [];
    for (var r = 0; r < node.reactions.length; r++) {
      var reaction = node.reactions[r];
      var rData = {};
      if (reaction.trigger) rData.trigger = reaction.trigger.type;
      if (reaction.action) {
        rData.action = reaction.action.type;
        if (reaction.action.url) rData.url = reaction.action.url;
        if (reaction.action.destinationId) rData.destinationId = reaction.action.destinationId;
        if (reaction.action.navigation) rData.navigation = reaction.action.navigation;
      }
      reactions.push(rData);
    }
    data.reactions = reactions;
  }

  // ── Export vectors/icons as inline SVG ──
  var isVector = (
    node.type === "VECTOR" ||
    node.type === "BOOLEAN_OPERATION" ||
    node.type === "STAR" ||
    node.type === "LINE" ||
    node.type === "ELLIPSE" ||
    node.type === "POLYGON"
  );

  // Also export groups/frames that look like icons (small, contain only vectors)
  var isIconLike = false;
  if (!isVector && "children" in node && node.children.length > 0 && node.width <= 64 && node.height <= 64) {
    var allVectors = true;
    for (var v = 0; v < node.children.length; v++) {
      var childType = node.children[v].type;
      if (childType !== "VECTOR" && childType !== "BOOLEAN_OPERATION" && childType !== "ELLIPSE" &&
          childType !== "LINE" && childType !== "STAR" && childType !== "POLYGON" && childType !== "GROUP") {
        allVectors = false;
        break;
      }
    }
    if (allVectors) isIconLike = true;
  }

  if (isVector || isIconLike) {
    try {
      var svgString = await node.exportAsync({ format: "SVG_STRING" });
      data.svgContent = svgString;
      data.isIcon = true;
      // Don't recurse into children — the SVG captures everything
      return data;
    } catch (e) {
      // Fall through to normal rendering
    }
  }

  // Children
  if ("children" in node) {
    var children = [];
    for (var c = 0; c < node.children.length; c++) {
      if (node.children[c].visible !== false) {
        var childData = await serializeNode(node.children[c], false);
        if (childData) children.push(childData);
      }
    }
    if (children.length > 0) data.children = children;
  }

  return data;
}

function serializePaint(paint) {
  var result = { type: paint.type };
  if (paint.color) {
    result.color = {
      r: paint.color.r,
      g: paint.color.g,
      b: paint.color.b,
      a: paint.opacity !== undefined ? paint.opacity : 1,
    };
  }
  if (paint.type === "GRADIENT_LINEAR" && paint.gradientStops) {
    result.gradientStops = paint.gradientStops;
  }
  if (paint.imageRef) {
    result.imageRef = paint.imageRef;
  }
  return result;
}

// ═══════════════════════════════════════════════════
//  MESSAGE HANDLERS
// ═══════════════════════════════════════════════════

async function handleGenerate() {
  var selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: "error",
      error: "NO_SELECTION",
      message: "Please select a frame or component first.",
    });
    return;
  }

  figma.ui.postMessage({ type: "generating" });

  var nodeData = await serializeNode(selection[0], true);
  var figmaUserId = (figma.currentUser && figma.currentUser.id) || "anonymous";

  figma.ui.postMessage({
    type: "do-generate",
    nodeData: nodeData,
    figmaUserId: figmaUserId,
  });
}

figma.ui.onmessage = async function(msg) {
  switch (msg.type) {
    case "generate":
      await handleGenerate();
      break;

    case "get-settings": {
      var options = await figma.clientStorage.getAsync("options") || {};
      var licenseKey = await figma.clientStorage.getAsync("licenseKey") || "";
      figma.ui.postMessage({ type: "settings", options: options, licenseKey: licenseKey });
      break;
    }

    case "save-settings":
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
