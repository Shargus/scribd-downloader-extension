/**
 * Parse a Scribd document reference: a URL on any scribd.com subdomain
 * (www, it, de, ...) using /document/ or /doc/, or a bare document id.
 *
 * Returns {id, title} or null when no document id can be extracted.
 */
export function parseScribdInput(input) {
  const value = input.trim();
  if (/^\d+$/.test(value)) {
    return { id: value, title: value };
  }

  const match = value.match(
    /^(?:https?:\/\/)?(?:[\w-]+\.)*scribd\.com\/(?:document|doc)\/(\d+)(?:[/?#]|$)/i
  );
  if (!match) {
    return null;
  }

  // Same rule as the Python script: title is the last URL path segment.
  const path = value.replace(/^[a-z]+:\/\//i, "").split(/[?#]/)[0].replace(/\/+$/, "");
  const lastSegment = path.split("/").pop();
  let title = lastSegment;
  try {
    title = decodeURIComponent(lastSegment);
  } catch (error) {}
  return { id: match[1], title };
}

export function embedUrl(id) {
  return `https://www.scribd.com/embeds/${id}/content`;
}

/** Make a title safe to use as a download filename. */
export function toPdfFilename(title) {
  const safe = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 200);
  return `${safe || "scribd_document"}.pdf`;
}
