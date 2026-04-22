/**
 * Slug generator for blog posts
 * Creates URL-safe slugs from article titles
 * Pattern: lowercase, hyphen-separated, no special chars
 */

export function generateSlug(title) {
  if (!title || typeof title !== 'string') {
    throw new Error('Title is required to generate slug');
  }

  return title
    .toLowerCase()
    .trim()
    // Replace special chars and spaces with hyphens
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    // Collapse multiple hyphens
    .replace(/-+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-+|-+$/g, '')
    // Truncate to 80 chars (SEO best practice)
    .substring(0, 80)
    .replace(/-+$/g, '');
}

/**
 * Ensures slug is unique by appending numeric suffix if needed
 * Pass a function that checks existence in database
 */
export async function generateUniqueSlug(title, checkExistsFn) {
  const baseSlug = generateSlug(title);
  let slug = baseSlug;
  let counter = 1;

  while (await checkExistsFn(slug)) {
    counter++;
    slug = `${baseSlug}-${counter}`;
    if (counter > 50) {
      // Safety break — extremely unlikely to hit
      slug = `${baseSlug}-${Date.now()}`;
      break;
    }
  }

  return slug;
}
