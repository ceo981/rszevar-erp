/**
 * Shopify Blog REST API wrapper
 * Handles blog ID fetching and article push to Shopify Journal
 */

const SHOPIFY_API_VERSION = '2024-01';

function getShopifyBaseUrl() {
  const shop = process.env.SHOPIFY_SHOP_DOMAIN || 'rszevar.myshopify.com';
  return `https://${shop}/admin/api/${SHOPIFY_API_VERSION}`;
}

function getShopifyHeaders() {
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!token) {
    throw new Error('SHOPIFY_ADMIN_ACCESS_TOKEN missing in env');
  }
  return {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': token,
  };
}

/**
 * Fetch the Journal blog ID from Shopify
 * Cached in memory after first call (blog IDs don't change)
 */
let _cachedBlogId = null;

export async function getJournalBlogId() {
  if (_cachedBlogId) return _cachedBlogId;

  const url = `${getShopifyBaseUrl()}/blogs.json`;
  const response = await fetch(url, {
    method: 'GET',
    headers: getShopifyHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch blogs from Shopify: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const blogs = data.blogs || [];

  if (blogs.length === 0) {
    throw new Error('No blogs found on Shopify store');
  }

  // Prefer blog with handle 'journal', fallback to first blog
  const journal = blogs.find((b) => b.handle === 'journal') || blogs[0];
  _cachedBlogId = journal.id;

  console.log(`[shopify-blog] Using blog: ${journal.title} (ID: ${journal.id}, handle: ${journal.handle})`);
  return _cachedBlogId;
}

/**
 * Push a blog post to Shopify as a DRAFT article
 * Returns Shopify article ID + handle
 *
 * @param {Object} blogPost - from blog_posts table
 * @returns {Object} { shopify_article_id, shopify_blog_id, shopify_handle, admin_url, public_url }
 */
export async function pushBlogPostToShopify(blogPost) {
  const blogId = await getJournalBlogId();
  const url = `${getShopifyBaseUrl()}/blogs/${blogId}/articles.json`;

  // Build article payload
  const articlePayload = {
    article: {
      title: blogPost.title,
      author: blogPost.author_name || 'Abdul Rehman',
      body_html: appendFaqsToBody(blogPost.body_html, blogPost.faqs),
      summary_html: blogPost.excerpt ? `<p>${escapeHtml(blogPost.excerpt)}</p>` : undefined,
      tags: Array.isArray(blogPost.tags) ? blogPost.tags.join(', ') : '',
      published: false, // Always start as draft on Shopify side
      metafields: [
        {
          namespace: 'global',
          key: 'title_tag',
          value: blogPost.meta_title,
          type: 'single_line_text_field',
        },
        {
          namespace: 'global',
          key: 'description_tag',
          value: blogPost.meta_description,
          type: 'single_line_text_field',
        },
      ],
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: getShopifyHeaders(),
    body: JSON.stringify(articlePayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopify article push failed: ${response.status} ${response.statusText} — ${errorText}`);
  }

  const data = await response.json();
  const article = data.article;

  const shop = process.env.SHOPIFY_SHOP_DOMAIN || 'rszevar.myshopify.com';
  const storeHandle = shop.replace('.myshopify.com', '');

  return {
    shopify_article_id: article.id,
    shopify_blog_id: blogId,
    shopify_handle: article.handle,
    admin_url: `https://admin.shopify.com/store/${storeHandle}/content/blogs/${blogId}/articles/${article.id}`,
    public_url: `https://rszevar.com/blogs/journal/${article.handle}`,
    shopify_status: article.published_at ? 'published' : 'draft',
  };
}

/**
 * Update an existing Shopify article (for edits after initial push)
 */
export async function updateShopifyArticle(blogId, articleId, blogPost) {
  const url = `${getShopifyBaseUrl()}/blogs/${blogId}/articles/${articleId}.json`;

  const articlePayload = {
    article: {
      id: articleId,
      title: blogPost.title,
      author: blogPost.author_name || 'Abdul Rehman',
      body_html: appendFaqsToBody(blogPost.body_html, blogPost.faqs),
      summary_html: blogPost.excerpt ? `<p>${escapeHtml(blogPost.excerpt)}</p>` : undefined,
      tags: Array.isArray(blogPost.tags) ? blogPost.tags.join(', ') : '',
    },
  };

  const response = await fetch(url, {
    method: 'PUT',
    headers: getShopifyHeaders(),
    body: JSON.stringify(articlePayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopify article update failed: ${response.status} — ${errorText}`);
  }

  return await response.json();
}

/**
 * Append FAQ section to body_html as HTML
 * FAQs are stored separately in DB but rendered inline on Shopify
 * The theme snippet (Phase 4) will also inject FAQPage schema from these
 */
function appendFaqsToBody(bodyHtml, faqs) {
  if (!Array.isArray(faqs) || faqs.length === 0) return bodyHtml;

  const faqHtml = `
<h2>Frequently Asked Questions</h2>
<div class="rszevar-faq-section">
${faqs
  .map(
    (faq) => `  <div class="rszevar-faq-item">
    <h3>${escapeHtml(faq.question)}</h3>
    <p>${escapeHtml(faq.answer)}</p>
  </div>`
  )
  .join('\n')}
</div>`;

  return bodyHtml + faqHtml;
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
